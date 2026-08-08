/**
 * Hecateq Reviewer Routing — deterministic reviewer resolution.
 *
 * Resolves the reviewer agent from the RUNTIME agent registry, never
 * from a hardcoded list. If the runtime registry does not contain a
 * `reviewer` agent, routing is explicitly BLOCKED with either candidate
 * names (from an agent index) or a blocker string.
 *
 * NEVER silently falls back to a category. NEVER returns `momus`.
 */

// Momus hard exclusion: per HECATEQ Evidence/Verification/Planner Gate V1 Part L

export interface ReviewerRoutingResult {
  decision: "reviewer_found" | "reviewer_blocked"
  reviewer?: string
  blocker?: string
  candidates?: string[]
}

export interface ReviewerAgentIndex {
  agents: Array<{ name: string; enabled?: boolean }>
}

const REVIEWER_AGENT = "reviewer"

/**
 * Resolve the reviewer agent for the current runtime registry.
 *
 * Momus exclusion (Part C1): momus is never a reviewer. The explicit
 * assertion below fails closed if the reviewer constant ever regresses,
 * and the agent-index candidates are filtered by the `!== "momus"` guard
 * so momus never appears in candidate lists.
 */
export function resolveReviewerAgent(
  runtimeAgentIds: ReadonlySet<string>,
  agentIndex?: ReviewerAgentIndex,
): ReviewerRoutingResult {
  if (runtimeAgentIds.has(REVIEWER_AGENT)) {
    // Explicit assertion: the reviewer agent must never be momus.
    // A regression here fails loudly instead of routing to a forbidden agent.
    if (REVIEWER_AGENT.toLowerCase() === "momus") {
      return {
        decision: "reviewer_blocked",
        blocker: "reviewer agent blocked: must not be momus",
      }
    }
    return { decision: "reviewer_found", reviewer: REVIEWER_AGENT }
  }

  const candidates = agentIndex?.agents
    .filter((agent) => agent.enabled !== false)
    .map((agent) => agent.name)
    // Momus exclusion (Part C1): filter silently so momus is never a candidate.
    .filter((name) => name.toLowerCase() !== "momus")

  if (candidates && candidates.length > 0) {
    return {
      decision: "reviewer_blocked",
      candidates,
      blocker: `reviewer agent not found in runtime registry (candidates: ${candidates.join(", ")})`,
    }
  }

  return {
    decision: "reviewer_blocked",
    blocker: "reviewer agent not found in runtime registry",
  }
}
