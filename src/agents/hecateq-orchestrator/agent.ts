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
import { HECATEQ_PROJECT_ROOT_MEMORY_POLICY } from "./default"
import { buildHecateqPromptPack } from "./prompt-pack"
import type { HecateqOrchestratorConfig } from "../../shared/hecateq-orchestrator-policy"

const MODE: AgentMode = "all"
const MAX_CUSTOM_AGENT_LINES = 12
// Derived from the canonical OverridableAgentNameSchema to eliminate drift.
// The old hardcoded set (build, plan, sisyphus, hecateq-orchestrator, ...)
// was a second source of truth that could diverge from the Zod schema.
const BUILTIN_AGENT_KEYS = new Set(
  OverridableAgentNameSchema.options.map((name) => name.toLowerCase()),
)

export type HecateqCustomAgentSummary = {
  name: string
  description?: string
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

function buildCustomAgentRegistrySection(
  summaries: HecateqCustomAgentSummary[] | undefined,
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
    return `<custom-agent-registry>
No visible custom exact agents were discovered in the current registry.
If the work still requires delegation, inspect the runtime registry first and return STATUS: BLOCKED when no valid exact owner exists.
</custom-agent-registry>`
  }

  const lines = visible
    .slice(0, MAX_CUSTOM_AGENT_LINES)
    .map((summary) => `- ${summary.name} — ${summarizeDescription(summary.description)}`)

  if (visible.length > MAX_CUSTOM_AGENT_LINES) {
    lines.push(`- ... and ${visible.length - MAX_CUSTOM_AGENT_LINES} more exact custom agents in the registry`)
  }

  return `<custom-agent-registry>
Available exact custom agents in the current registry:
${lines.join("\n")}
</custom-agent-registry>`
}

function buildDynamicPrompt(ctx: HecateqOrchestratorContext): string {
  const tools: AvailableTool[] = categorizeTools(ctx.availableToolNames ?? [])
  const customAgentRegistrySection = buildCustomAgentRegistrySection(ctx.customAgentSummaries)
  const taskToolNote = tools.some((tool) => tool.name === "task")
    ? "Use task(subagent_type=\"<exact-agent-name>\", ...) for real exact-agent delegation, not just descriptive routing"
    : "If task is unavailable, explain the blocker and stop instead of pretending delegation happened"

  const agentIdentity = buildAgentIdentitySection(
    "Hecateq God",
    "Primary custom-agent-first planner, router, and dispatcher from OhMyOpenCode",
  )

  const basePrompt = buildHecateqPromptPack({
    customAgentRegistrySection,
    taskToolNote,
    memoryPolicySection: HECATEQ_PROJECT_ROOT_MEMORY_POLICY,
    delegationFirst: ctx.orchestratorConfig?.delegation_first,
    orchestratorConfig: ctx.orchestratorConfig,
    profileDetection: {
      model: ctx.model,
      prompt_profile: ctx.orchestratorConfig?.prompt_profile,
      model_adapters: ctx.orchestratorConfig?.model_adapters,
    },
  })

  return `${agentIdentity}\n${basePrompt}`
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
): AgentConfig {
  const prompt = buildDynamicPrompt({
    model,
    availableAgents,
    availableToolNames,
    availableSkills,
    availableCategories,
    customAgentSummaries,
    useTaskSystem,
    orchestratorConfig,
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
