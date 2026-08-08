import { describe, expect, test } from "bun:test"
import {
  buildCanonicalIdentityChain,
  assertIdentityChainConsistency,
  createHandoffSignalForVerificationResult,
  createHandoffSignalForPlannerEvaluation,
  createHandoffSignalForEvidenceRecorded,
  createCanonicalHandoffBlock,
  type HecateqCanonicalIdentityChain,
} from "./identity-reuse"
import { parseHandoffBlock } from "./handoff-parser"
import type { HecateqExecutionIdentity } from "./runtime-continuity-types"
import type { HecateqTaskEvidence } from "./evidence-types"
import type { HecateqVerificationResult } from "./verifier-routing"
import type { HecateqPlannerActivationAssessment } from "./planner-gate"

// ─── Fixtures ───────────────────────────────────────────────────────────────

const identity: HecateqExecutionIdentity = {
  executionId: "exec_abc123",
  taskGraphId: "graph_1",
  taskId: "T4",
  attempt: 2,
  agent: "hephaestus",
  startedAt: "2026-08-08T00:00:00.000Z",
}

const evidence: HecateqTaskEvidence = {
  evidenceId: "ev_999",
  taskGraphId: "graph_1",
  taskId: "T4",
  attempt: 2,
  executionId: "exec_abc123",
  agent: "hephaestus",
  createdAt: "2026-08-08T00:00:01.000Z",
  commands: [{ command: "bun test", exitCode: 0 }],
  tests: [{ command: "bun test", passed: 12, failed: 0, exitCode: 0 }],
}

const verification: HecateqVerificationResult = {
  resultId: "ver_1",
  taskGraphId: "graph_1",
  taskId: "T4",
  attempt: 2,
  executionId: "exec_abc123",
  status: "verified",
  blockers: [],
  notes: "all tests green",
}

const assessment: HecateqPlannerActivationAssessment = {
  uncertainty: "medium",
  risk: "high",
  architecturalImpact: true,
  crossSystemDependencies: true,
  migrationRisk: false,
  unclearRequirements: false,
  decision: "planner_required",
  reasons: ["cross-system dependency", "high risk"],
  recommendedAgents: ["hecateq-planner"],
}

// ─── Describe ───────────────────────────────────────────────────────────────

describe("hecateq identity reuse (Part J/K)", () => {
  // ─── buildCanonicalIdentityChain ─────────────────────────────────────────
  describe("buildCanonicalIdentityChain", () => {
    test("#given a HecateqExecutionIdentity #then extracts all 4 chain fields", () => {
      const chain: HecateqCanonicalIdentityChain = buildCanonicalIdentityChain(identity)
      expect(chain.taskGraphId).toBe("graph_1")
      expect(chain.taskId).toBe("T4")
      expect(chain.attempt).toBe(2)
      expect(chain.executionId).toBe("exec_abc123")
    })
    test("#given a HecateqExecutionIdentity #then chain does not invent new identity fields", () => {
      const chain = buildCanonicalIdentityChain(identity)
      const keys = Object.keys(chain).sort()
      expect(keys).toEqual(["attempt", "executionId", "taskGraphId", "taskId"])
    })
  })

  // ─── assertIdentityChainConsistency ──────────────────────────────────────
  describe("assertIdentityChainConsistency", () => {
    test("#given matching evidence and identity #then does not throw", () => {
      expect(() => assertIdentityChainConsistency(evidence, identity)).not.toThrow()
    })
    test("#given executionId mismatch #then throws naming the field", () => {
      const other = { ...identity, executionId: "exec_other" }
      expect(() => assertIdentityChainConsistency(evidence, other)).toThrow(/executionId/)
    })
    test("#given attempt mismatch #then throws naming the field", () => {
      const other = { ...identity, attempt: 99 }
      expect(() => assertIdentityChainConsistency(evidence, other)).toThrow(/attempt/)
    })
    test("#given taskId mismatch #then throws naming the field", () => {
      const other = { ...identity, taskId: "T9" }
      expect(() => assertIdentityChainConsistency(evidence, other)).toThrow(/taskId/)
    })
    test("#given taskGraphId mismatch #then throws naming the field", () => {
      const other = { ...identity, taskGraphId: "graph_9" }
      expect(() => assertIdentityChainConsistency(evidence, other)).toThrow(/taskGraphId/)
    })
  })

  // ─── createHandoffSignalForVerificationResult ────────────────────────────
  describe("createHandoffSignalForVerificationResult", () => {
    test("#given a verification result and evidence #then produces correct signal + payload", () => {
      const signal = createHandoffSignalForVerificationResult(verification, evidence)
      expect(signal.signal).toBe("verification_complete")
      expect(signal.payload).toEqual({
        task_id: "T4",
        execution_id: "exec_abc123",
        status: "verified",
        evidenceId: "ev_999",
      })
    })
    test("#given a verification result #then payload carries no full evidence body", () => {
      const signal = createHandoffSignalForVerificationResult(verification, evidence)
      const serialized = JSON.stringify(signal)
      expect(serialized).not.toContain("bun test")
      expect(serialized).not.toContain("passed")
      expect(serialized).not.toContain("notes")
      expect(serialized).not.toContain("blockers")
    })
  })

  // ─── createHandoffSignalForPlannerEvaluation ─────────────────────────────
  describe("createHandoffSignalForPlannerEvaluation", () => {
    test("#given a planner assessment #then produces correct signal + payload", () => {
      const signal = createHandoffSignalForPlannerEvaluation(assessment, {
        taskGraphId: "graph_1",
        taskId: "T4",
      })
      expect(signal.signal).toBe("planner_gate_evaluated")
      expect(signal.payload).toEqual({
        decision: "planner_required",
        risk: "high",
        uncertainty: "medium",
        reasons: ["cross-system dependency", "high risk"],
      })
    })
    test("#given a planner assessment #then payload carries no evidence or agent lists", () => {
      const signal = createHandoffSignalForPlannerEvaluation(assessment, {})
      const serialized = JSON.stringify(signal)
      expect(serialized).not.toContain("recommendedAgents")
      expect(serialized).not.toContain("architecturalImpact")
      expect(serialized).not.toContain("hecateq-planner")
    })
  })

  // ─── createHandoffSignalForEvidenceRecorded ──────────────────────────────
  describe("createHandoffSignalForEvidenceRecorded", () => {
    test("#given evidence #then produces correct signal + payload", () => {
      const signal = createHandoffSignalForEvidenceRecorded(evidence)
      expect(signal.signal).toBe("evidence_recorded")
      expect(signal.payload).toEqual({
        evidenceId: "ev_999",
        taskId: "T4",
        attempt: 2,
        executionId: "exec_abc123",
      })
    })
    test("#given evidence #then payload carries no evidence body", () => {
      const signal = createHandoffSignalForEvidenceRecorded(evidence)
      const serialized = JSON.stringify(signal)
      expect(serialized).not.toContain("bun test")
      expect(serialized).not.toContain("commands")
      expect(serialized).not.toContain("createdAt")
    })
  })

  // ─── createCanonicalHandoffBlock ─────────────────────────────────────────
  describe("createCanonicalHandoffBlock", () => {
    const signal = createHandoffSignalForVerificationResult(verification, evidence)
    const block = createCanonicalHandoffBlock({
      status: "DONE",
      signals: [signal],
      target: "return_to_caller",
      confidence: 0.95,
      qualityNotes: "verification passed",
      nextRecommendedAgent: "release-manager",
    })

    test("#given full input #then produces all 6 fields with proper structure", () => {
      expect(block).toContain("STATUS: DONE")
      expect(block).toContain("SIGNALS_EMITTED:")
      expect(block).toContain("HANDOFF: return_to_caller")
      expect(block).toContain("CONFIDENCE: 0.95")
      expect(block).toContain("QUALITY_NOTES: verification passed")
      expect(block).toContain("NEXT_RECOMMENDED_AGENT: release-manager")
      const lines = block.split("\n")
      expect(lines.length).toBe(6)
    })
    test("#given block #then round-trips through the canonical handoff parser", () => {
      const parsed = parseHandoffBlock(block)
      expect(parsed.status).toBe("DONE")
      expect(parsed.handoff).toBe("return_to_caller")
      expect(parsed.confidence).toBe(0.95)
      expect(parsed.signals).toHaveLength(1)
      expect(parsed.signals[0]?.signal).toBe("verification_complete")
      expect(parsed.signals[0]?.payload).toEqual({
        task_id: "T4",
        execution_id: "exec_abc123",
        status: "verified",
        evidenceId: "ev_999",
      })
    })
    test("#given block #then does not contain full evidence body, only references", () => {
      expect(block).not.toContain("bun test")
      expect(block).not.toContain("commands")
      expect(block).not.toContain("tests")
      expect(block).not.toContain("notes")
      expect(block).not.toContain("blockers")
      expect(block).toContain("ev_999")
      expect(block).toContain("T4")
      expect(block).toContain("exec_abc123")
    })
    test("#given omitted optional fields #then emits empty canonical lines", () => {
      const minimal = createCanonicalHandoffBlock({
        status: "PARTIAL",
        signals: [],
        confidence: 0.5,
      })
      expect(minimal).toContain("STATUS: PARTIAL")
      expect(minimal).toContain("HANDOFF: return_to_caller")
      expect(minimal).toContain("QUALITY_NOTES: ")
      expect(minimal).toContain("NEXT_RECOMMENDED_AGENT: ")
      expect(minimal.split("\n")).toHaveLength(6)
    })
  })
})
