/**
 * Hecateq Bounded Verification Repair (Part E).
 *
 * Bounded repair lifecycle: a task gets AT MOST one automatic repair attempt
 * after an initial verifier rejection:
 *
 *   implementation attempt 1
 *     -> verifier
 *     -> REJECT / INSUFFICIENT_EVIDENCE
 *     -> repair attempt 2
 *     -> verifier final
 *
 * If the final verifier rejects again the task is BLOCKED and handed back to
 * Hecateq God. Infinite loops are impossible: the verifier runs at most
 * `maxAttempts` times (default 2).
 *
 * This module is pure orchestration logic. It NEVER spawns a verifier as a
 * background task and NEVER polls; it accepts a `RunVerifier` callback so the
 * caller can wire Runtime Continuity V1 (Part F: WAITING + completion event +
 * parent wake) underneath.
 */

import type { HecateqTaskEvidence } from "./evidence-types"
import type { HecateqVerificationResult } from "./verifier-routing"
import { recordVerificationResult } from "./verifier-routing"

/** Default bounded retry cap: implementation attempt 1 + repair attempt 2. */
const DEFAULT_MAX_VERIFIER_ATTEMPTS = 2

export interface HecateqBoundedRepairConfig {
  taskGraphId: string
  taskId: string
  /** Bounded retry cap (default 2: implementation attempt + one repair). */
  maxAttempts?: number
}

export interface HecateqBoundedRepairOutcome {
  /** The attempt whose verification produced this outcome (1 or 2). */
  attempt: number
  status: "verified" | "blocked" | "needs_repair"
  verification: HecateqVerificationResult
  evidence: HecateqTaskEvidence
  /**
   * "repair" is reserved for caller-driven repair signals (e.g. a Part G
   * planner gate handoff); the bounded loop itself emits "done" or "block".
   */
  nextAction?: "repair" | "block" | "done"
}

export type HecateqVerificationExecutor = (input: {
  evidence: HecateqTaskEvidence
  taskGraphId: string
  taskId: string
  attempt: number
  executionId: string
}) => Promise<HecateqVerificationResult>

export type HecateqRepairExecutor = (input: {
  evidence: HecateqTaskEvidence
  verification: HecateqVerificationResult
  attempt: number
}) => Promise<HecateqTaskEvidence>

export interface HecateqBoundedRepairInput {
  taskGraphId: string
  taskId: string
  executionId: string
  agent: string
  evidence: HecateqTaskEvidence
  RunVerifier: HecateqVerificationExecutor
  RunRepair?: HecateqRepairExecutor
  Signal?: AbortSignal
  /** Additive: override the default bounded cap (default 2). */
  maxAttempts?: number
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error("bounded verification repair aborted")
    error.name = "AbortError"
    throw error
  }
}

export async function runBoundedVerificationRepair(
  input: HecateqBoundedRepairInput,
): Promise<HecateqBoundedRepairOutcome> {
  const maxAttempts = Math.max(1, input.maxAttempts ?? DEFAULT_MAX_VERIFIER_ATTEMPTS)

  throwIfAborted(input.Signal)
  const firstVerification = await input.RunVerifier({
    evidence: input.evidence,
    taskGraphId: input.taskGraphId,
    taskId: input.taskId,
    attempt: 1,
    executionId: input.executionId,
  })
  recordVerificationResult(firstVerification)

  if (firstVerification.status === "verified") {
    return {
      attempt: 1,
      status: "verified",
      verification: firstVerification,
      evidence: input.evidence,
      nextAction: "done",
    }
  }

  const actionable =
    firstVerification.status === "rejected" ||
    firstVerification.status === "insufficient_evidence"
  if (!actionable || maxAttempts < 2) {
    return {
      attempt: 1,
      status: "blocked",
      verification: firstVerification,
      evidence: input.evidence,
      nextAction: "block",
    }
  }

  throwIfAborted(input.Signal)
  const repairedEvidence = input.RunRepair
    ? await input.RunRepair({
        evidence: input.evidence,
        verification: firstVerification,
        attempt: 2,
      })
    : input.evidence

  throwIfAborted(input.Signal)
  const finalVerification = await input.RunVerifier({
    evidence: repairedEvidence,
    taskGraphId: input.taskGraphId,
    taskId: input.taskId,
    attempt: 2,
    executionId: input.executionId,
  })
  recordVerificationResult(finalVerification)

  if (finalVerification.status === "verified") {
    return {
      attempt: 2,
      status: "verified",
      verification: finalVerification,
      evidence: repairedEvidence,
      nextAction: "done",
    }
  }
  return {
    attempt: 2,
    status: "blocked",
    verification: finalVerification,
    evidence: repairedEvidence,
    nextAction: "block",
  }
}
