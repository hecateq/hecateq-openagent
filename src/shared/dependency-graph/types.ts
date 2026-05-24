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
