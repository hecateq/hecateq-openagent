import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"

import { log } from "./logger"
import { PROJECT_MEMORY_DIR } from "./memory-bootstrap"
import {
  canWriteMemoryFile,
  type WriterIdentity,
} from "./memory-writer-ownership"
import { writeFileAtomically } from "./write-file-atomically"
import { pruneJsonlFileByLimits } from "./jsonl-retention"
import {
  DECISIONS_JSONL_MAX_LINES,
  DECISIONS_JSONL_MAX_BYTES,
} from "./memory-retention-policy"
import { refreshManifestAfterWrite } from "./memory-manifest-updater"

// ---------------------------------------------------------------------------
// Phase 4B / 4B.1: Auto-render guard with queued follow-up
// ---------------------------------------------------------------------------

/**
 * Guards against concurrent renders of decisions.md for the same project root.
 * Implements queued follow-up rendering: when a JSONL write occurs during an
 * active render, a follow-up is queued. The render loop drains pending until
 * no pending remains — every successful JSONL write eventually results in an
 * updated decisions.md.
 *
 * No infinite render loops: renders write decisions.md, not decisions.jsonl.
 * Only appendDecisionEntry() (called from external code) can set the pending
 * flag. The drain loop terminates when no new writes occur during a render pass.
 *
 * No render is triggered for duplicate/no-op JSONL appends.
 * Render failures never block JSONL writes.
 */
const _activeDecisionRender = new Set<string>()
const _pendingDecisionRerender = new Set<string>()

/**
 * Runs one render pass for decisions.md, then drains any follow-up renders
 * queued by writes that occurred during this pass. Recurses until no
 * pending writes remain. Bounded by maxDepth (128) as a circuit breaker.
 *
 * Renders never write decisions.jsonl → cannot self-sustain → loop
 * terminates naturally when external writes stop.
 */
function _renderDecisionDrain(projectRoot: string, depth = 0): void {
  const MAX_DEPTH = 128
  if (depth >= MAX_DEPTH) {
    log("decision-log: Render drain depth limit reached", { projectRoot, depth })
    _activeDecisionRender.delete(projectRoot)
    _pendingDecisionRerender.delete(projectRoot)
    return
  }

  import("./memory-curated-renderer")
    .then(({ renderDecisionsMarkdownFromJsonl }) =>
      renderDecisionsMarkdownFromJsonl(projectRoot),
    )
    .catch((err) => {
      log("decision-log: Auto-render decisions.md failed", {
        projectRoot,
        depth,
        error: err instanceof Error ? err.message : String(err),
      })
    })
    .finally(() => {
      if (_pendingDecisionRerender.has(projectRoot)) {
        _pendingDecisionRerender.delete(projectRoot)
        _renderDecisionDrain(projectRoot, depth + 1)
      } else {
        _activeDecisionRender.delete(projectRoot)
      }
    })
}

/**
 * Internal helper: starts the render drain loop for decisions.md.
 * Only called when _activeDecisionRender does NOT already contain the root.
 */
function _startDecisionRender(projectRoot: string): void {
  _activeDecisionRender.add(projectRoot)
  _renderDecisionDrain(projectRoot)
}

/**
 * Writer identity for the decision log module.
 * This module writes decisions.jsonl and is owned by decision_writer.
 * @see src/shared/memory-writer-ownership.ts
 */
export const DECISION_WRITER_IDENTITY: WriterIdentity = "decision_writer"

export const DECISION_LOG_FILENAME = "decisions.jsonl"

export const DECISION_STATUSES = [
  "proposed",
  "active",
  "superseded",
  "reverted",
] as const

export type DecisionStatus = (typeof DECISION_STATUSES)[number]

export const DECISION_ACTIONS = [
  "record",
  "amend",
  "supersede",
  "revert",
] as const

export type DecisionAction = (typeof DECISION_ACTIONS)[number]

export const DecisionLogEntrySchema = z.object({
  version: z.literal(1),
  id: z.string().min(1),
  timestamp: z.string().datetime(),
  action: z.enum(DECISION_ACTIONS),
  title: z.string().min(1),
  status: z.enum(DECISION_STATUSES),
  decision: z.string().min(1),
  rationale: z.string().min(1),
  impact_area: z.string(),
  alternatives_rejected: z.array(z.string()).optional(),
  related_tasks: z.array(z.string()).optional(),
  supersedes: z.string().optional(),
  superseded_by: z.string().optional(),
  changed_by: z.string().optional(),
  source_session_id: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  notes: z.string().optional(),
})

export type DecisionLogEntry = z.infer<typeof DecisionLogEntrySchema>

function getDecisionLogPath(projectRoot: string): string {
  return join(projectRoot, PROJECT_MEMORY_DIR, DECISION_LOG_FILENAME)
}

function contentHash(entry: DecisionLogEntry): string {
  const { timestamp: _ts, ...rest } = entry
  const serialized = JSON.stringify(rest)
  let hash = 0
  for (let i = 0; i < serialized.length; i++) {
    const ch = serialized.charCodeAt(i)
    hash = (hash << 5) - hash + ch
    hash |= 0
  }
  return hash.toString(36)
}

export function readDecisionLog(projectRoot: string): DecisionLogEntry[] | null {
  const filePath = getDecisionLogPath(projectRoot)

  if (!existsSync(filePath)) return null

  try {
    const raw = readFileSync(filePath, "utf-8")
    if (raw.trim().length === 0) return []

    const lines = raw.split("\n")
    const entries: DecisionLogEntry[] = []
    let malformedCount = 0

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      if (line.length === 0) continue

      try {
        const parsed = JSON.parse(line)
        const result = DecisionLogEntrySchema.safeParse(parsed)
        if (result.success) {
          entries.push(result.data)
        } else {
          malformedCount++
          log(
            "decision-log: Skipping malformed JSONL line",
            { line: i + 1, errors: result.error.flatten() },
          )
        }
      } catch {
        malformedCount++
        log("decision-log: Skipping invalid JSON line", { line: i + 1 })
      }
    }

    if (malformedCount > 0) {
      log("decision-log: Skipped malformed lines", {
        malformedCount,
        totalLines: lines.length,
      })
    }

    return entries
  } catch (error) {
    log("decision-log: Failed to read file", {
      projectRoot,
      error: error instanceof Error ? error.message : String(error),
    })
    return []
  }
}

export function appendDecisionEntry(
  projectRoot: string,
  entry: DecisionLogEntry,
  writer?: WriterIdentity,
): boolean {
  // Phase 3A: Ownership guard — best-effort, skip+log on violation
  const effectiveWriter = writer ?? DECISION_WRITER_IDENTITY
  const ownershipCheck = canWriteMemoryFile(effectiveWriter, DECISION_LOG_FILENAME)
  if (!ownershipCheck.authorized) {
    log("decision-log: Ownership violation — write skipped", {
      writer: effectiveWriter,
      file: DECISION_LOG_FILENAME,
      reason: ownershipCheck.reason,
    })
    return false
  }

  const filePath = getDecisionLogPath(projectRoot)

  DecisionLogEntrySchema.parse(entry)

  try {
    let existing: DecisionLogEntry[] = []
    if (existsSync(filePath)) {
      try {
        const raw = readFileSync(filePath, "utf-8")
        if (raw.trim().length > 0) {
          existing = raw
            .split("\n")
            .filter((l) => l.trim().length > 0)
            .map((l) => {
              try {
                const parsed = JSON.parse(l)
                const result = DecisionLogEntrySchema.safeParse(parsed)
                return result.success ? result.data : null
              } catch {
                return null
              }
            })
            .filter((e): e is DecisionLogEntry => e !== null)
        }
      } catch {
        // proceed with append even if read fails
      }
    }

    const newHash = contentHash(entry)
    const latestForId = existing
      .filter((e) => e.id === entry.id)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0]

    if (latestForId && contentHash(latestForId) === newHash) {
      return false
    }

    const line = JSON.stringify(entry) + "\n"
    const existingContent = existsSync(filePath)
      ? readFileSync(filePath, "utf-8")
      : ""

    writeFileAtomically(filePath, existingContent + line)

    // Phase 6: JSONL retention — prune decisions.jsonl when line/byte thresholds exceeded.
    // Best-effort only; pruning failure never blocks append or render.
    try {
      const pruning = pruneJsonlFileByLimits(filePath, {
        maxLines: DECISIONS_JSONL_MAX_LINES,
        maxBytes: DECISIONS_JSONL_MAX_BYTES,
        preserveNewest: true,
      })
      if (pruning.pruned) {
        refreshManifestAfterWrite(projectRoot, filePath)
      }
    } catch {
      // best-effort — never block append
    }

    // Phase 4B.1: Auto-render decisions.md after successful JSONL write.
    // Implements queued follow-up rendering:
    // - If no render active: start render immediately.
    // - If render active: mark pending rerender (at most one follow-up).
    // - When active render finishes and pending is set: run exactly one follow-up.
    // - Follow-up render does NOT chain further.
    // Best-effort, fire-and-forget — never throws, never blocks caller.
    // Dynamic import avoids circular dependency with memory-curated-renderer.
    if (!_activeDecisionRender.has(projectRoot)) {
      _activeDecisionRender.add(projectRoot)
      _startDecisionRender(projectRoot)
    } else {
      _pendingDecisionRerender.add(projectRoot)
    }

    return true
  } catch (error) {
    log("decision-log: Failed to append entry", {
      projectRoot,
      decisionId: entry.id,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

export function resolveLatestDecisionState(
  entries: DecisionLogEntry[],
): Map<string, DecisionLogEntry> {
  const latest = new Map<string, DecisionLogEntry>()

  for (const entry of entries) {
    const existing = latest.get(entry.id)
    if (!existing || entry.timestamp >= existing.timestamp) {
      latest.set(entry.id, entry)
    }
  }

  return latest
}

export interface DecisionLogSummary {
  totalDecisions: number
  byStatus: Record<DecisionStatus, number>
  active: DecisionLogEntry[]
  superseded: DecisionLogEntry[]
  reverted: DecisionLogEntry[]
  recent: DecisionLogEntry[]
}

export function buildCompactDecisionSummary(
  entries: DecisionLogEntry[],
  recentCount = 5,
): DecisionLogSummary {
  const latest = resolveLatestDecisionState(entries)
  const allDecisions = [...latest.values()]

  const byStatus: Record<DecisionStatus, number> = {
    proposed: 0,
    active: 0,
    superseded: 0,
    reverted: 0,
  }

  const active: DecisionLogEntry[] = []
  const superseded: DecisionLogEntry[] = []
  const reverted: DecisionLogEntry[] = []

  for (const decision of allDecisions) {
    byStatus[decision.status] = (byStatus[decision.status] || 0) + 1

    if (decision.status === "active") active.push(decision)
    if (decision.status === "superseded") superseded.push(decision)
    if (decision.status === "reverted") reverted.push(decision)
  }

  const sorted = [...allDecisions].sort(
    (a, b) => b.timestamp.localeCompare(a.timestamp),
  )

  return {
    totalDecisions: allDecisions.length,
    byStatus,
    active,
    superseded,
    reverted,
    recent: sorted.slice(0, recentCount),
  }
}

export function formatDecisionSummary(summary: DecisionLogSummary): string {
  const parts: string[] = []

  const baseLine =
    `Decisions: ${summary.byStatus.proposed} proposed, ${summary.byStatus.active} active, ${summary.byStatus.superseded} superseded` +
    (summary.byStatus.reverted > 0
      ? `, ${summary.byStatus.reverted} reverted`
      : "")

  parts.push(baseLine)

  if (summary.active.length > 0) {
    parts.push("Active:")
    for (const d of summary.active) {
      const area = d.impact_area ? ` [${d.impact_area}]` : ""
      parts.push(`  - ${d.id}: ${d.title}${area}`)
    }
  }

  if (summary.superseded.length > 0) {
    parts.push("Superseded:")
    for (const d of summary.superseded) {
      const by = d.superseded_by ? ` (by ${d.superseded_by})` : ""
      parts.push(`  - ${d.id}: ${d.title}${by}`)
    }
  }

  if (summary.reverted.length > 0) {
    parts.push("Reverted:")
    for (const d of summary.reverted) {
      const changedBy = d.changed_by ? ` (changed by ${d.changed_by})` : ""
      parts.push(`  - ${d.id}: ${d.title}${changedBy}`)
    }
  }

  if (summary.recent.length > 0) {
    parts.push("Recent:")
    for (const d of summary.recent) {
      parts.push(`  - ${d.id}: ${d.title} [${d.status}]`)
    }
  }

  return parts.join("\n")
}

export function detectSupersededDecisions(
  entries: DecisionLogEntry[],
): DecisionLogEntry[] {
  const latest = resolveLatestDecisionState(entries)

  const superseded: DecisionLogEntry[] = []
  for (const [, entry] of latest) {
    if (entry.status === "superseded") {
      superseded.push(entry)
    }
  }

  return superseded
}

export function detectRevertedDecisions(
  entries: DecisionLogEntry[],
): DecisionLogEntry[] {
  const latest = resolveLatestDecisionState(entries)

  const reverted: DecisionLogEntry[] = []
  for (const [, entry] of latest) {
    if (entry.status === "reverted") {
      reverted.push(entry)
    }
  }

  return reverted
}

export function detectOrphanedSupersedes(
  entries: DecisionLogEntry[],
): DecisionLogEntry[] {
  const latest = resolveLatestDecisionState(entries)
  const existingIds = new Set(latest.keys())

  const orphaned: DecisionLogEntry[] = []
  for (const [, entry] of latest) {
    if (
      entry.supersedes &&
      !existingIds.has(entry.supersedes)
    ) {
      orphaned.push(entry)
    }
  }

  return orphaned
}

export function detectConflictingDecisions(
  entries: DecisionLogEntry[],
): Array<{ area: string; decisions: DecisionLogEntry[] }> {
  const latest = resolveLatestDecisionState(entries)
  const byArea = new Map<string, DecisionLogEntry[]>()

  for (const [, entry] of latest) {
    if (entry.status !== "active") continue
    if (!entry.impact_area) continue

    const existing = byArea.get(entry.impact_area)
    if (existing) {
      existing.push(entry)
    } else {
      byArea.set(entry.impact_area, [entry])
    }
  }

  const conflicts: Array<{ area: string; decisions: DecisionLogEntry[] }> = []
  for (const [area, decisions] of byArea) {
    if (decisions.length > 1) {
      conflicts.push({ area, decisions })
    }
  }

  return conflicts
}

// ---------------------------------------------------------------------------
// Phase 4B.1: Observability helpers (test/internal use)
// ---------------------------------------------------------------------------

/**
 * Returns the current render guard state for decisions.md auto-render.
 * For observability/testing only — do not use in production paths.
 */
export function getDecisionRenderGuardState(): {
  active: string[]
  pending: string[]
} {
  return {
    active: [..._activeDecisionRender],
    pending: [..._pendingDecisionRerender],
  }
}

/**
 * Flushes pending decision renders by polling microtask queue until the
 * active render set is empty. Caps at 20 microtask layers to prevent
 * infinite waits in edge cases.
 *
 * For test/internal use only — production writes are fire-and-forget.
 */
export async function flushPendingDecisionRenders(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await new Promise<void>((r) => queueMicrotask(r))
    if (_activeDecisionRender.size === 0) return
  }
}
