import type { AgentConfig } from "@opencode-ai/sdk";
import type { AgentMode, AgentFactory } from "../../types";
import { createHecateqPlannerAgent } from "../agent";

const MODE: AgentMode = "subagent";

/**
 * Hecateq Planner v2 — experimental scaffolding.
 *
 * PR-A only adds the wrapper. v2 currently delegates 100% to v1
 * (`createHecateqPlannerAgent`) so behavior is identical when v2 is invoked.
 * Future PRs (PR-B+) will add JSON-structured output, agent-registry
 * injection, self-critique, and replanning — each gated behind feature flags
 * that default to OFF.
 *
 * DO NOT call this factory from any production code path in PR-A. It exists
 * only as a future mount point. Wiring happens in PR-B.
 */
export function createHecateqPlannerV2Agent(model: string): AgentConfig {
  return createHecateqPlannerAgent(model);
}

export const createHecateqPlannerV2AgentFactory: AgentFactory =
  Object.assign(createHecateqPlannerV2Agent, { mode: MODE });