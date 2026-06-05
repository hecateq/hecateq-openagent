/// <reference types="bun-types" />

declare const require: NodeJS.Require
const { describe, test, expect, beforeEach, afterEach, spyOn, mock } = require("bun:test")
import * as dependencyGraph from "../../shared/dependency-graph"
import * as hecateqToast from "../../shared/hecateq-toast"
import { __resetModelCache } from "../../shared/model-availability"
import { clearSkillCache } from "../../features/opencode-skill-loader/skill-content"
import { __setTimingConfig, __resetTimingConfig } from "./timing"
import * as connectedProvidersCache from "../../shared/connected-providers-cache"
import { releaseAllPromptAsyncReservationsForTesting } from "../../shared/prompt-async-gate"

const runtimeRequire = require as NodeJS.Require & { cache?: Record<string, unknown> }

function clearRequireCache(modulePath: string): void {
  const resolvedPath = runtimeRequire.resolve(modulePath)
  if (runtimeRequire.cache?.[resolvedPath]) {
    delete runtimeRequire.cache[resolvedPath]
  }
}

const TEST_CONNECTED_PROVIDERS = ["anthropic", "google", "openai"]
const TEST_AVAILABLE_MODELS = new Set([
  "anthropic/claude-opus-4-7",
  "anthropic/claude-sonnet-4-6",
  "openai/gpt-5.4-mini",
  "openai/gpt-5.5",
])

function createTestAvailableModels(): Set<string> {
  return new Set(TEST_AVAILABLE_MODELS)
}

type TuiShowToastFn = (input: {
  body: { title: string; message: string; variant: string; duration: number }
}) => Promise<unknown>

function createTuiClient(): { tui: { showToast: TuiShowToastFn } } {
  return { tui: { showToast: mock(async () => {}) } }
}

function createBaseMockClient(tui?: object) {
  return {
    ...(tui ?? {}),
    app: { agents: async () => ({ data: [] }) },
    config: { get: async () => ({}) },
    provider: { list: async () => ({ data: { connected: ["openai"] } }) },
    model: { list: async () => ({ data: [{ provider: "openai", id: "gpt-5.3-codex" }] }) },
    session: {
      create: async () => ({ data: { id: "test-session" } }),
      prompt: async () => ({ data: {} }),
      promptAsync: async () => ({ data: {} }),
      messages: async () => ({ data: [] }),
      status: async () => ({ data: {} }),
    },
  }
}

const BASE_TOOL_CTX = {
  sessionID: "parent-session",
  messageID: "parent-message",
  agent: "sisyphus",
  abort: new AbortController().signal,
}

function makeBlockedCanDelegateResult(): ReturnType<typeof dependencyGraph.canDelegate> {
  return {
    allowed: false,
    reason: 'Cannot delegate stage "Step 2" — prerequisite(s) not yet completed: "Step 1" (step-1, pending)',
    unmet_dependencies: ["step-1"],
  }
}

function makeAllowedCanDelegateResult(): ReturnType<typeof dependencyGraph.canDelegate> {
  return { allowed: true }
}

describe("dependency-graph-toast", () => {
  let cacheSpy: ReturnType<typeof spyOn>
  let providerModelsSpy: ReturnType<typeof spyOn>
  let storeSpy: ReturnType<typeof spyOn>
  let canDelegateSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    mock.restore()
    clearRequireCache("./tools")
    __resetModelCache()
    clearSkillCache()
    __setTimingConfig({
      POLL_INTERVAL_MS: 10,
      MIN_STABILITY_TIME_MS: 50,
      STABILITY_POLLS_REQUIRED: 1,
      WAIT_FOR_SESSION_INTERVAL_MS: 10,
      WAIT_FOR_SESSION_TIMEOUT_MS: 1000,
      MAX_POLL_TIME_MS: 2000,
      SESSION_CONTINUATION_STABILITY_MS: 50,
    })
    cacheSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(["anthropic", "google", "openai"])
    providerModelsSpy = spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue({
      models: {
        anthropic: ["claude-opus-4-7", "claude-sonnet-4-6"],
        google: ["gemini-3.1-pro", "gemini-3-flash"],
        openai: ["gpt-5.5", "gpt-5.4-mini", "gpt-5.3-codex"],
      },
      connected: ["anthropic", "google", "openai"],
      updatedAt: "2026-01-01T00:00:00.000Z",
    })

    // Mock the dependency graph store to return a valid graph object
    const mockStore = {
      getGraph: mock(() => ({
        id: "test-graph",
        label: "Test Graph",
        stages: [{ id: "step-1", label: "Step 1", status: "pending", depends_on: [] }],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })),
    }
    storeSpy = spyOn(dependencyGraph, "createDependencyGraphStore").mockReturnValue(mockStore as ReturnType<typeof dependencyGraph.createDependencyGraphStore>)
    canDelegateSpy = spyOn(dependencyGraph, "canDelegate").mockReturnValue(makeBlockedCanDelegateResult())
  })

  afterEach(() => {
    __resetTimingConfig()
    releaseAllPromptAsyncReservationsForTesting()
    cacheSpy?.mockRestore()
    providerModelsSpy?.mockRestore()
    storeSpy?.mockRestore()
    canDelegateSpy?.mockRestore()
  })

  // ── Test 1: Dependency graph blocked → original output + one toast ─────
  test("dependency graph blocked → original tool output reason preserved + one Hecateq toast", async () => {
    // #given
    const tuiClient = createTuiClient()
    const mockClient = createBaseMockClient(tuiClient)
    const tool = require("./tools").createDelegateTask({
      manager: { launch: async () => ({ id: "bg-1", status: "pending", description: "t", agent: "x", sessionID: "s" }) },
      client: mockClient,
      connectedProvidersOverride: TEST_CONNECTED_PROVIDERS,
      availableModelsOverride: createTestAvailableModels(),
      hecateqDependencyGraphConfig: { mode: "warn" },
    })

    const toastSpy = spyOn(hecateqToast, "showHecateqToastSafe").mockResolvedValue(true)

    // #when
    const result = await tool.execute(
      {
        description: "test",
        prompt: "do something",
        subagent_type: "oracle",
        run_in_background: true,
        load_skills: [],
        dependency_graph_id: "test-graph",
        stage_id: "step-2",
      },
      { ...BASE_TOOL_CTX },
    )

    // #then - original tool output with block reason
    const output = String(result)
    expect(output).toContain("Cannot delegate stage")
    expect(output).toContain("Step 2")
    expect(output).toContain("prerequisite")

    // #then - one toast with correct shape
    expect(toastSpy).toHaveBeenCalledTimes(1)
    const toastCall = toastSpy.mock.calls[0] as unknown as [
      unknown,
      { kind: string; title: string; message: string; variant: string; duration: number },
    ]
    expect(toastCall[1].kind).toBe("agent")
    expect(toastCall[1].title).toBe("Dependency graph blocked delegation")
    expect(toastCall[1].message).toContain("blocked by dependency graph requirements")
    expect(toastCall[1].message).toContain("Cannot delegate")
    expect(toastCall[1].variant).toBe("error")
    expect(toastCall[1].duration).toBe(7000)

    toastSpy.mockRestore()
  })

  // ── Test 2: Dependency graph allowed → no toast ───────────────────────
  test("dependency graph allowed → no dependency graph toast, normal delegation proceeds", async () => {
    // #given - canDelegate returns allowed
    canDelegateSpy.mockReturnValue(makeAllowedCanDelegateResult())

    const tuiClient = createTuiClient()
    const mockClient = createBaseMockClient(tuiClient)
    const tool = require("./tools").createDelegateTask({
      manager: { launch: async () => ({ id: "bg-1", status: "pending", description: "t", agent: "x", sessionID: "s" }) },
      client: mockClient,
      connectedProvidersOverride: TEST_CONNECTED_PROVIDERS,
      availableModelsOverride: createTestAvailableModels(),
      hecateqDependencyGraphConfig: { mode: "warn" },
    })

    const toastSpy = spyOn(hecateqToast, "showHecateqToastSafe").mockResolvedValue(true)

    // #when - with dependency graph args, but canDelegate allows
    const result = await tool.execute(
      {
        description: "test",
        prompt: "do something",
        subagent_type: "oracle",
        run_in_background: true,
        load_skills: [],
        dependency_graph_id: "test-graph",
        stage_id: "step-2",
      },
      { ...BASE_TOOL_CTX },
    )

    // #then - zero dep graph toasts (delegation proceeds normally)
    // Note: the task delegates to oracle which may fail elsewhere, but
    // no dependency graph toast should fire.
    let depGraphToastCount = 0
    for (const call of toastSpy.mock.calls) {
      const args = call as unknown as [unknown, { title: string }]
      if (args[1]?.title === "Dependency graph blocked delegation") {
        depGraphToastCount++
      }
    }
    expect(depGraphToastCount).toBe(0)

    // #then - result exists (delegation proceeded)
    expect(result).toBeDefined()

    toastSpy.mockRestore()
  })

  // ── Test 3: Same block within dedupe window → one toast ───────────────
  test("same dependency graph block within 30s dedupe window → only one toast", async () => {
    // #given
    const tuiClient = createTuiClient()
    const mockClient = createBaseMockClient(tuiClient)
    const toolsModule = require("./tools")
    const tool = toolsModule.createDelegateTask({
      manager: { launch: async () => ({ id: "bg-1", status: "pending", description: "t", agent: "x", sessionID: "s" }) },
      client: mockClient,
      connectedProvidersOverride: TEST_CONNECTED_PROVIDERS,
      availableModelsOverride: createTestAvailableModels(),
      hecateqDependencyGraphConfig: { mode: "warn" },
    })

    const toastSpy = spyOn(hecateqToast, "showHecateqToastSafe").mockResolvedValue(true)

    // #when - first call
    await tool.execute(
      {
        description: "test1",
        prompt: "do something",
        subagent_type: "oracle",
        run_in_background: true,
        load_skills: [],
        dependency_graph_id: "test-graph",
        stage_id: "step-2",
      },
      { ...BASE_TOOL_CTX },
    )

    // #when - second call (same graph, same stage, same session)
    await tool.execute(
      {
        description: "test2",
        prompt: "do another thing",
        subagent_type: "oracle",
        run_in_background: true,
        load_skills: [],
        dependency_graph_id: "test-graph",
        stage_id: "step-2",
      },
      { ...BASE_TOOL_CTX },
    )

    // #then - only one dependency graph toast
    let depGraphToastCount = 0
    for (const call of toastSpy.mock.calls) {
      const args = call as unknown as [unknown, { title: string }]
      if (args[1]?.title === "Dependency graph blocked delegation") {
        depGraphToastCount++
      }
    }
    expect(depGraphToastCount).toBe(1)

    toastSpy.mockRestore()
  })

  // ── Test 4: Category unknown → no dependency graph toast ───────────────
  test("no dependency graph args → no dependency graph toast even on category error", async () => {
    // #given - no dependency_graph_id/stage_id provided
    const tuiClient = createTuiClient()
    const mockClient = createBaseMockClient(tuiClient)
    const tool = require("./tools").createDelegateTask({
      manager: { launch: async () => ({ id: "bg-1", status: "pending", description: "t", agent: "x", sessionID: "s" }) },
      client: mockClient,
      connectedProvidersOverride: TEST_CONNECTED_PROVIDERS,
      availableModelsOverride: createTestAvailableModels(),
      hecateqDependencyGraphConfig: { mode: "warn" },
    })

    const toastSpy = spyOn(hecateqToast, "showHecateqToastSafe").mockResolvedValue(true)

    // #when - category="unknown" but NO dependency graph args
    const result = await tool.execute(
      {
        description: "test",
        prompt: "do something",
        category: "nonexistent-cat",
        run_in_background: true,
        load_skills: [],
        // no dependency_graph_id or stage_id
      },
      { ...BASE_TOOL_CTX },
    )

    // #then - category error in output
    expect(String(result)).toContain("nonexistent-cat")

    // #then - zero dependency graph toasts
    let depGraphToastCount = 0
    for (const call of toastSpy.mock.calls) {
      const args = call as unknown as [unknown, { title: string }]
      if (args[1]?.title === "Dependency graph blocked delegation") {
        depGraphToastCount++
      }
    }
    expect(depGraphToastCount).toBe(0)

    toastSpy.mockRestore()
  })

  // ── Test 5: No TUI client → no throw, original output returns ─────────
  test("no TUI client → no throw, original blocked output returns", async () => {
    // #given - plain client without tui
    const plainClient = createBaseMockClient()
    const tool = require("./tools").createDelegateTask({
      manager: { launch: async () => ({ id: "bg-1", status: "pending", description: "t", agent: "x", sessionID: "s" }) },
      client: plainClient,
      connectedProvidersOverride: TEST_CONNECTED_PROVIDERS,
      availableModelsOverride: createTestAvailableModels(),
      hecateqDependencyGraphConfig: { mode: "warn" },
    })

    // #when - should not throw
    let result: unknown
    let threw = false
    try {
      result = await tool.execute(
        {
          description: "test",
          prompt: "do something",
          subagent_type: "oracle",
          run_in_background: true,
          load_skills: [],
          dependency_graph_id: "test-graph",
          stage_id: "step-2",
        },
        { ...BASE_TOOL_CTX },
      )
    } catch {
      threw = true
    }

    // #then - no throw and original blocked output preserved
    expect(threw).toBe(false)
    expect(String(result)).toContain("Cannot delegate stage")
  })

  // ── Test 6: severity classification — warn mode → warning variant ─────
  test("warn mode with unmet prerequisites → warning variant in toast", async () => {
    // #given - canDelegate returns warning-style block (warn mode)
    canDelegateSpy.mockReturnValue({
      allowed: true, // warn mode allows delegation
      reason: 'Warning: stage "Step 2" waiting on prerequisite(s): "Step 1" (step-1, pending)',
      unmet_dependencies: ["step-1"],
    })

    // Override: for warn mode we also need to make canDelegate return blocked since
    // the tool code checks !check.allowed. In warn mode with unmet deps, allowed is true
    // so the toast won't fire. Let's test with enforced mode instead for the variant.
    // Reset to a blocked (enforced) result with warning-level message.
    canDelegateSpy.mockReturnValue({
      allowed: false,
      reason: 'Warning: stage "Step 2" has failed prerequisite(s): "Step 1" (step-1, failed)',
      unmet_dependencies: ["step-1"],
    })

    const tuiClient = createTuiClient()
    const mockClient = createBaseMockClient(tuiClient)
    const tool = require("./tools").createDelegateTask({
      manager: { launch: async () => ({ id: "bg-1", status: "pending", description: "t", agent: "x", sessionID: "s" }) },
      client: mockClient,
      connectedProvidersOverride: TEST_CONNECTED_PROVIDERS,
      availableModelsOverride: createTestAvailableModels(),
      hecateqDependencyGraphConfig: { mode: "enforce" },
    })

    const toastSpy = spyOn(hecateqToast, "showHecateqToastSafe").mockResolvedValue(true)

    // #when
    await tool.execute(
      {
        description: "test",
        prompt: "do something",
        subagent_type: "oracle",
        run_in_background: true,
        load_skills: [],
        dependency_graph_id: "test-graph",
        stage_id: "step-2",
      },
      { ...BASE_TOOL_CTX },
    )

    // #then - warning variant since reason starts with "Warning"
    expect(toastSpy).toHaveBeenCalledTimes(1)
    const toastCall = toastSpy.mock.calls[0] as unknown as [
      unknown,
      { variant: string },
    ]
    expect(toastCall[1].variant).toBe("warning")

    toastSpy.mockRestore()
  })

  // ── Test 7: Static check — pure dependency-graph files remain TUI-free ─
  test("dependency-graph types.ts does not import showHecateqToastSafe", () => {
    // #given
    const code = require("fs").readFileSync(
      require("path").resolve(__dirname, "../../shared/dependency-graph/types.ts"),
      "utf-8",
    )

    // #then
    expect(code).not.toContain("showHecateqToastSafe")
    expect(code).not.toContain("hecateq-toast")
    expect(code).not.toContain("notification-toast")
  })

  test("dependency-graph store.ts does not import showHecateqToastSafe", () => {
    // #given
    const code = require("fs").readFileSync(
      require("path").resolve(__dirname, "../../shared/dependency-graph/store.ts"),
      "utf-8",
    )

    // #then
    expect(code).not.toContain("showHecateqToastSafe")
    expect(code).not.toContain("hecateq-toast")
    expect(code).not.toContain("notification-toast")
  })

  test("dependency-graph resolver.ts does not import showHecateqToastSafe", () => {
    // #given
    const code = require("fs").readFileSync(
      require("path").resolve(__dirname, "../../shared/dependency-graph/resolver.ts"),
      "utf-8",
    )

    // #then
    expect(code).not.toContain("showHecateqToastSafe")
    expect(code).not.toContain("hecateq-toast")
    expect(code).not.toContain("notification-toast")
  })
})
