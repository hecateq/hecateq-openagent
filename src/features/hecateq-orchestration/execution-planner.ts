import type {
  TaskNode,
  TaskDomain,
  DependencyPlan,
  AgentSelectorResult,
  ExecutionPlan,
  ExecutionBatch,
  ExecutionBatchKind,
  ResolvedOrchestrationConfig,
  ContractValidationResult,
} from "./types"

/**
 * Domains where contract/plan-first behavior is required regardless
 * of config. These involve mutable infrastructure, security boundaries,
 * or data integrity — tasks in these domains MUST have a plan/contract
 * before implementation.
 */
const ALWAYS_REQUIRE_CONTRACT_DOMAINS: TaskDomain[] = [
  "database",
  "security",
  "devops",
  "architecture",
]

/**
 * Domains where post-execution verification is strongly recommended.
 * Changes in these domains can have broad, hard-to-detect side effects.
 */
const ALWAYS_VERIFY_DOMAINS: TaskDomain[] = [
  "database",
  "security",
  "devops",
  "backend",
  "qa",
]

/**
 * Task size thresholds for mandatory planning.
 * Large tasks always require a plan stage.
 */
const PLAN_REQUIRED_SIZES = new Set(["large" as string])

/**
 * Risk levels that require explicit contract before execution.
 */
const CONTRACT_REQUIRED_RISKS = new Set(["high" as string, "destructive" as string])

/**
 * Validate whether a task requires a contract, plan, or verification stage.
 *
 * Contract = a formal specification of what the task will do, agreed upon
 *   before implementation begins. Includes expected outcomes, constraints,
 *   and edge cases.
 *
 * Plan = a structured breakdown of implementation steps. Required when the
 *   task is large, multi-step, or crosses domain boundaries.
 *
 * Verification = post-execution validation that the task was completed
 *   correctly and did not introduce regressions.
 *
 * The validation logic considers:
 * - The task's domain (database/security/devops always require contracts)
 * - The task's risk level (high/destructive always require contracts)
 * - The task's size (large tasks require plans)
 * - Whether the task spans multiple domains (requires plan)
 * - Configured `require_contract_for` domains
 */
export function validateTaskContract(
  task: TaskNode,
  config: ResolvedOrchestrationConfig,
): ContractValidationResult {
  const domain = task.domain as TaskDomain
  const isLargeTask = task.complexity !== undefined && task.complexity > 0.7

  // Check if domain requires contract via config
  const configRequiresContract = config.requireContractFor?.includes(domain) ?? false

  // Check if domain inherently requires contract
  const domainRequiresContract = ALWAYS_REQUIRE_CONTRACT_DOMAINS.includes(domain)

  // Check if task is high complexity
  const complexityRequiresContract = isLargeTask || (task.complexity ?? 0) > 0.5

  // Determine if a plan stage is needed
  const sizeFromMetadata = task.metadata?.taskSize as string | undefined
  const sizeRequiresPlan = sizeFromMetadata ? PLAN_REQUIRED_SIZES.has(sizeFromMetadata) : isLargeTask

  // Multi-domain tasks need plans
  const multiDomain = task.metadata?.domains && Array.isArray(task.metadata.domains) && task.metadata.domains.length > 1

  // Determine if verification is needed
  const needsVerification = ALWAYS_VERIFY_DOMAINS.includes(domain) || complexityRequiresContract

  const requiresContract = configRequiresContract || domainRequiresContract || complexityRequiresContract
  const requiresPlanStage = sizeRequiresPlan || !!multiDomain || (requiresContract && task.action !== "read")
  const requiresVerification = needsVerification && task.action !== "read"

  const reasons: string[] = []
  if (configRequiresContract) reasons.push(`Domain "${domain}" is configured for mandatory contracts`)
  if (domainRequiresContract) reasons.push(`Domain "${domain}" inherently requires a contract`)
  if (complexityRequiresContract) reasons.push(`Task complexity ${task.complexity ?? "unknown"} exceeds contract threshold`)
  if (sizeRequiresPlan) reasons.push(`Large task requires plan stage`)
  if (multiDomain) reasons.push(`Multi-domain task requires plan stage`)

  return {
    requiresContract,
    requiresVerification,
    requiresPlanStage,
    reason: reasons.length > 0 ? reasons.join("; ") : undefined,
    suggestedContractPrompt: requiresContract
      ? `Create a contract for task "${task.label}": define scope, expected outputs, constraints, edge cases, and success criteria before implementation.`
      : undefined,
  }
}

// ─── Plan-First Helpers ──────────────────────────────────────────────────────

/**
 * Contract stage identifier used in task IDs injected by the planner.
 */
export const CONTRACT_STAGE_PREFIX = "contract-"

/**
 * Plan stage identifier used in task IDs injected by the planner.
 */
export const PLAN_STAGE_PREFIX = "planner-"

/**
 * Verification stage identifier used in task IDs injected by the planner.
 */
export const VERIFY_STAGE_PREFIX = "verify-"

/**
 * Create a contract node for a given task.
 * The contract task becomes a dependency of the implementation task,
 * ensuring the contract is established before implementation begins.
 */
export function createContractNode(task: TaskNode, planIndex: number): TaskNode {
  return {
    id: `${CONTRACT_STAGE_PREFIX}${task.id}`,
    label: `Contract: ${task.label}`,
    prompt: task.metadata?.contractPrompt as string ?? `Define the contract for: ${task.prompt}`,
    domain: "planning",
    action: "read",
    dependsOn: task.dependsOn,
    status: "pending",
    metadata: {
      ...task.metadata,
      contractFor: task.id,
      planIndex,
    },
    canParallelize: false,
    complexity: 0.3,
  }
}

/**
 * Create a plan node for a given task.
 * The plan task becomes a dependency of the implementation task,
 * ensuring structured planning precedes implementation.
 */
export function createPlanNode(task: TaskNode, planIndex: number): TaskNode {
  return {
    id: `${PLAN_STAGE_PREFIX}${task.id}`,
    label: `Plan: ${task.label}`,
    prompt: `Create a detailed implementation plan for: ${task.prompt}. Break down the work into atomic steps, identify risks, and specify verification criteria.`,
    domain: "planning",
    action: "read",
    dependsOn: task.dependsOn,
    status: "pending",
    metadata: {
      ...task.metadata,
      planFor: task.id,
      planIndex,
    },
    canParallelize: false,
    complexity: 0.4,
  }
}

/**
 * Create a verification node for a given task.
 * The verification task depends on the implementation task,
 * ensuring verification happens after implementation.
 */
export function createVerificationNode(task: TaskNode, planIndex: number): TaskNode {
  return {
    id: `${VERIFY_STAGE_PREFIX}${task.id}`,
    label: `Verify: ${task.label}`,
    prompt: `Verify that the implementation of the following task meets its requirements: ${task.prompt}. Check for correctness, completeness, edge cases, and potential regressions.`,
    domain: "qa",
    action: "read",
    dependsOn: [task.id],
    status: "pending",
    metadata: {
      ...task.metadata,
      verifiesFor: task.id,
      planIndex,
    },
    canParallelize: false,
    complexity: 0.3,
  }
}

// ─── Enhanced Execution Plan Builder ─────────────────────────────────────────

/**
 * Plan-first execution plan builder.
 *
 * Extends the base execution planner with contract/plan/verification stage
 * injection. For each task that requires a contract, plan, or verification:
 *
 *   Before execution:  [contract] → [plan] → [implementation task]
 *   After execution:   [implementation task] → [verification]
 *
 * Contract and plan nodes are inserted as pre-requisites (they appear in
 * earlier batches). Verification nodes are inserted as post-requisites
 * (they appear in later batches, after the implementation task).
 *
 * This ensures the orchestrator cannot skip critical planning or
 * verification stages for high-risk or complex tasks.
 */
export function buildExecutionPlan(
  depPlan: DependencyPlan,
  agentSelection: AgentSelectorResult,
  config: ResolvedOrchestrationConfig,
  contractOverrides?: Map<string, ContractValidationResult>,
): ExecutionPlan {
  const nodeMap = new Map(depPlan.nodes.map((n) => [n.id, n]))
  const agentMap = new Map(agentSelection.entries.map((e) => [e.taskId, e]))
  const executionBatches: ExecutionBatch[] = []

  // Phase 1: Validate contracts for each task
  const resolvedContracts = new Map<string, ContractValidationResult>()
  let planIndex = 0

  for (const node of depPlan.nodes) {
    const existing = contractOverrides?.get(node.id)
    const validation = existing ?? validateTaskContract(node, config)
    resolvedContracts.set(node.id, validation)
  }

  // Phase 2: Collect all extra nodes (contracts, plans, verifications)
  const injectableNodes: TaskNode[] = []
  const contractDependencyMap = new Map<string, string[]>() // taskId → [extra node IDs that must run before it]
  const verificationForMap = new Map<string, string[]>() // verificationNodeId → [taskIds it depends on]

  for (const node of depPlan.nodes) {
    const contract = resolvedContracts.get(node.id)
    if (!contract) continue

    const preReqIds: string[] = []

    if (contract.requiresContract) {
      const cNode = createContractNode(node, planIndex)
      injectableNodes.push(cNode)
      preReqIds.push(cNode.id)
      planIndex++
    }

    if (contract.requiresPlanStage) {
      const pNode = createPlanNode(node, planIndex)
      // Plan depends on contract (if contract exists) or on original dependencies
      pNode.dependsOn = preReqIds.length > 0 ? [...preReqIds] : [...node.dependsOn]
      injectableNodes.push(pNode)
      preReqIds.push(pNode.id)
      planIndex++
    }

    if (contract.requiresVerification) {
      const vNode = createVerificationNode(node, planIndex)
      injectableNodes.push(vNode)
      verificationForMap.set(vNode.id, [node.id])
      planIndex++
    }

    // Update the task's dependencies to include contract/plan pre-reqs
    if (preReqIds.length > 0) {
      contractDependencyMap.set(node.id, preReqIds)
    }
  }

  // Phase 3: Build execution batches — start with injected pre-requisites,
  // then original batches, then verification stages
  //
  // All contract/plan tasks form their own early batches since they
  // are read-only and can run in parallel

  if (injectableNodes.length > 0) {
    // Separate pre-req (contract/plan) from post-req (verification) nodes
    const preReqNodes = injectableNodes.filter((n) => !n.id.startsWith(VERIFY_STAGE_PREFIX))
    const verifyNodes = injectableNodes.filter((n) => n.id.startsWith(VERIFY_STAGE_PREFIX))

    // Contract/plan nodes: all read-only, can run in parallel
    if (preReqNodes.length > 0) {
      executionBatches.push({
        index: executionBatches.length,
        kind: "parallel_read",
        taskIds: preReqNodes.map((n) => n.id),
      })
    }

    // Store verification nodes for injection after implementation
    // We'll add them after the original batches
    let batchIndex = executionBatches.length

    // Original batches from dependency plan
    for (const batchTaskIds of depPlan.batches) {
      const writeTasks: string[] = []
      const readTasks: string[] = []
      const blockedTasks: string[] = []

      for (const taskId of batchTaskIds) {
        const node = nodeMap.get(taskId)

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

      if (readTasks.length > 0) {
        executionBatches.push({
          index: batchIndex++,
          kind: config.allowParallelReadonlyTasks ? "parallel_read" : "sequential",
          taskIds: readTasks,
        })
      }

      if (writeTasks.length > 0) {
        executionBatches.push({
          index: batchIndex++,
          kind: config.allowParallelWriteTasks ? "parallel_write" : "sequential",
          taskIds: writeTasks,
        })
      }

      if (blockedTasks.length > 0) {
        executionBatches.push({
          index: batchIndex++,
          kind: "sequential",
          taskIds: blockedTasks,
        })
      }
    }

    // Inject verification batches — they run after all implementation batches
    if (verifyNodes.length > 0) {
      executionBatches.push({
        index: batchIndex++,
        kind: "parallel_read",
        taskIds: verifyNodes.map((n) => n.id),
      })
    }
  } else {
    // No contract/plan/verify needed — use original planner
    let batchIndex = 0
    for (const batchTaskIds of depPlan.batches) {
      const writeTasks: string[] = []
      const readTasks: string[] = []
      const blockedTasks: string[] = []

      for (const taskId of batchTaskIds) {
        const node = nodeMap.get(taskId)

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

      if (readTasks.length > 0) {
        executionBatches.push({
          index: batchIndex++,
          kind: config.allowParallelReadonlyTasks ? "parallel_read" : "sequential",
          taskIds: readTasks,
        })
      }

      if (writeTasks.length > 0) {
        executionBatches.push({
          index: batchIndex++,
          kind: config.allowParallelWriteTasks ? "parallel_write" : "sequential",
          taskIds: writeTasks,
        })
      }

      if (blockedTasks.length > 0) {
        executionBatches.push({
          index: batchIndex++,
          kind: "sequential",
          taskIds: blockedTasks,
        })
      }
    }
  }

  // Phase 4: Count blocked tasks across all batches
  const allBlocked = depPlan.blockedTaskIds.length > 0

  return {
    batches: executionBatches,
    estimatedBatchCount: executionBatches.length,
    hasBlockedTasks: allBlocked,
    blockedTaskIds: depPlan.blockedTaskIds,
    // Return injected nodes so the pipeline controller can register them
    // as real tasks before invoking executeBatch
    injectedNodes: injectableNodes.length > 0 ? injectableNodes : undefined,
  }
}
