/**
 * Hecateq Planner v2 — machine-readable task graph planner.
 *
 * v2 emits a strict, Zod-validated JSON task graph contract and is
 * read-only enforced at runtime. Gated behind
 * `config.hecateq.experimental.planner_v2.enabled` (default: off).
 */
export {
  createHecateqPlannerV2Agent,
  createHecateqPlannerV2AgentFactory,
  HECATEQ_PLANNER_V2_PROMPT,
} from "./agent";
export { shouldUsePlannerV2, maybeCreateHecateqPlannerV2Config } from "./flag";
export type { PlannerV2FlagSnapshot } from "./flag";
