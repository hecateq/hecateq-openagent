/**
 * Hecateq Handoff History — append-only JSONL ledger.
 *
 * Persists compact, non-sensitive handoff metadata to
 * `.opencode/state/hecateq/handoff-history.jsonl` (relative to the
 * project root / process cwd at runtime).
 *
 * Contract:
 *  - Append-only: entries are never rewritten, only appended.
 *  - Atomic: append performs read + write-to-tmp + rename (no torn writes).
 *  - Safe reads: invalid JSON lines are skipped with a warning, never crash.
 *  - No prompts, secrets, or full model outputs — only the typed fields.
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"

import { log } from "../../shared/logger"
import { writeFileAtomically } from "../../shared/write-file-atomically"
import type {
  HecateqRuntimeEvent,
  HecateqRuntimeEventKind,
  ResumptionChannel,
} from "./runtime-continuity-types"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface HecateqHandoffHistoryEntry {
  /** ISO-8601 timestamp of the handoff */
  timestamp: string
  /** Session id that produced the handoff */
  session_id: string
  /** Task graph id this handoff belongs to (optional) */
  task_graph_id?: string
  /** Task id this handoff belongs to (optional) */
  task_id?: string
  /** Agent that produced the handoff */
  from_agent: string
  /** Agent the handoff targets */
  to_agent: string
  /** Handoff status */
  status: "done" | "partial" | "blocked"
  /** Confidence score 0.0-1.0 */
  confidence: number
  /**
   * Optional runtime event kind. Present only on runtime-continuity
   * ledger lines (see `appendRuntimeEvent`); legacy handoff lines omit it.
   */
  event?: HecateqRuntimeEventKind
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Relative path to the handoff history ledger from the project root */
export const HECATEQ_HANDOFF_HISTORY_REL = join(
  ".opencode",
  "state",
  "hecateq",
  "handoff-history.jsonl",
)

/** All valid runtime event kinds accepted by the event ledger parser. */
const RUNTIME_EVENT_KINDS: ReadonlySet<HecateqRuntimeEventKind> = new Set([
  "execution_started",
  "execution_waiting",
  "execution_resumed",
  "execution_completed",
  "execution_failed",
  "handoff_created",
  "resumption_channel_attached",
  "resumption_channel_closed",
  "evidence_recorded",
])

// ─── Test seam ───────────────────────────────────────────────────────────────

let historyFilePathOverride: string | null = null

/**
 * Resolve the ledger path. Tests may redirect via the override seam;
 * runtime uses `<cwd>/.opencode/state/hecateq/handoff-history.jsonl`.
 */
function resolveHistoryFilePath(): string {
  if (historyFilePathOverride) return historyFilePathOverride
  return join(process.cwd(), HECATEQ_HANDOFF_HISTORY_REL)
}

/**
 * @internal Test-only seam. Pass a directory (or file) to redirect the
 * ledger for hermetic tests; pass `null` to restore the default path.
 */
export function _setHandoffHistoryFilePathForTesting(
  filePath: string | null,
): void {
  historyFilePathOverride = filePath
}

// ─── Ledger operations ────────────────────────────────────────────────────────

/**
 * Append one entry to the handoff history ledger. Atomic (tmp + rename).
 * Never throws — write failures are logged, not propagated.
 */
export function appendHandoffHistoryEntry(
  entry: HecateqHandoffHistoryEntry,
): void {
  try {
    const filePath = resolveHistoryFilePath()
    mkdirSync(dirname(filePath), { recursive: true })

    const existing = existsSync(filePath) ? readFileSync(filePath, "utf-8") : ""
    const line = `${JSON.stringify(serializeEntry(entry))}\n`
    writeFileAtomically(filePath, `${existing}${line}`)
  } catch (error) {
    log("hecateq:handoff-history:append:failed", {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Read the last `limit` entries from the ledger. Returns `[]` when the
 * file does not exist. Invalid JSON lines are skipped with a warning.
 */
export function loadRecentHandoffHistory(
  limit: number = 5,
): HecateqHandoffHistoryEntry[] {
  const filePath = resolveHistoryFilePath()
  if (!existsSync(filePath)) return []

  let raw: string
  try {
    raw = readFileSync(filePath, "utf-8")
  } catch {
    return []
  }

  const entries: HecateqHandoffHistoryEntry[] = []
  const lines = raw.split("\n")
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    const parsed = tryParseHistoryLine(trimmed)
    if (parsed) {
      entries.push(parsed)
    } else {
      log("hecateq:handoff-history:skipped-invalid-line", {
        line: trimmed.slice(0, 120),
      })
    }
  }

  return entries.slice(-Math.max(0, limit))
}

/**
 * Empty the ledger. Used by tests (and by future rotation logic).
 * Never throws.
 */
export function clearHandoffHistory(): void {
  try {
    const filePath = resolveHistoryFilePath()
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileAtomically(filePath, "")
  } catch (error) {
    log("hecateq:handoff-history:clear:failed", {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Serialize an entry. Only the typed fields are persisted — prompts,
 * secrets, and full model outputs are never included.
 */
function serializeEntry(
  entry: HecateqHandoffHistoryEntry,
): Record<string, unknown> {
  const serialized: Record<string, unknown> = {
    timestamp: entry.timestamp,
    session_id: entry.session_id,
    from_agent: entry.from_agent,
    to_agent: entry.to_agent,
    status: entry.status,
    confidence: entry.confidence,
  }
  if (entry.task_graph_id) serialized.task_graph_id = entry.task_graph_id
  if (entry.task_id) serialized.task_id = entry.task_id
  if (entry.event) serialized.event = entry.event
  return serialized
}

function tryParseHistoryLine(line: string): HecateqHandoffHistoryEntry | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return null
  }
  if (typeof parsed !== "object" || parsed === null) return null

  const record = parsed as Record<string, unknown>
  const timestamp = record.timestamp
  const sessionId = record.session_id
  const fromAgent = record.from_agent
  const toAgent = record.to_agent
  const status = record.status
  const confidence = record.confidence

  if (typeof timestamp !== "string") return null
  if (typeof sessionId !== "string") return null
  if (typeof fromAgent !== "string") return null
  if (typeof toAgent !== "string") return null
  if (status !== "done" && status !== "partial" && status !== "blocked") return null
  if (typeof confidence !== "number" || confidence < 0 || confidence > 1) return null

  const entry: HecateqHandoffHistoryEntry = {
    timestamp,
    session_id: sessionId,
    from_agent: fromAgent,
    to_agent: toAgent,
    status,
    confidence,
  }
  if (typeof record.task_graph_id === "string") entry.task_graph_id = record.task_graph_id
  if (typeof record.task_id === "string") entry.task_id = record.task_id
  return entry
}

// ─── Runtime event ledger operations ──────────────────────────────────────────

/**
 * Append one runtime event to the shared ledger. Same append-only, atomic
 * discipline as `appendHandoffHistoryEntry`. Never throws — write failures
 * are logged, not propagated. Only the typed fields are persisted: NO
 * prompts, NO model output, NO secrets.
 */
export function appendRuntimeEvent(event: HecateqRuntimeEvent): void {
  try {
    const filePath = resolveHistoryFilePath()
    mkdirSync(dirname(filePath), { recursive: true })

    const existing = existsSync(filePath) ? readFileSync(filePath, "utf-8") : ""
    const line = `${JSON.stringify(serializeRuntimeEvent(event))}\n`
    writeFileAtomically(filePath, `${existing}${line}`)
  } catch (error) {
    log("hecateq:handoff-history:append-runtime-event:failed", {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Read the last `limit` runtime events from the ledger. Handoff entries
 * (lines without an `event` kind) are skipped. Returns `[]` when the file
 * does not exist; invalid JSON lines are skipped with a warning.
 */
export function loadRecentRuntimeEvents(
  limit: number = 5,
): HecateqRuntimeEvent[] {
  const filePath = resolveHistoryFilePath()
  if (!existsSync(filePath)) return []

  let raw: string
  try {
    raw = readFileSync(filePath, "utf-8")
  } catch {
    return []
  }

  const events: HecateqRuntimeEvent[] = []
  const lines = raw.split("\n")
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    const parsed = tryParseRuntimeEventLine(trimmed)
    if (parsed) {
      events.push(parsed)
    } else {
      log("hecateq:handoff-history:skipped-invalid-runtime-event-line", {
        line: trimmed.slice(0, 120),
      })
    }
  }

  return events.slice(-Math.max(0, limit))
}

// ─── Runtime event helpers ────────────────────────────────────────────────────

/**
 * Serialize a runtime event. Only the typed fields are persisted — prompts,
 * secrets, and full model outputs are never included.
 */
function serializeRuntimeEvent(
  event: HecateqRuntimeEvent,
): Record<string, unknown> {
  const serialized: Record<string, unknown> = {
    event: event.event,
    timestamp: event.timestamp,
  }
  if (event.task_graph_id) serialized.task_graph_id = event.task_graph_id
  if (event.task_id) serialized.task_id = event.task_id
  if (event.attempt !== undefined) serialized.attempt = event.attempt
  if (event.execution_id) serialized.execution_id = event.execution_id
  if (event.agent) serialized.agent = event.agent
  if (event.channel) serialized.channel = event.channel
  if (event.reason) serialized.reason = event.reason
  return serialized
}

function isResumptionChannelRecord(value: unknown): value is ResumptionChannel {
  if (typeof value !== "object" || value === null) return false
  const record = value as Record<string, unknown>
  const kind = record.kind
  if (
    kind !== "background_task" &&
    kind !== "delegated_session" &&
    kind !== "continuation" &&
    kind !== "parent_wake"
  ) {
    return false
  }
  if (typeof record.id !== "string") return false
  if (typeof record.alive !== "boolean") return false
  return true
}

function tryParseRuntimeEventLine(
  line: string,
): HecateqRuntimeEvent | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return null
  }
  if (typeof parsed !== "object" || parsed === null) return null

  const record = parsed as Record<string, unknown>
  const eventKind = record.event
  if (
    typeof eventKind !== "string" ||
    !RUNTIME_EVENT_KINDS.has(eventKind as HecateqRuntimeEventKind)
  ) {
    return null
  }
  const timestamp = record.timestamp
  if (typeof timestamp !== "string") return null

  const event: HecateqRuntimeEvent = {
    event: eventKind as HecateqRuntimeEventKind,
    timestamp,
  }
  if (typeof record.task_graph_id === "string") event.task_graph_id = record.task_graph_id
  if (typeof record.task_id === "string") event.task_id = record.task_id
  if (typeof record.attempt === "number") event.attempt = record.attempt
  if (typeof record.execution_id === "string") event.execution_id = record.execution_id
  if (typeof record.agent === "string") event.agent = record.agent
  if (typeof record.reason === "string") event.reason = record.reason
  if (isResumptionChannelRecord(record.channel)) event.channel = record.channel
  return event
}
