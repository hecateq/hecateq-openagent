import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentMode } from "../types"
import type {
  AvailableAgent,
  AvailableTool,
  AvailableSkill,
  AvailableCategory,
} from "../dynamic-agent-prompt-builder"
import { categorizeTools, buildAgentIdentitySection } from "../dynamic-agent-prompt-builder"
import { getGptApplyPatchPermission } from "../gpt-apply-patch-guard"
import { getFrontierToolSchemaPermission } from "../frontier-tool-schema-guard"
import { OverridableAgentNameSchema } from "../../config/schema/agent-names"
import { HECATEQ_PROJECT_ROOT_MEMORY_POLICY, HECATEQ_HANDOFF_PROTOCOL } from "./default"
import { buildHecateqPromptPack } from "./prompt-pack"
import type { MemoryContext } from "./memory-context"
import { readMemoryContext } from "./memory-context"
import type { HecateqOrchestratorConfig } from "../../shared/hecateq-orchestrator-policy"
import { getMaxCustomAgentLines } from "../../shared/hecateq-orchestrator-policy"
import { getOrchestrationMonitor } from "../../features/hecateq-orchestration/monitoring"

const MODE: AgentMode = "all"
// Derived from the canonical OverridableAgentNameSchema to eliminate drift.
// The old hardcoded set (build, plan, sisyphus, hecateq-orchestrator, ...)
// was a second source of truth that could diverge from the Zod schema.
const BUILTIN_AGENT_KEYS = new Set(
  OverridableAgentNameSchema.options.map((name) => name.toLowerCase()),
)

export type HecateqCustomAgentSummary = {
  name: string
  description?: string
  domain?: string
  useWhen?: string
  avoidWhen?: string
  priority?: string
  skills?: string
  hidden?: boolean
  disabled?: boolean
}

export interface HecateqOrchestratorContext {
  model?: string
  availableAgents?: AvailableAgent[]
  availableToolNames?: string[]
  availableSkills?: AvailableSkill[]
  availableCategories?: AvailableCategory[]
  customAgentSummaries?: HecateqCustomAgentSummary[]
  useTaskSystem?: boolean
  orchestratorConfig?: HecateqOrchestratorConfig
  memoryContext?: MemoryContext
  maxCustomAgentLines?: number
}

function normalizeAgentKey(name: string): string {
  return name.trim().toLowerCase()
}

function summarizeDescription(description: string | undefined): string {
  const normalized = (description ?? "")
    .replace(/\s+/g, " ")
    .replace(/[|]/g, "/")
    .trim()

  if (normalized.length === 0) return "No description provided"
  return normalized.length > 120 ? `${normalized.slice(0, 117)}...` : normalized
}

function renderCustomAgentXml(summary: HecateqCustomAgentSummary): string {
  const parts: string[] = []
  parts.push(`<custom_agent name="${summary.name}">`)

  parts.push(`  <description>${summarizeDescription(summary.description)}</description>`)

  if (summary.domain) {
    parts.push(`  <domain>${summary.domain}</domain>`)
  }
  if (summary.useWhen) {
    parts.push(`  <use-when>${summary.useWhen}</use-when>`)
  }
  if (summary.avoidWhen) {
    parts.push(`  <avoid-when>${summary.avoidWhen}</avoid-when>`)
  }
  if (summary.priority) {
    parts.push(`  <priority>${summary.priority}</priority>`)
  }
  if (summary.skills) {
    parts.push(`  <skills>${summary.skills}</skills>`)
  }

  parts.push("</custom_agent>")
  return parts.join("\n")
}

export function buildCustomAgentRegistrySection(
  summaries: HecateqCustomAgentSummary[] | undefined,
  maxLines: number = 12,
): string {
  const visible: HecateqCustomAgentSummary[] = []
  const seen = new Set<string>()

  for (const summary of (Array.isArray(summaries) ? summaries : [])) {
    const normalizedName = normalizeAgentKey(summary.name)
    if (!normalizedName) continue
    if (summary.hidden || summary.disabled) continue
    if (BUILTIN_AGENT_KEYS.has(normalizedName)) continue
    if (seen.has(normalizedName)) continue
    seen.add(normalizedName)
    visible.push(summary)
  }

  if (visible.length === 0) {
    return ""
  }

  const limited = visible.slice(0, maxLines)
  const agentBlocks = limited.map((summary) => renderCustomAgentXml(summary))

  let result = `<custom-agent-registry>\n${agentBlocks.join("\n")}\n</custom-agent-registry>`

  if (visible.length > maxLines) {
    result += `\n<!-- ... and ${visible.length - maxLines} more exact custom agents in the registry -->`
  }

  return result
}

function buildMemoryContextBlock(memoryContext: MemoryContext | undefined): string {
  if (!memoryContext) return ""

  const lines: string[] = ["<memory_context>"]

  if (memoryContext.activeContext) {
    lines.push(`<active-context>${memoryContext.activeContext}</active-context>`)
  }
  if (memoryContext.fileMap) {
    lines.push(`<file-map>${memoryContext.fileMap}</file-map>`)
  }
  if (memoryContext.agentRouting) {
    lines.push(`<agent-routing>${memoryContext.agentRouting}</agent-routing>`)
  }

  lines.push("</memory_context>")
  return lines.join("\n") + "\n"
}

function buildDynamicPrompt(ctx: HecateqOrchestratorContext): string {
  const tools: AvailableTool[] = categorizeTools(ctx.availableToolNames ?? [])
  const customAgentRegistrySection = buildCustomAgentRegistrySection(
    ctx.customAgentSummaries,
    ctx.maxCustomAgentLines ?? 12,
  )
  const taskToolNote = tools.some((tool) => tool.name === "task")
    ? "Use task(subagent_type=\"<exact-agent-name>\", ...) for real exact-agent delegation, not just descriptive routing"
    : "If task is unavailable, explain the blocker and stop instead of pretending delegation happened"

  const agentIdentity = buildAgentIdentitySection(
    "Hecateq God",
    "Primary custom-agent-first planner, router, and dispatcher from OhMyOpenCode",
  )

  const memoryContextBlock = buildMemoryContextBlock(ctx.memoryContext)

  const basePrompt = buildHecateqPromptPack({
    customAgentRegistrySection,
    taskToolNote,
    memoryPolicySection: HECATEQ_PROJECT_ROOT_MEMORY_POLICY,
    handoffProtocolSection: HECATEQ_HANDOFF_PROTOCOL,
    delegationFirst: ctx.orchestratorConfig?.delegation_first,
    orchestratorConfig: ctx.orchestratorConfig,
    profileDetection: {
      model: ctx.model,
      prompt_profile: ctx.orchestratorConfig?.prompt_profile,
      model_adapters: ctx.orchestratorConfig?.model_adapters,
    },
  })

  return `${agentIdentity}\n${memoryContextBlock}\n${basePrompt}`
}

export function createHecateqOrchestratorAgent(
  model: string,
  availableAgents?: AvailableAgent[],
  availableToolNames?: string[],
  availableSkills?: AvailableSkill[],
  availableCategories?: AvailableCategory[],
  customAgentSummaries?: HecateqCustomAgentSummary[],
  useTaskSystem = false,
  orchestratorConfig?: HecateqOrchestratorConfig,
  projectRoot?: string,
): AgentConfig {
  const memoryContext = projectRoot ? readMemoryContext(projectRoot) : undefined

  // Ensure the orchestration monitor singleton is initialized.
  // The pipeline calls recordEvent() on this monitor when delegations,
  // handoffs, routing decisions, and completion/failure events occur.
  getOrchestrationMonitor()

  const prompt = buildDynamicPrompt({
    model,
    availableAgents,
    availableToolNames,
    availableSkills,
    availableCategories,
    customAgentSummaries,
    useTaskSystem,
    orchestratorConfig,
    memoryContext: memoryContext ?? undefined,
    maxCustomAgentLines: getMaxCustomAgentLines(orchestratorConfig),
  })

  return {
    description:
      "Primary custom-agent-first workflow orchestrator",
    mode: MODE,
    model,
    prompt,
    color: "#7C3AED",
    permission: {
      question: "allow",
      ...getFrontierToolSchemaPermission(model),
      ...getGptApplyPatchPermission(model),
    } as AgentConfig["permission"],
    reasoningEffort: "high",
  }
}
createHecateqOrchestratorAgent.mode = MODE
