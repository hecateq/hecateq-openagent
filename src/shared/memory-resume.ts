import { join } from "node:path"

import { discoverMemoryPaths, type DiscoveredPaths } from "./memory-path-discovery"
import {
  readManifest,
  type MemoryManifest,
} from "./memory-manifest"
import {
  readContinuation,
  computeContinuationState,
  buildContinuationSummary,
  type ContinuationState,
  type MemoryContinuation,
} from "./memory-continuation"
import { log } from "./logger"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Structured resume plan for cross-harness continuation.
 *
 * This is the authoritative output of the resume flow. Every harness
 * (OpenCode, Codex, CLI, Claude Code) can call `buildPortableResumePlan()`
 * with a working directory and receive the same machine-readable plan.
 *
 * The plan is designed to be token-efficient: it tells the agent WHAT to
 * read first (suggestedReads), WHAT the current task is (objective,
 * primaryTask), and WHAT to do next (nextActions), without requiring
 * full markdown file reads upfront.
 */
export interface PortableResumePlan {
  /** Absolute path to the project root. */
  projectRoot: string

  /** True if memory.json exists and is valid. */
  manifestExists: boolean
  /** Manifest schema version and revision if it exists. */
  manifestVersion: number | null
  manifestRevision: number | null

  /** True if continuation.json exists. */
  continuationExists: boolean
  /** Freshness of the continuation relative to the manifest. */
  continuationState: ContinuationState

  /**
   * Ordered list of files the agent should read first.
   * Built from:
   *   1. Manifest `recommended_read_order` (priority)
   *   2. Continuation `must_read` entries (if fresh)
   * Combined, deduplicated, and annotated with reasons.
   */
  suggestedReads: SuggestedRead[]

  /**
   * Current objective, if a fresh continuation exists.
   * Otherwise null (the agent should discover the objective from context).
   */
  objective: string | null

  /** Primary task reference and state, from the continuation. */
  primaryTask: {
    ref: string
    title: string
    state: "next" | "blocked" | "done"
  } | null

  /** Next actions from the continuation (if fresh). */
  nextActions: string[]

  /** Blockers from the continuation (if any). */
  blockers: string[]

  /** Verification items pending from the continuation. */
  verificationPending: string[]

  /**
   * Handoff metadata — who handed off to whom, and why.
   * Null if no continuation exists.
   */
  handoffFrom: string | null
  handoffReason: string | null
  lastHandoffAt: string | null

  /**
   * Compact one-line summary (~200 chars) suitable for injection
   * into compact context blocks without consuming significant tokens.
   */
  compactSummary: string

  /**
   * When true, the resume plan is considered "actionable" —
   * a fresh continuation exists with a clear next action.
   * When false, the agent should fall back to reading manifest
   * and memory files to determine what to do.
   */
  actionable: boolean
}

/**
 * A single suggested read entry with a reason for why it should be read.
 */
export interface SuggestedRead {
  /** File name relative to the memory directory (e.g., "active-context.md"). */
  fileName: string
  /** Why this file should be read. */
  reason: string
  /** Approximate character count from the manifest (0 if unknown). */
  chars: number
  /** Whether the file is a placeholder (template content only). */
  isPlaceholder: boolean
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Build a portable resume plan from a working directory.
 *
 * This is the canonical entry point for cross-harness resume. It:
 * 1. Discovers the project root, manifest path, and continuation path
 * 2. Reads the manifest FIRST (manifest-first principle)
 * 3. Checks continuation freshness against manifest file hashes
 * 4. Builds a structured resume plan with suggested reads, objective,
 *    next actions, blockers, and a compact summary
 *
 * The plan is purely additive — it reads from the filesystem but never
 * writes. It is callable from any harness without OpenCode-only APIs.
 *
 * @param workingDir — Starting directory for project-root discovery
 *    (defaults to `process.cwd()`)
 * @returns PortableResumePlan, or null if no project root found
 */
export function buildPortableResumePlan(
  workingDir = process.cwd(),
): PortableResumePlan | null {
  // Step 1: Discover paths
  const paths = discoverMemoryPaths(workingDir)
  if (!paths) return null

  const { projectRoot, manifestExists, continuationExists } = paths

  // Step 2: Read manifest first (manifest-first principle)
  const manifest = manifestExists ? readManifest(projectRoot) : null

  // Step 3: Build suggested reads
  const suggestedReads = buildSuggestedReads(manifest)

  // Step 4: Check continuation freshness
  let continuationState: ContinuationState = "missing"
  let continuation: MemoryContinuation | null = null

  if (continuationExists && manifest) {
    continuation = readContinuation(projectRoot)
    if (continuation) {
      continuationState = computeContinuationState(projectRoot, manifest)
    }
  }

  // Step 5: Extract continuation data (only if fresh)
  const isFresh = continuationState === "fresh"
  const objective = isFresh && continuation ? continuation.work_state.objective : null
  const primaryTask = isFresh && continuation
    ? {
        ref: continuation.work_state.primary_task.ref,
        title: continuation.work_state.primary_task.title,
        state: continuation.work_state.primary_task.state,
      }
    : null
  const nextActions = isFresh && continuation
    ? continuation.resume_plan.next_actions
    : []
  const blockers = isFresh && continuation
    ? continuation.resume_plan.blockers
    : []
  const verificationPending = isFresh && continuation
    ? continuation.resume_plan.verification_pending
    : []

  // Step 6: Handoff metadata
  const handoffFrom = continuation?.handoff?.from_harness ?? null
  const handoffReason = continuation?.handoff?.reason ?? null
  const lastHandoffAt = continuation?.handoff
    ? continuation.updated_at
    : manifest?.resume?.last_handoff_at ?? null

  // Step 7: Build compact summary
  const compactSummary = buildCompactResumeSummary({
    continuationState,
    objective,
    primaryTask,
    nextActions,
    blockers,
    suggestedReads,
    isFresh,
    manifestExists,
  })

  // Step 8: Actionable check
  const actionable = isFresh && nextActions.length > 0

  return {
    projectRoot,
    manifestExists,
    manifestVersion: manifest?.schema_version ?? null,
    manifestRevision: manifest?.manifest_revision ?? null,
    continuationExists,
    continuationState,
    suggestedReads,
    objective,
    primaryTask,
    nextActions,
    blockers,
    verificationPending,
    handoffFrom,
    handoffReason,
    lastHandoffAt,
    compactSummary,
    actionable,
  }
}

// ---------------------------------------------------------------------------
// Suggested reads builder
// ---------------------------------------------------------------------------

/**
 * Build the ordered list of suggested reads.
 *
 * Priority:
 * 1. Manifest `recommended_read_order` entries (known-good load order)
 * 2. Continuation `must_read` entries (specific to current task)
 * 3. Remaining manifest entries sorted by section count (info density)
 *
 * Entries are deduplicated by file name; the first occurrence wins
 * (preserving priority order).
 */
function buildSuggestedReads(manifest: MemoryManifest | null): SuggestedRead[] {
  const seen = new Set<string>()
  const reads: SuggestedRead[] = []

  // Priority 1: Manifest recommended read order
  if (manifest) {
    for (const fileName of manifest.token_budget.recommended_read_order) {
      if (seen.has(fileName)) continue
      const entry = manifest.files[fileName]
      if (!entry) continue

      seen.add(fileName)
      reads.push({
        fileName,
        reason: entry.is_placeholder
          ? `Recommended read order (placeholder — needs population)`
          : `Recommended read order`,
        chars: entry.size_bytes,
        isPlaceholder: entry.is_placeholder,
      })
    }
  }

  // Priority 2: Remaining manifest files (not yet included, sorted by section count)
  if (manifest) {
    const remaining = Object.entries(manifest.files)
      .filter(([name]) => !seen.has(name))
      .sort(([, a], [, b]) => b.section_count - a.section_count)

    for (const [fileName, entry] of remaining) {
      if (seen.has(fileName)) continue
      seen.add(fileName)
      reads.push({
        fileName,
        reason: entry.is_placeholder
          ? `Memory file (placeholder)`
          : `Memory file (${entry.section_count} sections)`,
        chars: entry.size_bytes,
        isPlaceholder: entry.is_placeholder,
      })
    }
  }

  return reads
}

// ---------------------------------------------------------------------------
// Compact summary builder
// ---------------------------------------------------------------------------

interface CompactSummaryInput {
  continuationState: ContinuationState
  objective: string | null
  primaryTask: PortableResumePlan["primaryTask"]
  nextActions: string[]
  blockers: string[]
  suggestedReads: SuggestedRead[]
  isFresh: boolean
  manifestExists: boolean
}

/**
 * Build a compact, human-readable summary of the resume plan.
 * Target: ~200-400 characters, suitable for injection into compact context.
 */
function buildCompactResumeSummary(input: CompactSummaryInput): string {
  const parts: string[] = []

  // State line
  if (!input.manifestExists) {
    return "No memory manifest found. Run bootstrap to initialize."
  }

  if (input.continuationState === "missing") {
    parts.push("No previous continuation. Start by reading suggested files.")
  } else if (input.continuationState === "stale") {
    parts.push("Previous continuation is STALE — memory files have changed. Re-evaluate from manifest.")
  } else if (input.isFresh && input.objective) {
    parts.push(`Continuing: ${input.objective.slice(0, 120)}`)
  }

  // Primary task
  if (input.primaryTask) {
    const status = input.primaryTask.state === "blocked" ? " [BLOCKED]" : ""
    parts.push(`Primary: ${input.primaryTask.title.slice(0, 100)}${status}`)
  }

  // Next actions (first 2 only)
  if (input.nextActions.length > 0) {
    const actions = input.nextActions.slice(0, 2).join("; ")
    parts.push(`Next: ${actions}`)
  }

  // Blockers
  if (input.blockers.length > 0) {
    parts.push(`Blockers: ${input.blockers.slice(0, 2).join(", ")}`)
  }

  // Suggested first read
  const firstNonPlaceholder = input.suggestedReads.find((r) => !r.isPlaceholder)
  if (firstNonPlaceholder) {
    parts.push(`First read: ${firstNonPlaceholder.fileName}`)
  } else if (input.suggestedReads.length > 0) {
    parts.push(`First read: ${input.suggestedReads[0].fileName} (placeholder)`)
  }

  return parts.join(" | ")
}

// ---------------------------------------------------------------------------
// Compact injection formatter
// ---------------------------------------------------------------------------

/**
 * Format the resume plan as a compact block suitable for injection
 * into agent context (compact mode, manifest-first).
 *
 * This is what the hecateq-project-context-injector should call
 * instead of manually building resume/continuation lines.
 */
export function formatResumePlanForInjection(plan: PortableResumePlan): string {
  const lines: string[] = []

  // Continuation state header
  if (plan.continuationState === "fresh") {
    lines.push("## Resume plan (fresh continuation)")
  } else if (plan.continuationState === "stale") {
    lines.push("## Resume plan (STALE — re-evaluate)")
  } else {
    lines.push("## Resume plan (new session)")
  }

  // Compact summary
  lines.push(`- Summary: ${plan.compactSummary}`)

  // Objective
  if (plan.objective) {
    lines.push(`- Objective: ${plan.objective.slice(0, 200)}`)
  }

  // Primary task
  if (plan.primaryTask) {
    const stateTag = plan.primaryTask.state === "blocked" ? "BLOCKED" : plan.primaryTask.state
    lines.push(`- Primary task: ${plan.primaryTask.title.slice(0, 150)} (${stateTag})`)
  }

  // Suggested reads (compact — file names only)
  if (plan.suggestedReads.length > 0) {
    const readList = plan.suggestedReads
      .slice(0, 6)
      .map((r) => r.fileName)
      .join(", ")
    lines.push(`- Suggested reads: ${readList}`)
  }

  // Next actions
  if (plan.nextActions.length > 0) {
    const actions = plan.nextActions.slice(0, 3).join("; ")
    lines.push(`- Next actions: ${actions}`)
  }

  // Blockers
  if (plan.blockers.length > 0) {
    lines.push(`- Blockers: ${plan.blockers.join(", ")}`)
  }

  // Handoff
  if (plan.handoffFrom) {
    const reason = plan.handoffReason ? ` (${plan.handoffReason.slice(0, 80)})` : ""
    lines.push(`- Handoff from: ${plan.handoffFrom}${reason}`)
  }

  // Actionable hint
  if (!plan.actionable && plan.manifestExists) {
    const firstRead = plan.suggestedReads.find((r) => !r.isPlaceholder)
    if (firstRead) {
      lines.push(`- Hint: Start by reading "${firstRead.fileName}" to understand current state.`)
    }
  }

  lines.push("")
  return lines.join("\n")
}

// ---------------------------------------------------------------------------
// CLI-friendly JSON export
// ---------------------------------------------------------------------------

/**
 * Build a resume plan and return it as a JSON string.
 *
 * This is the harness-agnostic entry point for non-OpenCode consumers
 * (CLI, Codex, external scripts). Callers can parse the JSON output
 * without importing any OpenCode-specific modules.
 *
 * @param workingDir — Starting directory (defaults to process.cwd())
 * @returns Pretty-printed JSON string, or null if no project root found
 */
export function buildResumePlanAsJson(workingDir = process.cwd()): string | null {
  const plan = buildPortableResumePlan(workingDir)
  if (!plan) return null

  try {
    return JSON.stringify(plan, null, 2)
  } catch (error) {
    log("memory-resume: Failed to serialize resume plan", {
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}
