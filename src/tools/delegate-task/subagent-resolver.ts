/**
 * Subagent Resolver — Runtime delegation resolution pipeline.
 *
 * == Agent Index: Advisory, Not Runtime Truth ==
 *
 * The Hecateq agent index is advisory/enrichment data. It must not be treated
 * as the sole runtime source of truth for exact delegation.
 *
 * Runtime delegation truth comes from (in precedence order):
 * 1. Live registered agents (client.app.agents() response — server runtime)
 * 2. Discovered custom agents (file-based: user, project, opencode global, opencode project, config)
 * 3. Config filters (disabled_agents, agent overrides)
 * 4. Delegate-task resolution (subagent-discovery.ts — findPrimaryAgentMatch, findCallableAgentMatch)
 * 5. Tool registry wiring (tool-config-handler.ts tool denial/allow lists)
 *
 * The agent index (buildAgentIndexAdvisory) is consumed only for suggestion ranking
 * and confidence metadata enrichment. It never overrides live runtime resolution.
 * resolveAgentTarget() in resolve-agent-target.ts explicitly tracks indexUsed to
 * record when the index influenced suggestions — but resolution status
 * (exact_agent_found / exact_agent_disabled / exact_agent_unknown)
 * is ALWAYS determined from live runtime candidates.
 *
 * Key invariants enforced by this module:
 * - Unknown exact agent name → hard error (never silently falls back to category)
 * - Disabled exact agent → explicit disabled error
 * - Category fallback has been removed. All delegation must use exact subagent_type.
 * - call_omo_agent is NOT general delegation — restricted to explore/librarian only
 */
import type { DelegateTaskArgs } from "./types"
import type { ExecutorContext } from "./executor-types"
import type { DelegatedModelConfig } from "./types"
import { isPlanAgent, isPlanFamily, isCoordinatorAgent, COORDINATOR_AGENT_NAMES } from "./constants"
import { SISYPHUS_JUNIOR_AGENT } from "./sisyphus-junior-agent"
import { applyCategoryParams } from "./delegated-model-config"
import { getAvailableModelsForDelegateTask } from "./available-models"
import { resolveEffectiveFallbackEntry } from "./fallback-entry-resolution"
import { applyFallbackEntrySettings } from "./fallback-entry-settings"
import type { AgentInfo } from "./subagent-discovery"
import {
  findPrimaryAgentMatch,
  findCallableAgentMatch,
  formatUnknownAgentSuggestions,
  isTaskCallableAgentMode,
  sanitizeSubagentType,
  mergeWithDiscoveredAgents,
  isDemotedPlanAgent,
} from "./subagent-discovery"
import type { FallbackEntry } from "../../shared/model-requirements"
import { AGENT_MODEL_REQUIREMENTS } from "../../shared/model-requirements"
import { resolveModelForDelegateTask } from "./model-selection"
import { fuzzyMatchModel } from "../../shared/model-availability"
import { getAgentConfigKey, stripAgentListSortPrefix } from "../../shared/agent-display-names"
import { buildFallbackChainFromModels } from "../../shared/fallback-chain-from-models"
import { normalizeSDKResponse } from "../../shared"
import { normalizeModelFormat } from "../../shared/model-format-normalizer"
import { flattenToFallbackModelStrings, normalizeFallbackModels } from "../../shared/model-resolver"
import { resolveAgentTarget, joinRoutingSuggestions, type AgentCandidate } from "../../shared/routing"
import { log } from "../../shared/logger"
import { logRoutingDecision } from "../../shared/routing/routing-log"

const DEFAULT_PLAN_FALLBACK_AGENT = "plan"
const RESERVED_HIDDEN_NATIVE_AGENTS = new Set(["build"])
const BUILTIN_AGENT_CONFIG_KEYS = new Set(Object.keys(AGENT_MODEL_REQUIREMENTS))

function buildUnknownSubagentTypeError(
  agentName: string,
  suggestionsText: string,
): string {
  const suggestionText = suggestionsText.trim() !== "" ? suggestionsText.trim() : "none available"

  if (suggestionText.includes("\n")) {
    return `Unknown subagent_type "${agentName}". Use one of the available exact agents:\n${suggestionText}\n\nDo not invent agent names.`
  }

  return `Unknown subagent_type "${agentName}". Use one of the available exact agents: ${suggestionText}. Do not invent agent names.`
}

function isReservedHiddenNativeAgent(agentName: string): boolean {
  return RESERVED_HIDDEN_NATIVE_AGENTS.has(getAgentConfigKey(agentName))
}

function buildRoutingCandidates(agents: AgentInfo[]): AgentCandidate[] {
  return agents.map((agent) => {
    const normalizedName = getAgentConfigKey(agent.name)
    const displayName = stripAgentListSortPrefix(agent.name)
    return {
      id: normalizedName,
      name: agent.name,
      displayName,
      source: BUILTIN_AGENT_CONFIG_KEYS.has(normalizedName) ? "builtin" : "custom",
      enabled: true,
      hidden: agent.hidden || isReservedHiddenNativeAgent(normalizedName),
      taskCallable: !isReservedHiddenNativeAgent(normalizedName)
        && isTaskCallableAgentMode(agent.mode)
        && (agent.hidden !== true || isDemotedPlanAgent(agent)),
      aliases: [displayName, agent.name],
      agentIndex: agent.agentIndex,
    }
  })
}

/**
 * Build advisory agent index metadata for suggestion enrichment.
 *
 * The agent index is strictly advisory — it enriches the suggestions list
 * with confidence scores, primary domains, and useWhen hints. It does NOT
 * determine resolution status (exact_agent_found/disabled/unknown).
 *
 * The returned object is passed to resolveAgentTarget() as the `agentIndex`
 * input, where getIndexSuggestionBoosts() extracts score boosts for ranking.
 * Resolution against live runtime candidates always takes precedence.
 *
 * @param useForSuggestions - When false, returns null (index not consulted at all).
 */
function buildAgentIndexAdvisory(candidates: AgentCandidate[], useForSuggestions: boolean): {
  available: boolean
  fresh?: boolean
  suggestions?: Array<{ id: string; score?: number; reason?: string; domain?: string }>
} | null {
  if (!useForSuggestions) {
    return null
  }

  const withMetadata = candidates.filter((candidate) => candidate.agentIndex !== undefined)
  if (withMetadata.length === 0) {
    return null
  }

  return {
    available: true,
    fresh: withMetadata.every((candidate) => candidate.agentIndex?.stale !== true),
    suggestions: withMetadata.map((candidate) => ({
      id: candidate.id,
      score: candidate.agentIndex?.confidence,
      reason: candidate.agentIndex?.useWhen?.[0],
      domain: candidate.agentIndex?.primaryDomain,
    })),
  }
}

function matchesResolvedTarget(agent: AgentInfo | undefined, target: string): boolean {
  if (!agent) return false
  return getAgentConfigKey(agent.name) === target
}

function buildUnknownSuggestionText(
  requestedAgent: string,
  agents: AgentInfo[],
  suggestionIds: string[],
  options?: { useForSuggestions?: boolean; maxSuggestions?: number },
): string {
  const suggestionAgents = agents.filter((agent) => suggestionIds.includes(getAgentConfigKey(agent.name)))
  if (suggestionAgents.length === 0) {
    return joinRoutingSuggestions(suggestionIds)
  }

  return formatUnknownAgentSuggestions(requestedAgent, suggestionAgents, options)
}

function shouldUseHiddenPlanAgent(
  requestedAgent: string,
  serverPrimaryAgent: AgentInfo | undefined,
  serverMatchedAgent: AgentInfo | undefined,
  sisyphusAgentConfig: ExecutorContext["sisyphusAgentConfig"],
  hasDemotedPlan: boolean,
): boolean {
  if (serverPrimaryAgent) {
    return false
  }

  if (hasDemotedPlan) {
    return false
  }

  if (serverMatchedAgent) {
    return false
  }

  if (!isPlanAgent(requestedAgent)) {
    return false
  }

  return sisyphusAgentConfig?.planner_enabled !== false
    && sisyphusAgentConfig?.replace_plan !== false
}

export interface ResolveSubagentExecutionOptions {
  allowSisyphusJuniorDirect?: boolean
  allowPrimaryAgentDelegation?: boolean
}

export async function resolveSubagentExecution(
  args: DelegateTaskArgs,
  executorCtx: ExecutorContext,
  parentAgent: string | undefined,
  categoryExamples: string,
  options: ResolveSubagentExecutionOptions = {},
): Promise<{ agentToUse: string; categoryModel: DelegatedModelConfig | undefined; fallbackChain?: FallbackEntry[]; error?: string }> {
  const { client, agentOverrides, userCategories, disabledAgents } = executorCtx
  const unknownAgentSuggestionOptions = {
    useForSuggestions: executorCtx.hecateqAgentIndexConfig?.use_for_suggestions,
    maxSuggestions: executorCtx.hecateqAgentIndexConfig?.max_suggestions,
  }

  if (!args.subagent_type?.trim()) {
    return { agentToUse: "", categoryModel: undefined, error: `Agent name cannot be empty.` }
  }

  const agentName = sanitizeSubagentType(args.subagent_type)
  const normalizedAgentName = getAgentConfigKey(agentName)

  if ((disabledAgents ?? []).some((disabledAgent) => getAgentConfigKey(disabledAgent) === normalizedAgentName) && BUILTIN_AGENT_CONFIG_KEYS.has(normalizedAgentName)) {
    return {
      agentToUse: "",
      categoryModel: undefined,
      error: `Subagent "${normalizedAgentName}" is disabled by disabled_agents.`,
    }
  }

  let agentToUse = agentName
  let categoryModel: DelegatedModelConfig | undefined
  let fallbackChain: FallbackEntry[] | undefined

  try {
    const agentsResult = await client.app.agents()
    const agents = normalizeSDKResponse(agentsResult, [] as AgentInfo[], {
      preferResponseOnMissingData: true,
    })
    const mergedAgents = mergeWithDiscoveredAgents(agents, executorCtx.directory, {
      hecateqAgentIndexConfig: executorCtx.hecateqAgentIndexConfig
        ? {
            enabled: executorCtx.hecateqAgentIndexConfig.enabled,
            enrichRuntimeAgents: executorCtx.hecateqAgentIndexConfig.enrich_runtime_agents,
            useForSuggestions: executorCtx.hecateqAgentIndexConfig.use_for_suggestions,
            requireFresh: executorCtx.hecateqAgentIndexConfig.require_fresh,
            fallbackToRuntimeOnly: executorCtx.hecateqAgentIndexConfig.fallback_to_runtime_only,
            maxSuggestions: executorCtx.hecateqAgentIndexConfig.max_suggestions,
          }
        : undefined,
    })

    if (isPlanFamily(agentName) && isPlanFamily(parentAgent)) {
      return {
        agentToUse: "",
        categoryModel: undefined,
      error: `You are a plan-family agent (plan/prometheus). You cannot delegate to other plan-family agents via task.

Create the work plan directly - that's your job as the planning agent.`,
      }
    }

    if (isCoordinatorAgent(agentName)) {
      return {
        agentToUse: "",
        categoryModel: undefined,
        error: `Cannot delegate to coordinator agent "${agentName}" via task(). Coordinator agents (${COORDINATOR_AGENT_NAMES.join(", ")}) own the orchestration loop and must not be used as subagent targets — doing so creates duplicate coordinators and conflicting team state. Select a worker agent (e.g., sisyphus-junior via category, hephaestus, oracle) instead.`,
      }
    }

    const hasDemotedPlan = agents.some(isDemotedPlanAgent)
    const serverPrimaryAgent = findPrimaryAgentMatch(agents, agentToUse)
    const serverMatchedAgent = findCallableAgentMatch(agents, agentToUse)

    const matchedPrimaryAgent = findPrimaryAgentMatch(mergedAgents, agentToUse)
    const useHiddenPlanFallback = shouldUseHiddenPlanAgent(
      agentToUse,
      serverPrimaryAgent,
      serverMatchedAgent,
      executorCtx.sisyphusAgentConfig,
      hasDemotedPlan,
    )

    const routingCandidates = buildRoutingCandidates(mergedAgents)

    if (isReservedHiddenNativeAgent(agentToUse) && !serverPrimaryAgent && !serverMatchedAgent) {
      return {
        agentToUse: "",
        categoryModel: undefined,
        error: buildUnknownSubagentTypeError(
          agentToUse,
          buildUnknownSuggestionText(
            agentToUse,
            mergedAgents,
            routingCandidates
              .filter((candidate) => candidate.taskCallable === true)
              .map((candidate) => candidate.id),
            unknownAgentSuggestionOptions,
          ),
        ),
      }
    }

    const routingDecision = useHiddenPlanFallback
      ? null
      : resolveAgentTarget({
          requestedSubagentType: agentToUse,
          builtinAgents: routingCandidates.filter((candidate) => candidate.source === "builtin"),
          customAgents: routingCandidates.filter((candidate) => candidate.source === "custom"),
          configAgents: routingCandidates.filter((candidate) => candidate.source === "config"),
          disabledAgents,
          maxSuggestions: executorCtx.hecateqAgentIndexConfig?.max_suggestions,
          agentIndex: buildAgentIndexAdvisory(
            routingCandidates,
            executorCtx.hecateqAgentIndexConfig?.use_for_suggestions !== false,
          ),
        })

    logRoutingDecision(agentToUse, routingDecision)

    if (routingDecision?.status === "exact_agent_disabled") {
      return {
        agentToUse: "",
        categoryModel: undefined,
        error: `Subagent "${routingDecision.target}" is disabled by disabled_agents.`,
      }
    }

    if (routingDecision?.status === "exact_agent_unknown") {
      return {
        agentToUse: "",
        categoryModel: undefined,
        error: buildUnknownSubagentTypeError(
          agentToUse,
          buildUnknownSuggestionText(agentToUse, mergedAgents, routingDecision.suggestions, unknownAgentSuggestionOptions),
        ),
      }
    }

    // category_fallback was removed — if requestedCategory was passed, resolveAgentTarget throws.
    // This check is kept defensively for backward compatibility.
    if (routingDecision?.status === ("category_fallback" as string)) {
      return {
        agentToUse: "",
        categoryModel: undefined,
        error: `Unexpected category fallback while resolving explicit subagent_type "${agentToUse}".`,
      }
    }

    if (
      !options.allowSisyphusJuniorDirect
      && routingDecision
      && routingDecision.status === "exact_agent_found"
      && routingDecision.target === getAgentConfigKey(SISYPHUS_JUNIOR_AGENT)
    ) {
      const callableNames = mergedAgents
        .filter((a) => isTaskCallableAgentMode(a.mode) && getAgentConfigKey(a.name) !== getAgentConfigKey(SISYPHUS_JUNIOR_AGENT))
        .map((a) => getAgentConfigKey(a.name))
        .filter((n) => n !== "")
      const uniqueNames = [...new Set(callableNames)]
      const exampleHint = uniqueNames.length > 0
        ? `Use an explicit subagent_type (e.g., ${uniqueNames.slice(0, 6).join(", ")})`
        : "Use an explicit subagent_type from the available callable agents"
      return {
        agentToUse: "",
        categoryModel: undefined,
        error: `Cannot use subagent_type="${SISYPHUS_JUNIOR_AGENT}" directly. ${exampleHint}.

Pick the exact worker agent (e.g., explore, librarian, oracle, hephaestus, hecateq-orchestrator) for your task. Sisyphus-Junior is reserved for orchestration pipelines, not direct delegation.`,
      }
    }

    if (matchedPrimaryAgent && routingDecision && matchesResolvedTarget(matchedPrimaryAgent, routingDecision.target) && !options.allowPrimaryAgentDelegation && !useHiddenPlanFallback) {
      return {
        agentToUse: "",
        categoryModel: undefined,
        error: `Cannot delegate to primary agent "${stripAgentListSortPrefix(matchedPrimaryAgent.name)}" via task. Select that agent directly instead.`,
      }
    }

    const usePrimary = options.allowPrimaryAgentDelegation
      && matchedPrimaryAgent !== undefined
      && routingDecision !== null
      && matchesResolvedTarget(matchedPrimaryAgent, routingDecision.target)

    let matchedAgent = usePrimary
      ? matchedPrimaryAgent
      : (routingDecision ? findCallableAgentMatch(mergedAgents, routingDecision.target) : undefined)

    if (useHiddenPlanFallback) {
      matchedAgent = {
        name: DEFAULT_PLAN_FALLBACK_AGENT,
        mode: "subagent",
      }
    }

    if (!matchedAgent) {
      // Check if agent exists in registry but just isn't callable (e.g., has unsupported mode).
      // This avoids misleading "unknown subagent" errors when the agent IS registered
      // but fails the findCallableAgentMatch gate due to mode.
      const targetForRegistryLookup = routingDecision?.target ?? agentToUse
      const existsInRegistry = mergedAgents.some(
        (agent) => getAgentConfigKey(agent.name) === targetForRegistryLookup,
      )
      const foundAgent = mergedAgents.find(
        (agent) => getAgentConfigKey(agent.name) === targetForRegistryLookup,
      )

      if (existsInRegistry && foundAgent && foundAgent.mode && !isTaskCallableAgentMode(foundAgent.mode)) {
        return {
          agentToUse: "",
          categoryModel: undefined,
          error: `Agent "${stripAgentListSortPrefix(foundAgent.name)}" is registered (mode: "${foundAgent.mode}") but is not marked as delegatable via task(). Update its AGENTS.md or server configuration to use mode: "subagent" (or "all") to enable delegation.`,
        }
      }

      return {
        agentToUse: "",
        categoryModel: undefined,
        error: buildUnknownSubagentTypeError(
          agentToUse,
          formatUnknownAgentSuggestions(agentToUse, mergedAgents, unknownAgentSuggestionOptions),
        ),
      }
    }

    agentToUse = usePrimary
      ? matchedAgent.name
      : stripAgentListSortPrefix(matchedAgent.name)

    const agentConfigKey = getAgentConfigKey(agentToUse)
    const agentOverride = agentOverrides?.[agentConfigKey as keyof typeof agentOverrides]
      ?? (agentOverrides ? Object.entries(agentOverrides).find(([key]) => key.toLowerCase() === agentConfigKey)?.[1] : undefined)
    const agentRequirement = AGENT_MODEL_REQUIREMENTS[agentConfigKey]
    const agentCategoryConfig = agentOverride?.category
      ? userCategories?.[agentOverride.category]
      : undefined
    const agentCategoryModel = agentCategoryConfig?.model
    const normalizedAgentFallbackModels = normalizeFallbackModels(
      agentOverride?.fallback_models
      ?? agentCategoryConfig?.fallback_models
    )

    const availableModels = await getAvailableModelsForDelegateTask(client)

    if (agentOverride?.model || agentCategoryModel || agentRequirement || matchedAgent.model) {

      const normalizedMatchedModel = matchedAgent.model
        ? normalizeModelFormat(matchedAgent.model)
        : undefined
      const matchedAgentModelStr = normalizedMatchedModel
        ? `${normalizedMatchedModel.providerID}/${normalizedMatchedModel.modelID}`
        : undefined

      const resolution = resolveModelForDelegateTask({
        userModel: agentOverride?.model ?? agentCategoryModel,
        userFallbackModels: flattenToFallbackModelStrings(normalizedAgentFallbackModels),
        categoryDefaultModel: matchedAgentModelStr,
        fallbackChain: agentRequirement?.fallbackChain,
        availableModels,
        systemDefaultModel: undefined,
      })

      const resolutionSkipped = resolution && 'skipped' in resolution

      if (resolution && !resolutionSkipped) {
        const normalized = normalizeModelFormat(resolution.model)
        if (normalized) {
          const variantToUse = agentOverride?.variant ?? resolution.variant ?? agentCategoryConfig?.variant
          const resolvedModel = variantToUse ? { ...normalized, variant: variantToUse } : normalized
          categoryModel = applyCategoryParams(resolvedModel, agentCategoryConfig)
        }
      } else if (resolutionSkipped && (agentOverride?.model ?? agentCategoryModel)) {
        const explicitModel = agentOverride?.model ?? agentCategoryModel
        const normalized = explicitModel ? normalizeModelFormat(explicitModel) : undefined
        if (normalized) {
          const variantToUse = agentOverride?.variant ?? agentCategoryConfig?.variant
          const resolvedModel = variantToUse ? { ...normalized, variant: variantToUse } : normalized
          categoryModel = applyCategoryParams(resolvedModel, agentCategoryConfig)
          log("[delegate-task] Cold cache: using explicit user override for subagent", {
            agent: agentToUse,
            model: agentOverride?.model ?? agentCategoryModel,
          })
        }
      }

      const defaultProviderID = categoryModel?.providerID
        ?? normalizedMatchedModel?.providerID
        ?? "opencode"
      const configuredFallbackChain = buildFallbackChainFromModels(
        normalizedAgentFallbackModels,
        defaultProviderID,
      )
      fallbackChain = configuredFallbackChain ?? (resolutionSkipped ? undefined : agentRequirement?.fallbackChain)
      const effectiveEntry = resolveEffectiveFallbackEntry({
        categoryModel,
        configuredFallbackChain,
        resolution,
      })

      if (categoryModel && effectiveEntry) {
        categoryModel = applyFallbackEntrySettings({
          categoryModel,
          effectiveEntry,
          variantOverride: agentOverride?.variant,
        })
      }
    }

    if (!categoryModel && matchedAgent.model) {
      const normalizedMatchedModel = normalizeModelFormat(matchedAgent.model)
      if (normalizedMatchedModel) {
        const fullModel = `${normalizedMatchedModel.providerID}/${normalizedMatchedModel.modelID}`
        if (availableModels.size === 0 || fuzzyMatchModel(fullModel, availableModels, [normalizedMatchedModel.providerID])) {
          categoryModel = normalizedMatchedModel
        } else {
          log("[delegate-task] Skipping unavailable agent default model", {
            agent: agentToUse,
            model: fullModel,
          })
        }
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    log("[delegate-task] Failed to resolve subagent execution", {
      requestedAgent: agentToUse,
      parentAgent,
      error: errorMessage,
    })

    return {
      agentToUse: "",
      categoryModel: undefined,
      error: `Failed to delegate to agent "${agentToUse}": ${errorMessage}`,
    }
  }

  return { agentToUse, categoryModel, fallbackChain }
}
