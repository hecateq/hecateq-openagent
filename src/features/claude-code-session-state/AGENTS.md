# claude-code-session-state

## Overview

Global state tracker for subagent session lifecycle. Maintains in-memory sets for subagent sessions (`subagentSessions`, `syncSubagentSessions`), the main session ID for the current plugin session, and an agent name registry with normalized lookup. The agent registry supports name registration, alias resolution (both lenient and strict modes), and handles zero-width character normalization for robustness. Also maintains a session-to-agent mapping (`sessionAgentMap`) that records which agent owns each session, set on first creation and optionally updated later.

## File Inventory

| File | Purpose | LOC |
|------|---------|-----|
| `index.ts` | Re-exports all public functions from `state.ts` | 1 |
| `state.ts` | `subagentSessions`, `syncSubagentSessions`, main session ID, agent registry, session-agent map | 129 |

## Key Exports

- `subagentSessions` -- `Set<string>` of session IDs for async background agents
- `syncSubagentSessions` -- `Set<string>` of session IDs for synchronous subagent calls
- `setMainSession(id)` / `getMainSessionID()` -- Getter/setter for the primary plugin session ID
- `registerAgentName(name)` -- Register an agent name and its config key alias (zero-width char sanitized)
- `isAgentRegistered(name)` -- Check if an agent name is registered (case-insensitive, zero-width sanitized)
- `resolveRegisteredAgentName(name)` -- Lenient resolution: returns registered alias, config key match, or falls back to raw name
- `resolveRegisteredAgentNameStrict(name)` -- Strict resolution: returns registered alias or config key match, or `undefined`
- `setSessionAgent(sessionID, agent)` / `updateSessionAgent(sessionID, agent)` / `getSessionAgent(sessionID)` / `clearSessionAgent(sessionID)` -- Session-to-agent mapping (first-write-wins for `set`)

## Integration Points

87 consumers -- the most widely imported module in `src/features/`. Core integrations include: `src/plugin/chat-message.ts` (sets main session ID on first message), `src/plugin/event.ts` (sets main session on session.created, registers agents on session events), `src/tools/call-omo-agent/` (tracks subagent sessions, registers agent names), `src/tools/delegate-task/` (reads agent registry), `src/hooks/atlas/` (session-agent mapping), `src/hooks/runtime-fallback/` (main session ID), `src/hooks/keyword-detector/` (agent registration), and `src/cli/run/completion-continuation.test.ts`.

## Test Status

1 test file (10k). Covers all public API: `setMainSession` / `getMainSessionID`, `subagentSessions` add/has/delete, `registerAgentName` with zero-width character stripping, `isAgentRegistered` (case-insensitive), `resolveRegisteredAgentName` vs `resolveRegisteredAgentNameStrict` difference, `setSessionAgent` first-write-wins semantics, `updateSessionAgent` overwrite, `clearSessionAgent`, and `_resetForTesting` isolation.

## Known Gaps

- Global mutable state is never garbage-collected; `subagentSessions` and `syncSubagentSessions` grow monotonically across the plugin lifetime. No cleanup for sessions that have ended.
- `resolveRegisteredAgentName` returns the raw name as fallback, which may silently pass through typos or unregistered names. Strict callers must use `resolveRegisteredAgentNameStrict`.
- `registerAgentName` also registers the config key alias, but does not remove the alias when an agent is unregistered (no unregister function exists).
