/**
 * Hecateq Task Evidence — typed contract (Part B1).
 *
 * Task completion must not rely only on an agent saying "done". Evidence is
 * bound to the exact runtime identity:
 *
 *   taskGraphId + taskId + attempt + executionId
 *
 * Evidence contains concise verification metadata ONLY: no full prompts, no
 * secrets, no full model responses, no huge stdout dumps, no full tool-output
 * transcripts.
 */

/** One command execution's runtime metadata (exit code / duration). */
export interface HecateqCommandEvidence {
  command: string
  exitCode?: number
  durationMs?: number
}

/** One test command's runtime summary. */
export interface HecateqTestEvidence {
  name?: string
  command?: string
  passed?: number
  failed?: number
  exitCode?: number
}

/** One verification check's outcome. */
export interface HecateqCheckEvidence {
  kind: string
  status: "passed" | "failed" | "unknown"
  detail?: string
}

/**
 * A single piece of task-bound evidence. Immutable once recorded: it is
 * written once to `.opencode/state/hecateq/evidence/{evidenceId}.json`.
 */
export interface HecateqTaskEvidence {
  evidenceId: string
  taskGraphId: string
  taskId: string
  attempt: number
  executionId: string
  agent: string
  /** ISO-8601 timestamp of when the evidence was recorded. */
  createdAt: string
  filesChanged?: string[]
  commands?: HecateqCommandEvidence[]
  tests?: HecateqTestEvidence[]
  checks?: HecateqCheckEvidence[]
}

/**
 * Freshness verdict for evidence against the current task attempt:
 *  - "fresh"    -> identity matches the current attempt
 *  - "stale"    -> belongs to the task but an older attempt/execution
 *  - "invalid"  -> does not belong to this task at all
 */
export type EvidenceFreshness = "stale" | "invalid" | "fresh"

/** Structured validation failure: kind plus human-readable reasons. */
export interface EvidenceValidationError {
  kind: "stale" | "invalid"
  reasons: string[]
}
