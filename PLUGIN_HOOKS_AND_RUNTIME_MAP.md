# PLUGIN_HOOKS_AND_RUNTIME_MAP

## Scope

This report maps the live runtime hook system for the checked-out fork, with emphasis on registration points, trigger classes, config gating, Hecateq additions, and runtime side effects. Primary sources are `src/create-hooks.ts`, `src/plugin/hooks/create-*.ts`, `src/plugin/*.ts`, `src/testing/create-plugin-module.ts`, and Hecateq hook implementations.

## Hook Registry

Hook composition is assembled by `src/create-hooks.ts`, which merges:

- `createCoreHooks()`
- `createContinuationHooks()`
- `createSkillHooks()`

The OpenCode-facing handlers are then attached in `src/plugin-interface.ts` plus two compaction hooks wired directly in `src/testing/create-plugin-module.ts`.

## Session Hooks

`src/plugin/hooks/create-session-hooks.ts` defines the session hook record and factory.

Registered entries returned by the current file:

- `contextWindowMonitor`
- `preemptiveCompaction`
- `sessionRecovery`
- `sessionNotification`
- `thinkMode`
- `modelFallback`
- `anthropicContextWindowLimitRecovery`
- `autoUpdateChecker`
- `agentUsageReminder`
- `nonInteractiveEnv`
- `interactiveBashSession`
- `ralphLoop`
- `editErrorRecovery`
- `delegateTaskRetry`
- `startWork`
- `prometheusMdOnly`
- `sisyphusJuniorNotepad`
- `noSisyphusGpt`
- `noHephaestusNonGpt`
- `questionLabelTruncator`
- `taskResumeInfo`
- `anthropicEffort`
- `runtimeFallback`
- `legacyPluginToast`
- `hecateqMemoryBootstrap`
- `hecateqProjectContextInjector`

This means the live file now returns 26 named members, even though older generated AGENTS summaries may still quote smaller counts.

### Session hook inventory

| Hook | File family | Primary trigger/use | Notes |
|---|---|---|---|
| `context-window-monitor` | `src/hooks/context-window-monitor/*` | session/event monitoring | token/limit observation |
| `preemptive-compaction` | `src/hooks/preemptive-compaction/*` | session lifecycle | gated by experimental config |
| `session-recovery` | `src/hooks/session-recovery/*` | session failures | recovery lane |
| `session-notification` | `src/hooks/session-notification/*` | session events | external/user notification |
| `think-mode` | `src/hooks/think-mode/*` | prompt/runtime params | reasoning behavior |
| `model-fallback` | `src/hooks/model-fallback/*` | model selection lifecycle | proactive fallback |
| `anthropic-context-window-limit-recovery` | `src/hooks/anthropic-context-window-limit-recovery/*` | Anthropic-specific failures | context-limit recovery |
| `auto-update-checker` | `src/hooks/auto-update-checker/*` | startup/session events | update awareness |
| `agent-usage-reminder` | `src/hooks/agent-usage-reminder/*` | prompt/tool lifecycle | guidance/reminders |
| `non-interactive-env` | `src/hooks/non-interactive-env/*` | session/tool lifecycle | guard for non-interactive runs |
| `interactive-bash-session` | `src/hooks/interactive-bash-session/*` | tmux-enabled sessions | bash/tmux state |
| `ralph-loop` | `src/hooks/ralph-loop/*` | continuation lifecycle | loop orchestration |
| `edit-error-recovery` | `src/hooks/edit-error-recovery/*` | tool lifecycle | edit failure recovery |
| `delegate-task-retry` | `src/hooks/delegate-task-retry/*` | delegate-task lifecycle | task retry handling |
| `start-work` | `src/hooks/start-work/*` | command/session flow | plan-to-work bridge |
| `prometheus-md-only` | `src/hooks/prometheus-md-only/*` | tool/session flow | markdown-only write scope |
| `sisyphus-junior-notepad` | `src/hooks/sisyphus-junior-notepad/*` | session flow | notepad behavior |
| `no-sisyphus-gpt` | `src/hooks/no-sisyphus-gpt/*` | agent/model guard | provider restriction |
| `no-hephaestus-non-gpt` | `src/hooks/no-hephaestus-non-gpt/*` | agent/model guard | provider restriction |
| `question-label-truncator` | `src/hooks/question-label-truncator/*` | question tool path | label size guard |
| `task-resume-info` | `src/hooks/task-resume-info/*` | continuation/task lifecycle | resume hints |
| `anthropic-effort` | `src/hooks/anthropic-effort/*` | params/runtime | effort override |
| `runtime-fallback` | `src/hooks/runtime-fallback/*` | session error/status | reactive fallback |
| `legacy-plugin-toast` | `src/hooks/legacy-plugin-toast/*` | startup/session flow | compatibility warning |
| `hecateq-memory-bootstrap` | `src/hooks/hecateq-memory-bootstrap/*` | first non-subagent create | Hecateq scaffolding |
| `hecateq-project-context-injector` | `src/hooks/hecateq-project-context-injector/*` | chat.message path | Hecateq context injection |

## Chat Message Hooks

The `chat.message` OpenCode handler is implemented in `src/plugin/chat-message.ts`. It is not itself a hook factory, but it is the runtime surface that invokes session-level behavior on live prompts.

Important responsibilities:

- first-message/session bootstrap
- keyword detection
- think/runtime fallback handling
- Hecateq project context injection dispatch through `hooks.hecateqProjectContextInjector?.["chat.message"]`

User impact: this handler shapes the first prompt the agent actually receives, so anything injected here directly affects token budget and routing behavior.

## Transform Hooks

`src/plugin/hooks/create-transform-hooks.ts` composes transform-tier hooks used by `src/plugin/messages-transform.ts`.

Core transform responsibilities include:

- context injection
- keyword detection support
- tool-pair validation
- thinking-block validation
- optional team-mode status/mailbox transforms

Risk level is medium to high because these hooks alter prompt/message payloads directly. Token cost is also medium to high because injected context increases system/user message size.

### Transform inventory

- `claudeCodeHooks`
- `keywordDetector`
- `contextInjectorMessagesTransform`
- `thinkingBlockValidator`
- `toolPairValidator`
- conditional `teamModeStatusInjector`
- conditional `teamMailboxInjector`

These are created in `src/plugin/hooks/create-transform-hooks.ts` and executed by `src/plugin/messages-transform.ts`.

## Tool Guard Hooks

`src/plugin/hooks/create-tool-guard-hooks.ts` provides pre/post tool safety and formatting hooks. Key examples repeatedly referenced by runtime docs and live code:

- `write-existing-file-guard`
- `comment-checker`
- `rules-injector`
- `bash-file-read-guard`
- `webfetch-redirect-guard`
- `hashline-read-enhancer`
- `json-error-recovery`
- `fsync-skip-warning`
- team-mode conditional `team-tool-gating`

These are dispatched by `src/plugin/tool-execute-before.ts` and `src/plugin/tool-execute-after.ts`.

### Tool-guard inventory

| Hook | Main role |
|---|---|
| `commentChecker` | comment-quality enforcement |
| `toolOutputTruncator` | output size control |
| `directoryAgentsInjector` | AGENTS.md injection |
| `directoryReadmeInjector` | README injection |
| `emptyTaskResponseDetector` | catches empty task results |
| `rulesInjector` | rules-file injection |
| `tasksTodowriteDisabler` | task/todo interaction control |
| `writeExistingFileGuard` | force read-before-write |
| `bashFileReadGuard` | shell read discipline |
| `hashlineReadEnhancer` | hashline tagging/enrichment |
| `jsonErrorRecovery` | JSON tool-error recovery |
| `readImageResizer` | image read handling |
| `todoDescriptionOverride` | todo formatting override |
| `webfetchRedirectGuard` | redirect pre-resolution |
| `fsyncSkipWarning` | fsync warning path |
| `notepadWriteGuard` | blocks destructive writes to append-only `.sisyphus/notepads` and `.omo/notepads` paths |
| `planFormatValidator` | validates plan-format structure on relevant tool flows |
| conditional `teamToolGating` | team-mode tool access control |

Live count note: `src/plugin/hooks/create-tool-guard-hooks.ts` currently returns **18 named entries total**, including `teamToolGating`, `notepadWriteGuard`, and `planFormatValidator`. Older generated AGENTS docs that still say 16 or 17 are stale relative to the checked-out code.

## Hecateq Memory Bootstrap

### Hook

- Name: `hecateq-memory-bootstrap`
- File: `src/hooks/hecateq-memory-bootstrap/index.ts`
- Registration: `src/plugin/hooks/create-session-hooks.ts`
- Trigger surface: dispatched from `src/plugin/event.ts` on session lifecycle events, intended to act on first non-subagent `session.created`

### Behavior

- resolves project root
- bootstraps `.opencode/memory/knowledge/context/`
- bootstraps `.opencode/contracts/` and `.opencode/task-graphs/`
- fires at most once per hook instance
- skips subagent sessions
- does not overwrite existing files

### Config gates

- global `pluginConfig.hecateq?.enabled ?? true`
- `pluginConfig.hecateq?.memory_bootstrap?.enabled ?? true`
- `isHookEnabled("hecateq-memory-bootstrap")`

### Risk / token / user impact

- Risk: low to medium, because it creates project files/directories but avoids overwrite
- Token cost: none directly
- User impact: creates durable project scaffolding used by later Hecateq systems

### Test coverage

- `src/hooks/hecateq-memory-bootstrap/index.test.ts`

## Hecateq Project Context Injector

### Hook

- Name: `hecateq-project-context-injector`
- File: `src/hooks/hecateq-project-context-injector/index.ts`
- Registration: `src/plugin/hooks/create-session-hooks.ts`
- Trigger surface: routed through `chat.message`

### Behavior

- injects `<hecateq-project-context>` blocks
- supports `compact`, `expanded`, and `off` modes
- can include memory summaries, contracts, task graphs, agent index summaries, and git checkpoint state
- defaults to Hecateq-only injection via `hecateq_only: true`
- defaults to skipping subagents via `inject_on_subagents: false`

### Config gates

- global `pluginConfig.hecateq?.enabled ?? true`
- `pluginConfig.hecateq?.context_injection?.enabled ?? true`
- `isHookEnabled("hecateq-project-context-injector")`

### Risk / token / user impact

- Risk: medium, because it changes prompt payloads and can bias downstream routing
- Token cost: medium to high depending on `mode`, memory file sizes, and artifact counts
- User impact: strongest Hecateq-specific prompt-context behavior in the fork

### Test coverage

- `src/hooks/hecateq-project-context-injector/index.test.ts`

## Auto Slash Command Hook

- Registration tier: skill hooks via `src/plugin/hooks/create-skill-hooks.ts`
- Main implementation path: `src/hooks/auto-slash-command/*`, including executor logic tested in `src/hooks/auto-slash-command/executor.test.ts`
- Runtime entry: invoked through hook dispatch and tied to built-in/user command loading in phase 6 config handling
- Command registry source: `src/features/builtin-commands/commands.ts` plus plugin/user sources

This hook is the execution bridge for slash-command-like command templates, including `ulw-loop`, `ralph-loop`, `handoff`, `hyperplan`, and `hecateq-agent-index`.

## Other Hooks

Notable non-Hecateq hooks that materially shape runtime behavior:

- `runtime-fallback`
- `model-fallback`
- `anthropic-context-window-limit-recovery`
- `preemptive-compaction`
- `todo-continuation-enforcer`
- `unstable-agent-babysitter`
- `background-notification-hook`
- `atlasHook`
- `prometheus-md-only`

These are important because Hecateq additions sit on top of an already complex continuation/recovery layer rather than replacing it.

### Continuation and skill hooks not otherwise expanded

- `stop-continuation-guard`
- `compaction-context-injector`
- `compaction-todo-preserver`
- `todo-continuation-enforcer`
- `unstable-agent-babysitter`
- `background-notification-hook`
- `atlasHook`
- `categorySkillReminder`
- `autoSlashCommand`

## Runtime Trigger Matrix

| Runtime surface | File | Main hook families invoked | Notes |
|---|---|---|---|
| `chat.message` | `src/plugin/chat-message.ts` | session hooks, Hecateq context injection path | first prompt shaping |
| `event` | `src/plugin/event.ts` | session + continuation lifecycle hooks | session created/idle/error/status |
| `tool.execute.before` | `src/plugin/tool-execute-before.ts` | tool guard hooks | preflight validation and policy |
| `tool.execute.after` | `src/plugin/tool-execute-after.ts` | tool guard/post hooks | output shaping and recovery |
| `experimental.chat.messages.transform` | `src/plugin/messages-transform.ts` | transform hooks | prompt/message mutation |
| `experimental.chat.system.transform` | `src/plugin/system-transform.ts` | system transforms | system-level injection |
| `experimental.session.compacting` | `src/plugin/session-compacting.ts` | compaction helpers | preserve context/todos |
| `experimental.compaction.autocontinue` | `src/plugin/session-compacting.ts` | autocontinue hooks | resume after compaction |

## Config / Disabled Hook Behavior

Hook disable semantics are layered:

1. global config sections such as `hecateq.enabled`
2. sub-config enables such as `hecateq.memory_bootstrap.enabled`
3. `disabled_hooks` filtering via `isHookEnabled(hookName)`
4. feature-specific config conditions such as team-mode or preemptive-compaction flags

This means a hook can be effectively disabled even if it is not named in `disabled_hooks`.

## Token Cost / Risk Analysis

### Low token / low risk

- memory bootstrap
- non-interactive env
- question label truncation
- legacy toast / update checker style hooks

### Medium token / medium risk

- rules injection
- directory agents/readme injection
- team-mode status injection
- session recovery
- runtime fallback hooks

### High token / high risk

- Hecateq expanded context injection
- broad transform-layer prompt injection
- compaction/recovery continuations that can re-enter sessions

The largest token-pressure source in this fork is not a single hook but the combination of context injectors, rules injectors, continuation helpers, and Hecateq project summaries.

## Tests

Confirmed hook/runtime-adjacent test evidence includes:

- `src/plugin/hooks/create-session-hooks.test.ts`
- `src/hooks/hecateq-memory-bootstrap/index.test.ts`
- `src/hooks/hecateq-project-context-injector/index.test.ts`
- `src/hooks/auto-slash-command/executor.test.ts`
- plugin handler tests referenced in modified workspace files and source tree inventories

Hook coverage is therefore not limited to Hecateq hooks, but the two Hecateq hooks are the ones most directly surfaced in this report because they are the fork-specific additions. The broader registry is still live and should be read from the inventories above.

No tests run because this was documentation-only analysis.

## Gaps

- generated AGENTS inventory counts lag some live hook return shapes
- doctor/docs still summarize older category counts more often than the live expanded registry
- Hecateq context injection can strongly influence runtime behavior, but there is no single top-level doc in source that states its exact precedence relative to other context injectors
- the fork contains active in-flight Hecateq changes, so this map reflects the checked-out tree, not necessarily a released artifact
