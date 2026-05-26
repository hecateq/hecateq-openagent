/**
 * Hecateq Execution Adapter Layer
 *
 * Pluggable adapters for executing orchestration tasks through different
 * modes: dry-run (preview only), manual (operator confirmation), test
 * (deterministic mock), and runtime (real agent dispatch).
 *
 * Each adapter implements the ExecutionAdapter interface and can be
 * swapped at the orchestration controller level without changing the
 * pipeline logic.
 *
 * Bridge helpers are provided to adapt the existing callback-based
 * TaskBatchExecutor into the adapter interface, ensuring backward
 * compatibility with the existing delegation-executor pipeline.
 */
import type {
  ExecutionAdapter,
  RuntimeAdapterConfig,
  TaskBatchExecutor,
  TaskExecutionResult,
  ExecutionBatch,
  TaskNode,
  AgentSelectionEntry,
} from "./types"

// ─── Dry-Run Adapter ─────────────────────────────────────────────────────────

/**
 * Dry-run execution adapter.
 *
 * Produces mock TaskExecutionResults with status "completed" for all tasks
 * without actually executing anything. Useful for:
 * - Previewing what would be executed
 * - Validating the task graph structure
 * - Testing pipeline logic without side effects
 *
 * All results report 0 changed files and 0 produced artifacts.
 */
export class DryRunExecutionAdapter implements ExecutionAdapter {
  readonly label = "dry-run"

  executeTask(task: TaskNode, assignment: AgentSelectionEntry): TaskExecutionResult {
    return {
      taskId: task.id,
      agentId: assignment.selectedAgent,
      status: "completed",
      changedFiles: [],
      producedArtifacts: [],
    }
  }

  executeBatch(
    batch: ExecutionBatch,
    tasks: TaskNode[],
    agentAssignments: AgentSelectionEntry[],
  ): TaskExecutionResult[] {
    const assignmentMap = new Map(agentAssignments.map((a) => [a.taskId, a]))
    return batch.taskIds.map((taskId) => {
      const task = tasks.find((t) => t.id === taskId)
      const assignment = assignmentMap.get(taskId) ?? {
        taskId,
        selectedAgent: "unknown",
        exactMatch: false,
      }
      return this.executeTask(task ?? { id: taskId, label: "", prompt: "", domain: "unknown", action: "read", dependsOn: [], status: "pending" }, assignment)
    })
  }

  canExecute(agentId: string): boolean {
    return true
  }
}

// ─── Manual Confirmation Adapter ─────────────────────────────────────────────

/**
 * Manual execution adapter.
 *
 * Wraps another adapter (typically a RuntimeExecutionAdapter) and requires
 * explicit operator confirmation before each batch is executed.
 *
 * The confirmation function is injected at construction time, making it
 * usable both interactively (prompt operator) and automatically (always
 * confirm in tests, always deny in safety drills).
 *
 * When confirmation is denied, tasks are marked as "blocked" with an
 * appropriate error message.
 */
export class ManualExecutionAdapter implements ExecutionAdapter {
  readonly label = "manual"

  constructor(
    private readonly inner: ExecutionAdapter,
    private readonly confirmFn: (batch: ExecutionBatch, tasks: TaskNode[]) => boolean | Promise<boolean>,
  ) {}

  executeTask(task: TaskNode, assignment: AgentSelectionEntry): Promise<TaskExecutionResult> {
    return Promise.resolve(this.inner.executeTask(task, assignment))
  }

  async executeBatch(
    batch: ExecutionBatch,
    tasks: TaskNode[],
    agentAssignments: AgentSelectionEntry[],
  ): Promise<TaskExecutionResult[]> {
    const confirmed = await this.confirmFn(batch, tasks)
    if (!confirmed) {
      const assignmentMap = new Map(agentAssignments.map((a) => [a.taskId, a]))
      return batch.taskIds.map((taskId) => {
        const assignment = assignmentMap.get(taskId) ?? {
          taskId,
          selectedAgent: "unknown",
          exactMatch: false,
        }
        return {
          taskId,
          agentId: assignment.selectedAgent,
          status: "blocked" as const,
          changedFiles: [],
          producedArtifacts: [],
          errorSummary: "Manual confirmation denied by operator",
        }
      })
    }
    return this.inner.executeBatch(batch, tasks, agentAssignments)
  }

  canExecute(agentId: string): boolean {
    return this.inner.canExecute(agentId)
  }
}

// ─── Test Adapter ─────────────────────────────────────────────────────────────

/**
 * Test execution adapter.
 *
 * Deterministic mock adapter for use in unit tests. Returns pre-configured
 * results for specific task IDs and falls back to default results for
 * unknown tasks.
 *
 * The adapter tracks which tasks were "executed" for assertions.
 */
export class TestExecutionAdapter implements ExecutionAdapter {
  readonly label = "test"

  executedTaskIds: string[] = []
  executedBatchIndices: number[] = []

  constructor(
    private readonly resultOverrides: Map<string, Partial<TaskExecutionResult>> = new Map(),
    private readonly defaultStatus: TaskExecutionResult["status"] = "completed",
    private readonly agentAllowlist?: string[],
  ) {}

  executeTask(task: TaskNode, assignment: AgentSelectionEntry): TaskExecutionResult {
    this.executedTaskIds.push(task.id)
    const override = this.resultOverrides.get(task.id)
    return {
      taskId: task.id,
      agentId: assignment.selectedAgent,
      status: override?.status ?? this.defaultStatus,
      changedFiles: override?.changedFiles ?? [],
      producedArtifacts: override?.producedArtifacts ?? [],
      errorSummary: override?.errorSummary,
      handoffData: override?.handoffData,
    }
  }

  executeBatch(
    batch: ExecutionBatch,
    tasks: TaskNode[],
    agentAssignments: AgentSelectionEntry[],
  ): TaskExecutionResult[] {
    this.executedBatchIndices.push(batch.index)
    const assignmentMap = new Map(agentAssignments.map((a) => [a.taskId, a]))
    return batch.taskIds.map((taskId) => {
      const task = tasks.find((t) => t.id === taskId)
      const assignment = assignmentMap.get(taskId) ?? {
        taskId,
        selectedAgent: "unknown",
        exactMatch: false,
      }
      return this.executeTask(
        task ?? { id: taskId, label: "", prompt: "", domain: "unknown", action: "read", dependsOn: [], status: "pending" },
        assignment,
      )
    })
  }

  canExecute(agentId: string): boolean {
    if (!this.agentAllowlist) return true
    return this.agentAllowlist.includes(agentId)
  }

  reset(): void {
    this.executedTaskIds = []
    this.executedBatchIndices = []
  }
}

// ─── Callback (Runtime) Adapter ──────────────────────────────────────────────

/**
 * Callback-based execution adapter.
 *
 * Wraps an existing TaskBatchExecutor callback into the ExecutionAdapter
 * interface. This is the bridge that connects the new adapter layer with
 * the existing callback-based pipeline.
 *
 * The adapter preserves the same execution semantics as the original
 * callback, making the migration additive and safe.
 */
export class CallbackExecutionAdapter implements ExecutionAdapter {
  readonly label = "runtime"

  private readonly allowedAgents: Set<string>

  constructor(private readonly config: RuntimeAdapterConfig) {
    this.allowedAgents = new Set(config.allowedAgents ?? [])
  }

  executeTask(task: TaskNode, assignment: AgentSelectionEntry): Promise<TaskExecutionResult> {
    return Promise.resolve(this.config.batchExecutor(
      { index: 0, kind: "sequential", taskIds: [task.id] },
      [task],
      [assignment],
    )).then((results) => results[0]!)
  }

  executeBatch(
    batch: ExecutionBatch,
    tasks: TaskNode[],
    agentAssignments: AgentSelectionEntry[],
  ): Promise<TaskExecutionResult[]> {
    return Promise.resolve(this.config.batchExecutor(batch, tasks, agentAssignments))
  }

  canExecute(agentId: string): boolean {
    if (this.allowedAgents.size === 0) return true
    return this.allowedAgents.has(agentId)
  }
}

// ─── Deferred Execution Adapter ───────────────────────────────────────────────

/**
 * Deferred execution adapter.
 *
 * Queues execution requests and provides them as a list for batch processing.
 * Useful for collecting all tasks that would be executed without actually
 * running them, or for delayed/offline execution scenarios.
 */
export class DeferredExecutionAdapter implements ExecutionAdapter {
  readonly label = "deferred"

  readonly pendingExecutions: Array<{
    task: TaskNode
    assignment: AgentSelectionEntry
  }> = []

  private readonly inner: ExecutionAdapter
  private readonly autoFlushOnBatch: boolean

  constructor(inner?: ExecutionAdapter, autoFlushOnBatch = false) {
    this.inner = inner ?? new DryRunExecutionAdapter()
    this.autoFlushOnBatch = autoFlushOnBatch
  }

  executeTask(task: TaskNode, assignment: AgentSelectionEntry): TaskExecutionResult {
    this.pendingExecutions.push({ task, assignment })
    return {
      taskId: task.id,
      agentId: assignment.selectedAgent,
      status: "pending",
      changedFiles: [],
      producedArtifacts: [],
    }
  }

  executeBatch(
    batch: ExecutionBatch,
    tasks: TaskNode[],
    agentAssignments: AgentSelectionEntry[],
  ): TaskExecutionResult[] | Promise<TaskExecutionResult[]> {
    if (this.autoFlushOnBatch) {
      return this.inner.executeBatch(batch, tasks, agentAssignments)
    }
    const assignmentMap = new Map(agentAssignments.map((a) => [a.taskId, a]))
    for (const taskId of batch.taskIds) {
      const task = tasks.find((t) => t.id === taskId)
      const assignment = assignmentMap.get(taskId) ?? {
        taskId,
        selectedAgent: "unknown",
        exactMatch: false,
      }
      if (task) {
        this.pendingExecutions.push({ task, assignment })
      }
    }
    return batch.taskIds.map((taskId) => ({
      taskId,
      agentId: assignmentMap.get(taskId)?.selectedAgent ?? "unknown",
      status: "pending" as const,
      changedFiles: [],
      producedArtifacts: [],
    }))
  }

  canExecute(agentId: string): boolean {
    return this.inner.canExecute(agentId)
  }

  /**
   * Flush all pending executions through the inner adapter and return
   * the aggregated results. Clears the pending queue.
   */
  async flushAll(): Promise<TaskExecutionResult[]> {
    const results: TaskExecutionResult[] = []
    const grouped = new Map<string, { task: TaskNode; assignment: AgentSelectionEntry }[]>()

    for (const exec of this.pendingExecutions) {
      const agentId = exec.assignment.selectedAgent
      const list = grouped.get(agentId) ?? []
      list.push(exec)
      grouped.set(agentId, list)
    }

    for (const [, executions] of grouped) {
      const tasks = executions.map((e) => e.task)
      const assignments = executions.map((e) => e.assignment)
      const taskIds = tasks.map((t) => t.id)
      const batch: ExecutionBatch = { index: 0, kind: "sequential", taskIds }
      const batchResults = await this.inner.executeBatch(batch, tasks, assignments)
      results.push(...batchResults)
    }

    this.pendingExecutions.length = 0
    return results
  }
}

// ─── Adapter Composition Helpers ─────────────────────────────────────────────

/**
 * Compose multiple adapters into a single adapter using the chain of
 * responsibility pattern. Each adapter is tried in order until one
 * returns canExecute() === true for the agent in question.
 *
 * If no adapter can handle the agent, the task is marked as blocked.
 */
export class CompositeExecutionAdapter implements ExecutionAdapter {
  readonly label = "composite"

  constructor(private readonly adapters: ExecutionAdapter[]) {}

  executeTask(task: TaskNode, assignment: AgentSelectionEntry): TaskExecutionResult | Promise<TaskExecutionResult> {
    const adapter = this.findAdapter(assignment.selectedAgent)
    if (!adapter) {
      return {
        taskId: task.id,
        agentId: assignment.selectedAgent,
        status: "blocked",
        changedFiles: [],
        producedArtifacts: [],
        errorSummary: `No adapter available for agent "${assignment.selectedAgent}"`,
      }
    }
    return adapter.executeTask(task, assignment)
  }

  executeBatch(
    batch: ExecutionBatch,
    tasks: TaskNode[],
    agentAssignments: AgentSelectionEntry[],
  ): TaskExecutionResult[] | Promise<TaskExecutionResult[]> {
    // Group tasks in the batch by which adapter handles them
    const adapterGroups = new Map<string, { adapter: ExecutionAdapter; tasks: TaskNode[]; assignments: AgentSelectionEntry[] }>()
    const assignmentMap = new Map(agentAssignments.map((a) => [a.taskId, a]))

    for (const taskId of batch.taskIds) {
      const task = tasks.find((t) => t.id === taskId)
      const assignment = assignmentMap.get(taskId)
      if (!task || !assignment) continue

      const adapter = this.findAdapter(assignment.selectedAgent)
      const key = adapter?.label ?? "none"
      let group = adapterGroups.get(key)
      if (!group) {
        group = { adapter: adapter!, tasks: [], assignments: [] }
        adapterGroups.set(key, group)
      }
      group.tasks.push(task)
      group.assignments.push(assignment)
    }

    // Execute each group
    const results: TaskExecutionResult[] = []
    for (const [, group] of adapterGroups) {
      const groupBatch: ExecutionBatch = { ...batch, taskIds: group.tasks.map((t) => t.id) }
      const groupResults = group.adapter.executeBatch(groupBatch, group.tasks, group.assignments)
      if (Array.isArray(groupResults)) {
        results.push(...groupResults)
      }
    }

    return results
  }

  canExecute(agentId: string): boolean {
    return this.findAdapter(agentId) !== null
  }

  private findAdapter(agentId: string): ExecutionAdapter | null {
    for (const adapter of this.adapters) {
      if (adapter.canExecute(agentId)) return adapter
    }
    return null
  }
}

// ─── Bridge Helpers ──────────────────────────────────────────────────────────

/**
 * Create a TaskBatchExecutor from an ExecutionAdapter.
 *
 * This bridges the new adapter layer back to the existing callback-based
 * pipeline, allowing adapters to be used anywhere a TaskBatchExecutor is
 * expected (e.g., in the orchestration controller's executeBatch parameter).
 */
export function createBatchExecutorFromAdapter(adapter: ExecutionAdapter): TaskBatchExecutor {
  return (batch, tasks, assignments) => adapter.executeBatch(batch, tasks, assignments)
}

/**
 * Execute a batch using an adapter if available, falling back to the
 * provided default executor if the adapter is null.
 */
export function executeBatchViaAdapter(
  adapter: ExecutionAdapter | null | undefined,
  batch: ExecutionBatch,
  tasks: TaskNode[],
  agentAssignments: AgentSelectionEntry[],
  defaultExecutor?: TaskBatchExecutor,
): TaskExecutionResult[] | Promise<TaskExecutionResult[]> {
  if (adapter) {
    return adapter.executeBatch(batch, tasks, agentAssignments)
  }
  if (defaultExecutor) {
    return defaultExecutor(batch, tasks, agentAssignments)
  }
  // Fallback: mark all tasks as blocked
  const assignmentMap = new Map(agentAssignments.map((a) => [a.taskId, a]))
  return batch.taskIds.map((taskId) => {
    const assignment = assignmentMap.get(taskId) ?? {
      taskId,
      selectedAgent: "unknown",
      exactMatch: false,
    }
    return {
      taskId,
      agentId: assignment.selectedAgent,
      status: "blocked" as const,
      changedFiles: [],
      producedArtifacts: [],
      errorSummary: "No executor or adapter available",
    }
  })
}
