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
 */
export function resolveReviewerAgent(
  runtimeAgentIds: ReadonlySet<string>,
  agentIndex?: ReviewerAgentIndex,
): ReviewerRoutingResult {
  if (runtimeAgentIds.has(REVIEWER_AGENT)) {
    return { decision: "reviewer_found", reviewer: REVIEWER_AGENT }
  }

  const candidates = agentIndex?.agents
    .filter((agent) => agent.enabled !== false)
    .map((agent) => agent.name)
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
