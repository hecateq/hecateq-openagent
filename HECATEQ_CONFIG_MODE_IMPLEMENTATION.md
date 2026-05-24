HECATEQ_CONFIG_MODE_IMPLEMENTATION

## Scope

This change adds a top-level `hecateq` config section and wires the existing Hecateq project context injector to it.
It does not add a scheduler, task executor, git checkpoint helper, contract validator, installer change, runtime fallback change, or TUI change.

## What Changed

- Added a new top-level `hecateq` config schema.
- Added default Hecateq config values matching the previous hardcoded behavior.
- Deep-merge support was added for nested `hecateq` config.
- `hecateq-project-context-injector` now reads runtime options from config.
- `createSessionHooks()` now respects `hecateq.enabled` and `hecateq.context_injection.enabled` when deciding whether to register workflow helper hooks.
- Doctor now reports Hecateq config state and invalid Hecateq config values.

## Config Schema

New top-level config section:

```json
{
  "hecateq": {
    "enabled": true,
    "context_injection": {
      "enabled": true,
      "max_memory_file_chars": 2000,
      "max_total_chars": 10000,
      "max_artifact_files": 20,
      "include_contracts": true,
      "include_task_graphs": true,
      "inject_on_subagents": false,
      "hecateq_only": true
    },
    "memory_bootstrap": {
      "enabled": true,
      "create_memory_files": true,
      "create_artifact_dirs": true
    },
    "doctor": {
      "check_memory": true,
      "check_artifacts": true,
      "check_custom_agents": true,
      "check_secrets": true,
      "check_safety_hooks": true
    }
  }
}
```

## Default Values

Default values preserve the previous behavior.

Effective defaults:

- `hecateq.enabled = true`
- `hecateq.context_injection.enabled = true`
- `hecateq.context_injection.max_memory_file_chars = 2000`
- `hecateq.context_injection.max_total_chars = 10000`
- `hecateq.context_injection.max_artifact_files = 20`
- `hecateq.context_injection.include_contracts = true`
- `hecateq.context_injection.include_task_graphs = true`
- `hecateq.context_injection.inject_on_subagents = false`
- `hecateq.context_injection.hecateq_only = true`
- `hecateq.memory_bootstrap.enabled = true`
- `hecateq.doctor.* = true`

## Context Injection Config

These fields are now consumed by `hecateq-project-context-injector`:

- `enabled`
- `max_memory_file_chars`
- `max_total_chars`
- `max_artifact_files`
- `include_contracts`
- `include_task_graphs`
- `inject_on_subagents`
- `hecateq_only`

Behavior:

- `max_memory_file_chars` changes per-file truncation
- `max_total_chars` changes total injected context size
- `max_artifact_files` changes artifact listing length
- `include_contracts = false` suppresses contracts listing
- `include_task_graphs = false` suppresses task-graphs listing
- `hecateq_only = true` preserves Hecateq-only behavior
- `hecateq_only = false` allows broader project/session injection at runtime
- `inject_on_subagents = false` blocks subagent session injection
- `inject_on_subagents = true` allows subagent injection

## Hook Registration Behavior

`createSessionHooks()` now applies these gates:

- `hecateq.enabled = false` disables Hecateq workflow helper hook registration
- `hecateq.context_injection.enabled = false` disables only the project context injector hook registration
- `disabled_hooks` still disables hooks independently and still works

Important distinction:

- `hecateq.enabled = false` disables workflow helpers
- `disabled_agents = ["hecateq-orchestrator"]` disables the agent itself

The built-in agent registration was not changed in this phase.

## Doctor Config Checks

Doctor now checks Hecateq config shape and state.

It reports:

- invalid `hecateq` config values
- `hecateq.enabled = false`
- `hecateq.context_injection.enabled = false`
- details when contracts listing is disabled
- details when task graph listing is disabled

Negative or out-of-range values are rejected by schema and surfaced through the doctor’s Hecateq config issue check.

`hecateq.doctor.*` fields are currently present in schema for future use and are not yet used to selectively disable doctor subchecks.

## Backward Compatibility

Existing default behavior is preserved.

- Existing prompt policy is unchanged
- Existing memory bootstrap behavior is unchanged
- Existing artifact bootstrap behavior is unchanged
- Existing doctor checks remain active
- Existing disabled_hooks behavior is unchanged

## Files Changed

- `src/config/schema/hecateq.ts`
- `src/config/schema.ts`
- `src/config/schema/oh-my-opencode-config.ts`
- `src/config/index.ts`
- `src/plugin-config.ts`
- `src/plugin-config.test.ts`
- `src/config/schema.test.ts`
- `src/hooks/hecateq-project-context-injector/index.ts`
- `src/hooks/hecateq-project-context-injector/index.test.ts`
- `src/plugin/hooks/create-session-hooks.ts`
- `src/plugin/hooks/create-session-hooks.test.ts`
- `src/cli/doctor/checks/hecateq-workflow.ts`
- `src/cli/doctor/checks/hecateq-workflow.test.ts`
- `HECATEQ_CONFIG_MODE_IMPLEMENTATION.md`

## Tests Added / Updated

Updated coverage includes:

- schema acceptance for top-level `hecateq`
- default config values
- nested partial merge behavior
- rejection of invalid negative limits
- context injector config-driven truncation
- context injector config-driven artifact listing count
- contract listing toggle
- task-graph listing toggle
- `hecateq_only` behavior
- `inject_on_subagents` behavior
- `hecateq.enabled` registration gate
- `hecateq.context_injection.enabled` registration gate
- doctor warnings/details for Hecateq config state

## Tests Run

Executed successfully:

1. `bun test src/config/schema.test.ts src/plugin-config.test.ts`
2. `bun test src/hooks/hecateq-project-context-injector/index.test.ts src/plugin/hooks/create-session-hooks.test.ts`
3. `bun test src/cli/doctor/checks/hecateq-workflow.test.ts src/hooks/hecateq-memory-bootstrap/index.test.ts`
4. `bun test src/agents/builtin-agents/hecateq-orchestrator-agent.test.ts src/agents/utils.test.ts`
5. `bun test src/tools/delegate-task/category-resolver.test.ts src/tools/delegate-task/zauc-mocks-subagent-resolver/subagent-resolver.test.ts`
6. `bun test src/hooks/hecateq-project-context-injector src/cli/doctor/checks/hecateq-workflow.test.ts src/config/schema.test.ts src/plugin-config.test.ts`

## Behavior Before

- Hecateq context injector used hardcoded runtime limits and toggles.
- No top-level `hecateq` config existed.
- Hecateq workflow helper registration was not configurable by a dedicated Hecateq config block.

## Behavior After

- Hecateq context injection behavior is configurable via `oh-my-openagent.json`.
- Default behavior remains the same when config is omitted.
- Hecateq workflow helper hooks can be disabled without disabling the Hecateq agent itself.
- Doctor can now surface Hecateq config health and helper-disable states.

## Risks

- `hecateq.doctor.*` and `hecateq.memory_bootstrap.create_*` are in schema but only partially consumed in this phase.
- Broader injection with `hecateq_only = false` depends on runtime agent/session shape and should be used carefully.
- Introducing defaults at top-level config adds a visible `hecateq` object to parsed empty config results.

## Rollback

Low-risk rollback steps:

1. Remove `src/config/schema/hecateq.ts`.
2. Remove Hecateq schema exports/imports.
3. Remove `hecateq` from top-level config schema.
4. Remove deep-merge support for `hecateq`.
5. Revert context injector config consumption to hardcoded defaults.
6. Remove doctor checks for Hecateq config state.
7. Revert related tests and this report file.

## Explicit Answers

- Top-level hecateq config eklendi mi? **Evet**
- Default değerler nedir? **Önceki hardcoded behavior ile aynı defaults**
- Eski hardcoded davranış default olarak korunuyor mu? **Evet**
- `context_injection.enabled=false` ne yapıyor? **Context injector hook register edilmez/çalışmaz**
- `hecateq.enabled=false` ne yapıyor? **Hecateq workflow helper hooks kapanır; agent registration kapanmaz**
- `max_memory_file_chars` çalışıyor mu? **Evet**
- `max_total_chars` çalışıyor mu? **Evet**
- `max_artifact_files` çalışıyor mu? **Evet**
- `include_contracts=false` çalışıyor mu? **Evet**
- `include_task_graphs=false` çalışıyor mu? **Evet**
- `hecateq_only` çalışıyor mu? **Evet**
- `inject_on_subagents` çalışıyor mu? **Evet**
- `disabled_hooks` davranışı bozuldu mu? **Hayır**
- Doctor yeni config’i kontrol ediyor mu? **Evet**
- Existing memory/artifact bootstrap bozuldu mu? **Hayır**
- Existing Hecateq prompt policy bozuldu mu? **Hayır**
- Hangi testler çalıştı? **Yukarıdaki altı komut**
