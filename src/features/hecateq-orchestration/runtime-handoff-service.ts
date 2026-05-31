/**
 * Hecateq Runtime Handoff Service
 *
 * Bridges the handoff parser with live runtime state:
 * 1. Extract handoff metadata from a completed delegated agent's text response.
 * 2. Persist into `.opencode/state/hecateq/state.json` (canonical source of truth).
 * 3. Persist into real Boulder task session state (`task_sessions["__handoff__"]`)
 *    as backward-compatible fallback.
 * 4. Persist into real run-continuation markers as backward-compatible fallback.
 * 5. Build a compact live summary from persisted state for context injection,
 *    reading `.omo/hecateq/state.json` first (canonical), falling back to
 *    continuation markers and Boulder state.
 */

import { existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"

import { readBoulderState, upsertTaskSessionStateForWork } from "../boulder-state"
import {
  readContinuationMarker,
  setContinuationMarkerSource,
} from "../run-continuation-state/storage"
import { buildHandoffContextSummary } from "./handoff-context-injection"
import type { HandoffBlock } from "./handoff-parser"
import { parseHandoffBlock, createDefaultHandoffBlock } from "./handoff-parser"
import { OmoStateManager } from "./omo-state-manager"
import { emitTraceEvent } from "../../shared/runtime-trace"
import type { HecateqStoredHandoff } from "./types"
import { log } from "../../shared/logger"
import { PROJECT_MEMORY_DIR } from "../../shared/memory-bootstrap"
import {
  appendTaskEntry,
  type TaskStateEntry,
} from "../../shared/task-state-memory"
import {
  appendDecisionEntry,
  type DecisionLogEntry,
} from "../../shared/decision-log"
import { writeQualityHistory } from "../../shared/memory-quality-writer"
import type { QualityGateReport } from "../../shared/memory-quality-writer"
import { updateRiskProfile } from "../../shared/memory-risk-writer"
import { appendChangeImpactEntries } from "../../shared/memory-change-impact"

// This key is used in BoulderState.task_sessions to store handoff data.
// It is NOT in the package's RESERVED_KEYS set, so upsertTaskSessionStateForWork accepts it.
const HECATEQ_HANDOFF_TASK_KEY = "__handoff__"

// ─── 1. Extraction from agent response ─────────────────────────────────────

/**
 * Extract handoff metadata from a completed delegated agent's text response.
 * Searches for the STATUS/SIGNALS_EMITTED/HANDOFF block anywhere in the text.
 *
 * Returns null if no valid handoff block is present (not an error — just no handoff).
 */
export function extractHandoffFromAgentResponse(
  textContent: string,
): HandoffBlock | null {
  if (!textContent || textContent.trim().length === 0) return null

  const result = parseHandoffBlock(textContent)

  // Heuristic: if parsing produced nothing meaningful, treat as "no handoff"
  if (!result.status && !result.handoff && result.signals.length === 0) {
    return null
  }

  // Trace: handoff extracted from agent response
  emitTraceEvent("handoff.extracted", "extraction", {
    status: result.status,
    target: result.handoff,
    signalCount: result.signals.length,
    signalNames: result.signals.map((s) => s.signal),
  })

  return result
}

// ─── 2. Persist into real Boulder state ────────────────────────────────────

/**
 * Persist handoff metadata into the real Boulder task session state.
 * Writes to the `__handoff__` key in task_sessions of the active work.
 *
 * Returns true if the persistence succeeded.
 */
export function persistHandoffToBoulderSession(
  directory: string,
  workId: string,
  handoff: HandoffBlock,
): boolean {
  const sessionId = `handoff-${workId}-${Date.now()}`
  const label = `Handoff: ${handoff.status ?? "unknown"} → ${handoff.handoff ?? "none"}`
  const titlePayload = JSON.stringify({
    status: handoff.status,
    target: handoff.handoff,
    signalCount: handoff.signals.length,
    signalNames: handoff.signals.map((s) => s.signal),
  })

  const result = upsertTaskSessionStateForWork(directory, workId, {
    taskKey: HECATEQ_HANDOFF_TASK_KEY,
    taskLabel: label,
    taskTitle: titlePayload,
    sessionId,
    agent: handoff.handoff ?? undefined,
  })

  return result !== null
}

// ─── 3. Persist into run-continuation marker ───────────────────────────────

/**
 * Persist handoff metadata into a run-continuation marker as the
 * background-task source reason. This makes the handoff durable across
 * agent sessions and discoverable by doctor checks.
 */
export function persistHandoffToContinuationMarker(
  directory: string,
  sessionId: string,
  handoff: HandoffBlock,
): void {
  setContinuationMarkerSource(
    directory,
    sessionId,
    "background-task",
    "active",
    JSON.stringify({
      status: handoff.status,
      handoff: handoff.handoff,
      signalCount: handoff.signals.length,
      signals: handoff.signals.map((s) => ({
        signal: s.signal,
        payload: s.payload,
      })),
    }),
  )
}

// ─── 4. Persist into `.omo/hecateq/state.json` (canonical) ──────────────

/**
 * Persist handoff metadata into `.omo/hecateq/state.json` as the
 * canonical source of truth for Hecateq runtime handoff state.
 *
 * This is a best-effort operation: failures are silently ignored
 * (logged at the call site) since the fallback persistence paths
 * (Boulder + continuation markers) continue to work.
 *
 * Returns true if the persistence succeeded.
 */
export function recordHandoffToOmoState(
  directory: string,
  handoff: HandoffBlock,
): boolean {
  try {
    const mgr = new OmoStateManager(directory)
    const stored: HecateqStoredHandoff = {
      status: handoff.status,
      target: handoff.handoff,
      signalCount: handoff.signals.length,
      signalNames: handoff.signals.map((s) => s.signal),
      timestamp: new Date().toISOString(),
      source: "direct",
    }
    const result = mgr.recordHandoff(stored)

    // Trace: handoff persisted to .omo/hecateq/
    const persisted = result !== null
    emitTraceEvent("handoff.persisted", "persistence", {
      status: stored.status,
      target: stored.target,
      signalCount: stored.signalCount,
      persisted,
    })

    return persisted
  } catch {
    emitTraceEvent("handoff.persisted", "persistence", {
      status: handoff.status,
      target: handoff.handoff,
      persisted: false,
      error: "exception during persistence",
    })
    return false
  }
}

// ─── 5. Build live context summary from persisted state ────────────────────

/**
 * Build a handoff context summary from `.omo/hecateq/state.json`.
 *
 * This is the canonical read path. When an active handoff exists in the
 * OMO state, this function returns its summary. When no active handoff exists
 * but history entries are present, the most recent history entry is used.
 *
 * Returns empty string if `.omo/hecateq/` has no handoff state.
 */
export function buildOmoHandoffContextSummary(directory: string): string {
  try {
    const mgr = new OmoStateManager(directory)
    const active = mgr.getActiveHandoff()
    if (active) {
      const summary = buildHandoffContextSummary(createDefaultHandoffBlock({
        status: active.status,
        handoff: active.target,
      }))
      if (summary.hasHandoff) {
        emitTraceEvent("handoff.context_summary_built", "routing", {
          source: "omo_state.active",
          status: active.status,
          target: active.target,
        })
        return summary.summary
      }
    }

    // Try history as secondary omo source
    const history = mgr.getHandoffHistory()
    if (history.length > 0) {
      const last = history[0]
      if (last) {
        const summary = buildHandoffContextSummary(createDefaultHandoffBlock({
          status: last.status,
          handoff: last.target,
        }))
        if (summary.hasHandoff) {
          emitTraceEvent("handoff.context_summary_built", "routing", {
            source: "omo_state.history",
            status: last.status,
            target: last.target,
          })
          return summary.summary
        }
      }
    }
  } catch {
    // OMO state not available — skip to fallbacks
  }

  return ""
}

/**
 * Build a compact handoff context summary from persisted state.
 *
 * Canonical read order:
 * 1. `.omo/hecateq/state.json` (canonical source of truth)
 * 2. Run-continuation markers (backward-compatible fallback)
 * 3. Boulder task session state (backward-compatible fallback)
 *
 * Returns empty string if no handoff state exists anywhere.
 */
export function buildLiveHandoffContextSummary(
  directory: string,
  sessionId: string,
): string {
  // Source 1: `.omo/hecateq/state.json` — canonical read path
  const omoSummary = buildOmoHandoffContextSummary(directory)
  if (omoSummary) return omoSummary

  // Source 2: Run-continuation marker — backward-compatible fallback
  const marker = readContinuationMarker(directory, sessionId)
  if (marker) {
    const bgTask = marker.sources["background-task"]
    if (bgTask?.reason) {
      try {
        const parsed = JSON.parse(bgTask.reason) as HandoffBlock
        const summary = buildHandoffContextSummary(parsed)
        if (summary.hasHandoff) return summary.summary
      } catch {
        // Corrupted reason — skip
      }
    }
  }

  // Source 3: Boulder state — backward-compatible fallback
  try {
    const state = readBoulderState(directory)
    if (state) {
      const workId = state.active_work_id
      if (workId && state.works?.[workId]?.task_sessions?.[HECATEQ_HANDOFF_TASK_KEY]) {
        const entry = state.works[workId].task_sessions![HECATEQ_HANDOFF_TASK_KEY]
        let status: HandoffBlock["status"] = null
        let target: string | null = null
        let signalCount = 0
        try {
          const title = JSON.parse(entry.task_title) as {
            status?: string
            target?: string
            signalCount?: number
          }
          if (title.status === "DONE" || title.status === "IN_PROGRESS" || title.status === "BLOCKED") {
            status = title.status
          }
          target = title.target ?? entry.agent ?? null
          signalCount = title.signalCount ?? 0
        } catch {
          status = null
          target = entry.agent ?? null
        }
        const summary = buildHandoffContextSummary(createDefaultHandoffBlock({
          status,
          handoff: target,
          raw: entry.task_title,
        }))
        if (summary.hasHandoff) return summary.summary
      }
    }
  } catch {
    // Boulder state not available — skip
  }

  return ""
}

// ─── 6. Task State Memory and Decision Log write helpers ──────────────────

/**
 * Build a deterministic task ID for a handoff-derived task entry.
 * The same session+target combination always produces the same ID,
 * enabling duplicate detection in appendTaskEntry.
 */
function deterministicHandoffTaskId(sessionId: string, target: string | null): string {
  const input = `${sessionId}:${target ?? "none"}`
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash) + input.charCodeAt(i)
    hash |= 0
  }
  return `handoff-${Math.abs(hash).toString(36)}`
}

/**
 * Build a deterministic decision ID for a handoff-derived decision entry.
 */
function deterministicHandoffDecisionId(sessionId: string, handoffStatus: string | null): string {
  const input = `${sessionId}:decision:${handoffStatus ?? "unknown"}`
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash) + input.charCodeAt(i)
    hash |= 0
  }
  return `dec-handoff-${Math.abs(hash).toString(36)}`
}

/**
 * Map a HandoffBlock to a TaskStateEntry using only existing schema values.
 *
 * Status mapping:
 *   DONE    → action "complete", status "completed"
 *   BLOCKED → action "block",    status "blocked"
 *   else    → action "update",   status "in_progress"
 */
function mapHandoffToTaskEntry(
  handoff: HandoffBlock,
  sessionId: string,
): TaskStateEntry {
  let action: TaskStateEntry["action"]
  let taskStatus: TaskStateEntry["status"]

  if (handoff.status === "DONE") {
    action = "complete"
    taskStatus = "completed"
  } else if (handoff.status === "BLOCKED") {
    action = "block"
    taskStatus = "blocked"
  } else {
    action = "update"
    taskStatus = "in_progress"
  }

  const title = handoff.handoff
    ? `Handoff to ${handoff.handoff}`
    : "Task handoff"

  return {
    version: 1,
    id: deterministicHandoffTaskId(sessionId, handoff.handoff),
    timestamp: new Date().toISOString(),
    action,
    title,
    status: taskStatus,
    owner_agent: handoff.handoff ?? undefined,
    source_session_id: sessionId,
    related_sessions: [sessionId],
    blockers: handoff.blockers.length > 0 ? handoff.blockers : undefined,
    changed_files: handoff.changedFiles.length > 0
      ? handoff.changedFiles.map((f) => f.path)
      : undefined,
    verification: handoff.qualityNotes ?? undefined,
    next_action: handoff.nextRecommendedAgent
      ? `Handoff to ${handoff.nextRecommendedAgent}`
      : undefined,
    metadata: {
      handoff_status: handoff.status,
      handoff_target: handoff.handoff,
      signal_count: handoff.signals.length,
      signal_names: handoff.signals.map((s) => s.signal),
      handoff_confidence: handoff.confidence,
    },
  }
}

/**
 * Heuristic: does the handoff contain decision-like content worth persisting?
 */
function handoffContainsDecisionSignal(handoff: HandoffBlock): boolean {
  if (!handoff.qualityNotes) return false
  const lower = handoff.qualityNotes.toLowerCase()
  const markers = [
    "decision",
    "decided",
    "chose ",
    "selected",
    "opted",
    "rationale",
    "tradeoff",
    "architecture decision",
    "architecture",
    "design choice",
  ]
  return markers.some((m) => lower.includes(m))
}

/**
 * Map a HandoffBlock to a DecisionLogEntry, only when the handoff
 * contains decision-like content. Returns null when no decision
 * should be recorded.
 */
function mapHandoffToDecisionEntry(
  handoff: HandoffBlock,
  sessionId: string,
): DecisionLogEntry | null {
  if (!handoffContainsDecisionSignal(handoff)) return null

  const title = handoff.qualityNotes
    ? `Handoff decision: ${handoff.qualityNotes.slice(0, 120)}`
    : `Handoff decision from ${handoff.handoff ?? "unknown"}`

  const decisionText = handoff.qualityNotes ?? "Routing decision"
  const rationale =
    handoff.confidence !== null
      ? `Confidence: ${handoff.confidence}; Handoff target: ${handoff.handoff ?? "none"}`
      : `Handoff target: ${handoff.handoff ?? "none"}`

  const impactArea =
    handoff.nextRecommendedAgent
      ? `routing:${handoff.nextRecommendedAgent}`
      : handoff.handoff
        ? `routing:${handoff.handoff}`
        : "routing"

  return {
    version: 1,
    id: deterministicHandoffDecisionId(sessionId, handoff.status),
    timestamp: new Date().toISOString(),
    action: "record",
    title,
    status: "active",
    decision: decisionText,
    rationale,
    impact_area: impactArea,
    changed_by: handoff.handoff ?? undefined,
    source_session_id: sessionId,
    metadata: {
      handoff_status: handoff.status,
      handoff_target: handoff.handoff,
      handoff_confidence: handoff.confidence,
      signal_names: handoff.signals.map((s) => s.signal),
    },
  }
}

/**
 * Best-effort write of a Task State Memory entry from a handoff block.
 * Never throws — write failures are logged but do not disrupt the
 * existing handoff flow.
 */
function ensureMemoryDir(directory: string): void {
  const memoryDir = join(directory, PROJECT_MEMORY_DIR)
  if (!existsSync(memoryDir)) {
    mkdirSync(memoryDir, { recursive: true })
  }
}

function tryWriteTaskStateForHandoff(
  handoff: HandoffBlock,
  directory: string,
  sessionId: string,
): void {
  try {
    ensureMemoryDir(directory)
    const entry = mapHandoffToTaskEntry(handoff, sessionId)
    const written = appendTaskEntry(directory, entry)
    if (written) {
      log("handoff-task-state-write: Appended task state entry", {
        taskId: entry.id,
        status: entry.status,
        action: entry.action,
        sessionId,
      })
    }
  } catch (error) {
    log("handoff-task-state-write: Failed to write task state entry", {
      sessionId,
      handoffStatus: handoff.status,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Best-effort write of a Decision Log entry from a handoff block.
 * Never throws — write failures are logged but do not disrupt the
 * existing handoff flow. Returns early if the handoff does not
 * contain decision-like content.
 */
function tryWriteDecisionLogForHandoff(
  handoff: HandoffBlock,
  directory: string,
  sessionId: string,
): void {
  try {
    ensureMemoryDir(directory)
    const entry = mapHandoffToDecisionEntry(handoff, sessionId)
    if (!entry) return
    const written = appendDecisionEntry(directory, entry)
    if (written) {
      log("handoff-decision-log-write: Appended decision log entry", {
        decisionId: entry.id,
        impactArea: entry.impact_area,
        sessionId,
      })
    }
  } catch (error) {
    log("handoff-decision-log-write: Failed to write decision log entry", {
      sessionId,
      handoffStatus: handoff.status,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Best-effort write of a quality history entry from handoff quality notes.
 * Builds a minimal QualityGateReport to reuse the existing writer.
 * Never throws — write failures are logged but do not disrupt handoff flow.
 */
function tryWriteQualityForHandoff(
  handoff: HandoffBlock,
  directory: string,
): void {
  if (!handoff.qualityNotes) return

  try {
    const report: QualityGateReport = {
      results: [{
        kind: "handoff_quality_note",
        passed: true,
        command: "handoff",
        exitCode: 0,
        stdout: handoff.qualityNotes,
        stderr: "",
        message: handoff.qualityNotes,
        skipped: false,
      }],
      allPassed: true,
      passedCount: 1,
      failedCount: 0,
      skippedCount: 0,
    }
    writeQualityHistory(directory, report)
  } catch (error) {
    log("handoff-quality-write: Failed to write quality history entry", {
      handoffStatus: handoff.status,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Best-effort risk detection from handoff changed files.
 * Uses the existing risk-detection rules to auto-detect risks.
 * Never throws.
 */
function tryDetectRisksForHandoff(
  handoff: HandoffBlock,
  directory: string,
): void {
  const changedPaths = handoff.changedFiles.map((f) => f.path)
  if (changedPaths.length === 0) return

  try {
    updateRiskProfile(directory, changedPaths)
  } catch (error) {
    log("handoff-risk-detect: Failed to update risk profile", {
      changedCount: changedPaths.length,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * Best-effort change impact map update from handoff changed files.
 * Appends entries to file-map.md under ## Change Impact Map.
 * Never throws.
 */
function tryWriteChangeImpactForHandoff(
  handoff: HandoffBlock,
  directory: string,
  sessionId: string,
): void {
  const changedPaths = handoff.changedFiles.map((f) => f.path)
  if (changedPaths.length === 0) return

  try {
    appendChangeImpactEntries(directory, changedPaths, "modified", sessionId)
  } catch (error) {
    log("handoff-change-impact: Failed to append change impact entries", {
      changedCount: changedPaths.length,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

// ─── 7. Combined extraction + persistence (for use in execution paths) ─────

/**
 * Process a completed agent's text response end-to-end:
 * 1. Extract handoff metadata
 * 2. Persist to `.omo/hecateq/state.json` (canonical source of truth)
 * 3. Persist to run-continuation marker (backward-compatible fallback)
 * 4. Persist to Boulder state if an active work exists (backward-compatible fallback)
 *
 * This is best-effort: never throws. Returns the extracted HandoffBlock
 * if found, or null if no handoff was present.
 */
export function processHandoffInAgentResponse(
  textContent: string,
  directory: string,
  sessionId: string,
): HandoffBlock | null {
  try {
    const handoff = extractHandoffFromAgentResponse(textContent)
    if (!handoff) return null

    // Persist to `.omo/hecateq/state.json` — canonical write path
    recordHandoffToOmoState(directory, handoff)

    // Persist to run-continuation marker — backward-compatible fallback
    persistHandoffToContinuationMarker(directory, sessionId, handoff)

    // Persist to Boulder state if an active work exists — backward-compatible fallback
    try {
      const state = readBoulderState(directory)
      if (state?.active_work_id) {
        persistHandoffToBoulderSession(directory, state.active_work_id, handoff)
      }
    } catch {
      // Boulder state not available — skip
    }

    // Persist to Task State Memory (tasks.jsonl) — best-effort, non-blocking
    tryWriteTaskStateForHandoff(handoff, directory, sessionId)

    // Persist to Decision Log (decisions.jsonl) — best-effort, only when decision-like content exists
    tryWriteDecisionLogForHandoff(handoff, directory, sessionId)

    // Persist quality notes to quality-history.md — best-effort
    tryWriteQualityForHandoff(handoff, directory)

    // Auto-detect risks from changed files — best-effort
    tryDetectRisksForHandoff(handoff, directory)

    // Append change impact map entries for changed files — best-effort
    tryWriteChangeImpactForHandoff(handoff, directory, sessionId)

    return handoff
  } catch {
    // Best-effort: never fail the caller
    return null
  }
}

export { HECATEQ_HANDOFF_TASK_KEY }
