# oh-my-openagent (Hecateq Fork) — Plugin Developer Reference

**Project:** oh-my-openagent / oh-my-opencode (dual-published)
**Version:** v4.2.0
**Fork:** Hecateq ([origin](https://github.com/hecateq/hecateq-openagent)) of [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent)
**Branch:** dev
**Commit:** 39aadbf9f
**Date:** 2026-05-20
**Runtime:** Bun 1.3.12 | TypeScript strict mode (ESNext)
**Repository:** ~2167 TypeScript files, ~313k LOC, 120 barrel `index.ts` files in `src/`

---

## Table of Contents

- [1. Overview](#1-overview)
- [2. Architecture at a Glance](#2-architecture-at-a-glance)
- [3. Plugin Initialization](#3-plugin-initialization)
- [4. The 12 Agents](#4-the-12-agents)
- [5. The 20-39 Tools](#5-the-20-39-tools)
- [6. 5-Tier Hook System](#6-5-tier-hook-system)
- [7. 3-Tier MCP System](#7-3-tier-mcp-system)
- [8. Configuration System](#8-configuration-system)
- [9. Team Mode](#9-team-mode)
- [10. Feature Modules](#10-feature-modules)
- [11. CLI Commands](#11-cli-commands)
- [12. Memory & Workspace](#12-memory--workspace)
- [13. Architectural Invariants](#13-architectural-invariants)
- [14. Test Discipline](#14-test-discipline)
- [15. CI/CD & Build](#15-cicd--build)
- [16. OpenClaw Integration](#16-openclaw-integration)
- [17. Anti-Patterns (Blocking)](#17-anti-patterns-blocking)
- [18. Commands Reference](#18-commands-reference)
- [19. Where to Look](#19-where-to-look)
- [20. Notes](#20-notes)
- [21. Closing](#21-closing)

---

## 1. Overview

oh-my-openagent is a batteries-included OpenCode plugin that extends the IDE/terminal host with 12 specialized AI agents, 54-61 lifecycle hooks, 20-39 config-gated tools, a 3-tier MCP (Model Context Protocol) system, and a parallel team coordination mode. The Hecateq fork adds a custom-agent-first orchestration pipeline, a file-based memory system, structured handoff protocol, dependency-graph task execution, and Hecateq-specific CLI commands.

**TLDR:**
- 12 agents with dynamic prompt building, per-agent model fallback, and tool restrictions
- 54 base hooks (61 with team mode) across 5 tiers: Session, Tool Guard, Transform, Continuation, Skill
- 20 always-on tools (LSP, AST-grep, grep, glob, session mgmt, background tasks, delegation, skills) + 19 conditional (team tools, task system, hashline edit, look_at, interactive_bash)
- 3-tier MCP: built-in servers (3 remote HTTP + 2 local stdio), Claude Code `.mcp.json`, skill-embedded MCPs with OAuth 2.0 + PKCE + DCR
- Multi-level JSONC configuration with Zod v4 validation and automatic migration
- Team Mode for parallel multi-agent coordination (OFF by default, 12 dedicated tools)
- 25 feature modules covering background agents, Claude Code compatibility, MCP OAuth, boulder-state work tracking, and more

---

## 2. Architecture at a Glance

```
OpenCode Host
    |
    v
Plugin Entry (src/index.ts)
    |
    v
createPluginModule()  (src/testing/create-plugin-module.ts)
    |
    +--- installAgentSortShim()       patches Array.prototype.sort
    +--- initConfigContext()          detect opencode-vs-openagent layout
    +--- detectExternalSkillPlugin()  warn on conflicts
    +--- injectServerAuthIntoClient() auth headers into SDK client
    +--- loadPluginConfig()           JSONC walk + merge + Zod v4 validate
    +--- initializeOpenClaw()         bidirectional daemon (Discord/Telegram/HTTP)
    +--- checkTeamModeDependencies()  if team_mode.enabled
    |
    v
createManagers()  (TmuxSessionManager, BackgroundManager, SkillMcpManager, ConfigHandler)
    |
    v
createTools()  (SkillContext + AvailableCategories + ToolRegistry — 20-39 tools)
    |
    v
createHooks()  (5-tier composition: 54-61 hooks)
    |
    v
createPluginInterface()  (11 OpenCode hook handlers + 2 compaction hooks)

    12 Agents             20-39 Tools                  3-Tier MCP
  ┌────────────┐      ┌──────────────────┐      ┌──────────────────────┐
  │ Hecateq God │      │ LSP (6)          │      │ Tier 1: Built-in     │
  │ Sisyphus   │      │ AST-grep (2)     │      │  - websearch (HTTP)  │
  │ Hephaestus │      │ grep, glob (2)   │      │  - grep-app (HTTP)   │
  │ Prometheus │      │ session (4)      │      │  - context7 (HTTP)   │
  │ Oracle     │      │ background (2)   │      │  - lsp (stdio)       │
  │ Librarian  │      │ delegation (2)   │      │  - ast_grep (stdio)  │
  │ Explore    │      │ skill, skill_mcp │      ├──────────────────────┤
  │ Atlas      │      │ look_at          │      │ Tier 2: Claude Code  │
  │ Metis      │      │ interactive_bash │      │  - .mcp.json files   │
  │ Momus      │      │ hashline edit    │      │  - env var expansion │
  │ Multimodal-│      │ task_create*     │      ├──────────────────────┤
  │ Looker     │      │ team_* (12) *    │      │ Tier 3: Skill MCPs   │
  │ Sisyphus-  │      │                  │      │  - SKILL.md YAML     │
  │ Junior     │      │ * conditional    │      │  - OAuth 2.0+PKCE    │
  └────────────┘      └──────────────────┘      └──────────────────────┘
```

---

## 3. Plugin Initialization

Entry: `src/index.ts` (18-line wrapper) delegates to `src/testing/create-plugin-module.ts`. The `createPluginModule()` function returns a `PluginModule` with `{ id: "oh-my-openagent", server }`.

The `serverPlugin(input, options)` async function runs 7 steps:

```typescript
// Step 1: patches Array.prototype.{toSorted,sort} for canonical agent ordering
deps.installAgentSortShim()

// Step 2: detects opencode-vs-openagent config layout
deps.initConfigContext("opencode", null)

// Step 3: warn if conflicting plugin (e.g., skills.md) is loaded
const skillPluginCheck = deps.detectExternalSkillPlugin(input.directory)

// Step 4: wire auth headers into shared SDK client
deps.injectServerAuthIntoClient(input.client)

// Step 5: walk project + user JSONC config files, merge, Zod safeParse, migrate
const pluginConfig = deps.loadPluginConfig(input.directory, input)
deps.initI18n(pluginConfig.i18n?.locale ? { locale: pluginConfig.i18n.locale } : undefined)

// Step 6a: if openclaw config present, start bidirectional daemon
if (pluginConfig.openclaw) {
  await deps.initializeOpenClaw(pluginConfig.openclaw)
}

// Step 6b: if team_mode.enabled, verify git, tmux, ensure ~/.omo/teams/
if (pluginConfig.team_mode?.enabled) {
  await checkTeamModeDependencies(teamModeConfig)
  await ensureBaseDirs(resolveBaseDir(teamModeConfig))
}

// Step 7: compose managers, tools, hooks, and plugin interface
const managers = deps.createManagers({ ctx, pluginConfig, tmuxConfig, ... })
const toolsResult = await deps.createTools({ ctx, pluginConfig, managers })
const hooks = deps.createHooks({ ctx, pluginConfig, managers, ... })
const pluginInterface = deps.createPluginInterface({ ctx, pluginConfig, ... })

// Wire compaction handlers (2 extra hooks)
const pluginHooks = {
  ...pluginInterface,
  "experimental.session.compacting": createSessionCompactingHandler(hooks),
  "experimental.compaction.autocontinue": createCompactionAutocontinueHandler(hooks),
}
return pluginHooks
```

**Four managers** created in step 7:
- `TmuxSessionManager` — controls tmux sessions for interactive bash
- `BackgroundManager` — manages concurrent background agent tasks
- `SkillMcpManager` — per-session Tier-3 MCP lifecycle
- `ConfigHandler` — runtime config loading and caching

---

## 4. The 12 Agents

### Agent Inventory

| Agent | Mode | Default Model | Temp | Purpose |
|-------|------|---------------|------|---------|
| **Hecateq-Orchestrator** | all | resolved from config | (default) | Custom-agent-first orchestrator (Hecateq God); `thinking: { budgetTokens: 32000 }` |
| **Sisyphus** | primary | claude-opus-4-7 max | (default) | Main orchestrator — planning, delegation, task splitting; `thinking: { budgetTokens: 32000 }` |
| **Hephaestus** | primary | gpt-5.5 medium | (default) | Autonomous deep worker — coding, debugging, building |
| **Prometheus** | primary | claude-opus-4-7 max | (override) | Strategic planner (interview mode); built via `buildPrometheusAgentConfig` (not in `agentSources`) |
| **Atlas** | primary | claude-sonnet-4-6 | 0.1 | Todo-list orchestrator — boulder, ralph loop, background sessions |
| **Oracle** | subagent | gpt-5.5 high | 0.1 | Read-only architectural review, code quality, design review |
| **Librarian** | subagent | gpt-5.4-mini-fast | 0.1 | External documentation search, code examples |
| **Explore** | subagent | gpt-5.4-mini-fast | 0.1 | Codebase exploration — files, patterns, structure |
| **Metis** | subagent | claude-sonnet-4-6 | 0.3 | Pre-planning consultant — safety, compliance, security audit |
| **Momus** | subagent | gpt-5.5 xhigh | 0.1 | Plan reviewer — assumption breaking, edge case analysis |
| **Multimodal-Looker** | subagent | gpt-5.5 medium | 0.1 | Visual analysis — images, PDFs, diagrams |
| **Sisyphus-Junior** | subagent | claude-sonnet-4-6 | 0.1 | Lightweight category-spawned executor |

### Agent Details

**Hecateq-Orchestrator (Hecateq God)** — The 12th built-in agent added in this fork. Routes tasks through explicit agent resolution, dependency-aware delegation, and quality-gated execution. Prefers custom agents over built-in agents, uses deterministic routing, and emits structured handoff blocks. Registered as `"hecateq-orchestrator"`, sits first in canonical order.

**Sisyphus** — The main orchestrator. Plans work, delegates to subagents via `task()` tool, and manages the execution flow. Receives the dynamic prompt with agent tables, category listings, and skill descriptions.

**Hephaestus** — The implementation workhorse. Routes to model-specific variant prompts (gpt, gpt-5-3-codex, gpt-5-4, gpt-5-5). Handles coding, debugging, and building autonomously.

**Prometheus** — Special-cased: no `createPrometheusAgent` factory. Its config is built directly in `src/plugin-handlers/prometheus-agent-config-builder.ts` during Phase 3 of the config loading pipeline. Enforces `.md`-only writes via the `prometheus-md-only` hook. Tool restrictions: denied `write`, `edit`, `task`.

**Atlas** — Background orchestrator for boulder-state work tracking, ralph loop sessions, and long-running background tasks. Uses the `task` delegation tool but denies `call_omo_agent`.

**Oracle** — Pure read-only consultant. Tool-restricted: denied `write`, `edit`, `task`, `call_omo_agent`. Low temperature (0.1) for deterministic analysis.

**Librarian** — External research specialist. Searches documentation, finds code examples, reads API references. Same tool restrictions as Oracle.

**Explore** — Codebase search specialist. Runs contextual grep, glob, and AST searches. Same tool restrictions as Oracle.

**Metis** — Pre-flight safety and compliance checker. Higher temperature (0.3) for broader analysis. Verifies security posture, dependency licenses, and configuration safety.

**Momus** — Adversarial plan reviewer. High-intelligence model (gpt-5.5 xhigh) with low temperature. Denied `write`, `edit`, `task`. Reviews plans for hidden assumptions, edge cases, and failure modes.

**Multimodal-Looker** — Vision agent. Restricted to read-only tools only. Analyzes images, PDFs, diagrams, and screenshots.

**Sisyphus-Junior** — Lightweight subagent for category-spawned delegation tasks. Default model claude-sonnet-4-6. Used when a category routes through Sisyphus-Junior instead of directly to an agent.

### Canonical Agent Order

`Hecateq-orchestrator -> Sisyphus -> Hephaestus -> Prometheus -> Atlas`

Enforced by `installAgentSortShim()` which patches `Array.prototype.toSorted`/`.sort` narrowly when the array contains 2+ canonical core agents.

### Tool Restrictions

| Agent | Denied Tools |
|-------|-------------|
| Oracle | write, edit, task, call_omo_agent |
| Librarian | write, edit, task, call_omo_agent |
| Explore | write, edit, task, call_omo_agent |
| Multimodal-Looker | ALL except read |
| Atlas | task, call_omo_agent |
| Momus | write, edit, task |
| Prometheus | enforces `.md`-only writes via `prometheus-md-only` hook |

---

## 5. The 20-39 Tools

### Always-On (20)

Six LSP tools (via built-in MCP `lsp`): `lsp_goto_definition`, `lsp_find_references`, `lsp_symbols`, `lsp_diagnostics`, `lsp_prepare_rename`, `lsp_rename`

Two AST-grep tools (via built-in MCP `ast_grep`): `ast_grep_search`, `ast_grep_replace`

Two search tools: `grep` (content search, 60s timeout, 10MB limit), `glob` (file pattern search, 60s timeout, 100 file limit)

Four session tools: `session_list`, `session_read`, `session_search`, `session_info`

Two background tools: `background_output`, `background_cancel`

Two delegation tools: `task` (full category+skill delegation), `call_omo_agent` (explore + librarian only)

Two skill tools: `skill` (load skill or invoke command), `skill_mcp` (call skill-embedded MCP tool/resource/prompt)

### Conditional (up to +19)

| Tools | Gate | Count |
|-------|------|-------|
| `look_at` | `multimodal-looker` not disabled | +1 |
| `interactive_bash` | `tmux` binary on PATH via `isInteractiveBashEnabled()` | +1 |
| `edit` (hashline) | `hashline_edit: true` in config | +1 |
| `task_create`, `task_get`, `task_list`, `task_update` | `experimental.task_system` enabled | +4 |
| `team_create`, `team_delete`, `team_shutdown_request`, `team_approve_shutdown`, `team_reject_shutdown`, `team_send_message`, `team_task_create`, `team_task_list`, `team_task_update`, `team_task_get`, `team_status`, `team_list` | `team_mode.enabled: true` | +12 |

### Delegation Categories (8 built-in)

| Category | Default Model | Domain |
|----------|---------------|--------|
| `visual-engineering` | google/gemini-3.1-pro (variant: high) | Frontend, UI/UX |
| `ultrabrain` | openai/gpt-5.5 (variant: xhigh) | Hard logic, heavy reasoning |
| `deep` | openai/gpt-5.5 (variant: medium) | Autonomous multi-step problem-solving |
| `artistry` | google/gemini-3.1-pro (variant: high) | Creative, unconventional approaches |
| `quick` | openai/gpt-5.4-mini | Trivial single-file changes |
| `unspecified-low` | anthropic/claude-sonnet-4-6 | Moderate effort fallback |
| `unspecified-high` | anthropic/claude-opus-4-7 (variant: max) | High effort fallback |
| `writing` | kimi-for-coding/k2p5 -> gemini-3-flash | Documentation, prose |

User-defined categories in config override and extend this set.

---

## 6. 5-Tier Hook System

54 base hooks, 61 with `team_mode.enabled`. Composed by `createCoreHooks()` + `createContinuationHooks()` + `createSkillHooks()`.

| Tier | Count | +Team | Key Hooks |
|------|-------|-------|-----------|
| **Session** | 24 | 0 | contextWindowMonitor, preemptiveCompaction, sessionRecovery, sessionNotification, thinkMode, modelFallback, anthropicContextWindowLimitRecovery, autoUpdateChecker, agentUsageReminder, nonInteractiveEnv, interactiveBashSession, ralphLoop, editErrorRecovery, delegateTaskRetry, startWork, prometheusMdOnly, sisyphusJuniorNotepad, noSisyphusGpt, noHephaestusNonGpt, questionLabelTruncator, taskResumeInfo, anthropicEffort, runtimeFallback, legacyPluginToast |
| **Tool Guard** | 16 | +1 | commentChecker, toolOutputTruncator, directoryAgentsInjector, directoryReadmeInjector, emptyTaskResponseDetector, rulesInjector, tasksTodowriteDisabler, writeExistingFileGuard, bashFileReadGuard, hashlineReadEnhancer, jsonErrorRecovery, readImageResizer, todoDescriptionOverride, webfetchRedirectGuard, fsyncSkipWarning [+ teamToolGating] |
| **Transform** | 5 | +2 | claudeCodeHooks, keywordDetector (IntentGate), contextInjectorMessagesTransform, thinkingBlockValidator, toolPairValidator [+ teamModeStatusInjector, teamMailboxInjector] |
| **Continuation** | 7 | 0 | stopContinuationGuard, compactionContextInjector, compactionTodoPreserver, todoContinuationEnforcer (boulder), unstableAgentBabysitter, backgroundNotificationHook, atlasHook |
| **Skill** | 2 | 0 | subagentSkillReminder, autoSlashCommand |
| **Direct event** | — | +4 | team-idle-wake-hint, team-lead-orphan-handler, team-member-error-handler, team-member-status-handler (in `src/plugin/event.ts`) |

Each tier produces an object whose values are `(input, output) => void` handlers. The matching OpenCode handler invokes them in registration order via `safeHook()` wrappers that isolate errors.

---

## 7. 3-Tier MCP System

| Tier | Source | Loader | Mechanism |
|------|--------|--------|-----------|
| **1. Built-in** | `src/mcp/` | `createBuiltinMcps()` | 3 remote HTTP + 2 local stdio MCPs |
| **2. Claude Code** | `.mcp.json` (project + user) | `claude-code-mcp-loader` | `${VAR}` env expansion (allowlist via `mcp_env_allowlist`) |
| **3. Skill-embedded** | SKILL.md YAML frontmatter | `SkillMcpManager` (per-session) | stdio + HTTP, OAuth 2.0 + PKCE + DCR step-up |

### Built-in MCPs (Tier 1)

| MCP | Type | Source File |
|-----|------|-------------|
| `websearch` | Remote HTTP | `src/mcp/websearch.ts` |
| `grep-app` | Remote HTTP | `src/mcp/grep-app.ts` |
| `context7` | Remote HTTP | `src/mcp/context7.ts` |
| `lsp` | Local stdio | `src/mcp/lsp.ts` (backed by `packages/lsp-tools-mcp`) |
| `ast_grep` | Local stdio | `src/mcp/ast-grep.ts` (backed by `packages/ast-grep-mcp`) |

LSP and AST-grep MCPs serve the `lsp_*` and `ast_grep_*` tool names through OpenCode MCP namespacing. Per-session isolation for Tier-3 MCPs: clients keyed by `${sessionID}:${skillName}:${serverName}`.

---

## 8. Configuration System

### Multi-Level Config Walk-Up

```
Walked configs (closer wins): <pwd up to $HOME>/.opencode/oh-my-openagent.json[c]
                                        (legacy: oh-my-opencode.json[c])
                            v merged onto
User config:               ~/.config/opencode/oh-my-openagent.json[c]
                            v falls back to
Defaults                   (Zod safeParse fills omitted fields)
```

### Deep-Merge Rules

- `agents`, `categories`, `claude_code`: deep merged recursively (prototype-pollution safe)
- `disabled_*` arrays: Set union (concatenated + deduplicated)
- All other fields: override replaces base value
- `mcp_env_allowlist`: **user-only** for security; walked configs cannot extend it
- `migrateConfigFile()` rewrites legacy keys (idempotent via `_migrations` tracking + timestamped backups)

### Schema

30 Zod v4 schema files in `src/config/schema/`. The root schema `OhMyOpenCodeConfigSchema` validates all fields.

Schema autocomplete URL for Hecateq fork:
```json
{
  "$schema": "https://raw.githubusercontent.com/hecateq/hecateq-openagent/main/assets/hecateq-openagent.schema.json"
}
```

### Config Loading Pipeline (6 Phases)

1. Provider detection and model capability resolution
2. Plugin components (managers, state)
3. Agent config building (including Prometheus special case)
4. Tool registry compilation
5. MCP server registration
6. Command registration

---

## 9. Team Mode

OFF by default. Parallel multi-agent coordination modeled after Claude Code Agent Teams. Enable via `team_mode.enabled: true` in config; restart OpenCode after change.

### Schema (11 fields)

```jsonc
{
  "team_mode": {
    "enabled": true,
    "tmux_visualization": false,
    "max_parallel_members": 4,            // 1..8
    "max_members": 8,                     // 1..8 hard cap
    "max_messages_per_run": 10000,
    "max_wall_clock_minutes": 120,
    "max_member_turns": 500,
    "base_dir": null,                     // override default ~/.omo/teams or <project>/.omo/teams
    "message_payload_max_bytes": 32768,   // >=1024
    "recipient_unread_max_bytes": 262144, // >=1024
    "mailbox_poll_interval_ms": 3000      // >=500
  }
}
```

### Member Eligibility

From `AGENT_ELIGIBILITY_REGISTRY` in `src/features/team-mode/types.ts`:

| Verdict | Agents |
|---------|--------|
| `eligible` | sisyphus, atlas, sisyphus-junior |
| `conditional` | hephaestus (lacks `teammate: "allow"` by default; apply D-36 or use `subagent_type: "sisyphus"`) |
| `hard-reject` | oracle, librarian, explore, multimodal-looker, metis, momus, prometheus (rejected at parse; use `task`/delegate-task) |

### Storage Layout

`~/.omo/teams/{name}/` (user) or `<project>/.omo/teams/{name}/` (project; project wins on collision):

| Path | Purpose |
|------|---------|
| `config.json` | Team spec |
| `state.json` | Runtime state |
| `mailbox/` | Message mailboxes |
| `tasklist.jsonl` | Shared task list |
| `worktrees/` | Per-member git worktrees |

### Team Tools (12)

`team_create`, `team_delete`, `team_shutdown_request`, `team_approve_shutdown`, `team_reject_shutdown`, `team_send_message`, `team_task_create`, `team_task_list`, `team_task_update`, `team_task_get`, `team_status`, `team_list`

---

## 10. Feature Modules

25 standalone modules in `src/features/`:

| Module | Purpose |
|--------|---------|
| `autonomous-spawn` | Autonomous subagent spawning with concurrency limits and failure backoff |
| `background-agent` | Concurrent background task execution engine (FIFO queues, per-key limits) |
| `boulder-state` | Persistent work tracking state machine across sessions |
| `builtin-commands` | Built-in slash commands (templates in `templates/`) |
| `builtin-skills` | Built-in skills with `BuiltinSkill` interface |
| `claude-code-agent-loader` | Agent definition loader for Claude Code compatibility |
| `claude-code-command-loader` | Command loader for Claude Code compatibility |
| `claude-code-mcp-loader` | MCP loader for Claude Code `.mcp.json` (Tier 2) |
| `claude-code-plugin-loader` | Plugin discovery for Claude Code (10s timeout) |
| `claude-code-session-state` | Session state tracking for Claude Code integration |
| `claude-tasks` | Claude Code task file integration |
| `context-injector` | Hecateq memory/context injection into agent sessions |
| `dashboard` | Hecateq dashboard client and persistent server |
| `hecateq-orchestration` | Full orchestration pipeline: intake, decompose, graph, select, execute, gates, repair |
| `hermes-state` | Config snapshot for runtime state tracking |
| `hook-message-injector` | Internal message injection via hook system |
| `mcp-oauth` | OAuth 2.0 + PKCE + DCR for Tier-3 MCPs |
| `opencode-skill-loader` | Skill loader for OpenCode skills |
| `prompt-renderer` | Prompt template rendering engine |
| `run-continuation-state` | State management for run continuation |
| `skill-mcp-manager` | Per-session Tier-3 MCP lifecycle (stdio + HTTP) |
| `task-toast-manager` | OS toast notifications for task events |
| `team-mode` | Parallel multi-agent team coordination |
| `tmux-subagent` | Tmux subagent for interactive bash sessions |
| `tool-metadata-store` | Tool metadata caching and retrieval |

---

## 11. CLI Commands

Three binary entry points: `hecateq-openagent`, `oh-my-opencode`, `oh-my-openagent`.

| Command | Purpose | Key Flags/Notes |
|---------|---------|-----------------|
| `install` / `setup` | Interactive/non-interactive setup wizard | Alias: `setup` |
| `run <message>` | Non-interactive session launcher | Auto-completes when todos done + no bg tasks |
| `doctor` | 4-category health diagnostics | System, Config, Tools, Models |
| `version` | Print plugin version | — |
| `get-local-version` | Check installed vs npm latest | — |
| `mcp-oauth login <server-url>` | MCP OAuth login | PKCE + DCR |
| `mcp-oauth logout` | MCP OAuth logout | — |
| `mcp-oauth status` | MCP OAuth token status | — |
| `refresh-model-capabilities` | Refresh model capabilities cache from models.dev | — |
| `boulder` | Boulder state inspector | Persistent work tracking |
| `dashboard` / `dashboard serve` | Hecateq dashboard client and persistent server | — |
| `hecateq plan <prompt>` | Analyze, decompose, plan — no execution | Experimental |
| `hecateq run <prompt>` | Auto-run low-risk, show plan for high-risk | `--force`, `--dry-run` |
| `hecateq resume [--session-id]` | Recover unfinished orchestration sessions | Experimental |
| `hecateq status` | Summarize orchestration state/history | Experimental |
| `hecateq doctor` | 11-category Hecateq workflow diagnostics | Experimental |

---

## 12. Memory & Workspace

### Memory Structure (`.opencode/state/memory/`)

```
.opencode/state/memory/
  memory.json           Manifest (schema v2, checksums, lock state)
  active-context.md     Current session context
  progress.md           Milestone tracking
  tasks.md              Pending/blocked/done tasks
  tasks.jsonl           Task log
  decisions.md          Architecture decisions
  decisions.jsonl       Decision log
  file-map.md           Important file paths & entry points
  agent-routing.md      Agent routing rules & preferences
  quality-history.md    Quality gate results & audit trail
  risk-profile.md       Known risks & mitigations
  conventions.md        Project conventions
  environment.md        Environment setup
  glossary.md           Project terminology
  open-questions.md     Open questions
  incidents.md          Incident log
  .locks/               File lock directory
```

### Handoff Protocol

Every agent emits on task completion:

```
STATUS: [DONE | IN_PROGRESS | BLOCKED]
SIGNALS_EMITTED: [{"signal":"<name>","payload":{}}]
HANDOFF: [return_to_caller | return_to_parent_for_routing | <agent-id>]
```

### Workspace Migration

Runtime state migrated from `.sisyphus/` to `.omo/`. Legacy `.sisyphus/` still exists during transition; `src/shared/legacy-workspace-migration.ts` copies it forward on first load.

The `.omo/` directory contains: `run-continuation/`, `plans/`, `tasks/`, `notepads/`, `rules/`, `teams/`.

---

## 13. Architectural Invariants

**Canonical agent order:** `Hecateq-orchestrator -> Sisyphus -> Hephaestus -> Prometheus -> Atlas`. Enforced by `installAgentSortShim()` which patches `Array.prototype.toSorted`/`.sort` narrowly when the array contains 2+ canonical core agents.

**Hashline LINE#ID pairing:** Every `Read` tool output is tagged with `LINE#ID` content hashes using characters from the set `ZPMQVRWSNKTXJBYH`; the `edit` (hashline) tool validates the hash before applying. Stale hash = rejection. The `NIBBLE_STR` constant is `"ZPMQVRWSNKTXJBYH"` (16 chars, defined in `packages/hashline-core/src/constants.ts`).

**5-tier hook composition:** Session (24) + ToolGuard (16) + Transform (5) + Continuation (7) + Skill (2) = 54 base. With `team_mode.enabled`: +1 ToolGuard, +2 Transform, +4 direct event handlers = 61.

**Per-session MCP isolation:** Tier-3 MCP clients keyed by `${sessionID}:${skillName}:${serverName}` so the same skill in two sessions does not share state.

**Two independent fallback systems:** `model-fallback` (proactive, `chat.params`, hardcoded per-agent chains) vs `runtime-fallback` (reactive, `session.error`, configurable per-category/agent). No direct integration between them.

**Prompt-async-gate discipline:** `session.prompt` / `session.promptAsync` calls may only occur inside `src/shared/prompt-async-gate.ts`. All other routes must use `dispatchInternalPrompt()`. Forbidden: raw prompt calls outside the gate, `postDispatchHoldMs: 0`, no-session fallback to raw prompt, and new internal message routes without duplicate-injection regression tests.

**OpenClaw bidirectional:** Outbound dispatchers fire on session events (created/deleted/idle/error); inbound daemon polls Discord/Telegram and `send-keys` replies into the tracked tmux pane.

---

## 14. Test Discipline

### Rules (NON-NEGOTIABLE)

- **Bun only:** `bun test` runs the root suite in one process. No isolation flags, no retries, no special ordering.
- **Forbidden in test bodies** (unless time IS the system under test): `setTimeout(resolve, N)`, `await new Promise(r => setTimeout(r, N))`, `await sleep(N)`.
- **Event testing:** Subscribe BEFORE the trigger, race against an explicit timeout. `"waited 5s for event 'X', never fired"` on timeout.
- **No isolation crutches:** No `.only`/`.skip` to mask flaky tests, no per-process test isolation, no reordering to mask cross-test contamination.
- **Prompt tests:** Assert structural invariants, not wording. No `toContain("exact text")`, no `toMatchSnapshot()`.
- **Given/when/then style:** Nested `describe` with `#given`/`#when`/`#then` prefixes, or inline `// given` / `// when` / `// then` comments. Never Arrange-Act-Assert.

### Test Infrastructure

- `test-setup.ts` preloaded via `bunfig.toml` resets session/cache state between tests
- Co-located `*.test.ts` files alongside source
- Two meta-audit files (`src/shared/mock-module-lifecycle-audit.test.ts`, `src/shared/prompt-async-route-audit.test.ts`) parse the entire codebase via TS compiler API and FAIL the suite when architectural invariants are violated
- 9 `zauc-mocks-*` directories use alphabetical sort-order hack for `bun:test` discovery — these hold `mock.module()` setup and are NOT hooks/tools

---

## 15. CI/CD & Build

### CI Environment

- Bun 1.3.12, TypeScript 6.x strict mode
- Build: `bun build` (ESM) + `tsc --emitDeclarationOnly`; externals: `@ast-grep/napi`, `zod`
- Typecheck: `tsgo --noEmit` (NOT `tsc`)
- 11 platform binaries via `bun compile` (darwin/linux/windows — run on native OS, not cross-compiled)

### GitHub Actions Workflows (9)

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `ci.yml` | push/PR to master/dev | Tests, typecheck, build, auto-commit schema on master push, draft "next" release on dev push (blocks master-targeting PRs) |
| `publish.yml` | manual dispatch | Test, typecheck, preflight-trust, dual npm publish, platform binaries, GitHub release |
| `publish-platform.yml` | called by publish.yml | 11 platform binaries via `bun compile` |
| `sisyphus-agent.yml` | @mention or manual | AI agent handles issues/PRs |
| `refresh-model-capabilities.yml` | weekly cron / dispatch | Refresh model capabilities from models.dev |
| `cla.yml` | issue_comment / PR | CLA assistant for contributors |
| `lint-workflows.yml` | push/PR touching `.github/workflows/**` | actionlint only |
| `web-ci.yml` | push/PR touching packages/web/ | format-check, lint, type-check, next build |
| `web-deploy.yml` | push to master/dev or manual | Cloudflare Workers deploy |

### PR Merge Policy

- PRs into `dev` MUST use merge commits. `gh pr merge <number> --merge --delete-branch`
- NEVER squash merge or rebase merge PRs in this repository.
- PRs targeting `master` are hard-blocked — they MUST target `dev`.

---

## 16. OpenClaw Integration

Bidirectional external integration system in `src/openclaw/` (26 files, ~3k LOC).

**Outbound:** Event-driven dispatchers fire on session lifecycle events (created, deleted, idle, error). Supports HTTP and shell notification targets.

**Inbound:** Daemon polls Discord and Telegram for incoming messages. Received messages are injected into the tracked tmux pane via `send-keys`, enabling interactive agent communication from chat platforms.

Configuration via `openclaw` config block. Status: Beta with operational risk.

---

## 17. Anti-Patterns (Blocking)

- Never `as any`, `@ts-ignore`, `@ts-expect-error`
- Never suppress lint/type errors
- Never add emojis to code/comments unless user explicitly asks
- Never commit unless explicitly requested
- Never run `bun publish` directly — use the GitHub Actions workflow
- Never modify `package.json` `version` locally — handled by publish workflow
- Never write to existing files without reading them first (`write-existing-file-guard`)
- Never use `background_cancel(all=true)` — cancel by `taskId` individually
- Never delete a failing test to make a build green. Fix the code.
- Never em dashes / en dashes / AI filler ("simply", "obviously", "clearly", "moreover", "furthermore") in generated content
- Never create catch-all files (`utils.ts`, `helpers.ts`, `service.ts`)
- Never empty catch blocks `catch(e) {}`
- Never test with Arrange-Act-Assert comments — use given/when/then
- Never dump business logic into `index.ts` — barrel exports only
- Prometheus may ONLY edit `.md` files (enforced by `prometheus-md-only` hook); FORBIDDEN paths: `src/`, `package.json`, config files

---

## 18. Commands Reference

```bash
# Test
bun test                          # Root Bun test suite in one process

# Build
bun run build                     # Plugin (ESM bundle + .d.ts + cli bundle + schema)
bun run build:all                 # Build + 11 platform binaries
bun run build:schema              # Regenerate JSON Schema
bun run build:model-capabilities  # Refresh model capabilities cache
bun run typecheck                 # tsgo --noEmit
bun run clean                     # rm -rf dist

# CLI (installed globally)
bunx hecateq-openagent install    # Interactive setup wizard
bunx hecateq-openagent doctor     # Health diagnostics
bunx hecateq-openagent run <msg>  # Non-interactive session
bunx hecateq-openagent mcp-oauth login <server-url>  # MCP OAuth

# Hecateq CLI (experimental)
bunx hecateq-openagent hecateq plan <prompt>
bunx hecateq-openagent hecateq run <prompt> [--force]
bunx hecateq-openagent hecateq resume [--session-id <id>]
bunx hecateq-openagent hecateq status
bunx hecateq-openagent hecateq doctor
```

---

## 19. Where to Look

| Task | Location | Notes |
|------|----------|-------|
| Add new agent | `src/agents/` + `src/agents/builtin-agents/` | `createXXXAgent` factory + `mode: "primary" | "subagent" | "all"` |
| Add new hook | `src/hooks/{name}/` + register in `src/plugin/hooks/create-*-hooks.ts` | Pick the right tier (Session/ToolGuard/Transform/Continuation/Skill) |
| Add new tool | `src/tools/{name}/` + register in `src/plugin/tool-registry.ts` | Factory `createXXXTool` or direct `ToolDefinition` |
| Add new feature module | `src/features/{name}/` | Standalone module wired into `plugin/` layer |
| Add new MCP (tier 1) | `src/mcp/` + register in `createBuiltinMcps()` | Remote HTTP or local stdio |
| Add new built-in skill | `src/features/builtin-skills/skills/{name}.ts` | Implement `BuiltinSkill` interface |
| Add new command | `src/features/builtin-commands/` | Templates in `templates/` |
| Add new CLI subcommand | `src/cli/cli-program.ts` | Commander.js subcommand |
| Add new doctor check | `src/cli/doctor/checks/` | Register in `checks/index.ts` |
| Modify config schema | `src/config/schema/` + add to `OhMyOpenCodeConfigSchema` | Zod v4; auto-regenerated via `build:schema` |
| Add new category | `src/tools/delegate-task/constants.ts` | `DEFAULT_CATEGORIES` + `CATEGORY_MODEL_REQUIREMENTS` |
| Add new team-mode tool | `src/features/team-mode/tools/` + register in `tool-registry.ts` | Gated on `team_mode.enabled` |
| Reactive provider error recovery | `src/hooks/runtime-fallback/` | Distinct from `model-fallback` (proactive, chat.params) |
| External notifications | `src/openclaw/` | Bidirectional: outbound (event -> HTTP/shell), inbound (Discord/Telegram daemon) |
| Skill-embedded MCP | `src/features/skill-mcp-manager/` | Tier-3 MCPs (per-session, stdio + HTTP) |

---

## 20. Notes

**Logger:** writes `oh-my-opencode.log` to the OS temp dir (`os.tmpdir()`). Rotated at 50 MB; previous segments live at `.1` and `.2` (oldest dropped).

**Background tasks:** 5 concurrent per `${providerID}/${modelID}` key by default (configurable via `background_task.modelConcurrency` / `providerConcurrency`); FIFO queue when slots full.

**Plugin load timeout:** 10s for Claude Code plugin discovery.

**Model fallback:** per-agent chains in `src/shared/model-requirements.ts`. There is no single global priority.

**Two fallback systems:** `model-fallback` (proactive, chat.params, hardcoded chains) vs `runtime-fallback` (reactive, session.error, configurable per-category/agent).

**Config migration:** idempotent via `_migrations` tracking, atomic writes with timestamped backups.

**Build:** `bun build` (ESM) + `tsc --emitDeclarationOnly`, externals: `@ast-grep/napi`, `zod`.

**120 barrel `index.ts` files** establish module boundaries in `src/`.

**Architecture rules** enforced via `rules-injector` hook reading `.omo/rules/*.md`. As of v4.2.0 only `test-discipline.md` ships.

**Windows builds:** run on `windows-latest` (not cross-compiled) to avoid Bun segfaults.

**Platform binaries:** detect AVX2 + libc family at runtime, fallback to baseline if needed.

**IntentGate (`keyword-detector`):** classifies user intent (`ultrawork`/`ulw`, `search`, `analyze`, `team`) and injects mode-specific prompts.

**Hashline edit:** every `Read` output tagged with `LINE#ID` content hashes (chars from `ZPMQVRWSNKTXJBYH`); edits reject on hash mismatch. `NIBBLE_STR = "ZPMQVRWSNKTXJBYH"` in `packages/hashline-core/src/constants.ts`.

**zauc-mocks pattern:** 9 directories named `zauc-mocks-*` hold `mock.module()` setup that must load alphabetically before the tests that consume those mocked modules. The `zauc-` prefix is purely a sort-order hack for `bun:test` discovery.

**Test discipline meta-audits:** two files parse the entire codebase via TS compiler API and FAIL the suite when an architectural invariant is violated (`mock.module()` without restore, raw `session.promptAsync` outside the gate).

**Workspace migration:** Runtime state migrated from `.sisyphus/` to `.omo/`. Legacy `.sisyphus/` still exists during transition; `src/shared/legacy-workspace-migration.ts` copies it forward on first load.

**First-prompt watchdog:** `src/hooks/runtime-fallback/first-prompt-watchdog.ts` (206 LOC) detects subagent sessions producing no progress within 90s and triggers fallback/abort.

**ParentWakeNotifier:** Background-agent parent-wake state in `src/features/background-agent/parent-wake-notifier.ts` (587 LOC) with dependency-injected client and enqueue callback.

**Process cleanup:** Background-agent error handlers are log-only — no force-exit on transient errors. Opt out via `OMO_DISABLE_PROCESS_CLEANUP=1` env var.

**CI nuance:** PRs targeting `master` are hard-blocked — they MUST target `dev`. CI auto-commits schema changes on master push and creates a draft "next" release on dev push.

**Rules files** (auto-injected by rules-injector hook): `.omo/rules/`, `.claude/rules/`, `.cursor/rules/`, `.github/instructions/`, `.github/copilot-instructions.md`, `.mdc` files.

---

## 21. Closing

This document covers the oh-my-openagent plugin (Hecateq fork, v4.2.0, dev@39aadbf9f) as a comprehensive developer reference. The plugin extends OpenCode with 12 agents, 54-61 lifecycle hooks, 20-39 tools across config gates, a 3-tier MCP system, Team Mode for parallel coordination, 25 feature modules, and the Hecateq orchestration pipeline with file-based memory and structured handoff protocol. The architecture enforces strict invariants around agent ordering (Hecateq-orchestrator -> Sisyphus -> Hephaestus -> Prometheus -> Atlas), content-hash verified editing (LINE#ID with `ZPMQVRWSNKTXJBYH` alphabet), prompt-async-gate discipline for session safety, and two independent fallback systems for model resilience. Test discipline mandates single-process `bun test` runs, given/when/then style, and no setTimeout-based synchronization. The codebase is undergoing a multi-harness Agent OS refactor — refer to the ROADME.md for the latest structural changes before contributing.

---

**Reference links:**
- Source: `src/` (index.ts, create-plugin-module.ts, plugin-interface.ts, create-managers.ts, create-tools.ts, create-hooks.ts)
- Agents: `src/agents/` (builtin-agents.ts, types.ts, dynamic-agent-prompt-builder.ts)
- Tools: `src/tools/` (13 tool directories) + `src/plugin/tool-registry.ts`
- Hooks: `src/hooks/` (96 entries, 57 dirs) + `src/plugin/hooks/`
- MCP: `src/mcp/` (5 built-in MCPs) + `src/features/skill-mcp-manager/`
- Config: `src/config/schema/` (30 Zod v4 files) + `src/plugin-config.ts`
- CLI: `src/cli/` (cli-program.ts, install/, run/, doctor/, mcp-oauth/)
- Features: `src/features/` (25 modules)
- OpenClaw: `src/openclaw/`
- Memory: `.opencode/state/memory/`
- Team Mode: `src/features/team-mode/`
- Orchestration: `src/features/hecateq-orchestration/`
- Shared: `src/shared/` (297 utility files)
- Docs: `docs/guide/`, `docs/reference/`, `docs/hecateq/`
