import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join, resolve } from "node:path"

import { OhMyOpenCodeConfigSchema } from "../../../config"
import { BuiltinAgentNameSchema, OverridableAgentNameSchema } from "../../../config/schema/agent-names"
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
  const issues = [
    ...collectHecateqRegistrationIssues(),
    ...collectProjectRootMemoryIssues(cwd),
    ...collectProjectArtifactIssues(cwd),
    ...collectCustomAgentIssues(cwd),
    ...collectSecretFindings(cwd).map<DoctorIssue>((finding) => ({
      title: "Potential secret or webhook found in config",
      description: `File: ${finding.filePath}. Key: ${finding.keyPath}. Masked value: ${finding.maskedValue}`,
      fix: "Rotate the webhook/API key and move it to an environment variable if supported.",
      severity: "warning",
      affects: ["credential safety"],
    })),
    ...collectHecateqConfigIssues(cwd).issues,
    ...collectSafetyHookIssues(cwd),
  ]

  const status = buildIssueStatus(issues)
  const configHealth = collectHecateqConfigIssues(cwd)

  return {
    name: CHECK_NAMES[CHECK_IDS.HECATEQ_WORKFLOW],
    status,
    message: buildIssueMessage(status, issues),
    details: [
      `Workspace: ${resolve(cwd)}`,
      ...configHealth.details,
      `Custom agent directories scanned: ${getAgentDirectories(cwd).map((directory) => directory.path).join(", ")}`,
    ],
    issues,
  }
}
