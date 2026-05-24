/**
 * Background Handoff Ingestor
 *
 * Extracts handoff metadata from a completed background task's last assistant
 * message and persists it into the same state surfaces used by sync handoff:
 *   - Run-continuation marker
 *   - Boulder task session state (if an active work exists)
 *
 * This is best-effort: it never blocks task completion and never throws.
 * If the session has no assistant text content, or if parsing produces no
 * valid handoff block, the ingestor silently returns null — same as how the
 * sync path handles absence of a handoff block.
 */

import { processHandoffInAgentResponse } from "../hecateq-orchestration"
import type { HandoffBlock } from "../hecateq-orchestration/handoff-parser"
import { log } from "../../shared"
import type { BackgroundTask } from "./types"

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Attempt to ingest handoff metadata from a completed background task.
 *
 * Steps:
 * 1. Resolve the task's last assistant message text via a provided fetcher.
 * 2. Parse handoff blocks (STATUS / SIGNALS_EMITTED / HANDOFF) from that text.
 * 3. Persist into continuation marker and Boulder state.
 *
 * Returns the parsed HandoffBlock if found and persisted, or null if:
 *   - No assistant text content exists
 *   - No valid handoff block was found in the text
 *   - Any error occurred (silently caught)
 */
export async function ingestHandoffFromBackgroundTask(
  task: BackgroundTask,
  fetchMessagesText: (sessionId: string) => Promise<string>,
  directory: string,
): Promise<HandoffBlock | null> {
  try {
    const sessionId = task.sessionId
    if (!sessionId) {
      return null
    }

    // Step 1: Fetch the last assistant text from the task session
    const textContent = await fetchMessagesText(sessionId)
    if (!textContent || textContent.trim().length === 0) {
      return null
    }

    // Step 2 & 3: Parse and persist via the shared sync handoff path
    // processHandoffInAgentResponse parses + persists to continuation marker +
    // Boulder state. Returns null if no handoff block found (not an error).
    return processHandoffInAgentResponse(textContent, directory, sessionId)
  } catch (error) {
    log("[background-agent] Background handoff ingestion error (best-effort, skipped):", {
      taskId: task.id,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/**
 * Build a fetch function that retrieves the last assistant text from a session
 * using the OpenCode SDK client's session.messages() API.
 *
 * This is the production binding; tests can provide a simpler substitute.
 */
export function createSessionMessageTextFetcher(
  client: {
    session: {
      messages: (args: { path: { id: string } }) => Promise<unknown>
    }
  },
): (sessionId: string) => Promise<string> {
  return async (sessionId: string): Promise<string> => {
    const response = await client.session.messages({
      path: { id: sessionId },
    })

    // Normalize response — try data first, then raw response
    const data = (response as Record<string, unknown>).data ?? response
    if (!Array.isArray(data)) {
      return ""
    }

    // Find the last assistant message with text/reasoning content
    const messages = data as Array<{
      info?: { role?: string }
      parts?: Array<{ type?: string; text?: string }>
    }>

    // Sort newest-first
    const assistantMessages = messages
      .filter((m) => m.info?.role === "assistant")
      .reverse()

    for (const msg of assistantMessages) {
      const textParts = (msg.parts ?? []).filter(
        (p) => p.type === "text" || p.type === "reasoning",
      )
      const content = textParts.map((p) => p.text ?? "").filter(Boolean).join("\n")
      if (content) {
        return content
      }
    }

    return ""
  }
}
