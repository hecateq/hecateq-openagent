import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import type { DecisionLogEntry } from "./decision-log"
import {
  readDecisionLog,
  resolveLatestDecisionState,
} from "./decision-log"
import { log } from "./logger"
import { PROJECT_MEMORY_DIR } from "./memory-bootstrap"
import { refreshManifestAfterWrite } from "./memory-manifest-updater"
import { compactQualityHistory } from "./memory-quality-writer"
import {
  canWriteMemoryFile,
  type WriterIdentity,
} from "./memory-writer-ownership"
import type { TaskStateEntry } from "./task-state-memory"
import {
  readTaskState,
  resolveLatestTaskState,
} from "./task-state-memory"
import { writeFileAtomically } from "./write-file-atomically"

// ---------------------------------------------------------------------------
// Writer identity
// ---------------------------------------------------------------------------

/**
 * Writer identity for the memory curator module.
 * The curator normalizes, compacts, and renders from structured data.
 * It creates no new facts, never writes JSONL, and preserves user-authored content.
 * @see src/shared/memory-writer-ownership.ts
 */
const CURATOR_IDENTITY: WriterIdentity = "memory_curator"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for curator operations. */
export interface CuratorOptions {
  /** Session ID for manifest refresh stamp. */
  sessionId?: string
  /** Agent name for manifest refresh stamp. */
  agent?: string
  /** Retention limit for quality-history (default 20). */
  qualityRetentionLimit?: number
}

/** Result of a single curator operation. */
export interface CuratorResult {
  /** True if the operation was attempted. */
  attempted: boolean
  /** True if the file was actually written (content changed). */
  updated: boolean
  /** The file that was written, or null. */
  writtenFile: string | null
  /** If not written, the reason. */
  skippedReason: string | null
  /** Any non-fatal errors encountered. */
  errors: string[]
}

/** Combined result of running all curator functions. */
export interface CombinedCuratorResult {
  activeContext: CuratorResult
  progress: CuratorResult
  fileMap: CuratorResult
  openQuestions: CuratorResult
  riskProfile: CuratorResult
  qualityHistory: CuratorResult
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function getMemoryPath(projectRoot: string, fileName: string): string {
  return join(projectRoot, PROJECT_MEMORY_DIR, fileName)
}

function readMemoryFile(
  projectRoot: string,
  fileName: string,
): string | null {
  const filePath = getMemoryPath(projectRoot, fileName)
  if (!existsSync(filePath)) return null
  try {
    return readFileSync(filePath, "utf-8")
  } catch {
    return null
  }
}

function writeMemoryFile(
  projectRoot: string,
  fileName: string,
  content: string,
): void {
  const filePath = getMemoryPath(projectRoot, fileName)
  writeFileAtomically(filePath, content)
}

function curatorOwnershipCheck(fileName: string): CuratorResult | null {
  const check = canWriteMemoryFile(CURATOR_IDENTITY, fileName)
  if (!check.authorized) {
    return {
      attempted: false,
      updated: false,
      writtenFile: null,
      skippedReason: `Ownership violation: ${check.reason}`,
      errors: [],
    }
  }
  return null
}

function successResult(fileName: string, projectRoot: string): CuratorResult {
  return {
    attempted: true,
    updated: true,
    writtenFile: getMemoryPath(projectRoot, fileName),
    skippedReason: null,
    errors: [],
  }
}

function noChangeResult(reason: string): CuratorResult {
  return {
    attempted: true,
    updated: false,
    writtenFile: null,
    skippedReason: reason,
    errors: [],
  }
}

function errorResult(errors: string[], reason?: string): CuratorResult {
  return {
    attempted: true,
    updated: false,
    writtenFile: null,
    skippedReason:
      reason ?? (errors.length > 0 ? errors[0] : "Unknown error"),
    errors,
  }
}

/**
 * Refresh manifest after a successful curator write. Best-effort.
 */
function refreshManifest(
  projectRoot: string,
  filePath: string,
  options?: CuratorOptions,
): void {
  try {
    refreshManifestAfterWrite(
      projectRoot,
      filePath,
      undefined,
      options?.agent,
      options?.sessionId,
      CURATOR_IDENTITY,
    )
  } catch (err) {
    log("memory-curator: Manifest refresh failed", {
      filePath,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

// ---------------------------------------------------------------------------
// Controlled section replacement (reused from curated renderer pattern)
// ---------------------------------------------------------------------------

/**
 * Replace controlled sections in markdown content.
 * Only sections starting with the given controlled headings are replaced.
 * All other content is preserved.
 */
function replaceControlledSections(
  existing: string,
  newSections: Map<string, string>,
  controlledHeadings: readonly string[],
): string {
  const controlledSet = new Set(controlledHeadings)
  const lines = existing.split("\n")
  const preserved: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (trimmed.startsWith("## ")) {
      const matched = controlledHeadings.find((h) => trimmed.startsWith(h))
      if (matched) {
        // Skip the entire controlled section until next heading
        while (i + 1 < lines.length && !lines[i + 1].trim().startsWith("## ")) {
          i++
        }
        continue
      }
    }
    preserved.push(lines[i])
  }

  // Build final output: preserve non-controlled, inject new controlled sections
  const result: string[] = []
  let injected = false

  for (const line of preserved) {
    if (!injected && line.trim().startsWith("## ")) {
      const isControlled = controlledHeadings.some((h) =>
        line.trim().startsWith(h),
      )
      if (!isControlled) {
        // Inject after first non-controlled heading
        injected = true
        result.push(line)
        result.push("")
        for (const heading of controlledHeadings) {
          const body = newSections.get(heading)
          if (body !== undefined) {
            result.push(heading)
            result.push("")
            result.push(body)
            result.push("")
          }
        }
        continue
      }
    }
    result.push(line)
  }

  if (!injected) {
    // No non-controlled heading found — append at end
    if (result.length > 0) result.push("")
    for (const heading of controlledHeadings) {
      const body = newSections.get(heading)
      if (body !== undefined) {
        result.push(heading)
        result.push("")
        result.push(body)
        result.push("")
      }
    }
  }

  // Clean trailing whitespace
  while (
    result.length > 0 &&
    result[result.length - 1].trim() === ""
  ) {
    result.pop()
  }

  return result.join("\n") + "\n"
}

// ---------------------------------------------------------------------------
// 1. curateActiveContext
// ---------------------------------------------------------------------------

const ACTIVE_CONTEXT_CONTROLLED = [
  "## Current Goal",
  "## Current State",
  "## Active Constraints",
  "## Current Risks",
] as const

/**
 * Curate active-context.md: update controlled sections with data from
 * tasks.jsonl and decisions.jsonl. No invented goals, no new facts.
 *
 * Sources:
 * - Latest active/in-progress tasks → Current Goal
 * - Blocked tasks → Current State
 * - Active decisions → Active Constraints
 * - Existing risk-profile active risks → Current Risks (pointer-level only)
 *
 * If only scaffold content exists and real task/decision data is available,
 * the scaffold sections are replaced. User-authored sections outside
 * controlled headings are preserved.
 */
export function curateActiveContext(
  projectRoot: string,
  options?: CuratorOptions,
): CuratorResult {
  const fileName = "active-context.md"
  const errors: string[] = []

  try {
    // Ownership check
    const denied = curatorOwnershipCheck(fileName)
    if (denied) return denied

    const filePath = getMemoryPath(projectRoot, fileName)

    // Read sources
    const tasksEntries = readTaskState(projectRoot)
    const taskMap =
      tasksEntries !== null ? resolveLatestTaskState(tasksEntries) : new Map()
    const allTasks = [...taskMap.values()]

    const decisionEntries = readDecisionLog(projectRoot)
    const decisionMap =
      decisionEntries !== null
        ? resolveLatestDecisionState(decisionEntries)
        : new Map()
    const allDecisions = [...decisionMap.values()]

    // If no real data exists at all, skip
    const hasTasks = allTasks.length > 0
    const hasDecisions = allDecisions.length > 0
    if (!hasTasks && !hasDecisions) {
      return noChangeResult("No task or decision data available for curation")
    }

    // Build new sections
    const newSections = new Map<string, string>()

    // Current Goal: latest in_progress or planned task
    const activeTasks = allTasks.filter(
      (t) => t.status === "in_progress" || t.status === "planned",
    )
    if (activeTasks.length > 0) {
      const main = activeTasks[0]
      const lines: string[] = []
      lines.push(`- Primary: ${main.title}`)
      if (activeTasks.length > 1) {
        for (const t of activeTasks.slice(1)) {
          lines.push(`- ${t.title}`)
        }
      }
      newSections.set("## Current Goal", lines.join("\n"))
    }

    // Current State: blocked tasks + summary
    const blockedTasks = allTasks.filter((t) => t.status === "blocked")
    const completedTasks = allTasks.filter(
      (t) => t.status === "completed" || t.status === "cancelled",
    )
    const stateLines: string[] = []
    if (activeTasks.length > 0) {
      stateLines.push(`- Active tasks: ${activeTasks.length}`)
    }
    if (blockedTasks.length > 0) {
      stateLines.push(`- Blocked tasks: ${blockedTasks.length}`)
    }
    if (completedTasks.length > 0) {
      stateLines.push(
        `- Recently completed: ${
          completedTasks.slice(0, 5).map((t) => t.title).join(", ")
        }`,
      )
    }
    if (stateLines.length > 0) {
      newSections.set("## Current State", stateLines.join("\n"))
    }

    // Active Constraints: from active decisions
    if (hasDecisions) {
      const activeDecisions = allDecisions.filter(
        (d) => d.status === "active",
      )
      if (activeDecisions.length > 0) {
        const constraintLines: string[] = []
        for (const d of activeDecisions.slice(0, 5)) {
          constraintLines.push(
            `- ${d.title}: ${d.decision?.slice(0, 120) ?? "see decisions.md"}`,
          )
        }
        if (activeDecisions.length > 5) {
          constraintLines.push(
            `_... and ${activeDecisions.length - 5} more active decisions (see decisions.md)_`,
          )
        }
        newSections.set("## Active Constraints", constraintLines.join("\n"))
      }
    }

    // Current Risks: pointer-level from risk-profile.md
    const riskContent = readMemoryFile(projectRoot, "risk-profile.md")
    if (riskContent) {
      const activeRiskMatch = riskContent.match(
        /^## Active Risks\n([\s\S]*?)(?=\n## |\n---|\n\z)/m,
      )
      if (activeRiskMatch) {
        const riskBody = activeRiskMatch[1].trim()
        if (riskBody && riskBody !== "(none recorded)") {
          const riskLines = riskBody.split("\n")
          const pointers: string[] = []
          for (const line of riskLines) {
            const match = line.match(
              /^### (\S+) — \[(\w+)\] (\w+)/,
            )
            if (match) {
              pointers.push(
                `- [${match[2]}] ${match[3]}: see risk-profile.md`,
              )
            }
          }
          if (pointers.length > 0) {
            newSections.set("## Current Risks", pointers.join("\n"))
          }
        }
      }
    }

    // If no new sections built, skip
    if (newSections.size === 0) {
      return noChangeResult("No actionable data to curate into active-context")
    }

    // Read existing content
    const existing = readMemoryFile(projectRoot, fileName) ?? ""

    // Quick idempotency check: if the existing content already contains
    // the primary goal title (from our computed new sections), skip.
    if (activeTasks.length > 0 && existing.includes(activeTasks[0].title)) {
      // Check if this is scaffold content being replaced vs already curated
      const hasScaffold =
        existing.includes("- TODO") ||
        existing.includes("_No active tasks_") ||
        existing.includes("_No pending tasks_")
      if (!hasScaffold) {
        return noChangeResult("Content unchanged")
      }
    }

    // Perform controlled section replacement
    const newContent = replaceControlledSections(
      existing,
      newSections,
      [...ACTIVE_CONTEXT_CONTROLLED],
    )

    if (existing.trim() === newContent.trim()) {
      return noChangeResult("Content unchanged")
    }

    writeMemoryFile(projectRoot, fileName, newContent)
    refreshManifest(projectRoot, filePath, options)

    log("memory-curator: Curated active-context.md", { projectRoot })
    return successResult(fileName, projectRoot)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    errors.push(msg)
    log("memory-curator: Error curating active-context.md", { error: msg })
    return errorResult(errors, `Error: ${msg}`)
  }
}

// ---------------------------------------------------------------------------
// 2. compactProgress
// ---------------------------------------------------------------------------

const PROGRESS_CONTROLLED = [
  "## Completed",
  "## In Progress",
  "## Remaining",
] as const

/**
 * Compact progress.md: summarize milestone-level progress.
 *
 * Sources:
 * - completed/blocked/current tasks from tasks.jsonl
 * - existing progress.md milestones
 * - completion metadata already present
 *
 * Completed section bounded: show latest 10 completed bullets,
 * compact older as `_Older completed milestones compacted: N._`.
 * Does not list every task — summarizes at milestone level.
 * Does not claim test/build success unless quality-history evidence exists.
 */
export function compactProgress(
  projectRoot: string,
  options?: CuratorOptions,
): CuratorResult {
  const fileName = "progress.md"
  const errors: string[] = []

  try {
    const denied = curatorOwnershipCheck(fileName)
    if (denied) return denied

    const existing = readMemoryFile(projectRoot, fileName)
    if (existing === null) {
      return noChangeResult("progress.md does not exist")
    }

    const filePath = getMemoryPath(projectRoot, fileName)

    // Check if already compacted BEFORE counting items
    const alreadyCompacted = existing.includes(
      "_Older completed milestones compacted:",
    )
    if (alreadyCompacted) {
      return noChangeResult("Completed section already compacted")
    }

    // Parse existing completed milestones
    const completedIdx = existing.indexOf("\n## Completed\n")
    let completedBody = ""
    if (completedIdx !== -1) {
      const bodyStart = completedIdx + "\n## Completed\n".length
      const nextHeading = existing.indexOf("\n## ", bodyStart)
      const bodyEnd = nextHeading !== -1 ? nextHeading : existing.length
      completedBody = existing.slice(bodyStart, bodyEnd).trim()
    }

    // Parse individual completed items (lines starting with "- " or "* ")
    const completedItems = completedBody
      .split("\n")
      .filter(
        (line) =>
          line.trim().startsWith("- ") || line.trim().startsWith("* "),
      )
      .map((line) => line.trim())

    // If 10 or fewer items, nothing to compact
    if (completedItems.length <= 10) {
      return noChangeResult("Completed section below compaction threshold")
    }

    // Keep latest 10 (items at the END are newest since progress is append-style)
    const latest = completedItems.slice(-10)
    const olderCount = completedItems.length - 10

    // Parse existing sections for In Progress and Remaining
    const existingSections = existing.split(/\n(?=## )/)
    let inProgressBody = ""
    let remainingBody = ""

    for (const sec of existingSections) {
      if (sec.startsWith("## In Progress")) {
        inProgressBody = sec.replace(/^## In Progress\n?/, "").trim()
      } else if (sec.startsWith("## Remaining")) {
        remainingBody = sec.replace(/^## Remaining\n?/, "").trim()
      }
    }

    const newSections = new Map<string, string>()

    // Completed with latest 10 + compaction note
    const completedLines = [
      ...latest,
      `_Older completed milestones compacted: ${olderCount}._`,
    ]
    newSections.set("## Completed", completedLines.join("\n"))

    // Preserve In Progress section
    if (inProgressBody) {
      newSections.set("## In Progress", inProgressBody)
    }

    // Preserve Remaining section
    if (remainingBody) {
      newSections.set("## Remaining", remainingBody)
    }

    const newContent = replaceControlledSections(
      existing,
      newSections,
      [...PROGRESS_CONTROLLED],
    )

    if (existing.trim() === newContent.trim()) {
      return noChangeResult("Content unchanged")
    }

    writeMemoryFile(projectRoot, fileName, newContent)
    refreshManifest(projectRoot, filePath, options)

    log("memory-curator: Compacted progress.md", {
      projectRoot,
      completedItems: completedItems.length,
      olderCompacted: olderCount,
    })
    return successResult(fileName, projectRoot)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    errors.push(msg)
    log("memory-curator: Error compacting progress.md", { error: msg })
    return errorResult(errors, `Error: ${msg}`)
  }
}

// ---------------------------------------------------------------------------
// 3. cleanFileMap
// ---------------------------------------------------------------------------

const GENERATED_PATH_PATTERNS = [
  /(^|\/)\.next\//,
  /(^|\/)node_modules\//,
  /(^|\/)dist\//,
  /(^|\/)build\//,
  /(^|\/)coverage\//,
  /(^|\/)\.turbo\//,
  /(^|\/)\.cache\//,
  /(^|\/)out\//,
  /(^|\/)\.git\//,
  /(^|\/)__pycache__\//,
  /(^|\/)\.svelte-kit\//,
]

const FILE_MAP_CONTROLLED = ["## Change Impact Map"] as const

/**
 * Clean file-map.md: remove generated/build paths from the
 * bounded Change Impact Map section while preserving source entries,
 * important paths, entry points, and Do Not Scan Blindly.
 *
 * Idempotent cleanup.
 */
export function cleanFileMap(
  projectRoot: string,
  options?: CuratorOptions,
): CuratorResult {
  const fileName = "file-map.md"
  const errors: string[] = []

  try {
    const denied = curatorOwnershipCheck(fileName)
    if (denied) return denied

    const existing = readMemoryFile(projectRoot, fileName)
    if (existing === null) {
      return noChangeResult("file-map.md does not exist")
    }

    const filePath = getMemoryPath(projectRoot, fileName)

    // Find the Change Impact Map section using string index
    const impactHeading = "## Change Impact Map"
    const impactIdx = existing.indexOf("\n" + impactHeading)
    if (impactIdx === -1) {
      return noChangeResult("No Change Impact Map section found")
    }
    // Find end of this section (next ## heading or end of file)
    const sectionStart = impactIdx + 1 // skip the leading \n
    const afterHeading = existing.indexOf("\n## ", sectionStart + impactHeading.length + 1)
    const sectionEnd = afterHeading !== -1 ? afterHeading : existing.length
    const impactBody = existing.slice(sectionStart + impactHeading.length + 1, sectionEnd).trim()
    const impactLines = impactBody.split("\n")

    // Filter out generated paths
    const cleanedLines: string[] = []
    let removedCount = 0
    for (const line of impactLines) {
      const trimmed = line.trim()
      if (!trimmed) {
        cleanedLines.push(line)
        continue
      }
      // Strip list markers for path matching
      const pathPart = trimmed.replace(/^[-*]\s+/, "")
      const isGenerated = GENERATED_PATH_PATTERNS.some((pattern) =>
        pattern.test(pathPart) || pattern.test(trimmed),
      )
      if (isGenerated) {
        removedCount++
      } else {
        cleanedLines.push(line)
      }
    }

    if (removedCount === 0) {
      return noChangeResult("No generated paths found in file-map")
    }

    const newSections = new Map<string, string>()
    newSections.set("## Change Impact Map", cleanedLines.join("\n"))

    const newContent = replaceControlledSections(
      existing,
      newSections,
      [...FILE_MAP_CONTROLLED],
    )

    writeMemoryFile(projectRoot, fileName, newContent)
    refreshManifest(projectRoot, filePath, options)

    log("memory-curator: Cleaned file-map.md", {
      projectRoot,
      removedGeneratedPaths: removedCount,
    })
    return successResult(fileName, projectRoot)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    errors.push(msg)
    log("memory-curator: Error cleaning file-map.md", { error: msg })
    return errorResult(errors, `Error: ${msg}`)
  }
}

// ---------------------------------------------------------------------------
// 4. resolveOpenQuestions
// ---------------------------------------------------------------------------

const OPEN_QUESTIONS_CONTROLLED = [
  "## Active Questions",
  "## Waiting For",
  "## Unresolved Tradeoffs",
  "## Resolved Questions",
] as const

/**
 * Resolve open questions: match active questions against decision titles
 * and completed task titles. If an active question clearly matches a decision
 * or completed task, move it to Resolved Questions with a compact pointer.
 * Low confidence matches stay active.
 *
 * Sources:
 * - existing open-questions.md
 * - decisions.jsonl (for decision titles)
 * - tasks.jsonl (for completed task titles)
 *
 * Preserves Waiting For and Unresolved Tradeoffs sections.
 * Idempotent.
 */
export function resolveOpenQuestions(
  projectRoot: string,
  options?: CuratorOptions,
): CuratorResult {
  const fileName = "open-questions.md"
  const errors: string[] = []

  try {
    const denied = curatorOwnershipCheck(fileName)
    if (denied) return denied

    const existing = readMemoryFile(projectRoot, fileName)
    if (existing === null) {
      return noChangeResult("open-questions.md does not exist")
    }

    const filePath = getMemoryPath(projectRoot, fileName)

    // Read decision and task data for resolution
    const decisionEntries = readDecisionLog(projectRoot)
    const decisionMap =
      decisionEntries !== null
        ? resolveLatestDecisionState(decisionEntries)
        : new Map()
    const allDecisions = [...decisionMap.values()]

    const tasksEntries = readTaskState(projectRoot)
    const taskMap =
      tasksEntries !== null
        ? resolveLatestTaskState(tasksEntries)
        : new Map()
    const completedTasks = [...taskMap.values()].filter(
      (t) => t.status === "completed" || t.status === "cancelled",
    )

    // Parse existing content using split approach for reliability
    const sections = existing.split(/\n(?=## )/)
    let activeBody = ""
    let waitingBody = ""
    let tradeoffsBody = ""
    let resolvedBody = ""

    for (const sec of sections) {
      if (sec.startsWith("## Active Questions")) {
        activeBody = sec.replace(/^## Active Questions\n?/, "").trim()
      } else if (sec.startsWith("## Waiting For")) {
        waitingBody = sec.replace(/^## Waiting For\n?/, "").trim()
      } else if (sec.startsWith("## Unresolved Tradeoffs")) {
        tradeoffsBody = sec.replace(/^## Unresolved Tradeoffs\n?/, "").trim()
      } else if (sec.startsWith("## Resolved Questions")) {
        resolvedBody = sec.replace(/^## Resolved Questions\n?/, "").trim()
      }
    }

    // Parse active questions (lines starting with "- ")
    const activeQuestionLines = activeBody
      .split("\n")
      .filter((line) => line.trim().startsWith("- ") && !line.includes("TODO"))

    // Build resolved set for dedup
    const resolvedSet = new Set(
      resolvedBody
        .split("\n")
        .filter((line) => line.trim().startsWith("- "))
        .map((line) => line.trim().toLowerCase()),
    )

    const unresolved: string[] = []
    const newlyResolved: string[] = []

    for (const question of activeQuestionLines) {
      const qText = question.replace(/^-\s*/, "").trim()
      const qLower = qText.toLowerCase()

      // Skip if already resolved
      if (resolvedSet.has(question.trim().toLowerCase())) {
        continue
      }

      // Check if resolved by a decision (bidirectional keyword match)
      let resolved = false
      for (const d of allDecisions) {
        const dTitle = (d.title ?? "").toLowerCase()
        if (dTitle && (qLower.includes(dTitle) || dTitle.includes(qLower))) {
          newlyResolved.push(
            `- ${qText}  \n  _Resolved by decision: \`${d.id}\` — ${d.title}_`,
          )
          resolved = true
          break
        }
        // Also check if key terms from the decision appear in the question
        const dTerms = dTitle.split(/\s+/).filter((w: string) => w.length > 3)
        const matchingTerms = dTerms.filter((term: string) => qLower.includes(term))
        if (dTerms.length > 0 && matchingTerms.length >= Math.ceil(dTerms.length * 0.6)) {
          newlyResolved.push(
            `- ${qText}  \n  _Resolved by decision: \`${d.id}\` — ${d.title}_`,
          )
          resolved = true
          break
        }
      }

      // Check if resolved by a completed task (bidirectional keyword match)
      if (!resolved) {
        for (const t of completedTasks) {
          const tTitle = (t.title ?? "").toLowerCase()
          if (tTitle && (qLower.includes(tTitle) || tTitle.includes(qLower))) {
            newlyResolved.push(
              `- ${qText}  \n  _Resolved by completed task: \`${t.id}\` — ${t.title}_`,
            )
            resolved = true
            break
          }
          // Also check if key terms from the task appear in the question
          const tTerms = tTitle.split(/\s+/).filter((w: string) => w.length > 3)
          const matchingTerms = tTerms.filter((term: string) => qLower.includes(term))
          if (tTerms.length > 0 && matchingTerms.length >= Math.ceil(tTerms.length * 0.6)) {
            newlyResolved.push(
              `- ${qText}  \n  _Resolved by completed task: \`${t.id}\` — ${t.title}_`,
            )
            resolved = true
            break
          }
        }
      }

      if (!resolved) {
        unresolved.push(question.trim())
      }
    }

    if (newlyResolved.length === 0) {
      return noChangeResult("No questions resolved")
    }

    // Build new sections
    const newSections = new Map<string, string>()

    if (unresolved.length > 0) {
      newSections.set("## Active Questions", unresolved.join("\n"))
    } else {
      newSections.set(
        "## Active Questions",
        "_No active unresolved questions._",
      )
    }

    // Preserve Waiting For
    if (waitingBody) {
      newSections.set("## Waiting For", waitingBody)
    }

    // Preserve Unresolved Tradeoffs
    if (tradeoffsBody) {
      newSections.set(
        "## Unresolved Tradeoffs",
        tradeoffsBody,
      )
    }

    // Build Resolved Questions (existing + newly resolved)
    const resolvedLines: string[] = []
    if (resolvedBody && resolvedBody.trim() && resolvedBody !== "- TODO") {
      resolvedLines.push(resolvedBody.trim())
    }
    resolvedLines.push(...newlyResolved)
    newSections.set("## Resolved Questions", resolvedLines.join("\n"))

    const newContent = replaceControlledSections(
      existing,
      newSections,
      [...OPEN_QUESTIONS_CONTROLLED],
    )

    if (existing.trim() === newContent.trim()) {
      return noChangeResult("Content unchanged")
    }

    writeMemoryFile(projectRoot, fileName, newContent)
    refreshManifest(projectRoot, filePath, options)

    log("memory-curator: Resolved open questions", {
      projectRoot,
      resolved: newlyResolved.length,
      remaining: unresolved.length,
    })
    return successResult(fileName, projectRoot)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    errors.push(msg)
    log("memory-curator: Error resolving open-questions.md", { error: msg })
    return errorResult(errors, `Error: ${msg}`)
  }
}

// ---------------------------------------------------------------------------
// 5. compactRiskProfile
// ---------------------------------------------------------------------------

const RISK_PROFILE_CONTROLLED = [
  "## Active Risks",
  "## Resolved Risks",
  "## Sensitive Paths",
  "## Rollback Notes",
] as const

/**
 * Compact risk-profile.md: preserve active risks, compact
 * resolved risks older than threshold keeping latest 10.
 * Preserve Sensitive Paths and Rollback Notes sections.
 * No invented mitigation or warnings.
 */
export function compactRiskProfile(
  projectRoot: string,
  options?: CuratorOptions,
): CuratorResult {
  const fileName = "risk-profile.md"
  const errors: string[] = []

  try {
    const denied = curatorOwnershipCheck(fileName)
    if (denied) return denied

    const existing = readMemoryFile(projectRoot, fileName)
    if (existing === null) {
      return noChangeResult("risk-profile.md does not exist")
    }

    const filePath = getMemoryPath(projectRoot, fileName)

    // Find resolved risks section using split approach
    const sections = existing.split(/\n(?=## )/)
    let resolvedBody = ""
    let activeBody = ""
    let sensitiveBody = ""
    let rollbackBody = ""

    for (const sec of sections) {
      if (sec.startsWith("## Resolved Risks") || sec.startsWith("## Mitigated Risks")) {
        resolvedBody = sec.replace(/^## (?:Resolved|Mitigated) Risks\n?/, "").trim()
      } else if (sec.startsWith("## Active Risks")) {
        activeBody = sec.replace(/^## Active Risks\n?/, "").trim()
      } else if (sec.startsWith("## Sensitive Paths")) {
        sensitiveBody = sec.replace(/^## Sensitive Paths\n?/, "").trim()
      } else if (sec.startsWith("## Rollback Notes")) {
        rollbackBody = sec.replace(/^## Rollback Notes\n?/, "").trim()
      }
    }

    if (!resolvedBody && !activeBody) {
      return noChangeResult("No resolved/mitigated risks section found")
    }

    // Parse resolved risk entries
    const resolvedEntries = resolvedBody
      .split(/\n(?=### )/)
      .filter(
        (entry) =>
          entry.trim().startsWith("### ") && entry.trim() !== "(none recorded)",
      )

    if (resolvedEntries.length <= 10) {
      // Check if already compacted (compaction marker present)
      if (existing.includes("_Older resolved risks compacted:")) {
        return noChangeResult("Resolved risks already compacted")
      }
      return noChangeResult("Resolved risks below compaction threshold")
    }

    // Keep latest 10 (assuming newer entries are appended last)
    const latest = resolvedEntries.slice(-10)
    const olderCount = resolvedEntries.length - 10

    const newSections = new Map<string, string>()

    // Build compacted resolved risks
    const compactedResolved = [
      ...latest,
      `_Older resolved risks compacted: ${olderCount}._`,
    ]
    newSections.set("## Resolved Risks", compactedResolved.join("\n"))

    // Preserve Active Risks
    if (activeBody) {
      newSections.set("## Active Risks", activeBody)
    }

    // Preserve Sensitive Paths
    if (sensitiveBody) {
      newSections.set("## Sensitive Paths", sensitiveBody)
    }

    // Preserve Rollback Notes
    if (rollbackBody) {
      newSections.set("## Rollback Notes", rollbackBody)
    }

    const newContent = replaceControlledSections(
      existing,
      newSections,
      [...RISK_PROFILE_CONTROLLED],
    )

    if (existing.trim() === newContent.trim()) {
      return noChangeResult("Content unchanged")
    }

    writeMemoryFile(projectRoot, fileName, newContent)
    refreshManifest(projectRoot, filePath, options)

    log("memory-curator: Compacted risk-profile.md", {
      projectRoot,
      resolvedEntries: resolvedEntries.length,
      olderCompacted: olderCount,
    })
    return successResult(fileName, projectRoot)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    errors.push(msg)
    log("memory-curator: Error compacting risk-profile.md", { error: msg })
    return errorResult(errors, `Error: ${msg}`)
  }
}

// ---------------------------------------------------------------------------
// 6. enforceQualityHistoryRetention
// ---------------------------------------------------------------------------

/**
 * Enforce quality-history.md retention policy.
 *
 * Keeps last N entries (default 20). Always preserves the latest
 * failure summary even if older than N.
 * Compact older passing entries.
 *
 * IMPORTANT: The curator does NOT own quality-history.md.
 * This function delegates to `compactQualityHistory()` exported
 * from memory-quality-writer.ts which uses the quality_writer identity.
 * The curator creates no new quality results.
 */
export function enforceQualityHistoryRetention(
  projectRoot: string,
  options?: CuratorOptions,
): CuratorResult {
  const errors: string[] = []

  try {
    // We do NOT check curator ownership here — quality-history.md
    // is owned by quality_writer. We delegate to the quality writer.
    const result = compactQualityHistory(
      projectRoot,
      options?.qualityRetentionLimit,
    )

    if (!result.compacted) {
      return noChangeResult(result.reason ?? "No compaction needed")
    }

    return {
      attempted: true,
      updated: true,
      writtenFile: getMemoryPath(projectRoot, "quality-history.md"),
      skippedReason: null,
      errors,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    errors.push(msg)
    log("memory-curator: Error enforcing quality-history retention", {
      error: msg,
    })
    return errorResult(errors, `Error: ${msg}`)
  }
}

// ---------------------------------------------------------------------------
// 7. runMemoryCurator
// ---------------------------------------------------------------------------

/**
 * Run all curator functions in sequence.
 * Each function is independent — failure in one does not block others.
 * Best-effort only; never throws.
 *
 * @param projectRoot - Absolute path to the project root.
 * @param options - Optional curation options.
 * @returns CombinedCuratorResult with individual results.
 */
export function runMemoryCurator(
  projectRoot: string,
  options?: CuratorOptions,
): CombinedCuratorResult {
  const results: CombinedCuratorResult = {
    activeContext: {
      attempted: false,
      updated: false,
      writtenFile: null,
      skippedReason: "Not yet executed",
      errors: [],
    },
    progress: {
      attempted: false,
      updated: false,
      writtenFile: null,
      skippedReason: "Not yet executed",
      errors: [],
    },
    fileMap: {
      attempted: false,
      updated: false,
      writtenFile: null,
      skippedReason: "Not yet executed",
      errors: [],
    },
    openQuestions: {
      attempted: false,
      updated: false,
      writtenFile: null,
      skippedReason: "Not yet executed",
      errors: [],
    },
    riskProfile: {
      attempted: false,
      updated: false,
      writtenFile: null,
      skippedReason: "Not yet executed",
      errors: [],
    },
    qualityHistory: {
      attempted: false,
      updated: false,
      writtenFile: null,
      skippedReason: "Not yet executed",
      errors: [],
    },
  }

  // Run each curator function independently
  try {
    results.activeContext = curateActiveContext(projectRoot, options)
  } catch (err) {
    results.activeContext = {
      attempted: true,
      updated: false,
      writtenFile: null,
      skippedReason: `Unexpected error: ${err instanceof Error ? err.message : String(err)}`,
      errors: [err instanceof Error ? err.message : String(err)],
    }
  }

  try {
    results.progress = compactProgress(projectRoot, options)
  } catch (err) {
    results.progress = {
      attempted: true,
      updated: false,
      writtenFile: null,
      skippedReason: `Unexpected error: ${err instanceof Error ? err.message : String(err)}`,
      errors: [err instanceof Error ? err.message : String(err)],
    }
  }

  try {
    results.fileMap = cleanFileMap(projectRoot, options)
  } catch (err) {
    results.fileMap = {
      attempted: true,
      updated: false,
      writtenFile: null,
      skippedReason: `Unexpected error: ${err instanceof Error ? err.message : String(err)}`,
      errors: [err instanceof Error ? err.message : String(err)],
    }
  }

  try {
    results.openQuestions = resolveOpenQuestions(projectRoot, options)
  } catch (err) {
    results.openQuestions = {
      attempted: true,
      updated: false,
      writtenFile: null,
      skippedReason: `Unexpected error: ${err instanceof Error ? err.message : String(err)}`,
      errors: [err instanceof Error ? err.message : String(err)],
    }
  }

  try {
    results.riskProfile = compactRiskProfile(projectRoot, options)
  } catch (err) {
    results.riskProfile = {
      attempted: true,
      updated: false,
      writtenFile: null,
      skippedReason: `Unexpected error: ${err instanceof Error ? err.message : String(err)}`,
      errors: [err instanceof Error ? err.message : String(err)],
    }
  }

  try {
    results.qualityHistory = enforceQualityHistoryRetention(
      projectRoot,
      options,
    )
  } catch (err) {
    results.qualityHistory = {
      attempted: true,
      updated: false,
      writtenFile: null,
      skippedReason: `Unexpected error: ${err instanceof Error ? err.message : String(err)}`,
      errors: [err instanceof Error ? err.message : String(err)],
    }
  }

  const updatedCount = [
    results.activeContext,
    results.progress,
    results.fileMap,
    results.openQuestions,
    results.riskProfile,
    results.qualityHistory,
  ].filter((r) => r.updated).length

  log("memory-curator: runMemoryCurator complete", {
    projectRoot,
    filesUpdated: updatedCount,
  })

  return results
}
