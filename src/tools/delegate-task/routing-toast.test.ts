/// <reference types="bun-types" />

declare const require: NodeJS.Require
const { describe, test, expect, beforeEach, afterEach, spyOn, mock } = require("bun:test")
import * as executor from "./executor"
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
const TEST_AVAILABLE_MODELS = new Set<string>([
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

function createPlainClient(): object {
  return {}
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

describe("routing-toast", () => {
  let cacheSpy: ReturnType<typeof spyOn>
  let providerModelsSpy: ReturnType<typeof spyOn>

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
  })

  afterEach(() => {
    __resetTimingConfig()
    releaseAllPromptAsyncReservationsForTesting()
    cacheSpy?.mockRestore()
    providerModelsSpy?.mockRestore()
  })

  // ── Test 1: Exact agent disabled ─────────────────────────────────────
  test("exact agent disabled → tool output contains disabled error + one Hecateq toast with [agent] title and error variant", async () => {
    // #given
    const tuiClient = createTuiClient()
    const mockClient = createBaseMockClient(tuiClient)
    const tool = require("./tools").createDelegateTask({
      manager: { launch: async () => ({ id: "bg-1", status: "pending", description: "t", agent: "x", sessionID: "s" }) },
      client: mockClient,
      connectedProvidersOverride: TEST_CONNECTED_PROVIDERS,
      availableModelsOverride: createTestAvailableModels(),
    })

    const toastSpy = spyOn(hecateqToast, "showHecateqToastSafe").mockResolvedValue(true)
    const resolveSpy = spyOn(executor, "resolveSubagentExecution").mockResolvedValue({
      agentToUse: "",
      categoryModel: undefined,
      error: 'Subagent "oracle" is disabled by disabled_agents.',
    })

    // #when
    const result = await tool.execute(
      { description: "test", prompt: "do something", subagent_type: "oracle", run_in_background: true, load_skills: [] },
      { ...BASE_TOOL_CTX },
    )

    // #then - tool output preserved
    expect(String(result)).toContain("disabled by disabled_agents")

    // #then - one toast fired with correct shape
    expect(toastSpy).toHaveBeenCalledTimes(1)
    const toastCall = toastSpy.mock.calls[0] as unknown as [
      unknown,
      { kind: string; title: string; message: string; variant: string; duration: number },
    ]
    expect(toastCall[1].kind).toBe("agent")
    expect(toastCall[1].title).toBe("Exact agent disabled")
    expect(toastCall[1].message).toContain("oracle")
    expect(toastCall[1].message).toContain("is disabled")
    expect(toastCall[1].message).toContain("Hecateq did not silently fallback")
    expect(toastCall[1].variant).toBe("error")
    expect(toastCall[1].duration).toBe(6000)

    resolveSpy.mockRestore()
    toastSpy.mockRestore()
  })

  // ── Test 2: Exact agent unknown/unavailable ──────────────────────────
  test("exact agent unknown → tool output contains unknown error + one Hecateq toast with [agent] title", async () => {
    // #given
    const tuiClient = createTuiClient()
    const mockClient = createBaseMockClient(tuiClient)
    const tool = require("./tools").createDelegateTask({
      manager: { launch: async () => ({ id: "bg-1", status: "pending", description: "t", agent: "x", sessionID: "s" }) },
      client: mockClient,
      connectedProvidersOverride: TEST_CONNECTED_PROVIDERS,
      availableModelsOverride: createTestAvailableModels(),
    })

    const toastSpy = spyOn(hecateqToast, "showHecateqToastSafe").mockResolvedValue(true)
    const resolveSpy = spyOn(executor, "resolveSubagentExecution").mockResolvedValue({
      agentToUse: "",
      categoryModel: undefined,
      error: 'Unknown subagent_type "nonexistent". Use one of the available exact agents: oracle. Do not invent agent names.',
    })

    // #when
    const result = await tool.execute(
      { description: "test", prompt: "do something", subagent_type: "nonexistent", run_in_background: true, load_skills: [] },
      { ...BASE_TOOL_CTX },
    )

    // #then - tool output preserved
    expect(String(result)).toContain("Unknown subagent_type")

    // #then - one toast
    expect(toastSpy).toHaveBeenCalledTimes(1)
    const toastCall = toastSpy.mock.calls[0] as unknown as [
      unknown,
      { kind: string; title: string; message: string; variant: string },
    ]
    expect(toastCall[1].kind).toBe("agent")
    expect(toastCall[1].title).toBe("Exact agent unavailable")
    // Unknown agent uses error variant since the error text clearly indicates hard-fail
    expect(toastCall[1].variant).toBe("error")
    expect(toastCall[1].message).toContain("is unavailable")
    expect(toastCall[1].message).toContain("Hecateq did not silently fallback")

    resolveSpy.mockRestore()
    toastSpy.mockRestore()
  })

  // ── Test 3: Category unknown → no toast ──────────────────────────────
  test("category unknown → category error output, no Hecateq toast", async () => {
    // #given
    const tuiClient = createTuiClient()
    const mockClient = createBaseMockClient(tuiClient)
    const tool = require("./tools").createDelegateTask({
      manager: { launch: async () => ({ id: "bg-1", status: "pending", description: "t", agent: "x", sessionID: "s" }) },
      client: mockClient,
      connectedProvidersOverride: TEST_CONNECTED_PROVIDERS,
      availableModelsOverride: createTestAvailableModels(),
    })

    const toastSpy = spyOn(hecateqToast, "showHecateqToastSafe").mockResolvedValue(true)
    const resolveSpy = spyOn(executor, "resolveCategoryExecution").mockResolvedValue({
      agentToUse: "",
      categoryModel: undefined,
      error: 'Unknown category "nonexistent-cat". Use one of: quick, deep.',
    })

    // #when
    const result = await tool.execute(
      { description: "test", prompt: "do something", category: "nonexistent-cat", run_in_background: true, load_skills: [] },
      { ...BASE_TOOL_CTX },
    )

    // #then - category error in output
    expect(String(result)).toContain("nonexistent-cat")

    // #then - zero toasts
    expect(toastSpy).not.toHaveBeenCalled()

    resolveSpy.mockRestore()
    toastSpy.mockRestore()
  })

  // ── Test 4: Generic validation error → no toast ──────────────────────
  test("generic validation/tool error → output only, no toast", async () => {
    // #given - neither category nor subagent_type provided
    const tuiClient = createTuiClient()
    const mockClient = createBaseMockClient(tuiClient)
    const tool = require("./tools").createDelegateTask({
      manager: { launch: async () => ({ id: "bg-1", status: "pending", description: "t", agent: "x", sessionID: "s" }) },
      client: mockClient,
      connectedProvidersOverride: TEST_CONNECTED_PROVIDERS,
      availableModelsOverride: createTestAvailableModels(),
    })

    const toastSpy = spyOn(hecateqToast, "showHecateqToastSafe").mockResolvedValue(true)

    // #when
    const result = await tool.execute(
      { description: "test", prompt: "do something", run_in_background: true, load_skills: [] },
      { ...BASE_TOOL_CTX },
    )

    // #then - validation error in output
    expect(String(result)).toContain("Must provide either category or subagent_type")

    // #then - zero toasts
    expect(toastSpy).not.toHaveBeenCalled()

    toastSpy.mockRestore()
  })

  // ── Test 5: Same error twice within 30s → only one toast ─────────────
  test("same routing error twice within 30s → only one toast for same session/event/target", async () => {
    // #given
    const tuiClient = createTuiClient()
    const mockClient = createBaseMockClient(tuiClient)
    // Use require once so the dedup Map persists between calls
    const toolsModule = require("./tools")
    const tool = toolsModule.createDelegateTask({
      manager: { launch: async () => ({ id: "bg-1", status: "pending", description: "t", agent: "x", sessionID: "s" }) },
      client: mockClient,
      connectedProvidersOverride: TEST_CONNECTED_PROVIDERS,
      availableModelsOverride: createTestAvailableModels(),
    })

    const toastSpy = spyOn(hecateqToast, "showHecateqToastSafe").mockResolvedValue(true)
    const resolveSpy = spyOn(executor, "resolveSubagentExecution").mockResolvedValue({
      agentToUse: "",
      categoryModel: undefined,
      error: 'Subagent "oracle" is disabled by disabled_agents.',
    })

    // #when - first call
    await tool.execute(
      { description: "test1", prompt: "do something", subagent_type: "oracle", run_in_background: true, load_skills: [] },
      { ...BASE_TOOL_CTX },
    )
    // #when - second call (same session, same target)
    await tool.execute(
      { description: "test2", prompt: "do another thing", subagent_type: "oracle", run_in_background: true, load_skills: [] },
      { ...BASE_TOOL_CTX },
    )

    // #then - only one toast despite two invocations
    expect(toastSpy).toHaveBeenCalledTimes(1)

    resolveSpy.mockRestore()
    toastSpy.mockRestore()
  })

  // ── Test 6: No TUI client → no throw, original tool output returned ───
  test("no TUI client → no throw, original tool output returned", async () => {
    // #given - plain client without tui
    const plainClient = createBaseMockClient()
    const tool = require("./tools").createDelegateTask({
      manager: { launch: async () => ({ id: "bg-1", status: "pending", description: "t", agent: "x", sessionID: "s" }) },
      client: plainClient,
      connectedProvidersOverride: TEST_CONNECTED_PROVIDERS,
      availableModelsOverride: createTestAvailableModels(),
    })

    const resolveSpy = spyOn(executor, "resolveSubagentExecution").mockResolvedValue({
      agentToUse: "",
      categoryModel: undefined,
      error: 'Subagent "oracle" is disabled by disabled_agents.',
    })

    // #when - should not throw
    let result: unknown
    let threw = false
    try {
      result = await tool.execute(
        { description: "test", prompt: "do something", subagent_type: "oracle", run_in_background: true, load_skills: [] },
        { ...BASE_TOOL_CTX },
      )
    } catch {
      threw = true
    }

    // #then - no throw and original output preserved
    expect(threw).toBe(false)
    expect(String(result)).toContain("disabled by disabled_agents")

    resolveSpy.mockRestore()
  })

  // ── Test 7: Static check — resolver/helper files remain TUI-free ──────
  test("subagent-resolver does not import showHecateqToastSafe", () => {
    // #given
    const code = require("fs").readFileSync(
      require("path").resolve(__dirname, "./subagent-resolver.ts"),
      "utf-8",
    )

    // #then - no toast import in resolver
    expect(code).not.toContain("showHecateqToastSafe")
    expect(code).not.toContain("hecateq-toast")
    expect(code).not.toContain("notification-toast")
  })

  test("subagent-discovery does not import showHecateqToastSafe", () => {
    // #given
    const code = require("fs").readFileSync(
      require("path").resolve(__dirname, "./subagent-discovery.ts"),
      "utf-8",
    )

    // #then
    expect(code).not.toContain("showHecateqToastSafe")
    expect(code).not.toContain("hecateq-toast")
  })

  test("category-resolver does not import showHecateqToastSafe", () => {
    // #given
    const code = require("fs").readFileSync(
      require("path").resolve(__dirname, "./category-resolver.ts"),
      "utf-8",
    )

    // #then
    expect(code).not.toContain("showHecateqToastSafe")
    expect(code).not.toContain("hecateq-toast")
  })
})
