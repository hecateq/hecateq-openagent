import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import { log } from "../logger"
import { writeFileAtomically } from "../write-file-atomically"
import { getOpenCodeConfigDir } from "../opencode-config-dir"
import { DependencyGraphSchema, type DependencyGraph, type DependencyStage } from "./types"
import type { OpenCodeConfigDirOptions } from "../opencode-config-dir-types"

/**
 * Options for creating a DependencyGraphStore.
 */
export interface DependencyGraphStoreOptions {
  /** Base directory for graph JSON files. Defaults to <project>/.opencode/task-graphs/ */
  baseDir?: string
}

/**
 * Factory that creates a dependency graph store with read/write/query operations.
 * Graphs are persisted as individual JSON files under baseDir.
 * An in-memory LRU cache avoids redundant file reads within the same session.
 */
export function createDependencyGraphStore(options: DependencyGraphStoreOptions = {}) {
  const baseDir = options.baseDir ?? resolveBaseDir()
  ensureDir(baseDir)

  // in-memory cache: graphId → parsed graph
  const cache = new Map<string, DependencyGraph>()

  function graphPath(graphId: string): string {
    return join(baseDir, `${sanitizeId(graphId)}.json`)
  }

  function listGraphFiles(): string[] {
    try {
      return readdirSync(baseDir).filter((f) => f.endsWith(".json"))
    } catch {
      return []
    }
  }

  return {
    /** Directory where graph files are stored */
    baseDir,

    /**
     * Retrieve a graph by ID. Returns null if not found or corrupt.
     * Falls back safely — logging warnings but never throwing.
     */
    getGraph(graphId: string): DependencyGraph | null {
      const cached = cache.get(graphId)
      if (cached) return cached

      const filePath = graphPath(graphId)
      if (!existsSync(filePath)) return null

      try {
        const raw = readFileSync(filePath, "utf-8")
        const parsed = JSON.parse(raw) as unknown
        const result = DependencyGraphSchema.safeParse(parsed)
        if (!result.success) {
          log("[dependency-graph] Corrupt graph file, returning null", {
            graphId,
            error: result.error.issues[0]?.message,
          })
          return null
        }
        cache.set(graphId, result.data)
        return result.data
      } catch (err) {
        log("[dependency-graph] Failed to read graph file", {
          graphId,
          error: String(err),
        })
        return null
      }
    },

    /**
     * List all known graph IDs by scanning the store directory.
     * Returns an empty array on any error (safe fallback).
     */
    listGraphs(): string[] {
      try {
        return listGraphFiles().map((f) => f.replace(/\.json$/u, ""))
      } catch (err) {
        log("[dependency-graph] Failed to list graphs", { error: String(err) })
        return []
      }
    },

    /**
     * Persist (create or overwrite) a graph. Uses atomic write (temp + fsync + rename).
     */
    saveGraph(graph: DependencyGraph): void {
      const valid = DependencyGraphSchema.parse(graph)
      const content = JSON.stringify(valid, null, 2)
      writeFileAtomically(graphPath(valid.id), content)
      cache.set(valid.id, valid)
      log("[dependency-graph] Graph saved", { graphId: valid.id, stageCount: valid.stages.length })
    },

    /**
     * Remove a graph from the store and cache.
     */
    deleteGraph(graphId: string): void {
      cache.delete(graphId)
      try {
        const filePath = graphPath(graphId)
        if (existsSync(filePath)) {
          unlinkSync(filePath)
        }
      } catch (err) {
        log("[dependency-graph] Failed to delete graph file", { graphId, error: String(err) })
      }
    },

    /**
     * Update the status of a single stage within a graph.
     * Returns true if the graph exists and the stage was found; false otherwise.
     */
    updateStageStatus(
      graphId: string,
      stageId: string,
      status: DependencyStage["status"],
    ): boolean {
      const graph = this.getGraph(graphId)
      if (!graph) return false

      const stageIndex = graph.stages.findIndex((s) => s.id === stageId)
      if (stageIndex === -1) return false

      const updatedStages = [...graph.stages]
      updatedStages[stageIndex] = { ...updatedStages[stageIndex], status }

      const updatedGraph: DependencyGraph = {
        ...graph,
        stages: updatedStages,
        updated_at: new Date().toISOString(),
      }

      this.saveGraph(updatedGraph)
      return true
    },

    /**
     * Upsert a stage (add or update) within a graph.
     * Creates the graph if it doesn't exist.
     */
    upsertStage(graphId: string, stage: DependencyStage): void {
      let graph = this.getGraph(graphId)
      const now = new Date().toISOString()

      if (!graph) {
        graph = {
          id: graphId,
          label: stage.label,
          stages: [],
          created_at: now,
          updated_at: now,
        }
      }

      const existingIndex = graph.stages.findIndex((s) => s.id === stage.id)
      if (existingIndex >= 0) {
        const updatedStages = [...graph.stages]
        updatedStages[existingIndex] = { ...updatedStages[existingIndex], ...stage }
        graph = { ...graph, stages: updatedStages, updated_at: now }
      } else {
        graph = { ...graph, stages: [...graph.stages, stage], updated_at: now }
      }

      this.saveGraph(graph)
    },

    /**
     * Mark stages whose dependencies have failed as blocked.
     * Cascading update — called after a stage is marked failed.
     */
    cascadeBlockedStages(graphId: string): void {
      const graph = this.getGraph(graphId)
      if (!graph) return

      const failedIds = new Set(
        graph.stages
          .filter((s) => s.status === "failed")
          .map((s) => s.id),
      )

      let changed = false
      const updatedStages = graph.stages.map((stage) => {
        if (stage.status !== "pending" && stage.status !== "in_progress") return stage
        const hasFailedDependency = stage.depends_on.some((depId) => failedIds.has(depId))
        if (hasFailedDependency) {
          changed = true
          return { ...stage, status: "blocked" as const }
        }
        return stage
      })

      if (changed) {
        this.saveGraph({ ...graph, stages: updatedStages, updated_at: new Date().toISOString() })
      }
    },

    /** Clear in-memory cache (useful for testing) */
    clearCache(): void {
      cache.clear()
    },
  }
}

export type DependencyGraphStore = ReturnType<typeof createDependencyGraphStore>

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/gu, "_")
}

function resolveBaseDir(): string {
  try {
    const configDir = getOpenCodeConfigDir({ binary: "opencode" })
    return join(configDir, "task-graphs")
  } catch {
    return ".opencode/task-graphs"
  }
}

function ensureDir(dir: string): void {
  try {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
  } catch {
    // non-fatal — failures surface at first write
  }
}
