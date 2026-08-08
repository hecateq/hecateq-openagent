/**
 * Feature flag helpers for Hecateq Planner v2.
 *
 * Reads `config.hecateq.experimental.planner_v2.enabled` (default `false`)
 * via a local Zod slice schema. When the flag is on, the v2 factory is
 * returned; otherwise v1 behavior continues unchanged.
 */

import { z } from "zod"
import { createHecateqPlannerV2Agent } from "./agent"
import type { AgentConfig } from "@opencode-ai/sdk"

const PlannerV2ConfigSchema = z.object({
  enabled: z.boolean().default(false),
})

export interface PlannerV2FlagSnapshot {
  /** Whether the v2 implementation is enabled. */
  enabled: boolean;
  /** Source of the decision, for diagnostics. */
  source: "config" | "default";
}

/**
 * Decide whether the v2 Planner should be used.
 *
 * Reads `config.hecateq.experimental.planner_v2.enabled`. Missing or
 * malformed config slices default to `enabled: false`.
 */
export function shouldUsePlannerV2(config: unknown): PlannerV2FlagSnapshot {
  const slice = extractPlannerV2Slice(config)
  const parsed = PlannerV2ConfigSchema.safeParse(slice ?? {})
  const enabled = parsed.success ? parsed.data.enabled : false
  if (enabled) return { enabled: true, source: "config" }
  return { enabled: false, source: "default" }
}

/**
 * Return the v2 factory if the flag is on, otherwise `null`.
 */
export function maybeCreateHecateqPlannerV2Config(
  config: unknown,
  model: string,
): AgentConfig | null {
  if (!shouldUsePlannerV2(config).enabled) return null
  return createHecateqPlannerV2Agent(model)
}

/**
 * Defensively extract the `hecateq.experimental.planner_v2` config slice
 * from an unknown config object. Returns `undefined` when absent or
 * malformed — never throws.
 */
function extractPlannerV2Slice(config: unknown): unknown {
  if (typeof config !== "object" || config === null) return undefined
  const root = config as Record<string, unknown>

  const hecateq = root.hecateq
  if (typeof hecateq !== "object" || hecateq === null) return undefined

  const experimental = (hecateq as Record<string, unknown>).experimental
  if (typeof experimental !== "object" || experimental === null) return undefined

  return (experimental as Record<string, unknown>).planner_v2
}
