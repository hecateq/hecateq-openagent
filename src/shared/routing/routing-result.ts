import type { RuntimeAgentIndexMetadata } from "../hecateq-agent-indexer"
import type { RoutingDecision } from "./routing-contract"

export type AgentCandidate = {
  id: string
  name?: string
  displayName?: string
  source: "builtin" | "custom" | "config"
  enabled?: boolean
  hidden?: boolean
  aliases?: string[]
  taskCallable?: boolean
  agentIndex?: RuntimeAgentIndexMetadata
}

export type AgentIndexAdvisory = {
  available: boolean
  fresh?: boolean
  suggestions?: Array<{
    id: string
    score?: number
    reason?: string
    domain?: string
  }>
}

export type ResolveAgentTargetInput = {
  requestedSubagentType?: string
  requestedCategory?: string
  builtinAgents: AgentCandidate[]
  customAgents: AgentCandidate[]
  configAgents: AgentCandidate[]
  disabledAgents?: string[]
  disabledCategories?: string[]
  agentIndex?: AgentIndexAdvisory | null
  maxSuggestions?: number
  categoryExecutor?: string
}

export function isExactRoutingDecision(
  decision: RoutingDecision,
): decision is Extract<RoutingDecision, { status: "exact_agent_found" | "exact_agent_disabled" | "exact_agent_unknown" }> {
  return decision.status !== "category_fallback"
}

export function joinRoutingSuggestions(suggestions: string[]): string {
  return suggestions.join(", ")
}
