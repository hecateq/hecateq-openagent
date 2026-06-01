# Task Completion Memory Commit Integration Research

## 1. Executive Summary

Hecateq memory files (tasks.jsonl, decisions.jsonl, quality-history.md, risk-profile.md, file-map.md) are **only updated when agents emit structured HANDOFF blocks** (`STATUS: DONE | BLOCKED | IN_PROGRESS` / `SIGNALS_EMITTED: [...]` / `HANDOFF: [...]`). Normal completed tasks that do not produce a HANDOFF block silently skip all memory writes, leaving memory at bootstrap/template level.

The safest integration point is **post-completion in `BackgroundManager.tryCompleteTask()`** (for background tasks) and **post-result in `sync-task.ts`** (for sync tasks). A new `task-completion-memory-commit.ts` module should wrap existing memory writers (task-state-memory, decision-log, memory-quality-writer, memory-risk-writer, memory-change-impact) into a single best-effort commit that works **without** requiring a HANDOFF block.

No source code changes are proposed in this document. All analysis is based on reading the existing source tree.

## 2. Current Memory Write Behavior

### 2.1 What writes memory today

| Memory File | Writer Module | Trigger |
|---|---|---|
| `tasks.jsonl` | `src/shared/task-state-memory.ts` (`appendTaskEntry`) | HANDOFF block with `STATUS: DONE/BLOCKED` only |
| `decisions.jsonl` | `src/shared/decision-log.ts` (`appendDecisionEntry`) | HANDOFF block with decision-like quality notes only |
| `quality-history.md` | `src/shared/memory-quality-writer.ts` (`writeQualityHistory`) | HANDOFF block with non-empty quality notes only |
| `risk-profile.md` | `src/shared/memory-risk-writer.ts` (`updateRiskProfile`) | HANDOFF block with non-empty changed files list only |
| `file-map.md` (Change Impact Map) | `src/shared/memory-change-impact.ts` (`appendChangeImpactEntries`) | HANDOFF block with non-empty changed files list only |
| `decisions.md` | `src/shared/memory-decision-writer.ts` (`writeDecision`) | Manual/agent/handoff sources (separate path from HANDOFF block) |
| Memory manifest | `src/shared/memory-manifest-updater.ts` (`refreshManifestAfterWrite`) | Tool `write`/`edit`/`replace` touching files inside `.opencode/state/memory/` |

### 2.2 The central handoff processing function

```
src/features/hecateq-orchestration/runtime-handoff-service.ts
  processHandoffInAgentResponse(textContent, directory, sessionId)
    → extractHandoffFromAgentResponse(textContent)  // returns null if no HANDOFF block
    → if null: RETURN null (all memory writes skipped)
    → recordHandoffToOmoState()
    → persistHandoffToContinuationMarker()
    → persistHandoffToBoulderSession()
    → tryWriteTaskStateForHandoff()       // tasks.jsonl
    → tryWriteDecisionLogForHandoff()     // decisions.jsonl
    → tryWriteQualityForHandoff()         // quality-history.md
    → tryDetectRisksForHandoff()          // risk-profile.md
    → tryWriteChangeImpactForHandoff()    // file-map.md
```

**All subordinate writers are private to `runtime-handoff-service.ts`**: `tryWriteTaskStateForHandoff`, `tryWriteDecisionLogForHandoff`, `tryWriteQualityForHandoff`, `tryDetectRisksForHandoff`, `tryWriteChangeImpactForHandoff`.

### 2.3 Two call sites that trigger `processHandoffInAgentResponse`

| Call Site | File | Line | Context |
|---|---|---|---|
| Sync task completion | `src/tools/delegate-task/sync-task.ts` | 329 | `result.textContent` available (full agent text response) |
| Background task completion | `src/features/background-agent/background-handoff-ingestor.ts` → `ingestHandoffFromBackgroundTask()` | 56 | Cached text from `validateSessionHasOutput()` via `handoffTextCache` |

## 3. Why Normal Completion Does Not Write Memory

### 3.1 The gate: `extractHandoffFromAgentResponse`

```typescript
// runtime-handoff-service.ts line 56-77
export function extractHandoffFromAgentResponse(textContent: string): HandoffBlock | null {
  const result = parseHandoffBlock(textContent)
  // Heuristic: if parsing produced nothing meaningful, treat as "no handoff"
  if (!result.status && !result.handoff && result.signals.length === 0) {
    return null    // ← NORMAL COMPLETION HITS THIS LINE
  }
  return result
}
```

When an agent completes a task normally, its final response typically contains:
- A summary paragraph
- File inspection lists
- Test results
- Risk notes

But **no** `STATUS: DONE` / `SIGNALS_EMITTED:` / `HANDOFF:` block. The handoff parser sees zero status, zero signals, zero handoff target, and returns `null` — causing `processHandoffInAgentResponse` to also return `null`, skipping all memory writes.

### 3.2 What normal completion text looks like vs. handoff text

```
NORMAL (no memory write):
  "Task completed. I fixed the bug in foo.ts. Tests pass. No risks."

HANDOFF (memory write triggers):
  "STATUS: DONE
  SIGNALS_EMITTED: [{"signal":"backend_ready","payload":{}}]
  HANDOFF: return_to_parent_for_routing"
```

### 3.3 The "Ultrawork mode" complication

The `nodejs-backend-architect` skill actively instructs agents to emit HANDOFF blocks. But not all agent skills do this consistently, and the base OpenCode agent system has no built-in HANDOFF requirement. Tasks delegated without architect-level instructions (most `task()` calls) typically produce normal completion text.

## 4. Relevant Files and Functions

### 4.1 Core memory writers (already exist)

| File | Key Export | Description |
|---|---|---|
| `src/shared/task-state-memory.ts` | `appendTaskEntry(projectRoot, entry)` | Append JSONL entry to `tasks.jsonl` with dedupe by content hash |
| `src/shared/decision-log.ts` | `appendDecisionEntry(projectRoot, entry)` | Append JSONL entry to `decisions.jsonl` with dedupe |
| `src/shared/memory-quality-writer.ts` | `writeQualityHistory(projectRoot, report)` | Prepend entry to `quality-history.md` with file lock |
| `src/shared/memory-risk-writer.ts` | `updateRiskProfile(projectRoot, changedFiles)` | Auto-detect risks from changed file paths, write to `risk-profile.md` |
| `src/shared/memory-change-impact.ts` | `appendChangeImpactEntries(projectRoot, paths, changeType, sessionId)` | Append entries to Change Impact Map in `file-map.md`, with dedupe |
| `src/shared/memory-decision-writer.ts` | `writeDecision(projectRoot, entry)` | Write to `decisions.md` with file lock and trigram dedupe |
| `src/shared/memory-manifest-updater.ts` | `refreshManifestAfterWrite(workingDir, absoluteFilePath)` | Refresh manifest when write/edit tools touch memory files |
| `src/shared/memory-bootstrap.ts` | `PROJECT_MEMORY_DIR` | `.opencode/state/memory` (canonical memory path) |

### 4.2 Handoff pipeline (handoff-only today)

| File | Key Function | Role |
|---|---|---|
| `src/features/hecateq-orchestration/handoff-parser.ts` | `parseHandoffBlock(input)` → `HandoffBlock` | Never throws; extracts structured fields from STATUS/SIGNALS/HANDOFF blocks |
| `src/features/hecateq-orchestration/runtime-handoff-service.ts` | `processHandoffInAgentResponse(textContent, directory, sessionId)` | Central function; extracts + persists handoff to 4 state surfaces + 5 memory files |
| `src/features/background-agent/background-handoff-ingestor.ts` | `ingestHandoffFromBackgroundTask(task, fetchMessagesText, directory)` | Wraps processHandoffInAgentResponse for background task context |

### 4.3 Completion/finalization points

| File | Function | Line | Available Data |
|---|---|---|---|
| `src/features/background-agent/manager.ts` | `tryCompleteTask(task, source)` | 2377-2397 | `task.sessionId`, `this.directory`, `this.handoffTextCache.get(sessionId)` (cached assistant text), `task.status`, `task.error`, `task.description`, `task.id`, `task.parentSessionId` |
| `src/features/background-agent/manager.ts` | `validateSessionHasOutput(sessionID)` | 2030-2102 | Fetches messages via SDk, caches last assistant text in `handoffTextCache` |
| `src/tools/delegate-task/sync-task.ts` | (inline after result fetch) | 323-329 | `result.textContent` (full agent text), `executorCtx.directory`, `activeSessionID` |
| `src/tools/delegate-task/sync-continuation.ts` | (parallel structure) | — | Similar to sync-task, also calls processHandoffInAgentResponse |

### 4.4 Event/message hooks (NOT safe for memory write triggers)

| File | Handler | Why Not Safe |
|---|---|---|
| `src/plugin/event.ts` | `session.idle` | Dedupe is per-500ms window; fires for every sub-session pause; no guarantee output is final |
| `src/plugin/event.ts` | `message.updated` (role=assistant, finish) | Fires per streaming chunk; false positives on partial output; cannot distinguish final vs. in-progress |
| `src/plugin/messages-transform.ts` | `experimental.chat.messages.transform` | Called before model receives context; no task output available |
| `src/plugin/chat-message.ts` | `chat.message` | Called on user messages only; no assistant completion data |

## 5. Runtime Flow Analysis

### 5.1 Normal assistant response (no background task, no delegate)

```
User sends prompt
  → chat.message hook fires (sets agent, applies model override, keyword detection)
  → messages.transform hook fires (context injection, thinking validation)
  → Model generates response
  → message.updated events fire (streaming chunks)
  → session.idle event fires (500ms dedupe window)
  → event handler dispatches to 24+ session hooks
  → NO handoff extraction (no background task completion path)
  → NO memory write
```

### 5.2 Background task completion

```
task() called with run_in_background=true
  → BackgroundManager.launch()
    → Creates session, sends prompt
    → Polling loop: 3s interval
      → session.idle detected OR session gone from status
      → validateSessionHasOutput(sessionID)  ← fetches messages, caches last assistant text
      → checkSessionTodos(sessionID)
      → tryCompleteTask(task, source)
        → Mark task completed
        → Release concurrency
        → ingestHandoffFromBackgroundTask(task, fetcher, directory)  ← uses cached text
          → processHandoffInAgentResponse(textContent, directory, sessionId)
            → extractHandoffFromAgentResponse → null if no HANDOFF block
            → ALL MEMORY WRITES SKIPPED (no HANDOFF block)
        → notifyParentSession(task)
          → buildBackgroundTaskNotificationText(task, duration, status, allComplete)
          → queuePendingParentWake → inject system-reminder into parent session
```

### 5.3 Sync task (delegate) completion

```
task() called with run_in_background=false
  → sync-task.ts executor
    → Creates session, sends prompt
    → Polls session.messages() until last message is assistant with no pending tools
    → fetchSyncResult(client, sessionID) → { ok, textContent }
    → processHandoffInAgentResponse(result.textContent, directory, sessionID)  ← line 329
      → extractHandoffFromAgentResponse → null if no HANDOFF block
      → ALL MEMORY WRITES SKIPPED (no HANDOFF block)
    → Returns formatted result to parent
```

### 5.4 Handoff completion (the only path that writes memory today)

```
Agent responds with HANDOFF block
  → sync-task.ts or background-handoff-ingestor calls processHandoffInAgentResponse
  → extractHandoffFromAgentResponse → returns HandoffBlock with status/signals/handoff/changedFiles/etc.
  → recordHandoffToOmoState(directory, handoff)
  → persistHandoffToContinuationMarker(directory, sessionId, handoff)
  → persistHandoffToBoulderSession(directory, workId, handoff)
  → tryWriteTaskStateForHandoff(handoff, directory, sessionId)    // tasks.jsonl
  → tryWriteDecisionLogForHandoff(handoff, directory, sessionId)  // decisions.jsonl
  → tryWriteQualityForHandoff(handoff, directory)                  // quality-history.md
  → tryDetectRisksForHandoff(handoff, directory)                  // risk-profile.md
  → tryWriteChangeImpactForHandoff(handoff, directory, sessionId)  // file-map.md
```

## 6. Candidate Integration Points

### Option A — Handoff-only Enhancement

**What**: Make existing handoff parsing more lenient or add more fields to the handoff block.

**Pros**:
- No new code paths
- Already tested

**Cons**:
- Does NOT solve the problem: tasks that don't produce HANDOFF blocks still write nothing
- Making parser more lenient risks false positives (random text matching STATUS/DONE)
- Handoff blocks are structurally specific; can't be derived from normal text

**Verdict**: REJECTED. Does not address the core problem.

### Option B — Background Task Completion Notification Path

**What**: At `BackgroundManager.tryCompleteTask()`, after handoff ingestion, call a new `commitTaskCompletionToMemory()` function that writes best-effort entries from available data.

**Data available**:
- `task.sessionId` — session ID (string)
- `this.directory` — project root / session directory (string)
- `this.handoffTextCache.get(task.sessionId)` — last assistant text (string, may be cached)
- `task.status` — "completed" | "error" | "cancelled" | "interrupt"
- `task.error` — error message if failed (string | undefined)
- `task.description` — task description (string)
- `task.id` — task ID (string, e.g., "bg_abc12345")
- `task.parentSessionId` — parent session ID (string)
- `task.agent` — agent name (string)

**Data NOT available (would be hallucinated if guessed)**:
- Changed files list (`HandoffBlock.changedFiles`) — only available from HANDOFF block
- Quality notes (`HandoffBlock.qualityNotes`) — only available from HANDOFF block
- Blockers (`HandoffBlock.blockers`) — only available from HANDOFF block
- Test results — not structured; could be extracted from text but fragile
- Confidence score — only from HANDOFF block

**Pros**:
- Safe: runs after task is confirmed complete (post validation, post todo check)
- Has cached assistant text via `handoffTextCache`
- Has session ID and directory
- Best-effort: failure does not affect task completion
- Already has the `ingestHandoffFromBackgroundTask` call right before (`tryCompleteTask` line 2383-2397)

**Cons**:
- No changed files list without HANDOFF block
- No structured quality notes without HANDOFF block
- Would need a "degraded" memory entry format (less rich than handoff-based entries)
- Only covers background tasks, not sync tasks (but sync-task.ts has same pattern)

**Verdict**: VIABLE primary target. Best safety profile.

### Option C — Chat/Message Final Assistant Response Path

**What**: Hook into `session.idle` or `message.updated` (role=assistant, finish=truthy) to detect final responses and write memory.

**Pros**:
- Covers all completion paths (background, sync, direct)

**Cons**:
- **Dedupe nightmare**: `session.idle` fires for every pause in every session. The 500ms dedupe window (`DEDUP_WINDOW_MS` in `event.ts`) is too coarse for distinguishing "assistant is done talking" from "assistant is thinking."
- **False positives**: `message.updated` with `finish` fires per streaming chunk completion, not per full response.
- **No task context**: The event handler has session ID but no task ID, no description, no parent context.
- **Prompt injection risk**: Writing memory at this level could write garbage from malformed responses.
- **Explicitly forbidden by constraints**: "Do not use session.idle as a proposed first implementation target unless there is already strict dedupe/finalization proof."

**Verdict**: REJECTED. Unsafe for first implementation.

### Option D — Explicit Final Report Parser

**What**: Create a new parser that extracts structured data from normal (non-HANDOFF) agent completion text: changed files from file lists, test status from test result blocks, decisions from decision markers.

**Pros**:
- Could work without HANDOFF blocks
- Could extract richer data than degraded entries

**Cons**:
- **Hallucination risk**: Parsing natural language for structured data is fragile. Agents format their output inconsistently.
- **Maintenance burden**: Every change to agent output format requires parser updates.
- **Does not solve the trigger problem**: still needs a safe finalization point to call the parser.

**Verdict**: Useful as an enhancement to Option B, not as a standalone solution.

### Option E — Hybrid: Background Completion + Minimal Memory Writer

**What**:
1. Create a new `task-completion-memory-commit.ts` module with a `commitTaskCompletionToMemory()` function
2. This function takes: `textContent`, `directory`, `sessionId`, and optional `taskMetadata` (description, agent, status)
3. It writes best-effort entries using the existing memory writers:
   - Always writes a `TaskStateEntry` (tasks.jsonl) with whatever data is available
   - If text is available, heuristically detects decision-like content for decisions.jsonl
   - If text mentions file paths, extracts them for risk-profile.md and file-map.md
   - If text mentions test results, writes to quality-history.md
   - Falls back to minimal entries when data is scarce
4. Wire it at:
   - `BackgroundManager.tryCompleteTask()` after the handoff ingestion attempt (line 2388-2397)
   - `sync-task.ts` after the handoff extraction attempt (line 329)
5. The function **never throws**, logs failures, and returns a summary of what was written

**Pros**:
- Reuses all existing memory writers (no new file formats)
- Best-effort: works with whatever data is available
- No HANDOFF block requirement
- Two safe, proven call sites with complete data context
- No prompt injection path changes
- No root/path discovery changes

**Cons**:
- Without HANDOFF block, changed files and quality notes are scarce/missing
- Heuristic text parsing can produce low-quality entries
- Two call sites to wire (but they follow the same code pattern)

**Verdict**: RECOMMENDED. Safest path to meaningful memory writes.

## 7. Best Integration Point Recommendation

### Primary: `BackgroundManager.tryCompleteTask()` — line ~2388

**Why this is the safest point:**

1. **Completion is proven**: The function is only called after:
   - `session.idle` detected (or session gone from status)
   - `validateSessionHasOutput()` confirmed assistant content exists
   - `checkSessionTodos()` confirmed no incomplete todos
   - Task status is still "running"

2. **Text content already cached**: `validateSessionHasOutput()` populates `this.handoffTextCache` with the last assistant text. The cache is used by `ingestHandoffFromBackgroundTask` immediately above the proposed insertion point.

3. **Session ID and directory available**: `task.sessionId` and `this.directory` are both available.

4. **Handoff ingestion already happens here**: The existing `ingestHandoffFromBackgroundTask` call (lines 2383-2397) proves this is a safe, proven finalization point. The proposed memory commit would run right after it, using the same cached text.

5. **No new SDK calls needed**: The text is already fetched by `validateSessionHasOutput`. No extra `session.messages()` fetch.

6. **Best-effort isolation**: The existing handoff ingestion is wrapped in `void ... .catch(...)`. The new memory commit would follow the same pattern, never blocking task completion.

### Secondary: `sync-task.ts` — line 329

Same pattern: `processHandoffInAgentResponse(result.textContent, ...)` is already called here. A `commitTaskCompletionToMemory(result.textContent, ...)` call right after would follow the same best-effort pattern.

## 8. Data Available at That Point

### Background task completion (`tryCompleteTask`)

| Field | Source | Always Available? |
|---|---|---|
| `sessionId` | `task.sessionId` | Yes (when task has a session) |
| `directory` | `this.directory` | Yes |
| `textContent` | `this.handoffTextCache.get(task.sessionId)` | Sometimes — only if `validateSessionHasOutput` cached it (usually yes at this point) |
| `taskStatus` | `task.status` | Yes — "completed", "error", "cancelled", "interrupt" |
| `taskDescription` | `task.description` | Yes |
| `taskId` | `task.id` | Yes |
| `parentSessionId` | `task.parentSessionId` | Yes |
| `agentName` | `task.agent` | Yes |
| `errorMessage` | `task.error` | Only on error |
| `changedFiles` | N/A — only from HANDOFF block | No |
| `qualityNotes` | N/A — only from HANDOFF block | No |
| `testResults` | N/A — only from HANDOFF block | No |
| `blockers` | N/A — only from HANDOFF block | No |
| `nextAction` | N/A — only from HANDOFF block | No |

### Sync task completion (`sync-task.ts` line 329)

| Field | Source | Always Available? |
|---|---|---|
| `sessionId` | `activeSessionID` | Yes |
| `directory` | `executorCtx.directory` | Yes |
| `textContent` | `result.textContent` | Yes (confirmed by `result.ok` check at line 324) |
| `taskStatus` | Implicitly "completed" (reached via `result.ok`) | Yes |
| `taskDescription` | `args.description ?? args.prompt` | Yes |
| `agentName` | `agentToUse` | Yes |
| `category` | `args.category` | Sometimes |

## 9. Dedupe Strategy

### 9.1 Existing dedupe mechanisms to reuse

1. **`task-state-memory.ts` `appendTaskEntry`**: Already dedupes by content hash (timestamp-excluded hash of all other fields). If the same task ID produces the same content, the append returns `false` and does not write.

2. **`decision-log.ts` `appendDecisionEntry`**: Same content hash dedupe pattern.

3. **`memory-change-impact.ts` `appendChangeImpactEntry`**: Dedupes by `path + changeType` combination. Same file with same change type is skipped.

4. **`memory-decision-writer.ts` `isDuplicateDecision`**: Trigram similarity check (threshold 0.8) against existing decisions.

### 9.2 Proposed dedupe for non-handoff completion

**Deterministic task ID**:
```typescript
function deterministicCompletionTaskId(sessionId: string): string {
  return `task-${sessionId}`  // or hash-based like handoff task IDs
}
```

This ensures:
- Same session always produces same task ID
- Re-completion (resume, retry) overwrites with latest data (latest entry wins in `resolveLatestTaskState`)
- No duplicate entries from re-notifications

**Content hash dedupe**: Reuse the existing `contentHash()` function from `task-state-memory.ts`. If a previous write for this task ID has identical content, skip.

### 9.3 Why session.idle is NOT safe for dedupe

The `event.ts` dedupe window is 500ms. A task that generates 3 consecutive `session.idle` events within 500ms would only fire the hook once — but that single fire might happen before the final assistant message arrives. The existing dedupe is designed for hook dispatch prevention, not for "is task truly complete" detection.

## 10. Failure Behavior

### 10.1 Required failure contract

```
commitTaskCompletionToMemory(...)
  → ALWAYS returns (never throws, never rejects)
  → Logs all failures via existing logger
  → Returns { attempted: boolean, written: string[] } describing what was written
  → Task completion proceeds regardless of memory write outcome
```

### 10.2 Specific failure modes

| Failure | Handling |
|---|---|
| `ensureMemoryDir` fails (can't create directory) | Log warning, skip all writes, return `{ attempted: false }` |
| `appendTaskEntry` throws | Catch, log error, continue to next writer |
| `appendDecisionEntry` throws | Catch, log error, continue |
| `writeQualityHistory` lock acquisition fails | Skip (existing behavior in quality writer) |
| `updateRiskProfile` lock acquisition fails | Skip (proceeds without lock in risk writer) |
| `appendChangeImpactEntries` throws | Catch, log error, continue |
| No text content available (cache miss) | Write minimal entry (just task status) or skip text-dependent writers |
| File system full | Individual writer catches, logs, continues |
| Malformed text (garbage in assistant output) | Heuristic parsers return empty/fallback results |

### 10.3 Memory write failure does NOT affect

- Task completion status
- Parent notification (background task notification template)
- Toast/UI notifications
- Run continuation markers
- Handoff state (separate code path)
- Boulder state (separate code path)

## 11. What Not To Touch

Explicit DENY list per constraints:

| Area | Files | Reason |
|---|---|---|
| Root discovery | `src/shared/memory-bootstrap.ts` `findProjectRoot()` | Constraint: "Do not change root discovery" |
| Prompt injection | `src/features/context-injector/`, `src/plugin/messages-transform.ts`, `src/hooks/hecateq-project-context-injector/` | Constraint: "Do not change prompt injection order", "do not change context injection formatting" |
| Install flow | `src/cli/install/` | Constraint: "Do not change install flow" |
| Category routing | `src/tools/delegate-task/category-resolver.ts`, `src/shared/model-requirements.ts` | Constraint: "Do not change category routing" |
| Config schema | `src/config/schema/` (all files) | Constraint: "Do not modify config schema files" |
| package.json / versions | `package.json`, `src/cli/get-local-version.ts` | Constraint |
| Generated files | `src/generated/`, `assets/` | Constraint |
| OmoStateManager path drift | `src/features/hecateq-orchestration/omo-state-manager.ts` | Constraint |
| New top-level memory documents | No new `.md` files in `.opencode/state/memory/` | Constraint |
| `session.idle` as memory write trigger | `src/plugin/event.ts` `session.idle` handler | Too fragile for first implementation |
| `dispatchInternalPrompt` / `promptAsync` for memory writes | `src/hooks/shared/prompt-async-gate.ts` | Constraint: "Do not call dispatchInternalPrompt or promptAsync for memory writes" |
| `resolveSessionRoot` | `src/shared/memory-bootstrap.ts` | Constraint: "Do not change resolveSessionRoot behavior" |
| `empty_session_directory` | `src/shared/memory-bootstrap.ts` | Constraint: "Do not change empty_session_directory behavior" |
| `projectRoot/sessionDirectory/worktreeRoot/packageRoot` semantics | All files | Constraint: "Do not change ... semantics" |

## 12. Minimal Implementation Plan

### Phase 1: Extract and Refactor (no behavior change)

1. **Create `src/shared/task-completion-memory-commit.ts`**

   Export a single function:
   ```typescript
   export function commitTaskCompletionToMemory(args: {
     textContent: string          // last assistant text (may be empty)
     directory: string            // project root directory
     sessionId: string            // child/task session ID
     taskDescription?: string     // e.g., "Fix bug in foo.ts"
     taskStatus?: string          // "completed" | "error" | "cancelled" | "interrupt"
     agentName?: string           // e.g., "hephaestus"
     parentSessionId?: string
     errorMessage?: string
   }): TaskCompletionMemoryResult
   ```

2. **Reuse existing writers directly** — do NOT call `processHandoffInAgentResponse`:
   - Call `appendTaskEntry(directory, entry)` from `task-state-memory.ts`
   - Call `appendDecisionEntry(directory, entry)` from `decision-log.ts` (only if text has decision-like keywords)
   - Call `writeQualityHistory(directory, report)` from `memory-quality-writer.ts` (only if text has test-like markers)
   - Call `updateRiskProfile(directory, changedFilePaths)` from `memory-risk-writer.ts` (only if text contains file paths)
   - Call `appendChangeImpactEntries(directory, paths, "modified", sessionId)` from `memory-change-impact.ts`

3. **Build task entry from available data**:
   ```typescript
   {
     version: 1,
     id: deterministicCompletionTaskId(sessionId),
     timestamp: new Date().toISOString(),
     action: taskStatus === "error" ? "block" : "complete",
     title: taskDescription ?? `Task ${sessionId}`,
     status: taskStatus === "error" ? "blocked" : "completed",
     owner_agent: agentName,
     source_session_id: sessionId,
     related_sessions: parentSessionId ? [parentSessionId, sessionId] : [sessionId],
     // changed_files, verification, next_action: only if extractable
     metadata: { completion_source: "non_handoff", session_id: sessionId },
   }
   ```

4. **Best-effort text extraction** (heuristic, non-fragile):
   - File paths: regex `/[*`\`](\/?[\w./-]+\.[\w]+)[*`\`]/g` on textContent
   - Test results: look for "tests passed" / "tests failed" / "\d+ passed" patterns
   - Decisions: reuse `handoffContainsDecisionSignal()` heuristic from `runtime-handoff-service.ts` line 410

### Phase 2: Wire at Background Task Completion

1. **In `BackgroundManager.tryCompleteTask()`**, after line 2397 (end of handoff ingestion block), add:
   ```typescript
   // Best-effort non-handoff memory commit for normal task completion.
   // Uses the same cached text from validateSessionHasOutput.
   // Must never throw; failures are logged.
   if (task.sessionId) {
     const cachedText = this.handoffTextCache.get(task.sessionId) ?? ""
     void Promise.resolve().then(() => {
       try {
         commitTaskCompletionToMemory({
           textContent: cachedText,
           directory: this.directory,
           sessionId: task.sessionId!,
           taskDescription: task.description,
           taskStatus: task.status,
           agentName: task.agent,
           parentSessionId: task.parentSessionId,
           errorMessage: task.error,
         })
       } catch (err) {
         log("[background-agent] Non-handoff memory commit failed (best-effort):", {
           taskId: task.id,
           error: err instanceof Error ? err.message : String(err),
         })
       }
     })
   }
   ```

2. **Note on handoffTextCache**: If the task completed with a HANDOFF block, `processHandoffInAgentResponse` already consumed and deleted the cache entry (`this.handoffTextCache.delete(task.sessionId)` at line 2386). In that case, the non-handoff commit gets `""` text and writes a minimal entry. This is correct — the handoff path already wrote rich entries. If `cachedText` was not consumed (no HANDOFF block), it remains in cache for the non-handoff commit.

   **Correction needed**: Currently at line 2386 the cache is deleted regardless of whether ingestion happened. For the non-handoff path, the text should be preserved. Implementation should either:
   - Move the cache delete to after both handoff and non-handoff commit attempts
   - Or read the cached text before the handoff ingestion block

### Phase 3: Wire at Sync Task Completion

1. **In `sync-task.ts`**, after line 329 (`processHandoffInAgentResponse(...)`), add:
   ```typescript
   // Best-effort non-handoff memory commit
   try {
     commitTaskCompletionToMemory({
       textContent: result.textContent,
       directory: executorCtx.directory,
       sessionId: activeSessionID,
       taskDescription: args.description ?? args.prompt,
       taskStatus: "completed",
       agentName: agentToUse,
     })
   } catch {
     // Best-effort: never fail task completion
   }
   ```

### Phase 4: Tests

See Section 13 below.

## 13. Tests Needed

### 13.1 Unit tests for `task-completion-memory-commit.ts`

| Test | Description |
|---|---|
| `writes minimal task entry when text content is empty` | `commitTaskCompletionToMemory({ textContent: "", ... })` → verifies `tasks.jsonl` has one entry with status "completed" |
| `writes task entry with description from metadata` | Verifies entry.title matches `taskDescription` param |
| `writes error task entry when taskStatus is "error"` | Verifies `action: "block"`, `status: "blocked"`, `blockers` includes error message |
| `extracts file paths from text content` | Text containing `` `src/foo.ts` `` → verifies `changed_files` in task entry |
| `writes quality history when text mentions test results` | Text "12 tests passed, 0 failed" → verifies `quality-history.md` update |
| `writes risk profile when text mentions sensitive files` | Text mentions `.env` → verifies `risk-profile.md` has security entry |
| `dedupes: does not write duplicate task entry for same session` | Two calls with same sessionId + same data → second call returns `{ written: [] }` |
| `never throws even when directory is unwritable` | Pass read-only directory → function returns without throwing |
| `skips decision log when text has no decision keywords` | Normal summary text → `decisions.jsonl` unchanged |
| `writes change impact when text mentions file paths` | Text with file paths → verifies `file-map.md` Change Impact Map updated |

### 13.2 Integration tests

| Test | Description |
|---|---|
| `background task completion triggers memory commit` | Launch background task, let it complete, verify `tasks.jsonl` has new entry for the task session |
| `background task completion without HANDOFF block still writes memory` | Task that completes with plain text → verify memory files updated |
| `background task completion with HANDOFF block does not double-write` | Task with HANDOFF → verify exactly one task entry per session |
| `sync task completion triggers memory commit` | Sync task → verify `tasks.jsonl` updated |
| `memory write failure does not prevent task completion` | Inject failing writer → verify task still returns result to parent |

### 13.3 Existing test files to reference for patterns

| File | Pattern to Follow |
|---|---|
| `src/features/background-agent/background-handoff-ingestor.test.ts` | Testing handoff ingestion in background task context |
| `src/features/hecateq-orchestration/runtime-handoff-service.test.ts` | Testing handoff processing and memory writes |
| `src/features/background-agent/manager.test.ts` | Testing BackgroundManager lifecycle |
| `src/features/background-agent/task-poller.test.ts` | Testing task completion detection |
| `src/shared/task-state-memory.ts` (tests colocated) | Dedupe tests for task state writes |

## 14. Final Recommendation

### 14.1 Recommended approach

**Implement `task-completion-memory-commit.ts`** as a new shared module that writes best-effort memory entries using existing writers, wired at `BackgroundManager.tryCompleteTask()` and `sync-task.ts`.

### 14.2 Why this over alternatives

| Alternative | Why Rejected |
|---|---|
| Handoff-only enhancement | Does not solve the core problem |
| session.idle hook | No safe dedupe/finalization; explicit constraint violation |
| message.updated hook | False positives; no task context |
| Explicit final report parser | Hallucination risk; still needs safe trigger point |
| New memory format | Violates "no new top-level memory documents" constraint |

### 14.3 Risk assessment

| Risk | Mitigation |
|---|---|
| Memory entries without changed files list are less useful | Acceptable trade-off; HANDOFF blocks already write rich entries; non-handoff entries are supplementary |
| Heuristic file path extraction may produce false positives | Use conservative regex; only match patterns like backtick-wrapped paths; skip if no match |
| Double writes (handoff + non-handoff for same task) | handoffTextCache deletion gates non-handoff text; task ID dedupe prevents duplicate JSONL entries |
| Cache timing issue (text deleted before non-handoff commit) | Move cache delete to after both commits; see Phase 2 note in Section 12 |

### 14.4 Confidence level: HIGH

The integration point (`tryCompleteTask`) is proven safe by the existing handoff ingestion code running at the exact same location. The new code follows the same best-effort, never-throw pattern. All memory writers already exist and are production-tested by the handoff path.

## 15. Next Implementation Prompt

If this research is approved, delegate to `nodejs-backend-developer` with:

```
Task: Implement `task-completion-memory-commit.ts`

Create `src/shared/task-completion-memory-commit.ts` with a
`commitTaskCompletionToMemory()` function that writes best-effort memory
entries for normal (non-HANDOFF) task completion.

Requirements:
1. Takes: { textContent, directory, sessionId, taskDescription?,
   taskStatus?, agentName?, parentSessionId?, errorMessage? }
2. Always writes a TaskStateEntry to tasks.jsonl (via appendTaskEntry)
3. Writes DecisionLogEntry to decisions.jsonl only when text contains
   decision-like keywords (reuse handoffContainsDecisionSignal heuristic
   from runtime-handoff-service.ts)
4. Writes quality-history.md only when text mentions test results
5. Writes risk-profile.md only when text mentions files matching
   RISK_DETECTION_RULES patterns
6. Writes file-map.md Change Impact Map when text contains recognizable
   file paths (backtick-wrapped or absolute paths)
7. Uses deterministic task ID: `task-{sessionId}`
8. Never throws; all failures logged; returns { attempted, written[] }
9. Reuses content hash dedupe from existing writers

Wire at:
- `BackgroundManager.tryCompleteTask()` after handoff ingestion block
  (reuse cached text from handoffTextCache; move cache delete after both commits)
- `sync-task.ts` after processHandoffInAgentResponse call (line 329)

Tests:
- Unit tests for commitTaskCompletionToMemory with empty/rich/minimal text
- Integration tests verifying background and sync task completion writes memory

Do NOT:
- Create new memory file formats (no new .md/.jsonl files)
- Change root discovery, prompt injection, context formatting
- Call dispatchInternalPrompt or promptAsync
- Use session.idle as trigger
- Modify config schema, package.json, generated files
```

---

## Document Metadata

- **Research Date**: 2026-06-01
- **Researcher**: nodejs-backend-architect
- **Status**: Complete (no source code changes)
- **Files Inspected**: 22 source files (see below)
- **Files Changed**: 1 (this report only)

### Files Inspected

| File | Reason |
|---|---|
| `src/features/hecateq-orchestration/runtime-handoff-service.ts` (688 lines) | Central handoff processing; all memory write helpers are here |
| `src/features/hecateq-orchestration/handoff-parser.ts` (285 lines) | HandoffBlock type definition; parser heuristic that returns null for non-handoff text |
| `src/features/background-agent/manager.ts` (2990 lines) | BackgroundManager class; tryCompleteTask (line 2377), validateSessionHasOutput (line 2030), handoffTextCache (line 269) |
| `src/features/background-agent/background-handoff-ingestor.ts` (122 lines) | Background task handoff ingestion wrapper |
| `src/features/background-agent/background-task-notification-template.ts` (123 lines) | Parent notification template; confirms notification is separate from memory write |
| `src/plugin/event.ts` (1042 lines) | Event handler; session.idle dedupe (500ms window), message.updated handler |
| `src/plugin/messages-transform.ts` (245 lines) | Messages transform hook; not suitable for memory writes |
| `src/plugin/chat-message.ts` (338 lines) | Chat message handler; fires on user messages only |
| `src/tools/delegate-task/sync-task.ts` (386 lines) | Sync task execution; line 329 calls processHandoffInAgentResponse |
| `src/shared/task-state-memory.ts` (334 lines) | tasks.jsonl writer with content hash dedupe |
| `src/shared/decision-log.ts` (362 lines) | decisions.jsonl writer with content hash dedupe |
| `src/shared/memory-quality-writer.ts` (234 lines) | quality-history.md writer with file lock |
| `src/shared/memory-risk-writer.ts` (414 lines) | risk-profile.md writer with RISK_DETECTION_RULES |
| `src/shared/memory-change-impact.ts` (273 lines) | file-map.md Change Impact Map writer with dedupe |
| `src/shared/memory-decision-writer.ts` (220 lines) | decisions.md writer with trigram dedupe |
| `src/shared/memory-manifest-updater.ts` (204 lines) | Manifest refresh on tool write/edit |
| `src/shared/memory-bootstrap.ts` (679 lines, sampled 50) | PROJECT_MEMORY_DIR constant (.opencode/state/memory) |
| `src/features/background-agent/session-idle-event-handler.ts` | Cited by grep for validateSessionHasOutput |
| `src/features/background-agent/session-idle-event-handler.test.ts` | Test patterns for session idle handling |
| `src/features/background-agent/background-handoff-ingestor.test.ts` | Test patterns for handoff ingestion |
| `src/features/hecateq-orchestration/runtime-handoff-service.test.ts` | Test patterns for handoff processing |
| `src/features/hecateq-orchestration/index.ts` | Barrel export confirming processHandoffInAgentResponse is public |

---

STATUS: DONE
SIGNALS_EMITTED: [{"signal":"backend_arch_ready","payload":{"report":"TASK_COMPLETION_MEMORY_COMMIT_INTEGRATION_RESEARCH.md","recommendation":"Option E - Hybrid: create task-completion-memory-commit.ts wired at BackgroundManager.tryCompleteTask and sync-task.ts","confidence":"high"}}]
HANDOFF: return_to_parent_for_routing
