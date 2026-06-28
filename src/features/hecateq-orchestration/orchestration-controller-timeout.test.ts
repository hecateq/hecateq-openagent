import { describe, expect, test } from "bun:test"
import { enforceInProgressTimeout } from "./orchestration-controller"
import type { OrchestrationSessionState, TaskNode } from "./types"

function createTask(id: string, status: TaskNode["status"], enteredInProgressAt?: string): TaskNode {
  return {
    id,
    label: `Task ${id}`,
    prompt: `Do ${id}`,
    domain: "backend",
    action: "both",
    dependsOn: [],
    status,
    enteredInProgressAt,
  }
}

function createState(tasks: TaskNode[]): OrchestrationSessionState {
  return {
    id: "orch_test",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    prompt: "test prompt",
    phase: "execute",
    tasks,
    batches: [],
    agentAssignments: [],
    completed: false,
    failed: false,
  }
}

describe("enforceInProgressTimeout", () => {
  const config = { defaultTaskTimeoutMs: 5000 } // 5 second timeout

  test("#given task in_progress within timeout #then NOT blocked", () => {
    // given: task entered in_progress 1 second ago
    const now = new Date()
    const oneSecAgo = new Date(now.getTime() - 1000).toISOString()
    const task = createTask("task_1", "in_progress", oneSecAgo)
    const state = createState([task])

    // when
    const result = enforceInProgressTimeout(state, config, now)

    // then: task still in_progress
    expect(result.tasks[0].status).toBe("in_progress")
    expect(result.tasks[0].error).toBeUndefined()
    expect(result.inProgressTimeoutTotal ?? 0).toBe(0)
  })

  test("#given task in_progress beyond timeout #then transitioned to BLOCKED with reason IN_PROGRESS_TIMEOUT", () => {
    // given: task entered in_progress 10 seconds ago (5s timeout)
    const now = new Date()
    const tenSecAgo = new Date(now.getTime() - 10000).toISOString()
    const task = createTask("task_2", "in_progress", tenSecAgo)
    const state = createState([task])

    // when
    const result = enforceInProgressTimeout(state, config, now)

    // then
    expect(result.tasks[0].status).toBe("blocked")
    expect(result.tasks[0].error).toContain("IN_PROGRESS_TIMEOUT")
    expect(result.inProgressTimeoutTotal).toBe(1)
  })

  test("#given task in_progress without enteredInProgressAt #then NOT blocked (no timestamp)", () => {
    // given: task entered in_progress but no timestamp recorded
    const now = new Date()
    const task = createTask("task_3", "in_progress")
    const state = createState([task])

    // when
    const result = enforceInProgressTimeout(state, config, now)

    // then: task stays in_progress (no timestamp = can't calculate elapsed)
    expect(result.tasks[0].status).toBe("in_progress")
    expect(result.inProgressTimeoutTotal ?? 0).toBe(0)
  })

  test("#given task already completed #then NOT affected", () => {
    const now = new Date()
    const tenSecAgo = new Date(now.getTime() - 10000).toISOString()
    const task = createTask("task_4", "completed", tenSecAgo)
    const state = createState([task])

    // when
    const result = enforceInProgressTimeout(state, config, now)

    // then: task stays completed
    expect(result.tasks[0].status).toBe("completed")
  })

  test("#given mixed tasks (some timed out, some not) #then only timed-out tasks blocked", () => {
    const now = new Date()
    const tenSecAgo = new Date(now.getTime() - 10000).toISOString()
    const oneSecAgo = new Date(now.getTime() - 1000).toISOString()

    const tasks = [
      createTask("t1", "in_progress", tenSecAgo),   // timed out
      createTask("t2", "in_progress", oneSecAgo),    // still ok
      createTask("t3", "completed"),                  // not in_progress
      createTask("t4", "in_progress"),                // no timestamp
    ]
    const state = createState(tasks)

    // when
    const result = enforceInProgressTimeout(state, config, now)

    // then
    expect(result.tasks[0].status).toBe("blocked")      // t1 timed out
    expect(result.tasks[1].status).toBe("in_progress")   // t2 still ok
    expect(result.tasks[2].status).toBe("completed")     // t3 unchanged
    expect(result.tasks[3].status).toBe("in_progress")   // t4 no timestamp
    expect(result.inProgressTimeoutTotal).toBe(1)
  })

  test("#given inProgressTimeoutTotal increments across calls", () => {
    const now = new Date()
    const tenSecAgo = new Date(now.getTime() - 10000).toISOString()
    const task = createTask("task_5", "in_progress", tenSecAgo)
    let state = createState([task])

    // First call: times out task_5
    state = enforceInProgressTimeout(state, config, now)
    expect(state.inProgressTimeoutTotal).toBe(1)

    // Add a new task that's also timed out
    const newTask = createTask("task_6", "in_progress", tenSecAgo)
    state = { ...state, tasks: [...state.tasks, newTask] }

    // Second call: catches task_6
    state = enforceInProgressTimeout(state, config, now)
    expect(state.inProgressTimeoutTotal).toBe(2) // 1 (from first call) + 1 (new)
  })
})
