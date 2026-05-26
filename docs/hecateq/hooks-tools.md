# Hecateq OpenAgent — Hook & Tool Catalog

This document catalogs all hooks and tools provided by Hecateq OpenAgent.

---

## Hook System (54 base, 61 with team-mode)

The plugin uses a 5-tier composition. Each tier produces hook handlers wired into OpenCode's plugin interface.

### Tier 1: Session Hooks (24)

| Hook | Event | Purpose |
|------|-------|---------|
| `contextWindowMonitor` | session.idle | Track context usage against limits |
| `preemptiveCompaction` | session.idle | Trigger compaction before context limit |
| `sessionRecovery` | session.error | Recover from structural errors |
| `sessionNotification` | session.idle | OS notifications on completion |
| `thinkMode` | chat.params | Model variant switching for extended thinking |
| `anthropicContextWindowLimitRecovery` | session.error | Multi-strategy context recovery |
| `autoUpdateChecker` | session.created | Check npm for plugin updates |
| `agentUsageReminder` | chat.message | Remind about available agents |
| `nonInteractiveEnv` | chat.message | Adjust behavior for `run` command |
| `interactiveBashSession` | tool.execute | Tmux session lifecycle for interactive_bash |
| `ralphLoop` | event | Self-referential dev loop |
| `editErrorRecovery` | tool.execute.after | Retry failed file edits |
| `delegateTaskRetry` | tool.execute.after | Retry failed task delegations |
| `startWork` | chat.message | `/start-work` command handler |
| `prometheusMdOnly` | tool.execute.before | Enforce .md-only writes for Prometheus |
| `sisyphusJuniorNotepad` | chat.message | Notepad injection for subagents |
| `questionLabelTruncator` | tool.execute.before | Truncate long Question tool labels |
| `taskResumeInfo` | chat.message | Inject task context on resume |
| `anthropicEffort` | chat.params | Adjust reasoning effort level |
| `modelFallback` | chat.params | Proactive provider-level model fallback |
| `noSisyphusGpt` | chat.message | Block Sisyphus from non-GPT providers |
| `noHephaestusNonGpt` | chat.message | Block Hephaestus from non-GPT models |
| `runtimeFallback` | event | Reactive auto-switch on API errors |
| `legacyPluginToast` | chat.message | Show toast for legacy plugin name |

### Tier 2: Tool Guard Hooks (16 base, 17 with team-mode)

| Hook | Event | Purpose |
|------|-------|---------|
| `commentChecker` | tool.execute.after | Block AI-slop comment patterns |
| `toolOutputTruncator` | tool.execute.after | Truncate oversized tool output |
| `directoryAgentsInjector` | tool.execute.before | Inject dir-local AGENTS.md |
| `directoryReadmeInjector` | tool.execute.before | Inject dir-local README.md |
| `emptyTaskResponseDetector` | tool.execute.after | Detect empty task results |
| `rulesInjector` | tool.execute.before | Conditional rules injection |
| `tasksTodowriteDisabler` | tool.execute.before | Disable TodoWrite when task system active |
| `writeExistingFileGuard` | tool.execute.before | Require Read before Write/Edit |
| `bashFileReadGuard` | tool.execute.before | Guard bash read commands |
| `readImageResizer` | tool.execute.after | Resize large images |
| `todoDescriptionOverride` | tool.execute.before | Override todo descriptions |
| `webfetchRedirectGuard` | tool.execute.before | Guard redirect behavior |
| `hashlineReadEnhancer` | tool.execute.after | Tag Read output with LINE#ID |
| `jsonErrorRecovery` | tool.execute.after | JSON parse error recovery |
| `fsyncSkipWarning` | tool.execute.after | Warn on fsync skip |
| *(team-mode)* `teamToolGating` | tool.execute.before | Restrict team tools by role |
| `notepadWriteGuard` | tool.execute.before | Guard notepad writes |

### Tier 3: Transform Hooks (5 base, 7 with team-mode)

| Hook | Event | Purpose |
|------|-------|---------|
| `claudeCodeHooks` | messages.transform | Claude Code settings compatibility |
| `keywordDetector` | messages.transform | Detect ultrawork/search/analyze/team |
| `contextInjectorMessagesTransform` | messages.transform | Inject AGENTS.md/README.md |
| `thinkingBlockValidator` | messages.transform | Validate thinking block structure |
| `toolPairValidator` | messages.transform | Validate tool call/result pairing |
| *(team-mode)* `teamModeStatusInjector` | messages.transform | Inject team status block |
| *(team-mode)* `teamMailboxInjector` | messages.transform | Pull mailbox messages |

### Tier 4: Continuation Hooks (7)

| Hook | Event | Purpose |
|------|-------|---------|
| `stopContinuationGuard` | chat.message | `/stop-continuation` handler |
| `compactionContextInjector` | session.compacted | Re-inject context after compaction |
| `compactionTodoPreserver` | session.compacted | Preserve todos through compaction |
| `todoContinuationEnforcer` | session.idle | Boulder — force continuation |
| `unstableAgentBabysitter` | session.idle | Monitor unstable agent behavior |
| `backgroundNotificationHook` | event | Background task notifications |
| `atlasHook` | event | Master orchestrator for boulder/bg sessions |

### Tier 5: Skill Hooks (2)

| Hook | Event | Purpose |
|------|-------|---------|
| `categorySkillReminder` | chat.message | Hint to load skills before categories |
| `autoSlashCommand` | chat.message | Auto-execute matching `/command` |

### Team-Session Event Handlers (4, direct in event.ts)

| Handler | Purpose |
|---------|---------|
| `team-idle-wake-hint` | Nudge idle team members |
| `team-lead-orphan-handler` | Detect lead departure → orphans |
| `team-member-error-handler` | React to member errors |
| `team-member-status-handler` | Track member status transitions |

---

## Tool System (20-39 tools, config-gated)

### Always-On Tools (20)

| Tool | Namespace | Description |
|------|-----------|-------------|
| `lsp_goto_definition` | MCP | Go to definition |
| `lsp_find_references` | MCP | Find references |
| `lsp_symbols` | MCP | List symbols |
| `lsp_diagnostics` | MCP | Get diagnostics |
| `lsp_prepare_rename` | MCP | Prepare rename |
| `lsp_rename` | MCP | Rename symbol |
| `grep` | Native | Search file contents |
| `glob` | Native | Search file paths |
| `ast_grep_search` | MCP | AST pattern search |
| `ast_grep_replace` | MCP | AST pattern replace |
| `session_list` | Native | List sessions |
| `session_read` | Native | Read session messages |
| `session_search` | Native | Search sessions |
| `session_info` | Native | Session metadata |
| `background_output` | Native | Get background task output |
| `background_cancel` | Native | Cancel background task |
| `call_omo_agent` | Native | Spawn subagent (explore/librarian) |
| `task` | Native | Delegate task to category |
| `skill` | Native | Load a skill |
| `skill_mcp` | Native | Invoke skill-embedded MCP |

### Conditional Tools (up to +19)

| Tool | Gate | Description |
|------|------|-------------|
| `look_at` | `multimodal-looker` not disabled | Analyze media files |
| `interactive_bash` | tmux on PATH | Interactive terminal via tmux |
| `edit` | `hashline_edit` enabled | LINE#ID verified edits |
| `task_create` | `experimental.task_system` | Create task |
| `task_get` | `experimental.task_system` | Get task details |
| `task_list` | `experimental.task_system` | List tasks |
| `task_update` | `experimental.task_system` | Update task |
| `team_create` | `team_mode.enabled` | Create team |
| `team_delete` | `team_mode.enabled` | Delete team |
| `team_shutdown_request` | `team_mode.enabled` | Request shutdown |
| `team_approve_shutdown` | `team_mode.enabled` | Approve shutdown |
| `team_reject_shutdown` | `team_mode.enabled` | Reject shutdown |
| `team_send_message` | `team_mode.enabled` | Send team message |
| `team_task_create` | `team_mode.enabled` | Create team task |
| `team_task_list` | `team_mode.enabled` | List team tasks |
| `team_task_update` | `team_mode.enabled` | Update team task |
| `team_task_get` | `team_mode.enabled` | Get team task |
| `team_status` | `team_mode.enabled` | Team status |
| `team_list` | `team_mode.enabled` | List teams |

### Tool Registration

Tools are registered in `src/plugin/tool-registry.ts` via `createToolRegistry()`, which composes:
- Base tools (always enabled)
- Conditional tools (gated by config flags)
- Team-mode tools (gated by `team_mode.enabled`)
