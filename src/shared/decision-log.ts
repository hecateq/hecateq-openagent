import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"

import { log } from "./logger"
import { PROJECT_MEMORY_DIR } from "./memory-bootstrap"
import { writeFileAtomically } from "./write-file-atomically"

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
): boolean {
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
