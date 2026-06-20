# context-injector

## Overview

Provides a centralized context collection and injection mechanism for the plugin's transform hooks. Multiple sources (keyword-detector, rules-injector, directory-agents, directory-readme, custom) register context entries per session via `ContextCollector`. On the next user message, the injector prepends the collected context as a synthetic text part before the user's actual text, filtered to real (non-synthetic, non-internal) messages. Supports priority-based ordering with four levels: critical, high, normal, low.

## File Inventory

| File | Purpose | LOC |
|------|---------|-----|
| `index.ts` | Barrel exports for collector, injector, and all types | 14 |
| `types.ts` | 9 types: `ContextSourceType`, `ContextPriority`, `ContextEntry`, `RegisterContextOptions`, `PendingContext`, `MessageContext`, `OutputParts`, `InjectionStrategy` | 91 |
| `collector.ts` | `ContextCollector` class with per-session `Map<string, Map<string, ContextEntry>>`, singleton export | 91 |
| `injector.ts` | `injectPendingContext()`, `createContextInjectorHook()`, `createContextInjectorMessagesTransformHook()` | 183 |

## Key Exports

- `ContextCollector` -- Class with `register()`, `getPending()`, `consume()`, `clear()`, `hasPending()`, `clearAll()`
- `contextCollector` -- Singleton `ContextCollector` instance
- `injectPendingContext(collector, sessionID, parts)` -- Prepends merged context into the first text part of output parts
- `createContextInjectorHook(collector)` -- Returns `{ "chat.message": handler }` for the `chat.message` hook
- `createContextInjectorMessagesTransformHook(collector)` -- Returns `{ "experimental.chat.messages.transform": handler }` that inserts a synthetic part before the last real user message's text

## Integration Points

7 consumers. The injector is wired into `create-transform-hooks.ts` as `contextInjectorMessagesTransform` on the `experimental.chat.messages.transform` hook. The `chat.message` variant is used by `keyword-detector` and `claude-code-hooks` handlers. Singleton `contextCollector` is imported by `keyword-detector/hook.ts`, `claude-code-hooks`, and `session-event-handler` for registration.

## Test Status

2 test files. `collector.test.ts` (9.6k) covers register/get/consume/clear lifecycle, priority sorting, deduplication by source+id key. `injector.test.ts` (8k) covers chat.message and messages.transform injection, synthetic message filtering, empty/synthetic edge cases.

## Known Gaps

- `InjectionStrategy` type defined (`"prepend-parts" | "storage" | "auto"`) but only `"prepend-parts"` is implemented in the injector
- No automatic cleanup of stale registrations per session (reliant on `consume()` being called)
- Singleton creates global state that lives across sessions; test isolation requires explicit `clearAll()`
