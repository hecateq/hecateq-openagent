# Hecateq OpenAgent — Feature Classification

This document classifies all features of Hecateq OpenAgent by their maturity status.

---

## Status Definitions

| Status | Meaning |
|--------|---------|
| **Stable** | Verified in the current fork with routine validation and no known qualification caveat in this document. |
| **Beta** | Feature-complete but may have edge cases. APIs may change with notice. |
| **Experimental** | Under active development. APIs may change without notice. May have incomplete test coverage. |
| **Inherited** | Present in this fork because it is carried from upstream oh-my-openagent. Not re-certified here as fully green end-to-end. |
| **Compatibility** | Maintained for backward compatibility with upstream configs/tools. |
| **Needs verification** | Present in code/config schema but implementation status or full behavior is unclear. |

---

## Full Feature Table

### Core Plugin

| Feature | Status | Source File | Notes |
|---------|--------|-------------|-------|
| Plugin entry | Inherited | `src/index.ts` | 18-line wrapper |
| Plugin module factory | Inherited | `src/testing/create-plugin-module.ts` | 7-step init |
| 13 OpenCode hook handlers | Inherited | `src/plugin-interface.ts` | 11 + 2 compact handlers |
| Config loading (6-phase) | Inherited | `src/plugin-handlers/` | Provider → plugin → agents → tools → MCPs → commands |
| Multi-level JSONC merge | Inherited | `src/plugin-config.ts` | User + walked project |
| Zod v4 config validation | Inherited | `src/config/schema/` | 30 schema files |
| Config migration | Inherited | `src/plugin-config.ts` | Idempotent via `_migrations` |
| Plugin disposal | Inherited | `src/plugin-dispose.ts` | Cleanup on plugin unload |

### Agent System

| Feature | Status | Source | Notes |
|---------|--------|--------|-------|
| 11 built-in agents | Inherited | `src/agents/` | Sisyphus, Hephaestus, Prometheus, Oracle, Librarian, Explore, Atlas, Metis, Momus, Multimodal-Looker, Sisyphus-Junior |
| Agent prompt system | Inherited | `src/agents/` | Dynamic prompt builders |
| Agent override config | Inherited | `src/config/schema/agent-overrides.ts` | 21 fields per agent |
| Agent definitions | Inherited | `src/config/schema/agent-definitions.ts` | External .md/.json agent defs |
| Agent ordering shim | Inherited | `src/plugin-handlers/agent-priority-order.ts` | Current canonical order includes `hecateq-orchestrator` between Sisyphus and Hephaestus |
| Dynamic agent prompting | Inherited | `src/agents/dynamic-agent-prompt-builder.ts` | Agent-specific prompt construction |

### Hook System (5 Tiers)

| Feature | Status | Source | Notes |
|---------|--------|--------|-------|
| Session hooks (24) | Inherited | `src/plugin/hooks/create-session-hooks.ts` | Context monitoring, recovery, notifications, think mode, fallback, ralph loop, etc. |
| Tool Guard hooks (16-17) | Inherited | `src/plugin/hooks/create-tool-guard-hooks.ts` | Comment checker, file guards, rules injector, output truncation, etc. |
| Transform hooks (5-7) | Inherited | `src/plugin/hooks/create-transform-hooks.ts` | Keyword detector, context injection, thinking validation, tool pair validation |
| Continuation hooks (7) | Inherited | `src/plugin/hooks/create-continuation-hooks.ts` | Stop guard, compaction, boulder/todo enforcer, babysitter, atlas, notifications |
| Skill hooks (2) | Inherited | `src/plugin/hooks/create-skill-hooks.ts` | Category skill reminder, auto slash command |
| Team-mode hooks (conditional, +7) | Beta | Various | team-tool-gating, team-mailbox-injector, team-mode-status-injector, 4 team-session-events |

### Tool System

| Feature | Status | Source | Notes |
|---------|--------|--------|-------|
| grep | Inherited | `src/tools/grep/` | Full-text search |
| glob | Inherited | `src/tools/glob/` | File path search |
| Session management (4 tools) | Inherited | `src/tools/session-manager/` | list, read, search, info |
| Background task (3 tools) | Inherited | `src/tools/background-task/` | output, cancel, (launch) |
| call_omo_agent | Inherited | `src/tools/call-omo-agent/` | Subagent spawning |
| task delegation | Inherited | `src/tools/delegate-task/` | Category-based routing |
| skill | Inherited | `src/tools/skill/` | Skill loading |
| skill_mcp | Inherited | `src/tools/skill-mcp/` | Skill MCP invocation |
| Hashline edit support | Inherited | `src/tools/hashline-edit/` | LINE#ID content-hash verified edits |
| look_at | Beta | `src/tools/look-at/` | Media file analysis |
| interactive_bash | Beta | `src/tools/interactive-bash/` | Tmux-based interactive shell |
| task_create/get/list/update | Experimental | `src/tools/task/` | New task system |
| team_* (12 tools) | Beta | `src/features/team-mode/tools/` | Parallel team coordination |
| LSP tools (6) | Inherited | Via built-in MCP | goto_definition, find_references, symbols, diagnostics, prepare_rename, rename |
| AST-grep tools (2) | Inherited | Via built-in MCP | search, replace |

### MCP System (3 Tiers)

| Feature | Status | Source | Notes |
|---------|--------|--------|-------|
| Built-in MCPs (5) | Inherited | `src/mcp/` | 3 remote (websearch, grep-app, context7) + 2 stdio (LSP, AST-grep) |
| Claude Code MCPs | Inherited | `src/features/claude-code-mcp-loader/` | `.mcp.json` with env expansion |
| Skill-embedded MCPs | Inherited | `src/features/skill-mcp-manager/` | SKILL.md YAML frontmatter |
| MCP OAuth (PKCE + DCR) | Beta | `src/features/mcp-oauth/` | OAuth for MCP servers |

### Team Mode

| Feature | Status | Source | Notes |
|---------|--------|--------|-------|
| Team creation/deletion | Beta | `src/features/team-mode/team-registry/` | Directory-based team storage |
| Team mailbox (async messaging) | Beta | `src/features/team-mode/team-mailbox/` | Poll-based message delivery |
| Team tasklist | Beta | `src/features/team-mode/team-tasklist/` | Shared atomic tasks |
| Team git worktrees | Beta | `src/features/team-mode/team-worktree/` | Per-member worktrees |
| Team tmux layout | Beta | `src/features/team-mode/team-layout-tmux/` | Optional tmux pane visualization |
| 12 team_* tools | Beta | `src/features/team-mode/tools/` | Create, delete, status, messaging, tasks |

### Background Tasks

| Feature | Status | Source | Notes |
|---------|--------|--------|-------|
| BackgroundManager | Inherited | `src/features/background-agent/` | Task lifecycle management |
| Concurrency limits | Inherited | `src/features/background-agent/` | Per-key FIFO queue |
| Circuit breaker | Inherited | `src/features/background-agent/` | Automatic failure detection |
| Parent wake notification | Inherited | `src/features/background-agent/parent-wake-notifier.ts` | Wake parent on completion |
| Process cleanup | Inherited | `src/features/background-agent/` | Log-only error handlers |

### Skill System

| Feature | Status | Source | Notes |
|---------|--------|--------|-------|
| 4-scope skill discovery | Inherited | `src/features/opencode-skill-loader/` | Project > opencode > user > global |
| YAML frontmatter parsing | Inherited | `src/features/opencode-skill-loader/` | SKILL.md format |
| Skill merger/dedup | Inherited | `src/features/opencode-skill-loader/merger/` | Priority-based merge |
| 10 built-in skills | Inherited | `src/features/builtin-skills/` | git-master, playwright, review-work, etc. |
| Provider gating | Inherited | `src/features/opencode-skill-loader/` | Model-specific skills |

### Claude Code Compatibility

| Feature | Status | Source | Notes |
|---------|--------|--------|-------|
| Config compatibility | Beta | `src/config/schema/claude-code.ts` | `plugins`, `plugins_override` |
| Hook compatibility | Beta | `src/features/claude-code-hooks/` | Settings.json hook dispatch |
| Agent loading | Beta | `src/features/claude-code-agent-loader/` | `.opencode/agents/` agents |
| MCP loading | Beta | `src/features/claude-code-mcp-loader/` | `.mcp.json` loading |
| Command loading | Beta | `src/features/claude-code-command-loader/` | `.opencode/commands/` commands |

### Model & Provider

| Feature | Status | Source | Notes |
|---------|--------|--------|-------|
| Model fallback (proactive) | Inherited | `src/hooks/model-fallback/` | Per-agent chains |
| Runtime fallback (reactive) | Inherited | `src/hooks/runtime-fallback/` | Error-driven switch |
| Model capabilities cache | Inherited | `src/shared/model-capabilities-cache.ts` | Refreshed from models.dev |
| Provider availability | Inherited | `src/cli/provider-availability.ts` | Install-time detection |
| Agent-model matching | Inherited | `src/shared/model-requirements.ts` | Per-agent requirements |
| Category model requirements | Inherited | `src/tools/delegate-task/constants.ts` | `CATEGORY_MODEL_REQUIREMENTS` |

### Safety & Guardrails

| Feature | Status | Source | Notes |
|---------|--------|--------|-------|
| writeExistingFileGuard | Inherited | `src/hooks/write-existing-file-guard/` | Read-before-write |
| bashFileReadGuard | Inherited | `src/hooks/bash-file-read-guard.ts` | Bash read guard |
| webfetchRedirectGuard | Inherited | `src/hooks/webfetch-redirect-guard/` | Redirect control |
| commentChecker | Inherited | `src/hooks/comment-checker/` | AI-slop detection |
| prometheusMdOnly | Inherited | `src/hooks/prometheus-md-only/` | .md-only edits |
| noSisyphusGpt | Inherited | `src/hooks/no-sisyphus-gpt/` | Provider restriction |
| noHephaestusNonGpt | Inherited | `src/hooks/no-hephaestus-non-gpt/` | Model restriction |
| rulesInjector | Inherited | `src/hooks/rules-injector/` | Auto rule injection |
| hashlineReadEnhancer | Inherited | `src/hooks/hashline-read-enhancer/` | LINE#ID tagging |
| jsonErrorRecovery | Inherited | `src/hooks/json-error-recovery/` | JSON parse fix |

### CLI Commands

| Feature | Status | Source | Notes |
|---------|--------|--------|-------|
| install | Inherited | `src/cli/install.ts` | Interactive + non-interactive |
| run | Inherited | `src/cli/run/` | Non-interactive session |
| doctor (4-category) | Inherited | `src/cli/doctor/` | System, Config, Tools, Models |
| version | Inherited | `src/cli/cli-program.ts` | Trivial |
| get-local-version | Inherited | `src/cli/get-local-version/` | Check updates |
| mcp-oauth | Beta | `src/cli/mcp-oauth/` | login, logout, status |
| refresh-model-capabilities | Inherited | `src/cli/refresh-model-capabilities.ts` | Cache refresh |
| boulder | Inherited | `src/cli/boulder/` | State inspector |
| dashboard / dashboard serve | Beta | `src/cli/dashboard/` | Live Hecateq dashboard client and server |

### Hecateq CLI Commands (Experimental)

| Feature | Status | Source | Notes |
|---------|--------|--------|-------|
| hecateq plan | Experimental | `src/cli/hecateq/plan.ts` | Analysis only, no execution |
| hecateq run | Experimental | `src/cli/hecateq/run.ts` | Auto-execute with safety gates |
| hecateq resume | Experimental | `src/cli/hecateq/resume.ts` | Session recovery |
| hecateq status | Experimental | `src/cli/hecateq/status.ts` | State summary |
| hecateq doctor | Experimental | `src/cli/hecateq/doctor.ts` | 11-category diagnostic |

### Hecateq Orchestration (Experimental)

| Feature | Status | Source | Notes |
|---------|--------|--------|-------|
| Prompt intake | Experimental | `src/features/hecateq-orchestration/prompt-intake.ts` | Intent/risk/domain classification |
| Task decomposition | Experimental | `src/features/hecateq-orchestration/task-decomposer.ts` | Prompt → task nodes |
| Dependency planner | Experimental | `src/features/hecateq-orchestration/dependency-planner.ts` | DAG + cycle detection |
| Agent selector | Experimental | `src/features/hecateq-orchestration/agent-selector.ts` | Registry-based matching |
| Execution planner | Experimental | `src/features/hecateq-orchestration/execution-planner.ts` | Batch ordering + contract injection |
| Quality gate runner | Experimental | `src/features/hecateq-orchestration/quality-gate-runner.ts` | Typecheck/lint/test/build/doctor |
| Repair loop | Experimental | `src/features/hecateq-orchestration/repair-loop-controller.ts` | Auto-retry with backoff |
| Final report generator | Experimental | `src/features/hecateq-orchestration/final-report-generator.ts` | Summary + changed files |
| Orchestration controller | Experimental | `src/features/hecateq-orchestration/orchestration-controller.ts` | Central pipeline (937 lines) |

### Hecateq Memory System (Experimental)

| Feature | Status | Source | Notes |
|---------|--------|--------|-------|
| Memory bootstrap | Experimental | `src/shared/memory-bootstrap.ts` | Create-once directories and templates |
| Memory manifest | Experimental | `src/shared/memory-manifest.ts` | Version/checksum tracking |
| Memory pointer | Experimental | `src/shared/memory-bootstrap.ts` | Active memory dir pointer |
| Memory continuation | Experimental | `src/shared/memory-continuation.ts` | Session state summarization |
| Memory resume | Experimental | `src/shared/memory-resume.ts` | Portable resume plans |
| Memory lock | Experimental | `src/shared/memory-lock.ts` | Concurrency guard |
| Memory path discovery | Experimental | `src/shared/memory-path-discovery.ts` | Find project memory |

### Hecateq Agent System (Experimental)

| Feature | Status | Source | Notes |
|---------|--------|--------|-------|
| Agent indexer | Experimental | `src/shared/hecateq-agent-indexer.ts` | 1681 lines, runtime agent registry |
| Agent index schema | Experimental | `src/config/schema/hecateq.ts` | Enrich, suggest, fresh config |
| Agent index slash command | Experimental | `/hecateq-agent-index` | CLI agent index |
| Custom-agent-first routing | Experimental | `src/features/hecateq-orchestration/` | Custom over built-in |

### Hecateq Handoff System (Experimental)

| Feature | Status | Source | Notes |
|---------|--------|--------|-------|
| Handoff parser | Experimental | `src/features/hecateq-orchestration/handoff-parser.ts` | Parse STATUS/SIGNALS/HANDOFF blocks |
| Handoff role policy | Experimental | `src/features/hecateq-orchestration/handoff-role-policy.ts` | Role handoff rules |
| Handoff context injection | Experimental | `src/features/hecateq-orchestration/handoff-context-injection.ts` | Context enrichment |
| Handoff boulder projection | Experimental | `src/features/hecateq-orchestration/handoff-boulder-projection.ts` | Boulder state sync |
| Runtime handoff service | Experimental | `src/features/hecateq-orchestration/runtime-handoff-service.ts` | Runtime handoff dispatch |

### Hecateq Config (Experimental)

| Feature | Status | Source | Notes |
|---------|--------|--------|-------|
| `hecateq` config block | Experimental | `src/config/schema/hecateq.ts` | 9 sub-configs |
| Context injection config | Experimental | Same | compact/expanded/off modes |
| Agent index config | Experimental | Same | enrich/suggest/fresh/suggestions |
| Memory bootstrap config | Experimental | Same | create_memory_files, create_artifact_dirs |
| Doctor config | Experimental | Same | check flags |
| Git checkpoint config | Experimental | Same | suggest/auto_clean_only/off |
| Dependency graph config | Experimental | Same | off/warn/enforce modes |
| Orchestration config | Experimental | Same | quality gates, timeouts, parallelism |
| Auto-spawn config | Experimental | Same | rate limits, concurrency |
| Delegation chain config | Experimental | Same | depth, fan-out, iterations |

### Auto-Update

| Feature | Status | Source | Notes |
|---------|--------|--------|-------|
| Auto-update checker | Inherited | `src/hooks/auto-update-checker/` | npm version comparison |
| Hecateq distribution channel | Beta | `src/hooks/auto-update-checker/` | Targets `@hecateq/hecateq-openagent` |

### Telemetry

| Feature | Status | Source | Notes |
|---------|--------|--------|-------|
| PostHog telemetry | Inherited | `src/shared/posthog.ts` | Anonymous usage data |
| Default-off in Hecateq builds | Beta | `src/shared/posthog.ts` | Requires env vars to enable |
| Activity state tracking | Inherited | `src/shared/posthog-activity-state.ts` | Session activity |

### OpenClaw

| Feature | Status | Source | Notes |
|---------|--------|--------|-------|
| HTTP dispatch | Beta | `src/openclaw/` | Outbound HTTP hooks |
| Discord daemon | Beta | `src/openclaw/` | Inbound Discord listener |
| Telegram daemon | Beta | `src/openclaw/` | Inbound Telegram listener |
| Shell dispatch | Beta | `src/openclaw/` | Outbound shell commands |
| Reply listener | Beta | `src/openclaw/` | tmux send-keys reply injection |

### Miscellaneous

| Feature | Status | Source | Notes |
|---------|--------|--------|-------|
| Boulder state | Inherited | `src/features/boulder-state/` | Persistent work tracking |
| Ralph loop | Inherited | `src/hooks/ralph-loop/` | Self-referential dev loop |
| IntentGate keyword detector | Inherited | `src/hooks/keyword-detector/` | ultrawork/search/analyze/team |
| Dynamic context pruning | Needs verification | `src/config/schema/` | Config field exists |
| New task system | Needs verification | `src/tools/task/` | config-gated |
| Plugin load timeout | Needs verification | `experimental.plugin_load_timeout_ms` | Config field exists |
