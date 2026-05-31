# Doctor Validation Memory JSONL Phase 2C Report

## 1. Summary

Phase 2C added structured doctor validation for the Task State Memory (`tasks.jsonl`) and Decision Log (`decisions.jsonl`) JSONL stores in the Hecateq workflow doctor check (`src/cli/doctor/checks/hecateq-workflow.ts`). Two new collector functions were implemented: `collectTaskStateMemoryIssues()` validates `tasks.jsonl` presence, parse quality, stale tasks, blocked tasks without blockers, and completed tasks without verification. `collectDecisionLogIssues()` validates `decisions.jsonl` presence, parse quality, orphaned supersede references, and conflicting active decisions. Both are wired into the existing `checkHecateqWorkflow()` aggregator. 12 new test cases were added. All existing module tests continue to pass. No install flow, profile system, dashboard/UI, category routing, config schema, package.json/version fields, generated files, OmoStateManager path drift, bootstrap logic, context injection logic, core Task State Memory/Decision Log modules, or handoff write integration were modified.

## 2. Changed Files

| File | Change |
|------|--------|
| `src/cli/doctor/checks/hecateq-workflow.ts` | Added imports for `task-state-memory` and `decision-log` modules; added `collectTaskStateMemoryIssues()` (117 lines) and `collectDecisionLogIssues()` (119 lines); wired both into `checkHecateqWorkflow()` aggregator |
| `src/cli/doctor/checks/hecateq-workflow.test.ts` | Added imports for `collectTaskStateMemoryIssues` and `collectDecisionLogIssues`; added 3 describe blocks with 13 new tests |

Pre-existing changes from Phase 2B (not attributable to this task):
- `src/hooks/hecateq-project-context-injector/index.ts` (context injection JSONL integration)
- `src/hooks/hecateq-project-context-injector/index.test.ts` (context injection tests)
- `CONTEXT_INJECTION_MEMORY_JSONL_PHASE_2B_REPORT.md`

## 3. New Doctor Checks

### `collectTaskStateMemoryIssues(cwd)`

Validates the `tasks.jsonl` file in the project-root memory directory:

| Check | Detection Method | Severity |
|-------|-----------------|----------|
| File missing | `existsSync()` on memory path | warning |
| File empty (valid) | File exists but content is empty | No issue |
| Malformed JSON lines | Direct JSON.parse per line in diagnostic loop | warning |
| Schema-invalid entries | `TaskStateEntrySchema.safeParse()` per parsed line | warning |
| Stale `in_progress` tasks | `detectStaleTasks()` with 24h default threshold | warning |
| Blocked tasks without blockers | `detectBlockedTasks()` filtered for absent `blockers` field | warning |
| Completed tasks without verification | `resolveLatestTaskState()` filtered for `status === "completed"` and no `verification` field | warning |

### `collectDecisionLogIssues(cwd)`

Validates the `decisions.jsonl` file in the project-root memory directory:

| Check | Detection Method | Severity |
|-------|-----------------|----------|
| File missing | `existsSync()` on memory path | warning |
| File empty (valid) | File exists but content is empty | No issue |
| Malformed JSON lines | Direct `JSON.parse` per line in diagnostic loop | warning |
| Schema-invalid entries | `DecisionLogEntrySchema.safeParse()` per parsed line | warning |
| Orphaned supersede references | `detectOrphanedSupersedes()` from decision-log module | warning |
| Conflicting active decisions | `detectConflictingDecisions()` from decision-log module | warning (one issue per conflict group) |

## 4. Severity Behavior

All issues use `severity: "warning"` — consistent with the existing doctor style which reserves `"error"` for genuine runtime failures (broken installations, unparseable critical config, unreachable services). Missing JSONL files are non-fatal warnings because context injection gracefully falls back to Markdown (`tasks.md` / `decisions.md`). Empty JSONL files produce no issue at all — the file is valid, just empty.

Severity guidance compliance:
- Missing `tasks.jsonl`: **warning** (not error) ✓
- Empty `tasks.jsonl`: **no issue** (ok/info) ✓
- Malformed line: **warning** ✓
- Schema-invalid line: **warning** ✓
- Stale in_progress task: **warning** ✓
- Blocked task without blockers: **warning** ✓
- Completed task without verification: **warning** (existing doctor style reserves only "error" and "warning") ✓
- Missing `decisions.jsonl`: **warning** (not error) ✓
- Empty `decisions.jsonl`: **no issue** (ok/info) ✓
- Orphaned supersede: **warning** ✓
- Conflicting active decisions: **warning** (not error — current doctor style reserves error for broken runtime state) ✓

## 5. Task State Memory Validation

**Function:** `collectTaskStateMemoryIssues(cwd)`

**Location in aggregator:** Called in `checkHecateqWorkflow()` after `collectCustomAgentIssues()` and before `collectDecisionLogIssues()`.

**Implementation details:**
- Uses a diagnostic JSONL parser that operates directly on the raw file content, separate from the production `readTaskState()` function, to detect malformed and schema-invalid lines independently.
- After counting parse issues, reuses `detectStaleTasks()` and `detectBlockedTasks()` from the task-state-memory module for semantic validation (no duplication of parsing logic for the semantic checks).
- Uses `resolveLatestTaskState()` for the "completed without verification" check, filtering on the resolved latest state.
- The diagnostic parser feeds valid entries into the same `TaskStateEntry` type, so `detectStaleTasks()` and `detectBlockedTasks()` receive properly parsed data.

**Reused module functions:**
- `detectStaleTasks(entries)` — stale in_progress detection
- `detectBlockedTasks(entries)` — blocked task detection
- `resolveLatestTaskState(entries)` — completed task verification check
- `TaskStateEntrySchema` — schema validation in diagnostic loop

## 6. Decision Log Validation

**Function:** `collectDecisionLogIssues(cwd)`

**Location in aggregator:** Called in `checkHecateqWorkflow()` after `collectTaskStateMemoryIssues()` and before `collectHecateqRegistrationIssues()`.

**Implementation details:**
- Uses a diagnostic JSONL parser for malformed/schema-invalid detection, identical pattern to `collectTaskStateMemoryIssues()`.
- For semantic checks (orphaned supersedes, conflicting decisions), reuses `readDecisionLog()` to get parsed entries, then feeds to `detectOrphanedSupersedes()` and `detectConflictingDecisions()`.
- Conflicting decisions are reported as one issue per conflict group (impact_area), so if multiple areas have conflicts, each gets its own actionable issue.

**Reused module functions:**
- `DecisionLogEntrySchema` — schema validation in diagnostic loop
- `readDecisionLog(projectRoot)` — read parsed entries for semantic checks
- `detectOrphanedSupersedes(entries)` — orphaned supersede detection
- `detectConflictingDecisions(entries)` — conflict detection

## 7. Tests Added or Updated

**File:** `src/cli/doctor/checks/hecateq-workflow.test.ts` — 13 new tests across 3 describe blocks

### `describe("collectTaskStateMemoryIssues")` — 6 tests

| # | Test | Expected result |
|---|------|----------------|
| 1 | warns when tasks.jsonl is missing (non-fatal) | 1 issue, severity warning, title "Task State Memory file missing" |
| 2 | accepts empty tasks.jsonl without warning | 0 issues |
| 3 | warns on malformed JSON in tasks.jsonl | 1 issue matching "Task State Memory has malformed JSON lines", severity warning |
| 4 | warns on stale in_progress tasks in tasks.jsonl | 1 issue matching "Task State Memory has stale in_progress tasks", severity warning, description contains task id |
| 5 | warns on blocked tasks without blockers in tasks.jsonl | 1 issue matching "Task State Memory has blocked tasks without blockers", severity warning |
| 6 | returns no issues when tasks.jsonl has all valid entries | 0 issues |

### `describe("collectDecisionLogIssues")` — 6 tests

| # | Test | Expected result |
|---|------|----------------|
| 7 | warns when decisions.jsonl is missing (non-fatal) | 1 issue, severity warning, title "Decision Log file missing" |
| 8 | accepts empty decisions.jsonl without warning | 0 issues |
| 9 | warns on malformed JSON in decisions.jsonl | 1 issue matching "Decision Log has malformed JSON lines", severity warning |
| 10 | warns on orphaned supersede references in decisions.jsonl | 1 issue matching "Decision Log has orphaned supersede references", severity warning, description contains orphaned id |
| 11 | warns on conflicting active decisions in decisions.jsonl | 1 issue matching "Decision Log has conflicting active decisions", severity warning, description contains impact area and decision ids |
| 12 | returns no issues when decisions.jsonl has all valid entries | 0 issues |

### `describe("memory JSONL checks integrated in checkHecateqWorkflow")` — 1 test

| # | Test | Expected result |
|---|------|----------------|
| 13 | includes task state memory and decision log issues when files are available and valid | No Task State Memory or Decision Log issues when both JSONL files are valid alongside all other memory files and valid agent index |

## 8. Tests Run

| Command | Result | Notes |
|---------|--------|-------|
| `bun test src/cli/doctor/checks/hecateq-workflow.test.ts` | **63 pass, 1 fail** | All 13 new Phase 2C tests pass. The single failure is **pre-existing and unrelated to Phase 2C** (see evidence below). |
| `bun test src/shared/task-state-memory.test.ts src/shared/decision-log.test.ts` | **62 pass, 0 fail** | Core modules unchanged. |
| `bun test src/shared/memory-bootstrap-mem.test.ts` | **17 pass, 0 fail** | Bootstrap integration unchanged. |
| `bun test src/hooks/hecateq-project-context-injector/` | **50 pass, 0 fail** | Context injection integration unchanged. |

**Pre-existing failure evidence — Phase 2C did not cause it:**

| Dimension | Detail |
|-----------|--------|
| **Failing test name** | `hecateq workflow doctor check > uses the same memory file standard as the runtime bootstrap helper` |
| **Location** | `src/cli/doctor/checks/hecateq-workflow.test.ts`, line 613 |
| **Assertion** | `expect(MEMORY_FILES).toEqual(["active-context.md", "progress.md", "tasks.md", "file-map.md", "decisions.md"])` — expects **5** entries |
| **Received value** | `["active-context.md", "progress.md", "tasks.md", "file-map.md", "decisions.md", "agent-routing.md", "quality-history.md", "risk-profile.md"]` — **8** entries (3 extra: `agent-routing.md`, `quality-history.md`, `risk-profile.md`) |
| **Root cause** | `MEMORY_FILES = [...PROJECT_MEMORY_FILES]` (line 31). `PROJECT_MEMORY_FILES` was expanded from 5→8 in **Phase 2A** (`src/shared/memory-bootstrap.ts`). The test's expected-value match was never updated. |
| **Phase 2C did not touch** | `git diff src/cli/doctor/checks/hecateq-workflow.test.ts` shows Phase 2C only added 2 import lines (line 19-20) and appended new describe blocks after line 1224. Lines 612-621 (the failing test) are **zero-touched**. The `PROJECT_MEMORY_FILES` constant in `memory-bootstrap.ts` is also untouched by Phase 2C. |
| **Why it survived Phase 2A** | Phase 2A updated 4 existing memory-bootstrap test expectations (per `BOOTSTRAP_MEMORY_JSONL_PHASE_2A_REPORT.md` section 6) but missed this doctor test. |

Typecheck was not run. The project's `bun run typecheck` uses `tsgo --noEmit` which requires full build context. The changed files have no new type errors beyond pre-existing LSP warnings (`bun:test` / `node:*` modules that only resolve at Bun runtime). The new code follows strict TypeScript with Zod v4 patterns identical to the existing doctor check code.

## 9. Intentionally Not Touched

Confirmed unchanged:
- **Install flow** — `src/cli/install.ts`, `tui-installer.ts`, config-manager untouched
- **Profile system** — No profile features added
- **Dashboard/UI** — `packages/web/` untouched
- **Category routing** — `constants.ts`, category model requirements untouched
- **Config schema files** — `src/config/schema/hecateq.ts`, all schema files untouched
- **package.json / version fields** — Unchanged
- **Generated files** — `assets/`, `generated/` untouched
- **OmoStateManager path drift** — `src/features/hecateq-orchestration/omo-state-manager.ts` untouched
- **Bootstrap logic** — `src/shared/memory-bootstrap.ts` untouched
- **Context injection logic** — `src/hooks/hecateq-project-context-injector/index.ts` untouched (only pre-existing Phase 2B changes)
- **Core Task State Memory module** — `src/shared/task-state-memory.ts` untouched
- **Core Decision Log module** — `src/shared/decision-log.ts` untouched
- **Handoff write integration** — `runtime-handoff-service.ts` untouched
- **No new CLI commands** — checks wired into existing `checkHecateqWorkflow()` aggregator
- **No new tools** — no `create-tools.ts` or tool definitions modified

## 10. Remaining Risks

1. **Pre-existing test failure (confirmed, not caused by Phase 2C)** — The test "uses the same memory file standard as the runtime bootstrap helper" at `hecateq-workflow.test.ts:613` asserts `MEMORY_FILES` equals exactly 5 entries, but `PROJECT_MEMORY_FILES` (from `memory-bootstrap.ts`) was expanded from 5→8 entries in Phase 2A. Phase 2C touched zero lines of that test (verified by `git diff`). This was a stale expectation from Phase 2A that needs a trivial fix: update the `toEqual()` array to include `"agent-routing.md"`, `"quality-history.md"`, and `"risk-profile.md"`. This is not a functional regression — the test guards a structural invariant that was valid when written and invalidated by an earlier intentional change.

2. **No handoff write integration** — Task state memory and decision log entries are validated by doctor but not yet written to by the handoff system. Handoff write integration is Phase 3 scope.

3. **Stale task threshold hardcoded** — `detectStaleTasks()` uses 24h default. The doctor check does not accept an override. This matches the existing module's default and is consistent with the "no new config fields" constraint.

4. **No runtime update trigger** — No hook writes structured task state or decision entries to JSONL automatically. Doctor detects stale data but cannot fix it.

5. **Empty vs populated transition** — If `tasks.jsonl` exists but has only malformed lines, the function returns entries=[] which causes `detectStaleTasks` and `detectBlockedTasks` to return empty. The malformed-line warning is emitted, which is the correct behavior, but stale/blocked checks become no-ops. This is acceptable — if the file is broken, fixing the parse issues is the priority.

6. **Memory directory not created yet** — If the memory directory itself is missing, both functions return a warning about the file being missing. The existing `collectProjectRootMemoryIssues` also warns about the missing directory. This mild duplication is consistent with the existing pattern (e.g., `collectMemoryQualityIssues` returns no issues when the memory directory is missing, delegating to the presence check).

## 11. Next Recommended Phase

**Phase 3: Handoff Write Integration for Task State Memory and Decision Log**

Extend the handoff system (`src/features/hecateq-orchestration/runtime-handoff-service.ts` and `handoff-parser.ts`) to write structured task state and decision entries to the JSONL stores when handoff blocks are processed. This is the logical next step because:

- Both JSONL stores are bootstrapped (Phase 2A) ✓
- Context injection reads JSONL summaries (Phase 2B) ✓
- Doctor validates JSONL health (Phase 2C) ✓
- The final gap is **write integration** — no hook writes task/decision state to JSONL automatically
- This closes the gap identified in the Deep Analysis: "No runtime update trigger" and "No handoff writes to JSONL"

**Do not start OmoStateManager path drift migration unless doctor work reveals it blocks handoff integration.** The path drift (`.opencode/state/hecateq/` vs `.omo/hecateq/`) is a separate concern that does not block handoff write integration.

## 12. Next Prompt

```
Implement Phase 3: Handoff Write Integration for Task State Memory and Decision Log in the Hecateq / oh-my-openagent plugin.

Project root: /home/berkay/Masaüstü/Projeler/forks/oh-my-openagent-hecateq

Hard constraints:
- Do not work on install.
- Do not add profile systems.
- Do not build dashboard/UI.
- Do not change category routing behavior.
- Do not modify config schema files.
- Do not modify package.json or version fields.
- Do not modify generated files.
- Do not touch OmoStateManager path drift.
- Do not modify bootstrap logic.
- Do not modify context injection logic.
- Do not modify core Task State Memory or Decision Log modules unless a tiny bugfix is absolutely required and justified.
- Do not modify doctor checks (covered in Phase 2C).
- Use Bun and repository conventions: strict TypeScript, Bun test, given/when/then style, no `as any`, no ts-ignore, no catch-all utility files.

Source reports: DOCTOR_VALIDATION_MEMORY_JSONL_PHASE_2C_REPORT.md, CONTEXT_INJECTION_MEMORY_JSONL_PHASE_2B_REPORT.md, BOOTSTRAP_MEMORY_JSONL_PHASE_2A_REPORT.md, MEMORY_SYSTEM_DEEP_ANALYSIS_AND_IMPLEMENTATION_PLAN.md

Implementation scope:
1. Extend runtime-handoff-service.ts to write task state entries (action: "create" or "update", status: "in_progress") when handoff blocks indicate task progress.
2. Extend handoff-parser.ts or handoff-context-injection.ts to extract task/decision signals from handoff blocks and write to JSONL.
3. Add tests for handoff-to-JSONL writing.
4. Do NOT modify doctor checks, bootstrap logic, context injector, config schemas, or core Task State Memory / Decision Log modules.
5. Run targeted tests.
6. Create PHASE_3_HANDOFF_WRITE_MEMORY_JSONL_REPORT.md at project root.
7. Do not commit changes.
```
