/**
 * Hecateq Handoff History Injection — prompt-builder wrapper.
 *
 * Thin wrapper around `buildHandoffHistoryContext` that wraps the compact
 * history block in a clear tag for prompt builders. Returns an empty
 * string when there is no history so callers can skip injection cleanly.
 */

import { buildHandoffHistoryContext } from "./handoff-history-context"

/**
 * Build a tagged handoff-history context block for prompt injection.
 */
export function buildHandoffHistoryContextBlock(
  maxEntries: number = 5,
): string {
  const inner = buildHandoffHistoryContext(maxEntries)
  if (inner.length === 0) return ""
  return `<recent_handoff_history>\n${inner}\n</recent_handoff_history>`
}
