import type { PluginInput } from "@opencode-ai/plugin"
import { isModelCacheAvailable } from "../../../shared/model-availability"
import { log, showToastSafe } from "../../../shared"

export async function showModelCacheWarningIfNeeded(ctx: PluginInput): Promise<void> {
  if (isModelCacheAvailable()) return

  await showToastSafe(ctx.client, {
    title: "Model Cache Not Found",
    message:
      "Run 'opencode models --refresh' or restart OpenCode to populate the models cache for optimal agent model selection.",
    variant: "warning",
    duration: 10000,
  })

  log("[auto-update-checker] Model cache warning shown")
}
