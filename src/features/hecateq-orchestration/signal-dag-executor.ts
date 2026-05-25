import { OmoStateManager } from "./omo-state-manager"
import { processHandoffsToDelegation } from "./delegation-controller"
import { isKnownSignal, getSignalDefinition } from "./signal-registry"
import { SignalDagTriggerTracker, DelegationCycleDetector } from "./cycle-detector"
import { getKnownAgentIds } from "./handoff-parser"
import type {
  TaskExecutionResult,
  TaskNode,
  RoutingDecision,
  DynamicDagNode,
  DynamicDagEdge,
  DagMutationBlock,
  DagNodeProposal,
  AppliedDagMutation,
} from "./types"
import {
  HECATEQ_MAX_NODES_PER_MUTATION,
  HECATEQ_DYNAMIC_DAG_NODES_MAX,
} from "./types"

export interface SignalDagContext {
  tasks: TaskNode[]
  projectDir: string
  maxRoutingDepth?: number
  triggerTracker?: SignalDagTriggerTracker
}

export interface SignalDagTickResult {
  activatedCount: number
  activatedTaskIds: string[]
  consumedSignals: string[]
  newlyEmittedSignals: string[]
}

export function resolveReadyTasks(
  tasks: TaskNode[],
  consumedSignals: Set<string>,
): TaskNode[] {
  const taskMap = new Map(tasks.map((t) => [t.id, t]))

  return tasks.filter((task) => {
    if (task.status !== "pending") return false

    const hasSignals = task.requiredSignals && task.requiredSignals.length > 0
    const hasDeps = task.dependsOn && task.dependsOn.length > 0

    if (!hasSignals && !hasDeps) return false

    if (hasSignals && !task.requiredSignals!.every((signal) => consumedSignals.has(signal))) return false

    if (hasDeps) {
      const allDepsCompleted = task.dependsOn!.every((depId) => {
        const dep = taskMap.get(depId)
        return dep?.status === "completed"
      })
      if (!allDepsCompleted) return false
    }

    return true
  })
}

export interface SyncTaskStatusesResult {
  updatedCount: number
  updatedIds: string[]
}

export function syncTaskStatuses(
  tasks: TaskNode[],
  results: TaskExecutionResult[],
  stateMgr: OmoStateManager,
): SyncTaskStatusesResult {
  const resultMap = new Map(results.map((r) => [r.taskId, r]))
  let updatedCount = 0
  const updatedIds: string[] = []

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i]!
    const result = resultMap.get(task.id)
    if (!result) continue

    const newStatus: TaskNode["status"] =
      result.status === "completed" ? "completed"
      : result.status === "failed" ? "failed"
      : result.status === "blocked" ? "blocked"
      : result.status === "in_progress" ? "in_progress"
      : task.status

    if (task.status === newStatus) continue

    tasks[i] = { ...task, status: newStatus }
    updatedCount++
    updatedIds.push(task.id)

    if (task.metadata?.dynamic) {
      stateMgr.updateDynamicDagNodeStatus(task.id, newStatus)
    }
  }

  return { updatedCount, updatedIds }
}

export function consumeSignalsFromResults(
  results: TaskExecutionResult[],
  stateMgr: OmoStateManager,
): string[] {
  const consumed: string[] = []

  for (const result of results) {
    if (!result.handoffData || result.handoffData.signalCount === 0) continue
    if (result.status !== "completed") continue

    for (const signalName of getEmittedSignalsFromResult(result)) {
      if (!isKnownSignal(signalName)) continue
      stateMgr.emitSignal(signalName, { taskId: result.taskId, agentId: result.agentId, timestamp: new Date().toISOString() })
      consumed.push(signalName)
    }
  }
  return consumed
}

export function extractDagMutations(results: TaskExecutionResult[]): Array<{
  mutations: DagMutationBlock; sourceTaskId: string; sourceAgent: string
}> {
  const extracted: Array<{ mutations: DagMutationBlock; sourceTaskId: string; sourceAgent: string }> = []
  for (const result of results) {
    if (result.status !== "completed") continue
    if (!result.handoffData?.dagMutations) continue
    extracted.push({ mutations: result.handoffData.dagMutations, sourceTaskId: result.taskId, sourceAgent: result.agentId })
  }
  return extracted
}

export interface ApplyMutationsResult {
  appliedNodes: TaskNode[]; appliedEdges: Array<{ from: string; to: string; signal?: string }>
  rejectedReasons: string[]; nodesAdded: number; nodesRejected: number
}

export function applyDagMutations(
  mutations: DagMutationBlock, existingTasks: TaskNode[], sourceTaskId: string,
  sourceAgent: string, cycleDetector: DelegationCycleDetector, stateMgr: OmoStateManager,
): ApplyMutationsResult {
  const rejectedReasons: string[] = []; const appliedNodes: TaskNode[] = []
  let nodesRejected = 0; const knownAgentIds = getKnownAgentIds()
  const existingIds = new Set(existingTasks.map((t) => t.id))
  const proposedNodes = mutations.addNodes ?? []; const proposedEdges = mutations.addEdges ?? []

  if (proposedNodes.length > HECATEQ_MAX_NODES_PER_MUTATION) {
    rejectedReasons.push(`Too many proposed nodes: ${proposedNodes.length} exceeds max ${HECATEQ_MAX_NODES_PER_MUTATION}`)
    return { appliedNodes: [], appliedEdges: [], rejectedReasons, nodesAdded: 0, nodesRejected: proposedNodes.length }
  }
  const totalDynamic = existingTasks.filter((t) => t.metadata?.dynamic).length
  if (totalDynamic + proposedNodes.length > HECATEQ_DYNAMIC_DAG_NODES_MAX) {
    rejectedReasons.push(`Adding ${proposedNodes.length} nodes would exceed max dynamic nodes ${HECATEQ_DYNAMIC_DAG_NODES_MAX} (currently ${totalDynamic})`)
    return { appliedNodes: [], appliedEdges: [], rejectedReasons, nodesAdded: 0, nodesRejected: proposedNodes.length }
  }

  for (const proposal of proposedNodes) {
    let nodeRejected = false
    if (existingIds.has(proposal.id)) { rejectedReasons.push(`Duplicate node ID "${proposal.id}"`); nodesRejected++; continue }
    if (proposal.assignedAgent && !knownAgentIds.includes(proposal.assignedAgent)) {
      rejectedReasons.push(`Unknown assigned agent "${proposal.assignedAgent}" for node "${proposal.id}"`); nodesRejected++; continue
    }
    if (proposal.dependsOn && proposal.dependsOn.length > 0) {
      for (const depId of proposal.dependsOn) {
        if (!existingIds.has(depId)) { rejectedReasons.push(`Node "${proposal.id}" depends on unknown task "${depId}" — rejecting entire node`); nodeRejected = true; break }
      }
      if (nodeRejected) { nodesRejected++; continue }
    }
    const cycleCheck = proposal.assignedAgent ? cycleDetector.wouldCreateCycle(sourceAgent, proposal.assignedAgent) : { cycle: false as const }
    if (cycleCheck.cycle) { rejectedReasons.push(`Node "${proposal.id}" would create delegation cycle: ${cycleCheck.reason}`); nodesRejected++; continue }

    const node: TaskNode = {
      id: proposal.id, label: proposal.label, prompt: proposal.prompt,
      domain: (proposal.domain ?? "unknown") as TaskNode["domain"], action: "both",
      dependsOn: proposal.dependsOn ?? [], status: "pending",
      requiredSignals: proposal.requiredSignals, emittedSignal: proposal.emittedSignal ?? null,
      assignedAgent: proposal.assignedAgent,
      metadata: { dynamic: true, plannerMutation: true, sourceTaskId, sourceAgent },
    }
    appliedNodes.push(node); existingIds.add(node.id)

    stateMgr.recordDynamicDagNode({
      id: node.id, label: node.label, prompt: node.prompt, domain: node.domain,
      requiredSignals: node.requiredSignals ?? [], emittedSignal: node.emittedSignal ?? null,
      sourceAgent, sourceTaskId, createdAt: new Date().toISOString(), status: "pending",
    })
  }

  for (const edge of proposedEdges) {
    stateMgr.recordDynamicDagEdge({ from: edge.from, to: edge.to, signal: edge.signal, sourceTaskId, sourceAgent, createdAt: new Date().toISOString() })
    if (edge.signal) {
      const targetNode = appliedNodes.find((n) => n.id === edge.to)
      if (targetNode && targetNode.requiredSignals && !targetNode.requiredSignals.includes(edge.signal)) {
        targetNode.requiredSignals = [...targetNode.requiredSignals, edge.signal]
      }
    }
  }

  stateMgr.recordAppliedMutation({
    mutationId: `mut_${sourceTaskId}_${Date.now()}`, sourceTaskId, sourceAgent,
    appliedAt: new Date().toISOString(), nodesAdded: appliedNodes.length,
    edgesAdded: proposedEdges.length, nodesRejected, rejectReasons: rejectedReasons,
    plannerNote: mutations.plannerNote,
  })

  return { appliedNodes, appliedEdges: proposedEdges, rejectedReasons, nodesAdded: appliedNodes.length, nodesRejected }
}

export function deriveDynamicTasks(
  results: TaskExecutionResult[], existingTasks: TaskNode[], stateMgr: OmoStateManager,
): TaskNode[] {
  const newNodes: TaskNode[] = []; const existingIds = new Set(existingTasks.map((t) => t.id))
  for (const result of results) {
    if (result.status !== "completed") continue; if (!result.handoffData) continue
    const rawTarget = result.handoffData?.target; const target = typeof rawTarget === "string" ? rawTarget : null
    if (!target || target === "return_to_caller" || target === "return_to_parent_for_routing") continue
    const signals = getEmittedSignalsFromResult(result); if (signals.length === 0) continue
    const targetSignals = getSignalsEmittedByAgent(target)
    const dynamicId = `dyn_${target}_${result.taskId}_${Date.now()}`
    if (existingIds.has(dynamicId)) continue
    const existingForTarget = existingTasks.filter((t) => t.id.startsWith(`dyn_${target}_`) && t.status === "pending")
    if (existingForTarget.length > 0) continue

    const node: TaskNode = {
      id: dynamicId, label: `[dynamic] ${target}`,
      prompt: `Automatically triggered task for ${target} based on signal dependencies from "${result.taskId}"`,
      domain: "unknown", action: "both", dependsOn: [], status: "pending",
      requiredSignals: signals, emittedSignal: targetSignals.length > 0 ? targetSignals[0]!.signal : null,
      assignedAgent: target, metadata: { dynamic: true, sourceTaskId: result.taskId, sourceAgent: result.agentId },
    }
    newNodes.push(node)
    stateMgr.recordDynamicDagNode({ id: dynamicId, label: node.label, prompt: node.prompt, domain: node.domain,
      requiredSignals: signals, emittedSignal: node.emittedSignal ?? null, sourceAgent: result.agentId,
      sourceTaskId: result.taskId, createdAt: new Date().toISOString(), status: "pending" })
  }
  return newNodes
}

export interface DeleteMutationsResult {
  nodesRemoved: number
  edgesRemoved: number
  rejectedReasons: string[]
}

export function applyDeleteMutations(
  mutations: DagMutationBlock,
  existingTasks: TaskNode[],
  stateMgr: OmoStateManager,
): DeleteMutationsResult {
  const rejectedReasons: string[] = []
  let nodesRemoved = 0
  let edgesRemoved = 0

  const removeNodeIds = mutations.removeNodes ?? []
  for (const nodeId of removeNodeIds) {
    const task = existingTasks.find((t) => t.id === nodeId)
    if (!task) {
      rejectedReasons.push(`Cannot remove node "${nodeId}": not found in task list`)
      continue
    }
    if (!task.metadata?.dynamic) {
      rejectedReasons.push(`Cannot remove node "${nodeId}": not a dynamic/planner-managed node`)
      continue
    }
    if (task.status !== "pending") {
      rejectedReasons.push(`Cannot remove node "${nodeId}": status is "${task.status}" (only pending nodes can be removed)`)
      continue
    }

    task.status = "skipped"
    stateMgr.markDynamicDagNodeRemoved(nodeId)
    nodesRemoved++
  }

  const removeEdgeRefs = mutations.removeEdges ?? []
  for (const edge of removeEdgeRefs) {
    const removed = stateMgr.removeDynamicDagEdge(edge.from, edge.to)
    if (removed) {
      edgesRemoved++
    } else {
      rejectedReasons.push(`Edge "${edge.from} → ${edge.to}" not found in dynamic edges`)
    }
  }

  return { nodesRemoved, edgesRemoved, rejectedReasons }
}

export interface RewriteMutationsResult {
  nodesRewritten: number
  rejectedReasons: string[]
}

export function applyRewriteMutations(
  mutations: DagMutationBlock,
  existingTasks: TaskNode[],
  sourceAgent: string,
  cycleDetector: DelegationCycleDetector,
  stateMgr: OmoStateManager,
): RewriteMutationsResult {
  const rejectedReasons: string[] = []
  let nodesRewritten = 0
  const knownAgentIds = getKnownAgentIds()
  const existingIds = new Set(existingTasks.map((t) => t.id))

  const rewrites = mutations.rewriteNodes ?? []
  for (const rewrite of rewrites) {
    const taskIdx = existingTasks.findIndex((t) => t.id === rewrite.id)
    if (taskIdx === -1) {
      rejectedReasons.push(`Cannot rewrite node "${rewrite.id}": not found`)
      continue
    }
    const task = existingTasks[taskIdx]!
    if (!task.metadata?.dynamic) {
      rejectedReasons.push(`Cannot rewrite node "${rewrite.id}": not a dynamic/planner-managed node`)
      continue
    }
    if (task.status !== "pending") {
      rejectedReasons.push(`Cannot rewrite node "${rewrite.id}": status is "${task.status}" (only pending nodes can be rewritten)`)
      continue
    }

    if (rewrite.assignedAgent && !knownAgentIds.includes(rewrite.assignedAgent)) {
      rejectedReasons.push(`Rewrite rejected for "${rewrite.id}": unknown agent "${rewrite.assignedAgent}"`)
      continue
    }

    if (rewrite.dependsOn) {
      for (const depId of rewrite.dependsOn) {
        if (!existingIds.has(depId) && depId !== rewrite.id) {
          rejectedReasons.push(`Rewrite rejected for "${rewrite.id}": depends on unknown task "${depId}"`)
          continue
        }
      }
    }

    const cycleCheck = rewrite.assignedAgent
      ? cycleDetector.wouldCreateCycle(sourceAgent, rewrite.assignedAgent)
      : { cycle: false as const }
    if (cycleCheck.cycle) {
      rejectedReasons.push(`Rewrite rejected for "${rewrite.id}": would create delegation cycle`)
      continue
    }

    const updated: TaskNode = { ...task }
    if (rewrite.label !== undefined) updated.label = rewrite.label
    if (rewrite.prompt !== undefined) updated.prompt = rewrite.prompt
    if (rewrite.requiredSignals !== undefined) updated.requiredSignals = rewrite.requiredSignals
    if (rewrite.dependsOn !== undefined) updated.dependsOn = rewrite.dependsOn
    if (rewrite.emittedSignal !== undefined) updated.emittedSignal = rewrite.emittedSignal
    if (rewrite.assignedAgent !== undefined) updated.assignedAgent = rewrite.assignedAgent

    existingTasks[taskIdx] = updated
    nodesRewritten++

    stateMgr.updateDynamicDagNodeFields(rewrite.id, {
      label: updated.label,
      prompt: updated.prompt,
      requiredSignals: updated.requiredSignals ?? [],
      emittedSignal: updated.emittedSignal ?? null,
    })
  }

  return { nodesRewritten, rejectedReasons }
}

function getSignalsEmittedByAgent(agent: string): Array<{ signal: string }> {
  const signalMap: Record<string, string> = {
    "database-specialist": "schema_ready", "nodejs-backend-developer": "backend_ready",
    "go-backend-developer": "backend_ready", "design-translator": "ui_specs_ready",
    "security-architect": "auth_audit_passed", "coolify-devops-specialist": "infra_provisioned",
    "devops-engineer": "infra_provisioned", "devsecops-pipeline-architect": "pipeline_secured",
    "qa-test-engineer": "tests_passed", "performance-specialist": "performance_verified",
    "compliance-specialist": "compliance_signed",
  }
  const signal = signalMap[agent]; return signal ? [{ signal }] : []
}

function getEmittedSignalsFromResult(result: TaskExecutionResult): string[] {
  if (!result.handoffData) return []

  const signals: string[] = []

  const def = result.handoffData as Record<string, unknown>
  if (def.emittedSignals && Array.isArray(def.emittedSignals)) {
    for (const s of def.emittedSignals) {
      if (typeof s === "string") signals.push(s)
    }
  }

  if (result.handoffData.signalCount > 0 && signals.length === 0) {
    const signalMap: Record<string, string> = {
      "database-specialist": "schema_ready",
      "nodejs-backend-developer": "backend_ready",
      "go-backend-developer": "backend_ready",
      "design-translator": "ui_specs_ready",
      "security-architect": "auth_audit_passed",
      "coolify-devops-specialist": "infra_provisioned",
      "devops-engineer": "infra_provisioned",
      "devsecops-pipeline-architect": "pipeline_secured",
      "qa-test-engineer": "tests_passed",
      "performance-specialist": "performance_verified",
      "compliance-specialist": "compliance_signed",
    }

    const signal = signalMap[result.agentId]
    if (signal) {
      signals.push(signal)
    }
  }

  return signals
}

export function signalDagTick(ctx: SignalDagContext): SignalDagTickResult {
  const { tasks, projectDir, maxRoutingDepth } = ctx
  const stateMgr = new OmoStateManager(projectDir)

  // Consume pending signals so downstream tasks can see them
  const pendingSignals = stateMgr.getPendingSignals()
  for (const pending of pendingSignals) {
    stateMgr.consumeSignal(pending.signal)
  }

  const consumedSignals = stateMgr.getConsumedSignals()
  const consumedSignalNames = new Set(consumedSignals.map((s) => s.signal))

  const readyTasks = resolveReadyTasks(tasks, consumedSignalNames)

  const tracker = ctx.triggerTracker
  const newTasks = tracker
    ? readyTasks.filter((t) => !tracker.isAlreadyTriggered(t.id))
    : readyTasks

  if (newTasks.length === 0) {
    return {
      activatedCount: 0,
      activatedTaskIds: [],
      consumedSignals: [],
      newlyEmittedSignals: [],
    }
  }

  const decisions: RoutingDecision[] = readyTasks.map((task) => ({
    kind: "return_to_caller" as const,
    reason: `Signal-DAG: all required signals satisfied for "${task.id}"`,
    originalTarget: task.assignedAgent ?? null,
    decidedAt: new Date().toISOString(),
    sourceTaskId: task.id,
    sourceAgent: task.assignedAgent,
  }))

  const delegationResult = processHandoffsToDelegation({
    decisions,
    tasks: newTasks,
    projectDir,
    maxRoutingDepth,
  })

  if (tracker) {
    for (const task of newTasks) {
      tracker.markTriggered(task.id)
    }
  }

  return {
    activatedCount: delegationResult.created,
    activatedTaskIds: readyTasks.map((t) => t.id),
    consumedSignals: [...consumedSignalNames],
    newlyEmittedSignals: [],
  }
}
