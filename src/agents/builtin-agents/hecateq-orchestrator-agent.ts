import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentOverrides } from "../types"
import type { CategoryConfig } from "../../config/schema"
import type { AvailableAgent, AvailableCategory, AvailableSkill } from "../dynamic-agent-prompt-builder"
import type { HecateqCustomAgentSummary } from "../hecateq-orchestrator"
import type { HecateqOrchestratorConfig } from "../../shared/hecateq-orchestrator-policy"
import { AGENT_MODEL_REQUIREMENTS, isAnyFallbackModelAvailable } from "../../shared"
import { createHecateqOrchestratorAgent } from "../hecateq-orchestrator"
import { applyEnvironmentContext } from "./environment-context"
import { applyOverrides } from "./agent-overrides"
import { applyModelResolution, getFirstFallbackModel } from "./model-resolution"

export function maybeCreateHecateqOrchestratorConfig(input: {
  disabledAgents: string[]
  agentOverrides: AgentOverrides
  availableModels: Set<string>
  systemDefaultModel?: string
  isFirstRunNoCache: boolean
  availableAgents: AvailableAgent[]
  availableSkills: AvailableSkill[]
  availableCategories: AvailableCategory[]
  mergedCategories: Record<string, CategoryConfig>
  directory?: string
  customAgentSummaries?: HecateqCustomAgentSummary[]
  useTaskSystem: boolean
  disableOmoEnv?: boolean
  orchestratorConfig?: HecateqOrchestratorConfig
}): AgentConfig | undefined {
  const {
    disabledAgents,
    agentOverrides,
    availableModels,
    systemDefaultModel,
    isFirstRunNoCache,
    availableAgents,
    availableSkills,
    availableCategories,
    mergedCategories,
    directory,
    customAgentSummaries,
    useTaskSystem,
    disableOmoEnv = false,
    orchestratorConfig,
  } = input

  const override = agentOverrides["hecateq-orchestrator"]
  const requirement = AGENT_MODEL_REQUIREMENTS["hecateq-orchestrator"]
  const hasExplicitConfig = override !== undefined
  const meetsRequirement =
    !requirement?.requiresAnyModel
    || hasExplicitConfig
    || isFirstRunNoCache
    || isAnyFallbackModelAvailable(requirement.fallbackChain, availableModels)

  if (disabledAgents.includes("hecateq-orchestrator") || !meetsRequirement) return undefined

  let resolution = applyModelResolution({
    userModel: override?.model,
    requirement,
    availableModels,
    systemDefaultModel,
  })

  if (isFirstRunNoCache && !override?.model) {
    resolution = getFirstFallbackModel(requirement)
  }

  if (!resolution) return undefined
  const { model, variant } = resolution

  let config = createHecateqOrchestratorAgent(
    model,
    availableAgents,
    undefined,
    availableSkills,
    availableCategories,
    customAgentSummaries,
    useTaskSystem,
    orchestratorConfig,
  )

  if (variant) {
    config = { ...config, variant }
  }

  config = applyOverrides(config, override, mergedCategories, directory)
  config = applyEnvironmentContext(config, directory, { disableOmoEnv })

  return config
}
