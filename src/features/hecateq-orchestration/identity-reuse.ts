/**
 * Hecateq Identity Reuse — canonical identity chain (Part J) + handoff
 * signal integration (Part K).
 *
 * Part J: the new Evidence / Verification / Planner systems MUST reuse the
 * existing `HecateqExecutionIdentity` contract. No second execution identity
 * system is created. The canonical chain is:
 *
 *   Task Graph → Task → Attempt → HecateqExecutionIdentity → Evidence → Verification Result
 *
 * Part K: the canonical handoff format is preserved
 * (STATUS / SIGNALS_EMITTED / HANDOFF / CONFIDENCE / QUALITY_NOTES /
 * NEXT_RECOMMENDED_AGENT). Verification results may be carried as signals —
 * NEVER as full evidence bodies. Handoff payloads only carry references
 * (evidenceId, taskId, executionId, ...).
 *
 * All factory functions are pure: they return typed structures and do not
 * write to disk. Persistence and ledger events stay in the existing
 * recorders (`recordEvidence` appends `evidence_recorded` runtime events;
 * `recordVerificationResult` appends `handoff_created` events).
 */

import type { HecateqExecutionIdentity } from "./runtime-continuity-types"
import type { HecateqTaskEvidence } from "./evidence-types"
import type { HecateqVerificationResult, HecateqVerificationStatus } from "./verifier-routing"
import type {
  HecateqPlannerActivationAssessment,
  HecateqPlannerDecision,
  HecateqRiskLevel,
} from "./planner-gate"
import type { HandoffSignal } from "./handoff-parser"

// ─── Types (Part J) ─────────────────────────────────────────────────────────

/**
 * The 4-field canonical identity chain extracted from
 * `HecateqExecutionIdentity`. `agent` and `startedAt` stay on the source
 * identity; the chain only carries the correlation keys shared by evidence
 * and verification records.
 */
export interface HecateqCanonicalIdentityChain {
  taskGraphId: string
  taskId: string
  attempt: number
  executionId: string
}

// ─── Types (Part K) ─────────────────────────────────────────────────────────

/** Handoff signal carrying a verification result reference (no evidence body). */
export interface HecateqVerificationHandoffSignal {
  signal: "verification_complete"
  payload: {
    task_id: string
    execution_id: string
    status: HecateqVerificationStatus
    evidenceId: string
  }
}

/** Handoff signal carrying a planner gate evaluation (decision + reasons only). */
export interface HecateqPlannerGateHandoffSignal {
  signal: "planner_gate_evaluated"
  payload: {
    decision: HecateqPlannerDecision
    risk: HecateqRiskLevel
    uncertainty: HecateqRiskLevel
    reasons: string[]
  }
}

/** Handoff signal carrying an evidence record reference (no evidence body). */
export interface HecateqEvidenceRecordedHandoffSignal {
  signal: "evidence_recorded"
  payload: {
    evidenceId: string
    taskId: string
    attempt: number
    executionId: string
  }
}

export type HecateqEvidenceSignal =
  | HecateqVerificationHandoffSignal
  | HecateqPlannerGateHandoffSignal
  | HecateqEvidenceRecordedHandoffSignal

export interface HecateqCanonicalHandoffBlockInput {
  status: "DONE" | "PARTIAL" | "BLOCKED"
  signals: HandoffSignal[]
  target?: string
  confidence: number
  qualityNotes?: string
  nextRecommendedAgent?: string
}

// ─── Identity chain (Part J) ────────────────────────────────────────────────

/**
 * Extract the canonical identity chain from an existing
 * `HecateqExecutionIdentity`. Reuses the identity — never creates a parallel
 * execution identity system.
 */
export function buildCanonicalIdentityChain(
  identity: HecateqExecutionIdentity,
): HecateqCanonicalIdentityChain {
  return {
    taskGraphId: identity.taskGraphId,
    taskId: identity.taskId,
    attempt: identity.attempt,
    executionId: identity.executionId,
  }
}

/**
 * Assert that evidence belongs to the exact runtime identity. Throws with the
 * mismatching field names when any correlation key differs. No-op on match.
 */
export function assertIdentityChainConsistency(
  evidence: HecateqTaskEvidence,
  identity: HecateqExecutionIdentity,
): void {
  const mismatches: string[] = []
  if (evidence.taskGraphId !== identity.taskGraphId) mismatches.push("taskGraphId")
  if (evidence.taskId !== identity.taskId) mismatches.push("taskId")
  if (evidence.attempt !== identity.attempt) mismatches.push("attempt")
  if (evidence.executionId !== identity.executionId) mismatches.push("executionId")
  if (mismatches.length > 0) {
    throw new Error(`Evidence identity chain mismatch on: ${mismatches.join(", ")}`)
  }
}

// ─── Handoff signals (Part K) ───────────────────────────────────────────────

/**
 * Build a `verification_complete` handoff signal. Payload carries only
 * references (task_id, execution_id, status, evidenceId) — the full evidence
 * body is NEVER embedded in a handoff.
 */
export function createHandoffSignalForVerificationResult(
  verification: HecateqVerificationResult,
  evidence: HecateqTaskEvidence,
): HecateqVerificationHandoffSignal {
  return {
    signal: "verification_complete",
    payload: {
      task_id: verification.taskId,
      execution_id: verification.executionId,
      status: verification.status,
      evidenceId: evidence.evidenceId,
    },
  }
}

/**
 * Build a `planner_gate_evaluated` handoff signal. Payload carries the
 * decision, risk levels and reasons — no evidence body. The `context`
 * argument is accepted for call-site correlation and is reserved for future
 * routing needs; it is intentionally not embedded in the payload.
 */
export function createHandoffSignalForPlannerEvaluation(
  assessment: HecateqPlannerActivationAssessment,
  context: { taskGraphId?: string; taskId?: string },
): HecateqPlannerGateHandoffSignal {
  void context
  return {
    signal: "planner_gate_evaluated",
    payload: {
      decision: assessment.decision,
      risk: assessment.risk,
      uncertainty: assessment.uncertainty,
      reasons: assessment.reasons,
    },
  }
}

/**
 * Build an `evidence_recorded` handoff signal. Payload carries only the
 * evidence reference (evidenceId, taskId, attempt, executionId) — never the
 * evidence body itself.
 */
export function createHandoffSignalForEvidenceRecorded(
  evidence: HecateqTaskEvidence,
): HecateqEvidenceRecordedHandoffSignal {
  return {
    signal: "evidence_recorded",
    payload: {
      evidenceId: evidence.evidenceId,
      taskId: evidence.taskId,
      attempt: evidence.attempt,
      executionId: evidence.executionId,
    },
  }
}

/**
 * Serialize a canonical handoff block with all six fields:
 * STATUS / SIGNALS_EMITTED / HANDOFF / CONFIDENCE / QUALITY_NOTES /
 * NEXT_RECOMMENDED_AGENT. Signals are serialized as a compact JSON array.
 */
export function createCanonicalHandoffBlock(
  input: HecateqCanonicalHandoffBlockInput,
): string {
  const lines: string[] = [
    `STATUS: ${input.status}`,
    `SIGNALS_EMITTED: ${JSON.stringify(input.signals)}`,
    `HANDOFF: ${input.target ?? "return_to_caller"}`,
    `CONFIDENCE: ${input.confidence}`,
    `QUALITY_NOTES: ${input.qualityNotes ?? ""}`,
    `NEXT_RECOMMENDED_AGENT: ${input.nextRecommendedAgent ?? ""}`,
  ]
  return lines.join("\n")
}
