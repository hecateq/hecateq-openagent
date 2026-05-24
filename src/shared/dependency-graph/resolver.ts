import type { DependencyGraph, DependencyStage, DependencyCheckResult } from "./types"

/**
 * Check whether a specific stage can be delegated to.
 *
 * Rules:
 * - Stage not found → allowed: false
 * - Stage already completed/failed → allowed: false (already done)
 * - Stage has no dependencies → allowed: true
 * - All dependencies completed → allowed: true
 * - Any dependency failed → blocked (stage reclassified as blocked)
 * - Any dependency pending or in_progress → waiting
 */
export function canDelegate(
  graph: DependencyGraph,
  stageId: string,
  enforce: boolean,
): DependencyCheckResult {
  const stage = graph.stages.find((s) => s.id === stageId)
  if (!stage) {
    return {
      allowed: false,
      reason: `Stage "${stageId}" not found in graph "${graph.id}"`,
      unmet_dependencies: [],
    }
  }

  if (stage.status === "completed") {
    return {
      allowed: false,
      reason: `Stage "${stage.label}" (${stageId}) is already completed`,
    }
  }

  if (stage.status === "failed") {
    return {
      allowed: false,
      reason: `Stage "${stage.label}" (${stageId}) has already failed`,
    }
  }

  if (stage.depends_on.length === 0) {
    return { allowed: true }
  }

  const stageMap = new Map(graph.stages.map((s) => [s.id, s]))

  const unmet: string[] = []
  let blockedByFailure = false

  for (const depId of stage.depends_on) {
    const depStage = stageMap.get(depId)
    if (!depStage) {
      unmet.push(depId)
      continue
    }
    if (depStage.status === "completed") {
      continue
    }
    if (depStage.status === "failed" || depStage.status === "blocked") {
      blockedByFailure = true
      unmet.push(depId)
      continue
    }
    // pending or in_progress
    unmet.push(depId)
  }

  if (unmet.length === 0) {
    return { allowed: true }
  }

  const uncompletedLabels = unmet
    .map((id) => {
      const s = stageMap.get(id)
      return s ? `"${s.label}" (${id}, ${s.status})` : id
    })
    .join(", ")

  if (blockedByFailure) {
    const reason = enforce
      ? `Cannot delegate stage "${stage.label}" — prerequisite(s) failed: ${uncompletedLabels}`
      : `Warning: stage "${stage.label}" has failed prerequisite(s): ${uncompletedLabels}`
    return { allowed: !enforce, reason, unmet_dependencies: unmet }
  }

  const reason = enforce
    ? `Cannot delegate stage "${stage.label}" — prerequisite(s) not yet completed: ${uncompletedLabels}`
    : `Warning: stage "${stage.label}" waiting on prerequisite(s): ${uncompletedLabels}`
  return { allowed: !enforce, reason, unmet_dependencies: unmet }
}

/**
 * Return the IDs of stages whose dependencies are all met (ready to execute).
 */
export function getReadyStages(graph: DependencyGraph): DependencyStage[] {
  const completedIds = new Set(
    graph.stages
      .filter((s) => s.status === "completed")
      .map((s) => s.id),
  )
  const failedIds = new Set(
    graph.stages
      .filter((s) => s.status === "failed" || s.status === "blocked")
      .map((s) => s.id),
  )

  return graph.stages.filter((stage) => {
    if (stage.status !== "pending") return false
    if (stage.depends_on.length === 0) return true
    const hasFailedDep = stage.depends_on.some((depId) => failedIds.has(depId))
    if (hasFailedDep) return false
    return stage.depends_on.every((depId) => completedIds.has(depId))
  })
}

/**
 * Return the stages that are currently blocked (a dependency failed).
 */
export function getBlockedStages(graph: DependencyGraph): DependencyStage[] {
  const failedIds = new Set(
    graph.stages
      .filter((s) => s.status === "failed" || s.status === "blocked")
      .map((s) => s.id),
  )

  return graph.stages.filter((stage) => {
    if (stage.status !== "pending" && stage.status !== "in_progress") return false
    return stage.depends_on.some((depId) => failedIds.has(depId))
  })
}

/**
 * Return the transitive dependency chain for a stage (breadth-first).
 */
export function getDependencyChain(
  graph: DependencyGraph,
  stageId: string,
): DependencyStage[] {
  const stageMap = new Map(graph.stages.map((s) => [s.id, s]))
  const visited = new Set<string>()
  const result: DependencyStage[] = []

  function walk(currentId: string): void {
    if (visited.has(currentId)) return
    const current = stageMap.get(currentId)
    if (!current) return
    visited.add(currentId)
    result.push(current)
    for (const depId of current.depends_on) {
      walk(depId)
    }
  }

  walk(stageId)
  return result
}

/**
 * Check whether all dependencies of a given stage are met (completed).
 */
export function allDepsMet(graph: DependencyGraph, stageId: string): boolean {
  const stage = graph.stages.find((s) => s.id === stageId)
  if (!stage || stage.depends_on.length === 0) return true

  const completedIds = new Set(
    graph.stages
      .filter((s) => s.status === "completed")
      .map((s) => s.id),
  )

  return stage.depends_on.every((depId) => completedIds.has(depId))
}
