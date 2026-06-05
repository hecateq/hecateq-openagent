import { executePendingDelegations } from "./delegation-executor"
import { processHandoffsToDelegation } from "./delegation-controller"
import { consumeHandoffAndRecordRouting } from "./orchestration-controller"
import { OmoStateManager } from "./omo-state-manager"
import { canSpawn } from "../autonomous-spawn/spawn-policy"
import { SpawnRateLimiter } from "../autonomous-spawn/spawn-rate-limiter"
import type { AutoSpawnConfig } from "../autonomous-spawn/types"
import type { DelegationRequestExecutor, TaskExecutionResult, DynamicDagNode, RoutingDecision, HecateqGuardrailBlockDetail } from "./types"
import { DelegationCycleDetector } from "./cycle-detector"
import { SignalDagTriggerTracker } from "./cycle-detector"
import { consumeSignalsFromResults, signalDagTick, deriveDynamicTasks, extractDagMutations, applyDagMutations, syncTaskStatuses, applyDeleteMutations, applyRewriteMutations } from "./signal-dag-executor"
import type { SignalDagContext } from "./signal-dag-executor"

export interface ConsumeDelegationsArgs {
  projectDir: string
  executor: DelegationRequestExecutor
  autoSpawnConfig?: AutoSpawnConfig
  maxRoutingDepth?: number
  maxIterations?: number
  maxCountPerIteration?: number
  maxFanOut?: number
  rateLimiter?: SpawnRateLimiter
  signalDagContext?: SignalDagContext
}

export interface ConsumeDelegationsResult {
  results: TaskExecutionResult[]
  iterations: number
  totalConsumed: number
  guardrailBlocked: number
  spawnPolicyBlocked: boolean
  rateLimitBlocked: boolean
  /**
   * Routing decisions that are user-visible and should trigger adapter-level
   * toast notifications. Populated from handoff routing decisions collected
   * during the consumption loop. Only includes kinds that indicate routing
   * blocks or policy violations (role_policy_violation, invalid_target_blocked).
   * Pure orchestration files never import TUI helpers; toast display is owned
   * by the caller/adapter layer.
   */
  userVisibleRoutingDecisions: RoutingDecision[]
  /**
   * Typed guardrail block details for adapter-layer toast display.
   * Aggregated from delegation-executor and delegation-controller guardrail
   * checks during the consumption loop. Defaults to empty array.
   * Pure orchestration files never import TUI helpers.
   */
  userVisibleGuardrailBlocks: HecateqGuardrailBlockDetail[]
}

export async function consumeDelegationsAtRuntime(
  args: ConsumeDelegationsArgs,
): Promise<ConsumeDelegationsResult> {
  const {
    projectDir,
    executor,
    autoSpawnConfig,
    maxRoutingDepth,
    maxIterations = 3,
    maxCountPerIteration = 5,
    maxFanOut,
    rateLimiter,
    signalDagContext,
  } = args

  const autoSpawnEnabled = autoSpawnConfig?.enabled === true
  const stateMgr = new OmoStateManager(projectDir)
  const cycleDetector = new DelegationCycleDetector()
  const triggerTracker = new SignalDagTriggerTracker()
  const allResults: TaskExecutionResult[] = []
  const userVisibleRoutingDecisions: RoutingDecision[] = []
  const userVisibleGuardrailBlocks: HecateqGuardrailBlockDetail[] = []
  let totalConsumed = 0
  let totalBlocked = 0
  let spawnPolicyBlocked = false
  let rateLimitBlocked = false

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    if (autoSpawnEnabled && autoSpawnConfig) {
      const activeSpawns = stateMgr.getActiveSpawns()
      const spawnState = {
        activeSessions: activeSpawns,
        history: [],
        config: {
          maxConcurrent: autoSpawnConfig.maxConcurrentSpawns,
          pausedUntil: null,
        },
      }
      const policy = canSpawn(autoSpawnConfig, spawnState)
      if (!policy.allowed) {
        spawnPolicyBlocked = true
        break
      }
    }

    if (rateLimiter && !rateLimiter.tryAcquire()) {
      rateLimitBlocked = true
      break
    }

    const loopResult = await executePendingDelegations(projectDir, executor, {
      maxCount: maxCountPerIteration,
      maxRoutingDepth,
    })

    allResults.push(...loopResult.results)
    totalConsumed += loopResult.consumedCount
    totalBlocked += loopResult.guardrailBlocked
    if (loopResult.guardrailBlocks && loopResult.guardrailBlocks.length > 0) {
      userVisibleGuardrailBlocks.push(...loopResult.guardrailBlocks)
    }

    // Sync task statuses from execution results
    if (signalDagContext) {
      syncTaskStatuses(signalDagContext.tasks, loopResult.results, stateMgr)
    }

    // Stage 3: Consume signals from completed delegation results
    if (signalDagContext && loopResult.results.length > 0) {
      consumeSignalsFromResults(loopResult.results, stateMgr)

      // Stage 2 (stretch): Derive dynamic DAG nodes from handoff targets
      const dynamicNodes = deriveDynamicTasks(loopResult.results, signalDagContext.tasks, stateMgr)
      if (dynamicNodes.length > 0) {
        signalDagContext.tasks = [...signalDagContext.tasks, ...dynamicNodes]
      }

      // Stage 2 (gap-closure): Apply planner DAG mutations from completed results
      const mutationPayloads = extractDagMutations(loopResult.results)
      for (const { mutations, sourceTaskId, sourceAgent } of mutationPayloads) {
        const applied = applyDagMutations(
          mutations,
          signalDagContext.tasks,
          sourceTaskId,
          sourceAgent,
          cycleDetector,
          stateMgr,
        )

        if (applied.appliedNodes.length > 0) {
          signalDagContext.tasks = [...signalDagContext.tasks, ...applied.appliedNodes]
        }

        applyDeleteMutations(mutations, signalDagContext.tasks, stateMgr)
        applyRewriteMutations(mutations, signalDagContext.tasks, sourceAgent, cycleDetector, stateMgr)
      }
    }

    const newDecisions = consumeHandoffAndRecordRouting(loopResult.results, projectDir)

    for (const d of newDecisions) {
      if (d.kind === "role_policy_violation" || d.kind === "invalid_target_blocked") {
        userVisibleRoutingDecisions.push(d)
      }
    }

    if (newDecisions.length > 0) {
      processHandoffsToDelegation({
        decisions: newDecisions,
        tasks: [],
        projectDir,
        maxRoutingDepth,
        maxFanOut,
        cycleDetector,
      })
    }

    // Stage 3: Signal-DAG tick — trigger downstream tasks that are now ready
    let dagActivated = false
    if (signalDagContext) {
      const dagCtx = { ...signalDagContext, triggerTracker }
      const dagResult = signalDagTick(dagCtx)
      dagActivated = dagResult.activatedCount > 0
    }

    if (!loopResult.anyExecuted && loopResult.consumedCount === 0 && !dagActivated) {
      break
    }

    const remainingPending = stateMgr.getPendingDelegations().length
    if (remainingPending === 0 && !dagActivated) {
      break
    }
  }

  return {
    results: allResults,
    iterations: allResults.length > 0
      ? Math.ceil(allResults.length / maxCountPerIteration)
      : 0,
    totalConsumed,
    guardrailBlocked: totalBlocked,
    spawnPolicyBlocked,
    rateLimitBlocked,
    userVisibleRoutingDecisions,
    userVisibleGuardrailBlocks,
  }
}
