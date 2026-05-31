import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { acquireLock, releaseLock } from "./memory-lock"
import { log } from "./logger"
import { PROJECT_MEMORY_DIR } from "./memory-bootstrap"
import { writeFileAtomically } from "./write-file-atomically"

const LOCK_IDENTITY_SESSION = "memory-decision-writer"
const LOCK_IDENTITY_AGENT = "system"

export interface DecisionEntry {
  timestamp: string
  decision: string
  rationale: string
  impact_area: string
  rejected_alternatives?: string
  source: "agent" | "handoff" | "report" | "manual"
}

function getDecisionsPath(projectRoot: string): string {
  return join(projectRoot, PROJECT_MEMORY_DIR, "decisions.md")
}

function createDefaultTemplate(): string {
  const today = new Date().toISOString().slice(0, 10)
  return [
    "# Decisions",
    "",
    `Last updated: ${today}`,
    "",
    "## Accepted Decisions",
    "",
    "## Rejected Approaches",
    "- (none recorded)",
    "",
    "## Notes",
    "- Decisions are recorded automatically by agents and handoff system",
    "",
  ].join("\n")
}

export function formatDecision(entry: DecisionEntry): string {
  const lines: string[] = []
  lines.push(`### ${entry.timestamp} — [${entry.impact_area}]`)
  lines.push(`- **Decision**: ${entry.decision}`)
  lines.push(`- **Rationale**: ${entry.rationale}`)
  if (entry.rejected_alternatives) {
    lines.push(`- **Rejected Alternatives**: ${entry.rejected_alternatives}`)
  }
  lines.push(`- **Source**: ${entry.source}`)
  return lines.join("\n")
}

export function parseDecisions(content: string): DecisionEntry[] {
  const entries: DecisionEntry[] = []
  const entryHeaderRegex = /^###\s+(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)\s+—\s+\[([^\]]+)\]\s*$/gm
  let match: RegExpExecArray | null

  while ((match = entryHeaderRegex.exec(content)) !== null) {
    const timestamp = match[1]
    const impactArea = match[2]
    const blockStart = match.index
    const nextIndex = content.indexOf("\n### ", blockStart + 1)
    const block = content.slice(blockStart, nextIndex === -1 ? undefined : nextIndex)

    const decision = extractField(block, "Decision")
    const rationale = extractField(block, "Rationale")
    const rejectedAlternatives = extractField(block, "Rejected Alternatives")
    const source = extractField(block, "Source") as DecisionEntry["source"] | null

    if (!decision || !rationale || !source) continue
    if (!["agent", "handoff", "report", "manual"].includes(source)) continue

    entries.push({
      timestamp,
      decision,
      rationale,
      impact_area: impactArea,
      rejected_alternatives: rejectedAlternatives ?? undefined,
      source,
    })
  }

  return entries
}

function extractField(block: string, fieldName: string): string | null {
  const regex = new RegExp(`^- \\*\\*${escapeRegex(fieldName)}\\*\\*:\\s*(.+)$`, "m")
  const match = regex.exec(block)
  return match ? match[1].trim() : null
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export function readDecisions(projectRoot: string): DecisionEntry[] {
  const filePath = getDecisionsPath(projectRoot)
  if (!existsSync(filePath)) return []

  try {
    const content = readFileSync(filePath, "utf-8")
    return parseDecisions(content)
  } catch (error) {
    log("memory-decision-writer: Failed to read decisions.md", {
      projectRoot,
      error: error instanceof Error ? error.message : String(error),
    })
    return []
  }
}

export function writeDecision(
  projectRoot: string,
  entry: DecisionEntry,
  options?: { sessionId?: string; agent?: string },
): void {
  const sessionId = options?.sessionId ?? LOCK_IDENTITY_SESSION
  const agent = options?.agent ?? LOCK_IDENTITY_AGENT

  const lockResult = acquireLock(projectRoot, "decisions.md", sessionId, agent)
  if (!lockResult.acquired) {
    log("memory-decision-writer: Failed to acquire lock for decisions.md", {
      projectRoot,
      reason: lockResult.reason,
    })
    return
  }

  try {
    const filePath = getDecisionsPath(projectRoot)
    let content: string

    if (existsSync(filePath)) {
      content = readFileSync(filePath, "utf-8")
    } else {
      content = createDefaultTemplate()
    }

    const today = new Date().toISOString().slice(0, 10)
    content = content.replace(/^(Last updated:).*$/m, `$1 ${today}`)

    const acceptedSectionRegex = /^## Accepted Decisions\s*$/m
    const sectionMatch = acceptedSectionRegex.exec(content)

    const formatted = formatDecision(entry)

    if (sectionMatch) {
      const insertPos = sectionMatch.index + sectionMatch[0].length
      const afterHeading = content.slice(insertPos)
      const nextSectionMatch = afterHeading.match(/^## /m)
      const sectionEnd = nextSectionMatch ? nextSectionMatch.index : afterHeading.length

      const beforeSection = content.slice(0, insertPos)
      const existingBody = afterHeading.slice(0, sectionEnd)
      const afterSection = afterHeading.slice(sectionEnd)

      const spacer = existingBody.trim().length > 0 ? "\n\n" : "\n\n"
      content = beforeSection + existingBody + spacer + formatted + "\n" + afterSection
    } else {
      content = content.trimEnd() + `\n\n## Accepted Decisions\n\n${formatted}\n`
    }

    writeFileAtomically(filePath, content)
  } catch (error) {
    log("memory-decision-writer: Failed to write decision", {
      projectRoot,
      decision: entry.decision,
      error: error instanceof Error ? error.message : String(error),
    })
  } finally {
    releaseLock(projectRoot, "decisions.md", sessionId, agent)
  }
}

export function isDuplicateDecision(
  projectRoot: string,
  decision: string,
  threshold = 0.8,
): boolean {
  const entries = readDecisions(projectRoot)
  const normalized = decision.toLowerCase()

  return entries.some((entry) => {
    const similarity = computeTrigramSimilarity(
      entry.decision.toLowerCase(),
      normalized,
    )
    return similarity >= threshold
  })
}

function computeTrigramSimilarity(a: string, b: string): number {
  if (a === b) return 1
  if (a.length === 0 || b.length === 0) return 0

  const trigramsA = getTrigrams(a)
  const trigramsB = getTrigrams(b)

  if (trigramsA.size === 0 && trigramsB.size === 0) return 1
  if (trigramsA.size === 0 || trigramsB.size === 0) return 0

  let intersection = 0
  for (const trigram of trigramsA) {
    if (trigramsB.has(trigram)) intersection++
  }

  const union = trigramsA.size + trigramsB.size - intersection
  return union === 0 ? 0 : intersection / union
}

function getTrigrams(str: string): Set<string> {
  const trigrams = new Set<string>()
  const padded = `  ${str} `
  for (let i = 0; i < padded.length - 2; i++) {
    trigrams.add(padded.slice(i, i + 3))
  }
  return trigrams
}
