/**
 * Hecateq Runtime Handoff Parser
 *
 * Parses agent output blocks of the form:
 *   STATUS: [DONE | IN_PROGRESS | BLOCKED]
 *   SIGNALS_EMITTED: [{"signal":"<name>","payload":{}}]
 *   HANDOFF: [return_to_caller | return_to_parent_for_routing | <agent-id>]
 *
 * The parser never throws on malformed input. Validation issues are captured
 * in the result's `validationIssues` array.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type HandoffStatus = "DONE" | "IN_PROGRESS" | "BLOCKED"

export type HandoffTarget = "return_to_caller" | "return_to_parent_for_routing" | (string & {})

export interface HandoffSignal {
  signal: string
  payload: Record<string, unknown>
}

export interface HandoffValidationIssue {
  field: "STATUS" | "SIGNALS_EMITTED" | "HANDOFF"
  message: string
  severity: "error" | "warning"
}

export interface HandoffBlock {
  /** Parsed status, or null if missing/invalid */
  status: HandoffStatus | null
  /** Parsed signals (always an array — empty on missing/invalid) */
  signals: HandoffSignal[]
  /** Parsed handoff target, or null if missing */
  handoff: HandoffTarget | null
  /** Validation issues collected during parsing (never throws) */
  validationIssues: HandoffValidationIssue[]
  /** Raw input that was parsed */
  raw: string
}

// ─── Constants ───────────────────────────────────────────────────────────────

export const VALID_HANDOFF_STATUSES: ReadonlySet<string> = new Set(["DONE", "IN_PROGRESS", "BLOCKED"])

export const VALID_HANDOFF_TARGETS: ReadonlySet<string> = new Set([
  "return_to_caller",
  "return_to_parent_for_routing",
])

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeLineValue(value: string): string {
  return value.trim()
}

// ─── Parser ───────────────────────────────────────────────────────────────────

/**
 * Parse an agent output block into a normalized HandoffBlock.
 * Never throws — malformed input produces validation issues.
 */
export function parseHandoffBlock(input: string): HandoffBlock {
  const validationIssues: HandoffValidationIssue[] = []
  const lines = input.split("\n")

  let rawStatus: string | null = null
  let rawSignalsJson: string | null = null
  let rawHandoff: string | null = null

  // Walk lines collecting values (last occurrence wins for duplicates)
  for (const rawLine of lines) {
    const line = rawLine.trim()

    if (line.startsWith("STATUS:")) {
      rawStatus = normalizeLineValue(line.slice("STATUS:".length))
    } else if (line.startsWith("SIGNALS_EMITTED:")) {
      rawSignalsJson = normalizeLineValue(line.slice("SIGNALS_EMITTED:".length))
    } else if (line.startsWith("HANDOFF:")) {
      rawHandoff = normalizeLineValue(line.slice("HANDOFF:".length))
    }
    // unknown lines are ignored
  }

  // ── Parse STATUS ──────────────────────────────────────────────────────────
  let status: HandoffStatus | null = null
  if (rawStatus === null || rawStatus.length === 0) {
    if (rawStatus === null) {
      validationIssues.push({
        field: "STATUS",
        message: "STATUS line is missing",
        severity: "warning",
      })
    } else {
      validationIssues.push({
        field: "STATUS",
        message: "STATUS value is empty",
        severity: "error",
      })
    }
  } else {
    const normalized = rawStatus.toUpperCase()
    if (VALID_HANDOFF_STATUSES.has(normalized)) {
      status = normalized as HandoffStatus
    } else {
      validationIssues.push({
        field: "STATUS",
        message: `Unknown STATUS value "${rawStatus}"`,
        severity: "error",
      })
    }
  }

  // ── Parse SIGNALS_EMITTED ─────────────────────────────────────────────────
  let signals: HandoffSignal[] = []
  if (rawSignalsJson === null) {
    // Missing SIGNALS_EMITTED — default to empty array, no issue
  } else {
    try {
      const parsed = JSON.parse(rawSignalsJson)
      if (Array.isArray(parsed)) {
        signals = parsed as HandoffSignal[]
      } else {
        validationIssues.push({
          field: "SIGNALS_EMITTED",
          message: "SIGNALS_EMITTED value is not a JSON array",
          severity: "error",
        })
      }
    } catch {
      validationIssues.push({
        field: "SIGNALS_EMITTED",
        message: "SIGNALS_EMITTED contains invalid JSON",
        severity: "error",
      })
    }
  }

  // ── Parse HANDOFF ─────────────────────────────────────────────────────────
  let handoff: HandoffTarget | null = null
  if (rawHandoff === null) {
    validationIssues.push({
      field: "HANDOFF",
      message: "HANDOFF line is missing",
      severity: "warning",
    })
  } else if (rawHandoff.length === 0) {
    validationIssues.push({
      field: "HANDOFF",
      message: "HANDOFF target is empty",
      severity: "error",
    })
  } else {
    handoff = rawHandoff as HandoffTarget
  }

  return {
    status,
    signals,
    handoff,
    validationIssues,
    raw: input,
  }
}

/**
 * Return the set of known agent IDs for handoff target validation.
 */
export function getKnownAgentIds(): string[] {
  return [
    "return_to_caller",
    "return_to_parent_for_routing",
    "sisyphus",
    "hephaestus",
    "prometheus",
    "oracle",
    "librarian",
    "explore",
    "atlas",
    "nodejs-backend-developer",
    "nodejs-backend-architect",
    "go-backend-developer",
    "database-specialist",
    "qa-test-engineer",
    "security-architect",
    "performance-specialist",
    "devops-engineer",
    "coolify-devops-specialist",
    "realtime-systems-expert",
    "compliance-specialist",
    "design-translator",
    "nextjs-ui-wizard",
    "flutter-dart-master",
    "python-ml-engineer",
    "refactoring-specialist",
    "release-manager",
    "technical-writer-documentarian",
  ]
}
