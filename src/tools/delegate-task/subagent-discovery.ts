import {
  loadOpencodeGlobalAgents,
  loadOpencodeProjectAgents,
  loadProjectAgents,
  loadUserAgents,
  readOpencodeConfigAgents,
} from "../../features/claude-code-agent-loader"
import { OverridableAgentNameSchema } from "../../config/schema/agent-names"
import {
  getAgentConfigKey,
  getAgentDisplayName,
  stripAgentListSortPrefix,
} from "../../shared/agent-display-names"
import {
  type RuntimeAgentIndexConfig,
  type RuntimeAgentIndexMetadata,
  joinAgentIndexMetadata,
  readHecateqAgentIndexFile,
} from "../../shared/hecateq-agent-indexer"

export type AgentMode = "subagent" | "primary" | "all" | undefined

export type AgentIndexMetadata = RuntimeAgentIndexMetadata

export type AgentSuggestionOptions = {
  useForSuggestions?: boolean
  maxSuggestions?: number
}

export type AgentInfo = {
  name: string
  mode?: "subagent" | "primary" | "all"
  hidden?: boolean
  model?: string | { providerID: string; modelID: string }
  agentIndex?: AgentIndexMetadata
}

export type DiscoveredAgentOptions = {
  hecateqAgentIndexConfig?: RuntimeAgentIndexConfig
}

const BUILTIN_AGENT_NAMES = new Set(OverridableAgentNameSchema.options.map((name) => name.toLowerCase()))
const RESERVED_HIDDEN_NATIVE_AGENTS = new Set(["build"])

export function sanitizeSubagentType(subagentType: string): string {
  return subagentType.trim().replace(/^[\\/"']+|[\\/"']+$/g, "").trim()
}

function toAgentInfoList(record: Record<string, { mode?: string; hidden?: boolean; model?: AgentInfo["model"] }>): AgentInfo[] {
  return Object.entries(record).map(([name, config]) => ({
    name,
    mode: config.mode as AgentInfo["mode"],
    hidden: config.hidden,
    model: config.model,
  }))
}

export function mergeWithDiscoveredAgents(
  serverAgents: AgentInfo[],
  directory: string | undefined,
  options: DiscoveredAgentOptions = {},
): AgentInfo[] {
  const userAgentsRecord = loadUserAgents()
  const projectAgentsRecord = loadProjectAgents(directory)
  const opencodeGlobalAgentsRecord = loadOpencodeGlobalAgents()
  const opencodeProjectAgentsRecord = loadOpencodeProjectAgents(directory)
  const opencodeConfigAgentsRecord = directory ? readOpencodeConfigAgents(directory) : {}

  const mergedAgentMap = new Map<string, AgentInfo>()
  const addIfAbsent = (agent: AgentInfo): void => {
    const key = stripAgentListSortPrefix(agent.name).trim().toLowerCase()
    if (!mergedAgentMap.has(key)) {
      mergedAgentMap.set(key, agent)
    }
  }

  for (const agent of serverAgents) addIfAbsent(agent)
  for (const agent of toAgentInfoList(opencodeConfigAgentsRecord)) addIfAbsent(agent)
  for (const agent of toAgentInfoList(opencodeProjectAgentsRecord)) addIfAbsent(agent)
  for (const agent of toAgentInfoList(projectAgentsRecord)) addIfAbsent(agent)
  for (const agent of toAgentInfoList(opencodeGlobalAgentsRecord)) addIfAbsent(agent)
  for (const agent of toAgentInfoList(userAgentsRecord)) addIfAbsent(agent)

  const mergedAgents = Array.from(mergedAgentMap.values())
  const joined = joinAgentIndexMetadata(
    mergedAgents,
    readHecateqAgentIndexFile(),
    options.hecateqAgentIndexConfig,
  )

  return joined.agents
}

export const mergeWithClaudeCodeAgents = mergeWithDiscoveredAgents

function buildComparableNames(agentName: string): Set<string> {
  return new Set([
    agentName,
    getAgentDisplayName(agentName),
    getAgentConfigKey(agentName),
  ].map(name => stripAgentListSortPrefix(name).trim().toLowerCase()))
}

function matchesRequestedAgent(agent: AgentInfo, requestedAgentName: string): boolean {
  const comparableNames = buildComparableNames(requestedAgentName)
  const listedAgentName = stripAgentListSortPrefix(agent.name).trim().toLowerCase()
  const listedAgentConfigKey = getAgentConfigKey(agent.name).trim().toLowerCase()

  return comparableNames.has(listedAgentName) || comparableNames.has(listedAgentConfigKey)
}

export function isTaskCallableAgentMode(mode: AgentMode): boolean {
  return mode === "all" || mode === "subagent"
}

export function isDemotedPlanAgent(agent: AgentInfo): boolean {
  return agent.hidden === true
    && agent.mode === "subagent"
    && stripAgentListSortPrefix(agent.name).trim().toLowerCase() === "plan"
}

function isVisibleToTask(agent: AgentInfo): boolean {
  return (agent.hidden !== true || isDemotedPlanAgent(agent))
    && !RESERVED_HIDDEN_NATIVE_AGENTS.has(getAgentConfigKey(agent.name).trim().toLowerCase())
}

export function findPrimaryAgentMatch(
  agents: AgentInfo[],
  requestedAgentName: string,
): AgentInfo | undefined {
  return agents.find(agent => agent.mode === "primary" && matchesRequestedAgent(agent, requestedAgentName))
}

export function findCallableAgentMatch(
  agents: AgentInfo[],
  requestedAgentName: string,
): AgentInfo | undefined {
  return agents.find(agent => isTaskCallableAgentMode(agent.mode) && isVisibleToTask(agent) && matchesRequestedAgent(agent, requestedAgentName))
}

export function listCallableAgentNames(agents: AgentInfo[]): string {
  return agents
    .filter(agent => isTaskCallableAgentMode(agent.mode) && isVisibleToTask(agent))
    .map(agent => stripAgentListSortPrefix(agent.name))
    .sort()
    .join(", ")
}

export function listCallableAgentNamesTruncated(agents: AgentInfo[], limit = 25): string {
  const names = agents
    .filter(agent => isTaskCallableAgentMode(agent.mode) && isVisibleToTask(agent))
    .map(agent => stripAgentListSortPrefix(agent.name))
    .sort()

  if (names.length <= limit) {
    return names.join(", ")
  }

  const visible = names.slice(0, limit).join(", ")
  return `${visible}, ... and ${names.length - limit} more`
}

function tokenizeAgentName(value: string): string[] {
  return stripAgentListSortPrefix(value)
    .trim()
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter(Boolean)
}

function computeRequestedNameSimilarity(requestedAgentName: string, agent: AgentInfo): number {
  const requestedKey = getAgentConfigKey(requestedAgentName)
  const agentKey = getAgentConfigKey(agent.name)
  if (requestedKey === agentKey) return 1000

  const requestedNormalized = stripAgentListSortPrefix(requestedAgentName).trim().toLowerCase()
  const agentNormalized = stripAgentListSortPrefix(agent.name).trim().toLowerCase()
  const requestedTokens = tokenizeAgentName(requestedAgentName)
  const agentTokens = tokenizeAgentName(agent.name)
  const requestedTokenSet = new Set(requestedTokens)
  const overlap = agentTokens.filter((token) => requestedTokenSet.has(token)).length

  let score = overlap * 20
  if (requestedNormalized.includes(agentNormalized) || agentNormalized.includes(requestedNormalized)) {
    score += 30
  }
  if (agentKey.includes(requestedKey) || requestedKey.includes(agentKey)) {
    score += 25
  }

  return score
}

function getAmbiguityPenalty(ambiguity: AgentIndexMetadata["ambiguity"]): number {
  switch (ambiguity) {
    case "low": return 0
    case "medium": return 8
    case "high": return 18
    default: return 0
  }
}

function rankSuggestedAgents(requestedAgentName: string, agent: AgentInfo): number {
  const similarity = computeRequestedNameSimilarity(requestedAgentName, agent)
  const confidence = agent.agentIndex?.confidence ?? 0
  const priority = agent.agentIndex?.primaryDomain ? 6 : 0
  const ambiguityPenalty = getAmbiguityPenalty(agent.agentIndex?.ambiguity)

  return similarity + (confidence * 40) + priority - ambiguityPenalty
}

function formatAgentSuggestion(agent: AgentInfo): string {
  const name = stripAgentListSortPrefix(agent.name)
  if (!agent.agentIndex) {
    return `- ${name}`
  }

  const details = [
    agent.agentIndex.primaryDomain ? `primary_domain=${agent.agentIndex.primaryDomain}` : undefined,
    agent.agentIndex.confidence !== undefined ? `confidence=${agent.agentIndex.confidence.toFixed(2)}` : undefined,
    agent.agentIndex.ambiguity ? `ambiguity=${agent.agentIndex.ambiguity}` : undefined,
    agent.agentIndex.stale ? "stale_index=true" : undefined,
  ].filter((value): value is string => value !== undefined)

  return details.length > 0
    ? `- ${name} (${details.join(", ")})`
    : `- ${name}`
}

function hasSuggestionMetadata(agents: AgentInfo[]): boolean {
  return agents.some((agent) => agent.agentIndex !== undefined)
}

export function formatUnknownAgentSuggestions(
  requestedAgentName: string,
  agents: AgentInfo[],
  options: AgentSuggestionOptions = {},
): string {
  const callableAgents = agents.filter((agent) => isTaskCallableAgentMode(agent.mode) && isVisibleToTask(agent))
  const useForSuggestions = options.useForSuggestions ?? true
  const maxSuggestions = Math.max(1, Math.trunc(options.maxSuggestions ?? 10))

  if (!useForSuggestions || !hasSuggestionMetadata(callableAgents)) {
    return listCallableAgentNamesTruncated(agents, maxSuggestions)
  }

  const suggestions = [...callableAgents]
    .sort((left, right) => {
      const scoreDiff = rankSuggestedAgents(requestedAgentName, right) - rankSuggestedAgents(requestedAgentName, left)
      if (scoreDiff !== 0) return scoreDiff
      return stripAgentListSortPrefix(left.name).localeCompare(stripAgentListSortPrefix(right.name))
    })
    .slice(0, maxSuggestions)
    .map((agent) => formatAgentSuggestion(agent))

  return suggestions.join("\n")
}

export function isKnownAgentName(agents: AgentInfo[], requestedAgentName: string): boolean {
  if (BUILTIN_AGENT_NAMES.has(stripAgentListSortPrefix(requestedAgentName).trim().toLowerCase())) {
    return true
  }

  return agents.some((agent) => matchesRequestedAgent(agent, requestedAgentName))
}
