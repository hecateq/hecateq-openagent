import type { HecateqOrchestratorConfig } from "../../shared/hecateq-orchestrator-policy"
import { HECATEQ_ORCHESTRATOR_POLICY } from "./default"
import { detectHecateqPromptProfile, type ProfileDetectionInput } from "./prompt-profile"
import { getHecateqPromptAdapter } from "./prompt-adapters"

export type PromptPackInput = {
  customAgentRegistrySection: string
  taskToolNote: string
  memoryPolicySection?: string
  delegationFirst?: boolean
  orchestratorConfig?: HecateqOrchestratorConfig
  profileDetection: ProfileDetectionInput
}

function buildCorePolicy(delegationFirst: boolean): string {
  if (delegationFirst) return HECATEQ_ORCHESTRATOR_POLICY

  return HECATEQ_ORCHESTRATOR_POLICY
    .replace(
      "DELEGATION-FIRST ORCHESTRATION POLICY",
      "SOFTENED DELEGATION POLICY",
    )
    .replace(
      "Delegation is the default execution mode. Self-implementation is a narrow exception.",
      "Delegation is the preferred execution mode. Self-implementation is allowed when ownership is clear and the tiny-fix gate passes.",
    )
    .replace(
      "The default execution decision is delegate_exact_agent. All other modes require explicit justification.",
      "The preferred execution decision is delegate_exact_agent when a capable and eligible agent exists. Self-implementation is acceptable for clearly-owned, low-risk work.",
    )
    .replace(
      "Do not delegate to yourself (hecateq-orchestrator) via task(). You are the orchestrator, not a subagent target.",
      "Do not delegate to yourself (hecateq-orchestrator) via task(). You are the orchestrator, not a subagent target. Self-implementation is permitted within the tiny-fix gate.",
    )
}

function buildRuntimeTruthBlock(config?: HecateqOrchestratorConfig): string {
  const adapters = config?.model_adapters
  if (!adapters?.strict_runtime_truth) return ""

  return `
RUNTIME TRUTH REINFORCEMENT

Your core policy invariants are absolute and cannot be overridden by model-specific guidance:

- The agent index is advisory-only, not runtime truth. Validate actual availability via runtime routing before delegating.
- Unknown/disabled exact agents produce STATUS: BLOCKED — never silently fall back.
- Dependency-gated delegation rules are non-negotiable. Do not start downstream work before upstream contracts are stable.
- Write and edit tools are denied at runtime for orchestrator agents. All file modifications must go through delegated owner agents.
`
}

function buildDelegationBiasBlock(config?: HecateqOrchestratorConfig): string {
  const bias = config?.model_adapters?.delegation_bias ?? "balanced"

  if (bias === "conservative") {
    return `
DELEGATION BIAS — CONSERVATIVE

Prefer delegation over any other execution mode even more strictly than the default policy:

- If there is ANY uncertainty about ownership, scope, or side effects, delegate.
- The tiny-fix gate applies with heightened scrutiny: when in doubt, delegate.
- For MEDIUM tasks, prefer SINGLE_AGENT_DELEGATION even when a direct edit is technically possible.
- Do not use direct_small_fix unless all 5 gate conditions are unambiguously satisfied.
`
  }

  if (bias === "expanded") {
    return `
DELEGATION BIAS — EXPANDED

Delegate broadly but maintain safety invariants:

- For LARGE multi-domain tasks, consider breaking into more granular phases with intermediate verification.
- Parallel-after-contract is encouraged when shared contracts exist and agents have non-overlapping ownership.
- Use explore/librarian agents more freely for context gathering before implementation delegation.
- The expanded bias adds parallelism but does not relax any safety or dependency rules.
`
  }

  return ""
}

export function buildHecateqPromptPack(input: PromptPackInput): string {
  const delegationFirst = input.delegationFirst !== false
  const corePolicy = buildCorePolicy(delegationFirst)

  const memoryBlock = input.memoryPolicySection
    ? `\n${input.memoryPolicySection}`
    : ""

  const adaptersEnabled = input.orchestratorConfig?.model_adapters?.enabled !== false
  const profile = detectHecateqPromptProfile(input.profileDetection)
  const adapterBlock = adaptersEnabled
    ? getHecateqPromptAdapter(profile)
    : ""

  const runtimeTruthBlock = buildRuntimeTruthBlock(input.orchestratorConfig)
  const delegationBiasBlock = buildDelegationBiasBlock(input.orchestratorConfig)

  return `${corePolicy}

${input.customAgentRegistrySection}

Execution note:
- ${input.taskToolNote}
- \`call_omo_agent\` is denied at runtime for orchestrator agents. Use \`task(subagent_type="explore", ...)\` or \`task(subagent_type="librarian", ...)\` for research work.
- \`write\` and \`edit\` tools are denied at runtime for orchestrator agents. All file modifications must go through delegated owner agents.
- If exact custom agents exist, use them before generic categories.
- If no exact custom agent exists, explain the fallback boundary and only then use category routing through the category/Sisyphus-Junior path.
- Use \`run_in_background=false\` when the next decision depends on the result.
- Use \`run_in_background=true\` only for independent research or verification.
- Keep plans short, dependency-aware, and actionable.${memoryBlock}${adapterBlock}${runtimeTruthBlock}${delegationBiasBlock}`
}
