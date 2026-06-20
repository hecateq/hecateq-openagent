/**
 * Hecateq Planner v2 — experimental scaffolding.
 *
 * Currently a thin wrapper around v1. Future PRs will populate this
 * module with JSON-structured output, agent-registry injection,
 * self-critique, and replanning.
 *
 * NOT WIRED into the plugin in PR-A. See `v2/flag.ts` for the future
 * feature-flag surface (added in PR-B).
 */
export {
  createHecateqPlannerV2Agent,
  createHecateqPlannerV2AgentFactory,
} from "./agent";