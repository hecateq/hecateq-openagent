import { readFileSync } from "node:fs"
import { join } from "node:path"
import { beforeAll, beforeEach, describe, expect, it, mock } from "bun:test"
import type { ConsumeDelegationsResult } from "../../features/hecateq-orchestration"

// Mocks
// showHecateqToastSafe is imported in index.ts at module scope.
// We mock it before importing the hook module so all callers see the mock.
const mockShowHecateqToastSafe = mock(() => Promise.resolve(true))

mock.module("../../shared/hecateq-toast", () => ({
  showHecateqToastSafe: mockShowHecateqToastSafe,
}))
mock.module("../../shared/hecateq-toast.ts", () => ({
  showHecateqToastSafe: mockShowHecateqToastSafe,
}))

const hookModulePromise = import("./index")

// Helpers

function makeResult(overrides: Partial<ConsumeDelegationsResult> = {}): ConsumeDelegationsResult {
  return {
    results: [],
    iterations: 0,
    totalConsumed: 0,
    guardrailBlocked: 0,
    spawnPolicyBlocked: false,
    rateLimitBlocked: false,
    userVisibleRoutingDecisions: [],
    userVisibleGuardrailBlocks: [],
    ...overrides,
  }
}

// Tests

describe("maybeShowAutoSpawnToast", () => {
  let maybeShowAutoSpawnToast: typeof import("./index").maybeShowAutoSpawnToast

  beforeAll(async () => {
    const mod = await hookModulePromise
    maybeShowAutoSpawnToast = mod.maybeShowAutoSpawnToast
  })

  beforeEach(() => {
    mockShowHecateqToastSafe.mockReset()
    mockShowHecateqToastSafe.mockResolvedValue(true)
  })

  // given: spawnPolicyBlocked === true
  // when: maybeShowAutoSpawnToast is called
  // then: a Hecateq runtime warning toast for policy block is shown
  it("shows policy-blocked toast when spawnPolicyBlocked is true", () => {
    const cooldowns = new Map<string, number>()

    maybeShowAutoSpawnToast(cooldowns, {}, "ses-abc", makeResult({ spawnPolicyBlocked: true }))

    expect(mockShowHecateqToastSafe).toHaveBeenCalledTimes(1)
    const call = mockShowHecateqToastSafe.mock.calls[0] as Array<unknown>
    expect(call[1]).toMatchObject({
      kind: "runtime",
      title: "Auto-spawn blocked by policy",
      variant: "warning",
      duration: 7000,
    })
  })

  // given: rateLimitBlocked === true and spawnPolicyBlocked === false
  // when: maybeShowAutoSpawnToast is called
  // then: a Hecateq runtime warning toast for rate-limit is shown
  it("shows rate-limit toast when rateLimitBlocked is true and spawnPolicyBlocked is false", () => {
    const cooldowns = new Map<string, number>()

    maybeShowAutoSpawnToast(cooldowns, {}, "ses-def", makeResult({ rateLimitBlocked: true }))

    expect(mockShowHecateqToastSafe).toHaveBeenCalledTimes(1)
    const call = mockShowHecateqToastSafe.mock.calls[0] as Array<unknown>
    expect(call[1]).toMatchObject({
      kind: "runtime",
      title: "Auto-spawn rate limited",
      variant: "warning",
      duration: 7000,
    })
  })

  // given: neither spawnPolicyBlocked nor rateLimitBlocked is true
  // when: maybeShowAutoSpawnToast is called
  // then: no toast is shown
  it("shows no toast when nothing is blocked", () => {
    const cooldowns = new Map<string, number>()

    maybeShowAutoSpawnToast(cooldowns, {}, "ses-ghi", makeResult())

    expect(mockShowHecateqToastSafe).not.toHaveBeenCalled()
  })

  // given: spawnPolicyBlocked is true for the same session key
  // when: maybeShowAutoSpawnToast is called twice within the cooldown window
  // then: only one toast is shown
  it("deduplicates: only one toast per event key within the cooldown window", () => {
    const cooldowns = new Map<string, number>()

    // first call: should show toast
    maybeShowAutoSpawnToast(cooldowns, {}, "ses-xyz", makeResult({ spawnPolicyBlocked: true }))
    expect(mockShowHecateqToastSafe).toHaveBeenCalledTimes(1)

    // second call immediately after: should be deduped
    maybeShowAutoSpawnToast(cooldowns, {}, "ses-xyz", makeResult({ spawnPolicyBlocked: true }))
    expect(mockShowHecateqToastSafe).toHaveBeenCalledTimes(1)
  })

  // given: spawnPolicyBlocked was shown for session A
  // when: rateLimitBlocked occurs for session A afterward (still within cooldown for spawnPolicy key)
  // then: rate-limit toast IS shown because it's a different event key
  it("allows different event keys for the same session (spawnPolicy vs rateLimit)", () => {
    const cooldowns = new Map<string, number>()

    maybeShowAutoSpawnToast(cooldowns, {}, "ses-multi", makeResult({ spawnPolicyBlocked: true }))
    expect(mockShowHecateqToastSafe).toHaveBeenCalledTimes(1)

    maybeShowAutoSpawnToast(cooldowns, {}, "ses-multi", makeResult({ rateLimitBlocked: true }))
    expect(mockShowHecateqToastSafe).toHaveBeenCalledTimes(2)
  })

  // given: spawnPolicyBlocked and rateLimitBlocked are both true
  // when: maybeShowAutoSpawnToast is called
  // then: only the policy-blocked toast is shown (priority: spawnPolicy first)
  it("prioritizes spawnPolicyBlocked over rateLimitBlocked when both are true", () => {
    const cooldowns = new Map<string, number>()

    maybeShowAutoSpawnToast(
      cooldowns,
      {},
      "ses-both",
      makeResult({ spawnPolicyBlocked: true, rateLimitBlocked: true }),
    )

    expect(mockShowHecateqToastSafe).toHaveBeenCalledTimes(1)
    const call = mockShowHecateqToastSafe.mock.calls[0] as Array<unknown>
    expect(call[1]).toMatchObject({
      title: "Auto-spawn blocked by policy",
    })
  })

  // given: no TUI client (showHecateqToastSafe resolves to false)
  // when: maybeShowAutoSpawnToast is called
  // then: the function does not throw; it silently no-ops via showHecateqToastSafe
  it("does not throw when showHecateqToastSafe returns false (no TUI)", () => {
    mockShowHecateqToastSafe.mockResolvedValue(false)
    const cooldowns = new Map<string, number>()

    expect(() => {
      maybeShowAutoSpawnToast(cooldowns, null, "ses-no-tui", makeResult({ spawnPolicyBlocked: true }))
    }).not.toThrow()
  })

  // given: showHecateqToastSafe rejects internally
  // when: maybeShowAutoSpawnToast eagerly fires (void) without awaiting
  // then: the function itself does not throw synchronously
  it("does not throw when showHecateqToastSafe rejects (fire-and-forget)", () => {
    mockShowHecateqToastSafe.mockRejectedValue(new Error("TUI unavailable"))
    const cooldowns = new Map<string, number>()

    expect(() => {
      maybeShowAutoSpawnToast(cooldowns, {}, "ses-reject", makeResult({ spawnPolicyBlocked: true }))
    }).not.toThrow()
  })

  // given: an empty sessionID
  // when: maybeShowAutoSpawnToast is called
  // then: it uses the "unknown-session" fallback key without throwing
  it("handles empty sessionID by falling back to unknown-session", () => {
    const cooldowns = new Map<string, number>()

    expect(() => {
      maybeShowAutoSpawnToast(cooldowns, {}, "", makeResult({ spawnPolicyBlocked: true }))
    }).not.toThrow()

    expect(mockShowHecateqToastSafe).toHaveBeenCalledTimes(1)
  })
})

// Structural / static-verification tests

const SRC_ROOT = join(import.meta.dir, "..", "..")

describe("static checks", () => {
  // given: the runtime-delegation-consumer.ts file
  // when: inspected for TUI-related imports
  // then: no showHecateqToastSafe, hecateq-toast, or notification-toast imports exist
  it("runtime-delegation-consumer.ts remains TUI-free", () => {
    const consumerPath = join(
      SRC_ROOT,
      "features",
      "hecateq-orchestration",
      "runtime-delegation-consumer.ts",
    )
    const content = readFileSync(consumerPath, "utf-8")

    const forbidden = [
      "showHecateqToastSafe",
      "hecateq-toast",
      "notification-toast",
    ]

    for (const pattern of forbidden) {
      expect(content).not.toContain(pattern)
    }
  })

  // given: the hook index.ts catch handler for consumeDelegationsAtRuntime rejection
  // when: inspected structurally
  // then: the catch block only logs and does NOT call maybeShowAutoSpawnToast or showHecateqToastSafe
  it("consumer reject preserves log-only catch, no auto-spawn toast", () => {
    const hookPath = join(
      SRC_ROOT,
      "hooks",
      "hecateq-project-context-injector",
      "index.ts",
    )
    const content = readFileSync(hookPath, "utf-8")

    // Locate the .catch() block that follows consumeDelegationsAtRuntime(...).then(...)
    // The pattern is: consumeDelegationsAtRuntime({...}).then(...).catch((err) => { ... })
    const consumeIdx = content.indexOf("consumeDelegationsAtRuntime({")
    expect(consumeIdx).toBeGreaterThan(0)

    // Find the .catch that comes after this call
    const afterConsume = content.slice(consumeIdx)

    // The first .catch after consumeDelegationsAtRuntime should be ours
    const catchIdx = afterConsume.indexOf(".catch((err) => {")
    expect(catchIdx).toBeGreaterThan(0)

    // Extract the catch block (from .catch to the closing })
    const catchBlockStart = afterConsume.slice(catchIdx)
    // Find the matching closing pattern: the catch block ends with "})" at the right indentation
    // Simple approach: extract enough context to verify no toast calls
    const catchBlockSlice = catchBlockStart.slice(0, 500)

    expect(catchBlockSlice).not.toContain("maybeShowAutoSpawnToast")
    expect(catchBlockSlice).not.toContain("showHecateqToastSafe")
    expect(catchBlockSlice).toContain("Delegation consumption failed")
  })
})
