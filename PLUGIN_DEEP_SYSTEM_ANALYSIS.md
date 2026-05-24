# PLUGIN_DEEP_SYSTEM_ANALYSIS

## Executive Summary

This repository is an OpenCode plugin adapter that turns the host runtime into a multi-agent harness with configurable agents, hook-driven behavior injection, tool augmentation, MCP integration, background-task orchestration, and a CLI/doctor control plane. The fork is not a clean steady-state branch: the workspace is currently dirty, multiple Hecateq-specific files are modified or newly added, and `ROADMAP.md` states that the repository is mid-refactor toward a multi-harness architecture rather than a stable OpenCode-only shape.

The most important architectural fact is that the plugin is assembled from a thin entrypoint plus a factory-driven runtime pipeline. `src/index.ts` exports `{ id, server }`, but almost all behavior is delegated into `src/testing/create-plugin-module.ts`, `src/plugin-interface.ts`, `src/plugin/tool-registry.ts`, `src/create-hooks.ts`, `src/create-managers.ts`, and `src/plugin-config.ts`. Runtime behavior is therefore mostly determined by hook composition and tool registration, not by a single monolithic server file.

## What This Plugin Does

At runtime the plugin extends OpenCode with:

- built-in agents, including orchestrators and read-only specialists
- lifecycle hooks across session, transform, tool-guard, continuation, and skill tiers
- native tools such as `task`, `call_omo_agent`, `background_output`, `background_cancel`, `skill`, and `skill_mcp`
- built-in MCP-backed LSP/AST tools and injected external MCPs
- CLI workflows for install, run, doctor, OAuth, and state inspection
- optional team-mode with 12 `team_*` tools
- Hecateq-specific memory bootstrap, context injection, agent indexing, and doctor workflow checks

Primary evidence lives in `src/testing/create-plugin-module.ts`, `src/plugin-interface.ts`, `src/plugin/tool-registry.ts`, `src/plugin/hooks/*.ts`, `src/agents/`, `src/tools/`, `src/cli/doctor/`, and `src/config/schema/hecateq.ts`.

## Current Fork Identity

- Package identity remains `oh-my-opencode` in `package.json`, with dual binary names `oh-my-opencode` and `oh-my-openagent`.
- Plugin entry identity is `oh-my-openagent` in `src/testing/create-plugin-module.ts`.
- `README.md` and `ROADMAP.md` frame the codebase as a multi-harness transition project.
- The checked-out branch is `main`, but root docs and AGENTS files still describe upstream-oriented structure and naming.
- The working tree is dirty. Modified files include `src/agents/hecateq-orchestrator/agent.ts`, `src/hooks/hecateq-project-context-injector/index.ts`, `src/plugin/tool-registry.ts`, `src/plugin-config.ts`, `src/config/schema/oh-my-opencode-config.ts`, `src/cli/doctor/checks/hecateq-workflow.ts`, and related tests. New untracked Hecateq-oriented markdown and source files also exist.

## High-Level Architecture

Runtime assembly is factory-based:

1. `src/index.ts` exports `pluginModule`
2. `src/testing/create-plugin-module.ts` builds the server plugin
3. `src/plugin-config.ts` loads and merges user/project config
4. `src/create-managers.ts` creates `BackgroundManager`, `TmuxSessionManager`, `SkillMcpManager`, and config/model-fallback helpers
5. `src/create-tools.ts` and `src/plugin/tool-registry.ts` register tool definitions
6. `src/create-hooks.ts` composes hook tiers
7. `src/plugin-interface.ts` maps assembled handlers onto OpenCode hook names

This means the repo is structured more like a runtime composition graph than a typical app. The main adapter boundary is `plugin-interface.ts`; the main behavioral boundaries are `hooks/`, `tools/`, `agents/`, and `features/`.

## Major Systems Map

### Plugin core

- Entry: `src/index.ts`
- Main factory: `src/testing/create-plugin-module.ts`
- OpenCode interface mapping: `src/plugin-interface.ts`
- Handler implementations: `src/plugin/*.ts`

### Hook system

- Top-level composition: `src/create-hooks.ts`
- Session hooks: `src/plugin/hooks/create-session-hooks.ts`
- Tool guards: `src/plugin/hooks/create-tool-guard-hooks.ts`
- Transforms: `src/plugin/hooks/create-transform-hooks.ts`
- Continuations: `src/plugin/hooks/create-continuation-hooks.ts`
- Skill hooks: `src/plugin/hooks/create-skill-hooks.ts`

### Agents

- Type system: `src/agents/types.ts`
- Built-in registry: `src/agents/builtin-agents.ts`
- Display names: `src/shared/agent-display-names.ts`
- Hecateq agent: `src/agents/hecateq-orchestrator/agent.ts`, `src/agents/hecateq-orchestrator/default.ts`, `src/agents/builtin-agents/hecateq-orchestrator-agent.ts`

### Tools

- Registry: `src/plugin/tool-registry.ts`
- Delegation: `src/tools/delegate-task/*`
- Limited specialist caller: `src/tools/call-omo-agent/*`
- Background task tools: `src/tools/background-task/*`
- Session tools, grep/glob, skill, skill_mcp via `src/tools/*`

### Config

- Loader/merge/migration: `src/plugin-config.ts`
- Root schema: `src/config/schema/oh-my-opencode-config.ts`
- Hecateq schema: `src/config/schema/hecateq.ts`
- Generated asset: `assets/oh-my-opencode.schema.json`

### Doctor and CLI

- CLI entry: `src/cli/index.ts`, `src/cli/cli-program.ts`
- Doctor runner: `src/cli/doctor/runner.ts`
- Check registry: `src/cli/doctor/checks/index.ts`
- Hecateq workflow check: `src/cli/doctor/checks/hecateq-workflow.ts`

### Background orchestration

- Manager: `src/features/background-agent/manager.ts`
- Concurrency: `src/features/background-agent/concurrency.ts`
- Polling: `src/features/background-agent/task-poller.ts`
- Registry/history: `src/features/background-agent/task-registry.ts`, `task-history.ts`
- Parent wake: `src/features/background-agent/parent-wake-notifier.ts`

### OpenClaw external integration

- main entry: `src/openclaw/index.ts`
- dispatch and gateway resolution: `src/openclaw/dispatcher.ts`, `src/openclaw/config.ts`, `src/openclaw/runtime-dispatch.ts`
- inbound reply daemon: `src/openclaw/reply-listener.ts`, `reply-listener-discord.ts`, `reply-listener-telegram.ts`, `reply-listener-injection.ts`
- session correlation: `src/openclaw/session-registry.ts`

### Migration system

- agent-name migration: `src/shared/migration/agent-names.ts`
- additional migration helpers are documented under `src/shared/AGENTS.md` and are part of the legacy-compatibility path used during config/session normalization

### Boulder state and CLI progress tracking

- CLI subcommand registration: `src/cli/cli-program.ts` command `boulder`
- feature module: `src/features/boulder-state/*`
- purpose: persistent work-state/progress inspection and per-task statistics for Boulder-driven continuation flows

## Hecateq Fork Additions

Hecateq additions are partially runtime-level and partially prompt/policy-level.

### Runtime-level additions

- `hecateq-memory-bootstrap` hook in `src/hooks/hecateq-memory-bootstrap/index.ts`
- `hecateq-project-context-injector` hook in `src/hooks/hecateq-project-context-injector/index.ts`
- Hecateq config schema in `src/config/schema/hecateq.ts`
- Hecateq doctor workflow check in `src/cli/doctor/checks/hecateq-workflow.ts`
- Hecateq agent indexer in `src/shared/hecateq-agent-indexer.ts`
- Git checkpoint helper in `src/shared/git-checkpoint.ts`
- Built-in command template `src/features/builtin-commands/templates/hecateq-agent-index.ts`

### Prompt/policy-level additions

- Hecateq orchestrator system policy in `src/agents/hecateq-orchestrator/default.ts`
- Sisyphus-to-Hecateq handoff language in `src/agents/sisyphus.ts`

### Config/doctor-level additions

- `pluginConfig.hecateq.*` fields
- Hecateq doctor toggles (`check_memory`, `check_artifacts`, `check_custom_agents`, `check_secrets`, `check_safety_hooks`)

### Generated/index/context-summary additions

- Hecateq agent index JSON generation/consumption via `src/shared/hecateq-agent-indexer.ts`
- Agent index summary injection inside `src/hooks/hecateq-project-context-injector/index.ts`

The key limitation is that agent index data is not the ultimate runtime source of truth for routing. Exact runtime routing still flows through live agent registration, custom agent loaders, subagent discovery, and delegate-task resolution.

## Runtime Flow Overview

The initialization sequence described in `src/AGENTS.md` is accurate to the live code:

1. agent sort shim install
2. config context initialization
3. external skill plugin detection
4. auth injection into shared SDK client
5. plugin config load/merge/validation/migration
6. optional OpenClaw and team-mode dependency setup
7. manager/tool/hook/interface creation

After that, runtime is mostly hook-driven:

- `chat.message` performs session setup, keyword routing, first-message behavior, and Hecateq context injection hook dispatch
- `event` handles lifecycle, background completion wakeups, runtime fallback, notification plumbing, and Hecateq memory bootstrap
- `tool.execute.before` and `tool.execute.after` enforce guards and post-process outputs
- `experimental.chat.messages.transform` injects context and validates protocol patterns
- `experimental.session.compacting` and `experimental.compaction.autocontinue` preserve state across compaction

Background task runtime is a separate execution lane layered under the plugin runtime:

1. `task` or background task creation flows into `BackgroundManager`
2. `BackgroundManager.launch()` creates a `pending` task and enqueues it under a concurrency key
3. `ConcurrencyManager.acquire()` enforces per-model/provider FIFO slots in `src/features/background-agent/concurrency.ts`
4. `startTask()` creates a child OpenCode session and fires the prompt
5. `task-poller.ts` uses 3-second polling plus idle/stability checks to decide completion
6. `handleEvent()` in `manager.ts` consumes session events, tool-call activity, todo updates, and errors
7. `background_output` and `background_cancel` expose read/cancel control back to the parent session

This is an important architectural split: the plugin does not just delegate prompts, it runs an internal async task supervisor with queueing, retry, interruption, and parent-wake behavior.

## Configuration Model

Config loading behavior comes from `src/plugin-config.ts`:

- user config plus walked project configs are merged
- `agents`, `categories`, and `claude_code` deep-merge
- all `disabled_*` arrays union together
- `mcp_env_allowlist` is user-only for safety
- other fields are replaced by nearer config
- omitted fields receive Zod defaults

Hecateq defaults are all opt-in by default through enabled booleans set to `true`, but their sub-behavior is constrained. For example, `context_injection.mode` defaults to `compact`, `hecateq_only` defaults to `true`, and `inject_on_subagents` defaults to `false`.

## Agent Model

The repo currently exposes 11 built-in agents plus Prometheus via dedicated config-building logic.

Notable runtime facts:

- `sisyphus`: main orchestrator, mode `primary`
- `hecateq-orchestrator`: mode `all`, display name `Hecateq God`
- `oracle`, `librarian`, `explore`, `metis`, `momus`, `multimodal-looker`: specialist/read-heavy subagents
- `sisyphus-junior`: lightweight execution target used by category routing

The default display order in `src/shared/agent-ordering.ts` is `sisyphus`, `hecateq-orchestrator`, `hephaestus`, `prometheus`, `atlas`, which is a direct sign that Hecateq has been elevated to first-class orchestrator status in this fork.

## Tool Model

`src/plugin/tool-registry.ts` is the live source of truth for plugin-native tool assembly.

Always-on plugin-native clusters include:

- background tools
- `call_omo_agent`
- `task`
- grep/glob/session manager tools
- skill / skill_mcp

Conditional clusters include:

- `look_at`
- `interactive_bash`
- `task_*` task-system tools
- hashline `edit`
- 12 `team_*` tools

The low-priority trimming list in `tool-registry.ts` also matters operationally because `experimental.max_tools` can remove tools under cap pressure.

## Hook Model

The live session hook composer currently includes 26 named entries in `create-session-hooks.ts`, including Hecateq additions. Hook enablement is determined by both `isHookEnabled(hookName)` and local config gates.

Hecateq-specific gates are explicit:

- `pluginConfig.hecateq?.enabled ?? true`
- `pluginConfig.hecateq?.memory_bootstrap?.enabled ?? true`
- `pluginConfig.hecateq?.context_injection?.enabled ?? true`

This is important because Hecateq behavior is not only controlled through `disabled_hooks`; it also has a parallel config enable/disable path.

## Doctor Model

Doctor now includes a seventh top-level check beyond the older System/Config/Tools/Models framing: `hecateq-workflow`. The current live registry is in `src/cli/doctor/checks/index.ts` and includes:

- system
- config
- tui-plugin
- tools
- models
- team-mode
- hecateq-workflow

The Hecateq check inspects memory files, artifact directories, custom agent definitions, safety hooks, agent index state, and secret leakage patterns. That makes it the fork-specific operational health gate rather than just a cosmetic add-on.

## Safety Model

The main safety mechanisms are a combination of hook guards, runtime gates, and prompt policy.

### Hard runtime-style protections

- write-before-read prevention via `write-existing-file-guard`
- prompt injection dedupe and reservation via `src/shared/prompt-async-gate.ts`
- session idle settling via `src/shared/session-idle-settle.ts`
- background task circuit breaker via `loop-detector.ts`
- subagent spawn depth limits via `subagent-spawn-limits.ts`
- git state detection and destructive-git blocking via `src/shared/git-checkpoint.ts` when configured

### Soft/prompt/policy protections

- Sisyphus handoff policy
- Hecateq orchestrator routing policy
- Prometheus markdown-only behavior enforced by hook plus prompt conventions

### Disabled-system protections

- `disabled_hooks`, `disabled_agents`, `disabled_categories`, `disabled_commands`, `disabled_tools`

Important nuance: some protections are only as strong as whether the relevant hook remains enabled. The doctor workflow explicitly checks safety hooks for this reason.

Additional safety/runtime guards that matter for this fork:

- `src/shared/prompt-async-gate.ts` reserves and deduplicates prompt injection paths to avoid duplicated internal prompts across live sessions
- `src/features/background-agent/loop-detector.ts` records tool-call signatures and trips on repetitive use according to circuit-breaker thresholds
- `src/features/background-agent/task-poller.ts` prunes stale tasks, detects missing sessions, and interrupts timed-out work
- `src/shared/migration/agent-names.ts` normalizes legacy agent names such as `Prometheus (Plan Builder)` and `Hecateq God` into canonical config keys

## Build / Usage Model

`package.json` shows a Bun-first build and distribution model:

- `build` compiles plugin ESM, CLI bundle, declarations, and schema
- `build:all` adds platform binaries
- `prepublishOnly` rebuilds before publish
- `typecheck` uses `tsgo`
- `test` uses `bun test`

Packaging-specific details from `package.json` and root layout:

- main export: `./dist/index.js`
- types export: `dist/index.d.ts`
- schema export: `./schema.json` → `./dist/oh-my-opencode.schema.json`
- binaries: `bin/oh-my-opencode.js` and `bin/oh-my-openagent`
- bundled publish files: `dist`, `bin`, `postinstall.mjs`, MCP package dists
- platform binary optional dependencies are published per target for darwin/linux/windows variants
- `postinstall.mjs` verifies platform binary and OpenCode version compatibility

Build pipeline details:

- root plugin build uses `bun build` for ESM output
- CLI build compiles `src/cli/index.ts` to `dist/cli`
- `tsc --emitDeclarationOnly` generates declarations
- `build:schema` regenerates JSON schema from Zod definitions
- `build:all` adds binary build orchestration through `script/build-binaries.ts`

Published package contents are `dist`, `bin`, `postinstall.mjs`, and bundled MCP packages. Runtime usage is therefore adapter-oriented: install plugin, register with OpenCode, and let the host invoke the plugin hooks.

OpenClaw usage model is also runtime-significant:

- `initializeOpenClaw()` in `src/openclaw/index.ts` starts or stops reply-listener daemons based on config
- outbound notifications can target HTTP webhooks or shell commands
- inbound Discord/Telegram replies are correlated through session registry and injected back into tmux panes

## Current Strengths

- unusually rich hook/tool/agent surface with clear modular boundaries
- strong evidence of defensive runtime engineering around background tasks and prompt async hazards
- Hecateq additions are integrated across runtime, config, doctor, and prompt layers rather than bolted onto one spot
- built-in AGENTS documentation is dense and generally aligns with live file structure
- extensive co-located tests in background-agent, hooks, config, and doctor areas

## Current Risks

- repository is mid-refactor and explicitly unstable per `ROADMAP.md` and top-level `AGENTS.md`
- working tree is dirty, including core routing/config files, so this analysis describes the checked-out state rather than a clean released state
- some root/docs AGENTS inventories lag live code counts or omit newer Hecateq-specific details
- Hecateq routing still relies on a mix of prompt policy, discovery helpers, and exact runtime checks; it is not yet a single deterministic resolver layer across all call sites
- doctor docs in `src/cli/doctor/AGENTS.md` still emphasize the older 4-category framing, while live code has 7 registered top-level checks
- background-task behavior is sophisticated but spread across `manager.ts`, pollers, loop detection, retry handlers, and cleanup helpers, which raises maintenance complexity
- migration/legacy-name support is necessary but adds another layer of hidden compatibility behavior that future maintainers must understand

## Recommended Next Steps

1. Consolidate Hecateq runtime truth into a single documented routing contract that clearly distinguishes prompt policy, config gates, discovery/index hints, and final executor behavior.
2. Align AGENTS/docs inventories with live code, especially doctor category counts, built-in command list, and Hecateq-specific surfaces.
3. Decide whether Hecateq agent index is advisory-only or part of deterministic runtime selection, then document that boundary in both code comments and user docs.
4. Isolate multi-harness-neutral logic further into shared/core packages, in line with `ROADMAP.md`.
5. Add explicit regression tests around `disabled_categories`, Hecateq exact-agent resolution, and agent-index stale/missing behavior if they are not already comprehensive.

## File Map

### Core assembly

- `src/index.ts`
- `src/testing/create-plugin-module.ts`
- `src/plugin-interface.ts`
- `src/create-managers.ts`
- `src/create-tools.ts`
- `src/create-hooks.ts`

### Runtime handlers

- `src/plugin/chat-message.ts`
- `src/plugin/event.ts`
- `src/plugin/messages-transform.ts`
- `src/plugin/tool-execute-before.ts`
- `src/plugin/tool-execute-after.ts`
- `src/plugin/session-compacting.ts`
- `src/plugin/tool-registry.ts`

### Agents and delegation

- `src/agents/types.ts`
- `src/agents/builtin-agents.ts`
- `src/agents/sisyphus.ts`
- `src/agents/hecateq-orchestrator/agent.ts`
- `src/agents/hecateq-orchestrator/default.ts`
- `src/agents/builtin-agents/hecateq-orchestrator-agent.ts`

Note on display-name mappings: `src/shared/agent-display-names.ts` also contains display-name entries such as `athena`, `athena-junior`, and `council-member`. These appear in name normalization/display compatibility logic but are not surfaced as first-class built-in factory agents in the main runtime registry analyzed here.
- `src/tools/delegate-task/*`
- `src/tools/call-omo-agent/*`

### Config and doctor

- `src/plugin-config.ts`
- `src/config/schema/oh-my-opencode-config.ts`
- `src/config/schema/hecateq.ts`
- `src/cli/doctor/runner.ts`
- `src/cli/doctor/checks/index.ts`
- `src/cli/doctor/checks/hecateq-workflow.ts`

### Hecateq systems

- `src/hooks/hecateq-memory-bootstrap/index.ts`
- `src/hooks/hecateq-project-context-injector/index.ts`
- `src/shared/memory-bootstrap.ts`
- `src/shared/hecateq-agent-indexer.ts`
- `src/shared/git-checkpoint.ts`

### Background systems

- `src/features/background-agent/manager.ts`
- `src/features/background-agent/concurrency.ts`
- `src/features/background-agent/task-poller.ts`
- `src/features/background-agent/task-registry.ts`
- `src/features/background-agent/task-history.ts`
- `src/features/background-agent/parent-wake-notifier.ts`

### Verification note

No tests run because this was documentation-only analysis.
