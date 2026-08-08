/**
 * Hecateq Completion Gate (Part D) — separates "execution completed" from
 * "task verified".
 *
 *   Execution → COMPLETED → Evidence captured → qa-test-engineer → VERIFIED
 *
 * A task is only success once a verification result with status "verified"
 * exists AND the evidence it is evaluated against is fresh for that
 * identity (taskGraphId + taskId + attempt + executionId). All functions
 * are pure: no state, no I/O.
 */

import type { HecateqTaskEvidence } from "./evidence-types"
import { validateEvidenceFreshness } from "./evidence-store"
import type { HecateqProgressState } from "./runtime-continuity-types"
import type { HecateqVerificationResult } from "./verifier-routing"

// ─── Types ───────────────────────────────────────────────────────────────────

export type HecateqEvaluationStatus =
  | "verified"
  | "rejected"
  | "insufficient_evidence"
  | "stale_evidence"

/** Thrown when a task is not verified. */
export class TaskNotVerifiedError extends Error {
  readonly status: HecateqEvaluationStatus

  constructor(status: HecateqEvaluationStatus, message: string) {
    super(message)
    this.name = "TaskNotVerifiedError"
    this.status = status
  }
}

// ─── Gate functions (pure) ───────────────────────────────────────────────────

/**
 * Evaluate the gate status for one task against its evidence and
 * verification result:
 *  - no verification            -> "insufficient_evidence"
 *  - verification rejected      -> "rejected"
 *  - verification insufficient  -> "insufficient_evidence"
 *  - verification verified but evidence stale -> "stale_evidence"
 *  - verification verified + fresh evidence   -> "verified"
 */
export function evaluationStatus(
  evidence: HecateqTaskEvidence,
  verification: HecateqVerificationResult | null,
): HecateqEvaluationStatus {
  if (!verification) return "insufficient_evidence"
  if (verification.status === "rejected") return "rejected"
  if (verification.status === "insufficient_evidence") {
    return "insufficient_evidence"
  }

  const freshness = validateEvidenceFreshness({
    evidence,
    taskGraphId: verification.taskGraphId,
    taskId: verification.taskId,
    attempt: verification.attempt,
    executionId: verification.executionId,
  })
  return freshness === "fresh" ? "verified" : "stale_evidence"
}

/**
 * A task is verified ONLY when the verification status is "verified" AND
 * the evidence is fresh for that identity. Anything else is not verified.
 */
export function isTaskVerified(
  evidence: HecateqTaskEvidence,
  verification: HecateqVerificationResult | null,
): boolean {
  return evaluationStatus(evidence, verification) === "verified"
}

/**
 * Throw a `TaskNotVerifiedError` when the task is not verified. No-op when
 * the task is verified.
 */
export function assertTaskVerified(
  evidence: HecateqTaskEvidence,
  verification: HecateqVerificationResult | null,
): void {
  const status = evaluationStatus(evidence, verification)
  if (status === "verified") return
  throw new TaskNotVerifiedError(
    status,
    `Task is not verified: ${status}. Execution completion alone is not task verification (Part D).`,
  )
}

/**
 * Distinguish the two completion concepts explicitly:
 *  - `executionCompleted` — the execution reached terminal "completed".
 *  - `taskVerified` — a "verified" verification result exists.
 *
 * A completed execution WITHOUT a verification yields
 * `{ executionCompleted: true, taskVerified: false }`.
 */
export function isExecutionCompletedEqualsTaskVerified(
  executionState: HecateqProgressState,
  verification: HecateqVerificationResult | null,
): { executionCompleted: boolean; taskVerified: boolean } {
  const executionCompleted = executionState === "completed"
  const taskVerified = verification !== null && verification.status === "verified"
  return { executionCompleted, taskVerified }
}

// ─── Composite gate ──────────────────────────────────────────────────────────

/**
 * The completion gate as a single pure object. Use the standalone functions
 * when only one check is needed.
 */
export const HecateqCompletionGate = {
  isTaskVerified,
  assertTaskVerified,
  evaluationStatus,
  isExecutionCompletedEqualsTaskVerified,
}
