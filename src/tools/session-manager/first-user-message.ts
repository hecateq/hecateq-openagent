/**
 * First User Message Resolver
 *
 * Resolves the canonical first user message for a session by reading
 * session message storage. Falls back through multiple sources when
 * session messages are unavailable.
 *
 * Source precedence:
 *   1. Canonical session messages (first real user message via storage)
 *   2. Continuation state (objective from continuation.json)
 *   3. Memory (active-context.md objective)
 *   4. "unknown" if nothing found
 */

import type { SessionMessage } from "./types"
import { readSessionMessages } from "./storage"
import { log } from "../../shared/logger"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FirstUserMessageResult {
  /** The resolved first user message text */
  text: string
  /** Which source provided the message */
  source: "session" | "continuation" | "memory" | "unknown"
  /** The session ID used when source is "session" */
  sessionID?: string
}

export interface ResolveFirstUserMessageDeps {
  readSessionMessages: (sessionID: string) => Promise<SessionMessage[]>
  readContinuation?: (projectRoot: string) => { work_state?: { objective?: string } } | null
  readActiveContext?: (projectRoot: string) => string | null
}

// ─── Synthetic Message Detection ─────────────────────────────────────────────

/**
 * Patterns that identify synthetic / non-user messages.
 * These are messages injected by the system, plugins, or automation
 * and should NOT be treated as the "first user request."
 */
const SYNTHETIC_MARKERS = [
  "<command-instruction>",
  "<session-context>",
  "<system-reminder>",
  "<user-request>",
  "<user-task>",
  "<hecateq-",
  "<omo-",
  "OMO_INTERNAL",
  "BACKGROUND_WAKE",
  "BACKGROUND_TASK",
  "[tool ",
  "[tool_",
  "[thinking]",
  "[tool result]",
  "TO CONTINUE IN A NEW SESSION",
  "HANDOFF CONTEXT",
  "ULTRAWORK MODE ENABLED",
  "Continue from the handoff context",
  "Please continue working",
  "You are running in background",
  "Background task wake",
  "The task is now running",
]

/** Length threshold — messages longer than this are likely system prompts */
const MAX_USER_MESSAGE_LENGTH = 4000

/** Minimum length for a message to be considered a meaningful user request */
const MIN_USER_MESSAGE_LENGTH = 3

/**
 * Returns true if the text looks synthetic (system-injected, not a real user message).
 */
function isSyntheticMessage(text: string): boolean {
  if (!text || text.trim().length === 0) return true
  if (text.length > MAX_USER_MESSAGE_LENGTH) return true

  const trimmed = text.trim()

  for (const marker of SYNTHETIC_MARKERS) {
    if (trimmed.includes(marker)) return true
  }

  return false
}

/**
 * Returns true if a message part is a "real" text part (not a tool, thinking, etc.).
 */
function isTextPart(part: { type: string; text?: string }): part is { type: "text"; text: string } {
  return part.type === "text" && typeof part.text === "string" && part.text.trim().length > 0
}

/**
 * Extract the first meaningful text from a user message.
 * Skips tool-related parts and picks the first genuine text part.
 */
function extractUserText(message: SessionMessage): string | null {
  if (message.role !== "user") return null

  for (const part of message.parts) {
    if (isTextPart(part)) {
      const text = part.text.trim()
      if (text.length >= MIN_USER_MESSAGE_LENGTH && !isSyntheticMessage(text)) {
        return text
      }
    }
  }

  return null
}

// ─── Core Resolver ───────────────────────────────────────────────────────────

/**
 * Find the first real user message in a sorted array of session messages.
 * Messages are expected to be sorted by time (ascending).
 */
export function findFirstUserMessage(messages: SessionMessage[]): string | null {
  for (const msg of messages) {
    const text = extractUserText(msg)
    if (text !== null) return text
  }
  return null
}

/**
 * Resolve the first user message for a session.
 *
 * **Source precedence:**
 * 1. **session** — canonical session messages from OpenCode storage
 * 2. **continuation** — objective from continuation.json (if available)
 * 3. **memory** — active-context.md first goal line (if available)
 * 4. **unknown** — nothing found
 *
 * @param sessionID - The session ID to look up
 * @param projectRoot - Project root for memory/continuation fallback (optional)
 * @param deps - Injectable dependencies for testability
 */
export async function resolveFirstUserMessage(
  sessionID: string,
  projectRoot?: string,
  deps?: Partial<ResolveFirstUserMessageDeps>,
): Promise<FirstUserMessageResult> {
  const resolvedDeps: ResolveFirstUserMessageDeps = {
    readSessionMessages,
    ...deps,
  }

  // ── 1. Try canonical session messages ─────────────────────────────────
  try {
    const messages = await resolvedDeps.readSessionMessages(sessionID)
    if (messages.length > 0) {
      const text = findFirstUserMessage(messages)
      if (text) {
        log("first-user-message: resolved from session messages", {
          sessionID,
          source: "session",
          textLength: text.length,
        })
        return { text, source: "session", sessionID }
      }
    }
  } catch (err) {
    log("first-user-message: session read failed, trying fallbacks", {
      sessionID,
      error: String(err),
    })
  }

  // ── 2. Try continuation state ─────────────────────────────────────────
  if (projectRoot && resolvedDeps.readContinuation) {
    try {
      const continuation = resolvedDeps.readContinuation(projectRoot)
      if (continuation?.work_state?.objective && continuation.work_state.objective.trim().length > 0) {
        const text = continuation.work_state.objective.trim()
        log("first-user-message: resolved from continuation", {
          sessionID,
          source: "continuation",
          textLength: text.length,
        })
        return { text, source: "continuation" }
      }
    } catch (err) {
      log("first-user-message: continuation read failed, trying memory fallback", {
        sessionID,
        error: String(err),
      })
    }
  }

  // ── 3. Try memory (active-context.md) ─────────────────────────────────
  if (projectRoot && resolvedDeps.readActiveContext) {
    try {
      const activeContext = resolvedDeps.readActiveContext(projectRoot)
      if (activeContext) {
        // Extract the first goal/objective line from active-context
        const goalMatch = activeContext.match(/^[-*]\s+(?:Goal|Objective|Current goal|Task):\s*(.+)$/im)
        if (goalMatch?.[1]?.trim()) {
          const text = goalMatch[1].trim()
          log("first-user-message: resolved from memory (active-context)", {
            sessionID,
            source: "memory",
            textLength: text.length,
          })
          return { text, source: "memory" }
        }

        // Fallback: first non-empty, non-header line
        const lines = activeContext.split("\n")
        for (const line of lines) {
          const trimmed = line.trim()
          if (trimmed.length > MIN_USER_MESSAGE_LENGTH && !trimmed.startsWith("#")) {
            log("first-user-message: resolved from memory (active-context first line)", {
              sessionID,
              source: "memory",
              textLength: trimmed.length,
            })
            return { text: trimmed, source: "memory" }
          }
        }
      }
    } catch (err) {
      log("first-user-message: memory read failed", {
        sessionID,
        error: String(err),
      })
    }
  }

  // ── 4. Nothing found ──────────────────────────────────────────────────
  log("first-user-message: no source available", { sessionID, source: "unknown" })
  return { text: "unknown", source: "unknown" }
}
