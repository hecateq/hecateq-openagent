import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { HecateqConfigSchema, type HecateqConfig } from "../../config/schema/hecateq"
import { createCliPostHog, getPostHogDistinctId, type PostHogClient } from "../../shared/posthog"
import { getOpenCodeConfigDir, CONFIG_BASENAME, LEGACY_CONFIG_BASENAME, parseJsonc } from "../../shared"

export type HecateqFeatureSummary = {
  hecateq_enabled: boolean
  orchestration_enabled: boolean
  auto_spawn_enabled: boolean
  dependency_graph_mode: string
  context_injection_mode: string
  agent_index_enabled: boolean
  memory_bootstrap_enabled: boolean
  git_checkpoint_mode: string
}

function readHecateqConfig(cwd: string): HecateqConfig | undefined {
  const userConfigDir = getOpenCodeConfigDir({ binary: "opencode" })
  const projectOpencodeDir = join(cwd, ".opencode")
  const candidates = [
    join(userConfigDir, `${CONFIG_BASENAME}.json`),
    join(userConfigDir, `${CONFIG_BASENAME}.jsonc`),
    join(userConfigDir, `${LEGACY_CONFIG_BASENAME}.json`),
    join(userConfigDir, `${LEGACY_CONFIG_BASENAME}.jsonc`),
    join(projectOpencodeDir, `${CONFIG_BASENAME}.json`),
    join(projectOpencodeDir, `${CONFIG_BASENAME}.jsonc`),
    join(projectOpencodeDir, `${LEGACY_CONFIG_BASENAME}.json`),
    join(projectOpencodeDir, `${LEGACY_CONFIG_BASENAME}.jsonc`),
  ]

  for (const filePath of candidates) {
    try {
      if (!existsSync(filePath)) continue
      const raw = parseJsonc<Record<string, unknown>>(readFileSync(filePath, "utf-8"))
      if (!raw || typeof raw.hecateq !== "object" || raw.hecateq === null) continue
      const result = HecateqConfigSchema.safeParse(raw.hecateq)
      if (result.success) return result.data
    } catch {
      continue
    }
  }
  return undefined
}

function summarizeFeatures(config: HecateqConfig | undefined): HecateqFeatureSummary {
  return {
    hecateq_enabled: config?.enabled ?? true,
    orchestration_enabled: config?.orchestration?.enabled ?? false,
    auto_spawn_enabled: config?.auto_spawn?.enabled ?? false,
    dependency_graph_mode: config?.dependency_graph?.mode ?? "off",
    context_injection_mode: config?.context_injection?.mode ?? "compact",
    agent_index_enabled: config?.agent_index?.enabled ?? true,
    memory_bootstrap_enabled: config?.memory_bootstrap?.enabled ?? true,
    git_checkpoint_mode: config?.git_checkpoint?.mode ?? "suggest",
  }
}

/**
 * Track anonymous doctor usage telemetry.
 *
 * Fires a single `omo_doctor_run` event when opt-in is enabled
 * (HECATEQ_SEND_ANONYMOUS_TELEMETRY=1 + valid HECATEQ_POSTHOG_KEY)
 * using `captureMinimal` — no OS, CPU, locale, or other shared
 * properties are transmitted. Only the anonymous event name, feature
 * flag booleans/enums, and $process_person_profile: false are sent
 * (the latter is added by captureMinimal itself).
 * Never includes repository names, paths, prompts, secrets, env values,
 * or user-identifying data.
 *
 * The underlying PostHog client already respects the opt-in gate —
 * when disabled, createCliPostHog() returns a no-op client and nothing
 * is sent. Telemetry send failures are silently ignored so the doctor
 * command is never blocked by telemetry.
 *
 * @param posthogClient - Optional client override for testing. Defaults to createCliPostHog().
 * @param cwd - Working directory for config resolution. Defaults to process.cwd().
 */
export async function trackDoctorUsage(
  posthogClient?: PostHogClient,
  cwd?: string,
): Promise<void> {
  try {
    const posthog = posthogClient ?? createCliPostHog()
    const distinctId = getPostHogDistinctId()
    const hecateqConfig = readHecateqConfig(cwd ?? process.cwd())
    const features = summarizeFeatures(hecateqConfig)

    posthog.captureMinimal(distinctId, "omo_doctor_run", {
      hecateq_enabled: features.hecateq_enabled,
      orchestration_enabled: features.orchestration_enabled,
      auto_spawn_enabled: features.auto_spawn_enabled,
      dependency_graph_mode: features.dependency_graph_mode,
      context_injection_mode: features.context_injection_mode,
      agent_index_enabled: features.agent_index_enabled,
      memory_bootstrap_enabled: features.memory_bootstrap_enabled,
      git_checkpoint_mode: features.git_checkpoint_mode,
    })

    await posthog.shutdown()
  } catch {
    void 0
  }
}

/** @internal test-only: extract summary without sending */
export function summarizeFeaturesForTest(config: HecateqConfig | undefined): HecateqFeatureSummary {
  return summarizeFeatures(config)
}
