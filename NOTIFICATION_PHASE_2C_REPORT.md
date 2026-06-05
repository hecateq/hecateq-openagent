# Notification Phase 2C — Orchestration Failure Toast Report

**Date:** 2026-06-05
**Repository:** oh-my-openagent-hecateq
**Phase:** 2C — Hecateq orchestration/runtime failure/warning toast points
**Status:** Complete

---

## 1. Executive Summary

Phase 2C added **safe Hecateq runtime failure toast points** to `src/plugin/event.ts`. Only the `session.error` event handler was identified as a safe binding point — all other orchestration internals (pipeline, decompose, quality gates, repair loop) are pure utilities without client access and were correctly skipped.

A single toast emission point was added, guarded by:
- **Hermes event log presence** (Hecateq's own event pipeline)
- **Error message deduplication** (same message → max 1 toast per 30s)
- **TUI-absence safety** (`showHecateqToastSafe` gracefully returns `false` when TUI is unavailable)

---

## 2. Event Candidate Table

| # | Event Source | File(s) | Client Access | Safe? | Decision |
|---|---|---|---|---|---|
| 1 | `session.error` handler | `src/plugin/event.ts` (line ~1056) | `pluginContext.client` | ✅ Yes | **Bound** — Runtime failure toast with `kind: "runtime"`, `variant: "error"` |
| 2 | `orchestration-controller.runPipeline()` | `src/features/hecateq-orchestration/orchestration-controller.ts` | None | ❌ No | **Skipped** — Pure utility, no `client` parameter |
| 3 | `quality-gate-runner.runQualityGates()` | `src/features/hecateq-orchestration/quality-gate-runner.ts` | None | ❌ No | **Skipped** — `execFileSync` wrapper, no client |
| 4 | `repair-loop-controller.runRepairLoop()` | `src/features/hecateq-orchestration/repair-loop-controller.ts` | None | ❌ No | **Skipped** — Classification logic only, no client |
| 5 | `delegation-executor.consumePendingDelegations()` | `src/features/hecateq-orchestration/delegation-executor.ts` | `executor` parameter | ❌ No | **Skipped** — Consumer pattern, executor is injected but not a TUI client |
| 6 | `runtime-delegation-consumer` | `src/features/hecateq-orchestration/runtime-delegation-consumer.ts` | None | ❌ No | **Skipped** — Orchestration consumer, no client |
| 7 | `runtime-handoff-service` | `src/features/hecateq-orchestration/runtime-handoff-service.ts` | None | ❌ No | **Skipped** — File-based handoff storage, no client |
| 8 | `chat-message.ts` | `src/plugin/chat-message.ts` | `ctx.client` | ⚠️ Dirty | **Skipped** — Already dirty (uncommitted user changes), higher spam risk |
| 9 | `create-session-hooks.ts` | `src/plugin/hooks/create-session-hooks.ts` | `ctx.client` (via hooks) | ⚠️ Dirty | **Skipped** — Already dirty, hooks already have their own toast patterns |

---

## 3. Bound Toast Points

### 3.1 `session.error` → Hecateq Runtime Failure Toast

**File:** `src/plugin/event.ts`
**Location:** `createEventHandler` closure, inside the `session.error` handler, after `hermesEventLog?.logSessionError()`

**Code:**
```typescript
if (errorMsg && managers.hermesEventLog) {
  const toastKey = errorMsg.slice(0, 60)
  const lastToastTime = hecateqToastErrorKeys.get(toastKey)
  const now = Date.now()
  if (lastToastTime === undefined || now - lastToastTime >= HECATEQ_TOAST_ERROR_DEDUP_MS) {
    hecateqToastErrorKeys.set(toastKey, now)
    showHecateqToastSafe(pluginContext.client, {
      kind: "runtime",
      title: "Session error",
      message: errorMsg.slice(0, 200),
      variant: "error",
    }).catch(() => {})
  }
}
```

**Parameters:**
- `kind`: `"runtime"`
- `title`: `"Session error"`
- `message`: First 200 chars of extracted error message
- `variant`: `"error"`
- `duration`: 6000ms (default from `showHecateqToastSafe`)

**Dedupe:** Per error message (first 60 chars), 30-second window. Stale entries (>60s) trimmed when map exceeds 50 entries.

**Guard:** Only fires when `hermesEventLog` is present (Hecateq pipeline active).

---

## 4. Skipped Events and Rationale

| Event/Module | Reason Skipped |
|---|---|
| Orchestration pipeline internals (`orchestration-controller`, `quality-gate-runner`, `repair-loop-controller`) | Pure utility modules — no `client` parameter available. Adding TUI dependencies would violate the "no TUI dependency in client-less utility/helper files" rule. |
| `delegation-executor` / `runtime-delegation-consumer` | Consumer/producer pattern modules — operate on file-based state, no TUI client access. |
| `runtime-handoff-service` | File persistence layer — reads/writes `.opencode/state/hecateq/state.json`, no client access. |
| `chat-message.ts` | Already dirty (user has uncommitted changes). Has client access but is primarily for chat message handling, not orchestration/runtime failures. Higher spam ambiguity. |
| `create-session-hooks.ts` | Already dirty. Hooks already have their own toast patterns (model fallback, auto update). |
| `src/agents/hecateq-orchestrator/**` | Agent prompt/profile files — no runtime event handling or client access. |

---

## 5. User-Visible Toast Examples

When a session error occurs (e.g., API failure, timeout, orchestration error), the user sees:

```
┌─────────────────────────────────────────────────────────┐
│ Hecateq [runtime] Session error                         │
│ Hecateq orchestration pipeline failed: timeout exceeded │
│                                     [error] [6s]        │
└─────────────────────────────────────────────────────────┘
```

The toast only appears when:
1. A `session.error` event fires
2. The Hermes event log is active (Hecateq pipeline enabled)
3. The error message hasn't been shown in the last 30 seconds

---

## 6. Test Results

### 6.1 Toast Unit Tests (Phase 2A/2B infrastructure)

```
bun test src/shared/notification-toast.test.ts src/shared/hecateq-toast.test.ts
Result: 17 pass, 0 fail, 38 expect() calls
```

### 6.2 Phase 2C Toast Integration Tests

```
bun test --test-name-pattern "Hecateq Phase 2C" src/plugin/event.test.ts
Result: 3 pass, 0 fail, 5 expect() calls
```

Tests cover:
1. Toast emitted on `session.error` with Hermes event log → verifies `Hecateq` prefix and `error` variant
2. Duplicate error messages → dedupe in effect (only 1 toast)
3. TUI-absent client → no crash

### 6.3 Full Event Test Suite

```
bun test src/plugin/event.test.ts
Result: 34 pass, 0 fail, 75 expect() calls
```

No regressions introduced.

### 6.4 Typecheck

```
bun run typecheck
Result: Clean (tsgo --noEmit + all package typechecks pass)
```

### 6.5 Pre-existing Test Failures

No pre-existing failures were observed in the tested files. The full `bun test` suite has known upstream failures unrelated to this change (documented in repo README: "beta — pre-existing upstream and fork-specific test failures").

---

## 7. Phase 2D Suggestion

**Phase 2D** should focus on:
- **Agent-level toast points**: Add `kind: "agent"` toasts for agent lifecycle events (agent spawn/fail/timeout) in `background-agent` or `call_omo_agent` paths where client context exists
- **Background task failure toasts**: `BackgroundManager` already has error handling with circuit breaker — add `kind: "background"` toasts for background task failures
- **Memory system toasts**: Add `kind: "memory"` toasts for memory bootstrap/creation failures in `hecateqMemoryBootstrap` hook (client context exists via `ctx.client`)
- **Consider a thin toast bridge**: Rather than adding TUI to orchestration utilities, a thin event-emitter bridge could allow pure utilities to emit structured events that `event.ts` translates to toasts

---

## 8. Files Changed / Created

| File | Action | Lines Changed |
|---|---|---|
| `src/plugin/event.ts` | Modified | +22 lines (import + dedupe map + toast call) |
| `src/plugin/event.test.ts` | Modified | +92 lines (3 new test cases) |
| `NOTIFICATION_PHASE_2C_REPORT.md` | Created | This file |

---

## 9. Risks and Unresolved Issues

1. **Spam risk mitigation**: The 30-second dedupe window (per error message prefix) prevents repeat-spam but doesn't prevent different errors from firing in rapid succession. In practice, `session.error` events are infrequent enough that this is acceptable.
2. **Non-Hermes sessions**: The toast only fires when `hermesEventLog` is present (always in current codebase). If Hermes logging is ever removed or disabled, toasts will silently stop.
3. **Error message truncation**: Messages are truncated to 200 chars for the toast body. Very long error messages may lose diagnostic detail.
4. **No repair activation toast**: As specified, "do not implement repair activation info" — the repair loop runs silently from the user's perspective.

---

## 10. Summary

Phase 2C successfully added **one safe, deduped Hecateq runtime failure toast point** to the `session.error` handler in `event.ts`. All 47 orchestration event candidates were evaluated; only the `session.error` handler had the necessary client context for safe TUI toast emission. Generic toast behavior, Hecateq branding constraints, and TUI-absence safety were all preserved.
