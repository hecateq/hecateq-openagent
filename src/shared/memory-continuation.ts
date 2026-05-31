import { existsSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

import { writeFileAtomically } from "./write-file-atomically"
import { log } from "./logger"
import { PROJECT_MEMORY_DIR } from "./memory-bootstrap"
import { readManifest } from "./memory-manifest"
import type { MemoryManifest } from "./memory-manifest"
import type { QualityGateReport } from "./memory-quality-writer"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const CONTINUATION_FILENAME = "continuation.json" as const
export const CONTINUATION_SCHEMA_VERSION = 1

/** Maximum number of touched_paths to store in a continuation. */
const MAX_TOUCHED_PATHS = 50
/** Maximum length of next_actions entries. */
const MAX_NEXT_ACTION_LENGTH = 200
/** Maximum characters for objective field. */
const MAX_OBJECTIVE_LENGTH = 500
/** Maximum characters for notes field. */
const MAX_NOTES_LENGTH = 500

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ContinuationState = "missing" | "fresh" | "stale"

export interface ContinuationSourceHashes {
  [fileName: string]: string
}

export interface ContinuationWorkState {
  objective: string
  status: "active" | "paused" | "done"
  primary_task: {
    ref: string
    title: string
    state: "next" | "blocked" | "done"
  }
  branch: string | null
  base_ref: string | null
}

export interface ContinuationResumePlan {
  must_read: Array<{ path: string; reason: string }>
  next_actions: string[]
  touched_paths: string[]
  blockers: string[]
  verification_pending: string[]
}

export interface ContinuationHandoff {
  from_harness: string
  to_harness: string | null
  reason: string
  notes: string
}

/**
 * Portable continuation payload.
 *
 * This is a bounded, machine-readable snapshot of "what to do next"
 * designed for cross-harness resumption. It should be small enough to
 * inject into compact context injection (typically < 2KB).
 */
export interface MemoryContinuation {
  schema_version: number
  state_revision: number
  updated_at: string
  updated_by_agent?: string
  updated_by_harness?: string
  updated_by_session?: string
  source_manifest_revision: number
  source_hashes: ContinuationSourceHashes
  work_state: ContinuationWorkState
  resume_plan: ContinuationResumePlan
  handoff: ContinuationHandoff
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve the full path to continuation.json for a given project root. */
export function getContinuationPath(projectRoot: string): string {
  return join(projectRoot, PROJECT_MEMORY_DIR, CONTINUATION_FILENAME)
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  return value.slice(0, maxLength - 3) + "..."
}

function truncatePaths(paths: string[], maxCount: number): string[] {
  return paths.slice(0, maxCount)
}

function truncateActions(actions: string[], maxLength: number): string[] {
  return actions.map((action) => truncate(action, maxLength))
}

// ---------------------------------------------------------------------------
// Read / Write
// ---------------------------------------------------------------------------

/**
 * Read and parse the continuation file.
 * Returns `null` if missing, invalid JSON, or wrong schema_version.
 */
export function readContinuation(projectRoot: string): MemoryContinuation | null {
  const path = getContinuationPath(projectRoot)
  if (!existsSync(path)) return null

  try {
    const raw = readFileSync(path, "utf-8")
    const parsed: unknown = JSON.parse(raw)
    return validateContinuation(parsed)
  } catch {
    log("memory-continuation: Failed to parse continuation.json", { projectRoot })
    return null
  }
}

/**
 * Validate an unknown object as a MemoryContinuation.
 * Returns null on structural failure.
 */
export function validateContinuation(raw: unknown): MemoryContinuation | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== "object" || Array.isArray(raw)) return null

  const c = raw as Record<string, unknown>

  if (typeof c.schema_version !== "number" || c.schema_version < 1) return null
  if (typeof c.state_revision !== "number") return null
  if (typeof c.updated_at !== "string") return null
  if (typeof c.work_state !== "object" || c.work_state === null) return null
  if (typeof c.resume_plan !== "object" || c.resume_plan === null) return null
  if (typeof c.handoff !== "object" || c.handoff === null) return null

  return c as unknown as MemoryContinuation
}

/**
 * Write a continuation file atomically. Truncates long fields to keep
 * the payload small.
 */
export function writeContinuation(
  projectRoot: string,
  continuation: MemoryContinuation,
): void {
  const path = getContinuationPath(projectRoot)

  // Enforce bounded size by truncating free-form fields
  const bounded: MemoryContinuation = {
    ...continuation,
    state_revision: (continuation.state_revision ?? 0) + 1,
    updated_at: new Date().toISOString(),
    work_state: {
      ...continuation.work_state,
      objective: truncate(continuation.work_state.objective, MAX_OBJECTIVE_LENGTH),
    },
    resume_plan: {
      ...continuation.resume_plan,
      touched_paths: truncatePaths(continuation.resume_plan.touched_paths, MAX_TOUCHED_PATHS),
      next_actions: truncateActions(continuation.resume_plan.next_actions, MAX_NEXT_ACTION_LENGTH),
    },
    handoff: {
      ...continuation.handoff,
      notes: truncate(continuation.handoff.notes, MAX_NOTES_LENGTH),
    },
  }

  const json = JSON.stringify(bounded, null, 2) + "\n"
  writeFileAtomically(path, json)
}

// ---------------------------------------------------------------------------
// Staleness check
// ---------------------------------------------------------------------------

/**
 * Check whether a continuation is still fresh against the current manifest.
 *
 * The freshness rule: if ANY source markdown hash in the continuation's
 * `source_hashes` differs from the current `memory.json` file entry hash,
 * the continuation is stale.
 *
 * Returns "missing" if no continuation exists, "fresh" if all hashes match,
 * or "stale" if any hash has diverged.
 */
export function computeContinuationState(
  projectRoot: string,
  manifest: MemoryManifest,
): ContinuationState {
  const continuation = readContinuation(projectRoot)
  if (!continuation) return "missing"

  const sourceHashes = continuation.source_hashes
  // Empty source_hashes is valid — means all source files were placeholders
  if (!sourceHashes) return "fresh"

  for (const [fileName, expectedHash] of Object.entries(sourceHashes)) {
    const entry = manifest.files[fileName]
    if (!entry) return "stale" // file removed
    if (entry.content_hash !== expectedHash) return "stale" // content changed
  }

  return "fresh"
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export interface BuildContinuationInput {
  objective: string
  primaryTaskRef: string
  primaryTaskTitle: string
  primaryTaskState: "next" | "blocked" | "done"
  nextActions: string[]
  touchedPaths: string[]
  blockers: string[]
  verificationPending: string[]
  mustRead: Array<{ path: string; reason: string }>
  branch: string | null
  fromHarness: string
  handoffReason: string
  handoffNotes: string
  updatedByAgent?: string
  updatedBySession?: string
  manifest: MemoryManifest
}

/**
 * Build a bounded continuation payload from structured fields.
 * All free-form fields are truncated to keep the payload small.
 */
export function buildContinuation(
  manifestRevision: number,
  input: BuildContinuationInput,
): MemoryContinuation {
  const now = new Date().toISOString()

  // Build source_hashes from manifest entries
  const sourceHashes: ContinuationSourceHashes = {}
  for (const [fileName, entry] of Object.entries(input.manifest.files)) {
    if (!entry.is_placeholder) {
      sourceHashes[fileName] = entry.content_hash
    }
  }

  return {
    schema_version: CONTINUATION_SCHEMA_VERSION,
    state_revision: 1,
    updated_at: now,
    updated_by_agent: input.updatedByAgent,
    updated_by_harness: input.fromHarness,
    updated_by_session: input.updatedBySession,
    source_manifest_revision: manifestRevision,
    source_hashes: sourceHashes,
    work_state: {
      objective: truncate(input.objective, MAX_OBJECTIVE_LENGTH),
      status: "active",
      primary_task: {
        ref: input.primaryTaskRef,
        title: truncate(input.primaryTaskTitle, MAX_NEXT_ACTION_LENGTH),
        state: input.primaryTaskState,
      },
      branch: input.branch,
      base_ref: null,
    },
    resume_plan: {
      must_read: input.mustRead.slice(0, 5),
      next_actions: truncateActions(input.nextActions, MAX_NEXT_ACTION_LENGTH),
      touched_paths: truncatePaths(input.touchedPaths, MAX_TOUCHED_PATHS),
      blockers: input.blockers.slice(0, 10),
      verification_pending: input.verificationPending.slice(0, 10),
    },
    handoff: {
      from_harness: input.fromHarness,
      to_harness: null,
      reason: input.handoffReason,
      notes: truncate(input.handoffNotes, MAX_NOTES_LENGTH),
    },
  }
}

// ---------------------------------------------------------------------------
// Summary (for compact injection)
// ---------------------------------------------------------------------------

/**
 * Build a compact one-line summary of the continuation state, suitable
 * for injection into compact context blocks.
 *
 * Returns null if no continuation exists or it is stale.
 */
export function buildContinuationSummary(
  projectRoot: string,
  manifest: MemoryManifest,
): string | null {
  const continuation = readContinuation(projectRoot)
  if (!continuation) return null

  const state = computeContinuationState(projectRoot, manifest)
  if (state === "stale") return null

  const ws = continuation.work_state
  const rp = continuation.resume_plan

  const parts: string[] = []
  parts.push(`Continuation state: ${state}`)
  parts.push(`Objective: ${ws.objective.slice(0, 120)}`)
  parts.push(`Primary task: ${ws.primary_task.title.slice(0, 120)} (${ws.primary_task.state})`)
  if (rp.next_actions.length > 0) {
    parts.push(`Next: ${rp.next_actions.slice(0, 3).join("; ")}`)
  }
  if (rp.blockers.length > 0) {
    parts.push(`Blockers: ${rp.blockers.join(", ")}`)
  }

  return parts.join("\n")
}

// ---------------------------------------------------------------------------
// Auto-update functions
// ---------------------------------------------------------------------------

/**
 * Update continuation after a quality gate run.
 * - Updates `verification_pending` with failed gates
 * - Prepends fix actions to `next_actions` if failures exist
 * - Appends gate summary to `handoff.notes`
 *
 * If no continuation exists, a minimal one is created from the manifest.
 * If the manifest is missing, logs a warning and returns.
 */
export function updateContinuationAfterQualityGate(
  projectRoot: string,
  report: QualityGateReport,
): void {
  const manifest = readManifest(projectRoot)
  if (!manifest) {
    log("memory-continuation: Cannot update after quality gate — manifest missing", { projectRoot })
    return
  }

  let continuation = readContinuation(projectRoot)

  if (!continuation) {
    const failedGates = report.results.filter((r) => !r.passed && !r.skipped)
    continuation = buildContinuation(manifest.manifest_revision ?? 1, {
      objective: "Quality gate verification",
      primaryTaskRef: "",
      primaryTaskTitle: "Quality gates",
      primaryTaskState: report.allPassed ? "done" : "blocked",
      nextActions: failedGates.map((r) => `Fix ${r.kind}: ${r.message}`),
      touchedPaths: [],
      blockers: failedGates.map((r) => `${r.kind} gate failed: ${r.message}`),
      verificationPending: failedGates.map((r) => r.kind),
      mustRead: [],
      branch: null,
      fromHarness: "hecateq",
      handoffReason: "Quality gate run",
      handoffNotes: "",
      manifest,
    })
  }

  const failedGates = report.results.filter((r) => !r.passed && !r.skipped)

  continuation.resume_plan.verification_pending = failedGates.map((r) => r.kind)

  if (failedGates.length > 0) {
    const fixActions = failedGates.map((r) => `Fix ${r.kind}: ${r.message}`)
    continuation.resume_plan.next_actions = [
      ...fixActions,
      ...continuation.resume_plan.next_actions,
    ]
  }

  const gateSummary = report.results
    .map((r) => `${r.kind}: ${r.skipped ? "SKIPPED" : r.passed ? "PASS" : "FAIL"}`)
    .join(", ")
  const notesLine = `Quality gates: ${gateSummary} (${report.passedCount}/${report.results.length} passed)`
  continuation.handoff.notes = continuation.handoff.notes
    ? `${continuation.handoff.notes}\n${notesLine}`
    : notesLine

  writeContinuation(projectRoot, continuation)
}

/**
 * Update continuation after a task completes.
 * - Updates `work_state.objective` and `work_state.status`
 * - Merges new `touchedPaths` (deduplicated)
 * - Prepends `nextActions` and `blockers`
 *
 * If no continuation exists, a minimal one is created from the manifest.
 * If the manifest is missing, logs a warning and returns.
 */
export function updateContinuationAfterTaskCompletion(
  projectRoot: string,
  taskResult: {
    objective: string
    status: "done" | "blocked"
    touchedPaths: string[]
    nextActions: string[]
    blockers: string[]
  },
): void {
  const manifest = readManifest(projectRoot)
  if (!manifest) {
    log("memory-continuation: Cannot update after task completion — manifest missing", { projectRoot })
    return
  }

  let continuation = readContinuation(projectRoot)

  if (!continuation) {
    continuation = buildContinuation(manifest.manifest_revision ?? 1, {
      objective: taskResult.objective,
      primaryTaskRef: "",
      primaryTaskTitle: taskResult.objective,
      primaryTaskState: taskResult.status === "done" ? "done" : "blocked",
      nextActions: taskResult.nextActions,
      touchedPaths: taskResult.touchedPaths,
      blockers: taskResult.blockers,
      verificationPending: [],
      mustRead: [],
      branch: null,
      fromHarness: "hecateq",
      handoffReason: "Task completion",
      handoffNotes: "",
      manifest,
    })
    writeContinuation(projectRoot, continuation)
    return
  }

  if (taskResult.objective) {
    continuation.work_state.objective = taskResult.objective
  }

  continuation.work_state.status = taskResult.status === "done" ? "done" : "paused"

  const existingPaths = new Set(continuation.resume_plan.touched_paths)
  for (const path of taskResult.touchedPaths) {
    if (!existingPaths.has(path)) {
      continuation.resume_plan.touched_paths.push(path)
      existingPaths.add(path)
    }
  }

  if (taskResult.nextActions.length > 0) {
    continuation.resume_plan.next_actions = [
      ...taskResult.nextActions,
      ...continuation.resume_plan.next_actions,
    ]
  }

  if (taskResult.blockers.length > 0) {
    continuation.resume_plan.blockers = [
      ...taskResult.blockers,
      ...continuation.resume_plan.blockers,
    ]
  }

  writeContinuation(projectRoot, continuation)
}

/**
 * Update continuation after a memory file is modified.
 * Re-reads the manifest and rebuilds `source_hashes` so staleness
 * detection (`computeContinuationState`) works correctly.
 *
 * If no continuation exists, a minimal one is created from the manifest.
 * If the manifest is missing, logs a warning and returns.
 */
export function updateContinuationAfterMemoryChange(
  projectRoot: string,
  changedFile: string,
): void {
  const manifest = readManifest(projectRoot)
  if (!manifest) {
    log("memory-continuation: Cannot update after memory change — manifest missing", { projectRoot })
    return
  }

  let continuation = readContinuation(projectRoot)

  if (!continuation) {
    continuation = buildContinuation(manifest.manifest_revision ?? 1, {
      objective: "",
      primaryTaskRef: "",
      primaryTaskTitle: "",
      primaryTaskState: "next",
      nextActions: [],
      touchedPaths: [changedFile],
      blockers: [],
      verificationPending: [],
      mustRead: [],
      branch: null,
      fromHarness: "hecateq",
      handoffReason: "Memory file updated",
      handoffNotes: `Memory file changed: ${changedFile}`,
      manifest,
    })
    writeContinuation(projectRoot, continuation)
    return
  }

  const sourceHashes: ContinuationSourceHashes = {}
  for (const [fileName, entry] of Object.entries(manifest.files)) {
    if (!entry.is_placeholder) {
      sourceHashes[fileName] = entry.content_hash
    }
  }
  continuation.source_hashes = sourceHashes
  continuation.source_manifest_revision = manifest.manifest_revision ?? continuation.source_manifest_revision

  writeContinuation(projectRoot, continuation)
}
