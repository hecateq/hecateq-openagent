import { z } from "zod"

/**
 * Represents the possible status states of a dependency stage.
 * - pending: Not yet started, waiting for prerequisites
 * - in_progress: Currently being executed
 * - completed: Successfully finished
 * - failed: Execution ended with an error
 * - blocked: One or more prerequisites have failed
 */
export const StageStatusSchema = z.enum([
  "pending",
  "in_progress",
  "completed",
  "failed",
  "blocked",
])

export type StageStatus = z.infer<typeof StageStatusSchema>

/**
 * A single stage (task) within a dependency graph.
 */
export const DependencyStageSchema = z.object({
  /** Unique identifier for this stage within the graph */
  id: z.string().min(1),
  /** Human-readable label for this stage */
  label: z.string().min(1).max(200),
  /** Current execution status */
  status: StageStatusSchema.default("pending"),
  /** IDs of stages in the same graph that this stage depends on */
  depends_on: z.array(z.string()).default([]),
  /** Optional metadata for routing / categorisation */
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export type DependencyStage = z.infer<typeof DependencyStageSchema>

/**
 * A complete dependency graph — a DAG of stages that can be used
 * to enforce execution order across multiple task() delegations.
 */
export const DependencyGraphSchema = z.object({
  /** Unique immutable identifier for this graph */
  id: z.string().min(1),
  /** Human-readable label */
  label: z.string().min(1).max(300),
  /** Ordered collection of stages that belong to this graph */
  stages: z.array(DependencyStageSchema).default([]),
  /** ISO-8601 creation timestamp */
  created_at: z.string(),
  /** ISO-8601 last-update timestamp */
  updated_at: z.string(),
  /** Arbitrary metadata (project, agent, etc.) */
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export type DependencyGraph = z.infer<typeof DependencyGraphSchema>

/**
 * Input shape used when creating a new graph. Stages are optional
 * at creation time and can be added later.
 */
export const CreateDependencyGraphInputSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(300),
  stages: z.array(DependencyStageSchema).default([]),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export type CreateDependencyGraphInput = z.infer<typeof CreateDependencyGraphInputSchema>

/**
 * Input shape for adding or updating a stage.
 */
export const UpsertStageInputSchema = z.object({
  graph_id: z.string().min(1),
  stage: DependencyStageSchema,
})

export type UpsertStageInput = z.infer<typeof UpsertStageInputSchema>

/**
 * Result of a dependency check.
 */
export interface DependencyCheckResult {
  /** Whether delegation is allowed */
  allowed: boolean
  /** Human-readable reason when blocked */
  reason?: string
  /** IDs of unmet prerequisite stages (when blocked) */
  unmet_dependencies?: string[]
}

/**
 * Inference helper: returns all stage IDs that are completed.
 */
export function getCompletedStageIds(stages: DependencyStage[]): string[] {
  return stages
    .filter((s) => s.status === "completed")
    .map((s) => s.id)
}

/**
 * Inference helper: returns all stage IDs that are failed or blocked.
 */
export function getFailedStageIds(stages: DependencyStage[]): string[] {
  return stages
    .filter((s) => s.status === "failed" || s.status === "blocked")
    .map((s) => s.id)
}

// ─── Task Graph Validation ───────────────────────────────────────────────────

export interface TaskGraphValidationError {
  kind: "duplicate_node" | "missing_dependency" | "circular_dependency" | "empty_graph"
  message: string
  nodeIds?: string[]
}

export interface TaskGraphValidationResult {
  valid: boolean
  errors: TaskGraphValidationError[]
}

/**
 * Lightweight validator for a task/dependency graph.
 * Checks: duplicate node IDs, missing dependencies, circular dependencies, empty graph.
 * Pure function — no side effects, no runtime mutation.
 */
export function validateTaskGraph(stages: DependencyStage[]): TaskGraphValidationResult {
  const errors: TaskGraphValidationError[] = []

  if (stages.length === 0) {
    errors.push({ kind: "empty_graph", message: "Graph has no stages" })
    return { valid: false, errors }
  }

  const nodeIds = new Set<string>()
  const duplicateIds = new Set<string>()

  for (const stage of stages) {
    if (nodeIds.has(stage.id)) {
      duplicateIds.add(stage.id)
    } else {
      nodeIds.add(stage.id)
    }
  }

  for (const dupId of duplicateIds) {
    errors.push({
      kind: "duplicate_node",
      message: `Duplicate node ID: "${dupId}"`,
      nodeIds: [dupId],
    })
  }

  for (const stage of stages) {
    for (const depId of stage.depends_on) {
      if (!nodeIds.has(depId)) {
        errors.push({
          kind: "missing_dependency",
          message: `Stage "${stage.id}" depends on unknown stage "${depId}"`,
          nodeIds: [stage.id, depId],
        })
      }
    }
  }

  const cycle = detectCycle(stages, nodeIds)
  if (cycle.length > 0) {
    errors.push({
      kind: "circular_dependency",
      message: `Circular dependency detected: ${cycle.join(" → ")}`,
      nodeIds: cycle,
    })
  }

  return { valid: errors.length === 0, errors }
}

function detectCycle(stages: DependencyStage[], nodeIds: Set<string>): string[] {
  const adjacency = new Map<string, string[]>()
  for (const id of nodeIds) {
    adjacency.set(id, [])
  }
  for (const stage of stages) {
    for (const depId of stage.depends_on) {
      if (nodeIds.has(depId)) {
        adjacency.get(stage.id)?.push(depId)
      }
    }
  }

  const WHITE = 0, GRAY = 1, BLACK = 2
  const color = new Map<string, number>()
  const parent = new Map<string, string | null>()

  for (const id of nodeIds) {
    color.set(id, WHITE)
    parent.set(id, null)
  }

  const cycle: string[] = []

  function dfs(node: string): boolean {
    color.set(node, GRAY)
    const neighbors = adjacency.get(node) ?? []
    for (const neighbor of neighbors) {
      if (color.get(neighbor) === GRAY) {
        const path: string[] = [neighbor, node]
        let current = parent.get(node)
        while (current && current !== neighbor) {
          path.push(current)
          current = parent.get(current)
        }
        for (let i = path.length - 1; i >= 0; i--) {
          cycle.push(path[i]!)
        }
        return true
      }
      if (color.get(neighbor) === WHITE) {
        parent.set(neighbor, node)
        if (dfs(neighbor)) return true
      }
    }
    color.set(node, BLACK)
    return false
  }

  for (const id of nodeIds) {
    if (color.get(id) === WHITE) {
      if (dfs(id)) break
    }
  }

  return cycle
}
