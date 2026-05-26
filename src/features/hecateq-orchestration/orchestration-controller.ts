import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

import { analyzePrompt } from "./prompt-intake"
import { decomposePrompt, resetCounter as resetTaskCounter } from "./task-decomposer"
import { buildDependencyPlan } from "./dependency-planner"
import { selectAgents, readLocalAgentRegistry } from "./agent-selector"
import { buildExecutionPlan } from "./execution-planner"
import { runQualityGates } from "./quality-gate-runner"
import { runRepairLoop } from "./repair-loop-controller"
import { generateReport, renderReportAsMarkdown } from "./final-report-generator"
import { decideRoutingFromTaskHandoff } from "./routing-policy-engine"
import { processHandoffsToDelegation } from "./delegation-controller"
import { OmoStateManager } from "./omo-state-manager"
import { executePendingDelegations } from "./delegation-executor"
import { canSpawn } from "../autonomous-spawn/spawn-policy"
import type { AutoSpawnConfig } from "../autonomous-spawn/types"
import type { HecateqSpawnSession } from "./types"

import type {
  PromptIntakeResult,
  TaskNode,
  DependencyPlan,
  AgentSelectorResult,
  AgentSelectionEntry,
  ExecutionPlan,
  ExecutionBatch,
  TaskBatchExecutor,
  DelegationRequestExecutor,
  TaskExecutionResult,
  QualityGateReport,
  RepairLoopResult,
  RepairAction,
  OrchestrationReport,
  OrchestrationSessionState,
  PipelinePhase,
  ChangedFile,
  ResolvedOrchestrationConfig,
  LocalAgentRegistryEntry,
  RoutingDecision,
} from "./types"

export type {
  PromptIntakeResult,
  TaskNode,
  DependencyPlan,
  AgentSelectorResult,
  AgentSelectionEntry,
  ExecutionPlan,
  ExecutionBatch,
  TaskBatchExecutor,
  TaskExecutionResult,
  QualityGateReport,
  RepairLoopResult,
  RepairAction,
  OrchestrationReport,
  OrchestrationSessionState,
  ResolvedOrchestrationConfig,
  LocalAgentRegistryEntry,
}

const DEFAULT_AGENTS_DIR = `${process.env.HOME ?? ""}/.config/opencode/agents`
const DEFAULT_TASK_GRAPHS_DIR = ".opencode/task-graphs"
const LATEST_GRAPH_FILE = "latest.json"

// ─── Sensitive file patterns ─────────────────────────────────────────────────

const SENSITIVE_PATTERNS = [
  ".env",
  ".env.",
  "*.pem",
  "*.key",
  "*secret*",
  "*credentials*",
  "credentials",
  "secrets.yml",
  "secrets.yaml",
]

export function isSensitivePath(filePath: string): boolean {
  const normalized = filePath.toLowerCase()
  return SENSITIVE_PATTERNS.some((pattern) => {
    if (pattern.startsWith("*") && pattern.endsWith("*")) {
      return normalized.includes(pattern.slice(1, -1))
    }
    if (pattern.startsWith("*")) return normalized.endsWith(pattern.slice(1))
    if (pattern.endsWith("*")) return normalized.startsWith(pattern.slice(0, -1))
    return normalized.includes(pattern)
  })
}

/**
 * Check whether a task prompt or label mentions sensitive targets.
 * Only blocks tasks that genuinely target sensitive files — exclusion-only
 * or avoidance mentions ("do not touch .env", "exclude credentials") are
 * allowed through.
 */
export function isSensitiveTask(task: TaskNode): boolean {
  const combined = `${task.label} ${task.prompt}`.toLowerCase()
  const sentences = combined.split(/[.!?]\s+/).filter((s) => s.length > 0)

  for (const pattern of SENSITIVE_PATTERNS) {
    const term = pattern.replace(/^\*/, "").replace(/\*$/, "").toLowerCase()
    if (!combined.includes(term)) continue

    let hasTargetMention = false
    for (const sentence of sentences) {
      if (!sentence.includes(term)) continue

      if (isExclusionSentence(sentence)) continue

      hasTargetMention = true
      break
    }

    if (hasTargetMention) return true
  }

  return false
}

const EXCLUSION_PATTERNS = [
  /\bdo\s+not\s+(touch|modify|change|edit|update|alter|write|create|read)\b/,
  /\bdon'?t\s+(touch|modify|change|edit|update|alter|write|create|read)\b/,
  /\bexclud(e|ing)\b/,
  /\bwithout\s+(changing|modifying|touching|editing|updating|altering)\b/,
  /\bavoid(ing)?\b/,
  /\bexcept(\s+for)?\b/,
  /\bskip(ping)?\b/,
  /\bleave\s+(it\s+)?unchanged\b/,
  /\bleave\s+(it\s+)?alone\b/,
  /\bkeep\s+(it\s+)?(unchanged|as\s+is)\b/,
  /\bleave\s+.*\s+unchanged\b/,
  /\bbut\s+(do\s+)?not\b/,
  /\bnot\s+(to\s+)?(touch|modify|change|edit|update|alter)\b/,
  /\bpreserv(e|ing)\b/,
  /\bdo\s+not\s+expose\b/,
  /\bwithout\s+expos(ing|e)\b/,
]

function isExclusionSentence(sentence: string): boolean {
  for (const exclusionPattern of EXCLUSION_PATTERNS) {
    if (exclusionPattern.test(sentence)) return true
  }
  return false
}

// ─── Config resolution ───────────────────────────────────────────────────────

export function resolveOrchestrationConfig(config: {
  enabled?: boolean
  auto_decompose?: boolean
  auto_execute_low_risk?: boolean
  require_plan_for_high_risk?: boolean
  max_repair_attempts?: number
  default_task_timeout_ms?: number
  allow_parallel_readonly_tasks?: boolean
  allow_parallel_write_tasks?: boolean
  quality_gates?: {
    typecheck?: boolean
    lint?: boolean
    test?: boolean
    build?: boolean
    doctor?: boolean
  }
  state_dir?: string
  require_contract_for?: string[]
}): ResolvedOrchestrationConfig {
  const stateDir = config.state_dir ?? ".opencode/orchestration"
  return {
    enabled: config.enabled ?? false,
    autoDecompose: config.auto_decompose ?? true,
    autoExecuteLowRisk: config.auto_execute_low_risk ?? true,
    requirePlanForHighRisk: config.require_plan_for_high_risk ?? true,
    maxRepairAttempts: config.max_repair_attempts ?? 2,
    defaultTaskTimeoutMs: config.default_task_timeout_ms ?? 300000,
    allowParallelReadonlyTasks: config.allow_parallel_readonly_tasks ?? true,
    allowParallelWriteTasks: config.allow_parallel_write_tasks ?? false,
    qualityGates: {
      typecheck: config.quality_gates?.typecheck ?? true,
      lint: config.quality_gates?.lint ?? true,
      test: config.quality_gates?.test ?? true,
      build: config.quality_gates?.build ?? true,
      doctor: config.quality_gates?.doctor ?? false,
    },
    stateDir,
    requireContractFor: config.require_contract_for,
  }
}

// ─── Orchestration context block (plan-only, for runtime injection) ────────────

/**
 * Build a compact orchestration context block for injection into the first
 * Hecateq chat message. This is a plan-only pipeline — it runs intake,
 * decomposition, dependency planning, agent selection, and sensitive task
 * blocking, but does NOT execute batches or run quality gates.
 *
 * Designed to be called from the Hecateq project context injector hook,
 * gated on `pluginConfig.hecateq.orchestration.enabled === true`.
 */
export function buildOrchestrationContextBlock(args: {
  prompt: string
  config: ResolvedOrchestrationConfig
  agentsDir?: string
  disabledAgents?: string[]
  customAgentRegistry?: LocalAgentRegistryEntry[]
}): string {
  const {
    prompt,
    config,
    agentsDir = DEFAULT_AGENTS_DIR,
    disabledAgents = [],
    customAgentRegistry,
  } = args

  const blocks: string[] = []

  // 1. Intake
  const intake = analyzePrompt(prompt)
  blocks.push(
    `## Orchestration Plan`,
    ``,
    `**Intent:** ${intake.intent} | **Size:** ${intake.taskSize} | **Risk:** ${intake.riskLevel} | **Domains:** ${intake.likelyDomains.join(", ") || "none"}`,
    `**Requires plan:** ${intake.requiresPlan} | **Requires impl:** ${intake.requiresImplementation}`,
  )

  // 2. Decompose
  let tasks: TaskNode[] = []
  if (config.autoDecompose) {
    resetTaskCounter()
    tasks = decomposePrompt(intake)
  } else {
    tasks = [{
      id: "task_1",
      label: prompt.slice(0, 80),
      prompt,
      domain: (intake.likelyDomains[0] ?? "unknown") as TaskNode["domain"],
      action: "both",
      dependsOn: [],
      status: "pending",
    }]
  }

  // Block sensitive tasks
  tasks = blockSensitiveTasks(tasks)

  const blockedSensitive = tasks.filter((t) => t.status === "blocked")
  if (blockedSensitive.length > 0) {
    blocks.push(`**Sensitive path blocks:** ${blockedSensitive.map((t) => `\`${t.id}\` (${t.label})`).join(", ")}`)
  }

  // 3. Dependency plan
  const depPlan = buildDependencyPlan(tasks)
  blocks.push(
    `**Tasks:** ${tasks.length} | **Batches:** ${depPlan.totalBatches}${depPlan.cycle.hasCycle ? ` | **CYCLE:** ${depPlan.cycle.cycleNodeIds.join("→")}` : ""}${depPlan.blockedTaskIds.length > 0 ? ` | **Blocked:** ${depPlan.blockedTaskIds.join(", ")}` : ""}`,
  )

  if (tasks.length <= 8) {
    const taskLines = tasks.map((t) => {
      const deps = t.dependsOn.length > 0 ? ` (after ${t.dependsOn.join(", ")})` : ""
      return `  - \`${t.id}\` [${t.domain}, ${t.action}]${deps}: ${t.label}`
    })
    blocks.push("", "### Task Breakdown", "", ...taskLines)
  }

  if (depPlan.batches.length <= 6 && depPlan.batches.length > 0) {
    const batchLines = depPlan.batches.map(
      (b, i) => `  - Batch ${i + 1}: ${b.join(", ")}`,
    )
    blocks.push("", "### Execution Order", "", ...batchLines)
  }

  // 4. Agent selection
  const registry: LocalAgentRegistryEntry[] = customAgentRegistry ?? readLocalAgentRegistry(
    agentsDir,
    (p: string) => readFileSync(p, "utf-8"),
    (p: string) => { try { return readdirSync(p) } catch { return [] } },
    (p: string) => existsSync(p),
  )

  const agentSelection = selectAgents(tasks, registry, disabledAgents)
  const fallbackNotes = agentSelection.entries
    .filter((e) => !e.exactMatch || e.fallbackReason)
    .slice(0, 4)
  if (fallbackNotes.length > 0) {
    blocks.push("", "### Agent Routing")
    for (const entry of fallbackNotes) {
      blocks.push(`  - \`${entry.taskId}\` → **${entry.selectedAgent}**${entry.fallbackReason ? ` (${entry.fallbackReason})` : ""}`)
    }
    if (agentSelection.fallbackCount > 0) {
      blocks.push(`  - *${agentSelection.exactMatchCount} exact / ${agentSelection.fallbackCount} fallback*`)
    }
  }

  // 5. Unassigned warnings
  if (agentSelection.unassignedTasks.length > 0) {
    blocks.push("", "**Unassigned tasks:** " + agentSelection.unassignedTasks.map((u) => `\`${u.taskId}\`: ${u.reason}`).join("; "))
  }

  blocks.push("")
  return blocks.join("\n")
}

// ─── State persistence ───────────────────────────────────────────────────────

export function saveSessionState(stateDir: string, state: OrchestrationSessionState): void {
  if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true })
  writeFileSync(join(stateDir, `${state.id}.json`), JSON.stringify(state, null, 2), "utf-8")
}

export function loadSessionState(stateDir: string, sessionId: string): OrchestrationSessionState | null {
  const filePath = join(stateDir, `${sessionId}.json`)
  if (!existsSync(filePath)) return null
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as OrchestrationSessionState
  } catch {
    return null
  }
}

export function listSessionStates(stateDir: string): string[] {
  if (!existsSync(stateDir)) return []
  try {
    return readdirSync(stateDir).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""))
  } catch {
    return []
  }
}

// ─── Task-graph file sync (Gap 3) ────────────────────────────────────────────

const TASK_STATUS_MAP: Record<string, string> = {
  pending: "pending",
  in_progress: "in_progress",
  completed: "passed",
  failed: "failed",
  blocked: "blocked",
  skipped: "skipped",
}

export function syncTaskGraphFile(projectDir: string, sessionId: string, tasks: TaskNode[], phase: PipelinePhase): void {
  const graphsDir = join(projectDir, DEFAULT_TASK_GRAPHS_DIR)
  if (!existsSync(graphsDir)) mkdirSync(graphsDir, { recursive: true })

  const graph = {
    id: sessionId,
    label: `Orchestration ${sessionId}`,
    stages: tasks.map((t) => ({
      id: t.id,
      label: t.label,
      status: TASK_STATUS_MAP[t.status] ?? "pending",
      depends_on: t.dependsOn,
    })),
    phase,
    updated_at: new Date().toISOString(),
  }

  writeFileSync(join(graphsDir, LATEST_GRAPH_FILE), JSON.stringify(graph, null, 2), "utf-8")
}

// ─── State recovery (Gap 3) ──────────────────────────────────────────────────

export function recoverOrCreateState(
  stateDir: string,
  sessionId: string,
  prompt: string,
): OrchestrationSessionState {
  const existing = loadSessionState(stateDir, sessionId)
  if (existing) {
    // Reclassify tasks that were in_progress as failed on restart
    const recoveredTasks = existing.tasks.map((t) => {
      if (t.status === "in_progress") {
        return { ...t, status: "failed" as const, error: "Session restarted while task was running" }
      }
      return t
    })
    return {
      ...existing,
      tasks: recoveredTasks,
      updatedAt: new Date().toISOString(),
      phase: existing.phase,
    }
  }

  return {
    id: sessionId,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    prompt,
    phase: "intake",
    tasks: [],
    batches: [],
    agentAssignments: [],
    completed: false,
    failed: false,
  }
}

function updateStateTasks(
  tasks: TaskNode[],
  executionResults: TaskExecutionResult[],
): TaskNode[] {
  const resultMap = new Map(executionResults.map((r) => [r.taskId, r]))
  return tasks.map((task) => {
    const result = resultMap.get(task.id)
    if (result) {
      return {
        ...task,
        status: result.status,
        error: result.errorSummary,
        assignedAgent: result.agentId,
      }
    }
    return task
  })
}

// ─── Sensitive file blocking in task status (Gap 4) ──────────────────────────

export function blockSensitiveTasks(tasks: TaskNode[]): TaskNode[] {
  return tasks.map((task) => {
    if (isSensitiveTask(task)) {
      return {
        ...task,
        status: "blocked" as const,
        error: "Task references sensitive paths (env/secret/credential) and was blocked",
      }
    }
    return task
  })
}

// ─── Handoff metadata consumption (Wave 2) ──────────────────────────────────

/**
 * Consume handoff metadata from task execution results and record
 * routing decisions into the `.omo/hecateq/` state.
 *
 * This is the controlled routing path: decisions are recorded but
 * NO agents are auto-spawned or re-dispatched. The routing policy
 * engine classifies each handoff into a decision kind, and the
 * decision is persisted for later inspection or future auto-routing.
 *
 * Returns the routing decisions that were recorded.
 */
export function consumeHandoffAndRecordRouting(
  executionResults: TaskExecutionResult[],
  projectDir: string,
): RoutingDecision[] {
  const decisions: RoutingDecision[] = []

  for (const result of executionResults) {
    if (!result.handoffData) continue

    const { status, target, signalCount } = result.handoffData

    // Skip if there's genuinely nothing to decide
    if (!status && !target && signalCount === 0) continue

    const decision = decideRoutingFromTaskHandoff({
      status,
      target,
      signalCount,
      sourceTaskId: result.taskId,
      sourceAgent: result.agentId,
    })

    decisions.push(decision)

    // Record decision into persistent state
    try {
      const stateMgr = new OmoStateManager(projectDir)
      stateMgr.recordRoutingDecision({
        decision: decision.kind,
        reason: decision.reason,
        originalTarget: decision.originalTarget,
        decidedAt: decision.decidedAt,
        sourceTaskId: decision.sourceTaskId,
        sourceAgent: decision.sourceAgent,
      })
    } catch {
      // Best-effort persistence — never fail the pipeline
    }
  }

  return decisions
}

// ─── Main pipeline controller (Gaps 1, 7) ────────────────────────────────────

export async function runOrchestrationPipeline(args: {
  prompt: string
  config: ResolvedOrchestrationConfig
  sessionId?: string
  stateDir?: string
  agentsDir?: string
  disabledAgents?: string[]
  projectDir?: string
  customAgentRegistry?: LocalAgentRegistryEntry[]
  onPhase?: (phase: PipelinePhase, state: OrchestrationSessionState) => void
  runRepairHook?: (action: RepairAction) => RepairAction
  /** Gap 1: Injected callback for executing task batches */
  executeBatch?: TaskBatchExecutor
  /** Wave 4: Callback for executing individual delegation requests through the real runtime */
  delegationExecutor?: DelegationRequestExecutor
  /** Wave 4: Max iterations of the delegation consumption loop (prevents infinite loops) */
  maxDelegationLoopIterations?: number
  /** Wave 5 Stage 1: Auto-spawn configuration — gates delegation execution via spawn policy */
  autoSpawnConfig?: AutoSpawnConfig
  /** Wave 5 Stage 2: Config-driven max routing depth (default: 3 from constant, 0 = unlimited) */
  maxRoutingDepth?: number
}): Promise<OrchestrationReport & { executionResults?: TaskExecutionResult[] }> {
  const {
    prompt,
    config,
    sessionId = `orch_${Date.now()}`,
    stateDir = config.stateDir,
    agentsDir = DEFAULT_AGENTS_DIR,
    disabledAgents = [],
    projectDir = process.cwd(),
    customAgentRegistry,
    onPhase,
    runRepairHook,
    executeBatch,
    delegationExecutor,
    maxDelegationLoopIterations = 3,
    autoSpawnConfig,
    maxRoutingDepth,
  } = args

  // Phase 1: Intake
  const intake = analyzePrompt(prompt)
  let state = recoverOrCreateState(stateDir, sessionId, prompt)
  const hasRecoveredTasks = state.tasks.length > 0
  state.phase = "intake"
  saveSessionState(stateDir, state)
  onPhase?.("intake", state)

  // Phase 2: Decompose
  let tasks: TaskNode[] = []
  if (hasRecoveredTasks) {
    tasks = state.tasks
  } else if (config.autoDecompose) {
    resetTaskCounter()
    tasks = decomposePrompt(intake)
  } else {
    tasks = [{
      id: "task_1",
      label: prompt.slice(0, 80),
      prompt,
      domain: (intake.likelyDomains[0] ?? "unknown") as TaskNode["domain"],
      action: "both",
      dependsOn: [],
      status: "pending",
    }]
  }

  // Gap 4: Block sensitive tasks before proceeding on fresh decompositions.
  // Recovered task state already carries prior status/error decisions.
  if (!hasRecoveredTasks) {
    tasks = blockSensitiveTasks(tasks)
  }

  // Gap 3: Skip already-completed tasks on recovery
  const completedIds = new Set(tasks.filter((t) => t.status === "completed").map((t) => t.id))

  state.tasks = tasks
  state.phase = "decompose"
  saveSessionState(stateDir, state)
  onPhase?.("decompose", state)
  syncTaskGraphFile(projectDir, sessionId, tasks, "decompose")

  // Phase 3: Dependency planning
  const depPlan = buildDependencyPlan(tasks)
  state.batches = depPlan.batches
  state.phase = "dependency_plan"
  saveSessionState(stateDir, state)
  onPhase?.("dependency_plan", state)
  syncTaskGraphFile(projectDir, sessionId, tasks, "dependency_plan")

  // Phase 4: Agent selection
  const registry = customAgentRegistry ?? readLocalAgentRegistry(
    agentsDir,
    (p) => readFileSync(p, "utf-8"),
    (p) => { try { return readdirSync(p) } catch { return [] } },
    (p) => existsSync(p),
  )
  const agentSelection = selectAgents(tasks, registry, disabledAgents)

  const agentMap = new Map(agentSelection.entries.map((e) => [e.taskId, e]))
  state.tasks = state.tasks.map((task) => {
    const assignment = agentMap.get(task.id)
    if (assignment) {
      return { ...task, assignedAgent: assignment.selectedAgent, agentFallbackReason: assignment.fallbackReason }
    }
    return task
  })
  state.agentAssignments = agentSelection.entries
  state.phase = "agent_select"
  saveSessionState(stateDir, state)
  onPhase?.("agent_select", state)

  // Phase 5: Execution planning
  // Register any injected contract/plan/verify nodes as real tasks
  // so executeBatch receives real TaskNode objects — not ghost IDs.
  const execPlan = buildExecutionPlan(depPlan, agentSelection, config)
  const injectedNodes = execPlan.injectedNodes ?? []
  if (injectedNodes.length > 0) {
    // Merge injected nodes into the task list
    const existingIds = new Set(tasks.map((t) => t.id))
    for (const node of injectedNodes) {
      if (!existingIds.has(node.id)) {
        tasks.push(node)
        existingIds.add(node.id)
      }
    }
    // Create agent assignments for injected nodes (use parent task's agent or "planner")
    for (const node of injectedNodes) {
      const parentId = (node.metadata?.contractFor ?? node.metadata?.planFor ?? node.metadata?.verifiesFor) as string | undefined
      const parentAssignment = parentId ? agentSelection.entries.find((e) => e.taskId === parentId) : undefined
      const existingAssignment = agentSelection.entries.find((e) => e.taskId === node.id)
      if (!existingAssignment) {
        const selectedAgent = node.metadata?.verifiesFor
          ? "qa-test-engineer"
          : node.metadata?.contractFor || node.metadata?.planFor
            ? "prometheus"
            : parentAssignment?.selectedAgent ?? "prometheus"
        agentSelection.entries.push({
          taskId: node.id,
          selectedAgent,
          exactMatch: false,
          fallbackReason: "Auto-assigned from contract-first planner",
        })
      }
    }
    state.tasks = tasks
    state.agentAssignments = agentSelection.entries
  }

  state.phase = "execution_plan"
  saveSessionState(stateDir, state)
  onPhase?.("execution_plan", state)

  // Phase 6: Execute task batches (Gap 1)
  let executionResults: TaskExecutionResult[] = []
  if (executeBatch) {
    state.phase = "execute"
    saveSessionState(stateDir, state)
    onPhase?.("execute", state)

    for (const batch of execPlan.batches) {
      // Skip batches where all tasks are already completed (Gap 3)
      const pendingTaskIds = batch.taskIds.filter((id) => !completedIds.has(id))
      if (pendingTaskIds.length === 0) {
        // Report these as already completed
        for (const taskId of batch.taskIds) {
          executionResults.push({
            taskId,
            agentId: agentSelection.entries.find((e) => e.taskId === taskId)?.selectedAgent ?? "unknown",
            status: "completed",
            changedFiles: [],
            producedArtifacts: [],
          })
        }
        continue
      }

      const pendingBatch: ExecutionBatch = { ...batch, taskIds: pendingTaskIds }

      // Check if any tasks in this batch are sensitive-blocked
      const blockedInBatch = pendingBatch.taskIds.filter((id) => {
        const task = state.tasks.find((t) => t.id === id)
        return task?.status === "blocked"
      })

      if (blockedInBatch.length > 0 && pendingBatch.taskIds.every((id) => blockedInBatch.includes(id))) {
        // Entire batch blocked — skip execution
        for (const taskId of pendingBatch.taskIds) {
          const task = state.tasks.find((t) => t.id === taskId)
          executionResults.push({
            taskId,
            agentId: agentSelection.entries.find((e) => e.taskId === taskId)?.selectedAgent ?? "unknown",
            status: "blocked",
            changedFiles: [],
            producedArtifacts: [],
            errorSummary: task?.error ?? "Blocked by sensitive path policy",
          })
        }
        continue
      }

      const batchResults = await executeBatch(pendingBatch, state.tasks, agentSelection.entries)
      executionResults.push(...batchResults)

      // Update task statuses from execution
      state.tasks = updateStateTasks(state.tasks, batchResults)
      state.executionResults = executionResults
      saveSessionState(stateDir, state)
      syncTaskGraphFile(projectDir, sessionId, state.tasks, "execute")
    }

    // Wave 2: Consume handoff metadata from execution results
    // and record structured routing decisions into `.omo/hecateq/` state.
    // Wave 3: Additionally process those decisions into pending delegation
    // requests that the orchestrator can consume.
    const routingDecisions = consumeHandoffAndRecordRouting(executionResults, projectDir)
    if (routingDecisions.length > 0) {
      processHandoffsToDelegation({
        decisions: routingDecisions,
        tasks: state.tasks,
        projectDir,
        maxRoutingDepth,
      })
    }

    // Wave 4: Delegation consumption loop — consume and execute pending
    // delegation requests through the real runtime callback. This loop
    // bridges the gap between recording delegations and actually dispatching
    // them through the harness (e.g. task(category=..., prompt=...)).
    //
    // Wave 5 Stage 1: When autoSpawnConfig.enabled, the loop additionally:
    //   - Consults spawn policy (canSpawn) before each iteration
    //   - Records spawn start/completion in .omo/hecateq/ state
    //   - Caps capacity via maxConcurrentSpawns
    //   - Breaks the loop when spawn capacity exhausted
    //
    // Guardrails enforced:
    //   - maxDelegationLoopIterations caps total loop iterations
    //   - consumePendingDelegations() enforces per-delegation guardrails
    //     (pending status, known agent, routing depth, no duplicate)
    //   - Spawn policy gates concurrency (when autoSpawnConfig.enabled)
    //   - Handoff results from delegation executions feed back into
    //     the delegation creation pipeline for nested delegation chains
    if (delegationExecutor) {
      const autoSpawnEnabled = autoSpawnConfig?.enabled === true
      const stateMgr = new OmoStateManager(projectDir)

      state.phase = "delegation_consume"
      saveSessionState(stateDir, state)
      onPhase?.("delegation_consume", state)

      const allDelegationResults: TaskExecutionResult[] = []
      let loopIteration = 0
      let spawnSlot = 0

      while (loopIteration < maxDelegationLoopIterations) {
        loopIteration++

        // Wave 5 Stage 1: Spawn capacity gating
        if (autoSpawnEnabled && autoSpawnConfig) {
          const spawnState = {
            activeSessions: stateMgr.getActiveSpawns(),
            history: stateMgr.getSpawnHistory(),
            config: {
              maxConcurrent: autoSpawnConfig.maxConcurrentSpawns,
              pausedUntil: null,
            },
          }
          const policy = canSpawn(autoSpawnConfig, spawnState)
          if (!policy.allowed) {
            break
          }
        }

        // Wrap the executor to record spawn state when auto-spawn is enabled
        const wrappedExecutor: DelegationRequestExecutor = autoSpawnEnabled
          ? async (request) => {
              spawnSlot++
              const spawnSession: HecateqSpawnSession = {
                sessionId: `spawn_${spawnSlot}_${request.targetAgent}_${Date.now()}`,
                delegationId: request.delegationId,
                targetAgent: request.targetAgent,
                spawnedAt: new Date().toISOString(),
                status: "running",
                routingDepth: request.routingDepth,
                sourceTaskId: request.sourceTaskId,
              }

              stateMgr.recordSpawnStart(spawnSession)

              try {
                const result = await delegationExecutor!(request)

                stateMgr.recordSpawnComplete(
                  spawnSession.sessionId,
                  result.status === "completed" ? "completed" : "failed",
                  result.errorSummary,
                )

                return result
              } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error)
                stateMgr.recordSpawnComplete(
                  spawnSession.sessionId,
                  "failed",
                  errorMessage,
                )
                throw error
              }
            }
          : delegationExecutor

        const loopResult = await executePendingDelegations(
          projectDir,
          wrappedExecutor,
          { maxCount: 5, maxRoutingDepth },
        )

        allDelegationResults.push(...loopResult.results)

        // Report loop iteration to state
        state.executionResults = [...executionResults, ...allDelegationResults]
        saveSessionState(stateDir, state)
        syncTaskGraphFile(projectDir, sessionId, state.tasks, "execute")

        // Check if new delegations were created from execution handoff data
        const newDecisions = consumeHandoffAndRecordRouting(loopResult.results, projectDir)
        if (newDecisions.length === 0) {
          break
        }

        const newDelegationResult = processHandoffsToDelegation({
          decisions: newDecisions,
          tasks: state.tasks,
          projectDir,
          maxRoutingDepth,
        })

        if (newDelegationResult.created === 0) {
          break
        }

        // Check if any delegations remain pending for next iteration
        const remainingPending = stateMgr.getPendingDelegations().length
        if (remainingPending === 0) {
          break
        }

        // Wave 5 Stage 1: Check spawn capacity for next iteration
        if (autoSpawnEnabled && autoSpawnConfig) {
          const activeSpawns = stateMgr.getActiveSpawns()
          if (activeSpawns.length >= autoSpawnConfig.maxConcurrentSpawns) {
            break
          }
        }
      }

      executionResults.push(...allDelegationResults)
    }
  }

  // Phase 7: Quality gates
  let qualityGates: QualityGateReport | undefined
  let repairResult: RepairLoopResult | undefined
  const anyQualityGateEnabled = Object.values(config.qualityGates).some(Boolean)
  if (anyQualityGateEnabled) {
    state.phase = "quality_gate"
    saveSessionState(stateDir, state)
    onPhase?.("quality_gate", state)

    qualityGates = runQualityGates(projectDir, config, config.defaultTaskTimeoutMs)
    state.qualityGates = qualityGates
    saveSessionState(stateDir, state)

    if (!qualityGates.allPassed && config.maxRepairAttempts > 0) {
      state.phase = "repair"
      saveSessionState(stateDir, state)
      onPhase?.("repair", state)

      repairResult = runRepairLoop(
        qualityGates,
        tasks,
        config,
        runRepairHook ?? ((action: RepairAction): RepairAction => {
          return { ...action, attempted: true, succeeded: false }
        }),
      )
      state.repairResult = repairResult
      saveSessionState(stateDir, state)
    } else {
      repairResult = {
        actions: [],
        succeeded: true,
        totalRepairs: 0,
        successfulRepairs: 0,
        failedRepairs: 0,
        hitRetryCap: false,
      }
    }
  }

  // Phase 8: Report
  const succeeded = qualityGates
    ? (qualityGates.allPassed || (repairResult?.succeeded ?? false))
    : true
  const changedFiles: ChangedFile[] = executionResults.flatMap((r) => r.changedFiles)
  state.phase = "report"
  state.completed = true
  state.failed = !succeeded
  saveSessionState(stateDir, state)
  onPhase?.("report", state)
  syncTaskGraphFile(projectDir, sessionId, state.tasks, "report")

  const report = generateReport({
    prompt,
    intake,
    depPlan,
    agentSelection,
    execPlan,
    qualityGates,
    repairResult,
    changedFiles,
    succeeded,
    config,
  })
  state.report = report

  state.phase = "done"
  saveSessionState(stateDir, state)
  onPhase?.("done", state)

  return { ...report, executionResults }
}

export {
  analyzePrompt,
  decomposePrompt,
  buildDependencyPlan,
  selectAgents,
  readLocalAgentRegistry,
  buildExecutionPlan,
  runQualityGates,
  runRepairLoop,
  generateReport,
  renderReportAsMarkdown,
}
