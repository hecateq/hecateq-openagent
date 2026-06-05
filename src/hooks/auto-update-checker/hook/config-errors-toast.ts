import type { PluginInput } from "@opencode-ai/plugin"
import { getConfigLoadErrors, clearConfigLoadErrors } from "../../../shared/config-errors"
import { log, showToastSafe } from "../../../shared"

export async function showConfigErrorsIfAny(ctx: PluginInput): Promise<void> {
  const errors = getConfigLoadErrors()
  if (errors.length === 0) return

  const errorMessages = errors.map((error: { path: string; error: string }) => `${error.path}: ${error.error}`).join("\n")
  await showToastSafe(ctx.client, {
    title: "Config Load Error",
    message: `Failed to load config:\n${errorMessages}`,
    variant: "error",
    duration: 10000,
  })

  log(`[auto-update-checker] Config load errors shown: ${errors.length} error(s)`) 
  clearConfigLoadErrors()
}
