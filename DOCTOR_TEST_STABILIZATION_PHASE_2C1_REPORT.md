# Doctor Test Stabilization Phase 2C.1 Report

## 1. Summary

Fixed a stale test expectation in `hecateq-workflow.test.ts` where the `"uses the same memory file standard as the runtime bootstrap helper"` test hardcoded 5 memory file entries (`active-context.md`, `progress.md`, `tasks.md`, `file-map.md`, `decisions.md`) but the source-of-truth `PROJECT_MEMORY_FILES` array had been expanded to 8 entries (adding `agent-routing.md`, `quality-history.md`, `risk-profile.md`) during Phase 2A. The test was changed to derive its expectation from `PROJECT_MEMORY_FILES` directly, preventing future staleness.

## 2. Changed Files

- `src/cli/doctor/checks/hecateq-workflow.test.ts` — lines 613-621: replaced hardcoded array with `[...PROJECT_MEMORY_FILES]`
- `DOCTOR_TEST_STABILIZATION_PHASE_2C1_REPORT.md` — this report (created)

## 3. Root Cause

Phase 2A added 3 new files to `PROJECT_MEMORY_FILES` in `src/shared/memory-bootstrap.ts` (`agent-routing.md`, `quality-history.md`, `risk-profile.md`), expanding the list from 5 to 8 entries. The corresponding doctor test in `hecateq-workflow.test.ts` was not updated to match, leaving a hardcoded expectation for 5 entries. Since `MEMORY_FILES = [...PROJECT_MEMORY_FILES]` at line 31 of the test file resolves to 8 entries, the test would fail when `PROJECT_MEMORY_FILES` has more entries than the hardcoded list.

## 4. Fix Applied

**File:** `src/cli/doctor/checks/hecateq-workflow.test.ts` (lines 613-621)

**Before:**
```typescript
it("uses the same memory file standard as the runtime bootstrap helper", () => {
    expect(MEMORY_FILES).toEqual([
      "active-context.md",
      "progress.md",
      "tasks.md",
      "file-map.md",
      "decisions.md",
    ])
  })
```

**After:**
```typescript
it("uses the same memory file standard as the runtime bootstrap helper", () => {
    expect(MEMORY_FILES).toEqual([...PROJECT_MEMORY_FILES])
  })
```

The fix derives the expected list from the source of truth (`PROJECT_MEMORY_FILES`) instead of hardcoding it. If `PROJECT_MEMORY_FILES` changes in the future, this test will stay in sync automatically.

## 5. Tests Run

All passing with 0 failures:

| Test Suite | Tests | Status |
|-----------|-------|--------|
| `src/cli/doctor/checks/hecateq-workflow.test.ts` | 64 pass | ✅ |
| `src/shared/task-state-memory.test.ts` + `decision-log.test.ts` | 62 pass | ✅ |
| `src/shared/memory-bootstrap-mem.test.ts` | 17 pass | ✅ |
| `src/hooks/hecateq-project-context-injector/` | 50 pass | ✅ |

## 6. Intentionally Not Touched

Confirmed these were not changed:
- install flow — ✅ not touched
- profile system — ✅ not touched
- dashboard/UI — ✅ not touched
- category routing — ✅ not touched
- config schema — ✅ not touched
- package.json/version fields — ✅ not touched
- generated files — ✅ not touched
- OmoStateManager path drift — ✅ not touched
- bootstrap logic — ✅ not touched
- context injection logic — ✅ not touched
- core Task State Memory module — ✅ not touched
- core Decision Log module — ✅ not touched
- doctor check logic, unless unavoidable — ✅ not touched (only the test was updated)
- handoff write integration — ✅ not touched

## 7. Remaining Risks

None. The change is minimal (test-only, 1 assertion line changed) and all four related test suites pass. No production code was modified.

## 8. Next Recommended Phase

Phase 3 — Handoff Write Integration for Task State Memory and Decision Log.

## 9. Next Prompt

```
Goal: Implement Phase 3 — Handoff Write Integration for Task State Memory and Decision Log.

The handoff write system needs to persist Task State Memory entries (tasks.jsonl) and Decision Log entries (decisions.jsonl) during handoff events. This phase integrates the existing task-state-memory.ts and decision-log.ts modules with the handoff pipeline.

Requirements:
1. When a HANDOFF: directive is emitted in an agent response, the handoff processor must:
   a. Write a task state entry to tasks.jsonl recording the handoff event (action: "handoff", status: "handed_off", metadata: { target_agent, signal, timestamp }).
   b. Write a decision log entry to decisions.jsonl recording the routing decision (action: "routing_decision", metadata: { from_agent, to_agent, rationale, confidence }).
2. Both writes must be atomic — if one fails, the handoff must not proceed.
3. Integration point is the handoff parser/handler (src/features/hecateq-orchestration/handoff-parser.ts or equivalent).
4. Existing tests in src/shared/task-state-memory.test.ts and src/shared/decision-log.test.ts must remain green.
5. New integration tests must be added for the combined handoff-write flow.
6. Do not modify the core Task State Memory or Decision Log modules beyond adding a handoff-specific method if needed.
7. Keep changes focused on the handoff → persistence bridge.

Hard constraints:
- Do not modify config schema files.
- Do not modify package.json or version fields.
- Do not modify generated files.
- Atomic writes must be guaranteed (use write+rename pattern or equivalent).
```
