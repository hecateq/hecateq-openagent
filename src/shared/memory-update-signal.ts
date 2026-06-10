/**
 * Memory Update Signal Parser — Phase 3B.2
 *
 * Parses <MEMORY_UPDATE>{json}</MEMORY_UPDATE> blocks from agent output text.
 * Subagents emit structured MEMORY_UPDATE signals instead of writing memory
 * files directly. Designated memory writers consume these signals.
 *
 * Strict block format: <MEMORY_UPDATE>{json}</MEMORY_UPDATE>
 * - Malformed JSON logs/skips — never throws
 * - Unknown fields ignored, optional fields allowed
 * - Entry-by-entry validation
 * - Generated paths and absolute paths rejected/filtered
 * - Allowed status: completed, blocked, in_progress, cancelled
 * - Does NOT infer from broad prose
 */

import { log } from "./logger"

// ---------------------------------------------------------------------------
// MEMORY_UPDATE Completion Contract (Phase 3B.2a)
// ---------------------------------------------------------------------------

/**
 * Hecateq Memory Update Completion Contract — injected into agent prompts
 * so subagents know how to emit structured MEMORY_UPDATE signals instead of
 * writing memory files directly.
 *
 * Phase 3B.2a: Prompt contract injection.
 * Phase 3B.2:  Parser, router, and subagent guard (runtime baseline).
 */
export const MEMORY_UPDATE_CONTRACT = `MEMORY UPDATE COMPLETION CONTRACT

Do NOT directly edit files under .opencode/state/memory/. Memory writers are the
only components that write those files.

At task completion, if you have useful project memory to report, emit exactly ONE
valid JSON block:

<MEMORY_UPDATE>
{
  "session_id": "<current-session-id>",
  "agent_name": "<your-agent-name>",
  "status": "completed",
  "entries": [
    {
      "target": "changed_files",
      "action": "append",
      "data": {
        "files": ["src/foo.ts", "src/bar.ts"],
        "reason": "implemented feature X"
      }
    }
  ]
}
</MEMORY_UPDATE>

Rules:
- JSON ONLY inside the block — no surrounding prose, no markdown fences.
- Use RELATIVE source paths only (e.g. "src/foo.ts"). No absolute paths.
- Do NOT include generated/build paths: .next/, node_modules/, dist/, build/,
  coverage/, .turbo/, .cache/, out/, .git/.
- Do NOT invent tests, files, risks, decisions, next actions, or verification
  results that were not actual work products.
- Include "decisions" entries ONLY when an explicit durable architecture or
  policy decision was made. Routine implementation choices are NOT decisions.
- Include "quality" entries ONLY when a command (test, lint, typecheck, build)
  actually ran and produced output, or was explicitly skipped for a documented
  reason. Never fabricate quality results.
- Omit empty fields. Omit the entire block when no useful update exists.
- Do NOT write decisions.md or tasks.md directly. The Hecateq memory router and
  designated writers handle persistence from your MEMORY_UPDATE block.`

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Valid task status values for memory update signals. */
export const VALID_MEMORY_UPDATE_STATUSES = [
  "completed",
  "blocked",
  "in_progress",
  "cancelled",
] as const

export type MemoryUpdateStatus = (typeof VALID_MEMORY_UPDATE_STATUSES)[number]

/** Known/generated path patterns that are never valid memory entries. */
const GENERATED_PATH_PATTERNS = [
  /(^|\/)dist\//,
  /(^|\/)build\//,
  /(^|\/)\.next\//,
  /(^|\/)node_modules\//,
  /(^|\/)coverage\//,
  /(^|\/)\.turbo\//,
  /(^|\/)\.cache\//,
  /(^|\/)out\//,
  /(^|\/)\.git\//,
  /(^|\/)__pycache__\//,
  /(^|\/)\.svelte-kit\//,
]

/** A single entry within a MEMORY_UPDATE signal. */
export interface MemoryUpdateEntry {
  /** The memory file or category to update (e.g. "decisions", "changed_files"). */
  target: string
  /** Action: append, update, render, etc. */
  action?: string
  /** Structured data to write — shape depends on target. */
  data?: Record<string, unknown>
  /** Optional: free-text description of the update. */
  description?: string
}

/** A parsed MEMORY_UPDATE signal (one <MEMORY_UPDATE> block). */
export interface MemoryUpdateSignal {
  /** Session or task ID that produced this signal. */
  sessionId?: string
  /** Agent name that produced this signal. */
  agentName?: string
  /** Overall status of the task that produced this signal. */
  status?: MemoryUpdateStatus
  /** Entries to write to memory files. */
  entries: MemoryUpdateEntry[]
  /** Raw JSON string that was parsed. */
  raw: string
  /** Validation issues found during parsing. */
  validationIssues: string[]
}

/** A quarantined (unparseable) MEMORY_UPDATE block. */
export interface QuarantinedBlock {
  /** Truncated snippet of the raw content (max 200 chars). */
  snippet: string
  /** Reason the block was quarantined. */
  reason: string
  /** Approximate line number where the block was found (0-based from the start of text). */
  line?: number
}

/** Result of parsing memory update signals from text. */
export interface MemoryUpdateParseResult {
  /** Valid signals parsed from the text. */
  signals: MemoryUpdateSignal[]
  /** Count of blocks that were found but failed to parse. */
  malformedBlocks: number
  /** Top-level parse issues (e.g. text-level problems). */
  issues: string[]
  /** Blocks that were found but could not be parsed (quarantined). */
  quarantinedBlocks: QuarantinedBlock[]
}

/** Validation result for a single signal. */
export interface MemoryUpdateValidationResult {
  valid: boolean
  issues: string[]
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Regex to find <MEMORY_UPDATE> blocks. Uses [^<] to avoid nested block issues. */
const MEMORY_UPDATE_BLOCK_RE = /<MEMORY_UPDATE>([\s\S]*?)<\/MEMORY_UPDATE>/g

/** Known valid target identifiers for routing. */
const KNOWN_TARGETS = new Set([
  "changed_files",
  "decisions",
  "quality",
  "risks",
  "open_questions",
  "next_actions",
  "changed_files_summary",
])

// ---------------------------------------------------------------------------
// Path validation
// ---------------------------------------------------------------------------

/**
 * Check if a path looks like a generated/build artifact path.
 * These paths are NEVER valid for memory entries.
 */
function isGeneratedPath(path: string): boolean {
  if (!path) return false
  for (const pattern of GENERATED_PATH_PATTERNS) {
    if (pattern.test(path)) return true
  }
  return false
}

/**
 * Check if a path is absolute (starts with / or drive letter).
 * Absolute paths are rejected — only project-relative paths are allowed.
 */
function isAbsolutePath(path: string): boolean {
  if (!path) return false
  if (path.startsWith("/")) return true
  if (/^[A-Za-z]:[/\\]/.test(path)) return true
  return false
}

// ---------------------------------------------------------------------------
// Status validation
// ---------------------------------------------------------------------------

function isValidStatus(value: unknown): value is MemoryUpdateStatus {
  if (typeof value !== "string") return false
  return (VALID_MEMORY_UPDATE_STATUSES as readonly string[]).includes(value)
}

// ---------------------------------------------------------------------------
// Entry validation
// ---------------------------------------------------------------------------

/**
 * Validate a single MemoryUpdateEntry.
 * Returns validation issues — empty array means valid.
 */
function validateEntry(entry: unknown, index: number): string[] {
  const issues: string[] = []

  if (!entry || typeof entry !== "object") {
    issues.push(`Entry ${index}: not an object`)
    return issues
  }

  const obj = entry as Record<string, unknown>

  // target is required
  if (!obj.target || typeof obj.target !== "string") {
    issues.push(`Entry ${index}: missing required field "target"`)
  } else if (!KNOWN_TARGETS.has(obj.target as string)) {
    // Unknown target — not an error, just not routable
    issues.push(`Entry ${index}: unknown target "${obj.target as string}" — will be skipped by router`)
  }

  // data: if present, must be an object
  if (obj.data !== undefined && obj.data !== null && typeof obj.data !== "object") {
    issues.push(`Entry ${index}: "data" must be an object`)
  }

  // Filter generated/absolute paths from data.files
  if (obj.data && typeof obj.data === "object") {
    const data = obj.data as Record<string, unknown>
    if (Array.isArray(data.files)) {
      const originalLength = data.files.length
      data.files = data.files.filter(
        (f: unknown) => typeof f === "string" && !isGeneratedPath(f) && !isAbsolutePath(f),
      )
      const removed = originalLength - (data.files as unknown[]).length
      if (removed > 0) {
        issues.push(
          `Entry ${index}: removed ${removed} generated/absolute path(s) from data.files`,
        )
      }
    }
    // Also filter path field
    if (typeof data.path === "string") {
      if (isGeneratedPath(data.path) || isAbsolutePath(data.path)) {
        delete data.path
        issues.push(`Entry ${index}: removed generated/absolute "path" field`)
      }
    }
  }

  // action: if present, must be string
  if (obj.action !== undefined && typeof obj.action !== "string") {
    issues.push(`Entry ${index}: "action" must be a string`)
  }

  // description: if present, must be string
  if (obj.description !== undefined && typeof obj.description !== "string") {
    issues.push(`Entry ${index}: "description" must be a string`)
  }

  return issues
}

// ---------------------------------------------------------------------------
// Signal validation
// ---------------------------------------------------------------------------

/**
 * Validate a parsed MemoryUpdateSignal.
 * Returns entry-by-entry validation result. Never throws.
 */
export function validateMemoryUpdateSignal(
  signal: MemoryUpdateSignal,
): MemoryUpdateValidationResult {
  const issues: string[] = []

  // Status validation
  if (signal.status !== undefined && !isValidStatus(signal.status)) {
    issues.push(
      `Invalid status "${signal.status}". Allowed: ${VALID_MEMORY_UPDATE_STATUSES.join(", ")}`,
    )
  }

  // Entry-by-entry validation
  for (let i = 0; i < signal.entries.length; i++) {
    const entryIssues = validateEntry(signal.entries[i], i)
    issues.push(...entryIssues)
  }

  return {
    valid: issues.length === 0,
    issues,
  }
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

/**
 * Parse all <MEMORY_UPDATE> blocks from agent output text.
 *
 * Does NOT parse partial streaming chunks, user prompts, context injection
 * text, message.updated, or session.idle content. Only complete blocks
 * in the provided text are parsed.
 *
 * Malformed JSON logs a warning and skips — never throws.
 * Unknown fields are ignored.
 * Optional fields are allowed.
 * All entries pass through entry-by-entry validation with path filtering.
 *
 * @param text - The agent output text to parse
 * @returns MemoryUpdateParseResult with valid signals and malformed count
 */
/** Maximum length for quarantined block snippets to avoid giant output. */
const QUARANTINE_SNIPPET_MAX_LENGTH = 200

/** Markdown code fence patterns to strip from inside MEMORY_UPDATE blocks. */
const MARKDOWN_FENCE_RE = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/s

/**
 * Try to extract JSON from a potentially markdown-fenced string.
 * Returns the cleaned JSON string, or null if fence stripping yields nothing useful.
 */
function tryStripMarkdownFence(raw: string): string | null {
  const trimmed = raw.trim()
  const fenceMatch = trimmed.match(MARKDOWN_FENCE_RE)
  if (fenceMatch?.[1]) {
    const inner = fenceMatch[1].trim()
    if (inner.length > 0) return inner
    return null
  }
  return null
}

export function parseMemoryUpdateSignals(
  text: string,
): MemoryUpdateParseResult {
  const signals: MemoryUpdateSignal[] = []
  let malformedBlocks = 0
  const issues: string[] = []
  const quarantinedBlocks: QuarantinedBlock[] = []

  if (!text || typeof text !== "string" || text.trim().length === 0) {
    return { signals, malformedBlocks: 0, issues: [], quarantinedBlocks: [] }
  }

  // Reset regex state
  MEMORY_UPDATE_BLOCK_RE.lastIndex = 0
  let match: RegExpExecArray | null

  const lines = text.split("\n")

  while ((match = MEMORY_UPDATE_BLOCK_RE.exec(text)) !== null) {
    const rawJson = match[1].trim()

    if (rawJson.length === 0) {
      malformedBlocks++
      quarantinedBlocks.push({
        snippet: "",
        reason: "Empty MEMORY_UPDATE block",
      })
      log("memory-update-signal: Empty MEMORY_UPDATE block — skipping", {})
      continue
    }

    // Try markdown fence stripping first — if rawJson looks like a code fence, extract inner content
    let jsonToParse = rawJson
    let usedFencing = false
    const stripped = tryStripMarkdownFence(rawJson)
    if (stripped !== null) {
      jsonToParse = stripped
      usedFencing = true
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(jsonToParse)
    } catch {
      malformedBlocks++
      // Compute approximate line number
      const blockStart = match.index
      let approxLine = 0
      let charCount = 0
      for (let i = 0; i < lines.length; i++) {
        charCount += lines[i].length + 1 // +1 for newline
        if (charCount > blockStart) {
          approxLine = i
          break
        }
      }
      const snippet = rawJson.length > QUARANTINE_SNIPPET_MAX_LENGTH
        ? rawJson.slice(0, QUARANTINE_SNIPPET_MAX_LENGTH) + "..."
        : rawJson
      quarantinedBlocks.push({
        snippet,
        reason: usedFencing
          ? "Malformed JSON inside markdown code fence in MEMORY_UPDATE block"
          : "Malformed JSON in MEMORY_UPDATE block",
        line: approxLine,
      })
      log("memory-update-signal: Malformed JSON in MEMORY_UPDATE block — skipping", {
        snippet: rawJson.slice(0, 200),
        usedFencing,
      })
      continue
    }

    // Must be an object (JSON primitives, arrays, null are malformed)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      malformedBlocks++
      const snippet = rawJson.length > QUARANTINE_SNIPPET_MAX_LENGTH
        ? rawJson.slice(0, QUARANTINE_SNIPPET_MAX_LENGTH) + "..."
        : rawJson
      quarantinedBlocks.push({
        snippet,
        reason: Array.isArray(parsed)
          ? "MEMORY_UPDATE block must contain a JSON object, got array"
          : "MEMORY_UPDATE block must contain a JSON object, got primitive or null",
      })
      log("memory-update-signal: MEMORY_UPDATE block must contain a JSON object — skipping", {})
      continue
    }

    const obj = parsed as Record<string, unknown>

    // Extract known fields, ignore unknown
    const sessionId =
      typeof obj.session_id === "string" ? obj.session_id : undefined
    const agentName =
      typeof obj.agent_name === "string" ? obj.agent_name : undefined
    const status =
      typeof obj.status === "string" && isValidStatus(obj.status)
        ? (obj.status as MemoryUpdateStatus)
        : undefined

    // entries: must be an array
    let entries: MemoryUpdateEntry[] = []
    if (Array.isArray(obj.entries)) {
      entries = obj.entries
        .filter(
          (e: unknown): e is Record<string, unknown> =>
            e !== null && typeof e === "object",
        )
        .map((e: Record<string, unknown>) => ({
          target: typeof e.target === "string" ? e.target : "",
          action: typeof e.action === "string" ? e.action : undefined,
          data:
            e.data !== null && typeof e.data === "object"
              ? (e.data as Record<string, unknown>)
              : undefined,
          description:
            typeof e.description === "string" ? e.description : undefined,
        }))
    } else if (obj.entries !== undefined) {
      malformedBlocks++
      const snippet = rawJson.length > QUARANTINE_SNIPPET_MAX_LENGTH
        ? rawJson.slice(0, QUARANTINE_SNIPPET_MAX_LENGTH) + "..."
        : rawJson
      quarantinedBlocks.push({
        snippet,
        reason: "entries field must be an array",
      })
      log("memory-update-signal: entries field must be an array — skipping block", {})
      continue
    }

    // Also handle single-entry shorthand: { target: "...", data: {...} }
    if (entries.length === 0 && typeof obj.target === "string") {
      const entry: MemoryUpdateEntry = {
        target: obj.target,
        action: typeof obj.action === "string" ? obj.action : undefined,
        data:
          obj.data !== null && typeof obj.data === "object"
            ? (obj.data as Record<string, unknown>)
            : undefined,
        description:
          typeof obj.description === "string" ? obj.description : undefined,
      }
      entries = [entry]
    }

    const signal: MemoryUpdateSignal = {
      sessionId,
      agentName,
      status,
      entries,
      raw: rawJson,
      validationIssues: [],
    }

    // Run entry-by-entry validation
    const validation = validateMemoryUpdateSignal(signal)
    signal.validationIssues = validation.issues

    signals.push(signal)
  }

  return { signals, malformedBlocks, issues, quarantinedBlocks }
}
