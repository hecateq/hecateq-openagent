import { describe, expect, test } from "bun:test"

import {
  ParentWakeNotifier,
  PARENT_WAKE_MAX_ELAPSED_MS,
  PARENT_WAKE_MAX_RETRY_COUNT,
} from "./parent-wake-notifier"

type PromptAsyncCall = {
  path: { id: string }
  body: { parts?: unknown[] }
}

type SessionMessageStub = {
  info?: {
    role?: string
    finish?: string
    time?: { created?: number }
  }
  parts?: Array<{ type?: string; text?: string; state?: { status?: string } }>
}

function createNotifier(args: {
  sessionStatuses?: Record<string, { type: string }>
  sessionMessages?: SessionMessageStub[]
  promptAsyncImpl?: (call: PromptAsyncCall) => Promise<unknown>
} = {}) {
  const promptAsyncCalls: PromptAsyncCall[] = []
  const client = {
    session: {
      status: async () => ({ data: args.sessionStatuses ?? {} }),
      messages: async () => ({ data: args.sessionMessages ?? [] }),
      promptAsync: async (call: PromptAsyncCall) => {
        promptAsyncCalls.push(call)
        return args.promptAsyncImpl?.(call) ?? { data: {} }
      },
      abort: async () => ({ data: {} }),
    },
  } as unknown as ConstructorParameters<typeof ParentWakeNotifier>[0]["client"]

  const notifier = new ParentWakeNotifier(
    {
      client,
      directory: "/tmp/test-omo",
      enqueueNotificationForParent: async (_sessionID, operation) => {
        await operation()
      },
    },
    {
      pendingRetryMs: 1_000,
      acceptedMessageSkewMs: 100,
      toolCallDeferMaxMs: 5_000,
      failureRequeueWindowMs: 5_000,
      userMessageInProgressWindowMs: 0,
    },
  )

  return { notifier, promptAsyncCalls }
}

describe("ParentWakeNotifier bounded escape", () => {
  test("forces a wake after the parent stays active past the stale defer window with no pending tool call", async () => {
    // given
    const { notifier, promptAsyncCalls } = createNotifier({
      sessionStatuses: { "parent-1": { type: "busy" } },
      sessionMessages: [
        {
          info: {
            role: "assistant",
            finish: "stop",
            time: { created: Date.now() - 10_000 },
          },
          parts: [{ type: "text", text: "stale assistant output" }],
        },
      ],
    })

    notifier.queuePendingParentWake("parent-1", "wake after stale active turn", {}, true)
    notifier.getPendingParentWakes().get("parent-1")!.createdAt = Date.now() - 6_000

    // when
    await notifier.flushPendingParentWake("parent-1")

    // then
    expect(promptAsyncCalls).toHaveLength(1)
    expect(notifier.getPendingParentWakes().has("parent-1")).toBe(false)
  })

  test("dedupes identical queued notifications for the same parent session", () => {
    // given
    const { notifier } = createNotifier()

    // when
    notifier.queuePendingParentWake("parent-2", "same completion", {}, true)
    notifier.queuePendingParentWake("parent-2", "same completion", {}, true)

    // then
    expect(notifier.getPendingParentWakes().get("parent-2")?.notifications).toEqual(["same completion"])
  })

  test("one wake failure does not block a later wake for another parent session", async () => {
    // given
    const { notifier, promptAsyncCalls } = createNotifier({
      promptAsyncImpl: async (call) => {
        if (call.path.id === "parent-a") {
          throw new Error("prompt failed")
        }
        return { data: {} }
      },
    })

    notifier.queuePendingParentWake("parent-a", "wake A", {}, true)
    notifier.queuePendingParentWake("parent-b", "wake B", {}, true)

    // when
    await notifier.flushPendingParentWake("parent-a")
    await notifier.flushPendingParentWake("parent-b")

    // then
    expect(promptAsyncCalls).toHaveLength(2)
    expect(notifier.getPendingParentWakes().has("parent-a")).toBe(true)
    expect(notifier.getPendingParentWakes().has("parent-b")).toBe(false)
  })

  test("exports bounded escape limits for retries and age", () => {
    expect(PARENT_WAKE_MAX_RETRY_COUNT).toBeGreaterThan(0)
    expect(PARENT_WAKE_MAX_ELAPSED_MS).toBeGreaterThan(0)
  })
})
