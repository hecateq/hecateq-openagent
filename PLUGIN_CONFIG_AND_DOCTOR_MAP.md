# PLUGIN_CONFIG_AND_DOCTOR_MAP

## Scope

This report maps config loading, merge order, schema surfaces, Hecateq config, doctor architecture, and generated schema assets for the checked-out fork.

## Config Sources

Primary loader: `src/plugin-config.ts`

Observed config source classes:

- user config under OpenCode config directory
- walked project configs up the tree toward `$HOME`
- legacy renamed basenames during compatibility window

## Config Merge Order

`src/plugin-config.ts` merges user config plus walked project configs.

Rules confirmed by live code and AGENTS docs:

- `agents`, `categories`, `claude_code` deep-merge
- `disabled_*` arrays union together
- `mcp_env_allowlist` remains user-only
- other fields are override-replace

This is important operationally because a project config can add more disabled hooks/agents/categories, but it does not subtract earlier disables.

## Config Schema

Root schema file:

- `src/config/schema/oh-my-opencode-config.ts`

Generated aggregate exports:

- `src/config/index.ts`
- `src/config/schema.ts`

Generated schema asset target:

- `assets/oh-my-opencode.schema.json`

Schema generation is wired through `package.json` script `build:schema`.

## Hecateq Config

### Root section

Defined in `src/config/schema/hecateq.ts` and attached in `src/config/schema/oh-my-opencode-config.ts`.

### Field table

| Field | Default | Affects | Runtime behavior | Risk |
|---|---|---|---|---|
| `hecateq.enabled` | `true` | all Hecateq subsystems | master gate | medium |
| `hecateq.context_injection.enabled` | `true` | project context injector | allows Hecateq prompt injection | high token impact |
| `hecateq.context_injection.mode` | `compact` | injector rendering | compact/expanded/off | medium |
| `hecateq.context_injection.max_memory_file_chars` | `500` | injector | truncation control | low |
| `hecateq.context_injection.max_total_chars` | `2500` | injector | total budget cap | low |
| `hecateq.context_injection.max_artifact_files` | `5` | injector | artifact list cap | low |
| `hecateq.context_injection.include_contracts` | `true` | injector | includes contract summaries | low |
| `hecateq.context_injection.include_task_graphs` | `true` | injector | includes task graph summaries | low |
| `hecateq.context_injection.include_agent_index` | `true` | injector | includes index summary | medium |
| `hecateq.context_injection.max_agent_domains` | `8` | injector | domain summary breadth | low |
| `hecateq.context_injection.max_agents_per_domain` | `5` | injector | per-domain breadth | low |
| `hecateq.context_injection.inject_on_subagents` | `false` | injector | skips subagent prompts by default | medium |
| `hecateq.context_injection.hecateq_only` | `true` | injector | limits default injection scope | medium |
| `hecateq.memory_bootstrap.enabled` | `true` | memory bootstrap hook | allows bootstrap | low |
| `hecateq.memory_bootstrap.create_memory_files` | `true` | bootstrap helper | create memory files | low |
| `hecateq.memory_bootstrap.create_artifact_dirs` | `true` | bootstrap helper | create contracts/task-graphs dirs | low |
| `hecateq.agent_index.enabled` | `true` | index helpers | enables index usage | medium |
| `hecateq.agent_index.enrich_runtime_agents` | `true` | index/runtime enrichment | enriches summaries/suggestions | medium |
| `hecateq.agent_index.use_for_suggestions` | `true` | index suggestions | suggestion support | low |
| `hecateq.agent_index.require_fresh` | `false` | stale handling | stale tolerated by default | medium |
| `hecateq.agent_index.fallback_to_runtime_only` | `true` | index failure path | falls back when index absent/stale | medium |
| `hecateq.agent_index.max_suggestions` | `10` | suggestion output | cap on guidance breadth | low |
| `hecateq.doctor.check_memory` | `true` | doctor | validates memory files | low |
| `hecateq.doctor.check_artifacts` | `true` | doctor | validates artifact dirs | low |
| `hecateq.doctor.check_custom_agents` | `true` | doctor | validates custom agents | medium |
| `hecateq.doctor.check_secrets` | `true` | doctor | scans for secrets | high value |
| `hecateq.doctor.check_safety_hooks` | `true` | doctor | validates safety-hook posture | high value |
| `hecateq.git_checkpoint.enabled` | `true` | checkpoint helper | enables helper | medium |
| `hecateq.git_checkpoint.mode` | `suggest` | checkpoint helper | suggest/auto_clean_only/off | medium |
| `hecateq.git_checkpoint.auto_checkpoint_clean_repo` | `false` | checkpoint helper | no default auto-commit | low |
| `hecateq.git_checkpoint.checkpoint_message` | `chore: checkpoint before hecateq task` | checkpoint helper | default message | low |
| `hecateq.git_checkpoint.include_status_in_context` | `true` | injector/helper | include git status summary | medium |
| `hecateq.git_checkpoint.include_dirty_file_list` | `false` | injector/helper | suppress noisy file list by default | low |
| `hecateq.git_checkpoint.include_dirty_file_count` | `true` | injector/helper | include count summary | low |
| `hecateq.git_checkpoint.max_dirty_files` | `10` | helper | output cap | low |
| `hecateq.git_checkpoint.block_destructive_git` | `true` | helper/policy | intended protective posture | medium |

## Disabled Hooks / Agents / Categories

Relevant runtime fields:

- `disabled_hooks`
- `disabled_agents`
- `disabled_categories`

Observed behavior:

- arrays union across config scopes
- disabled values are fed into tool registry, agent config, and delegate-task creation
- category config also supports per-category disable fields
- Hecateq hook enablement additionally depends on `hecateq.enabled` and per-subfeature booleans

## Commands Config

Builtin command loading is handled by `src/features/builtin-commands/commands.ts`.

Confirmed built-ins from live file:

- `init-deep`
- `ralph-loop`
- `ulw-loop`
- `cancel-ralph`
- `refactor`
- `start-work`
- `stop-continuation`
- `remove-ai-slops`
- `handoff`
- `hyperplan`
- `hecateq-agent-index`

Commands are filtered by `disabled_commands` inside `loadBuiltinCommands()`.

## Doctor Architecture

Primary files:

- `src/cli/doctor/index.ts`
- `src/cli/doctor/runner.ts`
- `src/cli/doctor/types.ts`
- `src/cli/doctor/checks/index.ts`

The current live doctor registry includes seven top-level checks, with `system` marked `critical: true`.

## Hecateq Workflow Check

Primary file:

- `src/cli/doctor/checks/hecateq-workflow.ts`

Confirmed areas checked by delegated analysis:

- config shape
- custom agent issues
- artifact issues
- project-root memory issues
- safety hook issues
- agent index issues
- secret findings

This is the main doctor surface that understands Hecateq as a workflow rather than a generic plugin feature.

## Agent Index Check

Agent-index checking is part of the Hecateq workflow check, not a separate top-level doctor category. This is an important doc detail because it means index health is currently nested within Hecateq operational validation.

## Memory / Artifact Check

Memory/artifact validation is also part of the Hecateq workflow check. It aligns with the bootstrapped filesystem contract created by `src/shared/memory-bootstrap.ts` and `src/hooks/hecateq-memory-bootstrap/index.ts`.

## Safety Checks

Doctor validates Hecateq-specific safety posture through safety-hook issue collection. This is especially important because several protections are only as good as whether their hooks remain enabled.

## Generated Schema Assets

Generated asset:

- `assets/oh-my-opencode.schema.json`

Build wiring:

- `package.json` `build:schema`
- full build also regenerates schema through `build`

This asset is the public schema-facing expression of the Zod config system.

## Tests

Confirmed config/doctor-adjacent test evidence includes:

- `src/plugin-config.test.ts`
- `src/config/schema.test.ts`
- `src/cli/doctor/checks/hecateq-workflow.test.ts`
- modified doctor/config tests visible in the dirty workspace

No tests run because this was documentation-only analysis.

## Risks

- docs and generated AGENTS summaries lag some live doctor/check counts and Hecateq-specific surfaces
- config behavior is split between generic root schema, feature schemas, runtime helper logic, and doctor checks, which increases cognitive load
- union-style disabled arrays can accumulate project/user disables in ways that are easy to forget without doctor help
- Hecateq features default to enabled, so forks/users should understand them before assuming a vanilla upstream behavior profile
