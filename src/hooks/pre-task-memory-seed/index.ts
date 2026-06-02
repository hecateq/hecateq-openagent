import type { PluginInput } from "@opencode-ai/plugin"

import { isRealUserTextPart, log } from "../../shared"
import { resolveSessionRoot } from "../../shared/memory-bootstrap"
import {
  shouldSeedProjectMemory,
  extractPreTaskMemorySeed,
  applyPreTaskMemorySeed,
} from "../../shared/pre-task-memory-seed"
import { consumeDecisionCandidates } from "../../shared/decision-candidate-consumer"

export const HOOK_NAME = "pre-task-memory-seed" as const

export type PreTaskMemorySeedHook = {
  HOOK_NAME: typeof HOOK_NAME
  "chat.message": (input: ChatMessageInput, output: ChatMessageOutput) => Promise<void>
  event: (input: { event: { type: string; properties?: unknown } }) => Promise<void>
}

type ChatMessageInput = {
  sessionID: string
  agent?: string
}

type ChatMessageOutput = {
  parts: Array<{ type: string; text?: string; [key: string]: unknown }>
}

function extractPromptText(parts: ChatMessageOutput["parts"]): string {
  return parts
    .filter(isRealUserTextPart)
    .map((part) => part.text)
    .join("\n")
    .trim()
}

export function createPreTaskMemorySeedHook(
  ctx: PluginInput,
): PreTaskMemorySeedHook {
  const seededSessions = new Set<string>()

  return {
    HOOK_NAME,

    "chat.message": async (input, output) => {
      if (seededSessions.has(input.sessionID)) return

      try {
        const promptText = extractPromptText(output.parts)
        if (!promptText) return

        if (!shouldSeedProjectMemory(promptText)) return

        const directory = typeof ctx.directory === "string" ? ctx.directory : process.cwd()
        const rootContract = resolveSessionRoot(directory)
        if (!rootContract) {
          log(`[${HOOK_NAME}] No project root from ${directory}`, {})
          return
        }

        const seed = extractPreTaskMemorySeed(promptText, rootContract.projectRoot)
        if (!seed) return

        seededSessions.add(input.sessionID)

        const result = applyPreTaskMemorySeed(rootContract.projectRoot, seed)

        // Phase 3B.1: Route decisionCandidates through the Decision Candidate
        // Consumer → Decision Writer (decisions.jsonl). Pre-task seed does NOT
        // write decisions files directly.
        if (result.decisionCandidates.length > 0) {
          try {
            const consumerResult = consumeDecisionCandidates(
              result.decisionCandidates,
              rootContract.projectRoot,
              { sessionId: input.sessionID },
            )

            if (consumerResult.written > 0) {
              log(`[${HOOK_NAME}] Decision candidates persisted`, {
                sessionID: input.sessionID,
                attempted: consumerResult.attempted,
                written: consumerResult.written,
                skipped: consumerResult.skipped,
                manifestRefreshed: consumerResult.manifestRefreshed,
              })
            }

            if (consumerResult.errors.length > 0) {
              log(`[${HOOK_NAME}] Decision candidate consumer errors`, {
                sessionID: input.sessionID,
                errors: consumerResult.errors,
              })
            }
          } catch (consumerError) {
            log(`[${HOOK_NAME}] Decision candidate consumer failed (non-blocking)`, {
              sessionID: input.sessionID,
              error: consumerError instanceof Error ? consumerError.message : String(consumerError),
            })
          }
        }

        if (result.written.length > 0) {
          log(`[${HOOK_NAME}] Seeded project memory`, {
            sessionID: input.sessionID,
            projectRoot: rootContract.projectRoot,
            written: result.written,
            skipped: result.skipped,
            manifestRefreshed: result.manifestRefreshed,
          })
        }

        if (result.errors.length > 0) {
          log(`[${HOOK_NAME}] Seed completed with errors`, {
            sessionID: input.sessionID,
            errors: result.errors,
          })
        }
      } catch (error) {
        log(`[${HOOK_NAME}] Seed failed (non-blocking)`, {
          sessionID: input.sessionID,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    },

    event: async ({ event }) => {
      if (event.type !== "session.deleted") return
      const props = event.properties as { info?: { id?: string }; sessionID?: string } | undefined
      const sessionID = props?.sessionID ?? props?.info?.id
      if (sessionID) seededSessions.delete(sessionID)
    },
  }
}
