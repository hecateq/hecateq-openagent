# Hecateq OpenAgent — Source Tree Map

This document maps the repository source tree for contributors.

---

## Top-Level Structure

```
oh-my-openagent-hecateq/
├── src/                          # Plugin source (~1314 files + 730 tests)
│   ├── index.ts                  # Plugin entry
│   ├── plugin-config.ts          # JSONC config loader
│   ├── plugin-interface.ts       # 11 OpenCode hook handlers
│   ├── plugin-state.ts           # Model cache state
│   ├── create-managers.ts        # Tmux, Background, SkillMCP, Config managers
│   ├── create-tools.ts           # Tool registry composition
│   ├── create-hooks.ts           # 5-tier hook composition
│   ├── create-runtime-tmux-config.ts
│   ├── agents/                   # 11 agent factories (104 files, ~20k LOC)
│   ├── hooks/                    # ~52 lifecycle hooks (596 files, ~78k LOC)
│   ├── tools/                    # 13 tool dirs (317 files, ~45k LOC)
│   ├── features/                 # 20 feature modules (404 files, ~71k LOC)
│   ├── shared/                   # 297 utility files (179 non-test)
│   ├── cli/                      # CLI commands (158 files, ~18k LOC)
│   ├── plugin/                   # 10 hook handlers + composition (58 files)
│   ├── config/                   # 30 Zod v4 schemas (41 files)
│   ├── plugin-handlers/          # 6-phase config pipeline (27 files)
│   ├── openclaw/                 # Discord/Telegram/HTTP integration (26 files)
│   ├── mcp/                      # 5 built-in MCPs (8 files)
│   └── testing/                  # Test utilities (3 files)
├── packages/                     # 11 platform binaries + MCP packages
│   ├── rules-engine/
│   ├── ast-grep-core/
│   ├── ast-grep-mcp/
│   ├── lsp-tools-mcp/            # (not in workspace array)
│   ├── utils/
│   ├── model-core/
│   ├── comment-checker-core/
│   ├── hashline-core/
│   ├── boulder-state/
│   ├── agents-md-core/
│   └── web/                      # Marketing site (Next.js 15)
├── bin/                          # Platform-detection JS shim
├── script/                       # Build/publish automation
├── docs/                         # User-facing docs
├── assets/                       # JSON Schema
├── .opencode/                    # Project skills + commands
└── .omo/                         # AI agent workspace
```

---

## Hecateq-Specific Source Map

### Config

| File | Description |
|------|-------------|
| `src/config/schema/hecateq.ts` | Hecateq config schema (341 lines, 9 sub-configs) |
| `src/config/schema/oh-my-opencode-config.ts` | Root schema including `hecateq` field |

### CLI

| File | Description |
|------|-------------|
| `src/cli/hecateq/plan.ts` | `hecateq plan` command (157 lines) |
| `src/cli/hecateq/run.ts` | `hecateq run` command (128 lines) |
| `src/cli/hecateq/resume.ts` | `hecateq resume` command (178 lines) |
| `src/cli/hecateq/status.ts` | `hecateq status` command (146 lines) |
| `src/cli/hecateq/doctor.ts` | `hecateq doctor` command (178 lines) |
| `src/cli/hecateq/runtime-adapter.ts` | OpenCode session adapter |
| `src/cli/hecateq/shared.ts` | Shared CLI utilities |
| `src/cli/hecateq/hecateq.test.ts` | Hecateq CLI tests |
| `src/cli/doctor/checks/hecateq-workflow.ts` | Hecateq workflow doctor checks |

### Hooks

| File | Description |
|------|-------------|
| `src/hooks/hecateq-memory-bootstrap/index.ts` | Memory bootstrap hook (119 lines) |
| `src/hooks/hecateq-memory-bootstrap/index.test.ts` | Bootstrap hook tests |
| `src/hooks/hecateq-project-context-injector/index.ts` | Project context injector hook (862 lines) |
| `src/hooks/hecateq-project-context-injector/index.test.ts` | Context injector tests |
| `src/hooks/memory-manifest-updater/index.ts` | Memory manifest updater hook |

### Orchestration Feature

| File | Description |
|------|-------------|
| `src/features/hecateq-orchestration/index.ts` | Barrel exports |
| `src/features/hecateq-orchestration/orchestration-controller.ts` | Central orchestrator (937 lines) |
| `src/features/hecateq-orchestration/types.ts` | All shared types (1054 lines) |
| `src/features/hecateq-orchestration/prompt-intake.ts` | Prompt analysis |
| `src/features/hecateq-orchestration/task-decomposer.ts` | Task splitting |
| `src/features/hecateq-orchestration/dependency-planner.ts` | DAG planner |
| `src/features/hecateq-orchestration/cycle-detector.ts` | Cycle detection |
| `src/features/hecateq-orchestration/agent-selector.ts` | Agent matching |
| `src/features/hecateq-orchestration/execution-planner.ts` | Execution planning |
| `src/features/hecateq-orchestration/quality-gate-runner.ts` | Quality gates |
| `src/features/hecateq-orchestration/repair-loop-controller.ts` | Repair loop |
| `src/features/hecateq-orchestration/final-report-generator.ts` | Report generation |
| `src/features/hecateq-orchestration/routing-policy-engine.ts` | Routing decisions |
| `src/features/hecateq-orchestration/delegation-controller.ts` | Delegation lifecycle |
| `src/features/hecateq-orchestration/delegation-executor.ts` | Delegation execution |
| `src/features/hecateq-orchestration/execution-adapter.ts` | Execution abstraction |
| `src/features/hecateq-orchestration/handoff-parser.ts` | Handoff parsing |
| `src/features/hecateq-orchestration/handoff-role-policy.ts` | Role validation |
| `src/features/hecateq-orchestration/handoff-context-injection.ts` | Context enrichment |
| `src/features/hecateq-orchestration/handoff-boulder-projection.ts` | Boulder sync |
| `src/features/hecateq-orchestration/signal-registry.ts` | Signal declarations |
| `src/features/hecateq-orchestration/signal-dag-executor.ts` | Signal DAG execution |
| `src/features/hecateq-orchestration/omo-state-manager.ts` | State persistence |
| `src/features/hecateq-orchestration/omo-migration.ts` | State migration |
| `src/features/hecateq-orchestration/runtime-handoff-service.ts` | Runtime handoff |
| `src/features/hecateq-orchestration/runtime-delegation-consumer.ts` | Runtime delegation |

### Shared Utilities

| File | Description |
|------|-------------|
| `src/shared/hecateq-agent-indexer.ts` | Agent indexer (1681 lines) |
| `src/shared/memory-bootstrap.ts` | Memory bootstrap utilities |
| `src/shared/memory-manifest.ts` | Memory manifest utilities |
| `src/shared/memory-continuation.ts` | Session continuation utilities |
| `src/shared/memory-resume.ts` | Session resume utilities |
| `src/shared/memory-lock.ts` | Concurrency guard |
| `src/shared/memory-path-discovery.ts` | Project root discovery |
| `src/shared/memory-summarizer.ts` | Content summarization |
| `src/shared/memory-manifest-updater.ts` | Manifest auto-update |
| `src/shared/git-checkpoint.ts` | Git checkpoint utilities |
| `src/shared/routing/routing-contract.ts` | Routing contract types |
| `src/shared/routing/routing-strategy.ts` | Routing strategies |
| `src/shared/routing/routing-result.ts` | Routing result types |
| `src/shared/routing/resolve-agent-target.ts` | Agent target resolution |
| `src/shared/routing/task-intent-classifier.ts` | Task intent classification |
| `src/shared/dependency-graph/resolver.ts` | Dependency graph resolver |
| `src/shared/dependency-graph/store.ts` | Dependency graph store |
| `src/shared/dependency-graph/types.ts` | Dependency graph types |

### Other Hecateq-Related Files

| File | Description |
|------|-------------|
| `src/features/autonomous-spawn/spawn-policy.ts` | Spawn policy for auto-spawn |
| `src/features/autonomous-spawn/spawn-rate-limiter.ts` | Spawn rate limiter |
| `src/features/autonomous-spawn/types.ts` | Auto-spawn types |
| `docs/hecateq-agent-index.md` | Agent index documentation |
| `docs/routing-truth.md` | Routing truth documentation |
| `docs/hecateq/` | Hecateq documentation directory |

---

## Upstream Core Source Map (inherited)

### Plugin Layer

| File | Description |
|------|-------------|
| `src/plugin/tool-registry.ts` | Tool registration |
| `src/plugin/hooks/create-session-hooks.ts` | 24 session hooks |
| `src/plugin/hooks/create-tool-guard-hooks.ts` | 16-17 tool guard hooks |
| `src/plugin/hooks/create-transform-hooks.ts` | 5-7 transform hooks |
| `src/plugin/hooks/create-continuation-hooks.ts` | 7 continuation hooks |
| `src/plugin/hooks/create-skill-hooks.ts` | 2 skill hooks |
| `src/plugin/chat-message.ts` | chat.message handler |
| `src/plugin/chat-params.ts` | chat.params handler |
| `src/plugin/event.ts` | Event handler |
| `src/plugin/messages-transform.ts` | Messages transform handler |
| `src/plugin/tool-definition.ts` | Tool definition handler |
| `src/plugin/tool-execute-before.ts` | Pre-tool handler |
| `src/plugin/tool-execute-after.ts` | Post-tool handler |
| `src/plugin/skill-context.ts` | Skill context builder |
| `src/plugin/available-categories.ts` | Category enumeration |
| `src/plugin/session-compacting.ts` | Session compaction handler |

### Agents

| File | Description |
|------|-------------|
| `src/agents/` | Agent factory files (104 files) |
| `src/agents/builtin-agents/` | Agent definition sub-files |
| `src/agents/dynamic-agent-prompt-builder.ts` | Dynamic prompt construction |

### Key Features

| File | Description |
|------|-------------|
| `src/features/team-mode/` | Team Mode (13k LOC) |
| `src/features/background-agent/` | Background task management |
| `src/features/boulder-state/` | Boulder work tracking |
| `src/features/skill-mcp-manager/` | Skill MCP lifecycle |
| `src/features/mcp-oauth/` | MCP OAuth 2.0 + PKCE + DCR |
| `src/features/builtin-skills/` | 10 built-in skills |
| `src/features/opencode-skill-loader/` | 4-scope skill discovery |
| `src/features/claude-code-plugin-loader/` | Plugin loading |
| `src/features/tmux-subagent/` | Tmux pane management |
| `src/features/context-injector/` | Context injection |
| `src/features/run-continuation-state/` | Run continuation state |

### Tools

| File | Description |
|------|-------------|
| `src/tools/grep/` | Full-text search |
| `src/tools/glob/` | File path search |
| `src/tools/session-manager/` | Session management (4 tools) |
| `src/tools/background-task/` | Background tasks (3 tools) |
| `src/tools/call-omo-agent/` | Subagent spawning |
| `src/tools/delegate-task/` | Task delegation |
| `src/tools/skill/` | Skill loading |
| `src/tools/skill-mcp/` | Skill MCP invocation |
| `src/tools/hashline-edit/` | Hashline edit |
| `src/tools/look-at/` | Media analysis |
| `src/tools/interactive-bash/` | Interactive bash |
| `src/tools/task/` | New task system |
| `src/tools/slashcommand/` | Slash command support |

### MCP

| File | Description |
|------|-------------|
| `src/mcp/websearch.ts` | Websearch MCP |
| `src/mcp/grep-app.ts` | grep-app MCP |
| `src/mcp/context7.ts` | Context7 MCP |
| `src/mcp/lsp.ts` | LSP MCP (stdio) |
| `src/mcp/ast-grep.ts` | AST-grep MCP (stdio) |

### Doctor Checks

| File | Description |
|------|-------------|
| `src/cli/doctor/checks/` | 15 check files in 4 categories |
| `src/cli/doctor/checks/system.ts` | Binary, plugin, version |
| `src/cli/doctor/checks/config.ts` | JSONC, Zod schema |
| `src/cli/doctor/checks/tools.ts` | AST-grep, LSP, GH CLI, MCP |
| `src/cli/doctor/checks/model-resolution.ts` | Cache, resolution, overrides |
| `src/cli/doctor/checks/hecateq-workflow.ts` | Hecateq workflow checks |

---

## Source File Counts (Approximate)

| Directory | .ts Files | Test Files | LOC |
|-----------|-----------|------------|-----|
| `src/` (root) | 13 | 13 | ~2k |
| `src/agents/` | 104 | 26 | ~20k |
| `src/hooks/` | 596 | 172 | ~78k |
| `src/tools/` | 317 | 110 | ~45k |
| `src/features/` | 404 | 188 | ~71k |
| `src/shared/` | 297 | 118 | ~33k |
| `src/cli/` | 158 | 42 | ~18k |
| `src/plugin/` | 58 | 6 | ~12k |
| `src/config/` | 41 | 16 | ~2k |
| `src/plugin-handlers/` | 27 | 0 | ~6k |
| `src/openclaw/` | 26 | 2 | ~3k |
| `src/mcp/` | 8 | 5 | ~260 |
| `src/testing/` | 3 | 0 | ~225 |
| `src/__tests__/` | 22 | 22 | ~300 |

**Total:** ~2074 .ts files (~730 tests), ~313k LOC
