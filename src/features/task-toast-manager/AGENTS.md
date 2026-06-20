# task-toast-manager

## Overview

Provides task-progress notifications via OpenCode's toast API. The singleton `TaskToastManager` tracks running and queued tasks, and displays consolidated toast notifications when tasks start, update model info, or complete. Each toast shows a task-list summary with running tasks (with elapsed duration) and queued tasks, including model fallback information and concurrency limits. Used by the background task system and delegate-task flow to give the user visibility into what the plugin is doing.

## File Inventory

| File | Purpose | LOC |
|------|---------|-----|
| `index.ts` | Barrel exports for `TaskToastManager`, singleton accessors, types | 2 |
| `types.ts` | `TrackedTask`, `TaskStatus`, `TaskToastOptions`, `ModelFallbackInfo` types | 29 |
| `manager.ts` | `TaskToastManager` class (237 LOC), singleton `getTaskToastManager()`, `initTaskToastManager()` factory | 237 |

## Key Exports

- `TaskToastManager` -- Class with `addTask()`, `updateTask()`, `updateTaskModelBySession()`, `removeTask()`, `getRunningTasks()`, `getQueuedTasks()`, `showCompletionToast()`
- `getTaskToastManager()` -- Returns the singleton instance or `null`
- `initTaskToastManager(client, concurrencyManager?)` -- Creates and stores the singleton instance

## Integration Points

6 consumers. Wired via `src/create-managers.ts` which calls `initTaskToastManager(client)`. Used by `src/tools/delegate-task/sync-task.ts` and `sync-continuation.ts` to show task-start and task-update toasts. `category-resolver.ts` uses it to surface model fallback info. `chat-message-fallback-handler.ts` in the model-fallback hook updates task model info per session. `test-setup.ts` resets the singleton for test isolation.

## Test Status

1 test file (15.1k). Covers task add/update/remove lifecycle, running/queued filtering, toast message formatting with concurrency info, model fallback suffixes, task completion toast with remaining-task summary, singleton lifecycle, and edge cases (empty task lists, duplicate IDs).

## Known Gaps

- No task pruning -- completed/error tasks remain in the map until explicitly `removeTask()` is called. `showCompletionToast()` calls `removeTask()` but callers must ensure it fires.
- `updateTaskModelBySession()` performs a linear scan over all tasks in the map (O(n) per call).
- Singleton pattern requires explicit `_resetTaskToastManagerForTesting()` for test isolation, and callers in tested modules must import it.
