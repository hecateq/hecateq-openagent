/**
 * Hecateq Task Graph Schema — Planner v2 machine-readable output contract.
 *
 * Defines the Zod schema for the JSON task graph the Hecateq Planner v2
 * emits, plus a strict validator that surfaces ALL structural errors at
 * once (Zod issues, duplicate ids, unknown/self dependencies, cycles,
 * and exact agent existence against the runtime agent registry).
 *
 * The runtime agent registry is the single source of truth for agent
 * names — this validator never guesses, and it never falls back.
 */

import { z } from "zod"
import { DelegationCycleDetector } from "./cycle-detector"

// ─── Schema ───────────────────────────────────────────────────────────────────

export const TaskStatusSchema = z.enum(["pending", "blocked", "ready", "completed"])

export const TaskNodeSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
  subagent_type: z.string().min(1),
  depends_on: z.array(z.string()).default([]),
  status: TaskStatusSchema.default("pending"),
})

export const TaskGraphSchema = z.object({
  id: z.string().min(1),
  goal: z.string().min(1),
  tasks: z.array(TaskNodeSchema).min(1),
  created_at: z.string(), // ISO-8601
})

export type HecateqTaskNode = z.infer<typeof TaskNodeSchema>
export type HecateqTaskGraph = z.infer<typeof TaskGraphSchema>

// ─── Validation ────────────────────────────────────────────────────────────────

export type TaskGraphValidationResult =
  | { ok: true; graph: HecateqTaskGraph }
  | { ok: false; errors: string[] }

/**
 * Validate an unknown input as a HecateqTaskGraph, collecting ALL errors.
 *
 * Checks, in order:
 *  1. Zod parse (all schema issues, not just the first)
 *  2. Duplicate task IDs
 *  3. Unknown dependencies (depends_on references a non-existent task id)
 *  4. Self-dependencies (task depends on itself)
 *  5. Dependency cycles (via DelegationCycleDetector)
 *  6. Exact agent existence (runtimeAgentIds.has(task.subagent_type))
 *
 * Every error references a task id (or graph path) with a clear message.
 */
export function validateTaskGraph(
  input: unknown,
  runtimeAgentIds: ReadonlySet<string>,
): TaskGraphValidationResult {
  const errors: string[] = []

  // 1. Zod parse — collect ALL issues
  const parsed = TaskGraphSchema.safeParse(input)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const location = describeIssuePath(issue.path)
      errors.push(`${location}: ${issue.message}`)
    }
    return { ok: false, errors }
  }
  const graph = parsed.data

  // 2. Duplicate task IDs
  const seen = new Set<string>()
  for (const task of graph.tasks) {
    if (seen.has(task.id)) {
      errors.push(`task "${task.id}": duplicate task id`)
    }
    seen.add(task.id)
  }

  const ids = new Set(graph.tasks.map((task) => task.id))
  const detector = new DelegationCycleDetector()

  // 3/4/5. Dependency integrity — unknown dep, self-dep, cycles
  for (const task of graph.tasks) {
    for (const dep of task.depends_on) {
      if (dep === task.id) {
        errors.push(`task "${task.id}": cannot depend on itself`)
      } else if (!ids.has(dep)) {
        errors.push(`task "${task.id}": depends on unknown task "${dep}"`)
      } else {
        const cycle = detector.wouldCreateCycle(task.id, dep)
        if (cycle.cycle) {
          errors.push(
            `task "${task.id}": dependency cycle detected (${cycle.reason ?? `via "${dep}"`})`,
          )
        } else {
          detector.recordDelegation(task.id, dep)
        }
      }
    }
  }

  // 6. Exact agent existence against the runtime registry
  for (const task of graph.tasks) {
    if (!runtimeAgentIds.has(task.subagent_type)) {
      errors.push(
        `task "${task.id}": subagent_type "${task.subagent_type}" is not in the runtime agent registry`,
      )
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }
  return { ok: true, graph }
}

function describeIssuePath(path: ReadonlyArray<PropertyKey>): string {
  if (path.length === 0) return "graph"
  const first = path[0]
  const second = path[1]
  if (first === "tasks" && typeof second === "number") {
    const rest = path.slice(2).map((p) => String(p)).join(".")
    return `task[${second}].${rest || "node"}`
  }
  return path.map((p) => String(p)).join(".")
}
