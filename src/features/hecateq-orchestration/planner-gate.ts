/**
 * Hecateq Planner Activation Gate.
 *
 * Decides when the Hecateq Planner must be invoked before a task is
 * delegated. The gate inspects risk, uncertainty, and cross-cutting
 * concerns only. Raw task size (files / LOC / task count) is carried in
 * the input but deliberately excluded from the decision to forbid
 * size-based heuristics.
 *
 *   planner_required -> assumption-breaker + agent-contract-manager
 *   god_decompose    -> Hecateq God decomposes into clear work units
 *   direct_delegate  -> delegate straight to the target agent
 */

import { appendRuntimeEvent } from "./handoff-history"
import { filterMomus } from "./momus-exclusion"

// ─── Types ───────────────────────────────────────────────────────────────────

export type HecateqRiskLevel = "low" | "medium" | "high"

export type HecateqPlannerDecision =
  | "direct_delegate"
  | "god_decompose"
  | "planner_required"

export interface HecateqPlannerActivationAssessment {
  uncertainty: HecateqRiskLevel
  risk: HecateqRiskLevel
  architecturalImpact: boolean
  crossSystemDependencies: boolean
  migrationRisk: boolean
  unclearRequirements: boolean
  decision: HecateqPlannerDecision
  reasons: string[]
  recommendedAgents: string[]
}

export interface HecateqPlannerGateInput {
  taskSize: {
    files: number
    loc: number
    taskCount: number
  }
  domainKnown: boolean
  architectureKnown: boolean
  hasMultipleWorkUnits: boolean
  uncertainty: HecateqRiskLevel
  risk: HecateqRiskLevel
  architecturalImpact: boolean
  crossSystemDependencies: boolean
  migrationRisk: boolean
  unclearRequirements: boolean
}

// ─── Gate evaluation ─────────────────────────────────────────────────────────

/**
 * Evaluate the planner activation gate for one task. Pure: no state, no
 * I/O. `taskSize` is accepted but never consulted, so a large task can
 * never force planner activation by itself.
 */
export function evaluatePlannerGate(
  input: HecateqPlannerGateInput,
): HecateqPlannerActivationAssessment {
  const base = {
    uncertainty: input.uncertainty,
    risk: input.risk,
    architecturalImpact: input.architecturalImpact,
    crossSystemDependencies: input.crossSystemDependencies,
    migrationRisk: input.migrationRisk,
    unclearRequirements: input.unclearRequirements,
  }

  if (requiresPlanner(input)) {
    return {
      ...base,
      decision: "planner_required",
      reasons: plannerRequiredReasons(input),
      recommendedAgents: recommendedAgentsForPlanner(input),
    }
  }

  if (godDecomposeCondition(input)) {
    return {
      ...base,
      decision: "god_decompose",
      reasons: godDecomposeReasons(input),
      recommendedAgents: [],
    }
  }

  return {
    ...base,
    decision: "direct_delegate",
    reasons: ["localized low-risk task with known domain"],
    recommendedAgents: [],
  }
}

function requiresPlanner(input: HecateqPlannerGateInput): boolean {
  return (
    input.risk === "high" ||
    input.uncertainty === "high" ||
    input.architecturalImpact ||
    input.crossSystemDependencies ||
    input.migrationRisk ||
    input.unclearRequirements
  )
}

function godDecomposeCondition(input: HecateqPlannerGateInput): boolean {
  return (
    input.risk === "medium" ||
    input.uncertainty === "medium" ||
    (input.hasMultipleWorkUnits &&
      input.architectureKnown &&
      input.domainKnown)
  )
}

function plannerRequiredReasons(input: HecateqPlannerGateInput): string[] {
  const reasons: string[] = []
  if (input.risk === "high") reasons.push("risk: high")
  if (input.uncertainty === "high") reasons.push("uncertainty: high")
  if (input.architecturalImpact) reasons.push("architectural impact")
  if (input.crossSystemDependencies) reasons.push("cross-system dependencies")
  if (input.migrationRisk) reasons.push("migration risk")
  if (input.unclearRequirements) reasons.push("unclear requirements")
  return reasons
}

function godDecomposeReasons(input: HecateqPlannerGateInput): string[] {
  const reasons: string[] = []
  if (
    input.hasMultipleWorkUnits &&
    input.architectureKnown &&
    input.domainKnown
  ) {
    reasons.push("multiple clear work units with known architecture")
  }
  if (input.risk === "medium" || input.uncertainty === "medium") {
    reasons.push("medium risk/uncertainty")
  }
  return reasons
}

function recommendedAgentsForPlanner(
  input: HecateqPlannerGateInput,
): string[] {
  const agents = ["assumption-breaker", "agent-contract-manager"]
  if (input.risk === "high" || input.uncertainty === "high") {
    agents.push("strategy-analyst")
  }
  if (input.architecturalImpact) {
    agents.push("system-philosopher")
  }
  // Defensive: apply the shared hard exclusion so the critic is never
  // recommended as planner assistance.
  return filterMomus(agents)
}

// ─── Ledger recording ────────────────────────────────────────────────────────

/**
 * Record a planner gate evaluation in the handoff history ledger. Two
 * `handoff_created` events are appended: one compact decision summary and
 * one carrying the structured reasons joined by "|". Never throws.
 */
export function recordPlannerGateEvaluation(
  assessment: HecateqPlannerActivationAssessment,
  context: { taskGraphId?: string; taskId?: string },
): void {
  const timestamp = new Date().toISOString()
  const eventBase = {
    event: "handoff_created" as const,
    timestamp,
    ...(context.taskGraphId ? { task_graph_id: context.taskGraphId } : {}),
    ...(context.taskId ? { task_id: context.taskId } : {}),
  }

  appendRuntimeEvent({
    ...eventBase,
    reason: `planner_gate_evaluated:${assessment.decision}:${assessment.risk}:${assessment.uncertainty}`,
  })
  appendRuntimeEvent({
    ...eventBase,
    reason: `planner_gate_reasons:${assessment.reasons.join("|")}`,
  })
}
