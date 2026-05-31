import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { log } from "./logger"
import { PROJECT_MEMORY_DIR } from "./memory-bootstrap"
import { writeFileAtomically } from "./write-file-atomically"

export const CHANGE_IMPACT_SECTION_HEADER = "## Change Impact Map"

const FILE_MAP_FILENAME = "file-map.md"

export type ChangeConfidence = "high" | "medium" | "low"

export interface ChangeImpactEntry {
  path: string
  changeType: "modified" | "created" | "deleted" | "unknown"
  confidence: ChangeConfidence
  confidenceBasis: string
  sourceSessionId: string
  timestamp: string
}

function getFileMapPath(projectRoot: string): string {
  return join(projectRoot, PROJECT_MEMORY_DIR, FILE_MAP_FILENAME)
}

function detectConfidence(projectRoot: string, filePath: string): {
  confidence: ChangeConfidence
  basis: string
} {
  const dirName = join(projectRoot, filePath, "..")
  const fileName = filePath.split("/").pop() ?? ""

  const baseName = fileName.replace(/\.(ts|tsx|js|jsx)$/, "")

  const testCandidates = [
    join(dirName, `${baseName}.test.ts`),
    join(dirName, `${baseName}.test.tsx`),
    join(dirName, `__tests__`, `${baseName}.test.ts`),
    join(dirName, `__tests__`, `${baseName}.test.tsx`),
    join(dirName, `${baseName}.spec.ts`),
    join(dirName, `${baseName}.spec.tsx`),
  ]

  for (const candidate of testCandidates) {
    if (existsSync(candidate)) {
      const relPath = candidate.slice(projectRoot.length + 1)
      return { confidence: "high", basis: `test:${relPath}` }
    }
  }

  try {
    const dirPath = join(projectRoot, filePath, "..")
    const siblingTests = [
      join(dirPath, "index.test.ts"),
      join(dirPath, `${baseName}.test.ts`),
    ]
    for (const sibling of siblingTests) {
      if (existsSync(sibling)) {
        return { confidence: "medium", basis: `dir:${filePath.split("/").slice(0, -1).join("/")}` }
      }
    }

    if (filePath.includes("__tests__") || filePath.includes(".test.") || filePath.includes(".spec.")) {
      return { confidence: "medium", basis: "self:test-file" }
    }

    const featureDir = filePath.split("/").slice(0, 2).join("/")
    const featureTestDir = join(projectRoot, featureDir)
    if (existsSync(featureTestDir)) {
      const testSubDirs = [
        join(featureTestDir, "__tests__"),
        join(featureTestDir, "test"),
      ]
      for (const td of testSubDirs) {
        if (existsSync(td)) {
          return { confidence: "medium", basis: `feature:${featureDir}` }
        }
      }
    }
  } catch {
    // best-effort
  }

  return { confidence: "low", basis: "none" }
}

export function readChangeImpactEntries(projectRoot: string): ChangeImpactEntry[] {
  const filePath = getFileMapPath(projectRoot)
  if (!existsSync(filePath)) return []

  try {
    const content = readFileSync(filePath, "utf-8")
    const sectionStart = content.indexOf(CHANGE_IMPACT_SECTION_HEADER)
    if (sectionStart === -1) return []

    const sectionContent = content.slice(sectionStart + CHANGE_IMPACT_SECTION_HEADER.length)
    const nextSectionMatch = sectionContent.match(/\n(?=## )/)
    const sectionBody = nextSectionMatch
      ? sectionContent.slice(0, nextSectionMatch.index ?? sectionContent.length)
      : sectionContent

    const entries: ChangeImpactEntry[] = []
    // Parse markdown list items of the form:
    // - `path` — [confidence](basis) changeType — sessionId — timestamp
    const entryPattern = /^- `([^`]+)` — \[(\w+)\]\(([^)]+)\) (\w+) — (\S+) — (.+)$/gm
    let match: RegExpExecArray | null
    while ((match = entryPattern.exec(sectionBody)) !== null) {
      const [, path, confidence, basis, changeType, sessionId, timestamp] = match
      if (isValidConfidence(confidence) && isValidChangeType(changeType)) {
        entries.push({
          path,
          confidence: confidence as ChangeConfidence,
          confidenceBasis: basis,
          changeType: changeType as ChangeImpactEntry["changeType"],
          sourceSessionId: sessionId,
          timestamp,
        })
      }
    }

    return entries
  } catch (error) {
    log("memory-change-impact: Failed to read entries", {
      projectRoot,
      error: error instanceof Error ? error.message : String(error),
    })
    return []
  }
}

function isValidConfidence(v: string): v is ChangeConfidence {
  return v === "high" || v === "medium" || v === "low"
}

function isValidChangeType(v: string): v is ChangeImpactEntry["changeType"] {
  return v === "modified" || v === "created" || v === "deleted" || v === "unknown"
}

export function isDuplicateEntry(
  existing: ChangeImpactEntry[],
  candidate: ChangeImpactEntry,
): boolean {
  return existing.some(
    (e) => e.path === candidate.path && e.changeType === candidate.changeType,
  )
}

function formatChangeImpactEntry(entry: ChangeImpactEntry): string {
  return `- \`${entry.path}\` — [${entry.confidence}](${entry.confidenceBasis}) ${entry.changeType} — ${entry.sourceSessionId} — ${entry.timestamp}`
}

/**
 * Format the full Change Impact Map section including existing entries.
 */
export function formatChangeImpactSection(entries: ChangeImpactEntry[]): string {
  if (entries.length === 0) {
    return `${CHANGE_IMPACT_SECTION_HEADER}\n\n- (no entries yet)\n`
  }

  const lines = [CHANGE_IMPACT_SECTION_HEADER, ""]
  for (const entry of entries) {
    lines.push(formatChangeImpactEntry(entry))
  }
  lines.push("")
  return lines.join("\n")
}

/**
 * Append a change impact entry to file-map.md under the Change Impact Map section.
 *
 * - Creates the section if it does not exist yet.
 * - Preserves all existing user content before and after the section.
 * - Skips duplicate entries (same path + same changeType).
 * - Never throws; failures are logged.
 *
 * Returns true if the entry was appended, false if it was a duplicate or write failed.
 */
export function appendChangeImpactEntry(
  projectRoot: string,
  entry: ChangeImpactEntry,
): boolean {
  const filePath = getFileMapPath(projectRoot)

  try {
    const existing = readChangeImpactEntries(projectRoot)
    if (isDuplicateEntry(existing, entry)) return false

    existing.push(entry)
    const newSection = formatChangeImpactSection(existing)

    let content: string
    if (existsSync(filePath)) {
      content = readFileSync(filePath, "utf-8")
    } else {
      const today = new Date().toISOString().slice(0, 10)
      content = `# File Map\n\nLast updated: ${today}\n\n## Important Paths\n- TODO\n\n## Entry Points\n- TODO\n\n## Do Not Scan Blindly\n- TODO\n`
    }

    const sectionIndex = content.indexOf(CHANGE_IMPACT_SECTION_HEADER)

    if (sectionIndex === -1) {
      content = content.trimEnd() + "\n\n" + newSection
    } else {
      const before = content.slice(0, sectionIndex)
      const afterSectionStart = content.slice(sectionIndex + CHANGE_IMPACT_SECTION_HEADER.length)
      const nextSectionMatch = afterSectionStart.match(/\n(?=## )/)
      const after = nextSectionMatch
        ? afterSectionStart.slice(nextSectionMatch.index ?? afterSectionStart.length)
        : ""

      content = before.trimEnd() + "\n\n" + newSection + after
    }

    writeFileAtomically(filePath, content)
    return true
  } catch (error) {
    log("memory-change-impact: Failed to append entry", {
      projectRoot,
      filePath: entry.path,
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

export function appendChangeImpactEntries(
  projectRoot: string,
  changedFilePaths: string[],
  changeType: ChangeImpactEntry["changeType"],
  sessionId: string,
): { appended: number; skipped: number } {
  const result = { appended: 0, skipped: 0 }
  if (changedFilePaths.length === 0) return result

  const timestamp = new Date().toISOString()

  for (const filePath of changedFilePaths) {
    try {
      const { confidence, basis } = detectConfidence(projectRoot, filePath)
      const entry: ChangeImpactEntry = {
        path: filePath,
        changeType,
        confidence,
        confidenceBasis: basis,
        sourceSessionId: sessionId,
        timestamp,
      }
      const written = appendChangeImpactEntry(projectRoot, entry)
      if (written) {
        result.appended++
      } else {
        result.skipped++
      }
    } catch (error) {
      result.skipped++
      log("memory-change-impact: Skipped file due to error", {
        filePath,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  if (result.appended > 0 || result.skipped > 0) {
    log("memory-change-impact: Batch append complete", {
      appended: result.appended,
      skipped: result.skipped,
      total: changedFilePaths.length,
    })
  }

  return result
}
