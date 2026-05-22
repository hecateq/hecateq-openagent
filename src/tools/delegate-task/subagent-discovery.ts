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

export type AgentMode = "subagent" | "primary" | "all" | undefined

export type AgentInfo = {
  name: string
  mode?: "subagent" | "primary" | "all"
  hidden?: boolean
  model?: string | { providerID: string; modelID: string }
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

  return Array.from(mergedAgentMap.values())
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

export function isKnownAgentName(agents: AgentInfo[], requestedAgentName: string): boolean {
  if (BUILTIN_AGENT_NAMES.has(stripAgentListSortPrefix(requestedAgentName).trim().toLowerCase())) {
    return true
  }

  return agents.some((agent) => matchesRequestedAgent(agent, requestedAgentName))
}
