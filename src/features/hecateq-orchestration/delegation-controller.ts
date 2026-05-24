/**
 * Hecateq Delegation Controller — Wave 3
 *
 * Controlled handoff-target delegation: reads routing decisions from the
 * `.omo/hecateq/` state, validates against strict guardrails, and produces
 * deterministic "next delegation request" entries that the orchestrator
 * (Hecateq God) can immediately consume via the existing task/delegate
 * infrastructure.
 *
 * This is NOT auto-spawning. It is a state machine that the orchestrator
 * reads. The orchestrator decides whether to actually spawn using the
 * existing `task(category=..., ...)` or `task(subagent_type=..., ...)` tool.
 *
 * Guardrails:
 *   1. MAX_ROUTING_DEPTH = 3     — caps nested delegation chains
 *   2. Dedup by target+task+source — no same-task endless respawn
 *   3. BLOCKED source gating      — never delegate from blocked status
 *   4. Known agent ID only        — unknown targets remain fallback/blocked
 *   5. No routing directives      — "return_to_caller"/"return_to_parent_for_routing"
 *                                   are directives, not agent targets
 */

import { getKnownAgentIds } from "./handoff-parser"
import { OmoStateManager } from "./omo-state-manager"
import { isTerminalDecision } from "./routing-policy-engine"
import type { HecateqPendingDelegation, RoutingDecision, TaskNode } from "./types"
import { HECATEQ_MAX_ROUTING_DEPTH } from "./types"
import { emitTraceEvent } from "../../shared/runtime-trace"

// ─── Guards ─────────────────────────────────────────────────────────────────

function isRoutingDirective(target: string): boolean {
  return target === "return_to_caller" || target === "return_to_parent_for_routing"
}

/**
 * Check whether a pending delegation would be a duplicate.
 * Dedup key: targetAgent + sourceTaskId + prompt prefix (first 200 chars).
 */
function isDuplicateDelegation(
  delegation: { targetAgent: string; sourceTaskId?: string; prompt: string },
  existingPending: HecateqPendingDelegation[],
): boolean {
  const promptKey = delegation.prompt.slice(0, 200)
  return existingPending.some(
    (d) =>
      d.targetAgent === delegation.targetAgent &&
      d.sourceTaskId === delegation.sourceTaskId &&
      d.prompt.slice(0, 200) === promptKey,
  )
}

// ─── Controller ─────────────────────────────────────────────────────────────

export interface DelegationControllerResult {
  /** Pending delegations that were created or already existed */
  pending: HecateqPendingDelegation[]
  /** Count of new delegations created in this run */
  created: number
  /** Count of delegations skipped due to guardrails */
  guardrailSkipped: number
  /** Details of each guardrail skip */
  guardrailDetails: string[]
}

/**
 * Process a batch of routing decisions and task nodes into pending delegation
 * requests. This is the controlled Wave 3 delegation path — NO agents are
 * auto-spawned. The resulting pending delegations are stored in
 * `.omo/hecateq/state.json` for the orchestrator to consume.
 */
export function processHandoffsToDelegation(args: {
  decisions: RoutingDecision[]
  tasks: TaskNode[]
  projectDir: string
}): DelegationControllerResult {
  const { decisions, tasks, projectDir } = args
  const stateMgr = new OmoStateManager(projectDir)

  const knownAgentIds = getKnownAgentIds()
  const routingDirectives = new Set(["return_to_caller", "return_to_parent_for_routing"])

  // Separate known agent IDs from routing directives
  const knownAgentsExcludingDirectives = knownAgentIds.filter(
    (id) => !routingDirectives.has(id),
  )

  const existingPending = stateMgr.getPendingDelegations()
  const routingDepth = stateMgr.getRoutingDepth()

  let created = 0
  let guardrailSkipped = 0
  const guardrailDetails: string[] = []

  for (const decision of decisions) {
    // ── Guardrail 1: Only act on return_to_caller decisions ──────────────────
    if (decision.kind !== "return_to_caller") {
      // Non-actionable decision kinds: skip silently (not an error)
      // - invalid_target_blocked: BLOCKED status, never delegate
      // - no_handoff_data: nothing to act on
      // - unknown_target_fallback: policy engine already classified, remain blocked
      // - return_to_parent_for_routing: needs human-level routing
      if (!isTerminalDecision(decision.kind) && decision.kind !== "unknown_target_fallback") {
        guardrailSkipped++
        guardrailDetails.push(
          `Skipped decision kind="${decision.kind}" target="${decision.originalTarget}" — not a delegatable kind`,
        )
      }
      continue
    }

    const target = decision.originalTarget
    if (!target) continue

    // ── Guardrail 2: Only act on known agent IDs (not routing directives) ────
    if (isRoutingDirective(target)) {
      guardrailSkipped++
      guardrailDetails.push(
        `Skipped target="${target}" — routing directive, not an agent ID`,
      )
      continue
    }

    // ── Guardrail 3: Target must be a known agent ID ─────────────────────────
    if (!knownAgentsExcludingDirectives.includes(target)) {
      // This should not normally happen since the routing policy engine already
      // classifies unknown targets as "unknown_target_fallback", but guard anyway.
      guardrailSkipped++
      guardrailDetails.push(
        `Skipped target="${target}" — not in known agent IDs (post-policy guard)`,
      )
      continue
    }

    // ── Guardrail 4: Max routing depth ───────────────────────────────────────
    if (routingDepth >= HECATEQ_MAX_ROUTING_DEPTH) {
      guardrailSkipped++
      guardrailDetails.push(
        `Skipped target="${target}" — routing depth ${routingDepth} >= max ${HECATEQ_MAX_ROUTING_DEPTH}`,
      )
      continue
    }

    // ── Find the source task for prompt content ──────────────────────────────
    const sourceTask = tasks.find((t) => t.id === decision.sourceTaskId)
    const prompt = sourceTask?.prompt ?? `Delegated task: ${target}`
    const label = sourceTask?.label ?? prompt.slice(0, 80)

    // ── Guardrail 5: No delegation from BLOCKED tasks ────────────────────────
    if (sourceTask?.status === "blocked") {
      guardrailSkipped++
      guardrailDetails.push(
        `Skipped sourceTaskId="${decision.sourceTaskId}" target="${target}" — source task is BLOCKED`,
      )
      continue
    }

    // ── Guardrail 6: Dedup — no same-task endless respawn ────────────────────
    const candidate = {
      targetAgent: target,
      sourceTaskId: decision.sourceTaskId,
      prompt: `${label}\n\n${prompt}`,
    }
    if (isDuplicateDelegation(candidate, existingPending)) {
      guardrailSkipped++
      const detail = `Skipped dedup: target="${target}" sourceTaskId="${decision.sourceTaskId}" — already pending`
      guardrailDetails.push(detail)
      emitTraceEvent("delegation.guardrail_skipped", "delegation", {
        reason: detail,
        target,
        sourceTaskId: decision.sourceTaskId,
      })
      continue
    }

    // ── All guardrails passed → create pending delegation ────────────────────
    const delegationId = `dlg_${target}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const pendingDelegation: HecateqPendingDelegation = {
      id: delegationId,
      targetAgent: target,
      prompt: `${label}\n\n${prompt}`,
      sourceTaskId: decision.sourceTaskId,
      sourceAgent: decision.sourceAgent,
      createdAt: new Date().toISOString(),
      status: "pending",
      routingDepth: routingDepth + 1,
      guardrailChecks: [
        `decision.kind=return_to_caller ✓`,
        `target.known=true ✓`,
        `routing.depth=${routingDepth} < ${HECATEQ_MAX_ROUTING_DEPTH} ✓`,
        `source.blocked=false ✓`,
        `dedup.ok=true ✓`,
      ],
    }

    // Increment routing depth
    stateMgr.incrementRoutingDepth()

    const writeResult = stateMgr.recordPendingDelegation(pendingDelegation)
    if (writeResult) {
      existingPending.push(pendingDelegation)
      created++
      emitTraceEvent("delegation.created", "delegation", {
        delegationId,
        targetAgent: target,
        sourceTaskId: decision.sourceTaskId,
        sourceAgent: decision.sourceAgent,
        routingDepth: routingDepth + 1,
        promptLength: prompt.length,
      })
    }
  }

  return {
    pending: existingPending,
    created,
    guardrailSkipped,
    guardrailDetails,
  }
}

/**
 * Get all currently pending delegation requests from the omo state.
 * Convenience wrapper for the orchestrator to read pending work.
 */
export function getPendingDelegations(projectDir: string): HecateqPendingDelegation[] {
  const stateMgr = new OmoStateManager(projectDir)
  return stateMgr.getPendingDelegations()
}

/**
 * Get a specific pending delegation by ID.
 * Returns undefined if not found or already consumed.
 */
export function getPendingDelegationById(
  projectDir: string,
  delegationId: string,
): HecateqPendingDelegation | undefined {
  const stateMgr = new OmoStateManager(projectDir)
  const pending = stateMgr.getPendingDelegations()
  return pending.find((d) => d.id === delegationId)
}

/**
 * Consume a pending delegation request (mark as consumed and record in history).
 * Called by the orchestrator when it actually delegates to the target agent.
 */
export function consumeDelegation(
  projectDir: string,
  delegationId: string,
  executionResult: "executed" | "skipped" | "blocked" = "executed",
  blockReason?: string,
): boolean {
  const stateMgr = new OmoStateManager(projectDir)
  const consumed = stateMgr.consumePendingDelegation(delegationId, executionResult, blockReason)
  const success = consumed !== null
  emitTraceEvent("delegation.consumed", "delegation", {
    delegationId,
    executionResult,
    success,
    ...(blockReason ? { blockReason } : {}),
  })
  return success
}
