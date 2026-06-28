/// <reference types="bun-types" />

import { describe, test, expect } from "bun:test"
import { createBackgroundCancel } from "./create-background-cancel"
import type { BackgroundManager } from "../../features/background-agent"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import type { BackgroundCancelClient } from "./types"
import { unsafeTestValue } from "../../testing/unsafe-test-value"

const projectDir = "/tmp/test-project"

const mockContext: ToolContext = {
  sessionID: "test-session",
  messageID: "test-message",
  agent: "test-agent",
  directory: projectDir,
  worktree: projectDir,
  abort: new AbortController().signal,
  metadata: () => {},
  ask: async () => {},
}

function createTask(overrides: Partial<{
  id: string
  sessionId: string
  parentSessionId: string
  parentMessageId: string
  description: string
  prompt: string
  agent: string
  status: string
}> = {}) {
  return {
    id: "bg_running_1",
    sessionId: "ses-1",
    parentSessionId: "main-1",
    parentMessageId: "msg-1",
    description: "background task",
    prompt: "do work",
    agent: "test-agent",
    status: "running",
    ...overrides,
  }
}

describe("background_cancel hardening", () => {
  describe("public schema", () => {
    test("#given tool args #then does NOT expose `all` parameter", async () => {
      // #given the createBackgroundCancel tool factory
      const manager = unsafeTestValue<BackgroundManager>({
        getTask: () => undefined,
        getAllDescendantTasks: () => [],
        cancelTask: async () => true,
      })
      const client = { session: { abort: async () => ({}) } } as BackgroundCancelClient
      const tool = createBackgroundCancel(manager, client)

      // #when — inspect the tool definition's args schema
      const args = (tool as Record<string, unknown>).args as Record<string, unknown> | undefined

      // #then — `all` must NOT be in the args schema
      // After hardening, the public schema no longer exposes `all`.
      // If `all` is still present, this test will fail — that means hardening is incomplete.
      if (args) {
        expect(args).not.toHaveProperty("all")
      }
    })
  })

  describe("legacy all: true support", () => {
    test("#given all: true (legacy) #then returns GLOBAL_BACKGROUND_CANCEL_FORBIDDEN error", async () => {
      // #given a manager with running tasks
      const task = createTask({ id: "bg_task_a", status: "running" })
      const manager = unsafeTestValue<BackgroundManager>({
        getTask: () => undefined,
        getAllDescendantTasks: () => [task],
        cancelTask: async () => true,
      })
      const client = { session: { abort: async () => ({}) } } as BackgroundCancelClient
      const tool = createBackgroundCancel(manager, client)

      // #when — calling with legacy all: true
      const output = await tool.execute({ all: true } as never, mockContext)

      // #then — must return the typed error containing GLOBAL_BACKGROUND_CANCEL_FORBIDDEN
      expect(output).toContain("GLOBAL_BACKGROUND_CANCEL_FORBIDDEN")
    })
  })

  describe("taskId-based cancel", () => {
    test("#given running taskId #then returns success", async () => {
      // #given a running task
      const task = createTask({ id: "bg_running_1", status: "running" })
      const cancelled: string[] = []
      const manager = unsafeTestValue<BackgroundManager>({
        getTask: (id: string) => (id === task.id ? task : undefined),
        getAllDescendantTasks: () => [task],
        cancelTask: async (taskId: string) => {
          cancelled.push(taskId)
          task.status = "cancelled"
          return true
        },
      })
      const client = { session: { abort: async () => ({}) } } as BackgroundCancelClient
      const tool = createBackgroundCancel(manager, client)

      // #when
      const output = await tool.execute({ taskId: "bg_running_1" }, mockContext)

      // #then
      expect(cancelled).toEqual(["bg_running_1"])
      expect(output).toContain("Task cancelled successfully")
    })

    test("#given already-completed taskId #then returns clear error", async () => {
      // #given a completed task
      const task = createTask({ id: "bg_completed_1", status: "completed" })
      const manager = unsafeTestValue<BackgroundManager>({
        getTask: (id: string) => (id === task.id ? task : undefined),
        getAllDescendantTasks: () => [task],
        cancelTask: async () => true,
      })
      const client = { session: { abort: async () => ({}) } } as BackgroundCancelClient
      const tool = createBackgroundCancel(manager, client)

      // #when
      const output = await tool.execute({ taskId: "bg_completed_1" }, mockContext)

      // #then
      expect(output).toContain("[ERROR]")
      expect(output).toContain("completed")
      expect(output).toContain("Only running or pending tasks can be cancelled")
    })

    test("#given unknown taskId #then returns not-found error", async () => {
      // #given manager that doesn't know the task
      const manager = unsafeTestValue<BackgroundManager>({
        getTask: () => undefined,
        getAllDescendantTasks: () => [],
        cancelTask: async () => true,
      })
      const client = { session: { abort: async () => ({}) } } as BackgroundCancelClient
      const tool = createBackgroundCancel(manager, client)

      // #when
      const output = await tool.execute({ taskId: "bg_unknown" }, mockContext)

      // #then
      expect(output).toContain("[ERROR]")
      expect(output).toContain("Task not found")
    })

    test("#given no taskId and no all #then returns invalid-arguments error", async () => {
      // #given empty args
      const manager = unsafeTestValue<BackgroundManager>({
        getTask: () => undefined,
        getAllDescendantTasks: () => [],
        cancelTask: async () => true,
      })
      const client = { session: { abort: async () => ({}) } } as BackgroundCancelClient
      const tool = createBackgroundCancel(manager, client)

      // #when — call with neither taskId nor all
      const output = await tool.execute({} as never, mockContext)

      // #then
      expect(output).toContain("[ERROR]")
      expect(output).toContain("Invalid arguments")
    })
  })
})
