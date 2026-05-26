import { z } from "zod"

export const HecateqContextInjectionModeSchema = z.enum([
  "compact",
  "expanded",
  "off",
])

export const HecateqContextInjectionConfigSchema = z.object({
  enabled: z.boolean().default(true),
  mode: HecateqContextInjectionModeSchema.default("compact"),
  manifest_first: z.boolean().default(true),
  max_memory_file_chars: z.number().int().min(1).max(50000).default(500),
  max_total_chars: z.number().int().min(1).max(50000).default(2500),
  max_artifact_files: z.number().int().min(0).max(1000).default(5),
  include_contracts: z.boolean().default(true),
  include_task_graphs: z.boolean().default(true),
  include_agent_index: z.boolean().default(true),
  max_agent_domains: z.number().int().min(1).max(100).default(8),
  max_agents_per_domain: z.number().int().min(1).max(100).default(5),
  inject_on_subagents: z.boolean().default(false),
  hecateq_only: z.boolean().default(true),
})

export const DEFAULT_HECATEQ_CONTEXT_INJECTION_CONFIG = {
  enabled: true,
  mode: "compact",
  manifest_first: true,
  max_memory_file_chars: 500,
  max_total_chars: 2500,
  max_artifact_files: 5,
  include_contracts: true,
  include_task_graphs: true,
  include_agent_index: true,
  max_agent_domains: 8,
  max_agents_per_domain: 5,
  inject_on_subagents: false,
  hecateq_only: true,
} as const

export const HecateqMemoryBootstrapConfigSchema = z.object({
  enabled: z.boolean().default(true),
  create_memory_files: z.boolean().default(true),
  create_artifact_dirs: z.boolean().default(true),
})

export const HecateqAgentIndexConfigSchema = z.object({
  enabled: z.boolean().default(true),
  enrich_runtime_agents: z.boolean().default(true),
  use_for_suggestions: z.boolean().default(true),
  require_fresh: z.boolean().default(false),
  fallback_to_runtime_only: z.boolean().default(true),
  max_suggestions: z.number().int().min(1).max(50).default(10),
})

export const DEFAULT_HECATEQ_AGENT_INDEX_CONFIG = {
  enabled: true,
  enrich_runtime_agents: true,
  use_for_suggestions: true,
  require_fresh: false,
  fallback_to_runtime_only: true,
  max_suggestions: 10,
} as const

export const DEFAULT_HECATEQ_MEMORY_BOOTSTRAP_CONFIG = {
  enabled: true,
  create_memory_files: true,
  create_artifact_dirs: true,
} as const

export const HecateqDoctorConfigSchema = z.object({
  check_memory: z.boolean().default(true),
  check_artifacts: z.boolean().default(true),
  check_custom_agents: z.boolean().default(true),
  check_secrets: z.boolean().default(true),
  check_safety_hooks: z.boolean().default(true),
})

export const HecateqGitCheckpointModeSchema = z.enum([
  "suggest",
  "auto_clean_only",
  "off",
])

export const DEFAULT_HECATEQ_GIT_CHECKPOINT_MESSAGE = "chore: checkpoint before hecateq task"

export const HecateqGitCheckpointConfigSchema = z.object({
  enabled: z.boolean().default(true),
  mode: HecateqGitCheckpointModeSchema.default("suggest"),
  auto_checkpoint_clean_repo: z.boolean().default(false),
  checkpoint_message: z.string().trim().min(1).default(DEFAULT_HECATEQ_GIT_CHECKPOINT_MESSAGE),
  include_status_in_context: z.boolean().default(true),
  include_dirty_file_list: z.boolean().default(false),
  include_dirty_file_count: z.boolean().default(true),
  max_dirty_files: z.number().int().min(0).max(500).default(10),
  block_destructive_git: z.boolean().default(true),
})

export const DEFAULT_HECATEQ_GIT_CHECKPOINT_CONFIG = {
  enabled: true,
  mode: "suggest",
  auto_checkpoint_clean_repo: false,
  checkpoint_message: DEFAULT_HECATEQ_GIT_CHECKPOINT_MESSAGE,
  include_status_in_context: true,
  include_dirty_file_list: false,
  include_dirty_file_count: true,
  max_dirty_files: 10,
  block_destructive_git: true,
} as const

export const HecateqDependencyGraphModeSchema = z.enum(["off", "warn", "enforce"])

/**
 * Resolve the effective mode from a dependency graph config.
 * Handles backward compat: if mode is "off" but legacy booleans were set,
 * the upgrade path treats enabled → warn, enforce → enforce.
 * The schema itself handles fresh configs; this helper is for runtime
 * resolution when the config file hasn't been migrated yet.
 */
export function resolveDependencyGraphMode(
  config: { mode?: "off" | "warn" | "enforce"; enabled?: boolean; enforce?: boolean },
): "off" | "warn" | "enforce" {
  // New mode field takes priority
  if (config.mode && config.mode !== "off") return config.mode
  // Backward compat: legacy booleans
  if (config.enforce === true) return "enforce"
  if (config.enabled === true) return "warn"
  return "off"
}

/**
 * Check whether the dependency graph config is in enforcement mode.
 */
export function isDependencyGraphEnforced(config: {
  mode?: "off" | "warn" | "enforce"
  enabled?: boolean
  enforce?: boolean
}): boolean {
  return resolveDependencyGraphMode(config) === "enforce"
}

/**
 * Check whether the dependency graph is active (warn or enforce).
 */
export function isDependencyGraphActive(config: {
  mode?: "off" | "warn" | "enforce"
  enabled?: boolean
  enforce?: boolean
}): boolean {
  return resolveDependencyGraphMode(config) !== "off"
}

export const HecateqDependencyGraphConfigSchema = z.object({
  /**
   * Operating mode:
   * - "off":      Dependency graph tracking disabled entirely
   * - "warn":     Graph is built and validated; violations produce warnings but
   *               do not block execution
   * - "enforce":  Full graph enforcement — violations block execution,
   *               cycles are prevented, sensitive paths are gated
   */
  mode: HecateqDependencyGraphModeSchema.default("off"),
  /**
   * Auto-create dependency graph entries from task decomposition.
   * When true, the dependency planner inserts implied dependencies between
   * tasks based on domain, action type, and declared signals.
   */
  auto_create: z.boolean().default(true),
  /**
   * Whether cycles in the dependency graph block execution (true)
   * or merely produce a warning (false). Only meaningful when mode !== "off".
   */
  block_on_cycle: z.boolean().default(true),
  /**
   * Whether tasks that reference sensitive paths (.env, secrets, keys)
   * are blocked automatically. Only meaningful when mode !== "off".
   */
  block_on_sensitive: z.boolean().default(true),
  /**
   * List of TaskDomain values that require an explicit contract/plan
   * stage before implementation tasks in that domain can proceed.
   * Example: ["database", "security", "devops"]
   */
  require_contract_for: z.array(z.string()).default([]),
  /**
   * Legacy backward compat fields (ignored when mode is explicitly set).
   * @deprecated Use `mode` instead.
   */
  enabled: z.boolean().optional(),
  /**
   * Legacy backward compat — maps to mode "enforce" when true.
   * @deprecated Use `mode` instead.
   */
  enforce: z.boolean().optional(),
})

export const DEFAULT_HECATEQ_DEPENDENCY_GRAPH_CONFIG: z.infer<typeof HecateqDependencyGraphConfigSchema> = {
  mode: "off",
  auto_create: true,
  block_on_cycle: true,
  block_on_sensitive: true,
  require_contract_for: [],
}

export const DEFAULT_HECATEQ_DOCTOR_CONFIG = {
  check_memory: true,
  check_artifacts: true,
  check_custom_agents: true,
  check_secrets: true,
  check_safety_hooks: true,
} as const

export const HecateqOrchestrationQualityGatesSchema = z.object({
  typecheck: z.boolean().default(true),
  lint: z.boolean().default(true),
  test: z.boolean().default(true),
  build: z.boolean().default(true),
  doctor: z.boolean().default(false),
})

export type HecateqOrchestrationQualityGates = z.infer<typeof HecateqOrchestrationQualityGatesSchema>

export const HecateqOrchestrationConfigSchema = z.object({
  enabled: z.boolean().default(false),
  auto_decompose: z.boolean().default(true),
  auto_execute_low_risk: z.boolean().default(true),
  require_plan_for_high_risk: z.boolean().default(true),
  max_repair_attempts: z.number().int().min(0).max(10).default(2),
  default_task_timeout_ms: z.number().int().min(1000).max(3600000).default(300000),
  allow_parallel_readonly_tasks: z.boolean().default(true),
  allow_parallel_write_tasks: z.boolean().default(false),
  quality_gates: HecateqOrchestrationQualityGatesSchema.default({
    typecheck: true,
    lint: true,
    test: true,
    build: true,
    doctor: false,
  }),
  state_dir: z.string().optional(),
})

export type HecateqOrchestrationConfig = z.infer<typeof HecateqOrchestrationConfigSchema>

export const DEFAULT_HECATEQ_ORCHESTRATION_CONFIG: HecateqOrchestrationConfig = {
  enabled: false,
  auto_decompose: true,
  auto_execute_low_risk: true,
  require_plan_for_high_risk: true,
  max_repair_attempts: 2,
  default_task_timeout_ms: 300000,
  allow_parallel_readonly_tasks: true,
  allow_parallel_write_tasks: false,
  quality_gates: {
    typecheck: true,
    lint: true,
    test: true,
    build: true,
    doctor: false,
  },
  state_dir: undefined,
}

export const HecateqAutoSpawnConfigSchema = z.object({
  enabled: z.boolean().default(false),
  max_concurrent_spawns: z.number().int().min(1).max(20).default(5),
  spawn_timeout_ms: z.number().int().min(10000).default(300000),
  auto_retry_on_failure: z.boolean().default(true),
  max_failures_before_pause: z.number().int().min(1).default(3),
  pause_duration_ms: z.number().int().min(10000).default(60000),
  allow_background_spawn: z.boolean().default(true),
  max_spawn_depth: z.number().int().min(1).max(50).default(3),
  rate_limit_enabled: z.boolean().default(true),
  max_spawns_per_window: z.number().int().min(1).max(100).default(20),
  spawn_window_ms: z.number().int().min(1000).max(300000).default(60000),
})

export type HecateqAutoSpawnConfig = z.infer<typeof HecateqAutoSpawnConfigSchema>

export const DEFAULT_HECATEQ_AUTO_SPAWN_CONFIG: HecateqAutoSpawnConfig = {
  enabled: false,
  max_concurrent_spawns: 5,
  spawn_timeout_ms: 300000,
  auto_retry_on_failure: true,
  max_failures_before_pause: 3,
  pause_duration_ms: 60000,
  allow_background_spawn: true,
  max_spawn_depth: 3,
  rate_limit_enabled: true,
  max_spawns_per_window: 20,
  spawn_window_ms: 60000,
}

export const HecateqDelegationChainConfigSchema = z.object({
  max_depth: z.number().int().min(0).default(3),
  max_fan_out: z.number().int().min(1).max(50).default(10),
  max_iterations_per_run: z.number().int().min(1).max(100).default(10),
})

export type HecateqDelegationChainConfig = z.infer<typeof HecateqDelegationChainConfigSchema>

export const DEFAULT_HECATEQ_DELEGATION_CHAIN_CONFIG: HecateqDelegationChainConfig = {
  max_depth: 3,
  max_fan_out: 10,
  max_iterations_per_run: 10,
}

export const DEFAULT_HECATEQ_CONFIG = {
  enabled: true,
  context_injection: DEFAULT_HECATEQ_CONTEXT_INJECTION_CONFIG,
  agent_index: DEFAULT_HECATEQ_AGENT_INDEX_CONFIG,
  memory_bootstrap: DEFAULT_HECATEQ_MEMORY_BOOTSTRAP_CONFIG,
  doctor: DEFAULT_HECATEQ_DOCTOR_CONFIG,
  git_checkpoint: DEFAULT_HECATEQ_GIT_CHECKPOINT_CONFIG,
  dependency_graph: DEFAULT_HECATEQ_DEPENDENCY_GRAPH_CONFIG,
  orchestration: DEFAULT_HECATEQ_ORCHESTRATION_CONFIG,
  auto_spawn: DEFAULT_HECATEQ_AUTO_SPAWN_CONFIG,
  delegation_chain: DEFAULT_HECATEQ_DELEGATION_CHAIN_CONFIG,
} as const

export const HecateqConfigSchema = z.object({
  enabled: z.boolean().default(true),
  context_injection: HecateqContextInjectionConfigSchema.default(DEFAULT_HECATEQ_CONTEXT_INJECTION_CONFIG),
  agent_index: HecateqAgentIndexConfigSchema.default(DEFAULT_HECATEQ_AGENT_INDEX_CONFIG),
  memory_bootstrap: HecateqMemoryBootstrapConfigSchema.default(DEFAULT_HECATEQ_MEMORY_BOOTSTRAP_CONFIG),
  doctor: HecateqDoctorConfigSchema.default(DEFAULT_HECATEQ_DOCTOR_CONFIG),
  git_checkpoint: HecateqGitCheckpointConfigSchema.default(DEFAULT_HECATEQ_GIT_CHECKPOINT_CONFIG),
  dependency_graph: HecateqDependencyGraphConfigSchema.default(DEFAULT_HECATEQ_DEPENDENCY_GRAPH_CONFIG),
  orchestration: HecateqOrchestrationConfigSchema.default(DEFAULT_HECATEQ_ORCHESTRATION_CONFIG),
  auto_spawn: HecateqAutoSpawnConfigSchema.default(DEFAULT_HECATEQ_AUTO_SPAWN_CONFIG),
  delegation_chain: HecateqDelegationChainConfigSchema.default(DEFAULT_HECATEQ_DELEGATION_CHAIN_CONFIG),
})

export type HecateqContextInjectionConfig = z.infer<typeof HecateqContextInjectionConfigSchema>
export type HecateqContextInjectionMode = z.infer<typeof HecateqContextInjectionModeSchema>
export type HecateqMemoryBootstrapConfig = z.infer<typeof HecateqMemoryBootstrapConfigSchema>
export type HecateqAgentIndexConfig = z.infer<typeof HecateqAgentIndexConfigSchema>
export type HecateqDoctorConfig = z.infer<typeof HecateqDoctorConfigSchema>
export type HecateqGitCheckpointMode = z.infer<typeof HecateqGitCheckpointModeSchema>
export type HecateqGitCheckpointConfig = z.infer<typeof HecateqGitCheckpointConfigSchema>
export type HecateqDependencyGraphConfig = z.infer<typeof HecateqDependencyGraphConfigSchema>
export type HecateqConfig = z.infer<typeof HecateqConfigSchema>
