# PLUGIN_FEATURE_INVENTORY

## Feature Table

| Feature | Category | Files | Config | Default | User Impact | Risk | Test Coverage |
|---|---|---|---|---|---|---|---|
| Plugin runtime assembly | core | `src/index.ts`, `src/testing/create-plugin-module.ts`, `src/plugin-interface.ts` | implicit | on | all runtime behavior | medium | indirect core tests |
| Multi-level config loader | config | `src/plugin-config.ts`, `src/config/schema/*` | root config | on | determines all plugin behavior | high | `src/plugin-config.test.ts`, `src/config/schema.test.ts` |
| Built-in agent registry | agents | `src/agents/builtin-agents.ts`, `src/agents/types.ts` | `agents`, `disabled_agents` | on | agent availability | high | multiple agent tests |
| Hecateq orchestrator | Hecateq/agents | `src/agents/hecateq-orchestrator/*`, `src/agents/builtin-agents/hecateq-orchestrator-agent.ts` | `hecateq.*`, `disabled_agents` | on | exact-agent-first orchestration lane | high | Hecateq agent tests present |
| Delegate task | tools/delegation | `src/tools/delegate-task/*` | `disabled_categories`, `disabled_agents`, category config | on | main agent/task execution lane | high | delegate-task tests present |
| call_omo_agent | tools/delegation | `src/tools/call-omo-agent/*` | disabled tools/agents | on | limited evidence-gathering subagent calls | medium | tool-level tests present |
| Background task manager | background | `src/features/background-agent/*` | `background_task.*` | on | async task orchestration | high | extensive background tests |
| Background output/cancel tools | tools/background | `src/tools/background-task/*` | tool availability | on | retrieves/cancels async work | medium | tool/background tests present |
| Team mode | collaboration | `src/features/team-mode/*`, `src/plugin/tool-registry.ts` | `team_mode.enabled` | off | 12 extra tools + team hooks | high | team-mode checks/tests |
| Built-in commands | commands | `src/features/builtin-commands/*` | `disabled_commands` | on | slash-command templates | medium | command tests present |
| Hecateq memory bootstrap | Hecateq/hooks | `src/hooks/hecateq-memory-bootstrap/index.ts`, `src/shared/memory-bootstrap.ts` | `hecateq.memory_bootstrap.*`, `disabled_hooks` | on | creates project memory/artifact skeleton | low-medium | direct hook tests |
| Hecateq context injector | Hecateq/hooks | `src/hooks/hecateq-project-context-injector/index.ts` | `hecateq.context_injection.*`, `disabled_hooks` | on/compact | injects project context into prompts | high token impact | direct hook tests |
| Hecateq agent index | Hecateq/index | `src/shared/hecateq-agent-indexer.ts`, command template | `hecateq.agent_index.*` | on | suggestions/enrichment/index export | medium | index tests present |
| Hecateq git checkpoint helper | Hecateq/git | `src/shared/git-checkpoint.ts` | `hecateq.git_checkpoint.*` | suggest | adds repo-state awareness | medium | helper tests visible in workspace |
| Doctor workflow | CLI/doctor | `src/cli/doctor/*` | doctor flags + config | on | operational diagnostics | medium-high | doctor tests present |
| Prompt async gate | safety/runtime | `src/shared/prompt-async-gate.ts` and submodules | implicit | on | prevents duplicate prompt injection chaos | high value | architecture audits referenced |
| Write-existing-file guard | safety/hooks | `src/hooks/write-existing-file-guard/*` | `disabled_hooks` | on | blocks write/edit before read | medium | hook tests likely/co-located |
| Comment checker | safety/hooks | `src/hooks/comment-checker/*`, package | config + disabled hooks | on | blocks low-quality AI comments | low-medium | comment-checker tests present in repo |
| OpenClaw bidirectional integration | integration | `src/openclaw/*` | `openclaw` | off unless configured | outbound notifications + inbound reply injection | medium-high | dedicated files/tests |
| Migration compatibility layer | migration | `src/shared/migration/*`, `src/plugin-config.ts` | implicit | on | preserves legacy names/config paths | medium | mixed |
| MCP integration | integration | `src/mcp/*`, skill MCP manager, CC MCP loader | MCP config | on | tool augmentation | medium | mixed |
| Boulder state + CLI inspector | workflow/state | `src/features/boulder-state/*`, `src/cli/cli-program.ts` | feature/runtime usage | on when used | persistent work progress inspection | medium | feature tests present |

## Hook Table

| Hook | Trigger | Files | Config | Does | Risk |
|---|---|---|---|---|---|
| `hecateq-memory-bootstrap` | session lifecycle | `src/hooks/hecateq-memory-bootstrap/index.ts`, `src/plugin/hooks/create-session-hooks.ts` | `hecateq.enabled`, `hecateq.memory_bootstrap.enabled`, `disabled_hooks` | bootstraps memory/artifact dirs | low-medium |
| `hecateq-project-context-injector` | chat.message path | `src/hooks/hecateq-project-context-injector/index.ts`, `src/plugin/hooks/create-session-hooks.ts` | `hecateq.enabled`, `hecateq.context_injection.*`, `disabled_hooks` | injects compact/expanded project context | high token/prompt impact |
| `runtime-fallback` | session/tool lifecycle | `src/plugin/hooks/create-session-hooks.ts`, `src/hooks/runtime-fallback/*` | `runtime_fallback` | reactive provider/model recovery | medium-high |
| `model-fallback` | session lifecycle | `src/plugin/hooks/create-session-hooks.ts`, `src/hooks/model-fallback/*` | `model_fallback` | proactive model fallback | medium |
| `write-existing-file-guard` | tool execute before | `src/hooks/write-existing-file-guard/*` | `disabled_hooks` | blocks writes to unread files | medium |
| `comment-checker` | tool before/after | `src/hooks/comment-checker/*` | comment-checker config, `disabled_hooks` | comment-quality enforcement | low-medium |
| `webfetch-redirect-guard` | tool hooks | `src/hooks/webfetch-redirect-guard/*` | `disabled_hooks` | redirect pre-resolution | low |
| `rules-injector` | tool/message flow | `src/hooks/rules-injector/*` | `disabled_hooks` | injects repo rule files | medium |
| `directory-agents-injector` | tool/message flow | `src/hooks/directory-agents-injector/*` | `disabled_hooks` | injects AGENTS.md context | medium |
| `directory-readme-injector` | tool/message flow | `src/hooks/directory-readme-injector/*` | `disabled_hooks` | injects README context | medium |
| `keyword-detector` | transform/chat flow | `src/hooks/keyword-detector/*` | keyword detector config, `disabled_hooks` | intent classification | medium |
| `thinking-block-validator` | transform flow | `src/hooks/thinking-block-validator/*` | `disabled_hooks` | validates reasoning block structure | medium |
| `tool-pair-validator` | transform flow | `src/hooks/tool-pair-validator/*` | `disabled_hooks` | validates request/tool protocol pairs | medium |
| `prometheus-md-only` | session/tool flow | `src/hooks/prometheus-md-only/*` | `disabled_hooks` | constrains Prometheus write scope | medium |
| `todo-continuation-enforcer` | continuation | `src/plugin/hooks/create-continuation-hooks.ts` | feature config | forces task continuation discipline | medium |
| `unstable-agent-babysitter` | continuation/event | `src/plugin/hooks/create-continuation-hooks.ts` | babysitting config | tracks unstable agent behavior | medium |
| `background-notification-hook` | continuation/event | `src/plugin/hooks/create-continuation-hooks.ts` | continuation config | notifies parent session about background work | medium |
| `notepad-write-guard` | tool execute before | `src/hooks/notepad-write-guard/index.ts`, `src/plugin/hooks/create-tool-guard-hooks.ts` | `disabled_hooks` | blocks destructive writes to append-only notepad paths | medium |
| `plan-format-validator` | tool execute after/before flow via registry | `src/hooks/plan-format-validator/index.ts`, `src/plugin/hooks/create-tool-guard-hooks.ts` | `disabled_hooks` | validates plan output structure | medium |

## Tool Table

| Tool | Purpose | Parameters | Execution | Risk |
|---|---|---|---|---|
| `task` | general delegation/execution | `subagent_type`, `category`, `load_skills`, `run_in_background`, etc. | sync or background | high |
| `call_omo_agent` | limited specialist caller | `subagent_type`, `description`, `prompt`, background flags | sync or background | medium |
| `background_output` | fetch background results | task/session output args | polling/readback | medium |
| `background_cancel` | cancel background task | task ID(s) | cancellation | medium |
| `background_task` | create background task | launch args | async spawn | high |
| `skill` | load skill instructions | name, user_message | sync | low |
| `skill_mcp` | invoke skill-embedded MCP | mcp/tool/resource args | sync | medium |
| `grep` / `glob` | repo search | search args | sync | low |
| `session_list` / `session_read` / `session_search` / `session_info` | session inspection | list/read/search args | sync | low |
| `look_at` | multimodal inspection | media/file args | sync | medium |
| `interactive_bash` | tmux-based shell interaction | command args | interactive | medium-high |
| `edit` | hashline edit | path/line-hash args | sync | medium |
| `team_*` | team collaboration | lifecycle/message/task args | sync | high |

## Agent Table

| Agent | Internal ID | Display Name | Mode | Role | Callable | Visible |
|---|---|---|---|---|---|---|
| Sisyphus | `sisyphus` | `Sisyphus - ultraworker` | `primary` | main orchestrator | yes | yes |
| Hephaestus | `hephaestus` | `Hephaestus - Deep Agent` | `primary` | deep worker | yes | yes |
| Prometheus | `prometheus` | `Prometheus - Plan Builder` | primary-style special config | planner | not generic subagent target | yes |
| Atlas | `atlas` | `Atlas - Plan Executor` | `primary` | executor | yes | yes |
| Sisyphus-Junior | `sisyphus-junior` | `Sisyphus-Junior` | delegated executor lane | category execution | yes | yes |
| Metis | `metis` | `Metis - Plan Consultant` | `subagent` | plan consultant | yes | yes |
| Momus | `momus` | `Momus - Plan Critic` | `subagent` | plan critic | yes | yes |
| Oracle | `oracle` | `oracle` | `subagent` | read-only consultant | yes | yes |
| Librarian | `librarian` | `librarian` | `subagent` | external/docs/code search | limited by tool path | yes |
| Explore | `explore` | `explore` | `subagent` | internal codebase search | limited by tool path | yes |
| Multimodal-Looker | `multimodal-looker` | `multimodal-looker` | `subagent` | media analysis | yes | yes |
| Hecateq God | `hecateq-orchestrator` | `Hecateq God` | `all` | Hecateq orchestrator | yes | yes |

## Command Table

| Command | Type | Files | Side Effect | Output |
|---|---|---|---|---|
| `init-deep` | builtin template | `src/features/builtin-commands/commands.ts`, `templates/init-deep.ts` | generates AGENTS docs | command prompt |
| `ralph-loop` | builtin template | `commands.ts`, `templates/ralph-loop.ts` | loop orchestration | command prompt |
| `ulw-loop` | builtin template | `commands.ts`, `templates/ralph-loop.ts` | ultrawork loop | command prompt |
| `cancel-ralph` | builtin template | `commands.ts`, `templates/ralph-loop.ts` | cancels loop | command prompt |
| `refactor` | builtin template | `commands.ts`, `templates/refactor.ts` | guided refactor workflow | command prompt |
| `start-work` | builtin template | `commands.ts`, `templates/start-work.ts` | starts work from plan | command prompt |
| `stop-continuation` | builtin template | `commands.ts`, `templates/stop-continuation.ts` | stops continuation mechanisms | command prompt |
| `remove-ai-slops` | builtin template | `commands.ts`, `templates/remove-ai-slops.ts` | cleanup workflow | command prompt |
| `handoff` | builtin template | `commands.ts`, `templates/handoff.ts` | context handoff generation | command prompt |
| `hyperplan` | builtin template | `commands.ts`, `templates/hyperplan.ts` | adversarial planning | command prompt |
| `hecateq-agent-index` | builtin template | `commands.ts`, `templates/hecateq-agent-index.ts` | generates global custom-agent capability index | command prompt |

### Verification note

No tests run because this was documentation-only analysis.
