# Subagent Todo Visibility Research Report

**Date:** 2026-06-01
**Author:** technical-writer-documentarian
**Scope:** Research-only — no code implementation
**Status:** Complete (no changes made)

---

## 1. Executive Summary

When work is delegated to a subagent (via `task(run_in_background=true)`, `task(run_in_background=false)`, or `call_omo_agent`), the child session creates and manages its own todos independently. **The parent/main session does not show the child's todo progress** unless the user manually opens the child session. This is a combination of:

1. **OpenCode API design**: The `session.todo()` API is strictly per-session. There is no cross-session todo query, and no plugin hook can inject foreign todos into another session's TUI.
2. **Plugin design**: The plugin's `TodoWrite`/`TodoRead` tool wrappers, `todo-sync.ts`, and `todoContinuationEnforcer` all operate on a single session ID. The background-task notification system (`parentWakeNotifier`) sends completion/error summaries as system messages — not todo updates.
3. **No existing mirroring infrastructure**: No code path copies, summarizes, or mirrors child todos into a parent session.

**Verdict**: This is **expected OpenCode behavior** combined with a **plugin-level gap**. It is partially solvable plugin-side (Option D — incremental parent-wake progress summaries from child session events), but full mirroring (Option A) is **not safely solvable** without OpenCode API changes.

---

## 2. Current Behavior

### Delegation Flow (Evidence)

| Step | Component | What Happens |
|------|-----------|-------------|
| 1 | `task()` tool | `src/tools/delegate-task/executor.ts` routes to `executeBackgroundTask()` or `executeSyncTask()` |
| 2 | Background launch | `src/tools/delegate-task/background-task.ts:100-219` calls `manager.launch()` which creates a child OpenCode session via `client.session.create()`, stores `parentSessionId` on the `BackgroundTask` |
| 3 | Child session lifecycle | The child session gets its own independent todo list via standard OpenCode mechanisms |
| 4 | Child completion | `src/features/background-agent/task-poller.ts` polls child session status (3s interval), detects idle via `session.idle` events and stability (10s unchanged) |
| 5 | Parent notification | `notifyParentSession()` at `manager.ts:2410-2525` builds a completion/error text, injects it into the parent via `ParentWakeNotifier` |
| 6 | Parent wake | `ParentWakeNotifier.flushPendingParentWake()` at `parent-wake-notifier.ts:169-340` calls `dispatchInternalPrompt()` to inject a system `<system-reminder>` message into the parent session |

### What the Parent Sees (Evidence)

The parent receives **only completion/error summary text** via `buildBackgroundTaskNotificationText()` (referenced at `manager.ts:2469`). The notification text includes:
- Task ID, description, duration
- Status (COMPLETED/ERROR/INTERRUPTED/CANCELLED)
- For batch completions: a summary of all completed subtasks
- **No individual child todo items**
- **No incremental progress updates**
- **No ongoing status while child works**

### What the Parent Does NOT See

- Child session's todo list
- Child session's current step/progress
- Child session's tool calls
- Child session's intermediate results
- Number of child todos completed/total

---

## 3. Root Cause

### 3.1 OpenCode API Limitation (Verified)

The OpenCode SDK exposes `ctx.client.session.todo({ path: { id: sessionID } })` which fetches todos for **exactly one session**. There is no:
- `session.todo({ parentID })` to get descendant todos
- `session.todo({ sessionIDs: [] })` for batch query
- Event that carries child todo state across sessions
- Hook that lets a plugin modify another session's todo display

### 3.2 Plugin Session Isolation (Verified)

Each OpenCode session is a fully independent entity. The plugin maintains:
- `tasksByParentSession: Map<string, Set<string>>` at `manager.ts:234` — maps parent session IDs to child task IDs
- `TaskHistory` at `task-history.ts:16-78` — stores per-parent metadata (id, agent, description, status, category, sessionID)
- **Neither of these stores todo data** from child sessions

### 3.3 No Todo Forwarding (Verified)

The `backgroundNotificationHook` at `src/hooks/background-notification/hook.ts` forwards OpenCode events to the `BackgroundManager.handleEvent()`:
- `FORWARDED_EVENT_TYPES` includes `"todo.updated"` but the handler (`manager.ts:2620-2630`) does NOT capture todo state — it only checks if events are task-relevant for completion detection
- The `checkSessionTodos()` method at `manager.ts:1405-1434` only checks **if the child has incomplete todos** (for stability detection), it does not extract or forward todo content

### 3.4 Compact Result Guidance (Mitigation, Not Solution)

The `COMPACT_RESULT_GUIDANCE` at `prompt-builder.ts:9-15` asks subagents to return structured compact results. This improves the _final result text_ but does NOT provide **incremental visibility** during the subagent's work.

---

## 4. Relevant Files

| File | Purpose | Relevance |
|------|---------|-----------|
| `src/tools/delegate-task/background-task.ts` | Launches background subagents via BackgroundManager | Creates parent session link via `parentSessionId` |
| `src/tools/delegate-task/executor.ts` | Routes to background or sync execution | Entry point for delegation |
| `src/tools/delegate-task/prompt-builder.ts` | Builds subagent prompt with COMPACT_RESULT_GUIDANCE | Only structured output, no todo mirroring |
| `src/features/background-agent/manager.ts` | BackgroundManager — main task lifecycle manager | `notifyParentSession()` at line 2410, `checkSessionTodos()` at line 1405 |
| `src/features/background-agent/types.ts` | BackgroundTask, TaskProgress types | Progress only tracks `toolCalls`, `lastMessage` — no todos |
| `src/features/background-agent/task-history.ts` | TaskHistory — per-parent task metadata | Stores agent/description/status/sessionID — no todos |
| `src/features/background-agent/task-poller.ts` | 3s polling loop for child session completion | Detects idle, not todo state |
| `src/features/background-agent/parent-wake-notifier.ts` | ParentWakeNotifier | Injects system messages into parent — no todo sync |
| `src/hooks/background-notification/hook.ts` | Event forwarding to BackgroundManager | Forwards `todo.updated` but only for completion detection |
| `src/hooks/todo-continuation-enforcer/idle-event.ts` | Boulder — checks parent todos for continuation | Only checks **local** session todos |
| `src/tools/task/todo-sync.ts` | Syncs Sisyphus tasks to OpenCode todos | Per-session, not cross-session |
| `src/plugin/event.ts` | Event handler — dispatches to all hooks | Manages session lifecycle, no child todo forwarding |
| `src/hooks/shared/prompt-async-gate.ts` | `dispatchInternalPrompt()` — safe message injection | Used by parent-wake, no todo-specific path |
| `src/tools/delegate-task/constants.ts` | `COMPACT_RESULT_GUIDANCE` text | Only affects final result structure |
| `src/features/background-agent/background-task-notification-template.ts` | Notification text template | Completion-only, no ongoing progress |

---

## 5. Runtime Flow Diagram (Text Form)

```
Parent Session                       BackgroundManager            Child Session (Subagent)
═══════════════                      ═══════════════════          ════════════════════════
                                                                  
1. task(run_in_background=true)                                    
   ─────────────────────────→  2. manager.launch()                  
                                    │                              
                                    ├─→ 3. client.session.create() 
                                    │         ──────────────────→  
                                    │                              │
                                    │         4. Creates own todos 
                                    │            (TodoWrite/TodoRead)
                                    │                              │
                                    ├─→ 5. startPolling()           
                                    │     3s loop:                 
                                    │     check session.status     
                                    │     check session.idle       
                                    │     check hasOutput()        
                                    │     check checkSessionTodos()
                                    │     (incomplete? only for    
                                    │      stability detection)    
                                    │                              │
                                    │       6. session.idle event  
                                    │         ←────────────────────
                                    │                              │
                                    ├─→ 7. notifyParentSession()   
                                    │     build notification text  
                                    │     (completion/error only)  
                                    │     ✓ No child todo data     
                                    │     ✓ No incremental updates 
                                    │                              │
8. Parent-wake system message       │                              
   ←─────────────────────────────────                              
   "Background task completed:                                      
    Task ID: bg_abc123                                              
    Description: fix typo in README                                 
    Status: completed"                                              
                                                                    
   ⚠ Parent TODOs are UNAFFECTED                                    
   ⚠ Child TODOs remain invisible to parent                         
   ⚠ No progress visibility during execution                        
```

---

## 6. Todo State Ownership Analysis

### Current State

| Aspect | Parent Session | Child Session |
|--------|---------------|---------------|
| Todo list owned by | OpenCode session, managed by OpenCode TUI | Same, independent |
| Accessed via | `client.session.todo({ path: { id: parentID } })` | `client.session.todo({ path: { id: childID } })` |
| Modified via | `TodoWrite` tool or `Todo.update()` | Same |
| Continuation enforcer | `todoContinuationEnforcer` checks these todos | Same (separate instance) |
| Visible in TUI | ✅ Yes | ❌ Not unless user opens it |
| Parent can read | ✅ Yes (any session ID) | ⚠ Yes, but only if it knows the child session ID |
| Incremental updates | ❌ No — only on completion | N/A |

### Key Insight

The plugin has the **technical ability** to read child session todos via `client.session.todo({ path: { id: childSessionID } })`. The BackgroundManager already stores `sessionId` on `BackgroundTask` objects (`types.ts:46`). This means the parent **could** poll child todos, but:

1. **No event-driven trigger**: `todo.updated` events from child sessions arrive at the parent's `event` hook via `backgroundNotificationHook`, but the handler doesn't extract todo content
2. **No parent-side todo write path**: While the plugin can write to the parent session's todos via `Todo.update()`, doing so every time a child todo changes would create a high-frequency write storm
3. **Semantic conflict**: Parent todos and child todos have different contexts. Injecting child todos into the parent list would mix concerns and confuse the parent agent/boulder

---

## 7. Parent/Child Session Event Analysis

### Events the Plugin Receives

The `event` handler (`src/plugin/event.ts:581-1041`) processes ALL OpenCode events for ALL sessions. For each event type:

| Event Type | Received? | Used for Child Todo Visibility? |
|------------|-----------|-------------------------------|
| `session.created` | ✅ Yes (line 661) | Tracks subagent sessions |
| `session.idle` | ✅ Yes (line 591) | Used for completion detection |
| `session.error` | ✅ Yes (line 933) | Used for error handling |
| `session.deleted` | ✅ Yes (line 699) | Cleanup |
| `session.status` | ✅ Yes (line 862) | Model fallback only |
| `message.updated` | ✅ Yes (line 776) | Model fallback, NOT todo tracking |
| `message.part.updated` | ✅ Forwarded to BackgroundManager | Completion detection only |
| `todo.updated` | ✅ Forwarded via `backgroundNotificationHook` | `FORWARDED_EVENT_TYPES` includes it, but handler does NOT extract todo data |
| `message.part.delta` | ✅ Forwarded | Not used for progress |

### Critical Gap

`todo.updated` events from child sessions **do reach the plugin** (via the event hook), but:

1. `backgroundNotificationHook.event()` at `hook.ts:39` calls `manager.handleEvent(event)` only
2. `handleEvent()` at `manager.ts:2620-2630` checks if the event is from a tracked background session, then uses it ONLY for stability detection (last activity timestamp update)
3. **Neither the event handler nor the manager extracts what child todos changed or forwards them to the parent**

---

## 8. Background/Subagent Progress Handling

### Current Progress Tracking

The `TaskProgress` interface (`types.ts:19-27`) tracks:
```typescript
interface TaskProgress {
  toolCalls: number           // Count of tool calls made
  lastTool?: string           // Last tool name
  toolCallWindow?: ToolCallWindow  // Circuit breaker data
  countedToolPartIDs?: Set<string> // Dedup set
  lastUpdate: Date            // Last activity timestamp
  lastMessage?: string        // Last message content
  lastMessageAt?: Date        // Last message timestamp
}
```

### Progress Exposure to Parent

| Visibility Point | Current Behavior |
|-----------------|-----------------|
| `background_output` tool | Returns session messages (full) — parent can read child output manually |
| `notifyParentSession()` | Only fires on completion/error |
| `injectPendingNotificationsIntoChatMessage()` | Fires via `chat.message` hook when parent sends a message |
| Compaction context | `TaskHistory.formatForCompaction()` includes task metadata but not progress |
| Parent wake system messages | Completion-only summaries |

### What's Missing

1. **No mid-execution progress push** to parent (tool calls, messages, status updates during execution)
2. **No todo count/status forwarding** (2/5 done, current step description)
3. **No selective child output streaming** (which files were changed, what tests passed)
4. **No structured artifact generation** during child execution for parent consumption

---

## 9. Parent UI/TUI Limitation Analysis

### OpenCode TUI Todo Display

The OpenCode TUI displays todos for the **currently active session only**. The plugin has no access to:
- Modify which session's todos are displayed in the TUI
- Add "foreign" todos to the TUI display
- Create category headers or visual separators between parent and child todos
- Show hierarchical/nested todos

### Plugin Hook Capabilities

| Hook | Can Modify Parent Todo Display? | Evidence |
|------|-------------------------------|----------|
| `chat.message` | ❌ No — only handles user messages | `src/plugin/chat-message.ts` |
| `chat.params` | ❌ No — only model params | `src/plugin/chat-params.ts` |
| `messages.transform` | ❌ No — only system/message injection | `src/plugin/messages-transform.ts` |
| `tool.execute.before/after` | ❌ No — tool guards only | `src/plugin/tool-execute-before.ts` |
| `event` | ❌ No — event-only | `src/plugin/event.ts` |

The only way to get information into the parent session is:
1. **System message injection** via `dispatchInternalPrompt()` (used by parent-wake) — Appears as `<system-reminder>` in the parent's chat, NOT in the todo panel
2. **Todo `Todo.update()`** — Can write to parent session's todo list, but only parent-session-scoped

### Safe Alternatives to Parent Todo Manipulation

| Mechanism | Safe? | Visibility |
|-----------|-------|------------|
| Parent system message | ✅ Yes | Chat only |
| Parent todo synthetic entries | ⚠ Risky (semantic conflict) | Todo panel |
| Memory file artifacts | ✅ Yes | File system |
| Background task metadata | ✅ Yes | Via `background_output` |
| Hecateq task graph state files | ✅ Yes | File system |

---

## 10. UX Problem Analysis

### User Pain Points

| Scenario | UX Impact |
|----------|-----------|
| User delegates 3 parallel background tasks | Parent shows no progress; user must open each child session to check status |
| Subagent encounter an error mid-task | Parent only notified on task termination, not at error time |
| Subagent is running for 5+ minutes | Parent has no visibility into what step is taking so long |
| User wants to see "what's left" across all subagents | Must manually open each child session |
| Boulder continuation in parent | Only sees parent todos, has no context about child work remaining |

### Current Workarounds (Insufficient)

1. `background_output(task_id="bg_abc123")` — Manual polling by the parent agent, only after notification
2. `session_read(session_id="ses_...")` — Manual child session inspection, requires knowing session ID
3. Compact Result Guidance — Only helps with final results, not mid-execution progress

---

## 11. Solution Options A–E

### Option A: Parent Todo Mirroring

Mirror child todos into the parent session's todo list.

**Mechanism**: On receiving child `todo.updated` events, extract child todo state and use `Todo.update()` on the parent session to add child todos alongside parent todos.

**Pros:**
- Direct TUI visibility (parent sees child todos in the todo panel)
- Reuses existing `todo-sync.ts` infrastructure
- No new UI elements needed

**Cons:**
- **HIGH RISK**: Semantic conflict — parent todos and child todos have different contexts. The boulder continuation enforcer would interpret child todos as pending work for the parent agent
- **HIGH RISK**: Write duplication storm — each child todo change triggers a parent todo update. With N child sessions each updating M todos, this is N×M writes to the parent
- The parent agent might try to complete child todos itself
- Todo IDs would collide or need namespacing
- If child is cancelled, parent must clean up mirror todos
- **Not safely solvable plugin-side** without OpenCode changes for todo namespacing

**Feasibility**: 🔴 **Not recommended** — too risky, no clean rollback, semantic conflicts

---

### Option B: Parent Progress Summary Todo

Maintain a single "summary todo" in the parent session that reflects aggregate child progress.

**Mechanism**: Create/update one parent todo like "3 background tasks: 1/3 complete" or "Subagent: refactoring auth.ts". Update on child completion and significant events.

**Pros:**
- Single todo, minimal TUI footprint
- Low write frequency (only on child state changes)
- Easy to understand for parent agent and human
- Can show "2 tasks pending, 1 running"

**Cons:**
- No detailed visibility into individual child steps
- Parent agent may mark the summary todo as complete
- Still requires suppressing boulder from acting on it
- Loses individual child todo detail
- Summary must be rebuilt from scratch if parent is compacted

**Feasibility**: 🟡 **Moderate risk** — requires `todowrite`-disabler gating and careful dedup

---

### Option C: Dedicated Structured Progress Artifact

Write a structured file (JSON/MD) that the parent agent can read for subagent progress.

**Mechanism**: On child `todo.updated` and `message.updated` events, update a file like `.omo/background/{taskID}-progress.json` with current child todo state. The parent agent is instructed to read this file when needed, and a system message hints at its existence.

**Pros:**
- Zero impact on parent todo list
- No semantic conflict with boulder
- Rich structured data possible (which steps done, which failed, current tool)
- Survives compaction (file system)
- No OpenCode API changes needed

**Cons:**
- No TUI visibility — user must read chat/file
- Parent agent must be instructed to check the artifact
- Adds file I/O on every child todo change
- Cleanup burden (removing artifacts when parent/child complete)
- Parent must explicitly read — not pushed

**Feasibility**: 🟢 **Low risk** — safe, no todo manipulation, no semantic conflict

---

### Option D: Parent Wake Incremental Updates

Send periodic parent-wake system messages during child execution, not just on completion.

**Mechanism**: Add a progress-push timer to `BackgroundManager` that periodically (every 30-60s or on significant events) injects a `<system-reminder>` into the parent with current child progress (tool calls made, current step description, incomplete child todos). This reuses the existing `ParentWakeNotifier` infrastructure.

**Pros:**
- Reuses existing `ParentWakeNotifier` (`parent-wake-notifier.ts:718` LOC) and `dispatchInternalPrompt()`
- Parent sees updates in chat (no new mechanism needed)
- `ParentWakeNotifier` already handles safety (deferral during active turns, dedup, rate limiting)
- Can be batched across multiple children
- Low risk — system messages don't affect todo state

**Cons:**
- Chat clutter — too-frequent messages annoy the user
- `PARENT_WAKE_MAX_RETRY_COUNT` (10) and `PARENT_WAKE_MAX_ELAPSED_MS` (300s) limit delivery
- Must avoid flooding when parent is actively working
- System messages are invisible if parent is mid-response
- No TUI todo visibility

**Feasibility**: 🟢 **Low risk** — reuses existing safe infrastructure, incremental progress messages

---

### Option E: Hybrid Design (B + C + D)

Combine summary todo, progress artifact, and incremental parent-wake updates.

**Mechanism**:
1. **Option C** (artifact) as the source of truth — write structured progress to `.omo/background/`
2. **Option B** (summary todo) with dedup guard — one parent todo showing aggregate status
3. **Option D** (incremental wake) only for significant milestones (first output, error, completion)

**Pros:**
- Covers all visibility gaps: TUI (B), detailed (C), chat updates (D)
- Each component mitigates others' weaknesses
- Bogus load balanced: artifact is write-on-read-many, todo is low-freq, wake is event-driven
- Survives compaction via file artifact

**Cons:**
- Most complex to implement (3 components)
- Summary todo still risks semantic conflict with boulder
- Agent must be trained on artifact reading
- 3x the testing surface

**Feasibility**: 🟡 **Moderate risk** — most complete but most complex

---

## 12. Recommended Architecture

### Primary Recommendation: Option D (Incremental Wake) + Option C (Artifact)

Use Option D as the primary progress delivery mechanism (uses existing safe `ParentWakeNotifier` infrastructure) and Option C as a persistent record for compaction survival and detailed inspection.

### Architecture Diagram

```
Child todo.updated/message.updated
         │
         ▼
BackgroundManager.handleEvent()
         │
         ▼
BackgroundManager.extractChildProgress(task)
  → reads child session todos via client.session.todo()
  → reads last assistant message via client.session.messages()
  → returns structured progress object
         │
         ▼
BackgroundManager.writeProgressArtifact(task)
  → writes .omo/background/{taskID}.progress.json
  → structured: todos[], lastMessage, toolCalls, status
         │
         ▼ (if > debounce interval since last notification)
BackgroundManager.queueParentProgressWake()
  → reuses existing ParentWakeNotifier
  → rate-limited (min 30s between progress updates)
  → batched across children of same parent
         │
         ▼
ParentWakeNotifier.flushPendingParentWake()
  → dispatchInternalPrompt()
  → injects <system-reminder> with progress summary
         │
         ▼
Parent session receives:
  [BACKGROUND TASK PROGRESS]
  Task: refactor-auth (@sisyphus subagent)
  Steps: 2/5 completed
  Current: "Adding tests for validateEmail()"
  ├── completed: validateEmail() function ✓
  ├── completed: unit tests for validateEmail() ✓
  ├── in_progress: integration tests
  ├── pending: PR review
  └── pending: merge to dev
```

### Guardrails

| Guard | Implementation |
|-------|---------------|
| Rate limit | Min 30s between progress wakes per parent session |
| Active turn safety | Existing `ParentWakeNotifier.defer()` mechanism |
| Max total wakes | Cap at 20 per child execution (configurable) |
| Dedup by content | Skip if progress hasn't changed meaningfully |
| Max children | Only active tasks (running/pending) generate progress |
| Abort on completion | Stop progress wakes once child is terminal |
| Compact survival | Artifact file survives compaction; progress resumes from artifact |

---

## 13. Minimal Implementation Plan

### Phase 1: Minimal Viable Visibility (Low Risk)

**Goal**: Deliver incremental child progress updates to the parent without touching parent todos.

**Files to modify** (research-only enumeration — DO NOT IMPLEMENT NOW):

1. **`src/features/background-agent/types.ts`** — Add optional `lastProgressWakeAt?: number` to `BackgroundTask` for rate limiting
2. **`src/features/background-agent/manager.ts`** — Add:
   - `extractChildProgress(task: BackgroundTask): Promise<ChildProgressSnapshot>` — reads child session todos and last message
   - `scheduleProgressWake(task: BackgroundTask): void` — enqueues progress notification via existing `ParentWakeNotifier`
   - Periodic check in `handleEvent()` on `todo.updated` / `message.updated` / `message.part.updated` from child sessions
3. **`src/hooks/background-notification/hook.ts`** — No change needed; events already forwarded
4. **`src/features/background-agent/background-task-notification-template.ts`** — Add `buildProgressNotificationText()` for progress summaries

**Testing approach:**
- Unit test `extractChildProgress()` against mock child session with known todos
- Integration test: child creates/modifies todos → parent receives progress wake within debounce window
- Edge case: child completes all todos between progress checks (no redundant wake)

### Phase 2: Structured Artifact (Low Risk)

**Files to modify:**

5. **New file**: `src/features/background-agent/progress-artifact.ts` — Read/write `.omo/background/{taskID}-progress.json` with structured progress data
6. **`src/features/background-agent/manager.ts`** — Call artifact writer on `todo.updated` events from child sessions

**Testing approach:**
- File read/write round-trip test
- Cleanup test (artifact removed when background task reaches terminal state)
- Concurrent access test (multiple todo updates racing)

### Phase 3: Optional Summary Todo (Moderate Risk — Conditional)

**Only if Phase 1+2 prove insufficient for UX needs.**

7. **New file**: `src/features/background-agent/todo-summary-sync.ts` — Create/update one summary todo in parent session
8. **`src/hooks/tasks-todowrite-disabler/constants.ts`** — Add summary todo content pattern to disabler list to prevent boulder from tracking it

**Risks require:**
- Deduplication by todo content (reuse `todosMatch()` from `todo-sync.ts`)
- Guard to ensure summary todo is never count toward boulder continuation checks
- Rollback to clear summary todo if feature is disabled

---

## 14. Memory System Integration

The Hecateq memory system (`src/shared/memory-bootstrap/`, `src/shared/memory-manifest/`) provides a natural extension point for progress artifacts.

### Current Memory Files

| File | Content | Relevance to Subagent Progress |
|------|---------|-------------------------------|
| `active-context.md` | Current session context, goals, in-progress actions | Could reference subagent progress |
| `progress.md` | Milestone tracking | Could summarize subagent progress |
| `tasks.md` | Pending/blocked/done tasks | Task graph already tracks subagents |
| `decisions.md` | Architecture decisions | Low relevance |
| `file-map.md` | Important file paths | Low relevance |
| `quality-history.md` | Quality gate results | Could include subagent quality gate results |
| `risk-profile.md` | Known risks and mitigations | Low relevance |

### Interaction Points

| Memory Component | How Subagent Progress Integration Works |
|-----------------|----------------------------------------|
| `tasks.jsonl` / task graph | Task graph nodes already track subagent tasks via `backgroundTaskId` (see `background-task.ts:183: backgroundTaskId`). Adding progress state to each node would enable querying. |
| `decisions.jsonl` | Not directly relevant |
| `progress.md` | Could be updated with subagent milestone completions, but file I/O per event is heavy |
| `quality-history.md` | If Phase 2 artifact captures subagent quality gate results, this could aggregate them |
| `risk-profile.md` | If subagent fails repeatedly, risk profile could be updated |
| `file-map.md` / Change Impact Map | Subagent output (files changed) could populate a change impact map |
| Memory commit (final) | Final subagent result summary belongs in the memory commit |
| Context injection summaries | The `hecateq-project-context-injector` hook (`src/hooks/hecateq-project-context-injector/`) already injects memory state into new sessions. Adding subagent progress to the context injection would make it visible on continuation |

### Integration Recommendation

- **Task graph nodes** (`tasks.jsonl`): Extend to include `progress: { completedSubtasks: number, totalSubtasks: number, currentDescription: string }` — this couples with Phase 2 artifact
- **Context injection**: The `hecateq-project-context-injector` hook (1167 LOC, reads memory + handoff + git state) should be extended to inject a compact subagent progress summary block using the Phase 2 artifacts
- **No direct memory file writes on every todo.updated** — file I/O is too heavy for high-frequency events. Use the structured artifact (`.omo/background/`) as the write target, compact into memory files only at task completion or compaction

---

## 15. Risk Analysis

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| **Parent todo semantic conflict** (Option A/B) | High | High — boulder misinterprets child todos as parent work | Avoid Option A/B unless using strict dedup guard |
| **Message flooding** (Option D) | Medium | Medium — user annoyance, context waste | Rate limit (30s min interval), max 20 per child, dedup by content |
| **ParentWakeNotifier retry exhaustion** | Low | Low — max 10 retries, 300s max elapsed | Progress wakes use same mechanism; if exhausted, next completion wake resets |
| **Synthetic todo.updated race** | Medium | Medium — duplicate progress wakes | Use existing dispatch dedup in ParentWakeNotifier |
| **Compaction losing progress state** | Medium | Medium — progress messages lost, artifact needed | Option C artifact survives compaction; Phase 2 addresses this |
| **Child session deleted mid-progress** | Low | Low — no progress to show | Graceful cleanup — remove progress artifacts |
| **Performance: too many child todos** | Low | Low — max background tasks limited by concurrency (default 5 per key) | N/A |
| **Memory: huge progress artifacts** | Low | Low — truncate at reasonable size (e.g., 50 KB) | Truncate artifact content if too large |
| **Boulder marking summary todo as "done"** | Medium (Option B only) | Medium | Add summary todo pattern to `tasksTodowriteDisabler` allowlist |
| **promptAsync duplicate prevention blocking progress inject** | Low | Low — existing gate defers during active parent turns | Acceptable — progress will be delivered when parent is idle |

---

## 16. Test Plan

### Phase 1 Tests (Incremental Wake)

| Test | Type | Verification |
|------|------|-------------|
| Child `todo.updated` triggers `extractChildProgress()` | Unit | Mock child session, verify progress snapshot built correctly |
| Progress wake enqueued within debounce window | Unit | Mock BackgroundManager, verify `ParentWakeNotifier.queuePendingParentWake` called with expected content |
| Progress wake NOT enqueued before debounce expires | Unit | Same mock, second call within 30s — verify no duplicate wake |
| Progress wake content includes child todo summary | Integration | Create child with 3 todos, mark 1 complete, verify progress text shows "1/3 completed" |
| No wake on child status that hasn't changed | Unit | Same progress → skip |
| Wake properly batched across 3 children of same parent | Integration | 3 children each report progress → 1 parent notification (or batched) |
| Max wakes cap enforced (20 per child per execution) | Integration | 25 progress events → only 20 delivered |
| Cleanup on child terminal state | Integration | Child completes → progress artifacts removed |

### Phase 2 Tests (Structured Artifact)

| Test | Type | Verification |
|------|------|-------------|
| Artifact written on child `todo.updated` | Integration | `.omo/background/{taskID}-progress.json` exists with valid JSON |
| Artifact contains correct child data | Unit | Todos, lastMessage, toolCalls match expected |
| Artifact truncated if too large | Unit | >50KB content → truncated to 50KB |
| Artifact cleaned on child terminal | Integration | Child error/completion → artifact file removed |
| Compaction survival | Integration | Simulate compaction → artifact still readable |

### Phase 3 Tests (Summary Todo — Conditional)

| Test | Type | Verification |
|------|------|-------------|
| Summary todo created on first child progress | Integration | Parent session has 1 new todo with aggregate status |
| Summary todo updated on subsequent child events | Integration | Todo content changes to reflect new status |
| Summary todo NOT tracked by boulder | Integration | `todoContinuationEnforcer` skips summary todo |
| Summary todo removed when all children complete | Integration | Parent todo count returns to pre-child state |

---

## 17. What Not To Build Yet

The following areas are explicitly out of scope until proven necessary and safe:

### ❌ Parent Todo Mirroring (Option A)
- Writing child todos directly to parent session todo list
- Risk of semantic conflict with boulder too high
- No clean rollback path if parent agent starts acting on child todos
- Requires OpenCode-side changes for todo namespacing

### ❌ Synthetic Parent Todos Without Dedup
- Any mechanism that adds foreign todos to the parent without strict dedup guard
- Summary todo (Option B) is conditional on dedup guard being proven first

### ❌ `promptAsync` Progress Spam
- Any mechanism that calls `dispatchInternalPrompt()` more frequently than once per 30s per parent
- The existing `ParentWakeNotifier` has rate limits; progress wakes must respect them

### ❌ Duplicate Assistant Streams
- Any mechanism that injects duplicate assistant messages into the parent session
- The prompt-async-gate exists to prevent this; progress injection must use it

### ❌ Broad UI/Dashboard Work
- Custom UI for displaying subagent progress
- OpenCode plugin API does not support custom UI components
- Any dashboard would be a separate application, not part of this plugin

### ❌ Root/Path Changes
- Changes to `src/index.ts`, `src/create-managers.ts`, `src/create-hooks.ts` root wiring
- New initialization code should use existing manager/hook patterns

### ❌ Install Changes
- No changes to `src/cli/install/`, `postinstall.mjs`, or binary distribution

### ❌ Category Routing Changes
- No changes to `src/tools/delegate-task/category-resolver.ts` or `subagent-resolver.ts`
- Category routing is orthogonal to todo visibility

### ❌ Memory File Every-Event Writes
- No writes to `progress.md`, `tasks.md`, or other memory files on every child `todo.updated`
- File I/O at that frequency would be wasteful
- Use structured artifact (`.omo/background/`) as intermediate buffer

---

## 18. Open Questions

1. **Does the existing `ParentWakeNotifier` handle concurrent progress wakes from multiple children correctly?** The current implementation deduplicates by session ID. If 3 children of the same parent all fire progress wakes simultaneously, does the batching mechanism (`notificationQueueByParent`) serialize them correctly? **Evidence needed from `enqueueNotificationForParent()` at `manager.ts:2960+`.**

2. **What is the actual frequency of `todo.updated` events from child sessions?** If the child agent updates todos after every tool call, we could see 50+ events per minute. Is this realistic? Testing needed on real OpenCode behavior.

3. **How does the existing `backgroundNotificationHook` filter `todo.updated` events?** It forwards them to `BackgroundManager.handleEvent(event)`. We need to verify that the handler checks `FORWARDED_EVENT_TYPES` and processes them correctly for progress extraction.

4. **What happens if the parent session is being compacted when a progress wake fires?** The `dispatchInternalPrompt` gate would likely return `reserved` or `gate:compacting`. The wake would be deferred and retried. Is this acceptable for progress updates?

5. **Can the Hecateq `context-injector` hook inject subagent progress from artifacts without adding too much context overhead?** The context injector already handles compaction survival. Adding subagent progress would increase per-injection size. What's the acceptable limit?

6. **Should progress wakes carry full child todo lists or summarized descriptions?** Full lists would be 500+ chars for complex tasks; summaries would be 50-100 chars. The tradeoff is detail vs. context efficiency.

7. **What happens when the parent agent (Sisyphus) receives progress updates in a `<system-reminder>` while it's already working on something?** The existing gate defers during active turns, so the message arrives after the parent's current response. But does interrupting the parent's workflow mid-stream cause context thrashing? User testing needed.

---

## 19. Final Decision Recommendation

### Short-term (Do First — Low Risk)
**Option D** (Incremental Parent Wake) + **Option C** (Progress Artifact)
- Safest approach — reuses existing `ParentWakeNotifier` infrastructure
- No parent todo manipulation → no boulder semantic conflict
- Structured artifact survives compaction
- Manageable risk profile with rate limiting
- Estimated implementation: 2-3 days for Phase 1, 1-2 days for Phase 2

### Why Not Option A (Full Mirroring)
**Too risky.** The semantic conflict between parent and child todos cannot be resolved plugin-side without OpenCode API changes for todo namespacing. The boulder continuation enforcer would misinterpret child todos as pending parent work, leading to infinite continuation loops or premature completion.

### Why Not Option B Alone (Summary Todo)
**Insufficient without dedup guard.** A single summary todo solves TUI visibility but requires the `tasksTodowriteDisabler` to block boulder from tracking it. This guard must be proven before Option B becomes safe. Phase 3 (if needed) should introduce this guard first.

### Long-term (If Short-term Insufficient)
Add **Option B** (Summary Todo) only if user testing shows that chat-only progress visibility is insufficient. The summary todo should be strictly gated behind:
1. Proven dedup guard in `tasksTodowriteDisabler` constants
2. Maximum 1 synthetic todo per parent
3. Automatic removal on child task completion

---

## 20. Next Implementation Prompt

**Only if the recommendation above (Option D + C) is accepted and prioritized:**

```plaintext
Implement incremental parent-wake progress notifications for background/subagent tasks.

Task description:
When a subagent (background task) creates or updates todos during execution, the parent session has no visibility into the child's progress. Currently, parents only receive a completion/error summary when the child finishes.

Goal:
Deliver periodic progress updates from child background tasks to the parent session using existing ParentWakeNotifier infrastructure, without modifying parent todos.

Detailed Requirements:

1. In src/features/background-agent/manager.ts:
   a. Add `extractChildProgress(task: BackgroundTask): Promise<ChildProgressSnapshot>` method that:
      - Reads child session todos via `client.session.todo({ path: { id: task.sessionId } })`
      - Reads last 2-3 messages via `client.session.messages({ path: { id: task.sessionId } })`
      - Returns a structured object: { taskId, description, completedTodos, totalTodos, lastMessage, toolCalls, status }
   b. Add `scheduleProgressWake(task: BackgroundTask): void` method that:
      - Checks `lastProgressWakeAt` on the task — skip if < 30s ago
      - Calls `extractChildProgress()`
      - Formats a progress summary string
      - Calls `this.queuePendingParentWake(task.parentSessionId, progressSummary, parentPromptContext, false)`
      - Updates `lastProgressWakeAt` on the task
   c. In `handleEvent()` (around line 2620), when a `todo.updated` or `message.updated` event arrives for a tracked background session:
      - Find the `BackgroundTask` via `findBySession(sessionID)`
      - If task is `running`, call `scheduleProgressWake(task)`

2. Rate limiting:
   - Minimum 30 seconds between progress wakes for the same parent session
   - Maximum 20 progress wakes per child task execution
   - Skip wake if progress hasn't changed meaningfully (same todo counts, same last message)

3. Notification format (system-reminder):
   ```
   [BACKGROUND TASK PROGRESS]
   Task: {description} (@{agent})
   Progress: {completedTodos}/{totalTodos} steps completed
   Current: {lastMessage summary (truncated to 200 chars)}
   Status: running
   ```

4. Guardrails:
   - Use existing `ParentWakeNotifier.enqueueNotificationForParent()` for safe dispatch
   - Respect active-turn deferral (existing ParentWakeNotifier behavior)
   - Do NOT write to parent session's todo list under any circumstances
   - Do NOT call `dispatchInternalPrompt()` directly — always use `ParentWakeNotifier`

5. Testing:
   - Unit test: `extractChildProgress()` returns correct snapshot for mock child session
   - Unit test: `scheduleProgressWake()` respects 30s debounce
   - Unit test: max 20 wakes enforced
   - Integration test: child creates todo → parent receives progress wake (mocked OpenCode API)

6. Do NOT modify:
   - Parent session todos
   - Boulder/todoContinuationEnforcer behavior
   - Prompt async gate behavior
   - Handoff behavior
   - Memory system files
   - Root discovery, install, or category routing
```

---

## Appendix: Evidence Index

| Claim | Evidence |
|-------|----------|
| Todos accessed via `client.session.todo({ path: { id } })` | `src/tools/task/todo-sync.ts:106-108` |
| Background tasks store `parentSessionId` and `sessionId` | `src/features/background-agent/types.ts:46-48` |
| `notifyParentSession()` only fires on completion/error | `src/features/background-agent/manager.ts:2410-2525` |
| ParentWakeNotifier uses `dispatchInternalPrompt()` | `src/features/background-agent/parent-wake-notifier.ts:262-280` |
| `backgroundNotificationHook` forwards `todo.updated` events | `src/hooks/background-notification/hook.ts:20-28` |
| `handleEvent()` does NOT extract child todo data | `src/features/background-agent/manager.ts:2620-2630` (search for `handleEvent`) |
| `checkSessionTodos()` only checks **if** child has incomplete todos | `src/features/background-agent/manager.ts:1405-1434` |
| No cross-session todo API exists | SDK inspection: only `session.todo({ path: { id } })` |
| `TaskProgress` does not store todos | `src/features/background-agent/types.ts:19-27` |
| `TaskHistory` stores task metadata, not todos | `src/features/background-agent/task-history.ts:5-14` |
| `todoContinuationEnforcer` checks only **local** session todos | `src/hooks/todo-continuation-enforcer/idle-event.ts:100-106` |
| Compact Result Guidance is injected into subagent prompts | `src/tools/delegate-task/prompt-builder.ts:120-124` |
| `promptAsync-gate` prevents duplicate injection | `src/shared/prompt-async-gate.ts:71-173` |
