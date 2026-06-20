# run-continuation-state

## Overview

Persistent marker file system for the `oh-my-opencode run` CLI command. Writes JSON marker files to `.omo/run-continuation/{sessionID}.json` to track continuation state across CLI invocations. Each marker tracks session continuation sources (todo, stop, background-task) with individual state machines (idle, active, stopped) and human-readable reasons. Used by the CLI run command to detect whether a session should auto-continue after completion, and by hooks to signal continuation requirements.

## File Inventory

| File | Purpose | LOC |
|------|---------|-----|
| `index.ts` | Re-exports types, constants, and storage functions | 3 |
| `types.ts` | `ContinuationMarkerSource`, `ContinuationMarkerState`, `ContinuationMarkerSourceEntry`, `ContinuationMarker` types | 15 |
| `constants.ts` | `CONTINUATION_MARKER_DIR = ".omo/run-continuation"` | 1 |
| `storage.ts` | `readContinuationMarker()`, `setContinuationMarkerSource()`, `clearContinuationMarker()`, `isContinuationMarkerActive()`, `getActiveContinuationMarkerReason()` | 80 |

## Key Exports

- `readContinuationMarker(directory, sessionID)` -- Read JSON marker file, returns `null` on missing or corrupt
- `setContinuationMarkerSource(directory, sessionID, source, state, reason?)` -- Write or update a marker for one source, preserving other sources
- `clearContinuationMarker(directory, sessionID)` -- Delete marker file
- `isContinuationMarkerActive(marker)` -- Returns `true` if any source has state `"active"`
- `getActiveContinuationMarkerReason(marker)` -- Returns the reason string of the first active source

## Integration Points

8 consumers. Core path is `src/cli/run/continuation-state.ts` which reads markers before/after `run` CLI execution. `src/features/background-agent/manager.ts` sets the `background-task` source when background tasks remain. `src/hooks/todo-continuation-enforcer/handler.ts` sets/clears the `todo` source. `src/hooks/stop-continuation-guard/hook.ts` sets the `stop` source. Also used by `src/hooks/session-todo-status.ts` and `src/hooks/session-notification.test.ts`.

## Test Status

1 test file (4.8k). Covers marker read/write/clear lifecycle, source state transitions, active detection with multiple sources, corrupt JSON handling, and cross-session marker isolation.

## Known Gaps

- No TTL or stale marker cleanup -- orphaned `.omo/run-continuation/*.json` files persist indefinitely
- File-based storage is subject to races if two processes write to the same session marker simultaneously
- No validation that `source` is one of the three known values (accepts any string at runtime)
