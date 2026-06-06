import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { PROJECT_MEMORY_DIR } from "./memory-bootstrap"
import { acquireLock, releaseLock } from "./memory-lock"
import { log } from "./logger"
import {
  canWriteMemoryFile,
  type WriterIdentity,
} from "./memory-writer-ownership"
import { writeFileAtomically } from "./write-file-atomically"
import { RISK_PROFILE_MAX_RESOLVED_RISKS } from "./memory-retention-policy"
import { refreshManifestAfterWrite } from "./memory-manifest-updater"

// ---------------------------------------------------------------------------
// Dedupe constants
// ---------------------------------------------------------------------------

/** Window in milliseconds for considering a risk a duplicate of a recent one. */
const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000 // 24 hours

/** Evidence-backed risk categories. Risk entries in other categories require strong evidence. */
const EVIDENCE_REQUIRED_CATEGORIES = new Set<string>([
  "sensitive_path",
  "security",
  "destructive_op",
  "migration_risk",
])

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RISK_PROFILE_FILENAME = "risk-profile.md" as const
const LOCK_AGENT = "memory-risk-writer"
const LOCK_SESSION = "internal"
const LOCK_TTL_SECONDS = 30

/**
 * Writer identity for the risk writer module.
 * This module writes risk-profile.md and is owned by risk_writer.
 * @see src/shared/memory-writer-ownership.ts
 */
export const RISK_WRITER_IDENTITY: WriterIdentity = "risk_writer"

const VALID_CATEGORIES = new Set<RiskEntry["category"]>([
  "sensitive_path",
  "destructive_op",
  "migration_risk",
  "security",
  "performance",
  "token_budget",
  "stale_memory",
  "other",
])

const VALID_SEVERITIES = new Set<RiskEntry["severity"]>([
  "low",
  "medium",
  "high",
  "critical",
])

const VALID_SOURCES = new Set<RiskEntry["source"]>([
  "agent",
  "handoff",
  "report",
  "doctor",
  "manual",
])

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RiskEntry {
  timestamp: string
  category:
    | "sensitive_path"
    | "destructive_op"
    | "migration_risk"
    | "security"
    | "performance"
    | "token_budget"
    | "stale_memory"
    | "other"
  description: string
  severity: "low" | "medium" | "high" | "critical"
  mitigation?: string
  rollback_plan?: string
  source: "agent" | "handoff" | "report" | "doctor" | "manual"
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function getRiskProfilePath(projectRoot: string): string {
  return join(projectRoot, PROJECT_MEMORY_DIR, RISK_PROFILE_FILENAME)
}

function ensureRiskProfileFile(projectRoot: string): string {
  const filePath = getRiskProfilePath(projectRoot)
  if (!existsSync(filePath)) {
    const initialContent = generateBaseTemplate()
    writeFileAtomically(filePath, initialContent)
  }
  return filePath
}

// ---------------------------------------------------------------------------
// Template generation
// ---------------------------------------------------------------------------

function generateBaseTemplate(): string {
  const today = new Date().toISOString().slice(0, 10)
  return `# Risk Profile

Last updated: ${today}

## Active Risks

## Sensitive Paths
- (none recorded)

## Mitigated Risks
- (none recorded)
`
}

// ---------------------------------------------------------------------------
// Date updater
// ---------------------------------------------------------------------------

function updateLastUpdatedDate(content: string): string {
  const today = new Date().toISOString().slice(0, 10)
  return content.replace(/^(Last\s+updated:\s*).*/m, `$1${today}`)
}

// ---------------------------------------------------------------------------
// Risk formatting and parsing
// ---------------------------------------------------------------------------

export function formatRisk(entry: RiskEntry): string {
  const lines: string[] = []
  lines.push(`### ${entry.timestamp} — [${entry.severity}] ${entry.category}`)
  lines.push(`- **Description**: ${entry.description}`)
  if (entry.mitigation) {
    lines.push(`- **Mitigation**: ${entry.mitigation}`)
  }
  if (entry.rollback_plan) {
    lines.push(`- **Rollback Plan**: ${entry.rollback_plan}`)
  }
  lines.push(`- **Source**: ${entry.source}`)
  return lines.join("\n")
}

function extractField(body: string, fieldName: string): string | undefined {
  const pattern = new RegExp(`^- \\*\\*${fieldName}\\*\\*:\\s*(.+)`, "m")
  const match = body.match(pattern)
  return match ? match[1].trim() : undefined
}

export function parseRisks(content: string): RiskEntry[] {
  const entries: RiskEntry[] = []

  // Find Active Risks section: capture everything from heading to next ## or end of string.
  // Using indexOf + slice avoids the JavaScript multiline-$ matching every line-end issue.
  const activeIdx = content.indexOf("## Active Risks")
  if (activeIdx === -1) return entries
  const afterHeading = content.indexOf("\n", activeIdx)
  if (afterHeading === -1) return entries
  const rest = content.slice(afterHeading + 1)
  const nextSection = rest.indexOf("\n## ")
  const activeSection = nextSection >= 0 ? rest.slice(0, nextSection) : rest
  const entryPattern = /^### (\S+) — \[(\w+)\] (\w+)\n(.*(?:\n(?!### |## ).*)*)/gm
  let match: RegExpExecArray | null

  while ((match = entryPattern.exec(activeSection)) !== null) {
    const timestamp = match[1]
    const severityStr = match[2]
    const categoryStr = match[3]
    const body = match[4]

    if (!isValidSeverity(severityStr) || !isValidCategory(categoryStr)) {
      continue
    }

    const description = extractField(body, "Description") ?? ""
    const mitigation = extractField(body, "Mitigation")
    const rollbackPlan = extractField(body, "Rollback Plan")
    const sourceStr = extractField(body, "Source") ?? "agent"

    entries.push({
      timestamp,
      severity: severityStr,
      category: categoryStr,
      description,
      mitigation,
      rollback_plan: rollbackPlan,
      source: isValidSource(sourceStr) ? sourceStr : "agent",
    })
  }

  return entries
}

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

function isValidCategory(value: string): value is RiskEntry["category"] {
  return VALID_CATEGORIES.has(value as RiskEntry["category"])
}

function isValidSeverity(value: string): value is RiskEntry["severity"] {
  return VALID_SEVERITIES.has(value as RiskEntry["severity"])
}

function isValidSource(value: string): value is RiskEntry["source"] {
  return VALID_SOURCES.has(value as RiskEntry["source"])
}

// ---------------------------------------------------------------------------
// Core API
// ---------------------------------------------------------------------------

export function writeRisk(
  projectRoot: string,
  entry: RiskEntry,
  writer?: WriterIdentity,
): void {
  // Phase 3A: Ownership guard — best-effort, skip+log on violation
  const effectiveWriter = writer ?? RISK_WRITER_IDENTITY
  const ownershipCheck = canWriteMemoryFile(effectiveWriter, RISK_PROFILE_FILENAME)
  if (!ownershipCheck.authorized) {
    log("memory-risk-writer: Ownership violation — write skipped", {
      writer: effectiveWriter,
      file: RISK_PROFILE_FILENAME,
      reason: ownershipCheck.reason,
    })
    return
  }

  const lockName = RISK_PROFILE_FILENAME
  const lockResult = acquireLock(projectRoot, lockName, LOCK_SESSION, LOCK_AGENT, LOCK_TTL_SECONDS)
  const hadLock = lockResult.acquired

  if (!hadLock) {
    log("memory-risk-writer: Could not acquire lock, proceeding without lock", {
      reason: lockResult.reason,
    })
  }

  try {
    const filePath = ensureRiskProfileFile(projectRoot)
    const existingContent = readFileSync(filePath, "utf-8")
    const formattedEntry = formatRisk(entry)

    const activeHeader = "## Active Risks"
    const headerIndex = existingContent.indexOf(activeHeader)

    if (headerIndex === -1) {
      const updatedContent = updateLastUpdatedDate(existingContent)
      const newContent = updatedContent.trimEnd() + `\n\n${activeHeader}\n\n${formattedEntry}\n`
      writeFileAtomically(filePath, newContent)
      return
    }

    const afterHeaderLine = existingContent.indexOf("\n", headerIndex) + 1
    const contentAfterHeader = existingContent.slice(afterHeaderLine)
    const nextSectionMatch = contentAfterHeader.match(/\n(?=## )/)
    let insertPos: number

    if (nextSectionMatch && nextSectionMatch.index !== undefined) {
      insertPos = afterHeaderLine + nextSectionMatch.index
    } else {
      insertPos = existingContent.length
    }

    const beforeSection = existingContent.slice(0, insertPos)
    const afterSection = existingContent.slice(insertPos)
    const datedBefore = updateLastUpdatedDate(beforeSection)

    const newContent =
      datedBefore.trimEnd() + "\n\n" + formattedEntry + "\n" + afterSection
    writeFileAtomically(filePath, newContent)

    try {
      compactResolvedRisks(projectRoot)
    } catch {
      // best-effort
    }
  } catch (error) {
    log("memory-risk-writer: Failed to write risk entry", {
      error: error instanceof Error ? error.message : String(error),
    })
  } finally {
    if (hadLock) {
      releaseLock(projectRoot, lockName, LOCK_SESSION, LOCK_AGENT)
    }
  }
}

export function readRisks(projectRoot: string): RiskEntry[] {
  const filePath = getRiskProfilePath(projectRoot)
  if (!existsSync(filePath)) return []

  try {
    const content = readFileSync(filePath, "utf-8")
    return parseRisks(content)
  } catch (error) {
    log("memory-risk-writer: Failed to read risks", {
      error: error instanceof Error ? error.message : String(error),
    })
    return []
  }
}

// ---------------------------------------------------------------------------
// Risk detection from changed files
// ---------------------------------------------------------------------------

interface RiskDetectionRule {
  pattern: RegExp
  category: RiskEntry["category"]
  severity: RiskEntry["severity"]
  buildDescription: (filePath: string) => string
}

const RISK_DETECTION_RULES: RiskDetectionRule[] = [
  {
    pattern: /(^|\/)\.env($|\b)/,
    category: "security",
    severity: "high",
    buildDescription: (f) => `Environment file modified: ${f}`,
  },
  {
    pattern: /\/secrets\//,
    category: "security",
    severity: "critical",
    buildDescription: (f) => `Secrets directory modified: ${f}`,
  },
  {
    pattern: /\/keys\//,
    category: "security",
    severity: "critical",
    buildDescription: (f) => `Keys directory modified: ${f}`,
  },
  {
    pattern: /migration/i,
    category: "migration_risk",
    severity: "medium",
    buildDescription: (f) => `Migration file changed: ${f}`,
  },
  {
    pattern: /\.sql$/i,
    category: "migration_risk",
    severity: "medium",
    buildDescription: (f) => `SQL file changed: ${f}`,
  },
  {
    pattern: /package\.json$/,
    category: "stale_memory",
    severity: "low",
    buildDescription: (f) => `Package manifest changed: ${f}`,
  },
  {
    pattern: /(^|\/)yarn\.lock$|(^|\/)package-lock\.json$/,
    category: "stale_memory",
    severity: "low",
    buildDescription: (f) => `Lock file changed: ${f}`,
  },
  {
    pattern: /docker-compose|Dockerfile/i,
    category: "performance",
    severity: "low",
    buildDescription: (f) => `Docker configuration changed: ${f}`,
  },
  {
    pattern: /\.tf$/i,
    category: "destructive_op",
    severity: "high",
    buildDescription: (f) => `Terraform file modified: ${f}`,
  },
  {
    pattern: /k8s|kubernetes/i,
    category: "destructive_op",
    severity: "high",
    buildDescription: (f) => `Kubernetes config changed: ${f}`,
  },
  {
    pattern: /database|schema/i,
    category: "migration_risk",
    severity: "medium",
    buildDescription: (f) => `Database schema file changed: ${f}`,
  },
  {
    pattern: /(^|\/)\.npmrc|(^|\/)\.yarnrc/,
    category: "sensitive_path",
    severity: "medium",
    buildDescription: (f) => `Package manager config modified: ${f}`,
  },
  {
    pattern: /(^|\/).gitconfig|(^|\/).git-credentials/,
    category: "sensitive_path",
    severity: "critical",
    buildDescription: (f) => `Git credentials file modified: ${f}`,
  },
  {
    pattern: /(^|\/)tsconfig|(^|\/).eslintrc/,
    category: "other",
    severity: "low",
    buildDescription: (f) => `Project config file changed: ${f}`,
  },
]

// ---------------------------------------------------------------------------
// Evidence-backed risk filter and deduplication
// ---------------------------------------------------------------------------

/**
 * Check whether a risk entry has sufficient evidence to be recorded.
 *
 * Only evidence-backed risks are written:
 * - failing test (actual observed command output)
 * - disabled critical hook (config evidence)
 * - dirty repo (git status evidence)
 * - missing config (file system evidence)
 * - stale agent index (file system evidence)
 * - high-impact changed files (change impact evidence)
 * - unresolved open question (documented question)
 * - tool/write failure (runtime error evidence)
 *
 * Speculative risks without observed evidence are rejected.
 */
export function hasSufficientEvidence(entry: RiskEntry): boolean {
  const desc = entry.description.toLowerCase()

  // Evidence-backed descriptions must reference an observable fact
  const evidencePatterns = [
    /\bfailing test\b/,
    /\btest fail(s|ure|ed)\b/,
    /\bdisabled\b.*\b(hook|safety)\b/,
    /\bdirty repo\b/,
    /\b(stale|missing)\b.*\b(config|manifest|index|file)\b/,
    /\b(high|critical)[-\s]impact\b/,
    /\bunresolved\b.*\bquestion\b/,
    /\bwrite fail(s|ure|ed)\b/,
    /\btool fail(s|ure|ed)\b/,
    /\bruntime error\b/,
    /\b(rollback|revert|recovery)\b/,
    /\b(schema|migration)\b.*\b(changed|modified)\b/i,
    /\b.env\b/,
    /\bcredential\b/,
    /\bsecret\b/,
    /\bpermission\b/,
    /\.env\b/,
    /database\s+schema/i,
    /schema\s+file/i,
    /sql\s+file/i,
    /lock\s+file/i,
    /package\s+manifest/i,
    /\/secrets\//,
    /\/keys\//,
    /migration/i,
    /\.sql$/i,
    /docker[- ]?compose|dockerfile/i,
    /\.tf$/i,
  ]

  for (const pattern of evidencePatterns) {
    if (pattern.test(desc)) return true
  }

  // For "other" category with low/medium severity, be permissive
  if (entry.category === "other" && (entry.severity === "low" || entry.severity === "medium")) {
    return desc.length >= 15
  }

  // Everything else requires explicit evidence
  return false
}

/**
 * Extract the affected target (file path, component, or resource) from a risk description.
 * Returns null if no target can be inferred.
 *
 * Examples:
 *   "Database schema file changed: src/config/schema/hecateq.ts" → "src/config/schema/hecateq.ts"
 *   "High-risk operation detected" → null
 *   "Environment file modified: .env" → ".env"
 */
export function extractAffectedTarget(description: string): string | null {
  // Look for a file path after common prefixes like "changed:", "modified:", "file:"
  const filePatterns = [
    /(?:changed|modified|file):\s*(\S+)/i,
    /modified:\s*(\S+)/i,
    /file\s+changed:\s*(\S+)/i,
    /\b(?:\.env|package\.json|bun\.lock)\b/,
  ]

  for (const pattern of filePatterns) {
    const match = description.match(pattern)
    if (match && match[1]) {
      return match[1].replace(/[`'"]/g, "").trim()
    }
  }

  // Check for specific known patterns
  const knownTargets = [
    ".env", "package.json", "bun.lock", "tsconfig.json",
    "docker-compose", "Dockerfile",
  ]
  for (const target of knownTargets) {
    if (description.toLowerCase().includes(target)) return target
  }

  return null
}

/**
 * Check whether this risk is a duplicate of an existing recent entry.
 * Considers same description and category within DEDUPE_WINDOW_MS as duplicate.
 * Also checks for same affected target + category for more aggressive dedupe.
 */
export function isDuplicateOfRecentRisk(
  entry: RiskEntry,
  existing: RiskEntry[],
): boolean {
  const entryTs = new Date(entry.timestamp).getTime()
  const normalizedDesc = entry.description.toLowerCase().trim()
  const entryTarget = extractAffectedTarget(entry.description)

  for (const existingEntry of existing) {
    const existingTs = new Date(existingEntry.timestamp).getTime()
    const ageMs = entryTs - existingTs

    // Only consider entries within the dedupe window
    if (ageMs < 0 || ageMs > DEDUPE_WINDOW_MS) continue

    const existingDesc = existingEntry.description.toLowerCase().trim()

    // Same description and category = duplicate
    if (normalizedDesc === existingDesc && entry.category === existingEntry.category) {
      return true
    }

    // Same affected target + same category = duplicate (collapse by target)
    if (entry.category === existingEntry.category && entryTarget) {
      const existingTarget = extractAffectedTarget(existingEntry.description)
      if (existingTarget && entryTarget === existingTarget) {
        return true
      }
    }

    // High overlap in description content = near-duplicate
    if (entry.category === existingEntry.category) {
      const words1 = new Set(normalizedDesc.split(/\s+/))
      const words2 = new Set(existingDesc.split(/\s+/))
      if (words1.size > 0 && words2.size > 0) {
        const overlap = [...words1].filter((w) => words2.has(w)).length
        const smaller = Math.min(words1.size, words2.size)
        if (smaller > 0 && overlap / smaller >= 0.7) {
          return true
        }
      }
    }
  }

  return false
}

/**
 * Compact and dedupe risk-profile.md to remove noisy duplicates and speculative entries.
 * Optionally filters evidence-backed only.
 */
export function compactAndDedupeRisks(
  projectRoot: string,
  options?: { evidenceOnly?: boolean },
): { kept: number; removed: number } {
  const filePath = getRiskProfilePath(projectRoot)
  if (!existsSync(filePath)) return { kept: 0, removed: 0 }

  try {
    const content = readFileSync(filePath, "utf-8")
    const entries = parseRisks(content)

    if (entries.length === 0) return { kept: 0, removed: 0 }

    // Filter: keep only evidence-backed if requested
    let filtered = entries
    if (options?.evidenceOnly !== false) {
      // Remove speculative entries without sufficient evidence
      filtered = filtered.filter(hasSufficientEvidence)
    }

    // Dedupe: collapse by target+category (no time window), keep latest timestamp
    // For entries without an affected target, fall back to text similarity within time window
    const latestByTarget = new Map<string, RiskEntry>() // key: "category:target"
    const noTargetEntries: RiskEntry[] = []

    for (const entry of filtered) {
      const target = extractAffectedTarget(entry.description)
      if (target) {
        const targetKey = `${entry.category}:${target.toLowerCase()}`
        const existing = latestByTarget.get(targetKey)
        if (!existing || entry.timestamp >= existing.timestamp) {
          latestByTarget.set(targetKey, entry)
        }
      } else {
        noTargetEntries.push(entry)
      }
    }

    // Merge: all entries with targets (latest per target) + entries without targets
    const merged = Array.from(latestByTarget.values())

    // Text-similarity dedupe for entries without targets (within time window)
    for (const entry of noTargetEntries) {
      if (!isDuplicateOfRecentRisk(entry, merged)) {
        merged.push(entry)
      }
    }

    const deduped = merged

    if (deduped.length === entries.length) {
      // No change needed
      return { kept: deduped.length, removed: 0 }
    }

    // Rebuild the file
    const today = new Date().toISOString().slice(0, 10)
    const sections: string[] = [
      `# Risk Profile\n\nLast updated: ${today}`,
    ]

    if (deduped.length > 0) {
      sections.push("")
      sections.push("## Active Risks")
      sections.push("")
      for (const entry of deduped) {
        sections.push(formatRisk(entry))
      }
    }

    sections.push("")
    sections.push("## Mitigated Risks")
    sections.push("")
    sections.push("- (none recorded)")
    sections.push("")

    const newContent = sections.join("\n")

    if (newContent === content) {
      return { kept: deduped.length, removed: 0 }
    }

    writeFileAtomically(filePath, newContent)
    refreshManifestAfterWrite(projectRoot, filePath)

    log("memory-risk-writer: Compacted and deduped risks", {
      original: entries.length,
      kept: deduped.length,
      removed: entries.length - deduped.length,
    })

    return { kept: deduped.length, removed: entries.length - deduped.length }
  } catch (error) {
    log("memory-risk-writer: compactAndDedupeRisks failed", {
      error: error instanceof Error ? error.message : String(error),
    })
    return { kept: 0, removed: 0 }
  }
}

export function updateRiskProfile(
  projectRoot: string,
  changedFiles: string[],
  riskLevel?: string,
): void {
  // Validate riskLevel if provided
  const severityOverride: RiskEntry["severity"] | undefined =
    riskLevel && ["low", "medium", "high", "critical"].includes(riskLevel)
      ? riskLevel as RiskEntry["severity"]
      : undefined

  const matched: string[] = []

  for (const filePath of changedFiles) {
    for (const rule of RISK_DETECTION_RULES) {
      if (rule.pattern.test(filePath)) {
        const timestamp = new Date().toISOString()
        const entry: RiskEntry = {
          timestamp,
          category: rule.category,
          description: rule.buildDescription(filePath),
          // Use riskLevel override if provided, otherwise use rule default
          severity: severityOverride ?? rule.severity,
          source: "agent",
        }
        writeRisk(projectRoot, entry)
        matched.push(filePath)
        break
      }
    }
  }

  // Post-write: dedupe and filter speculative risks
  // This runs best-effort to clean up any noise left by the auto-detection rules
  try {
    compactAndDedupeRisks(projectRoot, { evidenceOnly: true })
  } catch {
    // best-effort
  }

  if (matched.length > 0) {
    log("memory-risk-writer: Auto-detected risks from changed files", {
      matched,
      totalChanged: changedFiles.length,
      severityOverride: severityOverride ?? "rule-default",
    })
  }
}

// ---------------------------------------------------------------------------
// Constants for external use
// ---------------------------------------------------------------------------

export const RISK_WRITER_LOCK_AGENT = LOCK_AGENT
export const RISK_WRITER_LOCK_TTL_SECONDS = LOCK_TTL_SECONDS

export function compactResolvedRisks(
  projectRoot: string,
  maxResolved: number = RISK_PROFILE_MAX_RESOLVED_RISKS,
): boolean {
  try {
    const filePath = getRiskProfilePath(projectRoot)
    if (!existsSync(filePath)) return false

    const content = readFileSync(filePath, "utf-8")

    const resolvedMatch = content.match(
      /^## (?:Resolved Risks|Mitigated Risks)\n([\s\S]*?)(?=\n## |\n\z)/m,
    )
    if (!resolvedMatch) return false

    const resolvedBody = resolvedMatch[1]
    const resolvedEntries = resolvedBody
      .split(/\n(?=### )/)
      .filter((entry) => entry.trim().startsWith("### "))
      .filter((entry) => entry.trim() !== "(none recorded)")

    if (resolvedEntries.length <= maxResolved) {
      return false
    }

    const alreadyCompacted =
      content.includes("_Older resolved risks compacted:")
    if (alreadyCompacted) return false

    // Keep newest (last entries are newest — append style)
    const latest = resolvedEntries.slice(-maxResolved)
    const olderCount = resolvedEntries.length - maxResolved

    const newResolvedSection =
      "## Resolved Risks\n\n" +
      latest.join("\n") +
      `\n\n_Older resolved risks compacted: ${olderCount}._\n`

    const newContent = content.replace(
      /^## (?:Resolved Risks|Mitigated Risks)\n[\s\S]*?(?=\n## |\n\z)/m,
      newResolvedSection.trimEnd() + "\n",
    )

    if (content === newContent) return false

    writeFileAtomically(filePath, newContent)
    refreshManifestAfterWrite(projectRoot, filePath)

    log("memory-risk-writer: Compacted resolved risks", {
      projectRoot,
      original: resolvedEntries.length,
      retained: latest.length,
      compacted: olderCount,
    })

    return true
  } catch (error) {
    log("memory-risk-writer: compactResolvedRisks failed", {
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}
