import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { basename, join, resolve } from "node:path"

import { OhMyOpenCodeConfigSchema } from "../../../config"
import { BuiltinAgentNameSchema, OverridableAgentNameSchema } from "../../../config/schema/agent-names"
import { HecateqConfigSchema, HecateqOrchestrationConfigSchema } from "../../../config/schema/hecateq"
import { AGENT_DISPLAY_NAMES } from "../../../shared/agent-display-names"
import { AGENT_NAME_MAP } from "../../../shared/migration/agent-names"
import { AGENT_MODEL_REQUIREMENTS, CONFIG_BASENAME, LEGACY_CONFIG_BASENAME, getClaudeConfigDir, getOpenCodeConfigDir, getOpenCodeConfigDirs, parseFrontmatter, parseJsonc } from "../../../shared"
import { DEFAULT_AGENT_ORDER } from "../../../shared/agent-ordering"
import { CHECK_IDS, CHECK_NAMES } from "../constants"
import type { CheckResult, DoctorIssue } from "../types"

import {
  PROJECT_CONTRACTS_DIR,
  PROJECT_MEMORY_DIR,
  PROJECT_MEMORY_FILES,
  PROJECT_MEMORY_MANIFEST,
  PROJECT_TASK_GRAPHS_DIR,
} from "../../../shared/memory-bootstrap"
import {
  TASK_STATE_MEMORY_FILENAME,
  TaskStateEntrySchema,
  type TaskStateEntry,
  readTaskState,
  detectStaleTasks,
  detectBlockedTasks,
  resolveLatestTaskState,
} from "../../../shared/task-state-memory"
import {
  DECISION_LOG_FILENAME,
  DecisionLogEntrySchema,
  type DecisionLogEntry,
  readDecisionLog,
  detectOrphanedSupersedes,
  detectConflictingDecisions,
} from "../../../shared/decision-log"
import {
  readManifest,
  validateManifest,
  MEMORY_MANIFEST_SCHEMA_VERSION,
  MEMORY_MANIFEST_FILENAME,
} from "../../../shared/memory-manifest"
import {
  discoverMemoryPaths,
  readMemoryPointer,
  type DiscoveredPaths,
} from "../../../shared/memory-path-discovery"
import {
  computeContinuationState,
  readContinuation,
} from "../../../shared/memory-continuation"
import {
  discoverGlobalAgentMarkdownSources,
  getHecateqAgentIndexOutputPath,
  readHecateqAgentIndexFile,
  toTildePath,
} from "../../../shared/hecateq-agent-indexer"

const HECATEQ_AGENT_NAME = "hecateq-orchestrator"
const SAFETY_HOOKS = [
  "stop-continuation-guard",
  "unstable-agent-babysitter",
  "notepad-write-guard",
  "plan-format-validator",
  "comment-checker",
] as const
const SUPPORTED_FRONTMATTER_FIELDS = new Set(["name", "description", "model", "tools", "mode"])
const SECRET_KEY_REGEX = /(discord_webhook_url|webhook|apiKey|api_key|token|secret)/i
const SECRET_VALUE_REGEX = /(Bearer\s+[A-Za-z0-9._-]+|sk-[A-Za-z0-9_-]+|ghp_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)/i
const AGENT_INDEX_ADVISORY_NOTE = "Agent Index is advisory-only. Missing, stale, or invalid index data may degrade suggestions and summaries, but exact runtime agent resolution still depends on live registration, discovery, config, disabled filtering, and resolver behavior."

type PluginConfigRecord = Record<string, unknown>

function getDisabledHookLocations(cwd: string, hookName: string): string[] {
  return getPluginConfigCandidatePaths(cwd)
    .map((configPath) => ({ configPath, parsed: readJsoncFile(configPath) }))
    .filter((entry): entry is { configPath: string; parsed: PluginConfigRecord } => entry.parsed !== null)
    .filter((entry) => {
      const hooks = Array.isArray(entry.parsed.disabled_hooks)
        ? entry.parsed.disabled_hooks.filter((value): value is string => typeof value === "string")
        : []
      return hooks.includes(hookName)
    })
    .map((entry) => entry.configPath)
}

export type DiscoveredAgentFile = {
  path: string
  source: "opencode-global" | "opencode-project" | "claude-global" | "claude-project"
  derivedName: string
  declaredName?: string
  effectiveName: string
  description?: string
  body: string
  frontmatterKeys: string[]
  parseError?: string
}

export type SecretFinding = {
  filePath: string
  keyPath: string
  maskedValue: string
}

export function collectAgentIndexIssues(): { issues: DoctorIssue[]; details: string[] } {
  const issues: DoctorIssue[] = []
  const details: string[] = []
  const outputPath = getHecateqAgentIndexOutputPath()
  const displayOutputPath = toTildePath(outputPath)
  const sources = discoverGlobalAgentMarkdownSources()
  const latestSourceMtimeMs = sources.reduce((latest, source) => Math.max(latest, source.modifiedAtMs), 0)

  if (!existsSync(outputPath)) {
    issues.push({
      title: "Hecateq Agent Index missing",
      description: `Generated index not found at ${displayOutputPath}.`,
      fix: "Run /hecateq-agent-index.",
      severity: "warning",
      affects: ["advisory agent suggestions", "doctor/reporting summaries"],
    })
    return { issues, details }
  }

  const parsedIndex = readHecateqAgentIndexFile(outputPath)
  if (!parsedIndex) {
    let invalidReason = "could not be parsed or validated"
    try {
      const raw = JSON.parse(readFileSync(outputPath, "utf-8")) as Record<string, unknown>
      if (typeof raw.version === "number" && raw.version !== 1) {
        invalidReason = `has unsupported version ${raw.version}`
      }
    } catch {
      invalidReason = "could not be parsed or validated"
    }

    issues.push({
      title: "Hecateq Agent Index invalid",
      description: `Generated index at ${displayOutputPath} ${invalidReason}.`,
      fix: "Re-run /hecateq-agent-index to regenerate the file.",
      severity: "warning",
      affects: ["advisory agent suggestions", "doctor/reporting summaries"],
    })
    return { issues, details }
  }

  const outputStats = statSync(outputPath)
  if (latestSourceMtimeMs > 0 && outputStats.mtimeMs < latestSourceMtimeMs) {
    issues.push({
      title: "Hecateq Agent Index stale",
      description: `Generated index at ${displayOutputPath} is older than one or more global custom agent markdown files.`,
      fix: "Re-run /hecateq-agent-index.",
      severity: "warning",
      affects: ["advisory agent suggestions", "new or modified custom agents may not be reflected in summaries"],
    })
  }

  if (parsedIndex.summary.agents_indexed !== sources.length) {
    issues.push({
      title: "Hecateq Agent Index count mismatch",
      description: `Generated index reports ${parsedIndex.summary.agents_indexed} indexed agents, but global discovery found ${sources.length}.`,
      fix: "Re-run /hecateq-agent-index after agent changes.",
      severity: "warning",
      affects: ["advisory agent suggestions", "doctor/reporting summaries"],
    })
  }

  if (parsedIndex.summary.weak_metadata > 0) {
    issues.push({
      title: "Hecateq Agent Index weak metadata",
      description: `Weak agents: ${parsedIndex.summary.weak_metadata}. Some agent descriptions, routing signals, or extracted scope hints are too weak for confident indexing.`,
      fix: "Improve global custom agent descriptions or re-run /hecateq-agent-index after edits.",
      severity: "warning",
      affects: ["advisory agent suggestions", "doctor/reporting summaries"],
    })
  }

  if (parsedIndex.summary.duplicates > 0) {
    issues.push({
      title: "Hecateq Agent Index duplicate agents",
      description: `Duplicate effective names detected: ${parsedIndex.summary.duplicates}.`,
      fix: "Rename duplicate global custom agents or re-run /hecateq-agent-index after cleanup.",
      severity: "warning",
      affects: ["advisory agent suggestions", "doctor/reporting summaries"],
    })
  }

  if (parsedIndex.summary.unknown_primary_domain > 0) {
    issues.push({
      title: "Hecateq Agent Index unknown domains",
      description: `Agents with no clear domain detected: ${parsedIndex.summary.unknown_primary_domain}.`,
      fix: "Add domain-relevant terms to agent descriptions or filenames.",
      severity: "warning",
      affects: ["advisory routing summaries", "doctor/reporting summaries"],
    })
  }

  if (parsedIndex.summary.high_ambiguity > 0) {
    issues.push({
      title: "Hecateq Agent Index high routing ambiguity",
      description: `Agents with high routing ambiguity: ${parsedIndex.summary.high_ambiguity}.`,
      fix: "Narrow agent scope or add more specific domain terms to distinguish from competitors.",
      severity: "warning",
      affects: ["advisory routing summaries", "doctor/reporting summaries"],
    })
  }

  details.push(`Agent index path: ${displayOutputPath}`)
  details.push(AGENT_INDEX_ADVISORY_NOTE)
  details.push(`Global custom agents discovered: ${sources.length}`)
  details.push(`Indexed agents: ${parsedIndex.summary.agents_indexed}`)
  if (parsedIndex.summary.weak_metadata > 0) {
    details.push(`Weak metadata count: ${parsedIndex.summary.weak_metadata}`)
  }
  if (parsedIndex.summary.duplicates > 0) {
    details.push(`Duplicate effective names: ${parsedIndex.summary.duplicates}`)
  }
  if (parsedIndex.summary.unknown_primary_domain > 0) {
    details.push(`Unknown primary domains: ${parsedIndex.summary.unknown_primary_domain}`)
  }
  if (parsedIndex.summary.high_ambiguity > 0) {
    details.push(`High routing ambiguity: ${parsedIndex.summary.high_ambiguity}`)
  }
  const coverageEntries = Object.entries(parsedIndex.summary.domain_coverage)
    .filter(([, count]) => count > 0)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
  if (coverageEntries.length > 0) {
    details.push("Domain coverage:")
    for (const [domain, count] of coverageEntries) {
      details.push(`  ${domain}: ${count}`)
    }
  }

  const weakAgents = parsedIndex.agents
    .filter((agent) => agent.warnings.length > 0)
    .sort((left, right) => left.confidence - right.confidence || left.name.localeCompare(right.name))
    .slice(0, 10)
  if (weakAgents.length > 0) {
    details.push("Weak agents:")
    for (const agent of weakAgents) {
      details.push(`  ${agent.name}: ${agent.warnings.join(", ")}`)
    }
  }

  const typeDist = new Map<string, number>()
  for (const agent of parsedIndex.agents) {
    const at = agent.agent_type ?? "unknown"
    typeDist.set(at, (typeDist.get(at) ?? 0) + 1)
  }
  const sortedTypes = Array.from(typeDist.entries()).sort((a, b) => b[1] - a[1])
  if (sortedTypes.length > 0) {
    details.push("Agent type distribution:")
    for (const [type, count] of sortedTypes) {
      details.push(`  ${type}: ${count}`)
    }
  }

  return { issues, details }
}

function buildIssueStatus(issues: DoctorIssue[]): CheckResult["status"] {
  if (issues.some((issue) => issue.severity === "error")) return "fail"
  if (issues.some((issue) => issue.severity === "warning")) return "warn"
  return "pass"
}

function buildIssueMessage(status: CheckResult["status"], issues: DoctorIssue[]): string {
  if (status === "pass") return "Hecateq workflow checks passed"
  if (status === "fail") return `${issues.length} Hecateq workflow issue(s) detected`
  return `${issues.length} Hecateq workflow warning(s) detected`
}

function maskSecretValue(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length <= 4) return "<redacted>"
  if (trimmed.length <= 8) return `${trimmed.slice(0, 1)}***${trimmed.slice(-1)}`
  return `${trimmed.slice(0, 2)}***${trimmed.slice(-2)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function getPluginConfigCandidatePaths(cwd: string): string[] {
  const userConfigDir = getOpenCodeConfigDir({ binary: "opencode" })
  const projectOpencodeDir = join(cwd, ".opencode")

  return [
    join(userConfigDir, `${CONFIG_BASENAME}.json`),
    join(userConfigDir, `${CONFIG_BASENAME}.jsonc`),
    join(userConfigDir, `${LEGACY_CONFIG_BASENAME}.json`),
    join(userConfigDir, `${LEGACY_CONFIG_BASENAME}.jsonc`),
    join(projectOpencodeDir, `${CONFIG_BASENAME}.json`),
    join(projectOpencodeDir, `${CONFIG_BASENAME}.jsonc`),
    join(projectOpencodeDir, `${LEGACY_CONFIG_BASENAME}.json`),
    join(projectOpencodeDir, `${LEGACY_CONFIG_BASENAME}.jsonc`),
  ]
}

function readJsoncFile(filePath: string): PluginConfigRecord | null {
  try {
    if (!existsSync(filePath)) return null
    return parseJsonc<PluginConfigRecord>(readFileSync(filePath, "utf-8"))
  } catch {
    return null
  }
}

function getExistingProjectJsonFiles(cwd: string): string[] {
  const projectOpencodeDir = join(cwd, ".opencode")
  const files = [
    join(cwd, "opencode.json"),
    join(cwd, "opencode.jsonc"),
  ]

  if (existsSync(projectOpencodeDir)) {
    for (const entry of readdirSync(projectOpencodeDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue
      if (!entry.name.endsWith(".json") && !entry.name.endsWith(".jsonc")) continue
      files.push(join(projectOpencodeDir, entry.name))
    }
  }

  return Array.from(new Set(files.filter((filePath) => existsSync(filePath))))
}

function getExistingSecretScanPaths(cwd: string): string[] {
  const userConfigDir = getOpenCodeConfigDir({ binary: "opencode" })
  const candidates = [
    join(userConfigDir, `${CONFIG_BASENAME}.json`),
    join(userConfigDir, `${CONFIG_BASENAME}.jsonc`),
    join(userConfigDir, `${LEGACY_CONFIG_BASENAME}.json`),
    join(userConfigDir, `${LEGACY_CONFIG_BASENAME}.jsonc`),
    ...getExistingProjectJsonFiles(cwd),
  ]

  return Array.from(new Set(candidates.filter((filePath) => existsSync(filePath))))
}

function walkForSecrets(value: unknown, filePath: string, keyPath: string[] = []): SecretFinding[] {
  const findings: SecretFinding[] = []

  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      findings.push(...walkForSecrets(item, filePath, [...keyPath, String(index)]))
    }
    return findings
  }

  if (isRecord(value)) {
    for (const [key, nested] of Object.entries(value)) {
      const nextPath = [...keyPath, key]
      if (typeof nested === "string" && (SECRET_KEY_REGEX.test(key) || SECRET_VALUE_REGEX.test(nested))) {
        findings.push({
          filePath,
          keyPath: nextPath.join("."),
          maskedValue: maskSecretValue(nested),
        })
      }
      findings.push(...walkForSecrets(nested, filePath, nextPath))
    }
  }

  return findings
}

export function collectSecretFindings(cwd = process.cwd()): SecretFinding[] {
  const findings: SecretFinding[] = []
  for (const filePath of getExistingSecretScanPaths(cwd)) {
    const parsed = readJsoncFile(filePath)
    if (!parsed) continue
    findings.push(...walkForSecrets(parsed, filePath))
  }
  return findings
}

type AgentDirectory = {
  source: DiscoveredAgentFile["source"]
  path: string
}

function getAgentDirectories(cwd = process.cwd()): AgentDirectory[] {
  const opencodeConfigDirs = getOpenCodeConfigDirs({ binary: "opencode" })
  return [
    ...opencodeConfigDirs.map((configDir) => ({
      source: "opencode-global" as const,
      path: join(configDir, "agents"),
    })),
    { source: "opencode-project" as const, path: join(cwd, ".opencode", "agents") },
    { source: "claude-global" as const, path: join(getClaudeConfigDir(), "agents") },
    { source: "claude-project" as const, path: join(cwd, ".claude", "agents") },
  ]
}

export function discoverCustomAgentFiles(cwd = process.cwd()): DiscoveredAgentFile[] {
  const files: DiscoveredAgentFile[] = []

  for (const directory of getAgentDirectories(cwd)) {
    if (!existsSync(directory.path)) continue

    for (const entry of readdirSync(directory.path, { withFileTypes: true })) {
      if (!entry.isFile()) continue
      if (!entry.name.toLowerCase().endsWith(".md")) continue

      const filePath = join(directory.path, entry.name)
      const derivedName = entry.name.replace(/\.md$/i, "")

      try {
        const content = readFileSync(filePath, "utf-8")
        const { data, body } = parseFrontmatter<Record<string, unknown>>(content)
        const declaredName = typeof data.name === "string" && data.name.trim().length > 0
          ? data.name.trim()
          : undefined

        files.push({
          path: filePath,
          source: directory.source,
          derivedName,
          declaredName,
          effectiveName: declaredName ?? derivedName,
          description: typeof data.description === "string" ? data.description : undefined,
          body,
          frontmatterKeys: Object.keys(data),
        })
      } catch (error) {
        files.push({
          path: filePath,
          source: directory.source,
          derivedName,
          effectiveName: derivedName,
          body: "",
          frontmatterKeys: [],
          parseError: error instanceof Error ? error.message : "Failed to parse frontmatter",
        })
      }
    }
  }

  return files
}

export function collectHecateqRegistrationIssues(): DoctorIssue[] {
  const issues: DoctorIssue[] = []
  const builtinAgentNames = new Set(BuiltinAgentNameSchema.options)
  const overridableAgentNames = new Set(OverridableAgentNameSchema.options)
  const missingCore: string[] = []

  if (!builtinAgentNames.has(HECATEQ_AGENT_NAME)) missingCore.push("builtin agent schema")
  if (!overridableAgentNames.has(HECATEQ_AGENT_NAME)) missingCore.push("overridable agent schema")
  if (!(HECATEQ_AGENT_NAME in AGENT_MODEL_REQUIREMENTS)) missingCore.push("model requirements")

  if (missingCore.length > 0) {
    issues.push({
      title: "Hecateq Orchestrator registration incomplete",
      description: `Missing core registration in ${missingCore.join(", ")}.`,
      fix: "Register hecateq-orchestrator in the core agent schema and model requirements.",
      severity: "error",
      affects: ["Hecateq agent creation", "doctor diagnostics", "custom-agent-first workflow"],
    })
  }

  const missingSupporting: string[] = []
  if (!(HECATEQ_AGENT_NAME in AGENT_DISPLAY_NAMES)) missingSupporting.push("display name")
  if (!DEFAULT_AGENT_ORDER.includes(HECATEQ_AGENT_NAME)) missingSupporting.push("default agent ordering")
  if (!(HECATEQ_AGENT_NAME in AGENT_NAME_MAP)) missingSupporting.push("migration alias map")

  if (missingSupporting.length > 0) {
    issues.push({
      title: "Hecateq Orchestrator registration incomplete",
      description: `Missing supporting registration in ${missingSupporting.join(", ")}.`,
      fix: "Add display name, ordering, and migration aliases for hecateq-orchestrator.",
      severity: "warning",
      affects: ["agent display", "agent ordering", "migration alias resolution"],
    })
  }

  return issues
}

export function collectProjectRootMemoryIssues(cwd = process.cwd()): DoctorIssue[] {
  const issues: DoctorIssue[] = []
  const memoryDir = join(cwd, PROJECT_MEMORY_DIR)

  if (!existsSync(memoryDir)) {
    issues.push({
      title: "Project-root memory not initialized",
      description: "Hecateq project-root memory directory is missing.",
      fix: "Create .opencode/state/memory/ with active-context.md, progress.md, tasks.md, file-map.md, decisions.md.",
      severity: "warning",
      affects: ["Hecateq context reuse", "token efficiency", "project continuity"],
    })
    return issues
  }

  const missingFiles = PROJECT_MEMORY_FILES.filter((fileName) => !existsSync(join(memoryDir, fileName)))
  if (missingFiles.length > 0) {
    issues.push({
      title: "Project-root memory incomplete",
      description: `Missing: ${missingFiles.join(", ")}`,
      fix: "Add the missing project-root memory files under .opencode/state/memory/.",
      severity: "warning",
      affects: ["Hecateq context reuse", "token efficiency", "project continuity"],
    })
  }

  return issues
}

export function collectProjectArtifactIssues(cwd = process.cwd()): DoctorIssue[] {
  const issues: DoctorIssue[] = []
  const missingDirs = [PROJECT_CONTRACTS_DIR, PROJECT_TASK_GRAPHS_DIR].filter(
    (dirPath) => !existsSync(join(cwd, dirPath)),
  )

  if (missingDirs.length === 0) return issues

  const disabledLocations = getDisabledHookLocations(cwd, "hecateq-memory-bootstrap")
  const disabledNote = disabledLocations.length > 0
    ? ` Bootstrap hook \`hecateq-memory-bootstrap\` is disabled in: ${disabledLocations.join(", ")}.`
    : ""

  issues.push({
    title: "Hecateq artifact directories not initialized",
    description: `Missing: ${missingDirs.join(", ")}.${disabledNote}`,
    fix: "Start a session with hecateq-memory-bootstrap enabled, or create the directories manually.",
    severity: "warning",
    affects: [
      "shared contract artifacts",
      "task graph artifacts",
      "dependency-aware orchestration",
    ],
  })

  return issues
}

/**
 * Result of assessing a single memory file's content quality.
 */
export type MemoryFileQuality = {
  fileName: string
  filePath: string
  size: number
  isEmpty: boolean
  hasStaleLastUpdated: boolean
  isPlaceholderOnly: boolean
}

/**
 * Heuristic pattern for detecting "Last updated: TODO" — the strongest signal
 * that a memory file was never initialized with actual project context.
 */
const LAST_UPDATED_TODO_PATTERN = /Last\s+updated:\s*TODO/i

/**
 * Assess the content quality of a single project-root memory file.
 *
 * Three quality dimensions:
 * 1. **Empty** — file is 0 bytes or whitespace-only → no useful context at all
 * 2. **Stale "Last updated: TODO"** — the `Last updated` line still reads TODO →
 *    file was bootstrapped but never populated
 * 3. **Placeholder-only** — the file contains only headings and `- TODO` list items
 *    without any meaningful content
 *
 * These are checked in order of severity. A file that is empty has no content to
 * inspect further. A file with "Last updated: TODO" may also be placeholder-only,
 * but the stale-date signal is more actionable so it is reported as stale.
 */
export function assessMemoryFileQuality(filePath: string): MemoryFileQuality {
  const fileName = basename(filePath)
  const stats = statSync(filePath)
  const size = stats.size
  const content = readFileSync(filePath, "utf-8")
  const isEmpty = content.trim().length === 0
  const hasStaleLastUpdated = LAST_UPDATED_TODO_PATTERN.test(content)

  // Placeholder-only: every non-empty line is either a heading or a `- TODO` item.
  // The "Last updated:" line is structural boilerplate regardless of date value.
  const NON_TODO_LINE_PATTERN = /Last\s+updated:/i
  const nonEmptyLines = content.split("\n").filter((line) => line.trim().length > 0)
  const isPlaceholderOnly =
    !isEmpty &&
    nonEmptyLines.length > 0 &&
    nonEmptyLines.every((line) => {
      const trimmed = line.trim()
      return (
        trimmed.startsWith("#") ||
        trimmed === "- TODO" ||
        trimmed.startsWith("- TODO ") ||
        LAST_UPDATED_TODO_PATTERN.test(trimmed) ||
        NON_TODO_LINE_PATTERN.test(trimmed)
      )
    })

  return { fileName, filePath, size, isEmpty, hasStaleLastUpdated, isPlaceholderOnly }
}

/**
 * Check project-root memory file content quality.
 *
 * Scans each existing MEMORY_FILES entry and reports issues when:
 * - A file is empty (0 bytes / whitespace-only)
 * - A file still has "Last updated: TODO" (stale template)
 * - A file only contains headings and `- TODO` items (placeholder-only)
 *
 * This complements `collectProjectRootMemoryIssues()` which only checks
 * file *presence*. This function checks file *content quality*.
 */
export function collectMemoryQualityIssues(cwd = process.cwd()): DoctorIssue[] {
  const issues: DoctorIssue[] = []
  const memoryDir = join(cwd, PROJECT_MEMORY_DIR)

  if (!existsSync(memoryDir)) {
    // Missing directory is covered by collectProjectRootMemoryIssues — not our scope
    return issues
  }

  for (const fileName of PROJECT_MEMORY_FILES) {
    const filePath = join(memoryDir, fileName)
    if (!existsSync(filePath)) {
      // Missing individual file is covered by collectProjectRootMemoryIssues
      continue
    }

    const quality = assessMemoryFileQuality(filePath)

    if (quality.isEmpty) {
      issues.push({
        title: "Project memory file is empty",
        description: `File: ${fileName} is empty (0 bytes or whitespace-only). Hecateq will not gain useful context from this file.`,
        fix: "Populate the file with actual project context, or delete it and re-run hecateq-memory-bootstrap to regenerate the template.",
        severity: "warning",
        affects: ["Hecateq context injection quality", "project continuity"],
      })
      continue
    }

    if (quality.hasStaleLastUpdated) {
      issues.push({
        title: "Project memory file has stale template content",
        description: `File: ${fileName} still has "Last updated: TODO" — it was bootstrapped but never populated with actual project context.`,
        fix: "Update the file with real project context, especially the 'Last updated' date and section content.",
        severity: "warning",
        affects: ["Hecateq context injection quality"],
      })
      continue
    }

    if (quality.isPlaceholderOnly) {
      issues.push({
        title: "Project memory file contains only placeholders",
        description: `File: ${fileName} only contains headings and "- TODO" list items without meaningful content.`,
        fix: `Replace placeholder TODO items in ${fileName} with actual project information relevant to this memory file.`,
        severity: "warning",
        affects: ["Hecateq context injection quality"],
      })
    }
  }

  return issues
}

export function collectMemoryManifestIssues(cwd = process.cwd()): DoctorIssue[] {
  const issues: DoctorIssue[] = []
  const memoryDir = join(cwd, PROJECT_MEMORY_DIR)
  const manifestPath = join(memoryDir, MEMORY_MANIFEST_FILENAME)

  if (!existsSync(memoryDir)) {
    return issues
  }

  if (!existsSync(manifestPath)) {
    issues.push({
      title: "Memory manifest missing",
      description: "memory.json not found alongside memory files. Token efficiency hints and cross-IDE interop unavailable.",
      fix: "Start a session with hecateq-memory-bootstrap enabled (v4.3.0+), or create memory.json manually.",
      severity: "warning",
      affects: ["token efficiency", "cross-IDE interop", "concurrent session safety"],
    })
    return issues
  }

  let manifest: unknown
  try {
    const raw = readFileSync(manifestPath, "utf-8")
    manifest = JSON.parse(raw)
  } catch (error) {
    issues.push({
      title: "Memory manifest invalid",
      description: `memory.json could not be parsed: ${error instanceof Error ? error.message : String(error)}`,
      fix: "Fix the JSON syntax in memory.json, or delete it and let the bootstrap regenerate it.",
      severity: "warning",
      affects: ["memory manifest features"],
    })
    return issues
  }

  const validation = validateManifest(manifest)
  if (!validation.valid) {
    issues.push({
      title: "Memory manifest invalid",
      description: `memory.json schema validation failed: ${validation.reason}`,
      fix: "Fix the manifest structure, or delete it and let the bootstrap regenerate.",
      severity: "warning",
      affects: ["memory manifest features"],
    })
    return issues
  }

  const validManifest = validation.manifest

  if (validManifest.schema_version > MEMORY_MANIFEST_SCHEMA_VERSION) {
    issues.push({
      title: "Memory manifest version mismatch",
      description: `memory.json schema_version is ${validManifest.schema_version}, but this plugin supports version ${MEMORY_MANIFEST_SCHEMA_VERSION}.`,
      fix: "Update oh-my-openagent to the latest version.",
      severity: "warning",
      affects: ["newer manifest fields"],
    })
  }

  for (const entry of readdirSync(memoryDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue
    if (!entry.name.endsWith(".md")) continue
    if (!validManifest.files[entry.name]) {
      issues.push({
        title: "Orphan memory file",
        description: `File ${entry.name} exists in the memory directory but is not listed in memory.json's files registry.`,
        fix: "Add the file to memory.json's files object, or move it out of the memory directory.",
        severity: "warning",
        affects: ["memory file tracking"],
      })
    }
  }

  const placeholderFiles = Object.entries(validManifest.files)
    .filter(([, entry]) => entry.is_placeholder)
    .map(([name]) => name)

  if (placeholderFiles.length > 0) {
    issues.push({
      title: "Memory files contain only placeholders",
      description: `The following files in memory.json are marked as placeholders: ${placeholderFiles.join(", ")}`,
      fix: "Populate these files with actual project context to improve Hecateq memory quality.",
      severity: "warning",
      affects: ["Hecateq context quality"],
    })
  }

  return issues
}

/**
 * Doctor check: Memory pointer file presence and validity.
 *
 * Checks whether the repo-root `.memory-manifest.json` pointer file
 * exists and is valid. This is the primary discovery mechanism for
 * cross-IDE/harness memory portability.
 */
export function collectMemoryPointerIssues(cwd = process.cwd()): DoctorIssue[] {
  const issues: DoctorIssue[] = []

  const discovered = discoverMemoryPaths(cwd)
  if (!discovered) return issues // no project root found

  if (!discovered.pointerExists) {
    issues.push({
      title: "Memory pointer file missing",
      description: "The repo-root `.memory-manifest.json` pointer file does not exist. Cross-IDE/harness discovery of the memory system is degraded.",
      fix: "Start a session with hecateq-memory-bootstrap enabled, or run doctor --fix to create the pointer file.",
      severity: "warning",
      affects: ["cross-IDE memory portability", "harness-agnostic discovery"],
    })
    return issues
  }

  const pointer = readMemoryPointer(discovered.pointerPath)
  if (!pointer) {
    issues.push({
      title: "Memory pointer file invalid",
      description: "The `.memory-manifest.json` pointer file exists but is invalid or has wrong kind.",
      fix: "Fix the pointer file structure, or delete it to let the bootstrap regenerate it.",
      severity: "warning",
      affects: ["cross-IDE memory portability"],
    })
  }

  return issues
}

/**
 * Doctor check: Continuation freshness.
 *
 * Checks whether continuation.json is present and fresh.
 * A stale continuation means the source markdown files have
 * changed since the continuation was written.
 */
export function collectContinuationFreshnessIssues(cwd = process.cwd()): DoctorIssue[] {
  const issues: DoctorIssue[] = []

  const discovered = discoverMemoryPaths(cwd)
  if (!discovered || !discovered.manifestExists) return issues

  const { readManifest } = require("../../../shared/memory-manifest") as {
    readManifest: (root: string) => ReturnType<typeof import("../../../shared/memory-manifest").readManifest>
  }
  const manifest = readManifest(discovered.projectRoot)
  if (!manifest) return issues

  const state = computeContinuationState(discovered.projectRoot, manifest)

  if (state === "missing") {
    // Only warn when there IS a manifest but no continuation — this is fine,
    // but it means no portable resume state is available
    return []
  }

  if (state === "stale") {
    issues.push({
      title: "Continuation state is stale",
      description: "continuation.json exists but its source_hashes no longer match the current memory file content. The continuation will be ignored until refreshed.",
      fix: "Write a new continuation.json with updated source_hashes reflecting the current memory file state.",
      severity: "warning",
      affects: ["cross-harness resumption", "portable work state"],
    })
  }

  return issues
}

export function collectCustomAgentIssues(cwd = process.cwd()): DoctorIssue[] {
  const issues: DoctorIssue[] = []
  const discoveredAgents = discoverCustomAgentFiles(cwd)
  const scannedDirs = getAgentDirectories(cwd).map((directory) => directory.path)

  if (discoveredAgents.length === 0) {
    issues.push({
      title: "No custom agents discovered",
      description: `No custom agent .md files were found in: ${scannedDirs.join(", ")}`,
      fix: "Add custom agent .md files under ~/.config/opencode/agents, <project>/.opencode/agents, ~/.claude/agents, or <project>/.claude/agents.",
      severity: "warning",
      affects: ["Hecateq custom-agent-first routing"],
    })
    return issues
  }

  const byName = new Map<string, DiscoveredAgentFile[]>()
  for (const agent of discoveredAgents) {
    const normalized = agent.effectiveName.trim().toLowerCase()
    if (!byName.has(normalized)) byName.set(normalized, [])
    byName.get(normalized)?.push(agent)

    if (agent.parseError) {
      issues.push({
        title: "Custom agent frontmatter issue",
        description: `File: ${agent.path}. Problem: malformed frontmatter (${agent.parseError}).`,
        fix: "Repair the YAML/frontmatter syntax so the custom agent file parses cleanly.",
        severity: "warning",
        affects: ["Hecateq agent selection quality"],
      })
      continue
    }

    if (!agent.declaredName) {
      issues.push({
        title: "Custom agent frontmatter issue",
        description: `File: ${agent.path}. Problem: missing name. The filename-derived name \`${agent.derivedName}\` will be used.`,
        fix: "Add a frontmatter name field for clearer registry identity.",
        severity: "warning",
        affects: ["Hecateq agent selection quality"],
      })
    }

    if (!agent.description || agent.description.trim().length === 0) {
      issues.push({
        title: "Custom agent frontmatter issue",
        description: `File: ${agent.path}. Problem: missing description.`,
        fix: "Add a description field to improve custom agent discovery quality.",
        severity: "warning",
        affects: ["Hecateq agent selection quality"],
      })
    }

    if (agent.body.trim().length === 0) {
      issues.push({
        title: "Custom agent frontmatter issue",
        description: `File: ${agent.path}. Problem: empty body.`,
        fix: "Add prompt body content to the custom agent markdown file.",
        severity: "warning",
        affects: ["Hecateq agent selection quality"],
      })
    }

    const unsupportedFields = agent.frontmatterKeys.filter((key) => !SUPPORTED_FRONTMATTER_FIELDS.has(key))
    if (unsupportedFields.length > 0) {
      issues.push({
        title: "Custom agent frontmatter issue",
        description: `File: ${agent.path}. Problem: unsupported fields (${unsupportedFields.join(", ")}).`,
        fix: "Remove unsupported frontmatter fields or move that metadata elsewhere.",
        severity: "warning",
        affects: ["Hecateq agent selection quality"],
      })
    }
  }

  for (const [normalizedName, agents] of byName.entries()) {
    if (agents.length < 2) continue
    const displayName = agents[0]?.effectiveName ?? normalizedName
    const locations = agents.map((agent) => `- ${agent.path}`).join("\n")
    issues.push({
      title: "Duplicate custom agent names found",
      description: `Agent \`${displayName}\` appears in:\n${locations}`,
      fix: "Rename or consolidate duplicate custom agent files so exact routing targets remain unambiguous.",
      severity: "warning",
      affects: ["exact subagent routing", "Hecateq registry clarity"],
    })
  }

  return issues
}

export function collectHecateqConfigIssues(cwd = process.cwd()): { issues: DoctorIssue[]; details: string[] } {
  const issues: DoctorIssue[] = []
  const details: string[] = []
  const configPaths = getPluginConfigCandidatePaths(cwd)
  const parsedConfigs = configPaths
    .map((configPath) => ({ configPath, parsed: readJsoncFile(configPath) }))
    .filter((entry): entry is { configPath: string; parsed: PluginConfigRecord } => entry.parsed !== null)

  const configsWithHecateqOverride = parsedConfigs.filter((entry) => isRecord(entry.parsed.agents) && HECATEQ_AGENT_NAME in entry.parsed.agents)
  if (configsWithHecateqOverride.length === 0) {
    details.push("No explicit Hecateq override found. Built-in default config will be used.")
  }

  for (const { configPath, parsed } of parsedConfigs) {
    const disabledAgents = Array.isArray(parsed.disabled_agents) ? parsed.disabled_agents.filter((value): value is string => typeof value === "string") : []
    if (disabledAgents.includes(HECATEQ_AGENT_NAME)) {
      issues.push({
        title: "Hecateq Orchestrator is disabled",
        description: `File: ${configPath}. disabled_agents includes \`${HECATEQ_AGENT_NAME}\`.`,
        fix: `Remove \`${HECATEQ_AGENT_NAME}\` from disabled_agents if you want Hecateq workflow.`,
        severity: "warning",
        affects: ["Hecateq custom-agent-first workflow"],
      })
    }

    const rawOverride = isRecord(parsed.agents) ? parsed.agents[HECATEQ_AGENT_NAME] : undefined
    if (!isRecord(rawOverride)) continue

    const schemaResult = OhMyOpenCodeConfigSchema.shape.agents.safeParse({ [HECATEQ_AGENT_NAME]: rawOverride })
    if (!schemaResult.success) {
      issues.push({
        title: "Hecateq Orchestrator config issue",
        description: `File: ${configPath}. Invalid Hecateq override: ${schemaResult.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`,
        fix: "Make sure agents.hecateq-orchestrator uses valid model, fallback_models, permission, and prompt_append values.",
        severity: "warning",
        affects: ["Hecateq custom-agent-first workflow"],
      })
    }
  }

  for (const { configPath, parsed } of parsedConfigs) {
    const rawHecateq = parsed.hecateq
    if (rawHecateq === undefined) continue

    const schemaResult = HecateqConfigSchema.safeParse(rawHecateq)
    if (!schemaResult.success) {
      issues.push({
        title: "Hecateq config issue",
        description: `File: ${configPath}. Invalid hecateq config: ${schemaResult.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`,
        fix: "Make sure hecateq workflow settings use valid booleans and numeric limits.",
        severity: "warning",
        affects: ["Hecateq workflow helpers"],
      })
      continue
    }

    const hecateqConfig = schemaResult.data
    if (!hecateqConfig.enabled) {
      issues.push({
        title: "Hecateq workflow helpers disabled",
        description: `File: ${configPath}. hecateq.enabled is false.`,
        fix: "Set hecateq.enabled to true if you want Hecateq workflow helpers active.",
        severity: "warning",
        affects: ["Hecateq memory/bootstrap helpers", "Hecateq context injection"],
      })
    }

    details.push(`File: ${configPath}. Hecateq context injection mode: ${hecateqConfig.context_injection.mode}`)

    if (!hecateqConfig.context_injection.enabled) {
      issues.push({
        title: "Hecateq project context injector disabled by config",
        description: `File: ${configPath}. hecateq.context_injection.enabled is false.`,
        fix: "Set hecateq.context_injection.enabled to true if you want automatic project context injection.",
        severity: "warning",
        affects: ["Hecateq project context injection"],
      })
    } else if (hecateqConfig.context_injection.mode === "off") {
      issues.push({
        title: "Hecateq project context injector disabled by mode",
        description: `File: ${configPath}. hecateq.context_injection.mode is off.`,
        fix: "Set hecateq.context_injection.mode to compact or expanded if you want automatic project context injection.",
        severity: "warning",
        affects: ["Hecateq project context injection"],
      })
    } else if (hecateqConfig.context_injection.mode === "expanded") {
      details.push(`File: ${configPath}. Expanded context injection mode may increase token usage.`)
    }

    if (!hecateqConfig.context_injection.include_contracts) {
      details.push(`File: ${configPath}. Hecateq contracts listing disabled by config.`)
    }

    if (!hecateqConfig.context_injection.include_task_graphs) {
      details.push(`File: ${configPath}. Hecateq task graph listing disabled by config.`)
    }

    details.push(`File: ${configPath}. Hecateq agent index runtime enrichment: ${hecateqConfig.agent_index.enrich_runtime_agents ? "enabled" : "disabled"}.`)
    details.push(`File: ${configPath}. Hecateq agent index suggestions: ${hecateqConfig.agent_index.use_for_suggestions ? "enabled" : "disabled"}.`)
    details.push(`File: ${configPath}. Hecateq agent index require_fresh: ${hecateqConfig.agent_index.require_fresh}.`)
    details.push(`File: ${configPath}. Agent index settings are advisory-only and do not change exact runtime resolution semantics.`)

    if (!hecateqConfig.git_checkpoint.enabled) {
      issues.push({
        title: "Git checkpoint helper disabled",
        description: `File: ${configPath}. hecateq.git_checkpoint.enabled is false.`,
        fix: "Set hecateq.git_checkpoint.enabled to true if you want runtime git checkpoint detection in the Hecateq workflow.",
        severity: "warning",
        affects: ["Hecateq git checkpoint helper"],
      })
      continue
    }

    if (hecateqConfig.git_checkpoint.mode === "off") {
      details.push(`File: ${configPath}. Hecateq git checkpoint helper mode is off.`)
      continue
    }

    if (hecateqConfig.git_checkpoint.mode === "suggest") {
      details.push(`File: ${configPath}. Hecateq git checkpoint helper is in suggest mode with no automatic commit.`)
    }

    if (hecateqConfig.git_checkpoint.mode === "auto_clean_only") {
      if (hecateqConfig.git_checkpoint.auto_checkpoint_clean_repo) {
        details.push(`File: ${configPath}. Hecateq git checkpoint helper may create an empty checkpoint commit on a clean repo.`)
      } else {
        details.push(`File: ${configPath}. Hecateq git checkpoint helper is in auto_clean_only mode, but automatic checkpoint creation is disabled.`)
      }
    }

    if (hecateqConfig.git_checkpoint.block_destructive_git) {
      details.push(`File: ${configPath}. block_destructive_git is enabled as prompt/helper policy only; no hard guard is enforced yet.`)
    }
  }

  return { issues, details }
}

export function collectSafetyHookIssues(cwd = process.cwd()): DoctorIssue[] {
  const issues: DoctorIssue[] = []
  const configPaths = getPluginConfigCandidatePaths(cwd)

  const disabledHooks = new Map<string, string[]>()
  for (const configPath of configPaths) {
    const parsed = readJsoncFile(configPath)
    if (!parsed) continue
    const hooks = Array.isArray(parsed.disabled_hooks) ? parsed.disabled_hooks.filter((value): value is string => typeof value === "string") : []
    for (const hook of hooks) {
      if (!disabledHooks.has(hook)) disabledHooks.set(hook, [])
      disabledHooks.get(hook)?.push(configPath)
    }
  }

  for (const hookName of SAFETY_HOOKS) {
    const locations = disabledHooks.get(hookName)
    if (!locations || locations.length === 0) continue

    const affects = {
      "stop-continuation-guard": "stopping/cancelling runaway continuations",
      "unstable-agent-babysitter": "runaway unstable subagent containment",
      "notepad-write-guard": "safe notepad writes",
      "plan-format-validator": "plan output structure validation",
      "comment-checker": "comment policy enforcement",
    }[hookName]

    issues.push({
      title: `Safety hook disabled: ${hookName}`,
      description: `Disabled in: ${locations.join(", ")}`,
      fix: `Remove \`${hookName}\` from disabled_hooks if you want this safety check active.`,
      severity: "warning",
      affects: [affects],
    })
  }

  return issues
}

export function collectOrchestrationIssues(cwd = process.cwd()): { issues: DoctorIssue[]; details: string[] } {
  const issues: DoctorIssue[] = []
  const details: string[] = []
  const configPaths = getPluginConfigCandidatePaths(cwd)

  for (const configPath of configPaths) {
    const parsed = readJsoncFile(configPath)
    if (!parsed) continue

    const hecateqConfig = isRecord(parsed.hecateq) ? parsed.hecateq : undefined
    if (!hecateqConfig) continue

    let orchestrationConfig: Record<string, unknown> | undefined
    if (isRecord(hecateqConfig.orchestration)) {
      orchestrationConfig = hecateqConfig.orchestration
    }
    if (!orchestrationConfig) {
      details.push(`File: ${configPath}. Hecateq orchestration not configured (default: disabled).`)
      continue
    }

    const enabled = orchestrationConfig.enabled === true
    details.push(`File: ${configPath}. Hecateq orchestration: ${enabled ? "enabled" : "disabled"}`)

    if (enabled) {
      const maxAttempts = orchestrationConfig.max_repair_attempts
      if (typeof maxAttempts === "number" && maxAttempts > 5) {
        issues.push({
          title: "Hecateq orchestration max_repair_attempts high",
          description: `File: ${configPath}. max_repair_attempts is ${maxAttempts}. Recommended max is 5.`,
          fix: "Reduce max_repair_attempts to 5 or lower to avoid excessive retries.",
          severity: "warning",
          affects: ["repair loop safety"],
        })
      }

      details.push(`  auto_decompose: ${String(orchestrationConfig.auto_decompose ?? true)}`)
      details.push(`  auto_execute_low_risk: ${String(orchestrationConfig.auto_execute_low_risk ?? true)}`)
      details.push(`  max_repair_attempts: ${String(maxAttempts ?? 2)}`)
      details.push(`  allow_parallel_readonly_tasks: ${String(orchestrationConfig.allow_parallel_readonly_tasks ?? true)}`)
      details.push(`  allow_parallel_write_tasks: ${String(orchestrationConfig.allow_parallel_write_tasks ?? false)}`)

      const qg = isRecord(orchestrationConfig.quality_gates) ? orchestrationConfig.quality_gates : undefined
      details.push(`  quality_gates typecheck: ${String(qg?.typecheck ?? true)}`)
      details.push(`  quality_gates lint: ${String(qg?.lint ?? true)}`)
      details.push(`  quality_gates test: ${String(qg?.test ?? true)}`)
      details.push(`  quality_gates build: ${String(qg?.build ?? true)}`)
      details.push(`  quality_gates doctor: ${String(qg?.doctor ?? false)}`)
    }
  }

  const stateDir = ".opencode/orchestration"
  if (existsSync(join(cwd, stateDir))) {
    const stateFiles = readdirSync(join(cwd, stateDir)).filter((f) => f.endsWith(".json"))
    details.push(`Orchestration state directory found at ${stateDir} with ${stateFiles.length} session state(s).`)
    if (stateFiles.length > 10) {
      issues.push({
        title: "Orchestration state files accumulating",
        description: `${stateFiles.length} state files found in ${stateDir}.`,
        fix: "Consider cleaning old orchestration session states if no longer needed.",
        severity: "warning",
        affects: ["disk usage"],
      })
    }
  } else {
    details.push("Orchestration state directory not found (no previous pipeline runs).")
  }

  return { issues, details }
}

/**
 * Check for invalid or stale handoff state in the run-continuation marker directory.
 *
 * Scans `.omo/run-continuation/` for marker files whose handoff-associated
 * reason data is either unparseable (invalid JSON) or stale (older than 24 hours
 * since the handoff session ended).
 *
 * This is a content quality check that complements the standard marker presence checks.
 *
 * Returns a DoctorIssue list. Empty array = no issues found.
 */
export function collectHandoffStateIssues(cwd = process.cwd()): DoctorIssue[] {
  const issues: DoctorIssue[] = []
  const runContDir = join(cwd, ".omo", "run-continuation")

  if (!existsSync(runContDir)) return issues

  const now = Date.now()
  const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000

  for (const entry of readdirSync(runContDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue

    const filePath = join(runContDir, entry.name)
    let marker: Record<string, unknown>
    try {
      const raw = readFileSync(filePath, "utf-8")
      marker = JSON.parse(raw) as Record<string, unknown>
    } catch {
      continue
    }

    const sources = marker.sources
    if (!sources || typeof sources !== "object" || Array.isArray(sources)) continue

    const bgTask = (sources as Record<string, unknown>)["background-task"]
    if (!bgTask || typeof bgTask !== "object" || Array.isArray(bgTask)) continue

    const bgRecord = bgTask as Record<string, unknown>
    const reason = bgRecord.reason
    if (typeof reason !== "string" || reason.length === 0) continue

    let parsedReason: Record<string, unknown> | null = null
    try {
      const parsed = JSON.parse(reason)
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        parsedReason = parsed as Record<string, unknown>
      }
    } catch {
      // Reason contains invalid JSON — handoff state corruption
      issues.push({
        title: "Invalid handoff marker detected",
        description: `File: ${filePath}. The 'reason' field in background-task source contains invalid JSON and cannot be parsed as handoff state.`,
        fix: "Clear the corrupted run-continuation marker or fix the handoff data manually.",
        severity: "warning",
        affects: ["handoff state recovery", "run continuation accuracy"],
      })
      continue
    }

    if (!parsedReason) continue

    // Check if this reason contains handoff-like fields
    const hasHandoffFields =
      typeof parsedReason.status === "string" &&
      (typeof parsedReason.handoff === "string" || parsedReason.handoff === undefined)
    if (!hasHandoffFields) continue

    // Check staleness
    const updatedAt = bgRecord.updatedAt
    if (typeof updatedAt !== "string") continue

    const updatedMs = new Date(updatedAt).getTime()
    if (isNaN(updatedMs)) continue

    if (now - updatedMs > STALE_THRESHOLD_MS) {
      issues.push({
        title: "Stale handoff state detected",
        description: `File: ${filePath}. Handoff has been active for more than 24 hours (status: ${String(parsedReason.status)}, target: ${parsedReason.handoff != null ? String(parsedReason.handoff) : "none"}).`,
        fix: "Review the handoff target and clear or restart the run-continuation session if no longer needed.",
        severity: "warning",
        affects: ["handoff state recovery", "run continuation accuracy"],
      })
    }
  }

  return issues
}

/**
 * Wave 3: Check role-policy consistency across known agents.
 *
 * Validates:
 * 1. All known agents (from handoff-parser) are classified into a role
 * 2. No role entries reference agents that no longer exist
 * 3. Reports coverage statistics
 */
export function collectHandoffRolePolicyIssues(): { issues: DoctorIssue[]; details: string[] } {
  const issues: DoctorIssue[] = []
  const details: string[] = []

  // Lazy-import to avoid circular dependency at module load time
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getKnownAgentIds } = require("../../../features/hecateq-orchestration/handoff-parser") as {
    getKnownAgentIds: () => string[]
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const hp = require("../../../features/hecateq-orchestration/handoff-role-policy") as {
    AGENT_ROLES: { agent: string; role: string; description: string }[]
    getAgentRole: (agent: string) => string
    hasKnownRole: (agent: string) => boolean
    findUnclassifiedAgents: () => string[]
    findOrphanedRoleEntries: () => { agent: string; role: string; description: string }[]
    describeRolePolicy: (agent: string) => string
  }

  const knownIds = getKnownAgentIds().filter(
    (id: string) => id !== "return_to_caller" && id !== "return_to_parent_for_routing",
  )
  const roleEntries = hp.AGENT_ROLES
  const roles = new Set(roleEntries.map((e) => e.role))

  details.push(`Handoff role policy status:`)
  details.push(`  Role categories defined: ${roles.size} (${Array.from(roles).join(", ")})`)
  details.push(`  Agents with role classification: ${roleEntries.length}`)
  details.push(`  Known agents (non-routing): ${knownIds.length}`)

  // Check 1: Unclassified agents
  const unclassified = hp.findUnclassifiedAgents()
  if (unclassified.length > 0) {
    issues.push({
      title: "Handoff role policy: unclassified agents",
      description: `${unclassified.length} agent(s) from the known agent list have no role classification: ${unclassified.join(", ")}. These agents will not have role-policy enforcement.`,
      fix: "Add entries for these agents to the AGENT_ROLES registry in handoff-role-policy.ts.",
      severity: "warning",
      affects: ["handoff role-policy enforcement completeness"],
    })
    details.push(`  Unclassified agents: ${unclassified.length} (${unclassified.join(", ")})`)
  } else {
    details.push(`  Unclassified agents: 0 — all known agents have a role assignment`)
  }

  // Check 2: Orphaned role entries
  const orphaned = hp.findOrphanedRoleEntries()
  if (orphaned.length > 0) {
    issues.push({
      title: "Handoff role policy: orphaned role entries",
      description: `${orphaned.length} role entr${orphaned.length === 1 ? "y" : "ies"} reference agent(s) not in the known agent list: ${orphaned.map((e) => e.agent).join(", ")}. ${orphaned.length === 1 ? "This entry may be stale or reference a planned agent." : "These entries may be stale or reference planned agents."}`,
      fix: "Review and either add the agents to getKnownAgentIds() or remove the role entries.",
      severity: "warning",
      affects: ["handoff role-policy registry accuracy"],
    })
    details.push(`  Orphaned role entries: ${orphaned.length} (${orphaned.map((e) => e.agent).join(", ")})`)
  } else {
    details.push(`  Orphaned role entries: 0 — all role entries reference known agents`)
  }

  // Coverage by role
  details.push(`  Role distribution:`)
  const roleDist = new Map<string, number>()
  for (const entry of roleEntries) {
    roleDist.set(entry.role, (roleDist.get(entry.role) ?? 0) + 1)
  }
  for (const [role, count] of Array.from(roleDist.entries()).sort()) {
    details.push(`    ${role}: ${count}`)
  }

  return { issues, details }
}

/**
 * Doctor check: Task State Memory (tasks.jsonl) presence and validity.
 *
 * Validates:
 * 1. File presence (missing → warning, not error)
 * 2. Empty file (→ no issue, file is valid)
 * 3. Malformed JSON lines (→ warning)
 * 4. Schema-invalid JSON lines (→ warning)
 * 5. Stale in_progress tasks (→ warning)
 * 6. Blocked tasks without blockers (→ warning)
 * 7. Completed tasks without verification summary (→ warning)
 */
export function collectTaskStateMemoryIssues(cwd = process.cwd()): DoctorIssue[] {
  const issues: DoctorIssue[] = []
  const memoryDir = join(cwd, PROJECT_MEMORY_DIR)
  const filePath = join(memoryDir, TASK_STATE_MEMORY_FILENAME)

  if (!existsSync(filePath)) {
    issues.push({
      title: "Task State Memory file missing",
      description: `tasks.jsonl not found. Task state tracking is unavailable; context injection falls back to tasks.md.`,
      fix: "Start a session with hecateq-memory-bootstrap enabled, or create an empty tasks.jsonl.",
      severity: "warning",
      affects: ["task state tracking", "structured task summary for context injection"],
    })
    return issues
  }

  const content = readFileSync(filePath, "utf-8").trim()
  if (content.length === 0) {
    // Empty file is valid — no issue
    return issues
  }

  const lines = content.split("\n")
  let malformedCount = 0
  let schemaInvalidCount = 0
  const entries: TaskStateEntry[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line.length === 0) continue

    try {
      const parsed = JSON.parse(line)
      const result = TaskStateEntrySchema.safeParse(parsed)
      if (result.success) {
        entries.push(result.data)
      } else {
        schemaInvalidCount++
      }
    } catch {
      malformedCount++
    }
  }

  if (malformedCount > 0) {
    issues.push({
      title: "Task State Memory has malformed JSON lines",
      description: `${malformedCount} line(s) in tasks.jsonl could not be parsed as JSON. These lines are ignored.`,
      fix: "Review tasks.jsonl and fix the malformed JSON on the reported lines.",
      severity: "warning",
      affects: ["task state completeness", "structured task summary"],
    })
  }

  if (schemaInvalidCount > 0) {
    issues.push({
      title: "Task State Memory has schema-invalid entries",
      description: `${schemaInvalidCount} line(s) in tasks.jsonl failed TaskStateEntrySchema validation. These entries are skipped.`,
      fix: "Ensure each task entry matches the TaskStateEntrySchema (version, id, timestamp, action, title, status required).",
      severity: "warning",
      affects: ["task state accuracy"],
    })
  }

  // Stale in_progress tasks
  const staleTasks = detectStaleTasks(entries)
  if (staleTasks.length > 0) {
    issues.push({
      title: "Task State Memory has stale in_progress tasks",
      description: `${staleTasks.length} task(s) have been in_progress for over 24 hours without updates: ${staleTasks.map((t) => t.id).join(", ")}.`,
      fix: "Review each stale task and either mark it as completed, update its timestamp, or cancel it.",
      severity: "warning",
      affects: ["task state accuracy", "stale task detection"],
    })
  }

  // Blocked tasks without blockers
  const blockedTasks = detectBlockedTasks(entries)
  const blockedWithoutBlockers = blockedTasks.filter(
    (t) => !t.blockers || t.blockers.length === 0,
  )
  if (blockedWithoutBlockers.length > 0) {
    issues.push({
      title: "Task State Memory has blocked tasks without blockers",
      description: `${blockedWithoutBlockers.length} blocked task(s) have no blockers listed: ${blockedWithoutBlockers.map((t) => t.id).join(", ")}.`,
      fix: "Add blocker references to blocked tasks or unblock them if no longer blocked.",
      severity: "warning",
      affects: ["task dependency tracking"],
    })
  }

  // Completed tasks without verification
  const latest = resolveLatestTaskState(entries)
  const completedNoVerification: TaskStateEntry[] = []
  for (const [, entry] of latest) {
    if (entry.status === "completed" && !entry.verification) {
      completedNoVerification.push(entry)
    }
  }
  if (completedNoVerification.length > 0) {
    const ids = completedNoVerification.slice(0, 5).map((t) => t.id).join(", ")
    issues.push({
      title: "Task State Memory has completed tasks without verification",
      description: `${completedNoVerification.length} completed task(s) lack a verification summary${completedNoVerification.length > 5 ? ` (showing first 5: ${ids})` : `: ${ids}`}.`,
      fix: "Add a verification summary to completed tasks for better context injection quality.",
      severity: "warning",
      affects: ["task completeness auditing", "context injection quality"],
    })
  }

  return issues
}

/**
 * Doctor check: Decision Log (decisions.jsonl) presence and validity.
 *
 * Validates:
 * 1. File presence (missing → warning, not error)
 * 2. Empty file (→ no issue, file is valid)
 * 3. Malformed JSON lines (→ warning)
 * 4. Schema-invalid JSON lines (→ warning)
 * 5. Orphaned supersede references (→ warning)
 * 6. Conflicting active decisions in the same impact area (→ warning)
 */
export function collectDecisionLogIssues(cwd = process.cwd()): DoctorIssue[] {
  const issues: DoctorIssue[] = []
  const memoryDir = join(cwd, PROJECT_MEMORY_DIR)
  const filePath = join(memoryDir, DECISION_LOG_FILENAME)

  if (!existsSync(filePath)) {
    issues.push({
      title: "Decision Log file missing",
      description: `decisions.jsonl not found. Structured decision tracking is unavailable; context injection falls back to decisions.md.`,
      fix: "Start a session with hecateq-memory-bootstrap enabled, or create an empty decisions.jsonl.",
      severity: "warning",
      affects: ["decision tracking", "structured decision summary for context injection"],
    })
    return issues
  }

  const content = readFileSync(filePath, "utf-8").trim()
  if (content.length === 0) {
    // Empty file is valid — no issue
    return issues
  }

  const lines = content.split("\n")
  let malformedCount = 0
  let schemaInvalidCount = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line.length === 0) continue

    try {
      const parsed = JSON.parse(line)
      const result = DecisionLogEntrySchema.safeParse(parsed)
      if (!result.success) {
        schemaInvalidCount++
      }
    } catch {
      malformedCount++
    }
  }

  if (malformedCount > 0) {
    issues.push({
      title: "Decision Log has malformed JSON lines",
      description: `${malformedCount} line(s) in decisions.jsonl could not be parsed as JSON. These lines are ignored.`,
      fix: "Review decisions.jsonl and fix the malformed JSON on the reported lines.",
      severity: "warning",
      affects: ["decision log completeness", "structured decision summary"],
    })
  }

  if (schemaInvalidCount > 0) {
    issues.push({
      title: "Decision Log has schema-invalid entries",
      description: `${schemaInvalidCount} line(s) in decisions.jsonl failed DecisionLogEntrySchema validation. These entries are skipped.`,
      fix: "Ensure each decision entry matches the DecisionLogEntrySchema (version, id, timestamp, action, title, status, decision, rationale, impact_area required).",
      severity: "warning",
      affects: ["decision log accuracy"],
    })
  }

  // Read entries for semantic checks
  const entries = readDecisionLog(cwd) ?? []

  // Orphaned supersede references
  const orphaned = detectOrphanedSupersedes(entries)
  if (orphaned.length > 0) {
    issues.push({
      title: "Decision Log has orphaned supersede references",
      description: `${orphaned.length} decision(s) reference a superseded-by ID that does not exist: ${orphaned.map((d) => `${d.id} → ${d.supersedes}`).join(", ")}.`,
      fix: "Ensure each supersedes reference points to an existing decision ID, or remove the reference.",
      severity: "warning",
      affects: ["decision log consistency", "supersede chain integrity"],
    })
  }

  // Conflicting active decisions in the same impact area
  const conflicts = detectConflictingDecisions(entries)
  if (conflicts.length > 0) {
    for (const conflict of conflicts) {
      issues.push({
        title: "Decision Log has conflicting active decisions",
        description: `${conflict.decisions.length} active decisions share impact area "${conflict.area}": ${conflict.decisions.map((d) => d.id).join(", ")}. Consider superseding or reverting one.`,
        fix: "Mark one decision as superseded or reverted to resolve the conflict in this impact area.",
        severity: "warning",
        affects: ["decision consistency", "architecture coherence"],
      })
    }
  }

  return issues
}

export async function checkHecateqWorkflow(): Promise<CheckResult> {
  const cwd = process.cwd()
  const configHealth = collectHecateqConfigIssues(cwd)
  const agentIndexHealth = collectAgentIndexIssues()
  const orchestrationHealth = collectOrchestrationIssues(cwd)
  const rolePolicyHealth = collectHandoffRolePolicyIssues()
  const traceHealth = collectRuntimeTraceIssues(cwd)
  const issues = [
    ...collectHecateqRegistrationIssues(),
    ...collectProjectRootMemoryIssues(cwd),
    ...collectMemoryQualityIssues(cwd),
    ...collectMemoryManifestIssues(cwd),
    ...collectMemoryPointerIssues(cwd),
    ...collectContinuationFreshnessIssues(cwd),
    ...collectProjectArtifactIssues(cwd),
    ...collectCustomAgentIssues(cwd),
    ...collectTaskStateMemoryIssues(cwd),
    ...collectDecisionLogIssues(cwd),
    ...collectSecretFindings(cwd).map<DoctorIssue>((finding) => ({
      title: "Potential secret or webhook found in config",
      description: `File: ${finding.filePath}. Key: ${finding.keyPath}. Masked value: ${finding.maskedValue}`,
      fix: "Rotate the webhook/API key and move it to an environment variable if supported.",
      severity: "warning",
      affects: ["credential safety"],
    })),
    ...configHealth.issues,
    ...agentIndexHealth.issues,
    ...orchestrationHealth.issues,
    ...rolePolicyHealth.issues,
    ...traceHealth.issues,
    ...collectSafetyHookIssues(cwd),
    ...collectHandoffStateIssues(cwd),
  ]

  const status = buildIssueStatus(issues)

  return {
    name: CHECK_NAMES[CHECK_IDS.HECATEQ_WORKFLOW],
    status,
    message: buildIssueMessage(status, issues),
    details: [
      `Workspace: ${resolve(cwd)}`,
      ...configHealth.details,
      ...agentIndexHealth.details,
      ...orchestrationHealth.details,
      ...rolePolicyHealth.details,
      ...traceHealth.details,
      `Custom agent directories scanned: ${getAgentDirectories(cwd).map((directory) => directory.path).join(", ")}`,
    ],
    issues,
  }
}

/**
 * Doctor check: Runtime trace observability summary.
 *
 *  Reads the persisted trace JSONL from `.opencode/state/hecateq/traces.jsonl` and
 * reports event counts, noteworthy events (role violations, guardrail skips,
 * model fallbacks), and operational health signals.
 *
 * This is diagnostic-only — it never fails the doctor check.
 */
export function collectRuntimeTraceIssues(cwd: string): { issues: DoctorIssue[]; details: string[] } {
  const issues: DoctorIssue[] = []
  const details: string[] = []

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getPersistedTraceSummary, getDefaultTraceBuffer } = require("../../../shared/runtime-trace") as {
      getPersistedTraceSummary: (dir: string) => { totalEvents: number; byType: Record<string, number>; byPhase: Record<string, number>; lastEventAt: string | null; noteworthy: Array<{ type: string; timestamp: string; summary: string }> }
      getDefaultTraceBuffer: () => { summary: () => { totalEvents: number; byType: Record<string, number>; noteworthy: Array<{ type: string; timestamp: string; summary: string }> } }
    }

    const persistedSummary = getPersistedTraceSummary(cwd)
    const memorySummary = getDefaultTraceBuffer().summary()

    const totalEvents = persistedSummary.totalEvents + memorySummary.totalEvents
    details.push(`Runtime trace events: ${totalEvents} (${persistedSummary.totalEvents} persisted, ${memorySummary.totalEvents} in-memory)`)

    if (persistedSummary.totalEvents > 0) {
      const typeEntries = Object.entries(persistedSummary.byType)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
      if (typeEntries.length > 0) {
        details.push("Persisted trace event types:")
        for (const [type, count] of typeEntries) {
          details.push(`  ${type}: ${count}`)
        }
      }
    }

    if (memorySummary.totalEvents > 0) {
      const memTypeEntries = Object.entries(memorySummary.byType)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
      if (memTypeEntries.length > 0) {
        details.push("In-memory trace event types:")
        for (const [type, count] of memTypeEntries) {
          details.push(`  ${type}: ${count}`)
        }
      }
    }

    // Report noteworthy events from both sources
    const allNoteworthy = [
      ...persistedSummary.noteworthy,
      ...memorySummary.noteworthy,
    ].slice(0, 20)

    if (allNoteworthy.length > 0) {
      for (const event of allNoteworthy.slice(0, 10)) {
        issues.push({
          title: `Runtime trace: ${event.type}`,
          description: event.summary,
          fix: event.type === "routing.role_violation"
            ? "Review handoff role policy configuration and agent role assignments."
            : event.type === "delegation.guardrail_skipped"
              ? "Review delegation guardrail settings and routing depth configuration."
              : "Check model fallback configuration and provider availability.",
          severity: "warning",
          affects: ["runtime observability", "handoff routing", "delegation behavior"],
        })
      }
    }

    if (persistedSummary.lastEventAt) {
      details.push(`Last persisted event: ${persistedSummary.lastEventAt}`)
    }

    if (totalEvents === 0) {
      details.push("No runtime trace events recorded — traces accumulate as handoffs, routing decisions, and delegations occur during agent sessions.")
    }
  } catch {
    // Trace module not available or errored — skip silently
    details.push("Runtime trace: unavailable (module may not have loaded)")
  }

  return { issues, details }
}
