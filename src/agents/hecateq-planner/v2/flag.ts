/**
 * Feature flag helpers for Hecateq Planner v2.
 *
 * PR-A STUB: every helper returns the "v1 / off" answer so v2 is never
 * selected in production. PR-B will add a Zod schema under
 * `src/config/schema/hecateq-planner-v2.ts` and wire the helpers to read
 * `config.hecateq.experimental.planner_v2.enabled`.
 *
 * Until then, `shouldUsePlannerV2(...)` MUST always return `false`.
 */

export interface PlannerV2FlagSnapshot {
  /** Whether the v2 implementation is enabled. Always `false` in PR-A. */
  enabled: boolean;
  /** Source of the decision, for diagnostics. */
  source: "stub-pr-a" | "config" | "default";
}

/**
 * Decide whether the v2 Planner should be used.
 *
 * PR-A: always returns `enabled: false, source: "stub-pr-a"`.
 * PR-B: reads `config.hecateq.experimental.planner_v2.enabled`.
 */
export function shouldUsePlannerV2(
  _config: unknown,
): PlannerV2FlagSnapshot {
  return { enabled: false, source: "stub-pr-a" };
}

/**
 * Return the v2 factory if the flag is on, otherwise `null`.
 *
 * PR-A: always returns `null`.
 */
export function maybeCreateHecateqPlannerV2Config(
  _config: unknown,
  _model: string,
): null {
  return null;
}