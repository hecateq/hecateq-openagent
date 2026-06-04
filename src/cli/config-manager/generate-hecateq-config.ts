import type { HecateqSetupProfile } from "../types"
import {
  DEFAULT_HECATEQ_CONTEXT_INJECTION_CONFIG,
  DEFAULT_HECATEQ_AGENT_INDEX_CONFIG,
  DEFAULT_HECATEQ_MEMORY_BOOTSTRAP_CONFIG,
  DEFAULT_HECATEQ_DOCTOR_CONFIG,
  DEFAULT_HECATEQ_GIT_CHECKPOINT_CONFIG,
  DEFAULT_HECATEQ_CONFIG,
} from "../../config/schema/hecateq"

/**
 * Recommended profile: stable, safe, low token cost.
 * - Context injection enabled with compact mode, Hecateq-only
 * - Memory bootstrap with artifact dirs
 * - Agent index with runtime fallback, no fresh requirement
 * - Git checkpoint in suggest mode, no auto commits
 * - Doctor checks enabled
 * - Dirty file count shown, dirty file list hidden
 */
const RECOMMENDED_PROFILE: Record<string, unknown> = {
  ...DEFAULT_HECATEQ_CONFIG,
  enabled: true,
  memory_bootstrap: {
    ...DEFAULT_HECATEQ_MEMORY_BOOTSTRAP_CONFIG,
    enabled: true,
    create_memory_files: true,
    create_artifact_dirs: true,
  },
  context_injection: {
    ...DEFAULT_HECATEQ_CONTEXT_INJECTION_CONFIG,
    enabled: true,
    mode: "compact",
    hecateq_only: true,
    inject_on_subagents: false,
  },
  agent_index: {
    ...DEFAULT_HECATEQ_AGENT_INDEX_CONFIG,
    enabled: true,
    fallback_to_runtime_only: true,
    require_fresh: false,
  },
  git_checkpoint: {
    ...DEFAULT_HECATEQ_GIT_CHECKPOINT_CONFIG,
    mode: "suggest",
    auto_checkpoint_clean_repo: false,
    include_dirty_file_list: false,
    include_dirty_file_count: true,
  },
  doctor: {
    ...DEFAULT_HECATEQ_DOCTOR_CONFIG,
    check_memory: true,
    check_artifacts: true,
    check_custom_agents: true,
    check_secrets: true,
    check_safety_hooks: true,
  },
}

/**
 * Minimal profile: basic Hecateq project structure and health checks.
 * - Context injection disabled
 * - Memory bootstrap enabled for structure only
 * - Agent index enabled for suggestion/index only
 * - Git checkpoint suggest or off
 * - Doctor checks enabled
 */
const MINIMAL_PROFILE: Record<string, unknown> = {
  enabled: true,
  memory_bootstrap: {
    ...DEFAULT_HECATEQ_MEMORY_BOOTSTRAP_CONFIG,
    enabled: true,
    create_memory_files: true,
    create_artifact_dirs: false,
  },
  context_injection: {
    ...DEFAULT_HECATEQ_CONTEXT_INJECTION_CONFIG,
    enabled: false,
    mode: "off",
    hecateq_only: true,
    inject_on_subagents: false,
  },
  agent_index: {
    ...DEFAULT_HECATEQ_AGENT_INDEX_CONFIG,
    enabled: true,
    enrich_runtime_agents: true,
    use_for_suggestions: true,
    fallback_to_runtime_only: true,
    require_fresh: false,
  },
  git_checkpoint: {
    ...DEFAULT_HECATEQ_GIT_CHECKPOINT_CONFIG,
    mode: "suggest",
    auto_checkpoint_clean_repo: false,
    include_dirty_file_list: false,
    include_dirty_file_count: false,
  },
  doctor: {
    ...DEFAULT_HECATEQ_DOCTOR_CONFIG,
    check_memory: true,
    check_artifacts: true,
    check_custom_agents: true,
    check_secrets: true,
    check_safety_hooks: true,
  },
}

/**
 * Advanced profile: null/empty — no Hecateq config block written.
 * When an existing config file is present, user Hecateq settings are preserved
 * (via deep merge). When no config exists, no Hecateq block is generated and
 * runtime schema defaults apply. No manual TUI prompts are shown for Hecateq
 * settings — use this profile when you already have Hecateq config or want
 * to rely entirely on runtime defaults.
 */
const ADVANCED_PROFILE: Record<string, unknown> | null = null

const PROFILES: Record<HecateqSetupProfile, Record<string, unknown> | null> = {
  recommended: RECOMMENDED_PROFILE,
  minimal: MINIMAL_PROFILE,
  advanced: ADVANCED_PROFILE,
}

/**
 * Generate the hecateq config block for the given setup profile.
 * Returns null for advanced (no Hecateq block — preserve existing or use runtime defaults).
 */
export function generateHecateqProfileConfig(
  profile: HecateqSetupProfile,
): Record<string, unknown> | null {
  return PROFILES[profile] ?? null
}

/**
 * Get a human-readable description of the given profile.
 */
export function describeHecateqProfile(profile: HecateqSetupProfile): string {
  switch (profile) {
    case "recommended":
      return "Stable, safe, low token cost. Enables context injection (compact), memory bootstrap, agent index, git checkpoint suggest mode, and doctor health checks."
    case "minimal":
      return "Basic Hecateq project structure and health checks. Context injection disabled, memory bootstrap for file structure only, agent index for suggestions only, doctor checks active."
    case "advanced":
      return "No Hecateq config block written — preserves existing settings when present, otherwise relies on runtime schema defaults. Use to skip automated Hecateq configuration."
  }
}

/**
 * Get setup summary lines for the given profile.
 */
export function formatHecateqProfileSummary(profile: HecateqSetupProfile): string[] {
  switch (profile) {
    case "recommended":
      return [
        "Hecateq: enabled",
        "Context injection: compact (Hecateq-only)",
        "Memory bootstrap: enabled with artifact dirs",
        "Agent index: enabled (runtime fallback, no fresh)",
        "Git checkpoint: suggest mode",
        "Doctor checks: enabled",
      ]
    case "minimal":
      return [
        "Hecateq: enabled",
        "Context injection: off",
        "Memory bootstrap: enabled (files only)",
        "Agent index: enabled (suggestions only)",
        "Git checkpoint: suggest mode",
        "Doctor checks: enabled",
      ]
    case "advanced":
      return [
        "Hecateq: no config block written",
        "Existing Hecateq config preserved when present; runtime defaults apply otherwise.",
      ]
  }
}
