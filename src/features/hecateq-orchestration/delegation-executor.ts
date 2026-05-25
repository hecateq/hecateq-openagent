/**
 * Hecateq Delegation Executor — Wave 3 Live Execution Path
 *
 * Bridges the delegation state (pending requests in `.omo/hecateq/state.json`)
 * with the actual runtime execution. This is the consumer side of the
 * producer-consumer pattern:
 *
 *   Producer: processHandoffsToDelegation() → creates pending records
 *   Consumer: consumePendingDelegations() → reads + validates + consumes + returns requests
 *   Reporter: reportDelegationResult() → persists execution outcome back to state
 *
 * The orchestrator (Hecateq God / Sisyphus) uses consumePendingDelegations() to
 * claim work, delegates via task(category=..., prompt=...), then
 * reports the result with reportDelegationResult().
 *
 * Guardrails enforced at consumption time:
 *   1. Delegation must still be pending (not already consumed)
 *   2. Target agent must be a known agent ID
 *   3. Routing depth must be within limits
 *   4. Source task must not be BLOCKED
 *   5. No duplicate consumption of the same ID
 */

import { getKnownAgentIds } from "./handoff-parser"
import { OmoStateManager } from "./omo-state-manager"
import type {
  ConsumePendingDelegationsResult,
  DelegationExecutionRequest,
  DelegationExecutionResult,
  DelegationRequestExecutor,
  TaskExecutionResult,
} from "./types"
import { HECATEQ_MAX_ROUTING_DEPTH } from "./types"

// ─── Agent → Category mapping ─────────────────────────────────────────────

/**
 * Maps known agent names to categories for the task() delegation call.
 * The category determines which model/provider is used for execution
 * through the existing delegate-task category resolution.
 *
 * Categories:
 *   ultrabrain    → heavy reasoning, architecture, complex logic
 *   deep          → autonomous multi-step execution, research
 *   unspecified-high → high-effort general-purpose fallback
 *   quick         → single-file changes, simple lookups
 *   writing       → documentation, prose
 *   visual-engineering → frontend, UI/UX
 */
const AGENT_TO_CATEGORY: Record<string, string> = {
  // Orchestrators / planners
  sisyphus: "ultrabrain",
  hephaestus: "deep",
  prometheus: "ultrabrain",
  atlas: "deep",

  // Specialist agents
  oracle: "ultrabrain",
  librarian: "quick",
  explore: "quick",

  // Backend / backend-adjacent
  "nodejs-backend-developer": "unspecified-high",
  "nodejs-backend-architect": "ultrabrain",
  "go-backend-developer": "unspecified-high",
  "database-specialist": "unspecified-high",

  // Frontend / design
  "nextjs-ui-wizard": "visual-engineering",
  "design-translator": "visual-engineering",

  // Mobile
  "flutter-dart-master": "visual-engineering",

  // QA / Security
  "qa-test-engineer": "unspecified-high",
  "security-architect": "unspecified-high",
  "performance-specialist": "unspecified-high",

  // DevOps / infra
  "devops-engineer": "unspecified-high",
  "coolify-devops-specialist": "unspecified-high",
  "realtime-systems-expert": "unspecified-high",

  // Compliance / docs
  "compliance-specialist": "unspecified-high",
  "technical-writer-documentarian": "writing",

  // Cross-cutting
  "python-ml-engineer": "deep",
  "refactoring-specialist": "unspecified-high",
  "release-manager": "ultrabrain",
}

/**
 * Resolve the task() category for a given target agent name.
 * Falls back to "unspecified-high" for unknown agents.
 */
export function agentToCategory(agentName: string): string {
  return AGENT_TO_CATEGORY[agentName] ?? "unspecified-high"
}

// ─── Consumption guardrails ───────────────────────────────────────────────

export interface GuardrailCheckResult {
  allowed: boolean
  reason?: string
}

/**
 * Check all guardrails at consumption time for a single delegation.
 * Returns { allowed: true } if all checks pass, or { allowed: false, reason } if blocked.
 *
 * @param maxRoutingDepth — config-driven max depth; 0 = unlimited
 */
function checkConsumptionGuardrails(args: {
  delegation: { id: string; targetAgent: string; routingDepth: number; status: string }
  knownAgentIds: string[]
  currentRoutingDepth: number
  maxRoutingDepth: number
}): GuardrailCheckResult {
  const { delegation, knownAgentIds, currentRoutingDepth, maxRoutingDepth } = args

  // Guardrail 1: Only consume pending delegations
  if (delegation.status !== "pending") {
    return {
      allowed: false,
      reason: `Delegation "${delegation.id}" status is "${delegation.status}", not "pending"`,
    }
  }

  // Guardrail 2: Target must be a known agent ID
  if (!knownAgentIds.includes(delegation.targetAgent)) {
    return {
      allowed: false,
      reason: `Target agent "${delegation.targetAgent}" is not a known agent ID`,
    }
  }

  // Guardrail 3: Routing depth must be within config-driven limits (0 = unlimited)
  if (maxRoutingDepth > 0 && delegation.routingDepth > maxRoutingDepth) {
    return {
      allowed: false,
      reason: `Routing depth ${delegation.routingDepth} exceeds max ${maxRoutingDepth}`,
    }
  }

  // Guardrail 4: Current routing depth check (re-check from state)
  if (maxRoutingDepth > 0 && currentRoutingDepth > maxRoutingDepth) {
    return {
      allowed: false,
      reason: `Current routing depth ${currentRoutingDepth} exceeds max ${maxRoutingDepth}`,
    }
  }

  return { allowed: true }
}

// ─── Batch consumption ────────────────────────────────────────────────────

/**
 * Atomically consume pending delegation requests and return execution requests.
 *
 * Process:
 *   1. Read all pending delegations from state
 *   2. Apply guardrail checks (still pending, known agent, depth limits)
 *   3. Move passing delegations from pending → history with result="executed"
 *   4. Return DelegationExecutionRequest[] for the orchestrator to process
 *
 * This is the primary entry point for the orchestrator to consume Hecateq
 * controlled delegation requests.
 */
export function consumePendingDelegations(
  projectDir: string,
  options?: { maxCount?: number; maxRoutingDepth?: number },
): ConsumePendingDelegationsResult {
  const stateMgr = new OmoStateManager(projectDir)
  const knownAgentIds = getKnownAgentIds()
  const currentRoutingDepth = stateMgr.getRoutingDepth()
  const maxRoutingDepth = options?.maxRoutingDepth ?? HECATEQ_MAX_ROUTING_DEPTH

  const allPending = stateMgr.getPendingDelegations()
  const requests: DelegationExecutionRequest[] = []
  let guardrailBlocked = 0
  const guardrailDetails: string[] = []

  const maxCount = options?.maxCount ?? allPending.length

  for (const delegation of allPending) {
    if (requests.length >= maxCount) break

    // Guardrail check
    const guardrail = checkConsumptionGuardrails({
      delegation: {
        id: delegation.id,
        targetAgent: delegation.targetAgent,
        routingDepth: delegation.routingDepth,
        status: delegation.status,
      },
      knownAgentIds,
      currentRoutingDepth,
      maxRoutingDepth,
    })

    if (!guardrail.allowed) {
      guardrailBlocked++
      guardrailDetails.push(
        `Consumption blocked: ${guardrail.reason} (delegation="${delegation.id}" agent="${delegation.targetAgent}")`,
      )
      // Move to history as guardrail_blocked so it won't be retried
      stateMgr.consumePendingDelegation(delegation.id, "guardrail_blocked", guardrail.reason)
      continue
    }

    // Resolve category for the target agent
    const category = agentToCategory(delegation.targetAgent)

    // Consume (move from pending to history with result="executed")
    const consumed = stateMgr.consumePendingDelegation(delegation.id, "executed")
    if (!consumed) {
      guardrailBlocked++
      guardrailDetails.push(
        `Consumption failed: unable to consume delegation "${delegation.id}"`,
      )
      continue
    }

    requests.push({
      delegationId: delegation.id,
      targetAgent: delegation.targetAgent,
      prompt: delegation.prompt,
      sourceTaskId: delegation.sourceTaskId,
      sourceAgent: delegation.sourceAgent,
      category,
      routingDepth: delegation.routingDepth,
    })
  }

  return {
    requests,
    guardrailBlocked,
    guardrailDetails,
  }
}

// ─── Result reporting ─────────────────────────────────────────────────────

/**
 * Report the final execution outcome for a consumed delegation.
 *
 * Updates the history record's `result` field to reflect what actually
 * happened during execution. This allows the orchestrator to:
 *   - Mark as "executed" after successful completion (default at consume time)
 *   - Mark as "blocked" if the target was unavailable
 *   - Mark as "skipped" if the orchestrator decided not to execute
 *
 * Returns true if the update succeeded.
 */
export function reportDelegationResult(
  projectDir: string,
  delegationId: string,
  result: DelegationExecutionResult,
  blockReason?: string,
): boolean {
  const stateMgr = new OmoStateManager(projectDir)
  return stateMgr.updateDelegationRecordResult(delegationId, result, blockReason)
}

// ─── Delegation consumption + execution loop ─────────────────────────────────

export interface ExecutePendingDelegationsResult {
  /** Execution results from the delegation executor (successful + failed) */
  results: TaskExecutionResult[]
  /** Count of requests that were consumed and passed to the executor */
  consumedCount: number
  /** Count of guardrail-blocked delegations */
  guardrailBlocked: number
  /** Total guardrail details for diagnostics */
  guardrailDetails: string[]
  /** Whether any delegation was successfully executed */
  anyExecuted: boolean
}

/**
 * Consume pending delegations, execute them through the provided callback,
 * and persist results back to state.
 *
 * This is the Wave 4 "real execution" bridge: it reads pending delegations
 * from `.omo/hecateq/state.json`, checks guardrails, calls the provided
 * executor callback for each request, and writes the outcome back.
 *
 * The executor callback follows the same pattern as TaskBatchExecutor
 * (existing runtime primitive) but operates on individual delegation
 * requests. The executor is responsible for actually dispatching the
 * delegation through the runtime (e.g. task(category=..., prompt=...)).
 *
 * Guardrails enforced at each delegation:
 *   1. Must still be pending (not already consumed)
 *   2. Target agent must be a known agent ID
 *   3. Routing depth must be within limits
 *   4. No duplicate consumption of the same ID
 *
 * @param projectDir - Project root directory
 * @param executor - Callback that executes a single delegation request
 * @param options - Optional: max count, abort signal
 * @returns Summary of what was executed
 */
export async function executePendingDelegations(
  projectDir: string,
  executor: DelegationRequestExecutor,
  options?: { maxCount?: number; signal?: AbortSignal; maxRoutingDepth?: number },
): Promise<ExecutePendingDelegationsResult> {
  // Phase 1: Consume pending delegations (with guardrail checks)
  const consumed = consumePendingDelegations(projectDir, {
    maxCount: options?.maxCount,
    maxRoutingDepth: options?.maxRoutingDepth,
  })
  const results: TaskExecutionResult[] = []

  for (const request of consumed.requests) {
    // Check for external cancellation
    if (options?.signal?.aborted) {
      // Mark remaining as skipped
      reportDelegationResult(
        projectDir,
        request.delegationId,
        "skipped",
        "Delegation execution loop was aborted",
      )
      continue
    }

    try {
      // Execute the delegation through the provided callback
      const executionResult = await executor(request)
      results.push(executionResult)

      // Report the outcome back to state
      const status = executionResult.status
      if (status === "completed") {
        reportDelegationResult(projectDir, request.delegationId, "executed")
      } else if (status === "blocked" || status === "failed") {
        reportDelegationResult(
          projectDir,
          request.delegationId,
          "blocked",
          executionResult.errorSummary ?? `Delegation execution returned status "${status}"`,
        )
      } else {
        // pending, in_progress, skipped → mark as executed in history anyway
        reportDelegationResult(projectDir, request.delegationId, "executed")
      }
    } catch (error) {
      // Executor threw — mark as blocked
      const errorMessage = error instanceof Error ? error.message : String(error)
      results.push({
        taskId: request.delegationId,
        agentId: request.targetAgent,
        status: "failed",
        changedFiles: [],
        producedArtifacts: [],
        errorSummary: `Delegation executor threw: ${errorMessage}`,
      })
      reportDelegationResult(
        projectDir,
        request.delegationId,
        "blocked",
        `Executor threw: ${errorMessage}`,
      )
    }
  }

  return {
    results,
    consumedCount: consumed.requests.length,
    guardrailBlocked: consumed.guardrailBlocked,
    guardrailDetails: consumed.guardrailDetails,
    anyExecuted: results.some((r) => r.status === "completed"),
  }
}
