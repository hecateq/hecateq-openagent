import type {
  TaskNode,
  DependencyPlan,
  AgentSelectorResult,
  ExecutionPlan,
  ExecutionBatch,
  ExecutionBatchKind,
  ResolvedOrchestrationConfig,
} from "./types"

/**
 * Build an execution plan from the dependency plan and agent assignments.
 *
 * The execution plan:
 * 1. Takes the dependency batches from the DependencyPlan
 * 2. Sub-divides each batch based on config (parallel reads vs serial writes)
 * 3. Attaches agent assignments to each task batch
 * 4. Marks blocked tasks
 */
export function buildExecutionPlan(
  depPlan: DependencyPlan,
  agentSelection: AgentSelectorResult,
  config: ResolvedOrchestrationConfig,
): ExecutionPlan {
  const nodeMap = new Map(depPlan.nodes.map((n) => [n.id, n]))
  const agentMap = new Map(agentSelection.entries.map((e) => [e.taskId, e]))
  const executionBatches: ExecutionBatch[] = []

  let batchIndex = 0
  for (const batchTaskIds of depPlan.batches) {
    const writeTasks: string[] = []
    const readTasks: string[] = []
    const blockedTasks: string[] = []

    for (const taskId of batchTaskIds) {
      const node = nodeMap.get(taskId)

      // Skip already blocked tasks
      if (node && (node.status === "blocked" || node.status === "failed" || depPlan.blockedTaskIds.includes(taskId))) {
        blockedTasks.push(taskId)
        continue
      }

      if (node) {
        const isWrite = node.action === "write" || node.action === "both"
        if (isWrite) {
          writeTasks.push(taskId)
        } else {
          readTasks.push(taskId)
        }
      } else {
        writeTasks.push(taskId)
      }
    }

    // Add read batch (parallel if allowed)
    if (readTasks.length > 0) {
      executionBatches.push({
        index: batchIndex++,
        kind: config.allowParallelReadonlyTasks ? "parallel_read" : "sequential",
        taskIds: readTasks,
      })
    }

    // Add write batch (sequential if parallel writes not allowed)
    if (writeTasks.length > 0) {
      executionBatches.push({
        index: batchIndex++,
        kind: config.allowParallelWriteTasks ? "parallel_write" : "sequential",
        taskIds: writeTasks,
      })
    }

    // Add blocked batch
    if (blockedTasks.length > 0) {
      executionBatches.push({
        index: batchIndex++,
        kind: "sequential",
        taskIds: blockedTasks,
      })
    }
  }

  return {
    batches: executionBatches,
    estimatedBatchCount: executionBatches.length,
    hasBlockedTasks: depPlan.blockedTaskIds.length > 0,
    blockedTaskIds: depPlan.blockedTaskIds,
  }
}
