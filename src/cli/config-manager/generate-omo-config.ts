import type { InstallConfig } from "../types"
import { generateModelConfig } from "../model-fallback"
import { generateHecateqProfileConfig } from "./generate-hecateq-config"

export function generateOmoConfig(installConfig: InstallConfig): Record<string, unknown> {
  const modelConfig = generateModelConfig(installConfig)
  const hecateqConfig = generateHecateqProfileConfig(installConfig.hecateqProfile)

  if (!hecateqConfig) {
    // Advanced profile: no hecateq config block — preserve existing or use runtime defaults
    return modelConfig
  }

  return {
    ...modelConfig,
    hecateq: hecateqConfig,
  }
}
