import { describe, it, expect, afterEach } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { HermesBackgroundState } from "./hermes-background-state"
import type { BackgroundTask } from "../background-agent/types"

function createTestDir(): string {
  const dir = join(tmpdir(), `hermes-bg-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

function makeTask(overrides: Partial<BackgroundTask> = {}): BackgroundTask {
  return {
    id: "bg_test123",
    parentSessionId: "ses_parent",
    parentMessageId: "msg_1",
    description: "Test task description",
    prompt: "[redacted prompt]",
    agent: "hephaestus",
    status: "pending",
    queuedAt: new Date("2026-06-03T12:00:00Z"),
    ...overrides,
  } as BackgroundTask
}

describe("HermesBackgroundState", () => {
  let testDir: string
  let bgState: HermesBackgroundState

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }) } catch { /* cleanup */ }
  })

  // given a fresh project directory
  // when a task is tracked
  // then the task appears in the written state file after flush
  it("writes background-tasks.json after tracking a task", () => {
    testDir = createTestDir()
    bgState = new HermesBackgroundState(testDir)
    const task = makeTask()
    bgState.trackTask(task)
    bgState.flush()
    const filePath = join(testDir, ".opencode", "state", "background-tasks.json")
    expect(existsSync(filePath)).toBe(true)
    const content = JSON.parse(readFileSync(filePath, "utf-8"))
    expect(content.schema_version).toBe(1)
    expect(content.active).toHaveLength(1)
    expect(content.active[0].id).toBe("bg_test123")
    expect(content.active[0].status).toBe("queued")
    expect(content.active[0].agent).toBe("hephaestus")
  })

  // given a task that starts, runs, and completes
  // when updateTask is called at each lifecycle step
  // then the state reflects the final status in history
  it("transitions task through lifecycle stages", () => {
    testDir = createTestDir()
    bgState = new HermesBackgroundState(testDir)
    const task = makeTask()
    bgState.trackTask(task)
    // start
    task.status = "running"
    task.sessionId = "ses_child"
    task.startedAt = new Date("2026-06-03T12:00:05Z")
    bgState.updateTask(task)
    bgState.emitTaskEvent("task.started", task)
    // complete
    task.status = "completed"
    task.completedAt = new Date("2026-06-03T12:01:00Z")
    bgState.updateTask(task)
    bgState.emitTaskEvent("task.completed", task)
    bgState.flush()
    const filePath = join(testDir, ".opencode", "state", "background-tasks.json")
    const content = JSON.parse(readFileSync(filePath, "utf-8"))
    expect(content.active).toHaveLength(0)
    expect(content.history).toHaveLength(1)
    expect(content.history[0].id).toBe("bg_test123")
    expect(content.history[0].status).toBe("completed")
    expect(content.history[0].sessionId).toBe("ses_child")
  })

  // given a task with error
  // when updateTask is called with error status
  // then the history entry includes the error message
  it("records error tasks with error message", () => {
    testDir = createTestDir()
    bgState = new HermesBackgroundState(testDir)
    const task = makeTask({ status: "running", sessionId: "ses_e1" })
    task.status = "error"
    task.error = "Model rate limit exceeded"
    task.completedAt = new Date()
    bgState.updateTask(task)
    bgState.flush()
    const filePath = join(testDir, ".opencode", "state", "background-tasks.json")
    const content = JSON.parse(readFileSync(filePath, "utf-8"))
    expect(content.history[0].status).toBe("error")
    expect(content.history[0].error).toBe("Model rate limit exceeded")
  })

  // given a task that gets cancelled
  // when updateTask is called with cancelled status
  // then the status maps correctly
  it("maps internal interrupt status to cancelled", () => {
    testDir = createTestDir()
    bgState = new HermesBackgroundState(testDir)
    const task = makeTask({ status: "interrupt" })
    bgState.trackTask(task)
    bgState.flush()
    const filePath = join(testDir, ".opencode", "state", "background-tasks.json")
    const content = JSON.parse(readFileSync(filePath, "utf-8"))
    expect(content.history[0].status).toBe("cancelled")
  })

  // given a task lifecycle
  // when emitTaskEvent is called
  // then a JSONL event is appended to the daily events file
  it("emits task lifecycle JSONL events", () => {
    testDir = createTestDir()
    bgState = new HermesBackgroundState(testDir)
    const task = makeTask({ status: "running", sessionId: "ses_child" })
    bgState.emitTaskEvent("task.queued", task)
    bgState.emitTaskEvent("task.started", task)
    task.status = "completed"
    task.completedAt = new Date()
    bgState.emitTaskEvent("task.completed", task)
    const dateStr = new Date().toISOString().slice(0, 10)
    const eventsPath = join(testDir, ".opencode", "state", "events", `events-${dateStr}.jsonl`)
    expect(existsSync(eventsPath)).toBe(true)
    const lines = readFileSync(eventsPath, "utf-8").trim().split("\n")
    expect(lines).toHaveLength(3)
    expect(JSON.parse(lines[0]).type).toBe("task.queued")
    expect(JSON.parse(lines[1]).type).toBe("task.started")
    expect(JSON.parse(lines[2]).type).toBe("task.completed")
  })
})
