import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"

import { getMainSessionID, subagentSessions } from "../../features/claude-code-session-state"
import {
  buildLiveHandoffContextSummary,
  buildOrchestrationContextBlock,
  resolveOrchestrationConfig,
  type ResolvedOrchestrationConfig,
} from "../../features/hecateq-orchestration"
import type {
  HecateqContextInjectionConfig,
  HecateqContextInjectionMode,
  HecateqGitCheckpointConfig,
  HecateqOrchestrationConfig,
} from "../../config"
import { getAgentConfigKey } from "../../shared/agent-display-names"
import {
  detectGitState,
  resolveGitCheckpointOptions,
  type GitCheckpointState,
  type ResolvedGitCheckpointOptions,
} from "../../shared/git-checkpoint"
import {
  HecateqAgentIndexSchema,
  getHecateqAgentIndexOutputPath,
} from "../../shared/hecateq-agent-indexer"
import { log } from "../../shared/logger"
import {
  findProjectRoot,
  PROJECT_CONTRACTS_DIR,
  PROJECT_MEMORY_DIR,
  PROJECT_MEMORY_FILES,
  PROJECT_TASK_GRAPHS_DIR,
} from "../../shared/memory-bootstrap"

export const HOOK_NAME = "hecateq-project-context-injector" as const
export const MAX_MEMORY_FILE_CHARS = 2000
export const MAX_TOTAL_CONTEXT_CHARS = 10000
export const MAX_ARTIFACT_FILES = 20
const MAX_CONTEXT_LIMIT = 50000
const MAX_ARTIFACT_FILES_LIMIT = 1000
const CONTEXT_SEPARATOR = "\n\n---\n\n"
const HECATEQ_AGENT_KEY = "hecateq-orchestrator"

type ChatMessageInput = {
  sessionID: string
  agent?: string
}

type ChatMessageOutput = {
  parts: Array<{ type: string; text?: string; [key: string]: unknown }>
}

type EventInput = {
  event: {
    type: string
    properties?: unknown
  }
}

export type MemoryFileStatus = {
  name: string
  state: "present" | "missing" | "present but empty"
  size: number
}

export type ArtifactListEntry = {
  relativePath: string
  size: number
}

export type ProjectContextSnapshot = {
  projectRoot: string
  memoryFiles: MemoryFileStatus[]
  memorySummary: string
  initializedMemoryFileCount: number
  contractFiles: ArtifactListEntry[]
  contractFileCount: number
  contractsReady: boolean
  taskGraphFiles: ArtifactListEntry[]
  taskGraphFileCount: number
  taskGraphsReady: boolean
}

export type HecateqProjectContextInjectorHook = {
  HOOK_NAME: typeof HOOK_NAME
  buildProjectContextBlock: typeof buildProjectContextBlock
  createSnapshot: typeof createProjectContextSnapshot
  "chat.message": (input: ChatMessageInput, output: ChatMessageOutput) => Promise<void>
  event: (input: EventInput) => Promise<void>
}

export type HecateqProjectContextInjectorOptions = {
  enabled: boolean
  mode: HecateqContextInjectionMode
  maxMemoryFileChars: number
  maxTotalChars: number
  maxArtifactFiles: number
  includeContracts: boolean
  includeTaskGraphs: boolean
  includeAgentIndex: boolean
  maxAgentDomains: number
  maxAgentsPerDomain: number
  injectOnSubagents: boolean
  hecateqOnly: boolean
}

export type GitCheckpointContextBlock = {
  options: ResolvedGitCheckpointOptions
  state: GitCheckpointState
}

type AgentIndexContextSummary =
  | {
      state: "missing" | "invalid"
    }
  | {
      state: "present"
      generatedAt: string
      agentsIndexed: number
      weakMetadata: number
      duplicates: number
      highAmbiguity: number
      unknownPrimaryDomain: number
      topDomains: Array<{
        domain: string
        agents: string[]
      }>
    }

function normalizePositiveInt(value: number | undefined, fallback: number, max: number): number {
  if (!Number.isFinite(value) || value === undefined || value <= 0) return fallback
  return Math.min(Math.trunc(value), max)
}

function normalizeArtifactLimit(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || value === undefined || value < 0) return fallback
  return Math.min(Math.trunc(value), MAX_ARTIFACT_FILES_LIMIT)
}

function normalizeAgentSummaryLimit(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || value === undefined || value <= 0) return fallback
  return Math.min(Math.trunc(value), 100)
}

export function resolveProjectContextInjectorOptions(
  config: Partial<HecateqContextInjectionConfig> | undefined,
): HecateqProjectContextInjectorOptions {
  return {
    enabled: config?.enabled ?? true,
    mode: config?.mode ?? "compact",
    maxMemoryFileChars: normalizePositiveInt(config?.max_memory_file_chars, MAX_MEMORY_FILE_CHARS, MAX_CONTEXT_LIMIT),
    maxTotalChars: normalizePositiveInt(config?.max_total_chars, MAX_TOTAL_CONTEXT_CHARS, MAX_CONTEXT_LIMIT),
    maxArtifactFiles: normalizeArtifactLimit(config?.max_artifact_files, MAX_ARTIFACT_FILES),
    includeContracts: config?.include_contracts ?? true,
    includeTaskGraphs: config?.include_task_graphs ?? true,
    includeAgentIndex: config?.include_agent_index ?? true,
    maxAgentDomains: normalizeAgentSummaryLimit(config?.max_agent_domains, 8),
    maxAgentsPerDomain: normalizeAgentSummaryLimit(config?.max_agents_per_domain, 5),
    injectOnSubagents: config?.inject_on_subagents ?? false,
    hecateqOnly: config?.hecateq_only ?? true,
  }
}

function truncateText(value: string, limit: number): string {
  if (value.length <= limit) return value
  return `${value.slice(0, Math.max(0, limit - 14))}...[truncated]`
}

function normalizeMemoryContent(content: string, perFileLimit: number): string {
  const trimmed = content.trim()
  if (!trimmed) return "[present but empty]"

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const nonHeadingLines = lines.filter((line) => !line.startsWith("#"))
  const todoLike = nonHeadingLines.length > 0 && nonHeadingLines.every((line) => line.includes("TODO"))
  if (todoLike) return "[template placeholder omitted]"

  return truncateText(trimmed, perFileLimit)
}

function readMemorySummary(
  projectRoot: string,
  options: HecateqProjectContextInjectorOptions,
): { memoryFiles: MemoryFileStatus[]; initializedMemoryFileCount: number; summary: string } {
  const memoryFiles: MemoryFileStatus[] = []
  const summaryParts: string[] = []
  let used = 0
  let initializedMemoryFileCount = 0

  for (const fileName of PROJECT_MEMORY_FILES) {
    const filePath = join(projectRoot, PROJECT_MEMORY_DIR, fileName)
    if (!existsSync(filePath)) {
      memoryFiles.push({ name: fileName, state: "missing", size: 0 })
      continue
    }

    const stats = statSync(filePath)
    if (stats.size === 0) {
      memoryFiles.push({ name: fileName, state: "present but empty", size: 0 })
      initializedMemoryFileCount += 1
      continue
    }

    memoryFiles.push({ name: fileName, state: "present", size: stats.size })
    initializedMemoryFileCount += 1
    if (options.mode !== "expanded") continue
    if (used >= options.maxTotalChars) continue

    const raw = readFileSync(filePath, "utf-8")
    const normalized = normalizeMemoryContent(raw, Math.min(options.maxMemoryFileChars, options.maxTotalChars - used))
    const block = `### ${fileName}\n${normalized}`
    const nextLength = block.length + (summaryParts.length > 0 ? CONTEXT_SEPARATOR.length : 0)

    if (used + nextLength > options.maxTotalChars) {
      const remaining = options.maxTotalChars - used
      if (remaining > 32) {
        summaryParts.push(truncateText(block, remaining))
      }
      used = options.maxTotalChars
      continue
    }

    summaryParts.push(block)
    used += nextLength
  }

  return {
    memoryFiles,
    initializedMemoryFileCount,
    summary: summaryParts.join(CONTEXT_SEPARATOR),
  }
}

function listArtifactFiles(
  projectRoot: string,
  relativeDir: string,
  maxArtifactFiles: number,
): { exists: boolean; fileCount: number; files: ArtifactListEntry[] } {
  const dirPath = join(projectRoot, relativeDir)
  if (!existsSync(dirPath)) {
    return { exists: false, fileCount: 0, files: [] }
  }

  const fileEntries = readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .sort((left, right) => left.name.localeCompare(right.name))
  const files = fileEntries.slice(0, maxArtifactFiles).map((entry) => {
    const relativePath = `${relativeDir}/${entry.name}`
    const size = statSync(join(dirPath, entry.name)).size
    return { relativePath, size }
  })

  return {
    exists: true,
    fileCount: fileEntries.length,
    files,
  }
}

export function createProjectContextSnapshot(
  startDir: string,
  options: HecateqProjectContextInjectorOptions = resolveProjectContextInjectorOptions(undefined),
): ProjectContextSnapshot | null {
  const projectRoot = findProjectRoot(startDir)
  if (!projectRoot) return null

  const { memoryFiles, initializedMemoryFileCount, summary } = readMemorySummary(projectRoot, options)
  const contracts = options.includeContracts
    ? listArtifactFiles(projectRoot, PROJECT_CONTRACTS_DIR, options.maxArtifactFiles)
    : { exists: false, fileCount: 0, files: [] }
  const taskGraphs = options.includeTaskGraphs
    ? listArtifactFiles(projectRoot, PROJECT_TASK_GRAPHS_DIR, options.maxArtifactFiles)
    : { exists: false, fileCount: 0, files: [] }

  return {
    projectRoot,
    memoryFiles,
    initializedMemoryFileCount,
    memorySummary: summary,
    contractFiles: contracts.files,
    contractFileCount: contracts.fileCount,
    contractsReady: contracts.exists,
    taskGraphFiles: taskGraphs.files,
    taskGraphFileCount: taskGraphs.fileCount,
    taskGraphsReady: taskGraphs.exists,
  }
}

function formatArtifactLines(entries: ArtifactListEntry[]): string {
  if (entries.length === 0) return "- files: none"
  return ["- files:", ...entries.map((entry) => `  - ${entry.relativePath} (${entry.size} bytes)`)].join("\n")
}

function formatCompactArtifactSummary(label: string, ready: boolean, fileCount: number): string {
  return `- ${label}: ${ready ? "ready" : "missing"}, ${fileCount} files`
}

function getAmbiguityRank(value: string): number {
  switch (value) {
    case "low": return 0
    case "medium": return 1
    case "high": return 2
    default: return 3
  }
}

function readAgentIndexContextSummary(
  options: HecateqProjectContextInjectorOptions,
): AgentIndexContextSummary | null {
  if (!options.includeAgentIndex) return null

  const outputPath = getHecateqAgentIndexOutputPath()
  if (!existsSync(outputPath)) {
    return { state: "missing" }
  }

  try {
    const parsed = JSON.parse(readFileSync(outputPath, "utf-8"))
    const index = HecateqAgentIndexSchema.parse(parsed)
    const topDomains = Object.entries(index.summary.domain_coverage)
      .filter(([domain, count]) => domain !== "unknown" && count > 0)
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, options.maxAgentDomains)
      .map(([domain]) => {
        const agents = index.agents
          .filter((agent) => agent.primary_domain === domain)
          .sort((left, right) => {
            if (right.confidence !== left.confidence) return right.confidence - left.confidence
            const ambiguity = getAmbiguityRank(left.routing.ambiguity) - getAmbiguityRank(right.routing.ambiguity)
            if (ambiguity !== 0) return ambiguity
            if (left.warnings.length !== right.warnings.length) return left.warnings.length - right.warnings.length
            if (right.routing.priority !== left.routing.priority) return right.routing.priority - left.routing.priority
            return left.name.localeCompare(right.name)
          })
          .slice(0, options.maxAgentsPerDomain)
          .map((agent) => agent.name)

        return { domain, agents }
      })
      .filter((entry) => entry.agents.length > 0)

    return {
      state: "present",
      generatedAt: index.generated_at,
      agentsIndexed: index.summary.agents_indexed,
      weakMetadata: index.summary.weak_metadata,
      duplicates: index.summary.duplicates,
      highAmbiguity: index.summary.high_ambiguity,
      unknownPrimaryDomain: index.summary.unknown_primary_domain,
      topDomains,
    }
  } catch {
    return { state: "invalid" }
  }
}

function formatCompactAgentIndexSection(options: HecateqProjectContextInjectorOptions): string[] {
  const summary = readAgentIndexContextSummary(options)
  if (!summary) return []

  if (summary.state !== "present") {
    return [
      "",
      "Agent capabilities:",
      `- index: ${summary.state}`,
      summary.state === "missing"
        ? "- run /hecateq-agent-index to generate capability index"
        : "- run /hecateq-agent-index to regenerate",
    ]
  }

  return [
    "",
    "Agent capabilities:",
    "- index: present",
    `- agents_indexed: ${summary.agentsIndexed}`,
    `- weak_metadata: ${summary.weakMetadata}`,
    `- duplicates: ${summary.duplicates}`,
    ...(summary.highAmbiguity > 0 ? [`- high_ambiguity: ${summary.highAmbiguity}`] : []),
    ...(summary.unknownPrimaryDomain > 0 ? [`- unknown_primary_domain: ${summary.unknownPrimaryDomain}`] : []),
    "",
    "Top domains:",
    ...(summary.topDomains.length > 0
      ? summary.topDomains.map((entry) => `- ${entry.domain}: ${entry.agents.join(", ")}`)
      : ["- none"]),
    "",
    "Routing note:",
    "- Use this index as ranking aid only.",
    "- Final delegation must use runtime-valid `task(subagent_type=\"...\")`.",
  ]
}

function formatExpandedAgentIndexSection(options: HecateqProjectContextInjectorOptions): string[] {
  const summary = readAgentIndexContextSummary(options)
  if (!summary) return []

  if (summary.state !== "present") {
    return formatCompactAgentIndexSection(options)
  }

  return [
    "",
    "Agent capabilities:",
    "- index: present",
    `- generated: ${summary.generatedAt}`,
    `- agents_indexed: ${summary.agentsIndexed}`,
    `- weak_metadata: ${summary.weakMetadata}`,
    `- duplicates: ${summary.duplicates}`,
    `- high_ambiguity: ${summary.highAmbiguity}`,
    `- unknown_primary_domain: ${summary.unknownPrimaryDomain}`,
    "",
    "Top domains:",
    ...(summary.topDomains.length > 0
      ? summary.topDomains.map((entry) => `- ${entry.domain}: ${entry.agents.join(", ")}`)
      : ["- none"]),
    "",
    "Routing note:",
    "- Use this index as ranking aid only.",
    "- Final delegation must use runtime-valid `task(subagent_type=\"...\")`.",
  ]
}

function formatGitCheckpointDirtyFilesExpanded(context: GitCheckpointContextBlock): string[] {
  const { options, state } = context
  if (state.kind !== "DIRTY_REPO") {
    return []
  }

  if (!options.includeDirtyFileList) {
    return [`- dirty_files: omitted by config (${state.dirtyFileCount ?? 0} files)`]
  }

  if (!state.dirtyFiles || state.dirtyFiles.length === 0) {
    return [`- dirty_files: none (${state.dirtyFileCount ?? 0} files detected)`]
  }

  const remaining = Math.max(0, (state.dirtyFileCount ?? state.dirtyFiles.length) - state.dirtyFiles.length)
  const lines = ["- dirty_files:", ...state.dirtyFiles.map((filePath) => `  - ${filePath}`)]
  if (state.truncated && remaining > 0) {
    lines.push(`  - ... and ${remaining} more`)
  }

  return lines
}

function formatGitCheckpointDirtyCount(context: GitCheckpointContextBlock): string[] {
  if (!context.options.includeDirtyFileCount) return []
  if (context.state.kind !== "DIRTY_REPO") return []
  return [`- dirty_file_count: ${context.state.dirtyFileCount ?? 0}`]
}

function formatCompactGitCheckpointSection(context: GitCheckpointContextBlock | undefined): string[] {
  if (!context) return []

  const dirtyLines = context.state.kind === "DIRTY_REPO"
    ? [
        ...formatGitCheckpointDirtyCount(context),
        "- dirty_files: omitted in compact mode",
      ]
    : []

  return [
    "",
    "Git checkpoint:",
    `- state: ${context.state.kind}`,
    `- mode: ${context.options.mode}`,
    `- checkpoint_created: ${context.state.checkpointCreated ? "yes" : "no"}`,
    ...(context.state.checkpointCommit ? [`- checkpoint_commit: ${context.state.checkpointCommit}`] : []),
    ...dirtyLines,
    `- note: ${context.state.message ?? "No additional note."}`,
  ]
}

function formatExpandedGitCheckpointSection(context: GitCheckpointContextBlock | undefined): string[] {
  if (!context) return []

  return [
    "",
    "Git checkpoint:",
    `- state: ${context.state.kind}`,
    `- mode: ${context.options.mode}`,
    `- checkpoint_created: ${context.state.checkpointCreated ? "yes" : "no"}`,
    ...(context.state.checkpointCommit ? [`- checkpoint_commit: ${context.state.checkpointCommit}`] : []),
    ...formatGitCheckpointDirtyCount(context),
    ...formatGitCheckpointDirtyFilesExpanded(context),
    `- note: ${context.state.message ?? "No additional note."}`,
  ]
}

function renderCompactProjectContextBlock(
  snapshot: ProjectContextSnapshot,
  options: HecateqProjectContextInjectorOptions,
  gitCheckpointContext?: GitCheckpointContextBlock,
): string {
  const memoryLines = snapshot.memoryFiles.map(
    (file) => `- ${file.name}: ${file.state}, ${file.size} bytes`,
  )

  const block = [
    "<hecateq-project-context>",
    `Project root: ${snapshot.projectRoot}`,
    ...formatCompactGitCheckpointSection(gitCheckpointContext),
    "",
    "Memory files:",
    ...memoryLines,
    "",
    "Memory:",
    `- initialized: ${snapshot.initializedMemoryFileCount > 0 ? "yes" : "no"}`,
    `- files: ${snapshot.initializedMemoryFileCount}/${snapshot.memoryFiles.length} present`,
    "- note: Read specific memory files only when needed.",
    "",
    "Artifacts:",
    ...(options.includeContracts
      ? [formatCompactArtifactSummary("contracts", snapshot.contractsReady, snapshot.contractFileCount)]
      : []),
    ...(options.includeTaskGraphs
      ? [formatCompactArtifactSummary("task-graphs", snapshot.taskGraphsReady, snapshot.taskGraphFileCount)]
      : []),
    "- note: Read detailed artifact files only when needed.",
    ...formatCompactAgentIndexSection(options),
    "",
    "Context rules:",
    "- Project-root memory is authoritative.",
    "- Use file-map.md before broad scans.",
    "- Read detailed memory/artifacts only when needed.",
    "</hecateq-project-context>",
  ].join("\n")

  return truncateText(block, options.maxTotalChars)
}

function renderExpandedProjectContextBlock(
  snapshot: ProjectContextSnapshot,
  options: HecateqProjectContextInjectorOptions,
  gitCheckpointContext?: GitCheckpointContextBlock,
): string {
  const memoryLines = snapshot.memoryFiles.map(
    (file) => `- ${file.name}: ${file.state}, ${file.size} bytes`,
  )

  const summary = snapshot.memorySummary.length > 0 ? snapshot.memorySummary : "[no readable memory summary]"

  const block = [
    "<hecateq-project-context>",
    `Project root: ${snapshot.projectRoot}`,
    ...formatExpandedGitCheckpointSection(gitCheckpointContext),
    "",
    "Memory files:",
    ...memoryLines,
    "",
    "Memory summary:",
    summary,
    "",
    `Artifacts:`,
    ...(options.includeContracts
      ? [`Contracts directory: ${PROJECT_CONTRACTS_DIR}/`, formatArtifactLines(snapshot.contractFiles), ""]
      : []),
    ...(options.includeTaskGraphs
      ? [`Task graphs directory: ${PROJECT_TASK_GRAPHS_DIR}/`, formatArtifactLines(snapshot.taskGraphFiles)]
      : []),
    ...formatExpandedAgentIndexSection(options),
    "",
    "Context rules:",
    "- Project-root memory is authoritative.",
    "- Use file-map.md before broad code scanning.",
    "- Do not read the whole codebase by default.",
    "- Use contract/task graph artifacts when present.",
    "</hecateq-project-context>",
  ].join("\n")

  return truncateText(block, options.maxTotalChars)
}

function renderProjectContextBlock(
  snapshot: ProjectContextSnapshot,
  options: HecateqProjectContextInjectorOptions,
  gitCheckpointContext?: GitCheckpointContextBlock,
): string {
  if (options.mode === "compact") {
    return renderCompactProjectContextBlock(snapshot, options, gitCheckpointContext)
  }

  return renderExpandedProjectContextBlock(snapshot, options, gitCheckpointContext)
}

export function buildProjectContextBlock(
  startDir: string,
  options: HecateqProjectContextInjectorOptions = resolveProjectContextInjectorOptions(undefined),
  gitCheckpointContext?: GitCheckpointContextBlock,
): string | null {
  if (!options.enabled || options.mode === "off") return null
  const snapshot = createProjectContextSnapshot(startDir, options)
  if (!snapshot) return null

  return renderProjectContextBlock(snapshot, options, gitCheckpointContext)
}

function prependContext(output: ChatMessageOutput, contextBlock: string): boolean {
  const textPart = output.parts.find((part) => part.type === "text" && typeof part.text === "string")
  if (!textPart || !textPart.text) return false
  textPart.text = `${contextBlock}\n\n---\n\n${textPart.text}`
  return true
}

export function createHecateqProjectContextInjectorHook(
  ctx: PluginInput,
  config?: Partial<HecateqContextInjectionConfig>,
  gitCheckpointConfig?: Partial<HecateqGitCheckpointConfig>,
  orchestrationConfig?: Partial<HecateqOrchestrationConfig>,
): HecateqProjectContextInjectorHook {
  const injectedSessions = new Set<string>()
  const options = resolveProjectContextInjectorOptions(config)
  const gitCheckpointOptions = resolveGitCheckpointOptions(gitCheckpointConfig)
  const orchConfig = orchestrationConfig
    ? resolveOrchestrationConfig(orchestrationConfig)
    : null

  return {
    HOOK_NAME,
    buildProjectContextBlock,
    createSnapshot: createProjectContextSnapshot,
    "chat.message": async (input, output) => {
      if (!options.enabled || options.mode === "off") return
      if (injectedSessions.has(input.sessionID)) return
      if (options.hecateqOnly && getAgentConfigKey(input.agent ?? "") !== HECATEQ_AGENT_KEY) return
      if (!options.injectOnSubagents && subagentSessions.has(input.sessionID)) return
      if (!options.injectOnSubagents) {
        const mainSessionID = getMainSessionID()
        if (mainSessionID && input.sessionID !== mainSessionID) return
      }

      const directory = typeof ctx.directory === "string" ? ctx.directory : process.cwd()
      const snapshot = createProjectContextSnapshot(directory, options)

      const contextParts: string[] = []

      // Project context block
      if (snapshot) {
        const gitCheckpointContext = gitCheckpointOptions.enabled && gitCheckpointOptions.mode !== "off"
          ? {
              options: gitCheckpointOptions,
              state: detectGitState(snapshot.projectRoot, gitCheckpointConfig),
            }
          : undefined
        const block = renderProjectContextBlock(
          snapshot,
          options,
          gitCheckpointOptions.includeStatusInContext ? gitCheckpointContext : undefined,
        )
        contextParts.push(block)
      } else {
        log(`[${HOOK_NAME}] No project root found from ${directory}; skipping project context`, { directory })
      }

      // Orchestration context block (Hecateq-only, config-gated)
      if (orchConfig?.enabled && getAgentConfigKey(input.agent ?? "") === HECATEQ_AGENT_KEY) {
        try {
          const firstUserMessage = output.parts.find((p) => p.type === "text")?.text
          if (firstUserMessage && firstUserMessage.length > 10) {
            const orchBlock = buildOrchestrationContextBlock({
              prompt: firstUserMessage.slice(0, 2000),
              config: orchConfig,
            })
            contextParts.push(orchBlock)
          }
        } catch (err) {
          log(`[${HOOK_NAME}] Orchestration context block failed`, { error: String(err) })
        }
      }

      // Handoff state context block (always checked when project root is known)
      if (snapshot) {
        const handoffSummary = buildLiveHandoffContextSummary(snapshot.projectRoot, input.sessionID)
        if (handoffSummary) {
          contextParts.push(`<hecateq-handoff-state>\n${handoffSummary}\n</hecateq-handoff-state>`)
        }
      }

      if (contextParts.length === 0) {
        log(`[${HOOK_NAME}] Nothing to inject for session ${input.sessionID}`, {})
        return
      }

      const combined = contextParts.join("\n\n---\n\n")
      if (!prependContext(output, combined)) {
        log(`[${HOOK_NAME}] No writable text part found for session ${input.sessionID}`)
        return
      }

      injectedSessions.add(input.sessionID)
      log(`[${HOOK_NAME}] Injected Hecateq context (project + orchestration)`, {
        sessionID: input.sessionID,
        projectDirectory: directory,
        length: combined.length,
      })
    },
    event: async ({ event }) => {
      if (event.type !== "session.deleted") return
      const props = event.properties as { info?: { id?: string }; sessionID?: string } | undefined
      const sessionID = props?.sessionID ?? props?.info?.id
      if (sessionID) injectedSessions.delete(sessionID)
    },
  }
}
