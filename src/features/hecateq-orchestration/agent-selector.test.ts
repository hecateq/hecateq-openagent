import { describe, expect, test } from "bun:test"
import {
  classifyAgentStatus,
  buildCandidatePool,
  getPublicSuggestions,
  getCallableCandidates,
  selectAgentsFromPool,
  selectAgents,
  readLocalAgentRegistry,
} from "./agent-selector"
import type {
  AgentCandidateEntry,
  AgentCandidateStatus,
  LocalAgentRegistryEntry,
  TaskNode,
} from "./types"

function makeAgent(overrides: Partial<LocalAgentRegistryEntry> = {}): LocalAgentRegistryEntry {
  return {
    name: "test-agent",
    description: "A test agent for testing",
    hidden: false,
    disabled: false,
    sourcePath: "/test/agent.md",
    ...overrides,
  }
}

function makeTask(overrides: Partial<TaskNode> = {}): TaskNode {
  return {
    id: "task_1",
    label: "Test task",
    prompt: "Do something",
    domain: "backend",
    action: "write",
    dependsOn: [],
    status: "pending",
    ...overrides,
  }
}

// ─── classifyAgentStatus ─────────────────────────────────────────────────

describe("classifyAgentStatus", () => {
  test("#given agent is disabled in config #then status is disabled", () => {
    const result = classifyAgentStatus({
      agentName: "blocked-agent",
      hidden: false,
      runtimeAgentIds: new Set(["blocked-agent"]),
      disabledSet: new Set(["blocked-agent"]),
      indexHasAgent: true,
    })
    expect(result.status).toBe("disabled" as AgentCandidateStatus)
    expect(result.reason).toMatch(/disabled/)
  })

  test("#given agent is hidden and runtime-known #then status is hidden_internal", () => {
    const result = classifyAgentStatus({
      agentName: "secret-agent",
      hidden: true,
      runtimeAgentIds: new Set(["secret-agent"]),
      disabledSet: new Set(),
      indexHasAgent: true,
    })
    expect(result.status).toBe("hidden_internal" as AgentCandidateStatus)
  })

  test("#given agent is runtime-known with index metadata #then status is runtime_callable", () => {
    const result = classifyAgentStatus({
      agentName: "normal-agent",
      hidden: false,
      runtimeAgentIds: new Set(["normal-agent"]),
      disabledSet: new Set(),
      indexHasAgent: true,
    })
    expect(result.status).toBe("runtime_callable" as AgentCandidateStatus)
  })

  test("#given agent is runtime-known but not in index #then status is runtime_only", () => {
    const result = classifyAgentStatus({
      agentName: "new-agent",
      hidden: false,
      runtimeAgentIds: new Set(["new-agent"]),
      disabledSet: new Set(),
      indexHasAgent: false,
    })
    expect(result.status).toBe("runtime_only" as AgentCandidateStatus)
    expect(result.reason).toMatch(/no index metadata/)
  })

  test("#given agent is in index but not runtime-known #then status is index_only_stale", () => {
    const result = classifyAgentStatus({
      agentName: "stale-agent",
      hidden: false,
      runtimeAgentIds: new Set(),
      disabledSet: new Set(),
      indexHasAgent: true,
    })
    expect(result.status).toBe("index_only_stale" as AgentCandidateStatus)
    expect(result.reason).toMatch(/not callable/)
  })

  test("#given agent is neither in index nor runtime #then status is unknown", () => {
    const result = classifyAgentStatus({
      agentName: "ghost-agent",
      hidden: false,
      runtimeAgentIds: new Set(),
      disabledSet: new Set(),
      indexHasAgent: false,
    })
    expect(result.status).toBe("unknown" as AgentCandidateStatus)
  })

  test("#given disabled takes precedence over hidden #then status is disabled", () => {
    const result = classifyAgentStatus({
      agentName: "hidden-disabled",
      hidden: true,
      runtimeAgentIds: new Set(["hidden-disabled"]),
      disabledSet: new Set(["hidden-disabled"]),
      indexHasAgent: true,
    })
    expect(result.status).toBe("disabled" as AgentCandidateStatus)
  })
})

// ─── buildCandidatePool ─────────────────────────────────────────────────

describe("buildCandidatePool", () => {
  test("#given disabled agents in registry #then they are excluded from pool", () => {
    const registry: LocalAgentRegistryEntry[] = [
      makeAgent({ name: "good-agent" }),
      makeAgent({ name: "bad-agent" }),
    ]
    const pool = buildCandidatePool({
      registry,
      runtimeAgentIds: new Set(["good-agent", "bad-agent"]),
      disabledAgents: ["bad-agent"],
    })
    expect(pool.find((c) => c.name === "bad-agent")).toBeUndefined()
    expect(pool.find((c) => c.name === "good-agent")).toBeDefined()
  })

  test("#given hidden agent #then included in pool with hideFromSuggestions=true", () => {
    const registry: LocalAgentRegistryEntry[] = [
      makeAgent({ name: "hidden-one", hidden: true }),
    ]
    const pool = buildCandidatePool({
      registry,
      runtimeAgentIds: new Set(["hidden-one"]),
      disabledAgents: [],
    })
    const entry = pool.find((c) => c.name === "hidden-one")
    expect(entry).toBeDefined()
    expect(entry!.hideFromSuggestions).toBe(true)
    expect(entry!.status).toBe("hidden_internal" as AgentCandidateStatus)
  })

  test("#given runtime-only agent not in index #then included with null registryEntry", () => {
    const registry: LocalAgentRegistryEntry[] = [
      makeAgent({ name: "indexed-agent" }),
    ]
    const pool = buildCandidatePool({
      registry,
      runtimeAgentIds: new Set(["indexed-agent", "runtime-new"]),
      disabledAgents: [],
    })
    const rtOnly = pool.find((c) => c.name === "runtime-new")
    expect(rtOnly).toBeDefined()
    expect(rtOnly!.status).toBe("runtime_only" as AgentCandidateStatus)
    expect(rtOnly!.registryEntry).toBeNull()
  })

  test("#given index-only stale agent (not in runtime) #then included in pool but not callable", () => {
    const registry: LocalAgentRegistryEntry[] = [
      makeAgent({ name: "stale-one" }),
    ]
    const pool = buildCandidatePool({
      registry,
      runtimeAgentIds: new Set(),
      disabledAgents: [],
    })
    const stale = pool.find((c) => c.name === "stale-one")
    expect(stale).toBeDefined()
    expect(stale!.status).toBe("index_only_stale" as AgentCandidateStatus)
    const callable = getCallableCandidates(pool)
    expect(callable.find((c) => c.name === "stale-one")).toBeUndefined()
  })

  test("#given duplicate agent names across registry and runtime #then no duplicate entries", () => {
    const registry: LocalAgentRegistryEntry[] = [
      makeAgent({ name: "dup-agent" }),
    ]
    const pool = buildCandidatePool({
      registry,
      runtimeAgentIds: new Set(["dup-agent"]),
      disabledAgents: [],
    })
    const matches = pool.filter((c) => c.name === "dup-agent")
    expect(matches).toHaveLength(1)
  })
})

// ─── getPublicSuggestions ────────────────────────────────────────────────

describe("getPublicSuggestions", () => {
  test("#given hidden agent #then excluded from public suggestions", () => {
    const candidates: AgentCandidateEntry[] = [
      { name: "visible", status: "runtime_callable", registryEntry: makeAgent({ name: "visible" }), hideFromSuggestions: false },
      { name: "hidden", status: "hidden_internal", registryEntry: makeAgent({ name: "hidden", hidden: true }), hideFromSuggestions: true },
    ]
    const result = getPublicSuggestions(candidates)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe("visible")
  })

  test("#given disabled and stale agents #then excluded from suggestions", () => {
    const candidates: AgentCandidateEntry[] = [
      { name: "good", status: "runtime_callable", registryEntry: makeAgent({ name: "good" }), hideFromSuggestions: false },
      { name: "bad", status: "disabled", registryEntry: makeAgent({ name: "bad" }), hideFromSuggestions: false },
      { name: "old", status: "index_only_stale", registryEntry: makeAgent({ name: "old" }), hideFromSuggestions: false },
    ]
    const result = getPublicSuggestions(candidates)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe("good")
  })
})

// ─── getCallableCandidates ───────────────────────────────────────────────

describe("getCallableCandidates", () => {
  test("#given mix of statuses #then only callable ones returned", () => {
    const candidates: AgentCandidateEntry[] = [
      { name: "a", status: "runtime_callable", registryEntry: makeAgent({ name: "a" }), hideFromSuggestions: false },
      { name: "b", status: "runtime_only", registryEntry: null, hideFromSuggestions: false },
      { name: "c", status: "hidden_internal", registryEntry: makeAgent({ name: "c", hidden: true }), hideFromSuggestions: true },
      { name: "d", status: "disabled", registryEntry: makeAgent({ name: "d" }), hideFromSuggestions: false },
      { name: "e", status: "index_only_stale", registryEntry: makeAgent({ name: "e" }), hideFromSuggestions: false },
    ]
    const callable = getCallableCandidates(candidates)
    const names = callable.map((c) => c.name)
    expect(names).toContain("a")
    expect(names).toContain("b")
    expect(names).toContain("c")
    expect(names).not.toContain("d")
    expect(names).not.toContain("e")
  })
})

// ─── selectAgentsFromPool ───────────────────────────────────────────────

describe("selectAgentsFromPool", () => {
  test("#given callable agent matching domain #then selected as exact match", () => {
    const candidates: AgentCandidateEntry[] = [
      {
        name: "nodejs-backend-developer",
        status: "runtime_callable",
        registryEntry: makeAgent({
          name: "nodejs-backend-developer",
          domainHints: ["backend"],
          description: "Backend API developer",
        }),
        hideFromSuggestions: false,
      },
    ]
    const tasks = [makeTask({ domain: "backend" })]
    const result = selectAgentsFromPool(tasks, candidates)
    expect(result.entries[0].selectedAgent).toBe("nodejs-backend-developer")
    expect(result.entries[0].exactMatch).toBe(true)
    expect(result.exactMatchCount).toBe(1)
  })

  test("#given hidden agent matching domain #then selected as internal candidate with reason", () => {
    const candidates: AgentCandidateEntry[] = [
      {
        name: "hidden-backend",
        status: "hidden_internal",
        registryEntry: makeAgent({
          name: "hidden-backend",
          domainHints: ["backend"],
          description: "Hidden backend agent",
          hidden: true,
        }),
        hideFromSuggestions: true,
      },
    ]
    const tasks = [makeTask({ domain: "backend" })]
    const result = selectAgentsFromPool(tasks, candidates)
    expect(result.entries[0].selectedAgent).toBe("hidden-backend")
    expect(result.entries[0].fallbackReason).toMatch(/internal candidate/)
    expect(result.entries[0].disabled).toBe(false)
  })

  test("#given no callable agent but disabled agent would match #then hard-fail with disabled=true", () => {
    const candidates: AgentCandidateEntry[] = [
      {
        name: "blocked-dev",
        status: "disabled",
        registryEntry: makeAgent({
          name: "blocked-dev",
          domainHints: ["backend"],
          description: "Blocked backend developer",
        }),
        hideFromSuggestions: false,
      },
    ]
    const tasks = [makeTask({ domain: "backend" })]
    const result = selectAgentsFromPool(tasks, candidates)
    expect(result.entries[0].selectedAgent).toBe("blocked-dev")
    expect(result.entries[0].disabled).toBe(true)
    expect(result.entries[0].fallbackReason).toMatch(/disabled in config/)
  })

  test("#given no matching agent at all #then falls back to sisyphus-junior", () => {
    const candidates: AgentCandidateEntry[] = [
      {
        name: "frontend-dev",
        status: "runtime_callable",
        registryEntry: makeAgent({
          name: "frontend-dev",
          domainHints: ["frontend"],
          description: "Frontend developer",
        }),
        hideFromSuggestions: false,
      },
    ]
    const tasks = [makeTask({ domain: "database" })]
    const result = selectAgentsFromPool(tasks, candidates)
    expect(result.entries[0].selectedAgent).toBe("sisyphus-junior")
    expect(result.entries[0].exactMatch).toBe(false)
  })

  test("#given runtime-only agent (no registryEntry) #then not scored but other callable selected", () => {
    const candidates: AgentCandidateEntry[] = [
      {
        name: "runtime-new",
        status: "runtime_only",
        registryEntry: null,
        hideFromSuggestions: false,
      },
      {
        name: "nodejs-backend-developer",
        status: "runtime_callable",
        registryEntry: makeAgent({
          name: "nodejs-backend-developer",
          domainHints: ["backend"],
          description: "Backend developer",
        }),
        hideFromSuggestions: false,
      },
    ]
    const tasks = [makeTask({ domain: "backend" })]
    const result = selectAgentsFromPool(tasks, candidates)
    expect(result.entries[0].selectedAgent).toBe("nodejs-backend-developer")
  })

  test("#given agent with avoid_when matching task domain #then selected with soft warning", () => {
    const candidates: AgentCandidateEntry[] = [
      {
        name: "security-architect",
        status: "runtime_callable",
        registryEntry: makeAgent({
          name: "security-architect",
          domainHints: ["backend", "security"],
          description: "Security architect",
          avoidWhen: ["backend implementation"],
        }),
        hideFromSuggestions: false,
      },
    ]
    const tasks = [makeTask({ domain: "backend" })]
    const result = selectAgentsFromPool(tasks, candidates)
    expect(result.entries[0].selectedAgent).toBe("security-architect")
    expect(result.entries[0].fallbackReason).toMatch(/avoid_when/)
  })
})

// ─── selectAgents (original) preserves backward compat ────────────────────

describe("selectAgents — backward compat", () => {
  test("#given hidden agents in registry #then they are filtered out from scoring", () => {
    const registry: LocalAgentRegistryEntry[] = [
      makeAgent({ name: "visible-backend", domainHints: ["backend"], description: "Visible backend" }),
      makeAgent({ name: "hidden-backend", hidden: true, domainHints: ["backend"], description: "Hidden backend" }),
    ]
    const tasks = [makeTask({ domain: "backend" })]
    const result = selectAgents(tasks, registry, [])
    expect(result.entries[0].selectedAgent).toBe("visible-backend")
  })

  test("#given disabled agent is best match #then falls back to next best", () => {
    const registry: LocalAgentRegistryEntry[] = [
      makeAgent({ name: "best-dev", domainHints: ["backend"], priority: "high", description: "Best backend" }),
      makeAgent({ name: "alt-dev", domainHints: ["backend"], priority: "medium", description: "Alt backend" }),
    ]
    const tasks = [makeTask({ domain: "backend" })]
    const result = selectAgents(tasks, registry, ["best-dev"])
    expect(result.entries[0].selectedAgent).toBe("alt-dev")
    expect(result.entries[0].fallbackReason).toMatch(/disabled/)
    expect(result.entries[0].disabled).toBe(false)
  })

  test("#given disabled agent is ONLY match #then preserves disabled hard-fail", () => {
    const registry: LocalAgentRegistryEntry[] = [
      makeAgent({ name: "only-dev", domainHints: ["backend"], description: "Only backend" }),
    ]
    const tasks = [makeTask({ domain: "backend" })]
    const result = selectAgents(tasks, registry, ["only-dev"])
    expect(result.entries[0].selectedAgent).toBe("only-dev")
    expect(result.entries[0].disabled).toBe(true)
    expect(result.entries[0].fallbackReason).toMatch(/disabled/)
  })
})
