# tool-metadata-store

## Overview

In-memory metadata cache that works around OpenCode's `fromPlugin()` wrapper, which replaces plugin tool metadata with `{ truncated, outputPath }`, discarding `sessionId`, `title`, or custom metadata set during `execute()`. The store captures metadata written via `ctx.metadata()` inside `execute()`, then the `tool.execute.after` hook consumes and merges it back before the processor writes the final part to the session store. Includes a contract format for embedding task linkage (`<task_metadata>` blocks) in agent output text.

## File Inventory

| File | Purpose | LOC |
|------|---------|-----|
| `index.ts` | Barrel exports for all public functions and types | 14 |
| `store.ts` | In-memory `Map<string, PendingToolMetadata>` with 15-minute stale entry cleanup | 84 |
| `publish-tool-metadata.ts` | Writes metadata via `ctx.metadata()` then mirrors into the pending store | 28 |
| `recover-tool-metadata.ts` | Reads and consumes pending metadata by call ID or `ToolCallIDCarrier` | 18 |
| `resolve-tool-call-id.ts` | Normalizes `callID` / `callId` / `call_id` from tool context | 26 |
| `task-metadata-contract.ts` | Builds, parses, and extracts `<task_metadata>` blocks with `sessionId`, `taskId`, `agent`, `category` | 144 |

## Key Exports

- `storeToolMetadata(sessionID, callID, data)` -- Cache metadata for restore after `fromPlugin()` overwrite
- `consumeToolMetadata(sessionID, callID)` -- One-time read-and-delete from store
- `publishToolMetadata(ctx, payload)` -- Dual-write: `ctx.metadata()` + `storeToolMetadata()`
- `recoverToolMetadata(sessionID, source)` -- Reads pending metadata from string call ID or `ToolCallIDCarrier`
- `resolveToolCallID(ctx)` -- Resolves `callID` from three possible key spellings
- `buildTaskMetadataBlock(link)` -- Generates `<task_metadata>` text block
- `parseTaskMetadataBlock(text)` -- Parses `<task_metadata>` block into structured `TaskLink`
- `extractTaskLink(metadata, outputText)` -- Three-tier fallback: metadata object, `<task_metadata>` block, explicit `Session ID:` line

## Integration Points

16 consumers. Primary integration is the `tool.execute.after` hook in `src/plugin/tool-execute-after.ts` which calls `consumeToolMetadata`. Individual tool `execute()` functions in `src/tools/delegate-task/` and `src/tools/background-task/` call `publishToolMetadata` during tool execution. Hashline-edit executor and atlas/ralph-loop hooks also read metadata for task recovery. Plugin-level test `src/plugin/tool-execute-after.test.ts` covers the consume path.

## Test Status

6 test files (3.4k -- 3.4k bytes each). Covers store lifecycle, publish/recover round-trip, call ID resolution (including fallback between `callID`, `callId`, `call_id`), and task metadata block building/parsing/extraction with three-tier fallback logic.

## Known Gaps

- Store is in-memory only; does not survive plugin restart or session compaction
- `isSqliteBackend()` not consulted -- metadata publish assumes JSON backend is always available
- Stale entry cleanup uses fixed 15-minute TTL; no configurable timeout
