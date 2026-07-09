/**
 * Observability helper for subagent routing decisions.
 *
 * The task() delegation tool calls resolveAgentTarget() which returns a
 * RoutingDecision with diagnostics (status, target, source, indexUsed,
 * indexFresh, reason, suggestions, indexReason). This function writes
 * that decision to the oh-my-opencode.log via the shared logger so
 * routing confidence and agent selection reasons can be audited.
 *
 * The function is defensive:
 * - null decision → no-op
 * - Any error during logging is silently swallowed (logger is best-effort).
 * - Never throws.
 */
import { log } from "../logger"
import type { RoutingDecision } from "./routing-contract"

export function logRoutingDecision(
  requested: string | undefined,
  decision: RoutingDecision | null,
): void {
  if (!decision) return

  try {
    switch (decision.status) {
      case "exact_agent_found": {
        const payload: Record<string, unknown> = {
          target: decision.target,
          source: decision.source,
          indexUsed: decision.indexUsed,
        }
        if (decision.indexFresh !== undefined) {
          payload.indexFresh = decision.indexFresh
        }
        if (decision.indexReason) {
          payload.indexReason = decision.indexReason
        }
        log(
          `ROUTING: exact_agent_found subagent=${requested ?? "unknown"} target=${decision.target} source=${decision.source} indexUsed=${decision.indexUsed} reason=${decision.reason}`,
          payload,
        )
        break
      }
      case "exact_agent_disabled": {
        const payload: Record<string, unknown> = {
          target: decision.target,
        }
        if (decision.indexUsed !== undefined) {
          payload.indexUsed = decision.indexUsed
        }
        if (decision.indexFresh !== undefined) {
          payload.indexFresh = decision.indexFresh
        }
        if (decision.indexReason) {
          payload.indexReason = decision.indexReason
        }
        log(
          `ROUTING: exact_agent_disabled subagent=${requested ?? "unknown"} target=${decision.target} reason=${decision.reason}`,
          payload,
        )
        break
      }
      case "exact_agent_unknown": {
        const payload: Record<string, unknown> = {
          suggestions: decision.suggestions,
        }
        if (decision.indexUsed !== undefined) {
          payload.indexUsed = decision.indexUsed
        }
        if (decision.indexFresh !== undefined) {
          payload.indexFresh = decision.indexFresh
        }
        if (decision.indexReason) {
          payload.indexReason = decision.indexReason
        }
        log(
          `ROUTING: exact_agent_unknown subagent=${requested ?? "unknown"} suggestions=${decision.suggestions.length} reason=${decision.reason}`,
          payload,
        )
        break
      }
    }
  } catch {
    // Best-effort logging; never throw
  }
}
