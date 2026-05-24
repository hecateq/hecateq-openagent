import type { TaskNode, DependencyPlan, CycleDetectionResult } from "./types"

/**
 * Detect circular dependencies among task nodes using DFS.
 */
function detectCycles(nodes: TaskNode[]): CycleDetectionResult {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]))
  const visited = new Set<string>()
  const inStack = new Set<string>()
  const cycle: string[] = []

  function dfs(nodeId: string): boolean {
    if (inStack.has(nodeId)) {
      cycle.push(nodeId)
      return true
    }
    if (visited.has(nodeId)) return false

    visited.add(nodeId)
    inStack.add(nodeId)

    const node = nodeMap.get(nodeId)
    if (node) {
      for (const depId of node.dependsOn) {
        if (dfs(depId)) {
          if (cycle.length === 0 || cycle[0] !== cycle[cycle.length - 1]) {
            cycle.push(nodeId)
          }
          return true
        }
      }
    }

    inStack.delete(nodeId)
    return false
  }

  for (const node of nodes) {
    if (!visited.has(node.id)) {
      if (dfs(node.id)) break
    }
  }

  const hasCycle = cycle.length > 0
  return {
    hasCycle,
    cycle: hasCycle ? [...cycle].reverse() : [],
    cycleNodeIds: hasCycle ? [...new Set(cycle)] : [],
  }
}

/**
 * Compute topological batches - groups of tasks that can run in parallel.
 * Uses Kahn's algorithm for topological sort.
 */
function computeBatches(nodes: TaskNode[]): string[][] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]))
  const inDegree = new Map<string, number>()
  const dependents = new Map<string, string[]>()

  for (const node of nodes) {
    if (!inDegree.has(node.id)) inDegree.set(node.id, 0)
    for (const depId of node.dependsOn) {
      inDegree.set(node.id, (inDegree.get(node.id) ?? 0) + 1)
      if (!dependents.has(depId)) dependents.set(depId, [])
      dependents.get(depId)?.push(node.id)
    }
  }

  const batches: string[][] = []
  let queue: string[] = []

  // Start with nodes that have no dependencies
  for (const [nodeId, degree] of inDegree) {
    if (degree === 0) queue.push(nodeId)
  }

  while (queue.length > 0) {
    batches.push([...queue])
    const nextQueue: string[] = []

    for (const nodeId of queue) {
      const deps = dependents.get(nodeId) ?? []
      for (const depId of deps) {
        const newDegree = (inDegree.get(depId) ?? 1) - 1
        inDegree.set(depId, newDegree)
        if (newDegree === 0) {
          nextQueue.push(depId)
        }
      }
    }

    queue = nextQueue
  }

  return batches
}

/**
 * Find tasks that are blocked (dependencies have failed or are blocked).
 */
function findBlockedTasks(nodes: TaskNode[]): string[] {
  const failedIds = new Set(
    nodes
      .filter((n) => n.status === "failed" || n.status === "blocked")
      .map((n) => n.id),
  )

  const nodeMap = new Map(nodes.map((n) => [n.id, n]))
  const blocked: string[] = []

  for (const node of nodes) {
    if (node.status !== "pending" && node.status !== "in_progress") continue
    const hasBlockedDep = node.dependsOn.some((depId) => {
      const dep = nodeMap.get(depId)
      return dep && (dep.status === "failed" || dep.status === "blocked" || failedIds.has(depId))
    })
    if (hasBlockedDep) blocked.push(node.id)
  }

  return blocked
}

/**
 * Find tasks that are ready to execute (dependencies all completed or no deps).
 */
function findReadyTasks(nodes: TaskNode[]): string[] {
  const completedIds = new Set(
    nodes
      .filter((n) => n.status === "completed")
      .map((n) => n.id),
  )

  return nodes
    .filter((node) => {
      if (node.status !== "pending") return false
      if (node.dependsOn.length === 0) return true
      return node.dependsOn.every((depId) => completedIds.has(depId))
    })
    .map((n) => n.id)
}

/**
 * Build a complete dependency plan from a set of task nodes.
 *
 * This function:
 * 1. Detects cycles and reports them
 * 2. Computes topological batches (safe parallelism)
 * 3. Identifies blocked and ready tasks
 * 4. Integrates with the existing shared dependency-graph resolver where sensible
 */
export function buildDependencyPlan(nodes: TaskNode[]): DependencyPlan {
  const cycle = detectCycles(nodes)

  // If cycles exist, return partial plan with cycle info but still compute batches
  let batches: string[][]
  if (cycle.hasCycle) {
    // Remove cycle nodes from batch computation to get partial ordering
    const cycleSet = new Set(cycle.cycleNodeIds)
    const nonCycleNodes = nodes.filter((n) => !cycleSet.has(n.id))
    batches = computeBatches(nonCycleNodes)
    // Add cycle nodes as a separate blocked batch
    batches.push(cycle.cycleNodeIds)
  } else {
    batches = computeBatches(nodes)
  }

  const blockedTaskIds = findBlockedTasks(nodes)
  const readyTaskIds = findReadyTasks(nodes)

  return {
    nodes,
    batches,
    cycle,
    blockedTaskIds,
    readyTaskIds,
    totalBatches: batches.length,
  }
}
