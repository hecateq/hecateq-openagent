import { describe, expect, test } from "bun:test"
import {
  TaskGraphSchema,
  TaskNodeSchema,
  validateTaskGraph,
} from "./task-graph-schema"

const RUNTIME_AGENTS = new Set(["planner", "reviewer", "executor", "tester"])

function makeGraph(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "g1",
    goal: "Build a feature",
    created_at: "2026-08-08T00:00:00.000Z",
    tasks: [
      {
        id: "t1",
        title: "Plan",
        description: "Write the plan",
        subagent_type: "planner",
        depends_on: [],
        status: "pending",
      },
      {
        id: "t2",
        title: "Execute",
        description: "Execute the plan",
        subagent_type: "executor",
        depends_on: ["t1"],
        status: "pending",
      },
    ],
    ...overrides,
  }
}

describe("validateTaskGraph", () => {
  test("#given a valid DAG #then accepts it", () => {
    // given
    const graph = makeGraph()
    // when
    const result = validateTaskGraph(graph, RUNTIME_AGENTS)
    // then
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.graph.id).toBe("g1")
      expect(result.graph.tasks).toHaveLength(2)
    }
  })

  test("#given a cyclic DAG #then rejects it with cycle error", () => {
    // given
    const graph = makeGraph({
      tasks: [
        {
          id: "t1",
          title: "A",
          description: "A",
          subagent_type: "planner",
          depends_on: ["t2"],
        },
        {
          id: "t2",
          title: "B",
          description: "B",
          subagent_type: "executor",
          depends_on: ["t1"],
        },
      ],
    })
    // when
    const result = validateTaskGraph(graph, RUNTIME_AGENTS)
    // then
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.join("\n")).toMatch(/cycle/i)
    }
  })

  test("#given an unknown dependency #then rejects it", () => {
    // given
    const graph = makeGraph({
      tasks: [
        {
          id: "t1",
          title: "A",
          description: "A",
          subagent_type: "planner",
          depends_on: [],
        },
        {
          id: "t2",
          title: "B",
          description: "B",
          subagent_type: "executor",
          depends_on: ["does-not-exist"],
        },
      ],
    })
    // when
    const result = validateTaskGraph(graph, RUNTIME_AGENTS)
    // then
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.join("\n")).toMatch(/unknown task "does-not-exist"/)
    }
  })

  test("#given duplicate task ids #then rejects them", () => {
    // given
    const graph = makeGraph({
      tasks: [
        {
          id: "t1",
          title: "A",
          description: "A",
          subagent_type: "planner",
          depends_on: [],
        },
        {
          id: "t1",
          title: "A again",
          description: "A again",
          subagent_type: "executor",
          depends_on: [],
        },
      ],
    })
    // when
    const result = validateTaskGraph(graph, RUNTIME_AGENTS)
    // then
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.join("\n")).toMatch(/duplicate task id/)
    }
  })

  test("#given a self-dependency #then rejects it", () => {
    // given
    const graph = makeGraph({
      tasks: [
        {
          id: "t1",
          title: "A",
          description: "A",
          subagent_type: "planner",
          depends_on: ["t1"],
        },
      ],
    })
    // when
    const result = validateTaskGraph(graph, RUNTIME_AGENTS)
    // then
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.join("\n")).toMatch(/depend on itself/)
    }
  })

  test("#given a subagent_type not in the runtime registry #then rejects it", () => {
    // given
    const graph = makeGraph({
      tasks: [
        {
          id: "t1",
          title: "A",
          description: "A",
          subagent_type: "ghost-agent",
          depends_on: [],
        },
      ],
    })
    // when
    const result = validateTaskGraph(graph, RUNTIME_AGENTS)
    // then
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.join("\n")).toMatch(/not in the runtime agent registry/)
    }
  })

  test("#given a graph with missing fields #then Zod rejects it", () => {
    // given
    const graph = { id: "g1", goal: "no tasks here" }
    // when
    const result = validateTaskGraph(graph, RUNTIME_AGENTS)
    // then
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0)
    }
  })

  test("#given a graph with multiple structural errors #then returns ALL errors", () => {
    // given
    const graph = makeGraph({
      tasks: [
        {
          id: "t1",
          title: "A",
          description: "A",
          subagent_type: "ghost",
          depends_on: ["nope"],
        },
        {
          id: "t1",
          title: "B",
          description: "B",
          subagent_type: "planner",
          depends_on: ["t1"],
        },
      ],
    })
    // when
    const result = validateTaskGraph(graph, RUNTIME_AGENTS)
    // then
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThanOrEqual(4)
    }
  })
})

describe("TaskGraphSchema", () => {
  test("#given a valid graph #then parses with defaults", () => {
    // given
    const raw = makeGraph({
      tasks: [{ id: "t1", title: "A", description: "A", subagent_type: "planner" }],
    })
    // when
    const parsed = TaskGraphSchema.safeParse(raw)
    // then
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.tasks[0]?.status).toBe("pending")
      expect(parsed.data.tasks[0]?.depends_on).toEqual([])
    }
  })

  test("#given missing required fields #then rejects", () => {
    // given
    const bad = { id: "g1", tasks: [] }
    // when
    const parsed = TaskGraphSchema.safeParse(bad)
    // then
    expect(parsed.success).toBe(false)
  })
})

describe("TaskNodeSchema", () => {
  test("#given a task node missing subagent_type #then rejects", () => {
    // given
    const node = { id: "t1", title: "A", description: "A" }
    // when
    const parsed = TaskNodeSchema.safeParse(node)
    // then
    expect(parsed.success).toBe(false)
  })
})
