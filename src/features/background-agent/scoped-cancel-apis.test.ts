import { tmpdir } from "node:os"
import type { PluginInput } from "@opencode-ai/plugin"
import { afterEach, describe, expect, test } from "bun:test"
import { ConcurrencyManager } from "./concurrency"
import { BackgroundManager } from "./manager"
import type { BackgroundTask } from "./types"

const managersToShutdown: BackgroundManager[] = []

afterEach(() => {
  while (managersToShutdown.length > 0) managersToShutdown.pop()?.shutdown()
})

function createBackgroundManager(
  config?: { defaultConcurrency?: number },
  abortSession: () => Promise<unknown> = async () => ({ data: true }),
): BackgroundManager {
  const directory = tmpdir()
  const client = { session: {} as PluginInput["client"]["session"] } as PluginInput["client"]

  Reflect.set(client.session, "abort", abortSession)
  Reflect.set(client.session, "create", async () => ({ data: { id: `session-sc-${crypto.randomUUID().slice(0, 8)}` } }))
  Reflect.set(client.session, "get", async () => ({ data: { directory } }))
  Reflect.set(client.session, "messages", async () => ({ data: [] }))
  Reflect.set(client.session, "prompt", async () => ({ data: { info: {}, parts: [] } }))
  Reflect.set(client.session, "promptAsync", async () => ({ data: undefined }))

  const manager = new BackgroundManager({ pluginContext: {
    $: {} as PluginInput["$"],
    client,
    directory,
    project: {} as PluginInput["project"],
    serverUrl: new URL("http://localhost"),
    worktree: directory,
    experimental_workspace: {} as PluginInput["experimental_workspace"],
  }, config: config })
  managersToShutdown.push(manager)
  return manager
}

function createMockTask(overrides: Partial<BackgroundTask> & { id: string; parentSessionId: string }): BackgroundTask {
  return {
    id: overrides.id,
    sessionId: overrides.sessionId,
    parentSessionId: overrides.parentSessionId,
    parentMessageId: overrides.parentMessageId ?? "parent-message-id",
    description: overrides.description ?? "test task",
    prompt: overrides.prompt ?? "test prompt",
    agent: overrides.agent ?? "test-agent",
    status: overrides.status ?? "running",
    queuedAt: overrides.queuedAt,
    startedAt: overrides.startedAt ?? new Date(),
    completedAt: overrides.completedAt,
    error: overrides.error,
    model: overrides.model,
    concurrencyKey: overrides.concurrencyKey,
    concurrencyGroup: overrides.concurrencyGroup,
    teamRunId: overrides.teamRunId,
    progress: overrides.progress,
  }
}

describe("scoped cancel APIs", () => {
  // #given a BackgroundManager with tasks
  let manager: BackgroundManager

  // given: manager with two parent sessions and mixed team runs
  test("cancelByParentSession only cancels own session's tasks", async () => {
    // given
    manager = createBackgroundManager()
    const parentA = "parent-session-a"
    const parentB = "parent-session-b"

    const taskA1 = createMockTask({ id: "task-a1", parentSessionId: parentA, status: "running", sessionId: "s-a1" })
    const taskA2 = createMockTask({ id: "task-a2", parentSessionId: parentA, status: "running", sessionId: "s-a2" })
    const taskB1 = createMockTask({ id: "task-b1", parentSessionId: parentB, status: "running", sessionId: "s-b1" })

    // directly add tasks to internal map via getTask bypass
    // BackgroundManager uses addTask for internal tracking, but we can use the internal map for tests
    ;(manager as unknown as { tasks: Map<string, BackgroundTask> }).tasks.set(taskA1.id, taskA1)
    ;(manager as unknown as { tasks: Map<string, BackgroundTask> }).tasks.set(taskA2.id, taskA2)
    ;(manager as unknown as { tasks: Map<string, BackgroundTask> }).tasks.set(taskB1.id, taskB1)

    // when
    const count = await manager.cancelByParentSession(parentA)

    // then
    expect(count).toBe(2)
    expect(taskA1.status).toBe("cancelled")
    expect(taskA2.status).toBe("cancelled")
    expect(taskB1.status).toBe("running") // unchanged
  })

  test("cancelByTeamRun only cancels own team run's tasks", async () => {
    // given
    manager = createBackgroundManager()
    const teamX = "team-run-x"
    const teamY = "team-run-y"
    const parentId = "parent-session-1"

    const taskX1 = createMockTask({ id: "task-x1", parentSessionId: parentId, teamRunId: teamX, status: "running", sessionId: "s-x1" })
    const taskX2 = createMockTask({ id: "task-x2", parentSessionId: parentId, teamRunId: teamX, status: "pending" })
    const taskY1 = createMockTask({ id: "task-y1", parentSessionId: parentId, teamRunId: teamY, status: "running", sessionId: "s-y1" })

    ;(manager as unknown as { tasks: Map<string, BackgroundTask> }).tasks.set(taskX1.id, taskX1)
    ;(manager as unknown as { tasks: Map<string, BackgroundTask> }).tasks.set(taskX2.id, taskX2)
    ;(manager as unknown as { tasks: Map<string, BackgroundTask> }).tasks.set(taskY1.id, taskY1)

    // when
    const count = await manager.cancelByTeamRun(teamX)

    // then
    expect(count).toBe(2)
    expect(taskX1.status).toBe("cancelled")
    expect(taskX2.status).toBe("cancelled")
    expect(taskY1.status).toBe("running") // unchanged
  })

  test("cancelDescendants only cancels descendants of the parent session", async () => {
    // given
    manager = createBackgroundManager()
    const rootSession = "root-session-id"
    const childSession = "child-session-id"
    const grandchildSession = "grandchild-session-id"
    const otherSession = "other-session-id"

    const rootTask = createMockTask({ id: "root-task", parentSessionId: "initial", sessionId: rootSession, status: "running" })
    const childTask = createMockTask({ id: "child-task", parentSessionId: rootSession, sessionId: childSession, status: "running" })
    const grandchildTask = createMockTask({ id: "grandchild-task", parentSessionId: childSession, sessionId: grandchildSession, status: "running" })
    const otherTask = createMockTask({ id: "other-task", parentSessionId: otherSession, status: "running", sessionId: "s-other" })

    ;(manager as unknown as { tasks: Map<string, BackgroundTask> }).tasks.set(rootTask.id, rootTask)
    ;(manager as unknown as { tasks: Map<string, BackgroundTask> }).tasks.set(childTask.id, childTask)
    ;(manager as unknown as { tasks: Map<string, BackgroundTask> }).tasks.set(grandchildTask.id, grandchildTask)
    ;(manager as unknown as { tasks: Map<string, BackgroundTask> }).tasks.set(otherTask.id, otherTask)

    // when
    const count = await manager.cancelDescendants(rootSession)

    // then — cancels children + grandchild, NOT rootTask itself
    expect(count).toBe(2)
    expect(childTask.status).toBe("cancelled")
    expect(grandchildTask.status).toBe("cancelled")
    expect(rootTask.status).toBe("running") // rootTask is NOT a descendant of itself
    expect(otherTask.status).toBe("running") // unrelated
  })

  test("cancelByParentSession skips already completed tasks", async () => {
    // given
    manager = createBackgroundManager()
    const parentId = "parent-session-c"
    const taskRunning = createMockTask({ id: "task-run", parentSessionId: parentId, status: "running", sessionId: "s-run" })
    const taskCompleted = createMockTask({ id: "task-done", parentSessionId: parentId, status: "completed" })

    ;(manager as unknown as { tasks: Map<string, BackgroundTask> }).tasks.set(taskRunning.id, taskRunning)
    ;(manager as unknown as { tasks: Map<string, BackgroundTask> }).tasks.set(taskCompleted.id, taskCompleted)

    // when
    const count = await manager.cancelByParentSession(parentId)

    // then — only running tasks are cancelled
    expect(count).toBe(1)
    expect(taskRunning.status).toBe("cancelled")
    expect(taskCompleted.status).toBe("completed") // skipped
  })
})
