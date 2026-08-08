/**
 * Hecateq Handoff Runtime Validator
 *
 * Wraps `parseHandoffBlock` with strict validation plus a single repair
 * attempt. This is the gate every runtime handoff block passes through
 * before it is persisted or routed:
 *
 *  1. Strict parse once.
 *  2. If only warnings → accept as-is (`ok: true, repaired: false`).
 *  3. If any errors → attempt ONE loose repair parse.
 *  4. Loose parse yields status + handoff → accept (`ok: true, repaired: true`).
 *  5. Otherwise → `ok: false` with a blocker string describing the failure.
 *
 * It never throws, never fabricates a block, and never silently accepts
 * an unusable handoff.
 */

import { parseHandoffBlock } from "./handoff-parser"
import type { HandoffBlock } from "./handoff-parser"

export type HandoffValidatedResult =
  | { ok: true; block: HandoffBlock; repaired: boolean }
  | { ok: false; block: HandoffBlock | null; blocker: string }

/**
 * Validate a raw handoff block, applying one repair attempt on error.
 */
export function validateHandoffWithRepair(input: unknown): HandoffValidatedResult {
  const raw = typeof input === "string" ? input : String(input ?? "")
  const strict = parseHandoffBlock(raw)

  const hasErrors = strict.validationIssues.some((issue) => issue.severity === "error")
  if (!hasErrors) {
    return { ok: true, block: strict, repaired: false }
  }

  // Single repair attempt: downgrade errors to warnings and re-parse.
  const loose = parseHandoffBlock(raw, { loose: true })
  if (loose.status && loose.handoff) {
    return { ok: true, block: loose, repaired: true }
  }

  return {
    ok: false,
    block: null,
    blocker: buildBlocker(loose),
  }
}

function buildBlocker(loose: HandoffBlock): string {
  const missing: string[] = []
  if (!loose.status) missing.push("STATUS")
  if (!loose.handoff) missing.push("HANDOFF")

  const detail =
    missing.length > 0
      ? `missing/invalid ${missing.join(", ")}`
      : "block is unusable after repair attempt"
  const issueCount = loose.validationIssues.length
  return `Handoff repair failed: ${detail}${issueCount > 0 ? ` (${issueCount} validation issue(s) remain)` : ""}`
}
