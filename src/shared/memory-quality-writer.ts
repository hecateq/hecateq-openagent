import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { log } from "./logger"
import { acquireLock, releaseLock } from "./memory-lock"
import { PROJECT_MEMORY_DIR } from "./memory-bootstrap"
import { writeFileAtomically } from "./write-file-atomically"

export interface QualityHistoryEntry {
  timestamp: string
  command: string
  result: "PASS" | "FAIL" | "SKIPPED" | "NOT_RUN"
  output_summary: string
  known_failures: string[]
  is_pre_existing: boolean
  verification_pending: string[]
}

export interface QualityGateReport {
  results: QualityGateResult[]
  allPassed: boolean
  passedCount: number
  failedCount: number
  skippedCount: number
}

export interface QualityGateResult {
  kind: string
  passed: boolean
  command: string
  exitCode: number
  stdout: string
  stderr: string
  message: string
  skipped: boolean
}

const QUALITY_HISTORY_FILENAME = "quality-history.md"
const LOCK_SESSION = "memory-quality-writer"
const LOCK_AGENT = "memory-quality-writer"
const SUMMARY_MAX_LENGTH = 200

function getHistoryPath(projectRoot: string): string {
  return join(projectRoot, PROJECT_MEMORY_DIR, QUALITY_HISTORY_FILENAME)
}

function buildEntry(report: QualityGateReport, knownFailures: string[]): QualityHistoryEntry {
  const result = report.allPassed ? "PASS" : report.failedCount > 0 ? "FAIL" : "SKIPPED"

  const summary = report.results
    .map((r) => {
      const status = r.skipped ? "SKIPPED" : r.passed ? "PASS" : "FAIL"
      return `${r.kind}: ${status} — ${r.message || r.kind}`
    })
    .join("\n")

  const pending = report.results
    .filter((r) => !r.passed && !r.skipped)
    .map((r) => r.command || r.kind)

  return {
    timestamp: new Date().toISOString(),
    command: report.results.map((r) => r.command || r.kind).join(", "),
    result,
    output_summary: summary.slice(0, SUMMARY_MAX_LENGTH),
    known_failures: knownFailures,
    is_pre_existing: knownFailures.length > 0,
    verification_pending: pending,
  }
}

function prependToHistory(existing: string, entry: QualityHistoryEntry): string {
  const today = new Date().toISOString().slice(0, 10)

  if (!existing.trim()) {
    return `# Quality History\n\nLast updated: ${today}\n\n${formatQualityEntry(entry)}`
  }

  const hasExistingEntries = existing.includes("## Quality Gate Run — ")

  if (!hasExistingEntries) {
    return `# Quality History\n\nLast updated: ${today}\n\n${formatQualityEntry(entry)}`
  }

  const headerMatch = existing.match(/^[\s\S]*?(?=\n## Quality Gate Run — )/)
  const header = headerMatch ? headerMatch[0].trim() : "# Quality History"

  const entryMatch = existing.match(/\n(## Quality Gate Run — [\s\S]*)$/)
  const existingEntries = entryMatch ? entryMatch[1].trim() : ""

  const updatedHeader = header.replace(/^Last updated: .*/m, `Last updated: ${today}`)

  const parts = [updatedHeader, formatQualityEntry(entry).trimEnd()]
  if (existingEntries) parts.push(existingEntries)

  return parts.join("\n\n") + "\n"
}

export function writeQualityHistory(
  projectRoot: string,
  report: QualityGateReport,
  options?: { knownFailures?: string[] },
): void {
  const lock = acquireLock(projectRoot, QUALITY_HISTORY_FILENAME, LOCK_SESSION, LOCK_AGENT)
  if (!lock.acquired) {
    log("memory-quality-writer: acquire lock failed", { reason: lock.reason })
    return
  }

  try {
    const path = getHistoryPath(projectRoot)
    const existing = existsSync(path) ? readFileSync(path, "utf-8") : ""
    const entry = buildEntry(report, options?.knownFailures ?? [])
    const updated = prependToHistory(existing, entry)
    writeFileAtomically(path, updated)
  } catch (error) {
    log("memory-quality-writer: write failed", {
      error: error instanceof Error ? error.message : String(error),
    })
  } finally {
    releaseLock(projectRoot, QUALITY_HISTORY_FILENAME, LOCK_SESSION, LOCK_AGENT)
  }
}

export function readQualityHistory(projectRoot: string): QualityHistoryEntry[] {
  const path = getHistoryPath(projectRoot)
  if (!existsSync(path)) return []

  try {
    return parseQualityHistory(readFileSync(path, "utf-8"))
  } catch (error) {
    log("memory-quality-writer: read failed", {
      error: error instanceof Error ? error.message : String(error),
    })
    return []
  }
}

export function formatQualityEntry(entry: QualityHistoryEntry): string {
  const lines: string[] = [
    `## Quality Gate Run — ${entry.timestamp}`,
    "",
    `Result: ${entry.result}`,
    `Command: ${entry.command}`,
    "",
    "### Output Summary",
  ]

  if (entry.output_summary) {
    for (const line of entry.output_summary.split("\n")) {
      lines.push(`- ${line}`)
    }
  } else {
    lines.push("- None")
  }

  lines.push("")

  if (entry.known_failures.length > 0) {
    lines.push("### Known Failures")
    for (const f of entry.known_failures) {
      lines.push(`- ${f}`)
    }
    lines.push("")
  }

  if (entry.verification_pending.length > 0) {
    lines.push("### Verification Pending")
    for (const v of entry.verification_pending) {
      lines.push(`- ${v}`)
    }
    lines.push("")
  }

  return lines.join("\n") + "\n"
}

export function parseQualityHistory(content: string): QualityHistoryEntry[] {
  const entries: QualityHistoryEntry[] = []
  const rawEntries = ("\n" + content).split(/\n(?=## Quality Gate Run — )/).slice(1)

  for (const block of rawEntries) {
    const lines = block.split("\n")
    const firstLine = lines[0]
    const timestamp = firstLine.replace(/^## Quality Gate Run — /, "").trim()

    const entry: QualityHistoryEntry = {
      timestamp,
      command: "",
      result: "NOT_RUN",
      output_summary: "",
      known_failures: [],
      is_pre_existing: false,
      verification_pending: [],
    }

    let section: "none" | "summary" | "failures" | "pending" = "none"

    for (let i = 1; i < lines.length; i++) {
      const t = lines[i].trim()

      if (t.startsWith("Result:")) {
        const val = t.slice("Result:".length).trim()
        if (["PASS", "FAIL", "SKIPPED", "NOT_RUN"].includes(val)) {
          entry.result = val as QualityHistoryEntry["result"]
        }
      } else if (t.startsWith("Command:")) {
        entry.command = t.slice("Command:".length).trim()
      } else if (t === "### Output Summary") {
        section = "summary"
      } else if (t === "### Known Failures") {
        section = "failures"
      } else if (t === "### Verification Pending") {
        section = "pending"
      } else if (t.startsWith("- ")) {
        const val = t.slice(2).trim()
        if (val === "None") continue
        if (section === "summary") {
          entry.output_summary = entry.output_summary
            ? `${entry.output_summary}\n${val}`
            : val
        } else if (section === "failures") {
          entry.known_failures.push(val)
        } else if (section === "pending") {
          entry.verification_pending.push(val)
        }
      }
    }

    entries.push(entry)
  }

  return entries
}
