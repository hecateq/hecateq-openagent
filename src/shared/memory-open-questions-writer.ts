/**
 * Open Questions Memory Writer
 *
 * Standalone writer for open-questions.md. Handles MEMORY_UPDATE entries
 * targeted at "open_questions" and writes them to the project memory file.
 *
 * Previously, open_questions entries were deferred in the router because
 * no dedicated writer existed. This module closes that gap.
 *
 * Phase 4B — Dedicated open-questions writer
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

const OPEN_QUESTIONS_FILENAME = "open-questions.md"
const LOCK_AGENT = "memory-open-questions-writer"
const LOCK_SESSION = "internal"
const LOCK_TTL_SECONDS = 30

/**
 * Writer identity for the open-questions writer module.
 * @see src/shared/memory-writer-ownership.ts
 */
export const OPEN_QUESTIONS_WRITER_IDENTITY: WriterIdentity = "open_questions_writer"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OpenQuestionEntry {
  /** The question text. */
  question: string
  /** Optional context or reason the question arose. */
  context?: string
  /** Optional answer, if resolved. */
  answer?: string
  /** ISO timestamp of when this question was recorded. */
  timestamp?: string
  /** Link to the resolution (task ID, decision ID, etc.). */
  resolved_by?: string
  /** Category: "active", "waiting", "tradeoff", "resolved". */
  category?: "active" | "waiting" | "tradeoff" | "resolved"
}

export interface OpenQuestionsWriteResult {
  written: boolean
  file: string
  reason: string
  /** Whether the manifest was refreshed after the write. */
  manifestUpdated?: boolean
  /** Reason if manifest refresh failed or was skipped, null if manifest was updated. */
  manifestReason?: string | null
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function getOpenQuestionsPath(projectRoot: string): string {
  return join(projectRoot, PROJECT_MEMORY_DIR, OPEN_QUESTIONS_FILENAME)
}

// ---------------------------------------------------------------------------
// Section headings
// ---------------------------------------------------------------------------

const CATEGORY_HEADINGS: Record<string, string> = {
  active: "## Active Questions",
  waiting: "## Waiting For",
  tradeoff: "## Unresolved Tradeoffs",
  resolved: "## Resolved Questions",
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function formatEntry(entry: OpenQuestionEntry): string {
  const ts = entry.timestamp
    ? ` [${entry.timestamp.slice(0, 10)}]`
    : ""
  const context = entry.context ? ` — ${entry.context}` : ""
  const answer = entry.answer ? `\n  - **Answer**: ${entry.answer}` : ""
  const resolvedBy = entry.resolved_by
    ? `\n  - **Resolved by**: ${entry.resolved_by}`
    : ""

  return `- ${entry.question}${ts}${context}${answer}${resolvedBy}`
}

// ---------------------------------------------------------------------------
// Content builder
// ---------------------------------------------------------------------------

function buildOpenQuestionsContent(
  entries: OpenQuestionEntry[],
  existingContent: string,
): string {
  const today = new Date().toISOString().slice(0, 10)
  const groups: Record<string, OpenQuestionEntry[]> = {
    active: [],
    waiting: [],
    tradeoff: [],
    resolved: [],
  }

  for (const entry of entries) {
    const cat = entry.category ?? "active"
    if (groups[cat]) {
      groups[cat].push(entry)
    } else {
      groups.active.push(entry)
    }
  }

  // Build new controlled sections
  const sections: string[] = [`# Open Questions\n\nLast updated: ${today}`]

  for (const [cat, heading] of Object.entries(CATEGORY_HEADINGS)) {
    const catEntries = groups[cat] ?? []
    if (catEntries.length > 0) {
      const formatted = catEntries.map(formatEntry).join("\n")
      sections.push(`\n${heading}\n\n${formatted}`)
    } else {
      const placeholder =
        cat === "resolved"
          ? "<!-- When a question is resolved, move it here with a pointer to the decision or task. -->"
          : "_None._"
      sections.push(`\n${heading}\n\n${placeholder}`)
    }
  }

  const newContent = sections.join("\n") + "\n"

  // If there was existing content with user-authored notes outside sections,
  // we need to preserve them. Check for non-section content.
  if (existingContent.trim().length > 0) {
    // Extract any content after the last known section heading
    const knownHeadings = Object.values(CATEGORY_HEADINGS).map(
      (h) => new RegExp(`^${h}$`, "m"),
    )
    const lines = existingContent.split("\n")
    let afterLastSection = false
    const preservedNotes: string[] = []

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim()
      const isKnownHeading = knownHeadings.some((h) => h.test(trimmed))
      if (isKnownHeading) {
        afterLastSection = true
        continue
      }
      if (afterLastSection) {
        // Check if this is a section we manage
        const isOurSection = trimmed.startsWith("## ") && Object.values(CATEGORY_HEADINGS).some((h) => trimmed.startsWith(h))
        if (isOurSection) {
          afterLastSection = false
          continue
        }
        // Skip empty lines and comment lines
        if (trimmed.length > 0 && !trimmed.startsWith("<!--") && !trimmed.startsWith("_")) {
          preservedNotes.push(lines[i])
        }
      }
    }

    if (preservedNotes.length > 0) {
      return newContent.trimEnd() + "\n\n## Notes\n\n" + preservedNotes.join("\n") + "\n"
    }
  }

  return newContent
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

/**
 * Write open questions to open-questions.md.
 *
 * Acquires lock, enforces ownership, writes atomically, refreshes manifest,
 * releases lock. Best-effort: never throws. Returns a result indicating
 * whether the write was performed, manifest status, and the reason.
 *
 * @param projectRoot - Absolute path to the project root.
 * @param entries - Open question entries to write.
 * @param writer - Optional writer identity (defaults to OPEN_QUESTIONS_WRITER_IDENTITY).
 * @returns OpenQuestionsWriteResult with outcome.
 */
export function writeOpenQuestions(
  projectRoot: string,
  entries: OpenQuestionEntry[],
  writer?: WriterIdentity,
): OpenQuestionsWriteResult {
  const effectiveWriter = writer ?? OPEN_QUESTIONS_WRITER_IDENTITY
  const ownershipCheck = canWriteMemoryFile(effectiveWriter, OPEN_QUESTIONS_FILENAME)

  if (!ownershipCheck.authorized) {
    return {
      written: false,
      file: OPEN_QUESTIONS_FILENAME,
      reason: `Ownership violation: ${ownershipCheck.reason}`,
      manifestUpdated: false,
      manifestReason: ownershipCheck.reason,
    }
  }

  if (!entries || entries.length === 0) {
    return {
      written: false,
      file: OPEN_QUESTIONS_FILENAME,
      reason: "no entries to write",
      manifestUpdated: false,
      manifestReason: null,
    }
  }

  // Acquire lock before read/merge/write
  const lockResult = acquireLock(projectRoot, OPEN_QUESTIONS_FILENAME, LOCK_SESSION, LOCK_AGENT, LOCK_TTL_SECONDS)
  if (!lockResult.acquired) {
    return {
      written: false,
      file: OPEN_QUESTIONS_FILENAME,
      reason: `lock timeout: ${lockResult.reason || "could not acquire lock"}`,
      manifestUpdated: false,
      manifestReason: lockResult.reason || "lock timeout",
    }
  }

  try {
    const filePath = getOpenQuestionsPath(projectRoot)
    const existing = existsSync(filePath) ? readFileSync(filePath, "utf-8") : ""
    const newContent = buildOpenQuestionsContent(entries, existing)

    writeFileAtomically(filePath, newContent)

    // Refresh manifest after successful write
    let manifestUpdated = false
    let manifestReason: string | null = null
    try {
      const manifestResult = refreshManifestAfterWrite(projectRoot, filePath)
      manifestUpdated = manifestResult.updated
      if (!manifestUpdated) {
        manifestReason = manifestResult.reason || "unknown"
      }
    } catch (manifestError) {
      manifestReason = manifestError instanceof Error ? manifestError.message : "unknown error"
      log("memory-open-questions-writer: Manifest refresh failed (non-blocking)", {
        error: manifestReason,
      })
    }

    log("memory-open-questions-writer: Wrote open-questions.md", {
      projectRoot,
      entryCount: entries.length,
      manifestUpdated,
    })

    return {
      written: true,
      file: OPEN_QUESTIONS_FILENAME,
      reason: manifestUpdated
        ? `wrote ${entries.length} open question(s) (manifest updated)`
        : `wrote ${entries.length} open question(s) (manifest: ${manifestReason || "not updated"})`,
      manifestUpdated,
      manifestReason,
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    log("memory-open-questions-writer: Write failed", {
      projectRoot,
      error: msg,
    })
    return {
      written: false,
      file: OPEN_QUESTIONS_FILENAME,
      reason: `write failed: ${msg}`,
      manifestUpdated: false,
      manifestReason: `write failed: ${msg}`,
    }
  } finally {
    releaseLock(projectRoot, OPEN_QUESTIONS_FILENAME, LOCK_SESSION, LOCK_AGENT)
  }
}

/**
 * Write a single open question entry from a MEMORY_UPDATE signal.
 *
 * Parses the data fields and delegates to writeOpenQuestions.
 *
 * @param projectRoot - Absolute path to the project root.
 * @param data - The data object from the MEMORY_UPDATE entry.
 * @param writer - Optional writer identity.
 */
export function writeOpenQuestionFromSignal(
  projectRoot: string,
  data: Record<string, unknown> | undefined,
  writer?: WriterIdentity,
): OpenQuestionsWriteResult {
  const question =
    typeof data?.question === "string"
      ? data.question
      : typeof data?.description === "string"
        ? data.description
        : ""

  if (!question || question.length < 5) {
    return {
      written: false,
      file: OPEN_QUESTIONS_FILENAME,
      reason: "question text too short or missing",
    }
  }

  const entry: OpenQuestionEntry = {
    question,
    context: typeof data?.context === "string" ? data.context : undefined,
    answer: typeof data?.answer === "string" ? data.answer : undefined,
    timestamp: new Date().toISOString(),
    resolved_by: typeof data?.resolved_by === "string" ? data.resolved_by : undefined,
    category: typeof data?.category === "string" &&
      ["active", "waiting", "tradeoff", "resolved"].includes(data.category)
      ? (data.category as OpenQuestionEntry["category"])
      : "active",
  }

  return writeOpenQuestions(projectRoot, [entry], writer)
}
