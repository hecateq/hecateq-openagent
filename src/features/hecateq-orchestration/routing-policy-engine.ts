/**
 * Hecateq Routing Policy Engine — Wave 2
 *
 * Produces structured routing decisions from parsed handoff metadata.
 * This is a pure decision engine: it evaluates the handoff target and
 * status, but does NOT auto-spawn, re-dispatch, or execute agents.
 *
 * Decision taxonomy:
 *   return_to_caller             → target is the canonical routing directive
 *   return_to_parent_for_routing → target is the canonical routing directive
 *   invalid_target_blocked       → target is "return_to_caller"|"return_to_parent_for_routing"
 *                                  but handoff status is BLOCKED
 *   no_handoff_data              → no handoff data was provided
 *   unknown_target_fallback      → target is not a known agent ID or routing directive
 *
 * Known routing directives are resolved from the handoff parser's
 * VALID_HANDOFF_TARGETS set and the agent registry.
 */

import { getKnownAgentIds, createDefaultHandoffBlock } from "./handoff-parser"
import type { HandoffBlock, HandoffTarget } from "./handoff-parser"
import type { RoutingDecision, RoutingDecisionKind } from "./types"
import { getAgentRole, validateHandoffTargetByRole } from "./handoff-role-policy"
import { emitTraceEvent } from "../../shared/runtime-trace"
import { resolveReviewerAgent } from "./reviewer-routing"

// ─── Decision Makers ───────────────────────────────────────────────────────

/**
 * Classify a handoff target into a routing decision.
 *
 * Rules (evaluated in order):
 * 1. No handoff data → no_handoff_data
 * 2. BLOCKED status + valid routing target → invalid_target_blocked
 * 3. "return_to_caller" → return_to_caller
 * 4. "return_to_parent_for_routing" → return_to_parent_for_routing
 * 5. Known agent ID → return_to_caller (delegation to known agent)
 * 6. Unknown target → unknown_target_fallback
 */
export function decideRouting(handoff: HandoffBlock, opts?: {
  sourceTaskId?: string
  sourceAgent?: string
}): RoutingDecision {
  const now = new Date().toISOString()
  const sourceTaskId = opts?.sourceTaskId
  const sourceAgent = opts?.sourceAgent

  // Rule 1: No handoff data
  if (!handoff.status && !handoff.handoff && handoff.signals.length === 0) {
    const decision: RoutingDecision = {
      kind: "no_handoff_data",
      reason: "No handoff metadata (status, target, or signals) was present",
      originalTarget: null,
      decidedAt: now,
      sourceTaskId,
      sourceAgent,
    }
    emitTraceEvent("routing.decided", "routing", {
      kind: decision.kind,
      reason: decision.reason,
      sourceTaskId,
      sourceAgent,
    })
    return decision
  }

  const target = handoff.handoff as HandoffTarget | null

  // Rule 2: BLOCKED status blocks routing even with valid target
  if (handoff.status === "BLOCKED") {
    const decision: RoutingDecision = {
      kind: "invalid_target_blocked",
      reason: `Handoff status is BLOCKED; routing to "${target ?? "none"}" is suppressed`,
      originalTarget: target,
      decidedAt: now,
      sourceTaskId,
      sourceAgent,
    }
    emitTraceEvent("routing.decided", "routing", {
      kind: decision.kind,
      reason: decision.reason,
      originalTarget: target,
      sourceTaskId,
      sourceAgent,
    })
    return decision
  }

  // Rule 3: Canonical routing directives
  if (target === "return_to_caller") {
    const decision: RoutingDecision = {
      kind: "return_to_caller",
      reason: "Agent explicitly requested return to caller",
      originalTarget: target,
      decidedAt: now,
      sourceTaskId,
      sourceAgent,
    }
    emitTraceEvent("routing.decided", "routing", {
      kind: decision.kind,
      reason: decision.reason,
      originalTarget: target,
      sourceTaskId,
      sourceAgent,
    })
    return decision
  }

  if (target === "return_to_parent_for_routing") {
    const decision: RoutingDecision = {
      kind: "return_to_parent_for_routing",
      reason: "Agent requested parent-level routing decision",
      originalTarget: target,
      decidedAt: now,
      sourceTaskId,
      sourceAgent,
    }
    emitTraceEvent("routing.decided", "routing", {
      kind: decision.kind,
      reason: decision.reason,
      originalTarget: target,
      sourceTaskId,
      sourceAgent,
    })
    return decision
  }

  // Rule 4: No target at all but status/signals exist
  if (!target) {
    const decision: RoutingDecision = {
      kind: "no_handoff_data",
      reason: `Handoff status is "${handoff.status ?? "null"}" but no target was specified`,
      originalTarget: null,
      decidedAt: now,
      sourceTaskId,
      sourceAgent,
    }
    emitTraceEvent("routing.decided", "routing", {
      kind: decision.kind,
      reason: decision.reason,
      sourceTaskId,
      sourceAgent,
    })
    return decision
  }

  // Rule 5: Known agent ID — check role policy if source is known
  const knownIds = getKnownAgentIds()
  if (knownIds.includes(target)) {
    // Wave 3: Role-aware enforcement — check if source agent's role
    // permits handoff to this target
    if (sourceAgent) {
      const violation = validateHandoffTargetByRole(sourceAgent, target)
      if (violation) {
        const sourceRole = getAgentRole(sourceAgent)
        const targetRole = getAgentRole(target)
        const decision: RoutingDecision = {
          kind: "role_policy_violation",
          reason: violation,
          originalTarget: target,
          decidedAt: now,
          sourceTaskId,
          sourceAgent,
          roleViolation: {
            sourceRole,
            targetRole,
            rule: violation,
          },
        }
        emitTraceEvent("routing.role_violation", "routing", {
          kind: decision.kind,
          reason: violation,
          sourceRole,
          targetRole,
          sourceAgent,
          originalTarget: target,
          rule: violation,
          sourceTaskId,
        })
        return decision
      }
    }

    const decision: RoutingDecision = {
      kind: "return_to_caller",
      reason: `Validated target "${target}" is a known agent ID`,
      originalTarget: target,
      decidedAt: now,
      sourceTaskId,
      sourceAgent,
    }
    emitTraceEvent("routing.decided", "routing", {
      kind: decision.kind,
      reason: decision.reason,
      originalTarget: target,
      sourceTaskId,
      sourceAgent,
    })
    return decision
  }

  // Rule 6: Unknown target — fallback
  const decision: RoutingDecision = {
    kind: "unknown_target_fallback",
    reason: `Handoff target "${target}" is not a known agent ID or routing directive`,
    originalTarget: target,
    decidedAt: now,
    sourceTaskId,
    sourceAgent,
  }
  emitTraceEvent("routing.decided", "routing", {
    kind: decision.kind,
    reason: decision.reason,
    originalTarget: target,
    sourceTaskId,
    sourceAgent,
  })
  return decision
}

/**
 * Arguments for `decideRoutingFromTaskHandoff`.
 */
export interface DecideRoutingFromTaskHandoffArgs {
  status: string | null
  target: string | null
  signalCount: number
  sourceTaskId?: string
  sourceAgent?: string
  /**
   * The task chain leading up to this handoff. Used by the momus
   * exclusion guard (any task with subagent_type "momus" blocks routing)
   * and the planner→reviewer gating check.
   */
  chain?: ReadonlyArray<{ subagent_type?: string }>
  /** Runtime agent registry — single source of truth for reviewer resolution. */
  runtimeAgentIds?: ReadonlySet<string>
  /** Optional agent index used to surface reviewer candidates when blocked. */
  agentIndex?: { agents: Array<{ name: string; enabled?: boolean }> }
}

/**
 * Convenience: produce a routing decision from the parsed handoff metadata
 * attached to a TaskExecutionResult. Always returns a decision — never null.
 *
 * v2 additions (both emit `STATUS: BLOCKED` semantics):
 *  - Momus guard: any task in the chain with subagent_type "momus" is
 *    rejected outright — Momus is excluded from this workflow.
 *  - Reviewer gating: a hecateq-planner → reviewer handoff is resolved
 *    against the runtime registry first; if the reviewer is missing, the
 *    decision is BLOCKED with NEXT_RECOMMENDED_AGENT=reviewer + candidates.
 */
export function decideRoutingFromTaskHandoff(
  args: DecideRoutingFromTaskHandoffArgs,
): RoutingDecision {
  const now = new Date().toISOString()

  // ── Momus exclusion guard ─────────────────────────────────────────────────
  const chainAgents = args.chain
    ?.map((task) => task.subagent_type)
    .filter((name): name is string => typeof name === "string" && name.length > 0) ?? []
  if (chainAgents.includes("momus") || args.sourceAgent === "momus") {
    const blocker =
      "Momus is excluded from the Hecateq routing workflow; a task chain containing 'momus' cannot be routed"
    emitTraceEvent("routing.momus_blocked", "routing", {
      status: "BLOCKED",
      blocker,
      sourceTaskId: args.sourceTaskId,
      sourceAgent: args.sourceAgent,
    })
    return {
      kind: "invalid_target_blocked",
      reason: blocker,
      originalTarget: args.target,
      decidedAt: now,
      sourceTaskId: args.sourceTaskId,
      sourceAgent: args.sourceAgent,
      blocker,
      candidates: [],
    }
  }

  // ── Planner → reviewer gating ─────────────────────────────────────────────
  const sourceIsPlanner =
    chainAgents.includes("hecateq-planner") || args.sourceAgent === "hecateq-planner"
  if (sourceIsPlanner && args.target === "reviewer" && args.runtimeAgentIds) {
    const reviewerRouting = resolveReviewerAgent(args.runtimeAgentIds, args.agentIndex)
    if (reviewerRouting.decision === "reviewer_blocked") {
      const blocker =
        reviewerRouting.blocker ?? "reviewer agent not found in runtime registry"
      emitTraceEvent("routing.reviewer_blocked", "routing", {
        status: "BLOCKED",
        nextRecommendedAgent: "reviewer",
        candidates: reviewerRouting.candidates,
        blocker,
        sourceTaskId: args.sourceTaskId,
        sourceAgent: args.sourceAgent,
      })
      return {
        kind: "invalid_target_blocked",
        reason: `Planner→reviewer routing blocked: ${blocker}`,
        originalTarget: "reviewer",
        decidedAt: now,
        sourceTaskId: args.sourceTaskId,
        sourceAgent: args.sourceAgent,
        blocker,
        nextRecommendedAgent: "reviewer",
        candidates: reviewerRouting.candidates,
      }
    }
  }

  const synthetic: HandoffBlock = createDefaultHandoffBlock({
    status: args.status as HandoffBlock["status"],
    handoff: args.target as HandoffTarget | null,
  })

  return decideRouting(synthetic, {
    sourceTaskId: args.sourceTaskId,
    sourceAgent: args.sourceAgent,
  })
}

// ─── Decision Utilities ────────────────────────────────────────────────────

/**
 * Whether a routing decision indicates the handoff should be surfaced
 * to the parent session (as opposed to being silently consumed).
 */
export function isUserVisibleDecision(kind: RoutingDecisionKind): boolean {
  return kind === "return_to_parent_for_routing"
    || kind === "unknown_target_fallback"
    || kind === "invalid_target_blocked"
    || kind === "role_policy_violation"
}

/**
 * Whether a routing decision represents a terminal state
 * (no further routing can occur).
 */
export function isTerminalDecision(kind: RoutingDecisionKind): boolean {
  return kind === "no_handoff_data"
    || kind === "invalid_target_blocked"
    || kind === "role_policy_violation"
}
