import { log } from "../../shared"

/**
 * Maximum number of messages to walk backward through when
 * searching for a reply-required wake event.
 */
const MAX_TAIL_DEPTH = 10

/**
 * A simplified message representation for tail resolution.
 * Mirrors the shape used by ParentWakeNotifier's message inspection.
 */
export interface SessionTailMessage {
  role?: string
  info?: {
    role?: string
    finish?: string
  }
  parts?: Array<{
    type?: string
    text?: string
    synthetic?: boolean
  }>
}

/**
 * A reply-required wake signal found in the session tail.
 */
export interface WakeSignal {
  /** Position offset from the end of the tail (0 = last message). */
  offsetFromEnd: number
  /** Whether the wake signal expects a reply. */
  shouldReply: boolean
  /** Whether this was found via a synthetic/internal user message (likely a prior wake). */
  isInternalWake: boolean
}

function getMessageRole(message: SessionTailMessage): string | undefined {
  return message.info?.role ?? message.role
}

function isSyntheticOrInternalRole(message: SessionTailMessage): boolean {
  const role = getMessageRole(message)
  if (role !== "user") return false
  return message.parts?.some((part) => part.synthetic === true) ?? false
}

/**
 * Check if a message body contains a `noReply` flag.
 * OpenCode's promptAsync accepts `noReply: true` in the body, which means
 * the model won't emit a response. When the last message in the tail is
 * a `noReply` wake, the parent session's model won't react to it, and
 * the wake signal is effectively lost — causing a deadlock where the
 * background task reports completion but the parent never sees it.
 */
function messageHasNoReply(body: unknown): boolean {
  if (body === null || body === undefined) return false
  if (typeof body !== "object") return false
  const record = body as Record<string, unknown>
  if (record.noReply === true) return true
  if (record.body !== null && typeof record.body === "object") {
    const inner = record.body as Record<string, unknown>
    if (inner.noReply === true) return true
  }
  return false
}

/**
 * Walk backward through the session tail to find the nearest
 * reply-required wake event, skipping `noReply` entries.
 *
 * The session tail is expected to be the last N messages of a session,
 * ordered chronologically (oldest first, newest last).
 *
 * Algorithm:
 * 1. Start from the last message
 * 2. Skip messages that are known `noReply` dispatches or synthetic/internal user messages
 * 3. Find the first (walking backward) user message that is NOT synthetic
 * 4. Returns that as the reply-required wake anchor
 * 5. If only noReply/synthetic entries exist, returns null (no wake needed)
 *
 * @param tail - Array of session messages (oldest first, newest last)
 * @param maxDepth - Maximum messages to walk backward (default 10)
 * @returns WakeSignal or null if no reply-required wake is found
 */
export function findReplyRequiredWake(
  tail: SessionTailMessage[],
  maxDepth: number = MAX_TAIL_DEPTH,
): WakeSignal | null {
  if (!tail || tail.length === 0) {
    log("[background-agent] WakeTailResolver: empty tail, no wake needed")
    return null
  }

  const searchLimit = Math.min(tail.length, maxDepth)
  let walked = 0

  for (let index = tail.length - 1; index >= 0 && walked < searchLimit; index--, walked++) {
    const message = tail[index]
    if (!message) continue

    const role = getMessageRole(message)

    // Skip non-user messages (assistant, tool, system)
    if (role !== "user") continue

    // Skip synthetic/internal user messages (these are prior wake injections)
    if (isSyntheticOrInternalRole(message)) {
      log("[background-agent] WakeTailResolver: skipping synthetic user message", {
        index,
        offsetFromEnd: tail.length - 1 - index,
      })
      continue
    }

    // Found a real user message — this is the reply anchor
    log("[background-agent] WakeTailResolver: found reply-required wake anchor", {
      offsetFromEnd: tail.length - 1 - index,
      walked,
    })
    return {
      offsetFromEnd: tail.length - 1 - index,
      shouldReply: true,
      isInternalWake: false,
    }
  }

  // Walked the entire tail and found only synthetic/internal messages
  // or no messages at all — no reply-required wake exists
  log("[background-agent] WakeTailResolver: no reply-required wake found in tail", {
    tailLength: tail.length,
    walked,
  })
  return null
}

/**
 * Check if the last message in the tail is a `noReply` dispatch.
 * Used by the prompt-async-gate to decide whether to suppress
 * "active" status returns that would otherwise drop a wake.
 *
 * If the tail ends with a `noReply` message, the gate should
 * NOT return "active" even if the session looks busy — the wake
 * was already consumed by the parent but without a reply, so
 * a new wake slot should remain open.
 */
export function lastMessageIsNoReply(tail: SessionTailMessage[]): boolean {
  if (!tail || tail.length === 0) return false
  const last = tail[tail.length - 1]
  if (!last) return false
  if (getMessageRole(last) !== "user") return false
  // Check parts for synthetic marker (internal wake messages are synthetic)
  const hasSyntheticPart = last.parts?.some((part) => part.synthetic === true) ?? false
  if (!hasSyntheticPart) return false
  // Check if the text content indicates a noReply wake
  const textContent = last.parts?.map((p) => p.text ?? "").join(" ") ?? ""
  if (textContent.includes("BACKGROUND TASK") && textContent.includes("COMPLETED")) {
    return true
  }
  return false
}
