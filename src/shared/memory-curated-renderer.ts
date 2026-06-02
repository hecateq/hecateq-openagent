import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import type { DecisionLogEntry } from "./decision-log"
import {
  readDecisionLog,
  resolveLatestDecisionState,
  buildCompactDecisionSummary,
} from "./decision-log"
import { log } from "./logger"
import { PROJECT_MEMORY_DIR } from "./memory-bootstrap"
import { refreshManifestAfterWrite } from "./memory-manifest-updater"
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
 * Writer identity for the memory curated renderer module.
 * This module renders tasks.md and decisions.md and is owned by memory_curator.
 * @see src/shared/memory-writer-ownership.ts
 */
const CURATOR_IDENTITY: WriterIdentity = "memory_curator"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for rendering. */
export interface RenderOptions {
  /** Maximum number of completed tasks to show in Done section. Default 15. */
  maxDoneTasks?: number
  /** Session ID for manifest refresh stamp. */
  sessionId?: string
  /** Agent name for manifest refresh stamp. */
  agent?: string
}

/** Result of a single render operation. */
export interface RenderResult {
  /** True if a render was attempted. */
  attempted: boolean
  /** True if the file was actually written (content changed). */
  updated: boolean
  /** The file that was written, or null. */
  writtenFile: string | null
  /** If not written, the reason. */
  skippedReason: string | null
  /** Any non-fatal errors encountered during rendering. */
  errors: string[]
}

/** Combined result of rendering both tasks.md and decisions.md. */
export interface CombinedRenderResult {
  tasks: RenderResult
  decisions: RenderResult
}

// ---------------------------------------------------------------------------
// Controlled section replacement
// ---------------------------------------------------------------------------

/**
 * Known controlled section headings for tasks.md.
 * Only sections starting with these headings are replaced.
 * User-authored sections outside these headings are preserved.
 */
const TASKS_CONTROLLED_HEADINGS = [
  "## Pending",
  "## Blocked",
  "## Done",
  "## Archived",
] as const

/**
 * Known controlled section headings for decisions.md.
 * Only sections starting with these headings are replaced.
 * User-authored sections outside these headings are preserved.
 */
const DECISIONS_CONTROLLED_HEADINGS = [
  "## Accepted Decisions",
  "## Rejected Approaches",
  "## Superseded / Reverted Decisions",
] as const

/**
 * Replace controlled sections in markdown content.
 *
 * Only sections starting with the given controlled headings are replaced.
 * All other content (user-authored sections, comments, annotations) is preserved.
 * If a controlled heading does not appear in the new content, it is removed from
 * the output (unless it was not present in the original either).
 *
 * @param existing - The existing markdown content (or empty string if new file).
 * @param newSections - Map of heading text (including ##) to replacement body.
 * @param controlledHeadings - The headings that are controlled.
 * @returns The updated markdown content.
 */
function replaceControlledSections(
  existing: string,
  newSections: Map<string, string>,
  controlledHeadings: readonly string[],
): string {
  const controlledSet = new Set(controlledHeadings)
  const lines = existing.split("\n")
  const result: string[] = []
  let inControlledSection = false
  let currentControlledHeading: string | null = null
  const consumedHeadings = new Set<string>()

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()

    // Check if this line starts a new section
    const isHeading = trimmed.startsWith("## ")
    if (isHeading) {
      // Find which controlled heading this matches
      const matchedHeading = controlledHeadings.find((h) =>
        trimmed.startsWith(h),
      )
      if (matchedHeading) {
        // This is a controlled section heading
        // Skip all lines until the next heading
        inControlledSection = true
        currentControlledHeading = matchedHeading
        // Find end of this section
        while (i + 1 < lines.length && !lines[i + 1].trim().startsWith("## ")) {
          i++
        }
        continue
      }
      // Non-controlled heading
      inControlledSection = false
      currentControlledHeading = null
    }

    if (!inControlledSection) {
      result.push(line)
    }
  }

  // At this point, result has all non-controlled content.
  // Now inject the new controlled sections after the first ## heading,
  // or append at the end if no ## heading exists.

  const finalResult: string[] = []
  let injected = false

  for (const line of result) {
    finalResult.push(line)
    // Inject new sections after the first ## heading we encounter
    if (!injected && line.trim().startsWith("## ")) {
      // Check that this is not already a controlled heading we've seen
      const isControlled = controlledHeadings.some((h) =>
        line.trim().startsWith(h),
      )
      if (isControlled) {
        // Insert new controlled sections before the first controlled heading
        for (const heading of controlledHeadings) {
          const body = newSections.get(heading)
          if (body !== undefined) {
            finalResult.pop() // Remove this heading line, we'll re-add it
            injected = true
            break
          }
        }
        if (injected) {
          for (const heading of controlledHeadings) {
            const body = newSections.get(heading)
            if (body !== undefined) {
              finalResult.push(heading)
              finalResult.push("")
              finalResult.push(body)
              finalResult.push("")
            }
          }
          // Push the heading line we removed
          finalResult.push(line)
          continue
        }
      }
    }
  }

  // If we didn't inject yet (no ## headings in preserved content),
  // append the new sections at the end.
  if (!injected) {
    // Remove trailing blank lines
    while (
      finalResult.length > 0 &&
      finalResult[finalResult.length - 1].trim() === ""
    ) {
      finalResult.pop()
    }
    if (finalResult.length > 0) {
      finalResult.push("")
    }
    for (const heading of controlledHeadings) {
      const body = newSections.get(heading)
      if (body !== undefined) {
        finalResult.push(heading)
        finalResult.push("")
        finalResult.push(body)
        finalResult.push("")
      }
    }
  }

  // Clean up: remove trailing blank lines, ensure single trailing newline
  while (
    finalResult.length > 0 &&
    finalResult[finalResult.length - 1].trim() === ""
  ) {
    finalResult.pop()
  }

  return finalResult.join("\n") + "\n"
}

// ---------------------------------------------------------------------------
// Task rendering
// ---------------------------------------------------------------------------

/**
 * Get the file path for tasks.jsonl within the project.
 */
function getTasksJsonlPath(projectRoot: string): string {
  return join(projectRoot, PROJECT_MEMORY_DIR, "tasks.jsonl")
}

/**
 * Get the file path for tasks.md within the project.
 */
function getTasksMdPath(projectRoot: string): string {
  return join(projectRoot, PROJECT_MEMORY_DIR, "tasks.md")
}

/**
 * Render the tasks.md file from tasks.jsonl data.
 *
 * Reads tasks.jsonl, resolves the latest state per task ID,
 * groups into Pending/Blocked/Done sections, and writes tasks.md
 * using controlled section replacement to preserve user-authored content
 * outside the controlled sections.
 *
 * Best-effort: never throws. Returns a RenderResult with outcome.
 *
 * @param projectRoot - Absolute path to the project root.
 * @param options - Optional rendering options.
 * @returns RenderResult describing the outcome.
 */
export async function renderTasksMarkdownFromJsonl(
  projectRoot: string,
  options?: RenderOptions,
): Promise<RenderResult> {
  const errors: string[] = []
  const maxDone = options?.maxDoneTasks ?? 15

  try {
    // Step 1: Verify curator ownership
    const ownershipCheck = canWriteMemoryFile(CURATOR_IDENTITY, "tasks.md")
    if (!ownershipCheck.authorized) {
      return {
        attempted: false,
        updated: false,
        writtenFile: null,
        skippedReason: `Ownership violation: ${ownershipCheck.reason}`,
        errors: [],
      }
    }

    const jsonlPath = getTasksJsonlPath(projectRoot)
    const mdPath = getTasksMdPath(projectRoot)

    // Step 2: Read tasks.jsonl
    const entries = readTaskState(projectRoot)
    if (entries === null) {
      // No tasks.jsonl exists — nothing to render
      return {
        attempted: true,
        updated: false,
        writtenFile: null,
        skippedReason: "No tasks.jsonl found",
        errors,
      }
    }

    // Step 3: Resolve latest state per task ID
    const latestMap = resolveLatestTaskState(entries)
    const allTasks = [...latestMap.values()]

    // Step 4: Group tasks by status
    const pending: TaskStateEntry[] = []
    const blocked: TaskStateEntry[] = []
    const done: TaskStateEntry[] = []

    for (const task of allTasks) {
      switch (task.status) {
        case "planned":
        case "in_progress":
          pending.push(task)
          break
        case "blocked":
          blocked.push(task)
          break
        case "completed":
        case "cancelled":
        case "stale":
          done.push(task)
          break
      }
    }

    // Sort pending/blocked by priority then timestamp
    const priorityOrder: Record<string, number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
    }

    pending.sort((a, b) => {
      const pa = priorityOrder[a.priority ?? "medium"] ?? 2
      const pb = priorityOrder[b.priority ?? "medium"] ?? 2
      if (pa !== pb) return pa - pb
      return b.timestamp.localeCompare(a.timestamp)
    })

    blocked.sort((a, b) => {
      const pa = priorityOrder[a.priority ?? "medium"] ?? 2
      const pb = priorityOrder[b.priority ?? "medium"] ?? 2
      if (pa !== pb) return pa - pb
      return b.timestamp.localeCompare(a.timestamp)
    })

    // Sort done by timestamp descending, limit to maxDone
    done.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    const limitedDone = done.slice(0, maxDone)

    // Step 5: Build markdown sections
    const newSections = new Map<string, string>()

    // Pending section
    if (pending.length > 0) {
      const lines: string[] = []
      for (const task of pending) {
        const statusLabel =
          task.status === "in_progress" ? " [in progress]" : ""
        const priorityLabel = task.priority ? ` (${task.priority})` : ""
        lines.push(`- **${task.title}**${statusLabel}${priorityLabel}`)
        if (task.verification) {
          lines.push(`  - Verification: ${task.verification}`)
        }
        if (task.notes) {
          lines.push(`  - Notes: ${task.notes}`)
        }
        if (task.dependencies && task.dependencies.length > 0) {
          lines.push(
            `  - Depends on: ${task.dependencies.map((d) => `\`${d}\``).join(", ")}`,
          )
        }
      }
      newSections.set("## Pending", lines.join("\n"))
    } else {
      newSections.set(
        "## Pending",
        "_No pending tasks._",
      )
    }

    // Blocked section
    if (blocked.length > 0) {
      const lines: string[] = []
      for (const task of blocked) {
        lines.push(`- **${task.title}** (blocked)`)
        if (task.blockers && task.blockers.length > 0) {
          lines.push(
            `  - Blockers: ${task.blockers.map((b) => `\`${b}\``).join(", ")}`,
          )
        }
        if (task.notes) {
          lines.push(`  - Notes: ${task.notes}`)
        }
      }
      newSections.set("## Blocked", lines.join("\n"))
    } else {
      newSections.set(
        "## Blocked",
        "_No blocked tasks._",
      )
    }

    // Done section
    if (limitedDone.length > 0) {
      const lines: string[] = []
      for (const task of limitedDone) {
        const statusLabel =
          task.status === "cancelled"
            ? " [cancelled]"
            : task.status === "stale"
              ? " [stale]"
              : ""
        lines.push(`- ~~${task.title}~~${statusLabel}`)
      }
      if (done.length > maxDone) {
        lines.push(
          `_... and ${done.length - maxDone} more completed tasks not shown_`,
        )
      }
      newSections.set("## Done", lines.join("\n"))
    } else {
      newSections.set(
        "## Done",
        "_No completed tasks yet._",
      )
    }

    // Step 6: Read existing tasks.md (if any)
    let existingContent = ""
    if (existsSync(mdPath)) {
      try {
        existingContent = readFileSync(mdPath, "utf-8")
      } catch {
        // If we can't read existing, proceed with empty
        log("memory-curated-renderer: Could not read existing tasks.md", {
          projectRoot,
        })
      }
    }

    // Step 7: Perform controlled section replacement
    const newContent = replaceControlledSections(
      existingContent,
      newSections,
      [...TASKS_CONTROLLED_HEADINGS],
    )

    // Step 8: Compare with existing and write if changed
    if (existingContent === newContent) {
      return {
        attempted: true,
        updated: false,
        writtenFile: null,
        skippedReason: "Content unchanged",
        errors,
      }
    }

    writeFileAtomically(mdPath, newContent)

    // Step 9: Refresh manifest (best-effort)
    try {
      refreshManifestAfterWrite(
        projectRoot,
        mdPath,
        undefined,
        options?.agent,
        options?.sessionId,
        CURATOR_IDENTITY,
      )
    } catch (manifestErr) {
      log(
        "memory-curated-renderer: Manifest refresh failed for tasks.md",
        {
          error:
            manifestErr instanceof Error
              ? manifestErr.message
              : String(manifestErr),
        },
      )
    }

    log("memory-curated-renderer: Rendered tasks.md", {
      projectRoot,
      pending: pending.length,
      blocked: blocked.length,
      done: limitedDone.length,
      totalDone: done.length,
    })

    return {
      attempted: true,
      updated: true,
      writtenFile: mdPath,
      skippedReason: null,
      errors,
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    errors.push(msg)
    log("memory-curated-renderer: Error rendering tasks.md", { error: msg })
    return {
      attempted: true,
      updated: false,
      writtenFile: null,
      skippedReason: `Error: ${msg}`,
      errors,
    }
  }
}

// ---------------------------------------------------------------------------
// Decision rendering
// ---------------------------------------------------------------------------

/**
 * Get the file path for decisions.jsonl within the project.
 */
function getDecisionsJsonlPath(projectRoot: string): string {
  return join(projectRoot, PROJECT_MEMORY_DIR, "decisions.jsonl")
}

/**
 * Get the file path for decisions.md within the project.
 */
function getDecisionsMdPath(projectRoot: string): string {
  return join(projectRoot, PROJECT_MEMORY_DIR, "decisions.md")
}

/**
 * Render the decisions.md file from decisions.jsonl data.
 *
 * Reads decisions.jsonl, resolves the latest state per decision ID,
 * groups into Accepted/Rejected/Superseded sections, and writes decisions.md
 * using controlled section replacement to preserve user-authored content
 * outside the controlled sections, especially the ## Notes section.
 *
 * Best-effort: never throws. Returns a RenderResult with outcome.
 *
 * @param projectRoot - Absolute path to the project root.
 * @param options - Optional rendering options.
 * @returns RenderResult describing the outcome.
 */
export async function renderDecisionsMarkdownFromJsonl(
  projectRoot: string,
  options?: RenderOptions,
): Promise<RenderResult> {
  const errors: string[] = []

  try {
    // Step 1: Verify curator ownership
    const ownershipCheck = canWriteMemoryFile(CURATOR_IDENTITY, "decisions.md")
    if (!ownershipCheck.authorized) {
      return {
        attempted: false,
        updated: false,
        writtenFile: null,
        skippedReason: `Ownership violation: ${ownershipCheck.reason}`,
        errors: [],
      }
    }

    const jsonlPath = getDecisionsJsonlPath(projectRoot)
    const mdPath = getDecisionsMdPath(projectRoot)

    // Step 2: Read decisions.jsonl
    const entries = readDecisionLog(projectRoot)
    if (entries === null) {
      return {
        attempted: true,
        updated: false,
        writtenFile: null,
        skippedReason: "No decisions.jsonl found",
        errors,
      }
    }

    // Step 3: Resolve latest state per decision ID
    const latestMap = resolveLatestDecisionState(entries)
    const allDecisions = [...latestMap.values()]

    // Step 4: Group decisions by status and build summary
    const summary = buildCompactDecisionSummary(entries)
    const acceptedDecisions = summary.active
    const supersededReverted = [...summary.superseded, ...summary.reverted]

    // Step 5: Build markdown sections
    const newSections = new Map<string, string>()

    // Accepted Decisions section
    if (acceptedDecisions.length > 0) {
      const lines: string[] = []
      for (const d of acceptedDecisions) {
        lines.push(`### ${d.title}`)
        lines.push("")
        lines.push(`**Decision:** ${d.decision}`)
        lines.push("")
        lines.push(`**Rationale:** ${d.rationale}`)
        lines.push("")
        if (d.impact_area) {
          lines.push(`- **Impact Area:** ${d.impact_area}`)
          lines.push("")
        }
        if (
          d.alternatives_rejected &&
          d.alternatives_rejected.length > 0
        ) {
          lines.push(
            `**Alternatives Rejected:** ${d.alternatives_rejected.join(", ")}`,
          )
          lines.push("")
        }
        if (d.notes) {
          lines.push(`**Notes:** ${d.notes}`)
          lines.push("")
        }
        lines.push(`_Recorded: ${d.timestamp}_`)
        lines.push("")
      }
      newSections.set("## Accepted Decisions", lines.join("\n"))
    } else {
      newSections.set(
        "## Accepted Decisions",
        "_No active decisions._",
      )
    }

    // Rejected Approaches section
    // Rejected alternatives come from the `alternatives_rejected` field
    // Collect distinct rejected alternatives across all decisions
    const rejectedAlternatives = new Set<string>()
    for (const d of allDecisions) {
      if (
        d.alternatives_rejected &&
        d.alternatives_rejected.length > 0
      ) {
        for (const alt of d.alternatives_rejected) {
          rejectedAlternatives.add(alt)
        }
      }
    }

    if (rejectedAlternatives.size > 0) {
      const lines: string[] = []
      for (const alt of rejectedAlternatives) {
        lines.push(`- ${alt}`)
      }
      newSections.set("## Rejected Approaches", lines.join("\n"))
    } else {
      newSections.set(
        "## Rejected Approaches",
        "_No rejected approaches on record._",
      )
    }

    // Superseded / Reverted Decisions section
    if (supersededReverted.length > 0) {
      const lines: string[] = []
      for (const d of supersededReverted) {
        const statusLabel =
          d.status === "superseded"
            ? " [superseded]"
            : " [reverted]"
        lines.push(`- ~~${d.title}~~${statusLabel}`)
        if (d.superseded_by) {
          lines.push(`  - Superseded by: \`${d.superseded_by}\``)
        }
        if (d.changed_by) {
          lines.push(`  - Changed by: \`${d.changed_by}\``)
        }
      }
      newSections.set(
        "## Superseded / Reverted Decisions",
        lines.join("\n"),
      )
    } else {
      newSections.set(
        "## Superseded / Reverted Decisions",
        "_No superseded or reverted decisions._",
      )
    }

    // Step 6: Read existing decisions.md (if any)
    let existingContent = ""
    if (existsSync(mdPath)) {
      try {
        existingContent = readFileSync(mdPath, "utf-8")
      } catch {
        log(
          "memory-curated-renderer: Could not read existing decisions.md",
          { projectRoot },
        )
      }
    }

    // Step 7: Perform controlled section replacement
    const newContent = replaceControlledSections(
      existingContent,
      newSections,
      [...DECISIONS_CONTROLLED_HEADINGS],
    )

    // Step 8: Compare with existing and write if changed
    if (existingContent === newContent) {
      return {
        attempted: true,
        updated: false,
        writtenFile: null,
        skippedReason: "Content unchanged",
        errors,
      }
    }

    writeFileAtomically(mdPath, newContent)

    // Step 9: Refresh manifest (best-effort)
    try {
      refreshManifestAfterWrite(
        projectRoot,
        mdPath,
        undefined,
        options?.agent,
        options?.sessionId,
        CURATOR_IDENTITY,
      )
    } catch (manifestErr) {
      log(
        "memory-curated-renderer: Manifest refresh failed for decisions.md",
        {
          error:
            manifestErr instanceof Error
              ? manifestErr.message
              : String(manifestErr),
        },
      )
    }

    log("memory-curated-renderer: Rendered decisions.md", {
      projectRoot,
      accepted: acceptedDecisions.length,
      supersededReverted: supersededReverted.length,
      rejectedAlternatives: rejectedAlternatives.size,
    })

    return {
      attempted: true,
      updated: true,
      writtenFile: mdPath,
      skippedReason: null,
      errors,
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    errors.push(msg)
    log("memory-curated-renderer: Error rendering decisions.md", { error: msg })
    return {
      attempted: true,
      updated: false,
      writtenFile: null,
      skippedReason: `Error: ${msg}`,
      errors,
    }
  }
}

/**
 * Render both tasks.md and decisions.md from their JSONL sources.
 *
 * Convenience function that calls both render functions sequentially.
 * Each render is independent — failure in one does not block the other.
 *
 * @param projectRoot - Absolute path to the project root.
 * @param options - Optional rendering options.
 * @returns CombinedRenderResult with results for both renders.
 */
export async function renderTaskAndDecisionMarkdown(
  projectRoot: string,
  options?: RenderOptions,
): Promise<CombinedRenderResult> {
  const tasks = await renderTasksMarkdownFromJsonl(projectRoot, options)
  const decisions = await renderDecisionsMarkdownFromJsonl(projectRoot, options)

  return { tasks, decisions }
}
