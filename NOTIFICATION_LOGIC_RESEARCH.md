# Notification Logic Research Report

**Date:** 2026-06-05
**Repository:** oh-my-openagent-hecateq (fork root at `/home/berkay/Masaüstü/Projeler/forks/oh-my-openagent-hecateq`)
**Scope:** Audit of all notification, toast, and session-event mechanisms

---

## 1. Executive Summary

The plugin does **not** have a unified notification system. Notification logic is **fragmented across at least 9 independent mechanisms** — native OS desktop notifications (`session-notification`), TUI toasts (15+ call sites via `ctx.client.tui.showToast`), background task completion injection (`system-reminder` text), auto-update toasts, startup toasts, model fallback toasts, ralph loop toasts, OpenClaw external notifications (Discord/Telegram/HTTP/shell), and a dedicated `TaskToastManager`. Each mechanism has its own trigger, its own formatting, its own error handling, and its own configuration. There is no central router, no priority queue, no deduplication across channels, and no unified config schema for notification preferences.

The `session-notification` hook at `src/hooks/session-notification.ts` is the closest thing to a "real" notification system. It delivers **OS desktop notifications** (native macOS/Linux/Windows alerts) triggered by `session.idle`, `permission.*`, and `question`-tool events. However, it runs **independently** of TUI toasts, background notifications, and OpenClaw events — there is no code path where, for example, a background task completion fires both a desktop notification AND a toast.

---

## 2. Current Notification Surfaces

| # | Mechanism | Channel | Trigger | Config | Primary File(s) |
|---|-----------|---------|---------|--------|-----------------|
| 1 | **OS desktop notification** | OS native (notify-send, osascript, PowerShell) | `session.idle`, `permission.*`, `question` tool | `notification.force_enable` | `src/hooks/session-notification.ts`, `session-notification-sender.ts`, `session-notification-scheduler.ts`, `session-notification-init.ts` |
| 2 | **TUI toast** | OpenCode TUI (`ctx.client.tui.showToast`) | ~15+ call sites: chat-message, model-fallback, runtime-fallback, auto-update, ralph-loop, legacy-plugin, ultrawork-override | None (ad-hoc) | Scattered; see §3 |
| 3 | **Background task completion** | System-reminder text injected into parent session | Background task completes/fails | None | `src/hooks/background-notification/hook.ts`, `src/features/background-agent/manager.ts`, `parent-wake-notifier.ts`, `background-task-notification-template.ts` |
| 4 | **Update/startup toasts** | TUI toast | `session.created` | `auto_update` | `src/hooks/auto-update-checker/` (9 files in `hook/` subdir) |
| 5 | **Spinner/animated toast** | TUI toast (repeated showToast with spinner chars) | Startup | None | `src/hooks/auto-update-checker/hook/spinner-toast.ts` |
| 6 | **Task Toast Manager** | TUI toast | Task started/completed | None | `src/features/task-toast-manager/manager.ts` |
| 7 | **OpenClaw external** | Discord/Telegram/HTTP/shell | `session.created`, `session.deleted`, `session.idle` | `openclaw.enabled` | `src/openclaw/runtime-dispatch.ts` |
| 8 | **Ralph loop toasts** | TUI toast | Verification failure | None | `src/hooks/ralph-loop/verification-failure-handler.ts` |
| 9 | **Model fallback toasts** | TUI toast | Fallback triggered | `model_fallback` | `src/plugin/hooks/create-session-hooks.ts` (line 174–184), `src/hooks/runtime-fallback/fallback-retry-dispatcher.ts` (line 27–37) |

---

## 3. Hook-Level Findings

### 3.1 Session Notification Hook (`session-notification`)

**Registered in:** `src/plugin/hooks/create-session-hooks.ts` (lines 109–118)

**Factory:** `createSessionNotification()` in `src/hooks/session-notification.ts`

**Behavior:**
- Listens on `event: session-notification` hook (called from `dispatchToHooks()` in `src/plugin/event.ts` line 311)
- Filters out subagent sessions and non-main sessions when `enforceMainSessionFilter` is true (default)
- Handles these event types:
  - `session.created` — tracks session
  - `session.idle` — schedules notification after `idleConfirmationDelay` (1500ms default)
  - `message.updated` / `message.part.updated` / `message.part.delta` — cancels pending notification (marks activity)
  - `permission.*` events — sends notification immediately with "permission" message
  - `tool.execute.before` for question tools — sends notification for question/permission events
  - `session.deleted` — cleans up tracking

**Scheduler** (`session-notification-scheduler.ts`):
- Debounces rapid idle/activity cycles
- Version-gating prevents stale notifications
- `skipIfIncompleteTodos` (default: true) suppresses notification when work remains
- `notifiedSessions` Set prevents duplicate notification for same session
- Grace period (`activityGracePeriodMs`: 100ms default) ignores late activity events

**Sender** (`session-notification-sender.ts`):
- Platform detection: `darwin`, `linux`, `win32`, `unsupported`
- Darwin: cmux → terminal-notifier → osascript (fallback chain)
- Linux: notify-send
- Win32: PowerShell
- Uses `ctx.$` (shell template executor) — falls back silently if unavailable
- Sound playback for permission events when `playSound` is true

**Content builder** (`session-notification-content.ts`):
- Reads session title and last user/assistant messages via `ctx.client.session.get()` and `ctx.client.session.messages()`
- Falls back to session ID if title unavailable
- Falls back to base message if messages unavailable

**Config:** `src/config/schema/notification.ts` — single field `force_enable` (boolean, optional). Default behavior: auto-disables when external notification plugin detected. No granularity for which events generate notifications.

### 3.2 Background Notification Hook (`background-notification`)

**Registered in:** `src/plugin/hooks/create-continuation-hooks.ts` (lines 103–105)

**Factory:** `createBackgroundNotificationHook(backgroundManager)` in `src/hooks/background-notification/hook.ts`

**Behavior:**
- Forwards event types: `message.updated`, `message.part.updated`, `message.part.delta`, `todo.updated`, `session.idle`, `session.error`, `session.deleted`, `session.status`, and `session.next.*` prefixed events
- On `chat.message`: calls `manager.injectPendingNotificationsIntoChatMessage()`
- Does **not** produce TUI toasts or OS notifications — only injects system-reminder text

**Background task notification flow** (see §7 for full details):
- `parent-wake-notifier.ts` (718 lines) dispatches internal prompts to parent session
- `background-task-notification-template.ts` builds `<system-reminder>` blocks
- Template outputs warn about failures and direct user to `background_output()` tool

### 3.3 Legacy Plugin Toast Hook (`legacy-plugin-toast`)

**Registered in:** `src/plugin/hooks/create-session-hooks.ts` (lines 284–286)

**Factory:** `createLegacyPluginToastHook(ctx)` in `src/hooks/legacy-plugin-toast/hook.ts`

**Fires:** On `session.created` event (once per plugin lifetime — `fired` guard)

**Behavior:** Checks if `opencode.json` uses legacy plugin name. If so, attempts auto-migration and shows success toast; if migration fails, shows warning toast with manual instructions. Uses `ctx.client.tui.showToast()`.

### 3.4 Model Fallback Toast (ad-hoc)

**Created in:** `src/plugin/hooks/create-session-hooks.ts` (lines 174–184, inside `modelFallback` hook construction)

**Trigger:** When model fallback is applied (proactive fallback at `chat.params`)

**Code:**
```typescript
toast: async ({ title, message, variant, duration }) => {
  await ctx.client.tui.showToast({ body: { title, message, variant: variant ?? "warning", duration: duration ?? 5000 } }).catch(() => {})
}
```

### 3.5 Runtime Fallback Toast (ad-hoc)

**Created in:** `src/hooks/runtime-fallback/fallback-retry-dispatcher.ts` (lines 27–37)

**Trigger:** When runtime fallback is activated (reactive fallback on error)

**Gated by:** `deps.config.notify_on_fallback` (default: true)

Shows warning toast with "Model Fallback" title and new model name.

### 3.6 Auto-Update Checker Toasts

**Factory:** `createAutoUpdateCheckerHook()` in `src/hooks/auto-update-checker/hook.ts` (within `hook/` subdir)

**Files:**
- `update-toasts.ts` — update available toast (info variant, 8000ms) and auto-updated toast (success variant, 8000ms)
- `startup-toasts.ts` — version toast with spinner; local dev toast
- `spinner-toast.ts` — animated spinner using repeated `showToast` calls (5 × 100ms frames)
- `model-cache-warning.ts` — warning toast if model cache missing (10000ms)
- `connected-providers-status.ts` — warning toast if provider cache build fails (8000ms)
- `config-errors-toast.ts` — error toast for config load failures (10000ms)

### 3.7 Hooks That Do NOT Emit Notifications

| Hook | Event | Why No Notifications |
|------|-------|---------------------|
| `keywordDetector` | messages.transform | Injects system prompts only |
| `hecateqMemoryBootstrap` | event | Creates files/dirs only |
| `hecateqProjectContextInjector` | chat.message | Injects context blocks only |
| `compactionContextInjector` | session.compacted | Injects context only |
| `ralphLoop` | event | Drives iteration loop, does toast only on verification failure |
| `atlasHook` | event | Background orchestrator only |
| `todoContinuationEnforcer` | session.idle | Drives continuation only |

---

## 4. TUI / Toast API Findings

### API Signature

The OpenCode TUI toast API is accessed as `ctx.client.tui.showToast()` throughout the codebase. Evidence from `src/plugin/chat-message.ts` (lines 176–184):

```typescript
client: {
  tui: {
    showToast: (input: {
      body: {
        title: string;
        message: string;
        variant: "warning" | "info" | "success" | "error";
        duration: number;
      }
    }) => Promise<unknown>;
  }
}
```

### Safety Patterns

Every call site wraps the call with `.catch(() => {})` to silently handle failures. This is a consistent pattern — 15+ call sites across files including:

- `src/plugin/chat-message.ts` (line 271, 330–337)
- `src/hooks/legacy-plugin-toast/hook.ts` (lines 40–49, 55–64)
- `src/hooks/auto-update-checker/hook/update-toasts.ts` (line 18)
- `src/hooks/auto-update-checker/hook/spinner-toast.ts` (line 21)
- `src/hooks/runtime-fallback/fallback-retry-dispatcher.ts` (line 37)
- `src/hooks/ralph-loop/verification-failure-handler.ts` (lines 115–117, 129–131, 169–176)
- `src/features/task-toast-manager/manager.ts` (lines 198–205, 225–232)
- `src/hooks/session-notification-sender.ts` — uses `ctx.$` instead of TUI

### Safety Verdict: Safe to Call

The TUI toast API is safe to call provided:
1. The `.catch(() => {})` pattern is used (universally applied)
2. The call is not awaited in a hot loop (spinner-toast is an exception, making 50 calls in 5 seconds)
3. The `variant` and `duration` are appropriate for the context

### Fallback When TUI Is Absent

There is **no consistent fallback** when TUI is absent. The behavior varies by mechanism:
- TUI toasts: silently fail (catch → no-op). **No alternative channel.** If running in headless/CLI mode, the user sees nothing.
- OS notifications: use `ctx.$` (Bun shell) — fails silently if unavailable.
- Background task notifications: inject into session messages as `<system-reminder>` text — does not depend on TUI at all.

---

## 5. Config Findings

### 5.1 Existing `notification` Schema

**File:** `src/config/schema/notification.ts` (8 lines)

```typescript
export const NotificationConfigSchema = z.object({
  force_enable: z.boolean().optional(),
})
```

Single-purpose: forces the `session-notification` hook on even when external notification plugins are detected. No config for:
- Which events trigger notifications
- Sound on/off
- Notification duration
- Toast vs OS notification preference

### 5.2 `hecateq` Schema — No Notification Config

**File:** `src/config/schema/hecateq.ts`

The `HecateqConfigSchema` (lines 386–398) has 10 sub-configs: `context_injection`, `agent_index`, `memory_bootstrap`, `doctor`, `git_checkpoint`, `dependency_graph`, `orchestration`, `orchestrator`, `auto_spawn`, `delegation_chain`. **No `notifications` field.**

### 5.3 `notification` in Root Schema

**File:** `src/config/schema/oh-my-opencode-config.ts` (line 80)

```typescript
notification: NotificationConfigSchema.optional(),
```

### 5.4 Notification Config Gaps

| Gap | Impact | Files Affected |
|-----|--------|----------------|
| No unified enable/disable per channel | Cannot selectively disable toasts without disabling OS notifications | All notification surfaces |
| No TUI toast enable/disable config | Every hook that emits toasts does so unconditionally (except runtime-fallback `notify_on_fallback`) | ~15 call sites |
| No notification priority/urgency | All toasts same variant (warning/info/success/error) per call site, not per config | All toast call sites |
| No duration config | Hardcoded per call site (3000–10000ms) | All toast call sites |
| No per-event-type gating | Cannot enable only error notifications, disable info toasts | All hooks |

---

## 6. Runtime Event Flow

### Event Dispatch Order

In `src/plugin/event.ts` function `dispatchToHooks()` (lines 305–336), events are dispatched in this order:

```
1. autoUpdateChecker (event)
2. legacyPluginToast (event)
3. hecateqMemoryBootstrap (event)
4. claudeCodeHooks (event)
5. backgroundNotificationHook (event)
6. sessionNotification (event)
7. todoContinuationEnforcer (handler)
8. unstableAgentBabysitter (event)
9. contextWindowMonitor (event)
10. preemptiveCompaction (event)
11. directoryAgentsInjector (event)
12. directoryReadmeInjector (event)
13. rulesInjector (event)
14. thinkMode (event)
15. anthropicContextWindowLimitRecovery (event)
16. runtimeFallback (event)
17. agentUsageReminder (event)
18. categorySkillReminder (event)
19. interactiveBashSession (event)
20. ralphLoop (event)
21. stopContinuationGuard (event)
22. compactionContextInjector (event)
23. compactionTodoPreserver (event)
24. writeExistingFileGuard (event)
25. atlasHook (handler)
26. autoSlashCommand (event)
```

Notifications from these hooks fire in this sequence within a single event handler. There is no batching or coalescing — if multiple hooks produce toasts/notifications from the same event, they fire one after another.

### Idle Event Deduplication

`src/plugin/event.ts` implements two layers of idle dedup:
1. **Synthetic idle dedup** — `normalizeSessionStatusToIdle()` normalizes non-idle events to synthetic idle; `DEDUP_WINDOW_MS = 500` prevents rapid cycle
2. **Recent idle tracking** — `recentSyntheticIdles`, `recentRealIdles`, `recentAnyIdles` Maps with 500ms window

### OpenClaw Integration

OpenClaw notifications fire separately for `session.created`, `session.deleted`, and `session.idle` (lines 640–651, 691–701, 763–776 in `src/plugin/event.ts`). They are **not** connected to session-notification or background-notification — OpenClaw is an independent notification path that maps OpenCode events to Discord/Telegram/HTTP/shell dispatches.

---

## 7. Background Task Notification Flow

```
Task completes
  → manager.ts (result-handler, ~line 2000+)
    → injectPendingNotificationsIntoChatMessage() on next chat.message
    → parent-wake-notifier.ts:
      → dispatchInternalPrompt() → inject "<system-reminder>" into parent session
      → template from background-task-notification-template.ts
```

**No OS notification.** When a background task completes, the parent session receives a system-reminder message — but there is no desktop notification, no TUI toast (unless the TaskToastManager was initialized). The parent agent sees the message only when it produces its next output.

**Parent-Wake Notifier** (`src/features/background-agent/parent-wake-notifier.ts`, 718 lines):
- Uses dependency-injected client + enqueue callback
- Handles: tool-call deferral, compacted session recovery, duplicate injection prevention
- Guards against race conditions with user messages (`userMessageInProgressWindowMs`)
- Falls back with exponential backoff on failures (`consecutiveFailures` tracking)
- **No integration with session-notification hook** — a completed background task does not trigger a desktop notification

**TaskToastManager** (`src/features/task-toast-manager/manager.ts`, 252 lines):
- Singleton instance, tracks task lifecycle
- Shows TUI toast on task creation (with task list summary) and completion
- Not used by all background tasks — only initialized when the delegation system explicitly calls it
- Uses `.catch(() => {})` pattern on `tuiClient.tui.showToast()`

---

## 8. Hecateq-Specific Notification Opportunities

The Hecateq workflow engine (`src/features/hecateq-orchestration/`) has no notification integration with:
- `session-notification` (OS desktop notification)
- OpenClaw (external channels)
- Background task completion
- `TaskToastManager` (TUI toasts)

**Hecateq subsystems that would benefit from notifications:**
| Subsystem | Current Notification | Desired | 
|-----------|-------------------|---------|
| Orchestration pipeline completion | None | Summary notification with task results |
| Task decomposition | None | Notification when DAG is built |
| Repair loop activation | None | Warning when retry is in progress |
| Quality gate results | None | Pass/fail summary per gate |
| Memory bootstrap | None | Notification when memory files are created |
| Git checkpoint | None | Notification when checkpoint is created |
| Auto-spawn throttling | None | Warning when rate limit hit |

**Additionally, Hecateq-specific events could trigger cross-channel notifications:**
- Background task complete → desktop notification (currently only injects system-reminder text)
- Contract ready for review → TUI toast + external channel
- Handoff received → TUI toast + desktop notification
- Session recovery after crash → TUI info toast + desktop notification
- Agent index outdated → warning toast

---

## 9. Gaps and Risks

### Critical Gaps

| Gap | Risk | Example Scenario |
|-----|------|-----------------|
| **Background task completion has no desktop notification** | User walks away during background task; returns to stale system-reminder text with no alert | `task(run_in_background=true)` takes 5+ minutes; user switches to other work; completion is invisible |
| **No cross-channel deduplication** | User receives duplicate notifications from both OS and TUI for the same event | `session.idle` triggers both `session-notification` (desktop) and OpenClaw (Discord) independently |
| **No unified notification config** | Cannot express user preferences in one place | `notification.force_enable` only controls OS notifications; TUI toasts are not configurable |
| **No notification priorities** | Critical errors and info updates appear identical | `config-errors-toast.ts` uses same TUI API as `update-toasts.ts` — no severity differentiation |
| **TaskToastManager is optional/inconsistently initialized** | Some background tasks produce toast, some don't | `TaskToastManager` is a singleton that may not be initialized if the caller doesn't call `initTaskToastManager()` |

### Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Notification overwhelm (many toasts from single event) | Medium | Add coalescing in a notification router |
| OS notification `force_enable` not honored for background tasks | Medium | Background completion should check `notification.force_enable` or new config |
| `spinner-toast.ts` fires 50 TUI calls in 5s — potential TUI performance impact | Low | Only runs once at startup; acceptable for now |
| No notification at all in headless/CLI mode | High | Background tasks already handle this (system-reminder injection); session-notification should too |
| OpenClaw and session-notification both fire on same events independently | Medium | Duplicate external + desktop notifications |

---

## 10. Recommended Architecture

### Central Notification Router

Add a `NotificationService` class that accepts notification requests from any hook/subystem and dispatches to configured channels:

```
NotificationService
  ├── Channel: Desktop (OS notification)
  │   └── Reuse session-notification-sender.ts
  ├── Channel: TUI (toast)
  │   └── Reuse ctx.client.tui.showToast() with safe wrapper
  ├── Channel: External (Discord/Telegram/HTTP)
  │   └── Reuse OpenClaw dispatch
  ├── Channel: Session (system-reminder injection)
  │   └── Reuse background-task-notification-template.ts pattern
  └── Channel: Log (structured log entry)
      └── Reuse shared/logger.ts
```

### Notification Event Bus

Introduce a lightweight event bus so notification-producing code doesn't need to know about notification channels:

```typescript
// Semantic event types
type NotificationEvent =
  | { type: "task.completed"; taskId: string; description: string; status: "success" | "failure" }
  | { type: "session.idle" }
  | { type: "permission.required"; message: string }
  | { type: "background.task.done"; count: number; failed: number }
  | { type: "update.available"; version: string }
  // ... etc
```

### Unification Principles

1. **Producers emit semantic events** (not raw TUI calls)
2. **Router maps events → channels** based on config
3. **Each channel implements** its own delivery (toast, OS notify, Discord, etc.)
4. **Config controls** which event types go to which channels
5. **Deduplication** is handled at the router level

---

## 11. Suggested Config Shape

### Extend `notification` Schema

```typescript
// src/config/schema/notification.ts
export const NotificationConfigSchema = z.object({
  force_enable: z.boolean().optional(),
  // New fields:
  desktop_enabled: z.boolean().default(true),
  toast_enabled: z.boolean().default(true),
  sound_enabled: z.boolean().default(false),
  idle_confirmation_delay_ms: z.number().int().min(0).max(30000).default(1500),
  skip_if_incomplete_todos: z.boolean().default(true),
  events: z.object({
    on_session_idle: z.boolean().default(true),
    on_permission_required: z.boolean().default(true),
    on_background_complete: z.boolean().default(true),
    on_error: z.boolean().default(true),
    on_update_available: z.boolean().default(true),
  }).default({}),
})
```

### Option: Hecateq-Specific Notifications

If the Hecateq workflow engine needs its own notification preferences:

```jsonc
{
  "hecateq": {
    "notifications": {
      "orchestration_complete": true,
      "repair_loop_activated": true,
      "quality_gate_failure": true,
      "memory_bootstrap_complete": false,
      "git_checkpoint_performed": false
    }
  }
}
```

**Verdict on the question "Is adding `hecateq.notifications` correct?":** YES — but only for Hecateq-workflow-specific events. General notification preferences (desktop, toast, sound) belong in the root `notification` config which is already present and schema-defined. A `hecateq.notifications` section would complement the root config by controlling which Hecateq-specific workflow events generate notifications.

---

## 12. Implementation Phases

### Phase 1: Safe Wrapper (Low Risk, 1–2 days)
- Extract a shared `showToast()` helper that encapsulates the `.catch(() => {})` pattern
- Add return type for success/failure tracking
- Refactor 15+ call sites to use the shared wrapper
- No behavioral change

### Phase 2: Background → Desktop Bridge (Medium Risk, 2–3 days)
- Wire background task completion events into session-notification hook
- Add `TASK_COMPLETED` event type to session-notification
- Desktop notification when background task completes
- Gate via `notification.events.on_background_complete`

### Phase 3: Unified Config (Medium Risk, 2–3 days)
- Extend `NotificationConfigSchema` with granular event controls
- Wire config into session-notification hook (read `desktop_enabled`, `sound_enabled`, etc.)
- Wire config into TUI toast calls (check `toast_enabled`)
- Wire config into OpenClaw dispatch

### Phase 4: Notification Router (Higher Risk, 4–5 days)
- Create `NotificationService` class in `src/features/notification-service/`
- Create channel adapters for each notification surface
- Create event-to-notification mapping
- Migrate all notification producers to use the service

### Phase 5: Hecateq Notifications (Low Risk, 1–2 days)
- Add `hecateq.notifications` config field (or use root `notification.events`)
- Wire Hecateq orchestration lifecycle events into notification service
- Add desktop notification for orchestration completion

---

## 13. Files To Inspect Before Coding

The files listed below are the minimum set to understand before making changes. Files marked with `*` were inspected during this research.

### Config Layer
| File | Purpose |
|------|---------|
| `src/config/schema/notification.ts` * | Current notification config schema |
| `src/config/schema/hecateq.ts` * | Hecateq config schema (where hecateq.notifications would go) |
| `src/config/schema/oh-my-opencode-config.ts` * | Root schema composition |
| `src/config/schema/hooks.ts` * | Hook name enum (for new hook registration) |

### Notification Producers
| File | Purpose |
|------|---------|
| `src/hooks/session-notification.ts` * | OS desktop notification hook |
| `src/hooks/session-notification-sender.ts` * | Platform notification delivery |
| `src/hooks/session-notification-scheduler.ts` * | Idle debouncing/scheduling |
| `src/hooks/session-notification-init.ts` * | Platform detection + initialization |
| `src/hooks/session-notification-content.ts` * | Message-aware notification content builder |
| `src/hooks/session-notification-utils.ts` | Binary path resolution for notifiers |
| `src/hooks/session-notification-formatting.ts` | AppleScript/PowerShell string escaping |
| `src/hooks/session-notification-event-properties.ts` | Event property extraction helpers |
| `src/hooks/session-todo-status.ts` | Pending work detection for skip logic |

### Background Task Notification
| File | Purpose |
|------|---------|
| `src/hooks/background-notification/hook.ts` * | Event forwarding hook |
| `src/features/background-agent/manager.ts` * | Background task lifecycle (3025 lines) |
| `src/features/background-agent/parent-wake-notifier.ts` * | Parent session wake injection (718 lines) |
| `src/features/background-agent/background-task-notification-template.ts` * | System-reminder template builder |

### Toast Producers
| File | Purpose |
|------|---------|
| `src/plugin/chat-message.ts` * | Provider cache missing toast, ultrawork override toast |
| `src/plugin/hooks/create-session-hooks.ts` * | Model fallback toast creation (lines 174–184) |
| `src/hooks/runtime-fallback/fallback-retry-dispatcher.ts` * | Runtime fallback toast |
| `src/hooks/auto-update-checker/hook/*` * | 5 toast files (update, startup, spinner, model-cache, config-errors, connected-providers) |
| `src/hooks/legacy-plugin-toast/hook.ts` * | Legacy plugin migration toast |
| `src/hooks/ralph-loop/verification-failure-handler.ts` * | Ralph loop verification failure toast |
| `src/features/task-toast-manager/manager.ts` * | Task lifecycle toasts (252 lines) |

### Event Wiring
| File | Purpose |
|------|---------|
| `src/plugin/event.ts` * | Event dispatch to all hooks (1058 lines) |
| `src/plugin-interface.ts` * | Plugin interface composition |
| `src/plugin/hooks/create-session-hooks.ts` * | Session hook composition (346 lines) |
| `src/plugin/hooks/create-continuation-hooks.ts` * | Continuation hook composition (128 lines) |
| `src/openclaw/runtime-dispatch.ts` * | OpenClaw event mapping + dispatch |

### Hecateq Specific
| File | Purpose |
|------|---------|
| `src/cli/doctor/checks/hecateq-workflow.ts` * | Hecateq doctor check (1317+ lines) |
| `src/shared/hecateq-agent-indexer.ts` * | Hecateq agent indexer |

### Supporting
| File | Purpose |
|------|---------|
| `src/tools/delegate-task/subagent-discovery.ts` * | Agent discovery for task routing |
| `src/features/background-agent/constants.ts` | Polling/task constants |
| `src/features/background-agent/types.ts` | Background task types |

---

## 14. Tests To Add Later

### Unit Tests

| Test | File | What It Covers |
|------|------|----------------|
| `session-notification-scheduler.test.ts` | `src/hooks/` | Debouncing, version gating, idle confirmation delay |
| `session-notification-sender.test.ts` | `src/hooks/` | Platform detection, fallback chain per-OS |
| `session-notification-content.test.ts` | `src/hooks/` | Content building from session messages |
| `background-notification.test.ts` | `src/hooks/` | Event forwarding, chat.message injection |
| `parent-wake-notifier.test.ts` | `src/features/background-agent/` | Dispatch gating, dedup, tool-call deferral |
| `background-task-notification-template.test.ts` | `src/features/background-agent/` | Template output for all status combinations |
| `task-toast-manager.test.ts` | `src/features/` | Task lifecycle toast production |
| `notification-routing.test.ts` | (new file) | Router maps events → correct channels based on config |

### Integration Tests

| Test | What It Covers |
|------|----------------|
| `session.idle` → both OS notification and TUI toast fire (or don't, per config) | Cross-channel dispatch |
| Background task completion → desktop notification + system-reminder injection | New bridge between background-agent and session-notification |
| Multiple hooks from same event produce at most N notifications (coalescing) | Deduplication across hooks |
| Config `toast_enabled: false` suppresses all TUI toasts but allows OS notifications | Config integration |
| Headless/CLI mode suppresses TUI toasts, allows OS notifications (or vice versa) | Fallback behavior |

### Test Infrastructure Requirements

- Mock for `ctx.client.tui.showToast` (already partially done in `zauc-mocks-*` pattern)
- Mock for `ctx.$` (Bun shell executor) — needed for session-notification-sender tests
- Mock for `Platform` detection (control which OS code path is tested)
- Background task lifecycle simulation (task states, completion signals)

---

## 15. Final Recommendation

**Decision: Do NOT build a unified notification system yet.** Proceed with targeted, low-risk improvements in this order:

### Immediate (Phase 1 — safe wrapper):
1. **Extract shared `showToast()` helper** in `src/shared/notification-toast.ts` that encapsulates the `.catch(() => {})` pattern and provides consistent return types. Refactor 15+ call sites. Duration: 1–2 days.

### Short-term (Phase 2 — bridge):
2. **Bridge background task completion → desktop notification.** When a background task completes, emit a `TASK_COMPLETED` event to the session-notification hook. If `skipIfIncompleteTodos` applies, skip individual notifications and batch them on all-complete. Duration: 2–3 days.

### Medium-term (Phase 3 — config):
3. **Extend `NotificationConfigSchema`** with `desktop_enabled`, `toast_enabled`, `sound_enabled`, and granular event-type toggles. Read these in session-notification hook. Duration: 2–3 days.

### Future (Phase 4–5 — full unification):
4. **Build `NotificationService`** only after the above phases validate that a centralized router is worth the investment. Duration: 5+ days.
5. **Add `hecateq.notifications`** for Hecateq-workflow-specific events after the general notification system is stable. Duration: 1–2 days.

### Rationale

The fragmentation, while real, is currently working. Each notification channel was built independently for its specific use case, and users are not reporting notification issues. The most pressing gap is background task completion → desktop notification, which is a missing bridge rather than a missing system. The high cost of a full unification (6+ notification channels × event types × config keys) is not justified until the existing surfaces demonstrate a need for consolidation. A safe wrapper and a single bridge solve the most impactful problem at much lower cost.
