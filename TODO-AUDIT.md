# TODO-AUDIT: Unfinished Work, Placeholders & Drift

**Generated:** 2026-05-27  
**Scope:** Hecateq OpenAgent fork (`@hecateq/hecateq-openagent`, based on oh-my-openagent v4.2.x)  
**Purpose:** Categorize everything that is still TODO, intentionally deferred, or stale — so the next orchestration pass knows where to start.

---

## 1. Root Cause: Placeholder Memory Files

### 1.1 The Bootstrap Template Problem

The canonical source of placeholder memory files is **`src/shared/memory-bootstrap.ts`**, lines 43–159. The `FILE_TEMPLATES` record defines literal template content for all 8 project memory files. Every template has the same structure:

```
# {Title}
Last updated: TODO
## {Section}
- TODO
```

Every heading block ends with `- TODO`. The `Last updated:` lines literally contain the string `TODO`. This means **any fresh project gets 8 files that are 100% placeholder content**, and the system immediately knows they are placeholders because the detection logic exists right alongside.

### 1.2 Placeholder Detection Infrastructure (3 Files)

| File | Role |
|------|------|
| `src/shared/memory-manifest.ts` (lines 448–493) | `detectPlaceholderContent()` — parses every line; returns `true` when only headings, `- TODO` lines, and `Last updated: TODO` lines exist. Sets `is_placeholder: true` in the manifest. |
| `src/hooks/hecateq-project-context-injector/index.ts` (lines 194–208) | `normalizeMemoryContent()` — when "expanded" mode encounters a file where every non-heading line contains "TODO", it emits `[template placeholder omitted]` instead of the raw content. |
| `src/shared/memory-bootstrap.ts` (lines 43–159) | `FILE_TEMPLATES` — the source of truth for what a placeholder looks like. |

The detection patterns are defined at:

```
// memory-manifest.ts:448
const LAST_UPDATED_TODO_PATTERN = /Last\s+updated:\s*TODO/i

// memory-manifest.ts:458-468 — non-TODO lines must be headings, "- TODO", or "Last updated:"
```

### 1.3 Stale Documentation

**`docs/hecateq/memory-system.md`** — 287 lines, last generated 2026-05-20. Describes:

- A `known-issues.md` file that does not exist in `FILE_TEMPLATES` (the actual bootstrap has `quality-history.md` and `risk-profile.md` instead)
- `memory-manifest.json` and `memory-pointer.json` at paths that do not match the actual code (bootstrap produces `.memory-manifest.json` as a *repo-root pointer*, not inside `.opencode/`)
- Directory layout `.opencode/memory/knowledge/context/` which is **different** from the actual `.opencode/state/memory/` layout
- Manifest v1 with simpler fields, but the actual code has already shipped `MEMORY_MANIFEST_SCHEMA_VERSION = 2` (line 16 of `memory-manifest.ts`)
- No mention of `quality-history.md`, `risk-profile.md`, or `agent-routing.md` — these 3 files exist in `PROJECT_MEMORY_FILES` but the doc still lists only `active-context.md`, `progress.md`, `decisions.md`, and `known-issues.md`

### 1.5 Current Memory File Status (Not All Placeholder)

The `.opencode/state/memory/` files as of this audit are **mostly populated**:

| File | Status | Depth |
|------|--------|-------|
| `active-context.md` | Populated | 21 lines, current goal + state + constraints |
| `progress.md` | Populated | 25 lines, 16 completed items + 4 remaining |
| `tasks.md` | Populated | 22 lines, 5 pending + 7 done items |
| `decisions.md` | Populated | 20 lines, 8 accepted + 1 rejected + 2 notes |
| `file-map.md` | Populated (thin) | 17 lines, 5 paths + 2 entry points + 1 do-not-scan |
| `agent-routing.md` | Populated (thin) | 11 lines, 3 stable routing signals |
| `quality-history.md` | Populated (thin) | 12 lines, 1 check entry + 1 note |
| `risk-profile.md` | Populated (thin) | 16 lines, 3 high-risk areas + 2 mitigations |

The top 4 files are substantive. The bottom 4 have real content but are minimal — they are not "placeholders" in the technical sense (detectPlaceholderContent would return `false`), but are not yet comprehensive enough to replace the template.

---

## 2. Categorized Unfinished Work

### 2.1 Active Project Backlog (from Memory Files)

From **`.opencode/state/memory/progress.md`** (Remaining section):

| Item | File Reference |
|------|---------------|
| Tighten runtime execution/report fidelity for changed files and deeper resume semantics | progress.md:19 |
| Consider full end-to-end runtime adapter coverage beyond targeted CLI/manual verification | progress.md:22 |
| Decide whether broader internal prompt dispatch paths should adopt strict registered-agent resolution | progress.md:23 |
| Decide whether `tests/hashline/` should stay as a standalone harness or be archived/removed | progress.md:24 |
| Review public docs for wording accuracy before any beta publish | progress.md:25 |

From **`.opencode/state/memory/tasks.md`** (Pending section):

| Item | File Reference |
|------|---------------|
| Extend prompt gate shape-mismatch retry to more internal dispatch callsites | tasks.md:6 |
| Persist richer changed-file evidence from real OpenCode sessions | tasks.md:7 |
| Second-pass DAG test consolidation (if smaller test file count desired) | tasks.md:8 |
| Trim non-public upstream docs for cleaner Hecateq docs set beyond README + `docs/hecateq/` | tasks.md:9 |
| Decide whether `hecateq.orchestrator` should govern prompt-shape branching | tasks.md:10 |

From **`.opencode/state/memory/active-context.md`** (Known Risks):

| Item | File Reference |
|------|---------------|
| `src/plugin-handlers/agent-priority-order.test.ts` expects old 4-agent canonical order — fails | active-context.md:20 |
| `src/shared` and `src/tools/delegate-task` contain unrelated pre-existing test failures | active-context.md:21 |

From **`.opencode/state/memory/risk-profile.md`**:

| High-Risk File | Risk |
|----------------|------|
| `src/features/hecateq-orchestration/orchestration-controller.ts` | Central pipeline, runtime critical |
| `src/features/hecateq-orchestration/execution-planner.ts` | Batch ordering, agent assignment |
| `src/cli/hecateq/run.ts` | Real execution spawning |

### 2.2 Actionable Code TODOs

**`src/features/hook-message-injector/injector.ts`** (line 68):
```typescript
// TODO: These SDK-based functions are exported for future use when hooks migrate to async.
```
A forward-looking TODO for an architectural migration that has not started. The functions (`convertSDKMessageToStoredMessage`, etc.) are already implemented and exported but only intended for async-future use.

**`src/shared/mock-module-lifecycle-audit.test.ts`** (11 TODOs):
Every entry in `MOCK_MODULE_LIFECYCLE_ALLOWLIST` (lines 9–65) is marked `TODO(MOCK-MODULE-AUDIT)` and carries a justification like `"legacy mock.module call predates audit"`. These cover:
- `team-mode/team-mailbox/inbox.test.ts`
- `cli/doctor/checks/dependencies.test.ts`
- `hooks/session-recovery/index.test.ts`
- `hooks/auto-update-checker/hook.test.ts`
- 7 `shared/tmux/tmux-utils/*.test.ts` files

This is a **legacy test hygiene debt**: `mock.module()` calls exist without `afterEach` cleanup, and the audit allowlist is a temporary bypass. Each `TODO(MOCK-MODULE-AUDIT)` explicitly says "add cleanup."

**`src/features/dashboard/api-server.ts`** (lines 21–24):
```typescript
const NOT_IMPLEMENTED = (endpoint: string) => new Response(
  JSON.stringify({ error: { code: "NOT_IMPLEMENTED", ... } }),
  { status: 501, ... }
)
```
The dashboard API server has an MVP-only route table. Unknown paths return 501. This is by design for the current phase but represents unfinished surface area (DAG, signals, delegations, spawns, and history endpoints are only partially wired through the snapshotter).

### 2.3 Deferred Strategic Decisions (from ROADMAP.md)

| Decision | Status | Source |
|----------|--------|--------|
| Package layering refactor (Core → Adapter → Platform) | **Extraction started, 7 Core packages done.** `pi-extensions` and `codex-plugins` not migrated. | ROADMAP.md:22–51 |
| `lsp-core` extraction | **Deferred** pending submodule strategy | ROADMAP.md:48 |
| Pi Engine DI abstraction | **Deferred** until adapter migration is complete | ROADMAP.md:51 |
| Multi-harness support (Claude Code, Codex, Pi, Amp, Droid) | **Exploratory only.** Codebase is strongly coupled to OpenCode. | ROADMAP.md:66–76 |
| Grand unified plugin interface | **Non-goal** (explicitly rejected) | ROADMAP.md:92 |
| Human-readable file organization | **Deprioritized** in favor of agent loop performance | ROADMAP.md:93 |

### 2.4 Sidebar: OpenCode-Native Abstraction Skepticism

The ROADMAP is explicit (lines 73–76): *"Premature 'adapter pattern' abstraction across unstable interfaces causes more pain than duplication."* This is not a TODO — it is an intentional architectural position. Worth noting because it explains why some potentially abstracted patterns (plugin interface, hook layer across harnesses) remain concrete.

### 2.5 "Needs Verification" Items (from docs/hecateq/features.md)

From **`docs/hecateq/features.md`**, lines 269–271:

| Feature | Status Label | Evidence |
|---------|-------------|----------|
| Dynamic context pruning | **Needs verification** | Schema exists at `src/config/schema/dynamic-context-pruning.ts` (53 lines, 4 sub-fields, full Zod types). Implementation used in `src/hooks/anthropic-context-window-limit-recovery/deduplication-recovery.ts` (line 29 reads `experimental?.dynamic_context_pruning`). **Has real consumers but unclear if full feature is wired.** |
| New task system | **Needs verification** | Config-gated via `new_task_system_enabled` (schema: `oh-my-opencode-config.ts:35`). Has real integration hooks: `src/hooks/tasks-todowrite-disabler/` disables TodoWrite when task system is active. 4 tools exist (`task_create`, `task_get`, `task_list`, `task_update`). **Wired but undocumented as a full feature.** |
| Plugin load timeout | **Needs verification** | Config field `experimental.plugin_load_timeout_ms` exists in schema. Not clear if actively enforced or a placeholder config path. |

### 2.6 Known Deferred Issues (from docs/reference/known-issues.md)

| Issue | Status | Note |
|-------|--------|------|
| BLOCKER-4: Delegate-task early-failure-fallback | **Deferred** (reland planned) | Issue #4059 tracks reland with stabilized regression coverage |
| #4225: Custom LSP config silently ignored | **Open** | After LSP→MCP migration, custom LSP config in project JSONC is not applied |

### 2.7 Experimental Features (from Hecateq Feature Table in README)

The entire Hecateq specific layer is marked **Experimental** (14 items):

| Feature | Lines in Feature Table |
|---------|----------------------|
| Orchestration pipeline (8 sub-components) | features.md:179–189 |
| Memory system (7 sub-components) | features.md:191–201 |
| Agent indexer (4 sub-components) | features.md:206–210 |
| Handoff system (5 sub-components) | features.md:213–220 |
| CLI commands (5 commands) | features.md:169–175 |
| Config schema (9 sub-configs) | features.md:225–235 |

These are not "incomplete" — they have real implementations. The Experimental label means API-breakage risk.

---

## 3. Distinctions

### 3.1 Template Placeholders vs Real Content

What **is** a template placeholder:
- The `FILE_TEMPLATES` strings in `memory-bootstrap.ts` (8 templates, ~100 lines total)
- Any freshly-bootstrapped project memory directory where `detectPlaceholderContent()` returns `true`
- The conceptual 0-state of the memory system before a session writes to it

What **is not** a template placeholder (but might appear so on first glance):
- The current `.opencode/state/memory/*.md` files — all 8 have real content
- `agent-routing.md` (11 lines) and `quality-history.md` (12 lines) are populated, just thin

### 3.2 Real Engineering Backlog

Items that block a release or degrade reliability:
- BLOCKER-4 reland (known-issues.md)
- Pre-existing test failures in `src/plugin-handlers`, `src/shared`, `src/tools/delegate-task` (active-context.md:20–21)
- 11 `TODO(MOCK-MODULE-AUDIT)` cleanup items (mock-module-lifecycle-audit.test.ts)
- `#4225` LSP config silent drop (known-issues.md)

### 3.3 Deferred Strategic Decisions

Items that are intentional choices, not oversights:
- Package layering refactor mid-flight — PI/Codex adapter migration is deferred by design
- LSP-core extraction deferred to submodule strategy
- Multi-harness abstraction — deliberately not started
- Dashboard API surface — MVP-only by design (NOT_IMPLEMENTED endpoint)
- Hook message injector async migration — SDK-based functions await a future architectural shift

### 3.4 Docs Drift / Outdated Documentation

| Doc | Stale Content | Current Reality |
|-----|---------------|-----------------|
| `docs/hecateq/memory-system.md` | Mentions `known-issues.md`, paths under `.opencode/memory/knowledge/context/`, manifest v1 with simple fields | Actual: `quality-history.md` and `risk-profile.md`, paths under `.opencode/state/memory/`, schema v2 with project identity + discovery + resume blocks |
| `docs/hecateq/features.md` | Claims agent indexer is 1681 lines (line 208) | May have changed since last edit |
| `README.md` | The "Memory System" directory listing shows `known-issues.md` | Not a file; the actual files are listed in `PROJECT_MEMORY_FILES` |

### 3.5 Test/Demo/Example-Only TODO Usage (Not Actual Backlog)

These use "TODO" in prompts, instructions, or test data but are **not** engineering backlog:

| File | Context | Why Not Backlog |
|------|---------|-----------------|
| `src/hooks/atlas/system-reminder-templates.ts` | `Grep for TODO, FIXME, HACK` | This is agent instruction text telling Atlas to scan for TODOs — not a TODO itself |
| `src/hooks/keyword-detector/ultrawork/` (4 files) | "TODO List Structure", "TODO: Track EVERY step" | These are ultrawork mode meta-instructions about how an agent should use todowrite |
| `src/agents/atlas/*-prompt-sections.ts` (4 files) | "TODO LIST: [path]" | Atlas system prompt templates that describe how to write TODOs |
| `src/features/builtin-skills/skills/review-work.ts:430` | "Look for TODO/FIXME/HACK comments" | Review skill instruction — tells the reviewer to check for TODOs |
| `src/tools/delegate-task/constants.ts:206` | "## TODO List (ADD THESE)" | Prompt template telling the agent to create TODOs for delegation waves |
| `src/shared/memory-summarizer.ts` | Patterns for `Last updated: TODO` and `- TODO` | These are parse-time detection patterns for placeholder content, not TODOs |

---

## 4. Prioritized Next Steps

### Wave 1 — Reliability (Do First)

| # | Action | Target | Why |
|---|--------|--------|-----|
| 1 | Reland BLOCKER-4 with stabilized regression coverage | `src/hooks/runtime-fallback/` | Documented blocker, tracked in #4059 |
| 2 | Add `afterEach` cleanup for 11 allowlisted `mock.module()` calls | `src/shared/mock-module-lifecycle-audit.test.ts` | 11 explicit TODOs, low risk, mechanical fix |
| 3 | Fix pre-existing test failures in `src/plugin-handlers` | `agent-priority-order.test.ts` | Actively reported as known risk in active-context.md |

### Wave 2 — Documentation Hygiene

| # | Action | Target | Why |
|---|--------|--------|-----|
| 4 | Align `docs/hecateq/memory-system.md` with current bootstrap paths and file list | `docs/hecateq/memory-system.md` | Actively misleading (wrong paths, wrong files, wrong manifest version) |
| 5 | Verify and resolve the 3 "Needs verification" items | dynamic context pruning, new task system, plugin load timeout | Unknown status is a risk |

### Wave 3 — Memory System Maturation

| # | Action | Target | Why |
|---|--------|--------|-----|
| 7 | Thicken `agent-routing.md`, `quality-history.md`, `file-map.md`, `risk-profile.md` with more entries | `.opencode/state/memory/` | Currently functional but thin — better content reduces agent token burn on discovery |
| 8 | Decide and implement richer changed-file evidence persistence | orchestration report layer | Explicitly in progress (progress.md:19) |

### Wave 4 — Strategic

| # | Action | Target | Why |
|---|--------|--------|-----|
| 9 | Resolve `tests/hashline/` standalone-harness decision | `tests/hashline/` | Listed as undecided in progress.md |
| 10 | Continue package layering: migrate `pi-extensions` and `codex-plugins` to consume Core packages | `packages/` | Mid-flight refactor with deferred adapters |

---

## 5. Files Referenced in This Audit

| File | Role in Audit |
|------|---------------|
| `src/shared/memory-bootstrap.ts` | Source of placeholder templates + bootstrap logic |
| `src/shared/memory-manifest.ts` | Placeholder detection + manifest schema v2 |
| `src/hooks/hecateq-project-context-injector/index.ts` | Placeholder-aware context injection |
| `docs/hecateq/memory-system.md` | Stale documentation (wrong paths, wrong files) |
| `.opencode/state/memory/progress.md` | Current project backlog (remaining items) |
| `.opencode/state/memory/tasks.md` | Current project pending tasks |
| `.opencode/state/memory/decisions.md` | Architectural decisions |
| `.opencode/state/memory/active-context.md` | Current goal + known risks |
| `.opencode/state/memory/risk-profile.md` | High-risk areas |
| `.opencode/state/memory/file-map.md` | Project file map |
| `.opencode/state/memory/agent-routing.md` | Agent routing history |
| `.opencode/state/memory/quality-history.md` | Quality check history |
| `src/features/hook-message-injector/injector.ts` | TODO for future async migration |
| `src/shared/mock-module-lifecycle-audit.test.ts` | 11 TODO(MOCK-MODULE-AUDIT) items |
| `src/features/dashboard/api-server.ts` | MVP-only API (NOT_IMPLEMENTED paths) |
| `ROADMAP.md` | Deferred strategic decisions |
| `docs/hecateq/features.md` | "Needs verification" status items |
| `docs/reference/known-issues.md` | Deferred known issues |
| `src/config/schema/dynamic-context-pruning.ts` | Full schema, unclear implementation status |
| `src/config/schema/oh-my-opencode-config.ts` | `new_task_system_enabled` config field |
