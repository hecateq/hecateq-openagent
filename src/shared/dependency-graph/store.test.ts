const { describe, expect, test, beforeEach, afterEach } = require("bun:test")
const { existsSync, mkdirSync, rmSync } = require("node:fs")
const { join } = require("node:path")
const { tmpdir } = require("node:os")
const { randomUUID } = require("node:crypto")

const { createDependencyGraphStore } = require("./store")

function createTempBaseDir(): string {
  const dir = join(tmpdir(), `dep-graph-test-${randomUUID()}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

describe("DependencyGraphStore", () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = createTempBaseDir()
  })

  afterEach(() => {
    try {
      rmSync(baseDir, { recursive: true, force: true })
    } catch {
      // best-effort cleanup
    }
  })

  describe("getGraph", () => {
    test("#given no saved graph #when getting #then returns null", () => {
      const store = createDependencyGraphStore({ baseDir })
      expect(store.getGraph("nonexistent")).toBeNull()
    })

    test("#given saved graph #when getting #then returns the graph", () => {
      const store = createDependencyGraphStore({ baseDir })
      const graph = {
        id: "test-graph",
        label: "Test",
        stages: [{ id: "s1", label: "S1", status: "pending" as const, depends_on: [] as string[] }],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      store.saveGraph(graph)
      const loaded = store.getGraph("test-graph")
      expect(loaded).not.toBeNull()
      expect(loaded!.id).toBe("test-graph")
      expect(loaded!.stages).toHaveLength(1)
    })
  })

  describe("saveGraph", () => {
    test("#given graph with stages #when saved and loaded #then stages are preserved", () => {
      const store = createDependencyGraphStore({ baseDir })
      const graph = {
        id: "save-test",
        label: "Save Test",
        stages: [
          { id: "a", label: "A", status: "completed" as const, depends_on: [] as string[] },
          { id: "b", label: "B", status: "pending" as const, depends_on: ["a"] },
        ],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      store.saveGraph(graph)
      const loaded = store.getGraph("save-test")
      expect(loaded!.stages).toHaveLength(2)
      expect(loaded!.stages[0].depends_on).toEqual([])
      expect(loaded!.stages[1].depends_on).toEqual(["a"])
    })
  })

  describe("listGraphs", () => {
    test("#given multiple graphs #when listing #then returns all ids", () => {
      const store = createDependencyGraphStore({ baseDir })
      const now = new Date().toISOString()
      store.saveGraph({ id: "g1", label: "G1", stages: [], created_at: now, updated_at: now })
      store.saveGraph({ id: "g2", label: "G2", stages: [], created_at: now, updated_at: now })
      const ids = store.listGraphs()
      expect(ids).toContain("g1")
      expect(ids).toContain("g2")
    })

    test("#given empty store #when listing #then returns empty array", () => {
      const store = createDependencyGraphStore({ baseDir })
      expect(store.listGraphs()).toEqual([])
    })
  })

  describe("deleteGraph", () => {
    test("#given saved graph #when deleted #then get returns null", () => {
      const store = createDependencyGraphStore({ baseDir })
      const now = new Date().toISOString()
      store.saveGraph({ id: "del-test", label: "Delete Me", stages: [], created_at: now, updated_at: now })
      expect(store.getGraph("del-test")).not.toBeNull()
      store.deleteGraph("del-test")
      expect(store.getGraph("del-test")).toBeNull()
    })
  })

  describe("updateStageStatus", () => {
    test("#given graph with stage #when updating status #then stage status changes", () => {
      const store = createDependencyGraphStore({ baseDir })
      const now = new Date().toISOString()
      store.saveGraph({
        id: "update-test",
        label: "Update Test",
        stages: [{ id: "x", label: "X", status: "pending" as const, depends_on: [] as string[] }],
        created_at: now,
        updated_at: now,
      })
      const result = store.updateStageStatus("update-test", "x", "completed")
      expect(result).toBe(true)
      const loaded = store.getGraph("update-test")
      expect(loaded!.stages[0].status).toBe("completed")
    })

    test("#given nonexistent stage #when updating #then returns false", () => {
      const store = createDependencyGraphStore({ baseDir })
      const now = new Date().toISOString()
      store.saveGraph({ id: "u2", label: "U2", stages: [], created_at: now, updated_at: now })
      expect(store.updateStageStatus("u2", "no-such-stage", "completed")).toBe(false)
    })
  })

  describe("upsertStage", () => {
    test("#given graph with no stages #when upserting #then stage is added", () => {
      const store = createDependencyGraphStore({ baseDir })
      const now = new Date().toISOString()
      store.saveGraph({ id: "upsert-test", label: "Upsert", stages: [], created_at: now, updated_at: now })
      store.upsertStage("upsert-test", { id: "y", label: "Y", status: "pending", depends_on: [] })
      const loaded = store.getGraph("upsert-test")
      expect(loaded!.stages).toHaveLength(1)
      expect(loaded!.stages[0].id).toBe("y")
    })

    test("#given existing stage #when upserting with changes #then stage is updated", () => {
      const store = createDependencyGraphStore({ baseDir })
      const now = new Date().toISOString()
      store.saveGraph({
        id: "upsert-update",
        label: "Upsert Update",
        stages: [{ id: "z", label: "Z", status: "pending" as const, depends_on: [] as string[] }],
        created_at: now,
        updated_at: now,
      })
      store.upsertStage("upsert-update", { id: "z", label: "Z Updated", status: "in_progress", depends_on: [] })
      const loaded = store.getGraph("upsert-update")
      expect(loaded!.stages[0].label).toBe("Z Updated")
      expect(loaded!.stages[0].status).toBe("in_progress")
    })
  })

  describe("cascadeBlockedStages", () => {
    test("#given graph with failed stage #when cascading #then dependent stages become blocked", () => {
      const store = createDependencyGraphStore({ baseDir })
      const now = new Date().toISOString()
      store.saveGraph({
        id: "cascade-test",
        label: "Cascade",
        stages: [
          { id: "s1", label: "Foundation", status: "failed" as const, depends_on: [] as string[] },
          { id: "s2", label: "Build", status: "pending" as const, depends_on: ["s1"] },
          { id: "s3", label: "Independent", status: "pending" as const, depends_on: [] as string[] },
        ],
        created_at: now,
        updated_at: now,
      })
      store.cascadeBlockedStages("cascade-test")
      const loaded = store.getGraph("cascade-test")
      const buildStage = loaded!.stages.find((s: { id: string }) => s.id === "s2")
      expect(buildStage!.status).toBe("blocked")
      const indepStage = loaded!.stages.find((s: { id: string }) => s.id === "s3")
      expect(indepStage!.status).toBe("pending")
    })
  })
})
