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
import {
  buildDefaultHecateqOrchestratorPrompt,
  HECATEQ_PROJECT_ROOT_MEMORY_POLICY,
} from "./default"

const MODE: AgentMode = "subagent"
const MAX_CUSTOM_AGENT_LINES = 12
const BUILTIN_AGENT_KEYS = new Set([
  "build",
  "plan",
  "sisyphus",
  "hecateq-orchestrator",
  "hephaestus",
  "prometheus",
  "atlas",
  "sisyphus-junior",
  "oracle",
  "librarian",
  "explore",
  "multimodal-looker",
  "metis",
  "momus",
  "opencode-builder",
])

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

function buildBuiltinRelationshipSection(): string {
  return `<builtin-relationship>
Built-in relationship rules:
- Domain specialist custom agents take priority over generic built-ins.
- Hephaestus is not the default implementation layer. Use it only when explicitly selected or when build/integration supervision is clearly needed.
- Prometheus is available for spec or plan generation when a structured plan is needed before delegation.
- Atlas remains an explicit large execution runner or legacy runner, not the automatic first choice.
- Category routing is fallback-only after exact custom-agent lookup fails.
</builtin-relationship>`
}

function buildDependencyRoutingSection(): string {
  return `<dependency-aware-routing>
Dependency-aware routing rules:
- If backend or API contract is unclear, establish the contract before frontend implementation.
- If frontend and backend can proceed in parallel, first create or request a shared contract or mock schema and hand the same artifact to both sides.
- Do not let parallel teams invent separate payload shapes.
- Prefer exact domain ownership over broad orchestration when the domain boundary is clear.
</dependency-aware-routing>`
}

function buildDynamicPrompt(ctx: HecateqOrchestratorContext): string {
  const tools: AvailableTool[] = categorizeTools(ctx.availableToolNames ?? [])
  const customAgentRegistrySection = buildCustomAgentRegistrySection(ctx.customAgentSummaries)
  const taskToolNote = tools.some((tool) => tool.name === "task")
    ? "Use the task tool for real delegation, not just descriptive routing"
    : "If task is unavailable, explain the blocker and stop instead of pretending delegation happened"

  const agentIdentity = buildAgentIdentitySection(
    "Hecateq Orchestrator",
    "Primary custom-agent-first planner, router, and dispatcher from OhMyOpenCode",
  )

  const basePrompt = buildDefaultHecateqOrchestratorPrompt({
    customAgentRegistrySection,
    builtinRelationshipSection: buildBuiltinRelationshipSection(),
    dependencyRoutingSection: buildDependencyRoutingSection(),
    taskToolNote,
    memoryPolicySection: HECATEQ_PROJECT_ROOT_MEMORY_POLICY,
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
): AgentConfig {
  const prompt = buildDynamicPrompt({
    model,
    availableAgents,
    availableToolNames,
    availableSkills,
    availableCategories,
    customAgentSummaries,
    useTaskSystem,
  })

  return {
    description:
      "Custom-agent-first orchestrator. Plans dependency-aware work, chooses exact custom agents, delegates with real task calls, and keeps category routing as a fallback only. (Hecateq Orchestrator - OhMyOpenCode)",
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
