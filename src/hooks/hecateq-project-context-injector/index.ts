import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"

import { getAgentConfigKey } from "../../shared/agent-display-names"
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
  contractFiles: ArtifactListEntry[]
  taskGraphFiles: ArtifactListEntry[]
}

export type HecateqProjectContextInjectorHook = {
  HOOK_NAME: typeof HOOK_NAME
  buildProjectContextBlock: typeof buildProjectContextBlock
  createSnapshot: typeof createProjectContextSnapshot
  "chat.message": (input: ChatMessageInput, output: ChatMessageOutput) => Promise<void>
  event: (input: EventInput) => Promise<void>
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

function readMemorySummary(projectRoot: string): { memoryFiles: MemoryFileStatus[]; summary: string } {
  const memoryFiles: MemoryFileStatus[] = []
  const summaryParts: string[] = []
  let used = 0

  for (const fileName of PROJECT_MEMORY_FILES) {
    const filePath = join(projectRoot, PROJECT_MEMORY_DIR, fileName)
    if (!existsSync(filePath)) {
      memoryFiles.push({ name: fileName, state: "missing", size: 0 })
      continue
    }

    const stats = statSync(filePath)
    if (stats.size === 0) {
      memoryFiles.push({ name: fileName, state: "present but empty", size: 0 })
      continue
    }

    memoryFiles.push({ name: fileName, state: "present", size: stats.size })
    if (used >= MAX_TOTAL_CONTEXT_CHARS) continue

    const raw = readFileSync(filePath, "utf-8")
    const normalized = normalizeMemoryContent(raw, Math.min(MAX_MEMORY_FILE_CHARS, MAX_TOTAL_CONTEXT_CHARS - used))
    const block = `### ${fileName}\n${normalized}`
    const nextLength = block.length + (summaryParts.length > 0 ? CONTEXT_SEPARATOR.length : 0)

    if (used + nextLength > MAX_TOTAL_CONTEXT_CHARS) {
      const remaining = MAX_TOTAL_CONTEXT_CHARS - used
      if (remaining > 32) {
        summaryParts.push(truncateText(block, remaining))
      }
      used = MAX_TOTAL_CONTEXT_CHARS
      continue
    }

    summaryParts.push(block)
    used += nextLength
  }

  return { memoryFiles, summary: summaryParts.join(CONTEXT_SEPARATOR) }
}

function listArtifactFiles(projectRoot: string, relativeDir: string): ArtifactListEntry[] {
  const dirPath = join(projectRoot, relativeDir)
  if (!existsSync(dirPath)) return []

  return readdirSync(dirPath, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .sort((left, right) => left.name.localeCompare(right.name))
    .slice(0, MAX_ARTIFACT_FILES)
    .map((entry) => {
      const relativePath = `${relativeDir}/${entry.name}`
      const size = statSync(join(dirPath, entry.name)).size
      return { relativePath, size }
    })
}

export function createProjectContextSnapshot(startDir: string): ProjectContextSnapshot | null {
  const projectRoot = findProjectRoot(startDir)
  if (!projectRoot) return null

  const { memoryFiles, summary } = readMemorySummary(projectRoot)

  return {
    projectRoot,
    memoryFiles,
    memorySummary: summary,
    contractFiles: listArtifactFiles(projectRoot, PROJECT_CONTRACTS_DIR),
    taskGraphFiles: listArtifactFiles(projectRoot, PROJECT_TASK_GRAPHS_DIR),
  }
}

function formatArtifactLines(entries: ArtifactListEntry[]): string {
  if (entries.length === 0) return "- files: none"
  return ["- files:", ...entries.map((entry) => `  - ${entry.relativePath} (${entry.size} bytes)`)].join("\n")
}

export function buildProjectContextBlock(startDir: string): string | null {
  const snapshot = createProjectContextSnapshot(startDir)
  if (!snapshot) return null

  const memoryLines = snapshot.memoryFiles.map(
    (file) => `- ${file.name}: ${file.state}, ${file.size} bytes`,
  )

  const summary = snapshot.memorySummary.length > 0 ? snapshot.memorySummary : "[no readable memory summary]"

  const block = [
    "<hecateq-project-context>",
    `Project root: ${snapshot.projectRoot}`,
    "",
    "Memory files:",
    ...memoryLines,
    "",
    "Memory summary:",
    summary,
    "",
    `Artifacts:`,
    `Contracts directory: ${PROJECT_CONTRACTS_DIR}/`,
    formatArtifactLines(snapshot.contractFiles),
    "",
    `Task graphs directory: ${PROJECT_TASK_GRAPHS_DIR}/`,
    formatArtifactLines(snapshot.taskGraphFiles),
    "",
    "Context rules:",
    "- Project-root memory is authoritative.",
    "- Use file-map.md before broad code scanning.",
    "- Do not read the whole codebase by default.",
    "- Use contract/task graph artifacts when present.",
    "</hecateq-project-context>",
  ].join("\n")

  return truncateText(block, MAX_TOTAL_CONTEXT_CHARS)
}

function prependContext(output: ChatMessageOutput, contextBlock: string): boolean {
  const textPart = output.parts.find((part) => part.type === "text" && typeof part.text === "string")
  if (!textPart || !textPart.text) return false
  textPart.text = `${contextBlock}\n\n---\n\n${textPart.text}`
  return true
}

export function createHecateqProjectContextInjectorHook(ctx: PluginInput): HecateqProjectContextInjectorHook {
  const injectedSessions = new Set<string>()

  return {
    HOOK_NAME,
    buildProjectContextBlock,
    createSnapshot: createProjectContextSnapshot,
    "chat.message": async (input, output) => {
      if (injectedSessions.has(input.sessionID)) return
      if (getAgentConfigKey(input.agent ?? "") !== HECATEQ_AGENT_KEY) return

      const directory = typeof ctx.directory === "string" ? ctx.directory : process.cwd()
      const block = buildProjectContextBlock(directory)
      if (!block) {
        log(`[${HOOK_NAME}] No project root found from ${directory}; skipping injection`, { directory })
        return
      }

      if (!prependContext(output, block)) {
        log(`[${HOOK_NAME}] No writable text part found for session ${input.sessionID}`)
        return
      }

      injectedSessions.add(input.sessionID)
      log(`[${HOOK_NAME}] Injected Hecateq project context`, {
        sessionID: input.sessionID,
        projectDirectory: directory,
        length: block.length,
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
