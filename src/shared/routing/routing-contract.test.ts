import { describe, expect, test } from "bun:test"

import { resolveAgentTarget } from "./resolve-agent-target"
import { ROUTING_RUNTIME_PRECEDENCE } from "./routing-contract"
import type { AgentCandidate } from "./routing-result"

function candidate(overrides: Partial<AgentCandidate> & Pick<AgentCandidate, "id" | "source">): AgentCandidate {
  return {
    enabled: true,
    taskCallable: true,
    aliases: [],
    ...overrides,
  }
}

describe("resolveAgentTarget", () => {
  test("exact builtin found", () => {
    const result = resolveAgentTarget({
      requestedSubagentType: "oracle",
      builtinAgents: [candidate({ id: "oracle", source: "builtin" })],
      customAgents: [],
      configAgents: [],
    })

    expect(result).toEqual({
      status: "exact_agent_found",
      target: "oracle",
      normalizedTarget: "oracle",
      source: "builtin",
      indexUsed: false,
      reason: "Exact subagent matched live builtin agent registry.",
      indexFresh: undefined,
    })
  })

  test("exact custom found", () => {
    const result = resolveAgentTarget({
      requestedSubagentType: "nodejs-backend-architect",
      builtinAgents: [],
      customAgents: [candidate({ id: "nodejs-backend-architect", source: "custom" })],
      configAgents: [],
    })

    expect(result.status).toBe("exact_agent_found")
    if (result.status !== "exact_agent_found") return
    expect(result.target).toBe("nodejs-backend-architect")
    expect(result.source).toBe("custom")
  })

  test("exact config-defined found", () => {
    const result = resolveAgentTarget({
      requestedSubagentType: "repo-runtime-helper",
      builtinAgents: [],
      customAgents: [],
      configAgents: [candidate({ id: "repo-runtime-helper", source: "config" })],
    })

    expect(result.status).toBe("exact_agent_found")
    if (result.status !== "exact_agent_found") return
    expect(result.source).toBe("config")
  })

  test("exact disabled builtin returns exact_agent_disabled", () => {
    const result = resolveAgentTarget({
      requestedSubagentType: "oracle",
      builtinAgents: [candidate({ id: "oracle", source: "builtin" })],
      customAgents: [],
      configAgents: [],
      disabledAgents: ["oracle"],
    })

    expect(result.status).toBe("exact_agent_disabled")
  })

  test("exact disabled custom returns exact_agent_disabled", () => {
    const result = resolveAgentTarget({
      requestedSubagentType: "nodejs-backend-architect",
      builtinAgents: [],
      customAgents: [candidate({ id: "nodejs-backend-architect", source: "custom" })],
      configAgents: [],
      disabledAgents: ["nodejs-backend-architect"],
    })

    expect(result.status).toBe("exact_agent_disabled")
  })

  test("exact unknown returns exact_agent_unknown with suggestions", () => {
    const result = resolveAgentTarget({
      requestedSubagentType: "node-backend-arch",
      builtinAgents: [candidate({ id: "oracle", source: "builtin" })],
      customAgents: [
        candidate({ id: "nodejs-backend-architect", source: "custom" }),
        candidate({ id: "typescript-backend-architect", source: "custom" }),
      ],
      configAgents: [],
    })

    expect(result.status).toBe("exact_agent_unknown")
    if (result.status !== "exact_agent_unknown") return
    expect(result.suggestions).toContain("nodejs-backend-architect")
    expect(result.reason).toContain("Category fallback was not used")
  })

  test("exact unknown does not category fallback even when category is provided", () => {
    const result = resolveAgentTarget({
      requestedSubagentType: "missing-agent",
      requestedCategory: "quick",
      builtinAgents: [candidate({ id: "oracle", source: "builtin" })],
      customAgents: [],
      configAgents: [],
    })

    expect(result.status).toBe("exact_agent_unknown")
  })

  test("category fallback works when no subagent_type is provided", () => {
    const result = resolveAgentTarget({
      requestedCategory: "backend",
      builtinAgents: [],
      customAgents: [],
      configAgents: [],
    })

    expect(result).toEqual({
      status: "category_fallback",
      category: "backend",
      executor: "sisyphus-junior",
      normalizedTarget: "backend",
      reason: "No exact subagent was requested; explicit category routing selected the configured category executor.",
    })
  })

  test("stale or missing agent index does not block runtime exact match", () => {
    const result = resolveAgentTarget({
      requestedSubagentType: "oracle",
      builtinAgents: [candidate({ id: "oracle", source: "builtin" })],
      customAgents: [],
      configAgents: [],
      agentIndex: { available: false, fresh: false, suggestions: [{ id: "not-runtime" }] },
    })

    expect(result.status).toBe("exact_agent_found")
  })

  test("agent index enriches suggestions for unknown exact agent", () => {
    const result = resolveAgentTarget({
      requestedSubagentType: "backend-wizard",
      builtinAgents: [],
      customAgents: [
        candidate({ id: "database-specialist", source: "custom" }),
        candidate({ id: "nodejs-backend-architect", source: "custom" }),
      ],
      configAgents: [],
      agentIndex: {
        available: true,
        fresh: true,
        suggestions: [
          { id: "nodejs-backend-architect", score: 99, reason: "backend", domain: "backend" },
        ],
      },
    })

    expect(result.status).toBe("exact_agent_unknown")
    if (result.status !== "exact_agent_unknown") return
    expect(result.indexUsed).toBe(true)
    expect(result.suggestions[0]).toBe("nodejs-backend-architect")
  })

  test("disabled agent is excluded from suggestions", () => {
    const result = resolveAgentTarget({
      requestedSubagentType: "backend-wizard",
      builtinAgents: [],
      customAgents: [
        candidate({ id: "nodejs-backend-architect", source: "custom" }),
        candidate({ id: "nodejs-backend-developer", source: "custom" }),
      ],
      configAgents: [],
      disabledAgents: ["nodejs-backend-architect"],
    })

    expect(result.status).toBe("exact_agent_unknown")
    if (result.status !== "exact_agent_unknown") return
    expect(result.suggestions).not.toContain("nodejs-backend-architect")
    expect(result.suggestions).toContain("nodejs-backend-developer")
  })

  test("call_omo_agent is not treated as a general routing target", () => {
    const result = resolveAgentTarget({
      requestedSubagentType: "call_omo_agent",
      builtinAgents: [candidate({ id: "explore", source: "builtin" })],
      customAgents: [candidate({ id: "librarian", source: "custom" })],
      configAgents: [],
    })

    expect(result.status).toBe("exact_agent_unknown")
  })

  test("displayName and alias normalization works", () => {
    const result = resolveAgentTarget({
      requestedSubagentType: "Hecateq God",
      builtinAgents: [candidate({
        id: "hecateq-orchestrator",
        source: "builtin",
        displayName: "Hecateq Orchestrator",
        aliases: ["Hecateq God"],
      })],
      customAgents: [],
      configAgents: [],
    })

    expect(result.status).toBe("exact_agent_found")
    if (result.status !== "exact_agent_found") return
    expect(result.target).toBe("hecateq-orchestrator")
  })

  test("builtin collisions win over lower-precedence candidates", () => {
    const result = resolveAgentTarget({
      requestedSubagentType: "oracle",
      builtinAgents: [candidate({ id: "oracle", source: "builtin" })],
      customAgents: [candidate({ id: "oracle", source: "custom", aliases: ["oracle"] })],
      configAgents: [candidate({ id: "oracle", source: "config" })],
    })

    expect(result.status).toBe("exact_agent_found")
    if (result.status !== "exact_agent_found") return
    expect(result.source).toBe("builtin")
    expect(result.reason).toContain("Lower-precedence candidates")
  })

  test("documents the expected runtime precedence order", () => {
    expect(ROUTING_RUNTIME_PRECEDENCE).toEqual([
      "Built-in agent registry",
      "Custom agent discovery",
      "Config-defined agents",
      "Disabled filtering",
      "Exact subagent resolution",
      "Category fallback",
      "Agent index suggestion/enrichment",
    ])
  })

  test("hecateq-orchestrator is found via builtin source", () => {
    const result = resolveAgentTarget({
      requestedSubagentType: "hecateq-orchestrator",
      builtinAgents: [candidate({ id: "hecateq-orchestrator", source: "builtin" })],
      customAgents: [],
      configAgents: [],
    })

    expect(result.status).toBe("exact_agent_found")
    if (result.status !== "exact_agent_found") return
    expect(result.target).toBe("hecateq-orchestrator")
    expect(result.source).toBe("builtin")
  })

  test("hecateq-orchestrator is disabled when in disabled_agents", () => {
    const result = resolveAgentTarget({
      requestedSubagentType: "hecateq-orchestrator",
      builtinAgents: [candidate({ id: "hecateq-orchestrator", source: "builtin" })],
      customAgents: [],
      configAgents: [],
      disabledAgents: ["hecateq-orchestrator"],
    })

    expect(result.status).toBe("exact_agent_disabled")
  })

  test("hecateq-orchestrator is found via Hecateq God display name alias", () => {
    const result = resolveAgentTarget({
      requestedSubagentType: "Hecateq God",
      builtinAgents: [candidate({
        id: "hecateq-orchestrator",
        source: "builtin",
        aliases: ["Hecateq God"],
      })],
      customAgents: [],
      configAgents: [],
    })

    expect(result.status).toBe("exact_agent_found")
    if (result.status !== "exact_agent_found") return
    expect(result.target).toBe("hecateq-orchestrator")
  })

  test("call_omo_agent tool name is not mistakenly matched as an exact agent target", () => {
    const result = resolveAgentTarget({
      requestedSubagentType: "call_omo_agent",
      builtinAgents: [candidate({ id: "explore", source: "builtin" })],
      customAgents: [candidate({ id: "librarian", source: "custom" })],
      configAgents: [],
    })

    // call_omo_agent is a tool name, not an agent name — the routing contract
    // correctly fails to match it as an exact target (status = unknown).
    // Available callable agents (explore, librarian) are returned as suggestions
    // because the contract doesn't know call_omo_agent is a tool; it only knows
    // it doesn't match any registered agent.
    expect(result.status).toBe("exact_agent_unknown")
  })

  test("unknown exact agent does not fall back to category even when category is provided", () => {
    const result = resolveAgentTarget({
      requestedSubagentType: "nonexistent-agent",
      requestedCategory: "quick",
      builtinAgents: [candidate({ id: "oracle", source: "builtin" })],
      customAgents: [],
      configAgents: [],
    })

    expect(result.status).toBe("exact_agent_unknown")
    expect(result.reason).toContain("Category fallback was not used")
  })

  test("category fallback is only used when no exact subagent_type is requested", () => {
    const result = resolveAgentTarget({
      requestedCategory: "ultrabrain",
      builtinAgents: [candidate({ id: "oracle", source: "builtin" })],
      customAgents: [],
      configAgents: [],
    })

    expect(result.status).toBe("category_fallback")
    if (result.status !== "category_fallback") return
    expect(result.category).toBe("ultrabrain")
    expect(result.executor).toBe("sisyphus-junior")
  })
})
