/**
 * Handoff Integration — wires handoff parsing and routing policy
 * into the Hecateq God orchestrator runtime flow.
 *
 * When a delegated task returns with a HANDOFF block, the orchestrator
 * consumes it through consumeHandoffResponse(), which:
 *   1. Parses the block with parseHandoffBlock()
 *   2. Evaluates routing with decideRouting()
 *   3. Maps the routing decision to an actionable HandoffDecision
 *
 * The HandoffDecision is then formatted for prompt injection via
 * formatHandoffDecisionForPrompt() so the LLM can act on it.
 */

import { parseHandoffBlock } from "../../features/hecateq-orchestration"
import { decideRouting } from "../../features/hecateq-orchestration"
import type {
  HandoffBlock,
  HandoffSignal,
} from "../../features/hecateq-orchestration"
import type {
  RoutingDecisionKind,
} from "../../features/hecateq-orchestration"
import type { HecateqOrchestratorContext } from "./agent"

// ─── HandoffDecision Type ─────────────────────────────────────────────────

export interface HandoffDecision {
  /** Action the orchestrator should take */
  action: "continue" | "reroute" | "stop" | "blocked"
  /** Target agent when action is "reroute" */
  targetAgent?: string
  /** Human-readable explanation of the decision */
  reason: string
  /** Parsed handoff block, when a meaningful handoff was present */
  parsedHandoff?: HandoffBlock
  /** Raw signals extracted from the handoff block */
  rawSignals: HandoffSignal[]
}

// ─── Routing Kind → Action Mapping ────────────────────────────────────────

export function mapRoutingKindToAction(kind: RoutingDecisionKind): HandoffDecision["action"] {
  switch (kind) {
    case "return_to_caller":
      return "continue"
    case "return_to_parent_for_routing":
      return "reroute"
    case "invalid_target_blocked":
      return "blocked"
    case "no_handoff_data":
      return "continue"
    case "unknown_target_fallback":
      return "reroute"
    case "role_policy_violation":
      return "blocked"
    default:
      return "stop"
  }
}

// ─── consumeHandoffResponse ───────────────────────────────────────────────

/**
 * Parse an agent response string into a HandoffDecision.
 *
 * Flow:
 *   1. Parse HANDOFF block from the response text
 *   2. Run the routing policy engine on the parsed block
 *   3. Map the routing decision kind to an orchestrator action
 *
 * Always returns a decision — never throws.
 * When no handoff block is present, returns action="continue".
 */
export function consumeHandoffResponse(
  response: string,
  _context: HecateqOrchestratorContext,
): HandoffDecision {
  const parsed = parseHandoffBlock(response)

  const routingDecision = decideRouting(parsed, {
    sourceAgent: "hecateq-orchestrator",
  })

  const action = mapRoutingKindToAction(routingDecision.kind)
  const reason = routingDecision.reason
  const targetAgent = routingDecision.originalTarget ?? undefined
  const rawSignals = parsed.signals

  const hasMeaningfulHandoff =
    parsed.status !== null ||
    parsed.handoff !== null ||
    parsed.signals.length > 0

  return {
    action,
    targetAgent,
    reason,
    parsedHandoff: hasMeaningfulHandoff ? parsed : undefined,
    rawSignals,
  }
}

// ─── formatHandoffDecisionForPrompt ───────────────────────────────────────

/**
 * Render a HandoffDecision into an XML block suitable for prompt injection.
 *
 * The orchestrator's LLM reads this block to understand what the routing
 * engine decided and what action to take next.
 */
export function formatHandoffDecisionForPrompt(decision: HandoffDecision): string {
  const lines: string[] = []
  lines.push(`<handoff_decision action="${decision.action}">`)
  lines.push(`  <reason>${decision.reason}</reason>`)

  if (decision.targetAgent) {
    lines.push(`  <target_agent>${decision.targetAgent}</target_agent>`)
  }

  if (decision.parsedHandoff) {
    const ph = decision.parsedHandoff
    if (ph.status) {
      lines.push(`  <status>${ph.status}</status>`)
    }
    if (ph.nextRecommendedAgent) {
      lines.push(`  <next_recommended_agent>${ph.nextRecommendedAgent}</next_recommended_agent>`)
    }
    if (ph.blockers.length > 0) {
      lines.push(`  <blockers>${ph.blockers.join(", ")}</blockers>`)
    }
  }

  if (decision.rawSignals.length > 0) {
    const signalNames = decision.rawSignals.map((s) => s.signal).join(", ")
    lines.push(`  <signals>${signalNames}</signals>`)
  }

  lines.push("</handoff_decision>")
  return lines.join("\n")
}
