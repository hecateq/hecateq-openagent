import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  _setHandoffHistoryFilePathForTesting,
  loadRecentRuntimeEvents,
} from "./handoff-history"
import { evaluatePlannerGate, recordPlannerGateEvaluation } from "./planner-gate"
import type {
  HecateqPlannerActivationAssessment,
  HecateqPlannerGateInput,
} from "./planner-gate"

// ─── Shared fixtures ─────────────────────────────────────────────────────────

function makeInput(
  overrides: Partial<HecateqPlannerGateInput> = {},
): HecateqPlannerGateInput {
  return {
    taskSize: { files: 3, loc: 400, taskCount: 1 },
    domainKnown: true,
    architectureKnown: true,
    hasMultipleWorkUnits: false,
    uncertainty: "low",
    risk: "low",
    architecturalImpact: false,
    crossSystemDependencies: false,
    migrationRisk: false,
    unclearRequirements: false,
    ...overrides,
  }
}

describe("hecateq planner activation gate", () => {
  describe("evaluatePlannerGate", () => {
    test("#given low risk, low uncertainty, known domain and a single work unit #when evaluating #then delegates directly", () => {
      // given
      const input = makeInput()
      // when
      const assessment = evaluatePlannerGate(input)
      // then
      expect(assessment.decision).toBe("direct_delegate")
      expect(assessment.reasons).toEqual([
        "localized low-risk task with known domain",
      ])
      expect(assessment.recommendedAgents).toEqual([])
    })

    test("#given 50 files, 10000 LOC and 100 tasks #when evaluating #then never planner_required (size is not a heuristic)", () => {
      // given
      const input = makeInput({
        taskSize: { files: 50, loc: 10000, taskCount: 100 },
      })
      // when
      const assessment = evaluatePlannerGate(input)
      // then
      expect(assessment.decision).not.toBe("planner_required")
      expect(assessment.decision).toBe("direct_delegate")
      expect(assessment.recommendedAgents).toEqual([])
    })

    test("#given medium uncertainty with known architecture and multiple work units #when evaluating #then god_decompose", () => {
      // given
      const input = makeInput({
        uncertainty: "medium",
        hasMultipleWorkUnits: true,
        architectureKnown: true,
        domainKnown: true,
      })
      // when
      const assessment = evaluatePlannerGate(input)
      // then
      expect(assessment.decision).toBe("god_decompose")
      expect(assessment.reasons).toEqual([
        "multiple clear work units with known architecture",
        "medium risk/uncertainty",
      ])
      expect(assessment.recommendedAgents).toEqual([])
    })

    test("#given medium risk with a single unit and unknown architecture #when evaluating #then god_decompose", () => {
      // given
      const input = makeInput({
        risk: "medium",
        hasMultipleWorkUnits: false,
        architectureKnown: false,
      })
      // when
      const assessment = evaluatePlannerGate(input)
      // then
      expect(assessment.decision).toBe("god_decompose")
      expect(assessment.reasons).toEqual(["medium risk/uncertainty"])
    })

    test("#given multiple clear work units with known architecture and low risk #when evaluating #then god_decompose", () => {
      // given
      const input = makeInput({
        hasMultipleWorkUnits: true,
        architectureKnown: true,
        domainKnown: true,
      })
      // when
      const assessment = evaluatePlannerGate(input)
      // then
      expect(assessment.decision).toBe("god_decompose")
      expect(assessment.reasons).toEqual([
        "multiple clear work units with known architecture",
      ])
    })

    test("#given high risk #when evaluating #then planner_required with strategy-analyst", () => {
      // given
      const input = makeInput({ risk: "high" })
      // when
      const assessment = evaluatePlannerGate(input)
      // then
      expect(assessment.decision).toBe("planner_required")
      expect(assessment.reasons).toContain("risk: high")
      expect(assessment.recommendedAgents).toContain("strategy-analyst")
    })

    test("#given high uncertainty #when evaluating #then planner_required with strategy-analyst", () => {
      // given
      const input = makeInput({ uncertainty: "high" })
      // when
      const assessment = evaluatePlannerGate(input)
      // then
      expect(assessment.decision).toBe("planner_required")
      expect(assessment.reasons).toContain("uncertainty: high")
      expect(assessment.recommendedAgents).toContain("strategy-analyst")
    })

    test("#given a planner_required assessment #when evaluating #then recommendedAgents include assumption-breaker and agent-contract-manager", () => {
      // given — high risk forces planner_required (Part G)
      const input = makeInput({ risk: "high" })
      // when
      const assessment = evaluatePlannerGate(input)
      // then — the planner-review pool always carries the risk/contract reviewers (Part H)
      expect(assessment.decision).toBe("planner_required")
      expect(assessment.recommendedAgents).toContain("assumption-breaker")
      expect(assessment.recommendedAgents).toContain("agent-contract-manager")
    })

    test("#given architectural impact #when evaluating #then planner_required with system-philosopher", () => {
      // given
      const input = makeInput({ architecturalImpact: true })
      // when
      const assessment = evaluatePlannerGate(input)
      // then
      expect(assessment.decision).toBe("planner_required")
      expect(assessment.reasons).toContain("architectural impact")
      expect(assessment.recommendedAgents).toContain("system-philosopher")
    })

    test("#given cross-system dependencies #when evaluating #then planner_required", () => {
      // given
      const input = makeInput({ crossSystemDependencies: true })
      // when
      const assessment = evaluatePlannerGate(input)
      // then
      expect(assessment.decision).toBe("planner_required")
      expect(assessment.reasons).toContain("cross-system dependencies")
    })

    test("#given migration risk #when evaluating #then planner_required", () => {
      // given
      const input = makeInput({ migrationRisk: true })
      // when
      const assessment = evaluatePlannerGate(input)
      // then
      expect(assessment.decision).toBe("planner_required")
      expect(assessment.reasons).toContain("migration risk")
    })

    test("#given unclear requirements #when evaluating #then planner_required", () => {
      // given
      const input = makeInput({ unclearRequirements: true })
      // when
      const assessment = evaluatePlannerGate(input)
      // then
      expect(assessment.decision).toBe("planner_required")
      expect(assessment.reasons).toContain("unclear requirements")
    })

    test("#given any planner_required input #when evaluating #then recommendedAgents never contains momus", () => {
      // given
      const inputs = [
        makeInput({ risk: "high" }),
        makeInput({ uncertainty: "high", architecturalImpact: true }),
        makeInput({ crossSystemDependencies: true, migrationRisk: true }),
        makeInput({ unclearRequirements: true }),
      ]
      // when
      const assessments = inputs.map((input) => evaluatePlannerGate(input))
      // then
      for (const assessment of assessments) {
        expect(assessment.decision).toBe("planner_required")
        expect(assessment.recommendedAgents).not.toContain("momus")
      }
    })
  })

  describe("recordPlannerGateEvaluation", () => {
    let dir: string
    let ledgerPath: string

    beforeEach(() => {
      // given a fresh temp ledger
      dir = mkdtempSync(join(tmpdir(), "hecateq-planner-gate-"))
      ledgerPath = join(
        dir,
        ".opencode",
        "state",
        "hecateq",
        "handoff-history.jsonl",
      )
      _setHandoffHistoryFilePathForTesting(ledgerPath)
    })

    afterEach(() => {
      _setHandoffHistoryFilePathForTesting(null)
      if (dir) rmSync(dir, { recursive: true, force: true })
    })

    test("#given an assessment and context #when recording #then two handoff_created events are appended with decision and reasons", () => {
      // given
      const assessment: HecateqPlannerActivationAssessment =
        evaluatePlannerGate(
          makeInput({
            risk: "medium",
            hasMultipleWorkUnits: true,
            architectureKnown: true,
            domainKnown: true,
          }),
        )
      // when
      recordPlannerGateEvaluation(assessment, {
        taskGraphId: "tg_1",
        taskId: "T3",
      })
      // then
      const events = loadRecentRuntimeEvents(10)
      const handoffEvents = events.filter(
        (event) => event.event === "handoff_created",
      )
      expect(handoffEvents).toHaveLength(2)
      expect(handoffEvents[0].task_graph_id).toBe("tg_1")
      expect(handoffEvents[0].task_id).toBe("T3")
      expect(handoffEvents[0].reason).toBe(
        "planner_gate_evaluated:god_decompose:medium:low",
      )
      expect(handoffEvents[1].reason).toBe(
        "planner_gate_reasons:multiple clear work units with known architecture|medium risk/uncertainty",
      )
      for (const event of handoffEvents) {
        expect(Number.isNaN(Date.parse(event.timestamp))).toBe(false)
      }
    })

    test("#given an assessment without graph or task ids #when recording #then events omit optional ids", () => {
      // given
      const assessment = evaluatePlannerGate(makeInput())
      // when
      recordPlannerGateEvaluation(assessment, {})
      // then
      const events = loadRecentRuntimeEvents(10)
      const handoffEvents = events.filter(
        (event) => event.event === "handoff_created",
      )
      expect(handoffEvents).toHaveLength(2)
      expect(handoffEvents[0].task_graph_id).toBeUndefined()
      expect(handoffEvents[0].task_id).toBeUndefined()
      expect(handoffEvents[0].reason).toBe(
        "planner_gate_evaluated:direct_delegate:low:low",
      )
      expect(handoffEvents[1].reason).toBe(
        "planner_gate_reasons:localized low-risk task with known domain",
      )
    })
  })
})
