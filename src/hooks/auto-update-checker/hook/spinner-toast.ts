import type { PluginInput } from "@opencode-ai/plugin"
import { showToastSafe } from "../../../shared"

const SISYPHUS_SPINNER = ["·", "•", "●", "○", "◌", "◦", " "]

export async function showSpinnerToast(ctx: PluginInput, version: string, message: string): Promise<void> {
  const totalDuration = 5000
  const frameInterval = 100
  const totalFrames = Math.floor(totalDuration / frameInterval)

  for (let i = 0; i < totalFrames; i++) {
    const spinner = SISYPHUS_SPINNER[i % SISYPHUS_SPINNER.length]
    await showToastSafe(ctx.client, {
      title: `${spinner} OhMyOpenCode ${version}`,
      message,
      variant: "info",
      duration: frameInterval + 50,
    })

    await new Promise((resolve) => setTimeout(resolve, frameInterval))
  }
}
