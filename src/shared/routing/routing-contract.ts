export const ROUTING_RUNTIME_PRECEDENCE = [
  "Built-in agent registry",
  "Custom agent discovery",
  "Config-defined agents",
  "Disabled filtering",
  "Exact subagent resolution",
  "Category fallback",
  "Agent index suggestion/enrichment",
] as const

export const ROUTING_TRUTH_NOTE = "Agent Index is not the runtime source of truth. It may enrich suggestions and explanations, but live agent execution is determined by runtime registration, discovery, config, disabled filtering, and resolver behavior."

export type RoutingDecision =
  | {
      status: "exact_agent_found"
      target: string
      source: "builtin" | "custom" | "config"
      indexUsed: boolean
      reason: string
      normalizedTarget?: string
      indexFresh?: boolean
      indexReason?: string
    }
  | {
      status: "exact_agent_disabled"
      target: string
      reason: string
      normalizedTarget?: string
      indexUsed?: boolean
      indexFresh?: boolean
      indexReason?: string
    }
  | {
      status: "exact_agent_unknown"
      requested: string
      suggestions: string[]
      reason: string
      normalizedTarget?: string
      indexUsed?: boolean
      indexFresh?: boolean
      indexReason?: string
    }
  | {
      status: "category_fallback"
      category: string
      executor: "sisyphus-junior" | string
      reason: string
      normalizedTarget?: string
      indexUsed?: boolean
      indexFresh?: boolean
      indexReason?: string
    }

export type RoutingDecisionStatus = RoutingDecision["status"]
