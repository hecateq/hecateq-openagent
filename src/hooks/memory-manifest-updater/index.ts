import type { PluginInput } from "@opencode-ai/plugin"

import {
  refreshManifestAfterWrite,
  shouldRefreshManifest,
  type ManifestRefreshResult,
} from "../../shared/memory-manifest-updater"
import { log } from "../../shared/logger"

export const HOOK_NAME = "memory-manifest-updater" as const

/**
 * Create a hook that refreshes the memory manifest after tool writes
 * targeting files inside the memory directory.
 *
 * Trigger: `tool.execute.after` — fires after a Write/Edit tool
 * successfully writes to a file under `.opencode/state/memory/`.
 *
 * Safety properties:
 * - Only acts on Write/Edit tools targeting memory files.
 * - Hook failures never break tool chains.
 * - Disableable via `disabled_hooks: ["memory-manifest-updater"]`.
 */
export function createMemoryManifestUpdaterHook(ctx: PluginInput) {
  return {
    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string; args?: Record<string, unknown> },
      _output: { title: string; output: string; metadata: unknown },
    ): Promise<void> => {
      // Only act on Write/Edit tools with recognizable file path args
      const filePath = shouldRefreshManifest(input.tool, input.args)
      if (!filePath) return

      const directory = typeof ctx.directory === "string" ? ctx.directory : process.cwd()

      try {
        const result: ManifestRefreshResult = refreshManifestAfterWrite(
          directory,
          filePath,
          "opencode",
          undefined,
          input.sessionID,
        )

        if (result.attempted && result.updated) {
          log(
            `[${HOOK_NAME}] Refreshed manifest entry for "${result.memoryFileName}"`,
            {
              sessionID: input.sessionID,
              tool: input.tool,
              filePath,
              memoryFileName: result.memoryFileName,
            },
          )
        }
      } catch (error) {
        // Hook failures must not break tool chains
        log(`[${HOOK_NAME}] Error during manifest refresh`, {
          sessionID: input.sessionID,
          tool: input.tool,
          filePath,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    },
  }
}
