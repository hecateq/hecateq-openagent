import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { log } from "./logger"
import { PROJECT_MEMORY_DIR } from "./memory-bootstrap"
import {
  canWriteMemoryFile,
  type WriterIdentity,
} from "./memory-writer-ownership"
import { writeFileAtomically } from "./write-file-atomically"
import { CHANGE_IMPACT_MAX_ENTRIES } from "./memory-retention-policy"
import { refreshManifestAfterWrite } from "./memory-manifest-updater"
import { acquireLock, releaseLock } from "./memory-lock"

export const CHANGE_IMPACT_SECTION_HEADER = "## Change Impact Map"

const FILE_MAP_LOCK_AGENT = "memory-file-map-writer"
const FILE_MAP_LOCK_SESSION = "internal"
const FILE_MAP_LOCK_TTL_SECONDS = 30

/**
 * Writer identity for the file-map / change-impact module.
 * This module writes file-map.md and is owned by file_map_writer.
 * @see src/shared/memory-writer-ownership.ts
 */
export const FILE_MAP_WRITER_IDENTITY: WriterIdentity = "file_map_writer"

const FILE_MAP_FILENAME = "file-map.md"

// ---------------------------------------------------------------------------
// Domain grouping — categorizes file paths into impact domains
// ---------------------------------------------------------------------------

/** Impact domain for a changed file. */
export type ImpactDomain =
  | "auth"
  | "billing"
  | "storage"
  | "routing"
  | "schema"
  | "migration"
  | "core_orchestration"
  | "memory_system"
  | "shared_core"
  | "shared_component"
  | "config"
  | "global_style"
  | "isolated_page"
  | "copy"
  | "test_only"
  | "doc"
  | "config_runtime"
  | "other"

/** Risk level for a domain. */
export type DomainRisk = "high" | "medium" | "low"

/** Domain metadata. */
export interface DomainInfo {
  domain: ImpactDomain
  label: string
  risk: DomainRisk
}

// ---------------------------------------------------------------------------
// Structured result types for Phase 2
// ---------------------------------------------------------------------------

export interface ChangeImpactWriteResult {
  /** Number of entries appended. */
  appended: number
  /** Number of entries skipped (duplicates or errors). */
  skipped: number
  /** Per-file reason, if any. */
  reason?: string
  /** Whether the write was blocked by lock contention. */
  lockBlocked?: boolean
  /** Whether the manifest was refreshed after write. */
  manifestUpdated?: boolean
  /** Reason if manifest refresh failed or was skipped. */
  manifestReason?: string | null
}

/**
 * Map a file path to its impact domain and risk level.
 * High-risk domains: auth, billing, storage, routing, schema, migration, shared core.
 * Medium-risk: shared component, config, global style.
 * Low-risk: isolated page, copy, test-only, doc.
 */
export function domainInfoForPath(filePath: string): DomainInfo {
  const p = filePath.replace(/\\/g, "/").toLowerCase()

  // High-risk domains
  if (/\bauth\b/.test(p) || /login|oauth|sso|jwt|session/.test(p))
    return { domain: "auth", label: "Auth / Identity", risk: "high" }
  if (/\bbilling\b/.test(p) || /payment|stripe|invoice|pricing/.test(p))
    return { domain: "billing", label: "Billing / Payments", risk: "high" }
  if (/\bstorage\b/.test(p) || /database|db|sqlite|postgres|redis/.test(p))
    return { domain: "storage", label: "Storage / Database", risk: "high" }
  if (/\brouting\b/.test(p) || /\broute\b/.test(p) || /\brouter\b/.test(p) || /middleware/.test(p))
    return { domain: "routing", label: "Routing / Middleware", risk: "high" }
  if (/\bschema\b/.test(p) || /\bvalidation\b/.test(p) || /\bzod\b/.test(p) || /\.schema\./.test(p))
    return { domain: "schema", label: "Schema / Validation", risk: "high" }
  if (/\bmigration\b/.test(p) || /\.sql$/.test(p))
    return { domain: "migration", label: "Migration", risk: "high" }

  // Test files — check before shared_core/memory_system to catch src/shared/*.test.ts
  if (/\.test\./.test(p) || /\.spec\./.test(p) || /__tests__/.test(p))
    return { domain: "test_only", label: "Test Only", risk: "low" }

  // Core orchestration — Hecateq-specific (check before shared_core)
  if (/hecateq-orchestration/.test(p) || /orchestrat/.test(p))
    return { domain: "core_orchestration", label: "Core Orchestration", risk: "high" }
  if (/memory-(bootstrap|manifest|update|writer|curator|quality|risk|change|lock|hydrat)/.test(p) || /memory-continuation/.test(p) || /memory-resume/.test(p) || /decision-log/.test(p) || /task-state-memory/.test(p))
    return { domain: "memory_system", label: "Memory System", risk: "high" }

  if (/src\/shared\//.test(p) || /src\/utils\//.test(p) || /src\/lib\//.test(p))
    return { domain: "shared_core", label: "Shared Core", risk: "high" }

  // Medium-risk domains
  if (/src\/components\//.test(p) || /src\/ui\//.test(p))
    return { domain: "shared_component", label: "Shared Component / UI", risk: "medium" }
  if (/\.(jsonc?|ya?ml|toml)$/.test(p) || /config/.test(p) || /\.env/.test(p))
    return { domain: "config", label: "Config / Runtime", risk: "medium" }
  if (/\.css$/.test(p) || /\.scss$/.test(p) || /tailwind/.test(p) || /theme/.test(p) || /style/.test(p))
    return { domain: "global_style", label: "Global Style / Theme", risk: "medium" }

  // Low-risk domains
  if (/\.md$/.test(p) || /docs\//.test(p) || /README/.test(p) || /CHANGELOG/.test(p))
    return { domain: "doc", label: "Documentation", risk: "low" }
  if (/\.(json|lock)$/.test(p) && !/\.schema\./.test(p))
    return { domain: "config_runtime", label: "Config / Runtime Files", risk: "low" }

  // Check for isolated page patterns
  if (/src\/pages\//.test(p) || /src\/app\//.test(p))
    return { domain: "isolated_page", label: "Isolated Page", risk: "low" }

  return { domain: "other", label: "Other", risk: "low" }
}

/**
 * Build a short evidence reason for the risk/confidence basis, instead of bare "none".
 */
export function riskReasonForEntry(
  filePath: string,
  confidenceBasis: string,
): string {
  if (confidenceBasis !== "none") return confidenceBasis

  const p = filePath.toLowerCase()

  if (p.endsWith(".test.ts") || p.endsWith(".spec.ts") || p.includes("__tests__"))
    return "test:test-file"
  if (p.endsWith(".md"))
    return "doc:doc-only"
  if (/\.(json|jsonc|ya?ml|toml)$/.test(p))
    return "cfg:config-file"
  if (/\.css$/.test(p) || /\.scss$/.test(p))
    return "style:style-only"
  if (/migration/.test(p) || p.endsWith(".sql"))
    return "mig:migration-file"

  // No evidence found — give a short reason instead of "none"
  const domain = domainInfoForPath(filePath)
  return `no-test:${domain.domain}`
}

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
    // Parse markdown list items — two formats:
    // New:   - `path` — [confidence](reason) changeType
    // Legacy:- `path` — [confidence](basis) changeType — sessionId — timestamp
    const entryPattern = /^- `([^`]+)` — \[(\w+)\]\(([^)]+)\) (\w+)(?: — (\S+) — (.+))?$/gm
    let match: RegExpExecArray | null
    while ((match = entryPattern.exec(sectionBody)) !== null) {
      const [, path, confidence, basis, changeType, sessionId, timestamp] = match
      if (isValidConfidence(confidence) && isValidChangeType(changeType)) {
        entries.push({
          path,
          confidence: confidence as ChangeConfidence,
          confidenceBasis: basis,
          changeType: changeType as ChangeImpactEntry["changeType"],
          sourceSessionId: sessionId ?? "unknown",
          timestamp: timestamp ?? new Date().toISOString(),
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
  const reason = riskReasonForEntry(entry.path, entry.confidenceBasis)
  return `- \`${entry.path}\` — [${entry.confidence}](${reason}) ${entry.changeType}`
}

/**
 * Format the full Change Impact Map section with semantic domain grouping.
 *
 * Groups entries by impact domain, assigns evidence-based risk level per group,
 * and includes a short reason instead of bare "none" for low-confidence entries.
 * Deduplicates repeated per-file rows by collapsing the same path+type within a group.
 */
export function formatChangeImpactSection(entries: ChangeImpactEntry[]): string {
  if (entries.length === 0) {
    return `${CHANGE_IMPACT_SECTION_HEADER}\n\n- (no changes tracked)\n`
  }

  // Group entries by domain
  const grouped = new Map<ImpactDomain, ChangeImpactEntry[]>()
  const seen = new Set<string>()

  for (const entry of entries) {
    // Deduplicate within the list: same path + same changeType = skip
    const key = `${entry.path}:${entry.changeType}`
    if (seen.has(key)) continue
    seen.add(key)

    const info = domainInfoForPath(entry.path)
    if (!grouped.has(info.domain)) grouped.set(info.domain, [])
    grouped.get(info.domain)!.push(entry)
  }

  const lines: string[] = [CHANGE_IMPACT_SECTION_HEADER, ""]

  // Sort groups: high risk first, then medium, then low, alpha within same risk
  const sortedGroups = Array.from(grouped.entries()).sort((a, b) => {
    const riskA = domainInfoForPath(a[1][0].path).risk
    const riskB = domainInfoForPath(b[1][0].path).risk
    const riskOrder: Record<DomainRisk, number> = { high: 0, medium: 1, low: 2 }
    const orderDiff = (riskOrder[riskA] ?? 2) - (riskOrder[riskB] ?? 2)
    if (orderDiff !== 0) return orderDiff
    return domainInfoForPath(a[1][0].path).label.localeCompare(
      domainInfoForPath(b[1][0].path).label,
    )
  })

  for (const [domain, domainEntries] of sortedGroups) {
    const info = domainInfoForPath(domainEntries[0].path)
    const riskLabel = info.risk === "high" ? "⚠️ High" : info.risk === "medium" ? "🔶 Medium" : "🔹 Low"
    lines.push(`### ${info.label} — ${riskLabel} Risk`)
    lines.push("")

    // Show one line per unique file path (deduplicate repeated entries)
    const seenPaths = new Set<string>()
    for (const entry of domainEntries) {
      if (seenPaths.has(entry.path)) continue
      seenPaths.add(entry.path)

      const reason = riskReasonForEntry(entry.path, entry.confidenceBasis)
      lines.push(`- \`${entry.path}\` — [${entry.confidence}](${reason}) ${entry.changeType}`)
    }
    lines.push("")
  }

  if (sortedGroups.length === 0) {
    lines.push("- (no changes tracked)")
    lines.push("")
  }

  return lines.join("\n")
}

/**
 * Append a change impact entry to file-map.md under the Change Impact Map section.
 *
 * - Creates the section if it does not exist yet.
 * - Preserves all existing user content before and after the section.
 * - Skips duplicate entries (same path + same changeType).
 * - Never throws; failures are logged.
 * - Returns structured result with lock/manifest status.
 */
export function appendChangeImpactEntryWithResult(
  projectRoot: string,
  entry: ChangeImpactEntry,
  writer?: WriterIdentity,
): ChangeImpactWriteResult {
  // Phase 3A: Ownership guard — best-effort, skip+log on violation
  const effectiveWriter = writer ?? FILE_MAP_WRITER_IDENTITY
  const ownershipCheck = canWriteMemoryFile(effectiveWriter, FILE_MAP_FILENAME)
  if (!ownershipCheck.authorized) {
    log("memory-change-impact: Ownership violation — write skipped", {
      writer: effectiveWriter,
      file: FILE_MAP_FILENAME,
      reason: ownershipCheck.reason,
    })
    return {
      appended: 0,
      skipped: 1,
      reason: `Ownership violation: ${ownershipCheck.reason}`,
      lockBlocked: false,
      manifestUpdated: false,
      manifestReason: ownershipCheck.reason,
    }
  }

  // Acquire lock before write
  const lockResult = acquireLock(projectRoot, FILE_MAP_FILENAME, FILE_MAP_LOCK_SESSION, FILE_MAP_LOCK_AGENT, FILE_MAP_LOCK_TTL_SECONDS)
  if (!lockResult.acquired) {
    log("memory-change-impact: Lock timeout — write skipped", {
      reason: lockResult.reason,
    })
    return {
      appended: 0,
      skipped: 1,
      reason: `Lock timeout: ${lockResult.reason || "could not acquire lock"}`,
      lockBlocked: true,
      manifestUpdated: false,
      manifestReason: lockResult.reason || "lock timeout",
    }
  }

  const filePath = getFileMapPath(projectRoot)

  try {
    const existing = readChangeImpactEntries(projectRoot)
    if (isDuplicateEntry(existing, entry)) {
      return {
        appended: 0,
        skipped: 1,
        reason: "duplicate entry (same path + changeType)",
        lockBlocked: false,
        manifestUpdated: false,
        manifestReason: null,
      }
    }

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

    // Refresh manifest after successful write
    let manifestUpdated = false
    let manifestReason: string | null = null
    try {
      const manifestResult = refreshManifestAfterWrite(projectRoot, filePath)
      manifestUpdated = manifestResult.updated
      if (!manifestUpdated) {
        manifestReason = manifestResult.reason || "unknown"
      }
    } catch {
      manifestReason = "manifest refresh threw"
    }

    try {
      enforceChangeImpactRetention(projectRoot)
    } catch {
      // best-effort
    }

    return {
      appended: 1,
      skipped: 0,
      reason: "appended",
      lockBlocked: false,
      manifestUpdated,
      manifestReason,
    }
  } catch (error) {
    log("memory-change-impact: Failed to append entry", {
      projectRoot,
      filePath: entry.path,
      error: error instanceof Error ? error.message : String(error),
    })
    return {
      appended: 0,
      skipped: 1,
      reason: error instanceof Error ? error.message : String(error),
      lockBlocked: false,
      manifestUpdated: false,
      manifestReason: error instanceof Error ? error.message : String(error),
    }
  } finally {
    releaseLock(projectRoot, FILE_MAP_FILENAME, FILE_MAP_LOCK_SESSION, FILE_MAP_LOCK_AGENT)
  }
}

/**
 * Append a change impact entry to file-map.md.
 *
 * Legacy wrapper — returns boolean for backward compatibility.
 * New callers should use appendChangeImpactEntryWithResult.
 *
 * @deprecated Use appendChangeImpactEntryWithResult for structured results.
 */
export function appendChangeImpactEntry(
  projectRoot: string,
  entry: ChangeImpactEntry,
  writer?: WriterIdentity,
): boolean {
  const result = appendChangeImpactEntryWithResult(projectRoot, entry, writer)
  return result.appended > 0
}

export function appendChangeImpactEntries(
  projectRoot: string,
  changedFilePaths: string[],
  changeType: ChangeImpactEntry["changeType"],
  sessionId: string,
): ChangeImpactWriteResult {
  const result: ChangeImpactWriteResult = {
    appended: 0,
    skipped: 0,
    lockBlocked: false,
    manifestUpdated: false,
    manifestReason: null,
  }
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
      const writeResult = appendChangeImpactEntryWithResult(projectRoot, entry)
      if (writeResult.appended > 0) {
        result.appended++
        // Track manifest status from last successful write
        result.manifestUpdated = writeResult.manifestUpdated
        result.manifestReason = writeResult.manifestReason
      } else {
        result.skipped++
        if (writeResult.lockBlocked) {
          result.lockBlocked = true
          result.reason = writeResult.reason
        }
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

const GENERATED_PATH_PATTERNS_FOR_RETENTION = [
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

export interface ChangeImpactRetentionResult {
  compacted: boolean
  reason: string | null
  originalEntries: number
  keptEntries: number
  removedGenerated: number
  compactedOlder: number
}

// ---------------------------------------------------------------------------
// Legacy migration — convert old-style raw rows to grouped semantic format
// ---------------------------------------------------------------------------

/**
 * Normalize a file path: remove absolute prefix, keep project-relative form.
 * If the path starts with the project root prefix, strip it.
 * If the path is absolute but not under project root, keep as-is (will be filtered).
 */
function normalizePath(rawPath: string, projectRoot?: string): string {
  let p = rawPath.trim()

  // If projectRoot is provided and path starts with it, strip the prefix
  if (projectRoot && p.startsWith(projectRoot)) {
    p = p.slice(projectRoot.length)
  } else if (projectRoot) {
    // Also try platform-independent comparison
    const normalizedRoot = projectRoot.replace(/\\/g, "/")
    const normalizedPath = p.replace(/\\/g, "/")
    if (normalizedPath.startsWith(normalizedRoot)) {
      p = normalizedPath.slice(normalizedRoot.length)
    }
  }

  // If path is still absolute and no projectRoot match, try heuristic extraction
  if (p.startsWith("/") || /^[A-Za-z]:[/\\]/.test(p)) {
    // Try to find project-specific content patterns as a fallback
    const patterns = [
      "/src/", "/.opencode/", "/docs/", "/packages/",
      "/assets/", "/bin/", "/scripts/", "/tests/",
      // Root-level common files
      "/ROADMAP.md", "/CHANGELOG.md", "/README.md",
      "/package.json", "/bun.lock", "/tsconfig.json",
      "/.gitignore",
    ]
    let bestMatch: { index: number; pattern: string } | null = null
    for (const pattern of patterns) {
      const idx = p.indexOf(pattern)
      if (idx >= 0 && (bestMatch === null || idx < bestMatch.index)) {
        bestMatch = { index: idx, pattern }
      }
    }
    if (bestMatch) {
      // Strip everything before the match
      p = p.slice(bestMatch.index + 1) // +1 to remove leading /
    } else {
      // Last resort: take the filename only
      const lastSlash = p.lastIndexOf("/")
      if (lastSlash >= 0) p = p.slice(lastSlash + 1)
    }
  }

  // Normalize backslashes
  p = p.replace(/\\/g, "/")

  // Remove leading ./ or .\
  if (p.startsWith("./")) p = p.slice(2)
  if (p.startsWith(".\\")) p = p.slice(2)

  return p
}

/**
 * Parse a legacy entry line (with or without sessionId/timestamp suffix).
 * Returns null if the line does not match any known format.
 */
function parseLegacyEntryLine(line: string, projectRoot?: string): ChangeImpactEntry | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith("- `")) return null

  // Try new format first: - `path` — [conf](reason) changeType
  const newFormat = /^- `([^`]+)` — \[(\w+)\]\(([^)]+)\) (\w+)$/
  let m = trimmed.match(newFormat)
  if (m) {
    const [, path, confidence, basis, changeType] = m
    if (isValidConfidence(confidence) && isValidChangeType(changeType)) {
      return {
        path: normalizePath(path, projectRoot),
        confidence: confidence as ChangeConfidence,
        confidenceBasis: basis,
        changeType: changeType as ChangeImpactEntry["changeType"],
        sourceSessionId: "legacy",
        timestamp: new Date().toISOString(),
      }
    }
    return null
  }

  // Try legacy format: - `path` — [conf](basis) changeType — sessionId — timestamp
  const legacyFormat = /^- `([^`]+)` — \[(\w+)\]\(([^)]+)\) (\w+) — (\S+) — (.+)$/
  m = trimmed.match(legacyFormat)
  if (m) {
    const [, path, confidence, basis, changeType, sessionId, timestamp] = m
    if (isValidConfidence(confidence) && isValidChangeType(changeType)) {
      return {
        path: normalizePath(path, projectRoot),
        confidence: confidence as ChangeConfidence,
        confidenceBasis: basis,
        changeType: changeType as ChangeImpactEntry["changeType"],
        sourceSessionId: sessionId,
        timestamp,
      }
    }
    return null
  }

  return null
}

/**
 * Migrate the Change Impact Map section in file-map.md from legacy raw rows
 * to the new semantic grouped format with evidence-based risk levels.
 *
 * Reads the existing file, extracts all entry lines from the Change Impact Map
 * section (both legacy and new format), deduplicates, and rewrites the section
 * using the grouped formatChangeImpactSection().
 *
 * Preserves all content outside the Change Impact Map section.
 *
 * Returns true if the file was updated, false if no changes needed.
 */
export function migrateChangeImpactSection(projectRoot: string): boolean {
  const filePath = getFileMapPath(projectRoot)
  if (!existsSync(filePath)) return false

  try {
    const content = readFileSync(filePath, "utf-8")
    const sectionIndex = content.indexOf(CHANGE_IMPACT_SECTION_HEADER)
    if (sectionIndex === -1) return false

    // Extract section body
    const beforeSection = content.slice(0, sectionIndex)
    const afterSectionStart = content.slice(sectionIndex + CHANGE_IMPACT_SECTION_HEADER.length)
    const nextSectionMatch = afterSectionStart.match(/\n(?=## )/)
    const sectionBody = nextSectionMatch
      ? afterSectionStart.slice(0, nextSectionMatch.index ?? afterSectionStart.length)
      : afterSectionStart
    const afterSection = nextSectionMatch
      ? afterSectionStart.slice(nextSectionMatch.index ?? afterSectionStart.length)
      : ""

    // Parse all entry lines from the section body
    const lines = sectionBody.split("\n")
    const rawEntries: ChangeImpactEntry[] = []
    for (const line of lines) {
      const entry = parseLegacyEntryLine(line, projectRoot)
      if (entry) rawEntries.push(entry)
    }

    if (rawEntries.length === 0) return false

    // Filter out command strings (e.g. "bun test src/foo.test.ts")
    const COMMAND_PATTERNS = [
      /^bun\s+(test|run|x|build)/,
      /^npm\s+(test|run|x|exec)/,
      /^npx\s+/,
      /^yarn\s+/,
      /^pnpm\s+/,
      /^node\s+/,
      /^tsx\s+/,
    ]
    const filteredRaw = rawEntries.filter((e) => {
      const p = e.path.toLowerCase()
      for (const pattern of COMMAND_PATTERNS) {
        if (pattern.test(p)) return false
      }
      return true
    })

    if (filteredRaw.length === 0) return false

    // Deduplicate: keep unique (path, changeType) — pick the first entry
    const seen = new Set<string>()
    const entries: ChangeImpactEntry[] = []
    for (const entry of filteredRaw) {
      const key = `${entry.path}:${entry.changeType}`
      if (seen.has(key)) continue
      seen.add(key)
      entries.push(entry)
    }

    // Filter out generated/absolute paths that survived normalization
    const GENERATED_PREFIXES = [
      "dist/", "build/", ".next/", "node_modules/",
      "coverage/", ".turbo/", ".cache/", "out/", ".git/",
      "__pycache__/", ".svelte-kit/",
    ]
    const filtered = entries.filter((e) => {
      const p = e.path.toLowerCase()
      for (const prefix of GENERATED_PREFIXES) {
        if (p.startsWith(prefix) || p.includes("/" + prefix)) return false
      }
      return true
    })

    if (filtered.length === 0) return false

    // Build new grouped section
    const newSection = formatChangeImpactSection(filtered)

    // Rebuild content
    const newContent = beforeSection.trimEnd() + "\n\n" + newSection + afterSection

    if (newContent === content) return false

    writeFileAtomically(filePath, newContent)
    refreshManifestAfterWrite(projectRoot, filePath)

    log("memory-change-impact: Migrated Change Impact Map to grouped format", {
      projectRoot,
      entryCount: entries.length,
    })

    return true
  } catch (error) {
    log("memory-change-impact: migrateChangeImpactSection failed", {
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

export function enforceChangeImpactRetention(
  projectRoot: string,
  maxEntries: number = CHANGE_IMPACT_MAX_ENTRIES,
): ChangeImpactRetentionResult {
  const result: ChangeImpactRetentionResult = {
    compacted: false,
    reason: null,
    originalEntries: 0,
    keptEntries: 0,
    removedGenerated: 0,
    compactedOlder: 0,
  }

  try {
    const filePath = getFileMapPath(projectRoot)
    if (!existsSync(filePath)) {
      result.reason = "file-map.md does not exist"
      return result
    }

    const entries = readChangeImpactEntries(projectRoot)
    result.originalEntries = entries.length

    if (entries.length === 0) {
      result.reason = "No change impact entries"
      return result
    }

    let filtered = entries.filter((entry) => {
      const isGenerated = GENERATED_PATH_PATTERNS_FOR_RETENTION.some((pattern) =>
        pattern.test(entry.path),
      )
      if (isGenerated) result.removedGenerated++
      return !isGenerated
    })

    let compactedOlder = 0
    if (filtered.length > maxEntries) {
      compactedOlder = filtered.length - maxEntries
      filtered = filtered.slice(-maxEntries)
    }

    if (result.removedGenerated === 0 && compactedOlder === 0) {
      result.reason = "Within retention limits"
      return result
    }

    result.keptEntries = filtered.length
    result.compactedOlder = compactedOlder

    const newSection = formatChangeImpactSection(filtered)

    const content = readFileSync(filePath, "utf-8")
    const sectionIndex = content.indexOf(CHANGE_IMPACT_SECTION_HEADER)

    let newContent: string
    if (sectionIndex === -1) {
      newContent = content.trimEnd() + "\n\n" + newSection
    } else {
      const before = content.slice(0, sectionIndex)
      const afterSectionStart =
        content.slice(sectionIndex + CHANGE_IMPACT_SECTION_HEADER.length)
      const nextSectionMatch = afterSectionStart.match(/\n(?=## )/)
      const after = nextSectionMatch
        ? afterSectionStart.slice(
            nextSectionMatch.index ?? afterSectionStart.length,
          )
        : ""

      newContent = before.trimEnd() + "\n\n" + newSection + after
    }

    writeFileAtomically(filePath, newContent)
    refreshManifestAfterWrite(projectRoot, filePath)

    result.compacted = true

    log("memory-change-impact: Enforced retention", {
      projectRoot,
      originalEntries: result.originalEntries,
      keptEntries: result.keptEntries,
      removedGenerated: result.removedGenerated,
      compactedOlder,
    })

    return result
  } catch (error) {
    result.reason =
      error instanceof Error ? error.message : String(error)
    log("memory-change-impact: enforceChangeImpactRetention failed", {
      error: result.reason,
    })
    return result
  }
}
