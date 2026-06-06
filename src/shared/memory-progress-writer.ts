/**
 * Progress Memory Writer — Phase 2 Runtime Consistency
 *
 * Standalone writer for progress.md with lock, ownership enforcement,
 * atomic write, and manifest refresh. All progress.md writes MUST
 * route through this module.
 *
 * Previously, progress writes were done ad-hoc through various paths.
 * This module centralizes and standardizes the write path.
 */

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { log } from "./logger"
import { PROJECT_MEMORY_DIR } from "./memory-bootstrap"
import {
  canWriteMemoryFile,
  type WriterIdentity,
} from "./memory-writer-ownership"
import { writeFileAtomically } from "./write-file-atomically"
import { acquireLock, releaseLock } from "./memory-lock"
import { refreshManifestAfterWrite } from "./memory-manifest-updater"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROGRESS_FILENAME = "progress.md"
const LOCK_SESSION = "memory-progress-writer"
const LOCK_AGENT = "memory-progress-writer"
const LOCK_TTL_SECONDS = 30

/**
 * Writer identity for the progress writer module.
 * @see src/shared/memory-writer-ownership.ts
 */
export const PROGRESS_WRITER_IDENTITY: WriterIdentity = "task_completion_writer"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProgressWriteResult {
  written: boolean
  file: string
  reason: string
  manifestUpdated: boolean
  manifestReason: string | null
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function getProgressPath(projectRoot: string): string {
  return join(projectRoot, PROJECT_MEMORY_DIR, PROGRESS_FILENAME)
}

// ---------------------------------------------------------------------------
// Last updated updater
// ---------------------------------------------------------------------------

function updateLastUpdatedDate(content: string): string {
  const today = new Date().toISOString().slice(0, 10)
  return content.replace(/^(Last\s+updated:\s*).*/m, `$1${today}`)
}

// ---------------------------------------------------------------------------
// Base template
// ---------------------------------------------------------------------------

function generateBaseTemplate(): string {
  const today = new Date().toISOString().slice(0, 10)
  return `# Progress\n\nLast updated: ${today}\n\n## Completed\n\n- (none recorded)\n\n## In Progress\n\n- (none recorded)\n\n## Blocked\n\n- (none recorded)\n`
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

/**
 * Append or compact-update progress.md.
 *
 * Takes an ordered list of progress entries and writes them to the
 * ## Completed section of progress.md. Preserves content outside
 * the ## Completed section.
 *
 * Acquires lock, enforces ownership, writes atomically, refreshes
 * manifest, releases lock.
 *
 * @param projectRoot - Absolute path to the project root.
 * @param entries - Ordered list of progress entries (milestones).
 * @param writer - Optional writer identity (defaults to PROGRESS_WRITER_IDENTITY).
 * @returns ProgressWriteResult with outcome.
 */
export function writeProgress(
  projectRoot: string,
  entries: string[],
  writer?: WriterIdentity,
): ProgressWriteResult {
  const effectiveWriter = writer ?? PROGRESS_WRITER_IDENTITY
  const ownershipCheck = canWriteMemoryFile(effectiveWriter, PROGRESS_FILENAME)

  if (!ownershipCheck.authorized) {
    return {
      written: false,
      file: PROGRESS_FILENAME,
      reason: `Ownership violation: ${ownershipCheck.reason}`,
      manifestUpdated: false,
      manifestReason: null,
    }
  }

  if (!entries || entries.length === 0) {
    return {
      written: false,
      file: PROGRESS_FILENAME,
      reason: "no entries to write",
      manifestUpdated: false,
      manifestReason: null,
    }
  }

  // Acquire lock
  const lockResult = acquireLock(projectRoot, PROGRESS_FILENAME, LOCK_SESSION, LOCK_AGENT, LOCK_TTL_SECONDS)
  if (!lockResult.acquired) {
    return {
      written: false,
      file: PROGRESS_FILENAME,
      reason: `lock timeout: ${lockResult.reason || "could not acquire lock"}`,
      manifestUpdated: false,
      manifestReason: null,
    }
  }

  try {
    const filePath = getProgressPath(projectRoot)
    let existing = existsSync(filePath) ? readFileSync(filePath, "utf-8") : ""

    // If file doesn't exist, create from template
    if (!existing.trim()) {
      existing = generateBaseTemplate()
    }

    // Build the completed section content
    const completedLines = entries.map((entry) => `- [x] ${entry}`).join("\n")

    // Replace or insert ## Completed section
    const completedHeader = "## Completed"
    const headerIndex = existing.indexOf(completedHeader)

    let newContent: string
    if (headerIndex === -1) {
      // No completed section found — append it
      newContent = existing.trimEnd() + `\n\n${completedHeader}\n\n${completedLines}\n`
    } else {
      // Find end of completed section (next ## or end of file)
      const afterHeader = existing.indexOf("\n", headerIndex) + 1
      const remainingAfterHeader = existing.slice(afterHeader)
      const nextSectionMatch = remainingAfterHeader.match(/\n(?=## )/)

      let completedSectionEnd: number
      if (nextSectionMatch && nextSectionMatch.index !== undefined) {
        completedSectionEnd = afterHeader + nextSectionMatch.index
      } else {
        completedSectionEnd = existing.length
      }

      const beforeSection = existing.slice(0, headerIndex)
      const afterSection = existing.slice(completedSectionEnd)

      newContent = beforeSection.trimEnd() + `\n\n${completedHeader}\n\n${completedLines}\n` + afterSection
    }

    // Update "Last updated:" date
    newContent = updateLastUpdatedDate(newContent)

    // Atomic write
    writeFileAtomically(filePath, newContent)

    // Refresh manifest
    let manifestUpdated = false
    let manifestReason: string | null = null
    try {
      const manifestResult = refreshManifestAfterWrite(projectRoot, filePath)
      manifestUpdated = manifestResult.updated
      if (!manifestUpdated) {
        manifestReason = manifestResult.reason
        log("memory-progress-writer: Manifest refresh failed", {
          reason: manifestResult.reason,
        })
      }
    } catch (manifestError) {
      manifestReason = manifestError instanceof Error ? manifestError.message : "unknown error"
      log("memory-progress-writer: Manifest refresh error (non-blocking)", {
        error: manifestReason,
      })
    }

    return {
      written: true,
      file: PROGRESS_FILENAME,
      reason: `wrote ${entries.length} progress entries`,
      manifestUpdated,
      manifestReason,
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    log("memory-progress-writer: Write failed", {
      projectRoot,
      error: msg,
    })
    return {
      written: false,
      file: PROGRESS_FILENAME,
      reason: `write failed: ${msg}`,
      manifestUpdated: false,
      manifestReason: null,
    }
  } finally {
    releaseLock(projectRoot, PROGRESS_FILENAME, LOCK_SESSION, LOCK_AGENT)
  }
}

// ---------------------------------------------------------------------------
// Convenience: append a single progress entry (milestone)
// ---------------------------------------------------------------------------

/**
 * Append a single milestone to progress.md.
 *
 * Reads existing entries, appends the new milestone, and writes
 * the combined list through writeProgress.
 *
 * @param projectRoot - Absolute path to the project root.
 * @param milestone - Single milestone description.
 * @param writer - Optional writer identity.
 */
export function appendProgressMilestone(
  projectRoot: string,
  milestone: string,
  writer?: WriterIdentity,
): ProgressWriteResult {
  if (!milestone || milestone.trim().length === 0) {
    return {
      written: false,
      file: PROGRESS_FILENAME,
      reason: "empty milestone",
      manifestUpdated: false,
      manifestReason: null,
    }
  }

  // Read existing entries from progress.md
  const filePath = getProgressPath(projectRoot)
  let existingEntries: string[] = []

  if (existsSync(filePath)) {
    try {
      const content = readFileSync(filePath, "utf-8")
      // Extract completed entries from ## Completed section
      const completedHeader = "## Completed"
      const headerIndex = content.indexOf(completedHeader)
      if (headerIndex >= 0) {
        const afterHeader = content.indexOf("\n", headerIndex) + 1
        const sectionContent = content.slice(afterHeader)
        const nextSection = sectionContent.indexOf("\n## ")
        const completedSection = nextSection >= 0 ? sectionContent.slice(0, nextSection) : sectionContent

        // Parse existing [x] entries
        for (const line of completedSection.split("\n")) {
          const trimmed = line.trim()
          const entryMatch = trimmed.match(/^- \[[x ]\]\s+(.+)$/)
          if (entryMatch) {
            existingEntries.push(entryMatch[1])
          }
        }
      }
    } catch {
      // best-effort
    }
  }

  // Combine existing entries with the new milestone (deduplicate)
  const allEntries = [...existingEntries]
  if (!allEntries.includes(milestone.trim())) {
    allEntries.push(milestone.trim())
  }

  return writeProgress(projectRoot, allEntries, writer)
}
