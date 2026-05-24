/**
 * Hecateq Handoff Context Injection
 *
 * Builds a compact handoff summary for injection into the Hecateq
 * agent's context block. When handoff state exists, the summary
 * surfaces the handoff status, target, and signal count.
 */

import type { HandoffBlock } from "./handoff-parser"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface HandoffContextSummary {
  /** The rendered summary string (empty if no handoff state) */
  summary: string
  /** Whether a handoff state exists */
  hasHandoff: boolean
  /** Number of signals in the handoff */
  signalCount: number
}

// ─── Context Builder ─────────────────────────────────────────────────────────

/**
 * Build a compact handoff live summary for context injection.
 *
 * Returns a summary block with an empty `summary` field when
 * handoff is null (no handoff state exists).
 */
export function buildHandoffContextSummary(
  handoff: HandoffBlock | null,
): HandoffContextSummary {
  if (!handoff) {
    return { summary: "", hasHandoff: false, signalCount: 0 }
  }

  const hasHandoff = true
  const signalCount = handoff.signals.length
  const parts: string[] = []

  if (handoff.status) {
    parts.push(`status=${handoff.status}`)
  } else {
    parts.push("status=unknown")
  }

  if (handoff.handoff) {
    parts.push(`target=${handoff.handoff}`)
  }

  if (signalCount > 0) {
    const signalNames = handoff.signals.map((s) => s.signal).join(", ")
    parts.push(`signals=${signalCount}(${signalNames})`)
  }

  if (handoff.validationIssues && handoff.validationIssues.length > 0) {
    parts.push(`validation=${handoff.validationIssues.length} issue(s)`)
  }

  const summary = parts.length > 0 ? `Handoff: ${parts.join(" | ")}` : ""

  return { summary, hasHandoff, signalCount }
}
