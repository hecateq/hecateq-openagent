# Hecateq OpenAgent — Configuration Reference

This document describes the Hecateq-specific configuration section in detail.

---

## Hecateq Config Root

The `hecateq` config block is embedded in the root `OhMyOpenCodeConfigSchema` with defaults from `DEFAULT_HECATEQ_CONFIG`.

### `hecateq.enabled`

- Type: `boolean`
- Default: `true`
- Master switch for all Hecateq-specific features. When `false`, Hecateq hooks and orchestration are skipped.

---

## Context Injection

```typescript
HecateqContextInjectionConfigSchema
```

Controls injection of memory state, git checkpoint state, handoff context, and agent index into agent sessions.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Enable context injection |
| `mode` | `"compact" \| "expanded" \| "off"` | `"compact"` | Injection verbosity |
| `manifest_first` | `boolean` | `true` | Inject manifest before content |
| `max_memory_file_chars` | `number` | `500` | Max chars per memory file (1-50000) |
| `max_total_chars` | `number` | `2500` | Total chars across all injected content (1-50000) |
| `max_artifact_files` | `number` | `5` | Max artifact files to scan (0-1000) |
| `include_contracts` | `boolean` | `true` | Include contract directory content |
| `include_task_graphs` | `boolean` | `true` | Include task graph files |
| `include_agent_index` | `boolean` | `true` | Include agent index summary |
| `max_agent_domains` | `number` | `8` | Max agent domains in index (1-100) |
| `max_agents_per_domain` | `number` | `5` | Max agents per domain (1-100) |
| `inject_on_subagents` | `boolean` | `false` | Inject context for subagent sessions |
| `hecateq_only` | `boolean` | `true` | Only inject when Hecateq agent active |

---

## Agent Index

```typescript
HecateqAgentIndexConfigSchema
```

Controls runtime agent discovery and suggestion from AGENTS.md files.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Enable agent indexer |
| `enrich_runtime_agents` | `boolean` | `true` | Enrich agent list from AGENTS.md |
| `use_for_suggestions` | `boolean` | `true` | Use index for agent suggestions |
| `require_fresh` | `boolean` | `false` | Require freshly built index |
| `fallback_to_runtime_only` | `boolean` | `true` | Fallback to runtime agents if index stale |
| `max_suggestions` | `number` | `10` | Max agent suggestions (1-50) |

---

## Memory Bootstrap

```typescript
HecateqMemoryBootstrapConfigSchema
```

Controls automatic creation of memory directories and template files.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Enable memory bootstrap |
| `create_memory_files` | `boolean` | `true` | Create memory template files |
| `create_artifact_dirs` | `boolean` | `true` | Create artifact directories |

---

## Doctor

```typescript
HecateqDoctorConfigSchema
```

Controls which checks the `hecateq doctor` command runs.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `check_memory` | `boolean` | `true` | Check memory file presence |
| `check_artifacts` | `boolean` | `true` | Check artifact directories |
| `check_custom_agents` | `boolean` | `true` | Check custom agent configs |
| `check_secrets` | `boolean` | `true` | Check for exposed secrets |
| `check_safety_hooks` | `boolean` | `true` | Check required safety hooks |

---

## Git Checkpoint

```typescript
HecateqGitCheckpointConfigSchema
```

Controls pre-task git state management.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `boolean` | `true` | Enable git checkpoint |
| `mode` | `"suggest" \| "auto_clean_only" \| "off"` | `"suggest"` | Checkpoint mode |
| `auto_checkpoint_clean_repo` | `boolean` | `false` | Auto-checkpoint clean repos |
| `checkpoint_message` | `string` | `"chore: checkpoint before hecateq task"` | Commit message |
| `include_status_in_context` | `boolean` | `true` | Include git status in context |
| `include_dirty_file_list` | `boolean` | `false` | Include dirty file names |
| `include_dirty_file_count` | `boolean` | `true` | Include dirty file count |
| `max_dirty_files` | `number` | `10` | Max files to report (0-500) |
| `block_destructive_git` | `boolean` | `true` | Block destructive git operations |

---

## Dependency Graph

```typescript
HecateqDependencyGraphConfigSchema
```

Controls task dependency tracking with cycle detection and enforcement.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `mode` | `"off" \| "warn" \| "enforce"` | `"off"` | Operating mode |
| `auto_create` | `boolean` | `true` | Auto-create edges from task decomposition |
| `block_on_cycle` | `boolean` | `true` | Block execution on cycle detection |
| `block_on_sensitive` | `boolean` | `true` | Block tasks referencing sensitive paths |
| `require_contract_for` | `string[]` | `[]` | Domains requiring explicit contract stage |
| `enabled` | `boolean` | (optional) | Legacy backward compat |
| `enforce` | `boolean` | (optional) | Legacy backward compat (maps to mode "enforce") |

---

## Orchestration

```typescript
HecateqOrchestrationConfigSchema
```

Controls the end-to-end task orchestration pipeline.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `boolean` | `false` | Master enable for orchestration |
| `auto_decompose` | `boolean` | `true` | Auto-decompose prompts into tasks |
| `auto_execute_low_risk` | `boolean` | `true` | Auto-execute low-risk tasks |
| `require_plan_for_high_risk` | `boolean` | `true` | Block high-risk without explicit plan |
| `max_repair_attempts` | `number` | `2` | Max repair loop iterations (0-10) |
| `default_task_timeout_ms` | `number` | `300000` | Default per-task timeout (5 min) |
| `allow_parallel_readonly_tasks` | `boolean` | `true` | Allow parallel read-only tasks |
| `allow_parallel_write_tasks` | `boolean` | `false` | Allow parallel write tasks |
| `quality_gates.typecheck` | `boolean` | `true` | Run typecheck quality gate |
| `quality_gates.lint` | `boolean` | `true` | Run lint quality gate |
| `quality_gates.test` | `boolean` | `true` | Run test quality gate |
| `quality_gates.build` | `boolean` | `true` | Run build quality gate |
| `quality_gates.doctor` | `boolean` | `false` | Run doctor quality gate |
| `state_dir` | `string` | (optional) | Override orchestration state directory |

---

## Auto-Spawn

```typescript
HecateqAutoSpawnConfigSchema
```

Controls autonomous subagent spawning with rate limiting and failure backoff.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `boolean` | `false` | Enable auto-spawn |
| `max_concurrent_spawns` | `number` | `5` | Max concurrent spawns (1-20) |
| `spawn_timeout_ms` | `number` | `300000` | Per-spawn timeout (5 min) |
| `auto_retry_on_failure` | `boolean` | `true` | Auto-retry failed spawns |
| `max_failures_before_pause` | `number` | `3` | Pause after N failures |
| `pause_duration_ms` | `number` | `60000` | Pause duration (1 min) |
| `allow_background_spawn` | `boolean` | `true` | Allow background spawn |
| `max_spawn_depth` | `number` | `3` | Max nested spawn depth (1-50) |
| `rate_limit_enabled` | `boolean` | `true` | Enable rate limiting |
| `max_spawns_per_window` | `number` | `20` | Max spawns per window |
| `spawn_window_ms` | `number` | `60000` | Rate limit window (1 min) |

---

## Delegation Chain

```typescript
HecateqDelegationChainConfigSchema
```

Controls delegation cascade limits (circuit breaker).

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `max_depth` | `number` | `3` | Max delegation depth (0=disabled, max no limit specified) |
| `max_fan_out` | `number` | `10` | Max parallel delegations (1-50) |
| `max_iterations_per_run` | `number` | `10` | Max delegation iterations per run (1-100) |
