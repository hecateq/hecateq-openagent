import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { PROJECT_MEMORY_DIR } from "./memory-bootstrap"
import { acquireLock, releaseLock } from "./memory-lock"
import { log } from "./logger"
import { writeFileAtomically } from "./write-file-atomically"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RISK_PROFILE_FILENAME = "risk-profile.md" as const
const LOCK_AGENT = "memory-risk-writer"
const LOCK_SESSION = "internal"
const LOCK_TTL_SECONDS = 30

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

  const activeMatch = content.match(/^## Active Risks\n([\s\S]*?)(?=\n## |\z)/m)
  if (!activeMatch) return entries

  const activeSection = activeMatch[1]
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

export function writeRisk(projectRoot: string, entry: RiskEntry): void {
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

export function updateRiskProfile(
  projectRoot: string,
  changedFiles: string[],
  riskLevel?: string,
): void {
  const matched: string[] = []

  for (const filePath of changedFiles) {
    for (const rule of RISK_DETECTION_RULES) {
      if (rule.pattern.test(filePath)) {
        const timestamp = new Date().toISOString()
        const entry: RiskEntry = {
          timestamp,
          category: rule.category,
          description: rule.buildDescription(filePath),
          severity: rule.severity,
          source: "agent",
        }
        writeRisk(projectRoot, entry)
        matched.push(filePath)
        break
      }
    }
  }

  if (riskLevel && (riskLevel === "high" || riskLevel === "critical")) {
    const riskEntry: RiskEntry = {
      timestamp: new Date().toISOString(),
      category: "destructive_op",
      description: `High-risk operation detected (risk level: ${riskLevel})`,
      severity: riskLevel as "high" | "critical",
      source: "report",
      mitigation: "Review all changes carefully before proceeding",
      rollback_plan: "Ensure full git backup before execution",
    }
    writeRisk(projectRoot, riskEntry)
  }

  if (matched.length > 0) {
    log("memory-risk-writer: Auto-detected risks from changed files", {
      matched,
      totalChanged: changedFiles.length,
    })
  }
}

// ---------------------------------------------------------------------------
// Constants for external use
// ---------------------------------------------------------------------------

export const RISK_WRITER_LOCK_AGENT = LOCK_AGENT
export const RISK_WRITER_LOCK_TTL_SECONDS = LOCK_TTL_SECONDS
