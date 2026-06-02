/**
 * Hecateq orchestrator policy helpers.
 * Small, testable utilities for self-implementation decisions.
 * These are used by the tool-config-handler and agent factory to
 * enforce delegation-first behavior at the config level.
 */

export type HecateqPromptProfile = "auto" | "generic" | "gpt" | "claude" | "gemini" | "qwen" | "deepseek" | "small-model"

export type HecateqModelAdaptersConfig = {
  enabled?: boolean
  fallback?: Exclude<HecateqPromptProfile, "auto">
  strict_runtime_truth?: boolean
  delegation_bias?: "conservative" | "balanced" | "expanded"
}

export type HecateqOrchestratorConfig = {
  delegation_first?: boolean
  deny_write_tools?: boolean
  prompt_profile?: HecateqPromptProfile
  model_adapters?: HecateqModelAdaptersConfig
}

/**
 * Whether the orchestrator should apply delegation-first tool restrictions.
 * When delegation_first is true (default), write/edit tools are denied
 * and the prompt includes strengthened delegation-first policy.
 */
export function isDelegationFirst(config?: HecateqOrchestratorConfig): boolean {
  return config?.delegation_first !== false
}

/**
 * Whether write and edit tools should be denied for the orchestrator.
 * Defaults to true when delegation-first is active.
 */
export function shouldDenyWriteTools(config?: HecateqOrchestratorConfig): boolean {
  if (!isDelegationFirst(config)) return false
  return config?.deny_write_tools !== false
}

/**
 * Classification of a task for self-implementation decisions.
 * Used to determine whether Hecateq may implement directly or must delegate.
 */
export type HecateqTaskClassification = {
  /** Number of files that would be changed */
  fileCount: number
  /** Whether architecture or cross-module contracts would change */
  affectsArchitecture: boolean
  /** Whether domain logic would be altered */
  affectsDomainLogic: boolean
  /** Whether a specialist agent exists for this domain */
  specialistExists: boolean
  /** Whether the change is high-risk or destructive */
  isHighRisk: boolean
}

/**
 * Determine whether Hecateq may self-implement based on task classification.
 * This implements the TINY SAFE BRIDGING FIX GATE in code.
 * All of the following must be true for self-implementation:
 * 1. Change is localized to 1 file (or tiny closely-related surface)
 * 2. No architecture, contract, or domain logic impact
 * 3. No specialist ownership is materially needed
 * 4. Not high-risk or destructive
 */
export function maySelfImplement(
  config: HecateqOrchestratorConfig | undefined,
  task: HecateqTaskClassification,
): boolean {
  if (!isDelegationFirst(config)) return true
  if (task.fileCount > 1) return false
  if (task.affectsArchitecture) return false
  if (task.affectsDomainLogic) return false
  if (task.isHighRisk) return false
  return !task.specialistExists
}
