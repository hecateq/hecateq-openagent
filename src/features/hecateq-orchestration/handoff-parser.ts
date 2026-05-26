/**
 * Hecateq Runtime Handoff Parser — v2
 *
 * Parses agent output blocks of the form:
 *   STATUS: [DONE | IN_PROGRESS | BLOCKED]
 *   SIGNALS_EMITTED: [{"signal":"<name>","payload":{}}]
 *   HANDOFF: [return_to_caller | return_to_parent_for_routing | <agent-id>]
 *   CONFIDENCE: <0.0-1.0>                                    (v2)
 *   CHANGED_FILES: [{"path":"...","changeType":"..."}]        (v2)
 *   QUALITY_NOTES: <free text>                                (v2)
 *   BLOCKERS: [<reason>, ...]                                 (v2)
 *   NEXT_RECOMMENDED_AGENT: <agent-id>                        (v2)
 *
 * v2 fields are additive — the parser never throws on malformed input.
 * Backward compatible: v1 blocks parse identically to v2.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type HandoffStatus = "DONE" | "IN_PROGRESS" | "BLOCKED"

export type HandoffTarget = "return_to_caller" | "return_to_parent_for_routing" | (string & {})

export interface HandoffSignal {
  signal: string
  payload: Record<string, unknown>
}

export interface HandoffValidationIssue {
  field: "STATUS" | "SIGNALS_EMITTED" | "HANDOFF" | "CONFIDENCE" | "CHANGED_FILES" | "QUALITY_NOTES" | "BLOCKERS" | "NEXT_RECOMMENDED_AGENT"
  message: string
  severity: "error" | "warning"
}

export interface ChangedFileEntry {
  path: string
  changeType: "modified" | "created" | "deleted" | "unknown"
}

export interface HandoffBlock {
  /** Parsed status, or null if missing/invalid */
  status: HandoffStatus | null
  /** Parsed signals (always an array — empty on missing/invalid) */
  signals: HandoffSignal[]
  /** Parsed handoff target, or null if missing */
  handoff: HandoffTarget | null
  /** v2: Confidence score (0.0-1.0), or null if not provided */
  confidence: number | null
  /** v2: Files changed during this task */
  changedFiles: ChangedFileEntry[]
  /** v2: Free-text quality notes from the agent */
  qualityNotes: string | null
  /** v2: Blockers preventing further progress */
  blockers: string[]
  /** v2: Agent recommended for the next task */
  nextRecommendedAgent: string | null
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

/**
 * Try to parse a JSON value from a line, returning the parsed result or null.
 * Never throws — returns null on parse failure.
 */
function tryParseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

// ─── Parser ───────────────────────────────────────────────────────────────────

/**
 * Parse an agent output block into a normalized HandoffBlock (v2).
 * Never throws — malformed input produces validation issues.
 */
export function parseHandoffBlock(input: string): HandoffBlock {
  const validationIssues: HandoffValidationIssue[] = []
  const lines = input.split("\n")

  let rawStatus: string | null = null
  let rawSignalsJson: string | null = null
  let rawHandoff: string | null = null
  let rawConfidence: string | null = null
  let rawChangedFilesJson: string | null = null
  let rawQualityNotes: string | null = null
  let rawBlockersJson: string | null = null
  let rawNextAgent: string | null = null

  // Walk lines collecting values (last occurrence wins for duplicates)
  for (const rawLine of lines) {
    const line = rawLine.trim()

    if (line.startsWith("STATUS:")) {
      rawStatus = normalizeLineValue(line.slice("STATUS:".length))
    } else if (line.startsWith("SIGNALS_EMITTED:")) {
      rawSignalsJson = normalizeLineValue(line.slice("SIGNALS_EMITTED:".length))
    } else if (line.startsWith("HANDOFF:")) {
      rawHandoff = normalizeLineValue(line.slice("HANDOFF:".length))
    } else if (line.startsWith("CONFIDENCE:")) {
      rawConfidence = normalizeLineValue(line.slice("CONFIDENCE:".length))
    } else if (line.startsWith("CHANGED_FILES:")) {
      rawChangedFilesJson = normalizeLineValue(line.slice("CHANGED_FILES:".length))
    } else if (line.startsWith("QUALITY_NOTES:")) {
      rawQualityNotes = normalizeLineValue(line.slice("QUALITY_NOTES:".length))
    } else if (line.startsWith("BLOCKERS:")) {
      rawBlockersJson = normalizeLineValue(line.slice("BLOCKERS:".length))
    } else if (line.startsWith("NEXT_RECOMMENDED_AGENT:")) {
      rawNextAgent = normalizeLineValue(line.slice("NEXT_RECOMMENDED_AGENT:".length))
    }
    // unknown lines are ignored
  }

  // ── Parse STATUS ──────────────────────────────────────────────────────────
  let status: HandoffStatus | null = null
  if (rawStatus === null || rawStatus.length === 0) {
    if (rawStatus === null) {
      validationIssues.push({ field: "STATUS", message: "STATUS line is missing", severity: "warning" })
    } else {
      validationIssues.push({ field: "STATUS", message: "STATUS value is empty", severity: "error" })
    }
  } else {
    const normalized = rawStatus.toUpperCase()
    if (VALID_HANDOFF_STATUSES.has(normalized)) {
      status = normalized as HandoffStatus
    } else {
      validationIssues.push({ field: "STATUS", message: `Unknown STATUS value "${rawStatus}"`, severity: "error" })
    }
  }

  // ── Parse SIGNALS_EMITTED ─────────────────────────────────────────────────
  let signals: HandoffSignal[] = []
  if (rawSignalsJson !== null) {
    const parsed = tryParseJson<unknown>(rawSignalsJson)
    if (Array.isArray(parsed)) {
      signals = parsed as HandoffSignal[]
    } else {
      validationIssues.push({ field: "SIGNALS_EMITTED", message: "SIGNALS_EMITTED value is not a JSON array", severity: "error" })
    }
  }

  // ── Parse HANDOFF ─────────────────────────────────────────────────────────
  let handoff: HandoffTarget | null = null
  if (rawHandoff === null) {
    validationIssues.push({ field: "HANDOFF", message: "HANDOFF line is missing", severity: "warning" })
  } else if (rawHandoff.length === 0) {
    validationIssues.push({ field: "HANDOFF", message: "HANDOFF target is empty", severity: "error" })
  } else {
    handoff = rawHandoff as HandoffTarget
  }

  // ── v2: Parse CONFIDENCE ──────────────────────────────────────────────────
  let confidence: number | null = null
  if (rawConfidence !== null) {
    const parsed = Number(rawConfidence)
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
      confidence = parsed
    } else {
      validationIssues.push({ field: "CONFIDENCE", message: `CONFIDENCE must be a number between 0 and 1, got "${rawConfidence}"`, severity: "warning" })
    }
  }

  // ── v2: Parse CHANGED_FILES ───────────────────────────────────────────────
  let changedFiles: ChangedFileEntry[] = []
  if (rawChangedFilesJson !== null) {
    const parsed = tryParseJson<unknown>(rawChangedFilesJson)
    if (Array.isArray(parsed)) {
      changedFiles = parsed.filter(
        (entry): entry is ChangedFileEntry =>
          typeof entry === "object" && entry !== null && typeof (entry as ChangedFileEntry).path === "string",
      )
    } else {
      validationIssues.push({ field: "CHANGED_FILES", message: "CHANGED_FILES value is not a JSON array", severity: "warning" })
    }
  }

  // ── v2: Parse QUALITY_NOTES ───────────────────────────────────────────────
  let qualityNotes: string | null = null
  if (rawQualityNotes !== null) {
    qualityNotes = rawQualityNotes.length > 0 ? rawQualityNotes : null
  }

  // ── v2: Parse BLOCKERS ────────────────────────────────────────────────────
  let blockers: string[] = []
  if (rawBlockersJson !== null) {
    const parsed = tryParseJson<unknown>(rawBlockersJson)
    if (Array.isArray(parsed)) {
      blockers = parsed.filter((entry): entry is string => typeof entry === "string")
    } else {
      validationIssues.push({ field: "BLOCKERS", message: "BLOCKERS value is not a JSON array", severity: "warning" })
    }
  }

  // ── v2: Parse NEXT_RECOMMENDED_AGENT ──────────────────────────────────────
  let nextRecommendedAgent: string | null = null
  if (rawNextAgent !== null && rawNextAgent.length > 0) {
    nextRecommendedAgent = rawNextAgent
  }

  return {
    status,
    signals,
    handoff,
    confidence,
    changedFiles,
    qualityNotes,
    blockers,
    nextRecommendedAgent,
    validationIssues,
    raw: input,
  }
}

/**
 * Create a default HandoffBlock with the given overrides.
 * All v2 fields default to null/empty for backward compatibility.
 */
export function createDefaultHandoffBlock(overrides: Partial<HandoffBlock> & { status?: HandoffStatus | null; handoff?: HandoffTarget | null }): HandoffBlock {
  return {
    status: overrides.status ?? null,
    signals: overrides.signals ?? [],
    handoff: overrides.handoff ?? null,
    confidence: overrides.confidence ?? null,
    changedFiles: overrides.changedFiles ?? [],
    qualityNotes: overrides.qualityNotes ?? null,
    blockers: overrides.blockers ?? [],
    nextRecommendedAgent: overrides.nextRecommendedAgent ?? null,
    validationIssues: overrides.validationIssues ?? [],
    raw: overrides.raw ?? "",
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
