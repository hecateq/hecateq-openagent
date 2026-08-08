/**
 * Hecateq Handoff History Context — compact markdown renderer.
 *
 * Reads the recent handoff history ledger and renders a compact markdown
 * block suitable for prompt/context injection (~max 300 tokens at the
 * default 5 entries).
 */

import { loadRecentHandoffHistory } from "./handoff-history"
import type { HecateqHandoffHistoryEntry } from "./handoff-history"

/**
 * Build a compact markdown block from the last `maxEntries` handoff
 * history entries. Returns an empty string when there is no history.
 */
export function buildHandoffHistoryContext(maxEntries: number = 5): string {
  const entries = loadRecentHandoffHistory(maxEntries)
  if (entries.length === 0) return ""

  const lines = entries.map(renderEntry)
  return `# Recent Handoff History (last ${entries.length})\n${lines.join("\n")}`
}

function renderEntry(entry: HecateqHandoffHistoryEntry): string {
  const refs = [
    entry.task_graph_id ? `task_graph_id=${entry.task_graph_id}` : "",
    entry.task_id ? `task_id=${entry.task_id}` : "",
  ]
    .filter(Boolean)
    .join(" ")
  const refPart = refs.length > 0 ? ` | ${refs}` : ""
  return `- ${entry.timestamp} | ${entry.from_agent} → ${entry.to_agent}${refPart} | status=${entry.status} conf=${entry.confidence.toFixed(2)}`
}
