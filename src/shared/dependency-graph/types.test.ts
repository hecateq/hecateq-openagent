const { describe, expect, test } = require("bun:test")

const {
  DependencyGraphSchema,
  DependencyStageSchema,
  StageStatusSchema,
  CreateDependencyGraphInputSchema,
  getCompletedStageIds,
  getFailedStageIds,
  validateTaskGraph,
} = require("./types")

describe("StageStatusSchema", () => {
  test("#given valid status #when parsed #then returns the value", () => {
    expect(StageStatusSchema.parse("pending")).toBe("pending")
    expect(StageStatusSchema.parse("in_progress")).toBe("in_progress")
    expect(StageStatusSchema.parse("completed")).toBe("completed")
    expect(StageStatusSchema.parse("failed")).toBe("failed")
    expect(StageStatusSchema.parse("blocked")).toBe("blocked")
  })

  test("#given invalid status #when parsed #then throws", () => {
    expect(() => StageStatusSchema.parse("unknown")).toThrow()
    expect(() => StageStatusSchema.parse("done")).toThrow()
  })
})

describe("DependencyStageSchema", () => {
  test("#given minimal valid input #when parsed #then defaults are applied", () => {
    const stage = DependencyStageSchema.parse({ id: "s1", label: "Stage 1" })
    expect(stage.id).toBe("s1")
    expect(stage.label).toBe("Stage 1")
    expect(stage.status).toBe("pending")
    expect(stage.depends_on).toEqual([])
    expect(stage.metadata).toBeUndefined()
  })

  test("#given full input with depends_on #when parsed #then all fields match", () => {
    const stage = DependencyStageSchema.parse({
      id: "s2",
      label: "Stage 2",
      status: "in_progress",
      depends_on: ["s1"],
      metadata: { owner: "sisyphus" },
    })
    expect(stage.id).toBe("s2")
    expect(stage.status).toBe("in_progress")
    expect(stage.depends_on).toEqual(["s1"])
    expect(stage.metadata).toEqual({ owner: "sisyphus" })
  })

  test("#given empty id #when parsed #then throws", () => {
    expect(() => DependencyStageSchema.parse({ id: "", label: "X" })).toThrow()
  })
})

describe("DependencyGraphSchema", () => {
  const validGraph = {
    id: "graph-1",
    label: "Test Graph",
    stages: [
      { id: "s1", label: "Stage 1", status: "completed", depends_on: [] },
      { id: "s2", label: "Stage 2", status: "pending", depends_on: ["s1"] },
    ],
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T01:00:00.000Z",
  }

  test("#given valid graph #when parsed #then succeeds", () => {
    const graph = DependencyGraphSchema.parse(validGraph)
    expect(graph.id).toBe("graph-1")
    expect(graph.stages).toHaveLength(2)
    expect(graph.stages[0].status).toBe("completed")
    expect(graph.stages[1].depends_on).toEqual(["s1"])
  })

  test("#given graph without stages #when parsed #then defaults to empty array", () => {
    const minimal = {
      id: "g2",
      label: "Minimal",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    }
    const graph = DependencyGraphSchema.parse(minimal)
    expect(graph.stages).toEqual([])
  })

  test("#given corrupt graph #when parsed #then throws", () => {
    expect(() =>
      DependencyGraphSchema.parse({ id: "bad", label: "Bad" })
    ).toThrow()
  })
})

describe("CreateDependencyGraphInputSchema", () => {
  test("#given valid input #when parsed #then defaults applied", () => {
    const input = CreateDependencyGraphInputSchema.parse({
      id: "g1",
      label: "New Graph",
    })
    expect(input.id).toBe("g1")
    expect(input.stages).toEqual([])
    expect(input.metadata).toBeUndefined()
  })

  test("#given input with stages and metadata #when parsed #then all present", () => {
    const input = CreateDependencyGraphInputSchema.parse({
      id: "g2",
      label: "Rich Graph",
      stages: [{ id: "x", label: "X", depends_on: [] }],
      metadata: { project: "foo" },
    })
    expect(input.stages).toHaveLength(1)
    expect(input.metadata).toEqual({ project: "foo" })
  })
})

describe("getCompletedStageIds", () => {
  test("#given mixed stages #when called #then returns only completed ids", () => {
    const stages = [
      { id: "s1", label: "S1", status: "completed" as const, depends_on: [] as string[] },
      { id: "s2", label: "S2", status: "pending" as const, depends_on: [] as string[] },
      { id: "s3", label: "S3", status: "failed" as const, depends_on: [] as string[] },
      { id: "s4", label: "S4", status: "completed" as const, depends_on: [] as string[] },
    ]
    expect(getCompletedStageIds(stages)).toEqual(["s1", "s4"])
  })

  test("#given no completed stages #when called #then returns empty array", () => {
    const stages = [
      { id: "s1", label: "S1", status: "pending" as const, depends_on: [] as string[] },
      { id: "s2", label: "S2", status: "failed" as const, depends_on: [] as string[] },
    ]
    expect(getCompletedStageIds(stages)).toEqual([])
  })
})

describe("getFailedStageIds", () => {
  test("#given mixed stages #when called #then returns failed and blocked ids", () => {
    const stages = [
      { id: "s1", label: "S1", status: "completed" as const, depends_on: [] as string[] },
      { id: "s2", label: "S2", status: "failed" as const, depends_on: [] as string[] },
      { id: "s3", label: "S3", status: "blocked" as const, depends_on: [] as string[] },
      { id: "s4", label: "S4", status: "pending" as const, depends_on: [] as string[] },
    ]
    expect(getFailedStageIds(stages)).toEqual(["s2", "s3"])
  })
})

describe("validateTaskGraph", () => {
  test("#given empty graph #when validated #then returns invalid with empty_graph error", () => {
    const result = validateTaskGraph([])
    expect(result.valid).toBe(false)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].kind).toBe("empty_graph")
  })

  test("#given duplicate node ids #when validated #then returns invalid with duplicate_node error", () => {
    const stages = [
      { id: "a", label: "A", depends_on: [] },
      { id: "a", label: "A Duplicate", depends_on: [] },
      { id: "b", label: "B", depends_on: [] },
    ] as any
    const result = validateTaskGraph(stages)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.kind === "duplicate_node")).toBe(true)
    expect(result.errors.some((e) => e.nodeIds?.includes("a"))).toBe(true)
  })

  test("#given missing dependency #when validated #then returns invalid with missing_dependency error", () => {
    const stages = [
      { id: "a", label: "A", depends_on: [] },
      { id: "b", label: "B", depends_on: ["c"] },
    ] as any
    const result = validateTaskGraph(stages)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.kind === "missing_dependency")).toBe(true)
    expect(result.errors.some((e) => e.nodeIds?.includes("c"))).toBe(true)
  })

  test("#given circular dependency #when validated #then returns invalid with circular_dependency error", () => {
    const stages = [
      { id: "a", label: "A", depends_on: ["b"] },
      { id: "b", label: "B", depends_on: ["a"] },
    ] as any
    const result = validateTaskGraph(stages)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.kind === "circular_dependency")).toBe(true)
  })

  test("#given valid graph with chain of dependencies #when validated #then returns valid with no errors", () => {
    const stages = [
      { id: "a", label: "A", depends_on: [] },
      { id: "b", label: "B", depends_on: ["a"] },
      { id: "c", label: "C", depends_on: ["b"] },
      { id: "d", label: "D", depends_on: ["a", "c"] },
    ] as any
    const result = validateTaskGraph(stages)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  test("#given valid graph with no dependencies #when validated #then returns valid", () => {
    const stages = [
      { id: "a", label: "A", depends_on: [] },
      { id: "b", label: "B", depends_on: [] },
    ] as any
    const result = validateTaskGraph(stages)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  test("#given graph with self-dependency #when validated #then detects circular dependency", () => {
    const stages = [
      { id: "a", label: "A", depends_on: ["a"] },
    ] as any
    const result = validateTaskGraph(stages)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.kind === "circular_dependency")).toBe(true)
  })
})
