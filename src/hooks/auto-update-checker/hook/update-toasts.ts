import type { PluginInput } from "@opencode-ai/plugin"
import { log, showToastSafe } from "../../../shared"

export async function showUpdateAvailableToast(
  ctx: PluginInput,
  latestVersion: string,
  getToastMessage: (isUpdate: boolean, latestVersion?: string) => string
): Promise<void> {
  await showToastSafe(ctx.client, {
    title: `OhMyOpenCode ${latestVersion}`,
    message: getToastMessage(true, latestVersion),
    variant: "info",
    duration: 8000,
  })
  log(`[auto-update-checker] Update available toast shown: v${latestVersion}`)
}

export async function showAutoUpdatedToast(ctx: PluginInput, oldVersion: string, newVersion: string): Promise<void> {
  await showToastSafe(ctx.client, {
    title: "OhMyOpenCode Updated!",
    message: `v${oldVersion} → v${newVersion}\nRestart OpenCode to apply.`,
    variant: "success",
    duration: 8000,
  })
  log(`[auto-update-checker] Auto-updated toast shown: v${oldVersion} → v${newVersion}`)
}
