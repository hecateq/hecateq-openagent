const { describe, expect, test } = require("bun:test")

const {
  canDelegate,
  getReadyStages,
  getBlockedStages,
  getDependencyChain,
  allDepsMet,
} = require("./resolver")

function makeGraph(stages: Array<{
  id: string
  label?: string
  status?: "pending" | "in_progress" | "completed" | "failed" | "blocked"
  depends_on?: string[]
}>) {
  return {
    id: "test-graph",
    label: "Test Graph",
    stages: stages.map((s) => ({
      id: s.id,
      label: s.label ?? s.id,
      status: s.status ?? "pending",
      depends_on: s.depends_on ?? [],
    })),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

describe("canDelegate", () => {
  test("#given stage with no dependencies #when checking #then allowed", () => {
    const graph = makeGraph([
      { id: "s1", status: "completed" },
      { id: "s2", status: "pending", depends_on: [] },
    ])
    const result = canDelegate(graph, "s2", false)
    expect(result.allowed).toBe(true)
  })

  test("#given stage with all deps completed #when checking #then allowed", () => {
    const graph = makeGraph([
      { id: "s1", status: "completed" },
      { id: "s2", status: "pending", depends_on: ["s1"] },
    ])
    const result = canDelegate(graph, "s2", false)
    expect(result.allowed).toBe(true)
  })

  test("#given stage with uncompleted deps #when enforce=false #then allowed with warning", () => {
    const graph = makeGraph([
      { id: "s1", status: "pending" },
      { id: "s2", status: "pending", depends_on: ["s1"] },
    ])
    const result = canDelegate(graph, "s2", false)
    expect(result.allowed).toBe(true)
    expect(result.reason).toContain("Warning")
    expect(result.unmet_dependencies).toEqual(["s1"])
  })

  test("#given stage with uncompleted deps #when enforce=true #then blocked", () => {
    const graph = makeGraph([
      { id: "s1", status: "pending" },
      { id: "s2", status: "pending", depends_on: ["s1"] },
    ])
    const result = canDelegate(graph, "s2", true)
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain("Cannot delegate")
    expect(result.unmet_dependencies).toEqual(["s1"])
  })

  test("#given stage with failed dep #when enforce=true #then blocked with failure message", () => {
    const graph = makeGraph([
      { id: "s1", status: "failed" },
      { id: "s2", status: "pending", depends_on: ["s1"] },
    ])
    const result = canDelegate(graph, "s2", true)
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain("failed")
  })

  test("#given already completed stage #when checking #then not allowed", () => {
    const graph = makeGraph([
      { id: "s1", status: "completed" },
    ])
    const result = canDelegate(graph, "s1", false)
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain("already completed")
  })

  test("#given nonexistent stage #when checking #then not allowed", () => {
    const graph = makeGraph([])
    const result = canDelegate(graph, "no-such-stage", false)
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain("not found")
  })
})

describe("getReadyStages", () => {
  test("#given independent pending stages #when called #then returns them all", () => {
    const graph = makeGraph([
      { id: "s1", status: "pending" },
      { id: "s2", status: "pending" },
    ])
    const ready = getReadyStages(graph)
    expect(ready).toHaveLength(2)
  })

  test("#given stage waiting on completed dep #when deps met #then ready", () => {
    const graph = makeGraph([
      { id: "s1", status: "completed" },
      { id: "s2", status: "pending", depends_on: ["s1"] },
    ])
    const ready = getReadyStages(graph)
    expect(ready).toHaveLength(1)
    expect(ready[0].id).toBe("s2")
  })

  test("#given stage waiting on pending dep #when deps not met #then not ready", () => {
    const graph = makeGraph([
      { id: "s1", status: "pending" },
      { id: "s2", status: "pending", depends_on: ["s1"] },
    ])
    expect(getReadyStages(graph)).toHaveLength(1)
    expect(getReadyStages(graph)[0].id).toBe("s1")
  })

  test("#given stage with failed dep #when checking #then not ready", () => {
    const graph = makeGraph([
      { id: "s1", status: "failed" },
      { id: "s2", status: "pending", depends_on: ["s1"] },
    ])
    expect(getReadyStages(graph)).toHaveLength(0)
  })

  test("#given completed stage #when checking #then not included in ready", () => {
    const graph = makeGraph([
      { id: "s1", status: "completed" },
    ])
    expect(getReadyStages(graph)).toHaveLength(0)
  })
})

describe("getBlockedStages", () => {
  test("#given stage with failed dep #when checking #then blocked", () => {
    const graph = makeGraph([
      { id: "s1", status: "failed" },
      { id: "s2", status: "pending", depends_on: ["s1"] },
    ])
    const blocked = getBlockedStages(graph)
    expect(blocked).toHaveLength(1)
    expect(blocked[0].id).toBe("s2")
  })

  test("#given completed stage with failed dep #when checking #then not blocked", () => {
    const graph = makeGraph([
      { id: "s1", status: "failed" },
      { id: "s2", status: "completed", depends_on: ["s1"] },
    ])
    expect(getBlockedStages(graph)).toHaveLength(0)
  })

  test("#given independent stages #when no failures #then none blocked", () => {
    const graph = makeGraph([
      { id: "s1", status: "pending" },
      { id: "s2", status: "in_progress" },
    ])
    expect(getBlockedStages(graph)).toHaveLength(0)
  })
})

describe("getDependencyChain", () => {
  test("#given stage with chain #when called #then returns transitive deps", () => {
    const graph = makeGraph([
      { id: "s1", status: "completed" },
      { id: "s2", status: "completed", depends_on: ["s1"] },
      { id: "s3", status: "pending", depends_on: ["s2"] },
    ])
    const chain = getDependencyChain(graph, "s3")
    const ids = chain.map((s) => s.id)
    expect(ids).toContain("s3")
    expect(ids).toContain("s2")
    expect(ids).toContain("s1")
  })

  test("#given stage with no deps #when called #then returns just the stage", () => {
    const graph = makeGraph([
      { id: "s1", status: "pending" },
    ])
    const chain = getDependencyChain(graph, "s1")
    expect(chain).toHaveLength(1)
    expect(chain[0].id).toBe("s1")
  })
})

describe("allDepsMet", () => {
  test("#given all deps completed #when checking #then returns true", () => {
    const graph = makeGraph([
      { id: "s1", status: "completed" },
      { id: "s2", status: "pending", depends_on: ["s1"] },
    ])
    expect(allDepsMet(graph, "s2")).toBe(true)
  })

  test("#given pending dep #when checking #then returns false", () => {
    const graph = makeGraph([
      { id: "s1", status: "pending" },
      { id: "s2", status: "pending", depends_on: ["s1"] },
    ])
    expect(allDepsMet(graph, "s2")).toBe(false)
  })

  test("#given no deps #when checking #then returns true", () => {
    const graph = makeGraph([
      { id: "s1", status: "pending" },
    ])
    expect(allDepsMet(graph, "s1")).toBe(true)
  })
})
