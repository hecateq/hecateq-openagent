import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { basename, join, resolve } from "node:path"

import { OhMyOpenCodeConfigSchema } from "../../../config"
import { BuiltinAgentNameSchema, OverridableAgentNameSchema } from "../../../config/schema/agent-names"
import { HecateqConfigSchema } from "../../../config/schema/hecateq"
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
  PROJECT_TASK_GRAPHS_DIR,
} from "../../../shared/memory-bootstrap"
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
      fix: "Create .opencode/memory/knowledge/context/ with active-context.md, progress.md, tasks.md, file-map.md, decisions.md.",
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
      fix: "Add the missing project-root memory files under .opencode/memory/knowledge/context/.",
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

export async function checkHecateqWorkflow(): Promise<CheckResult> {
  const cwd = process.cwd()
  const configHealth = collectHecateqConfigIssues(cwd)
  const agentIndexHealth = collectAgentIndexIssues()
  const issues = [
    ...collectHecateqRegistrationIssues(),
    ...collectProjectRootMemoryIssues(cwd),
    ...collectMemoryQualityIssues(cwd),
    ...collectProjectArtifactIssues(cwd),
    ...collectCustomAgentIssues(cwd),
    ...collectSecretFindings(cwd).map<DoctorIssue>((finding) => ({
      title: "Potential secret or webhook found in config",
      description: `File: ${finding.filePath}. Key: ${finding.keyPath}. Masked value: ${finding.maskedValue}`,
      fix: "Rotate the webhook/API key and move it to an environment variable if supported.",
      severity: "warning",
      affects: ["credential safety"],
    })),
    ...configHealth.issues,
    ...agentIndexHealth.issues,
    ...collectSafetyHookIssues(cwd),
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
      `Custom agent directories scanned: ${getAgentDirectories(cwd).map((directory) => directory.path).join(", ")}`,
    ],
    issues,
  }
}
