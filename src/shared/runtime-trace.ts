/**
 * Runtime Trace — Lightweight Structured Observability
 *
 * A minimal, additive trace/event system for Hecateq plugin runtime surfaces:
 * handoff processing, routing decisions, delegation lifecycle, background
 * ingestion, and signal events. Fits the current plugin architecture without
 * pulling in any telemetry framework.
 *
 * Design:
 *   - In-memory ring buffer (default 500 events, configurable).
 *   - Optional JSONL persistence to `.opencode/state/hecateq/traces.jsonl`.
 *   - Best-effort: emit and flush are no-throw — a trace write failure never
 *     blocks or crashes the caller.
 *   - Doctor-visible: `getTraceSummary()` produces counts-by-type plus recent
 *     noteworthy events suitable for `bunx oh-my-opencode doctor`.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { HECATEQ_OMO_DIR } from "../features/hecateq-orchestration/omo-state-manager"

// ─── Trace Event Types ──────────────────────────────────────────────────────

export type RuntimeTraceEventType =
  | "handoff.extracted"
  | "handoff.persisted"
  | "handoff.context_summary_built"
  | "routing.decided"
  | "routing.role_violation"
  | "delegation.created"
  | "delegation.consumed"
  | "delegation.guardrail_skipped"
  | "background.handoff_ingested"
  | "signal.emitted"
  | "signal.consumed"
  | "model.fallback_triggered"

export type RuntimeTracePhase =
  | "extraction"
  | "persistence"
  | "routing"
  | "delegation"
  | "background_ingestion"
  | "signal"
  | "model"

/**
 * A single structured trace event.
 *
 * `payload` carries type-specific data. Consumers should narrow on `type`
 * before interpreting payload fields.
 */
export interface RuntimeTraceEvent {
  /** Unique event ID (sortable) */
  id: string
  /** ISO-8601 timestamp */
  timestamp: string
  /** Event type */
  type: RuntimeTraceEventType
  /** Coarse phase for filtering */
  phase: RuntimeTracePhase
  /** Elapsed wall-clock time in ms (optional, for duration-span events) */
  durationMs?: number
  /** Event-specific data. Never mutated after emit. */
  payload: Record<string, unknown>
}

// ─── Trace Buffer ───────────────────────────────────────────────────────────

/** JSONL filename appended to the Hecateq state directory */
const TRACE_JSONL_FILENAME = "traces.jsonl"

/** Maximum number of in-memory events kept in the ring buffer */
const DEFAULT_RING_SIZE = 500

export interface TraceBuffer {
  /** Append an event. Returns the event. Never throws. */
  emit: (event: RuntimeTraceEvent) => RuntimeTraceEvent
  /** Return the last `count` events (most recent first). */
  recent: (count?: number) => RuntimeTraceEvent[]
  /** Return all events matching a type. */
  byType: (type: RuntimeTraceEventType) => RuntimeTraceEvent[]
  /*   * Flush all buffered events to `.opencode/state/hecateq/traces.jsonl` for the given
   *  project directory. Never throws. Returns number of events written. */
  flush: (projectDir: string) => number
  /** Return a summary suitable for doctor/reporting. */
  summary: () => RuntimeTraceSummary
  /** Current total number of events in the buffer. */
  size: () => number
}

export interface RuntimeTraceSummary {
  /** Total events in buffer */
  totalEvents: number
  /** Counts by event type */
  byType: Record<string, number>
  /** Counts by phase */
  byPhase: Record<string, number>
  /** Most recent event timestamp (ISO-8601), or null if empty */
  lastEventAt: string | null
  /** Recent noteworthy events (warnings, errors, role violations) */
  noteworthy: RuntimeTraceSummaryEvent[]
}

export interface RuntimeTraceSummaryEvent {
  type: RuntimeTraceEventType
  timestamp: string
  summary: string
}

// ─── Event Factory ──────────────────────────────────────────────────────────

let eventIdCounter = 0

/**
 * Create a trace event with the given type, phase, and payload.
 * Assigns a monotonically increasing ID and an ISO-8601 timestamp.
 */
export function createTraceEvent(
  type: RuntimeTraceEventType,
  phase: RuntimeTracePhase,
  payload: Record<string, unknown> = {},
  durationMs?: number,
): RuntimeTraceEvent {
  eventIdCounter += 1
  return {
    id: `${Date.now()}-${eventIdCounter}`,
    timestamp: new Date().toISOString(),
    type,
    phase,
    payload,
    ...(durationMs !== undefined ? { durationMs } : {}),
  }
}

// ─── Ring Buffer Implementation ─────────────────────────────────────────────

/**
 * Create a trace buffer with a configurable ring size.
 * Events beyond the ring size silently evict the oldest entry.
 */
export function createTraceBuffer(maxSize: number = DEFAULT_RING_SIZE): TraceBuffer {
  const ring: RuntimeTraceEvent[] = []
  let head = 0
  let count = 0

  function emit(event: RuntimeTraceEvent): RuntimeTraceEvent {
    if (maxSize <= 0) return event

    if (count < maxSize) {
      ring[head] = event
      count += 1
      head = (head + 1) % maxSize
    } else {
      ring[head] = event
      head = (head + 1) % maxSize
    }
    return event
  }

  function recent(n: number = 20): RuntimeTraceEvent[] {
    if (count === 0) return []
    const limit = Math.min(n, count)
    const result: RuntimeTraceEvent[] = []
    // Most recent element is at (head - 1) mod maxSize
    let idx = head - 1
    if (idx < 0) idx = maxSize - 1
    for (let i = 0; i < limit; i++) {
      const event = ring[idx]
      if (event) result.push(event)
      idx -= 1
      if (idx < 0) idx = maxSize - 1
    }
    return result
  }

  function byType(type: RuntimeTraceEventType): RuntimeTraceEvent[] {
    const result: RuntimeTraceEvent[] = []
    for (let i = 0; i < count; i++) {
      const actualIdx = count < maxSize
        ? i
        : ((head + i) % maxSize)
      const event = ring[actualIdx]
      if (event && event.type === type) {
        result.push(event)
      }
    }
    return result
  }

  function flush(projectDir: string): number {
    const events = recent(count)
    if (events.length === 0) return 0

    try {
      const omoDir = join(projectDir, HECATEQ_OMO_DIR)
      if (!existsSync(omoDir)) {
        mkdirSync(omoDir, { recursive: true })
      }

      const tracePath = join(omoDir, TRACE_JSONL_FILENAME)
      const lines = events.map((e) => JSON.stringify(e)).join("\n") + "\n"
      appendFileSync(tracePath, lines, "utf-8")
      return events.length
    } catch {
      return 0
    }
  }

  function summary(): RuntimeTraceSummary {
    const allEvents = recent(count)
    const byTypeMap: Record<string, number> = {}
    const byPhaseMap: Record<string, number> = {}
    const noteworthy: RuntimeTraceSummaryEvent[] = []

    for (const event of allEvents) {
      byTypeMap[event.type] = (byTypeMap[event.type] ?? 0) + 1
      byPhaseMap[event.phase] = (byPhaseMap[event.phase] ?? 0) + 1

      // Collect noteworthy events: role violations, guardrail skips, fallbacks
      if (
        event.type === "routing.role_violation" ||
        event.type === "delegation.guardrail_skipped" ||
        event.type === "model.fallback_triggered"
      ) {
        const violation = event.payload.rule ?? event.payload.reason ??
          event.payload.detail ?? "unknown"
        noteworthy.push({
          type: event.type,
          timestamp: event.timestamp,
          summary: typeof violation === "string"
            ? violation.slice(0, 200)
            : JSON.stringify(violation).slice(0, 200),
        })
      }
    }

    return {
      totalEvents: count,
      byType: byTypeMap,
      byPhase: byPhaseMap,
      lastEventAt: allEvents.length > 0 ? allEvents[0]!.timestamp : null,
      noteworthy: noteworthy.slice(0, 50),
    }
  }

  function size(): number {
    return count
  }

  return { emit, recent, byType, flush, summary, size }
}

// ─── Singleton Buffer (default, shared across the process) ──────────────────

let defaultBuffer: TraceBuffer | null = null

/** Get or create the default process-wide trace buffer. */
export function getDefaultTraceBuffer(): TraceBuffer {
  if (!defaultBuffer) {
    defaultBuffer = createTraceBuffer()
  }
  return defaultBuffer
}

/**
 * Reset the default trace buffer. Used by tests to ensure clean state.
 * NOT for production use.
 */
export function resetDefaultTraceBuffer(): void {
  defaultBuffer = null
  eventIdCounter = 0
}

// ─── Convenience Emitters ───────────────────────────────────────────────────

/**
 * Emit a trace event to the default buffer.
 * Convenience: creates the event and emits it in one call.
 * For instrumentation: provides a lightweight, no-throw way to add trace
 * points without importing the full buffer API.
 */
export function emitTraceEvent(
  type: RuntimeTraceEventType,
  phase: RuntimeTracePhase,
  payload: Record<string, unknown> = {},
  durationMs?: number,
): RuntimeTraceEvent {
  try {
    const event = createTraceEvent(type, phase, payload, durationMs)
    return getDefaultTraceBuffer().emit(event)
  } catch {
    // Best-effort: silently drop
    const fallback: RuntimeTraceEvent = {
      id: `fallback-${Date.now()}`,
      timestamp: new Date().toISOString(),
      type,
      phase,
      payload,
    }
    return fallback
  }
}

/**
 * Measure the wall-clock duration of a synchronous or async operation
 * and emit a trace event on completion.
 *
 * Returns the operation's result. The trace event is emitted regardless
 * of whether the operation throws.
 */
export async function traceSpan<T>(
  type: RuntimeTraceEventType,
  phase: RuntimeTracePhase,
  payload: Record<string, unknown>,
  operation: () => T | Promise<T>,
): Promise<T> {
  const startedAt = Date.now()
  try {
    const result = await operation()
    const durationMs = Date.now() - startedAt
    emitTraceEvent(type, phase, { ...payload, outcome: "success" }, durationMs)
    return result
  } catch (error) {
    const durationMs = Date.now() - startedAt
    emitTraceEvent(
      type,
      phase,
      {
        ...payload,
        outcome: "error",
        error: error instanceof Error ? error.message : String(error),
      },
      durationMs,
    )
    throw error
  }
}

// ─── JSONL Inspection (for doctor / debugging) ──────────────────────────────

/**
 * Read the persisted trace JSONL from `.opencode/state/hecateq/traces.jsonl`.
 * Returns parsed events (most recent first), or empty array if not available.
 */
export function readPersistedTraces(projectDir: string): RuntimeTraceEvent[] {
  try {
    const tracePath = join(projectDir, HECATEQ_OMO_DIR, TRACE_JSONL_FILENAME)
    if (!existsSync(tracePath)) return []

    const content = readFileSync(tracePath, "utf-8")
    if (!content.trim()) return []

    return content
      .trim()
      .split("\n")
      .filter((line: string) => line.trim().length > 0)
      .map((line: string) => {
        try { return JSON.parse(line) as RuntimeTraceEvent } catch { return null }
      })
      .filter((e: RuntimeTraceEvent | null): e is RuntimeTraceEvent => e !== null)
  } catch {
    return []
  }
}

/**
 * Build a trace summary suitable for doctor checks from persisted JSONL.
 * Complements the in-memory `summary()` method by reading persisted state.
 */
export function getPersistedTraceSummary(projectDir: string): RuntimeTraceSummary {
  const events = readPersistedTraces(projectDir)
  if (events.length === 0) {
    return {
      totalEvents: 0,
      byType: {},
      byPhase: {},
      lastEventAt: null,
      noteworthy: [],
    }
  }

  const byTypeMap: Record<string, number> = {}
  const byPhaseMap: Record<string, number> = {}
  const noteworthy: RuntimeTraceSummaryEvent[] = []

  for (const event of events) {
    byTypeMap[event.type] = (byTypeMap[event.type] ?? 0) + 1
    byPhaseMap[event.phase] = (byPhaseMap[event.phase] ?? 0) + 1

    if (
      event.type === "routing.role_violation" ||
      event.type === "delegation.guardrail_skipped" ||
      event.type === "model.fallback_triggered"
    ) {
      const detail = event.payload.rule ?? event.payload.reason ??
        event.payload.detail ?? "unknown"
      noteworthy.push({
        type: event.type,
        timestamp: event.timestamp,
        summary: typeof detail === "string"
          ? detail.slice(0, 200)
          : JSON.stringify(detail).slice(0, 200),
      })
    }
  }

  return {
    totalEvents: events.length,
    byType: byTypeMap,
    byPhase: byPhaseMap,
    lastEventAt: events[0]?.timestamp ?? null,
    noteworthy: noteworthy.slice(0, 50),
  }
}
