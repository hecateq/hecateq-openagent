# hook-message-injector

## Overview

Provides the plumbing for hooks to inject synthetic user messages into session storage. The core function `injectHookMessage()` writes a JSON message file and a text part file to the OpenCode message storage directory, using context from the original message or a fallback lookup from prior messages in the session. Gated on backend type: on SQLite (beta) it no-ops and logs a warning because JSON file writes are invisible to the SQLite storage backend. Also provides SDK-based message lookup functions (`findNearestMessageWithFieldsFromSDK`, `findFirstMessageWithAgentFromSDK`) for callers migrating to async patterns.

## File Inventory

| File | Purpose | LOC |
|------|---------|-----|
| `index.ts` | Barrel exports for injector, types, constants | 11 |
| `types.ts` | `MessageMeta`, `OriginalMessageContext`, `TextPart`, `ToolPermission` types | 49 |
| `constants.ts` | Re-exports `MESSAGE_STORAGE`, `PART_STORAGE` from `src/shared` | 1 |
| `injector.ts` | `injectHookMessage()`, `findNearestMessageWithFields()`, `findFirstMessageWithAgent()`, SDK variants, `resolveMessageContext()` | 437 |

## Key Exports

- `injectHookMessage(sessionID, hookContent, originalMessage)` -- Writes message + part JSON files to storage; returns `false` on SQLite backend or empty content
- `findNearestMessageWithFields(messageDir)` -- Scans JSON message dir for nearest message with agent+model fields (JSON backend only; returns `null` on SQLite)
- `findFirstMessageWithAgent(messageDir)` -- Scans JSON message dir for oldest message with agent field
- `findNearestMessageWithFieldsFromSDK(client, sessionID)` -- Async SDK-based variant using `client.session.messages()`
- `findFirstMessageWithAgentFromSDK(client, sessionID)` -- Async SDK-based oldest-agent lookup
- `resolveMessageContext(sessionID, client, messageDir)` -- Returns `{ prevMessage, firstMessageAgent }`, auto-routing between JSON and SDK paths based on `isSqliteBackend()`
- `generateMessageId()` / `generatePartId()` -- Monotonic ID generation per process

## Integration Points

12 consumers. Core users include `todo-continuation-enforcer/continuation-injection.ts`, `ralph-loop/continuation-prompt-injector.ts`, `atlas/idle-event.ts`, `background-task/create-background-task.ts`, `call-omo-agent/background-executor.ts`, and `delegate-task/sync-continuation.ts`. Also used by `prometheus-md-only/agent-resolution.ts` and `anthropic-context-window-limit-recovery/aggressive-truncation-strategy.ts` for context resolution.

## Test Status

1 test file (12.3k). Covers `injectHookMessage` with valid/empty content, agent/model fallback resolution, `findNearestMessageWithFields` message scanning with compaction markers, and SDK-based message lookup with pagination.

## Known Gaps

- `isSqliteBackend()` check means all injection is silently disabled on beta OpenCode. In-flight injection on beta is expected to be handled via `experimental.chat.messages.transform`, but that path is not yet wired for all callers.
- SDK-based functions (`findNearestMessageWithFieldsFromSDK`, `findFirstMessageWithAgentFromSDK`) are exported but marked as "TODO: future use" -- current callers still use the sync JSON functions.
- No fallback from SDK path to JSON path if SDK call throws.
