# Memory Manifest Architecture — Implementation Spec

> **Current Implementation Status:** This spec informed the Hecateq memory manifest system, which is now implemented with the following differences from the original design:
> - **Memory path:** `.opencode/state/memory/` (not `.opencode/memory/knowledge/context/`)
> - **Memory files:** 8 files (not 5) — adds `agent-routing.md`, `quality-history.md`, `risk-profile.md`; no `known-issues.md`
> - **Manifest schema version:** 2 (current); the v1 schema below is historical
> - **Pointer file:** `.memory-manifest.json` at repo root (v1) — matches the Stage-2 amendment in §13
> - **Lock system:** Locks are tracked within `memory.json` (not a `.locks/` directory)
> - **Hydration:** Missing files get deterministic starter content; existing placeholders are hydrated by default; user-authored files preserved; controlled via `hydrate_placeholders` config
>
> Edits to this document should preserve the original design intent; sections that describe implemented features have been updated to current paths. Sections still describing unimplemented or diverged behavior are marked with ***(current implementation diverges)***.

**Status:** Draft for implementation (superseded by current implementation)  
**Target:** v4.3.0+  
**Author:** Technical Writer (automated)  
**Last updated:** 2026-05-25

---

## 1. Problem Statement

The pre-manifest Hecateq memory system (`.opencode/state/memory/`) started as a flat set of markdown files bootstrapped from templates:

| File | Purpose |
|------|---------|
| `active-context.md` | Current goal, state, constraints |
| `progress.md` | Completed/in-progress/remaining milestones |
| `tasks.md` | Pending/blocked/done tasks |
| `decisions.md` | Accepted/rejected decisions |
| `file-map.md` | Important paths, entry points |
| `agent-routing.md` | Agent routing rules and preferences |
| `quality-history.md` | Quality gate results and audit trail |
| `risk-profile.md` | Known risks and mitigations |

**Pain points this spec addresses:**

1. **No cross-IDE portability** — memory files are discovered only by the OpenCode plugin's hardcoded `PROJECT_MEMORY_FILES` array. Claude Code, Codex, and CLI tools have no standard entry point to discover or consume memory.
2. **No metadata** — agents must read every file to learn what it contains, how large it is, when it was last updated, or which agent wrote it. This burns tokens.
3. **No token-efficiency hints** — no pre-computed summary lengths, no chunk boundaries, no "cost to read" estimate.
4. **No conflict detection** — concurrent agent sessions writing to the same file cause silent overwrites. No lock mechanism exists.
5. **No fallback rules** — missing files produce "TODO" templates; the system has no way to express "this file should exist but hasn't been generated yet" vs "this file is intentionally absent."
6. **No schema version** — there is no way to migrate memory file formats without breaking existing installations.

---

## 2. Manifest Format (`memory.json`)

### 2.1 Location

A single `memory.json` file lives **alongside** the memory markdown files:

```
.opencode/state/memory/
├── memory.json              ← the manifest (v2)
├── active-context.md        ← session context
├── progress.md              ← milestone tracking
├── tasks.md                 ← pending/blocked/done tasks
├── decisions.md             ← architecture decisions
├── file-map.md              ← important file paths
├── agent-routing.md         ← agent routing rules
├── quality-history.md       ← quality gate results
└── risk-profile.md          ← known risks & mitigations
```

### 2.2 JSON Schema

**Current manifest schema version: 2.** The v1 schema below is the baseline from which v2 evolved; v2 adds `project_identity`, `discovery`, and `resume` blocks. See the live `memory.json` for the full implementation.

```typescript
// memory.json — version 1 manifest (historical)
{
  // --- Identity & Versioning ---
  "schema_version": 1,                        // required, integer, >= 1
  "manifest_updated_at": "2026-05-25T12:00:00Z", // required, ISO 8601
  "updated_by_agent": "sisyphus",             // optional: agent ID that last updated manifest
  "updated_by_harness": "opencode",           // optional: "opencode" | "claude-code" | "codex" | "cli"

  // --- Token Efficiency / Cost Hints ---
  "token_budget": {
    "total_cost_chars": 15000,                // sum of all file content lengths at last manifest update
    "estimated_total_tokens": 3750,           // approximate tokens (chars / 4, rough estimate)
    "reading_cost": "medium",                 // "low" (< 5k chars) | "medium" (5k-20k) | "high" (> 20k)
    "recommended_read_order": [               // suggested order to minimize token burn
      "active-context.md",
      "file-map.md"
    ]
  },

  // --- File Registry ---
  "files": {
    "active-context.md": {
      "size_bytes": 1200,
      "last_modified": "2026-05-25T12:00:00Z",
      "content_hash": "sha256:a1b2c3d4...",   // SHA-256 hex of file content
      "summary": "Current Hecateq v5 delivery status and key decisions",
      "summary_chars": 55,                     // length of the summary field (for token budget calc)
      "section_count": 4,                      // number of ##-level sections
      "is_placeholder": false,                  // true if file contains only template TODOs
      "last_modified_by_agent": "hecateq-god",
      "last_modified_by_harness": "opencode",
      "encoding": "utf-8"                      // always utf-8 for now
    },
    "progress.md": {
      "size_bytes": 1200,
      "last_modified": "2026-05-25T12:00:00Z",
      "content_hash": "sha256:e5f6g7h8...",
      "summary": "Completed Hecateq v5 pipeline, dashboard, and DAG features",
      "summary_chars": 55,
      "section_count": 3,
      "is_placeholder": false,
      "last_modified_by_agent": "hecateq-god",
      "last_modified_by_harness": "opencode",
      "encoding": "utf-8"
    },
    "file-map.md": {
      "size_bytes": 120,
      "last_modified": "2026-05-20T10:00:00Z",
      "content_hash": "sha256:1a2b3c4d...",
      "summary": "[template placeholder — not yet populated]",
      "summary_chars": 47,
      "section_count": 3,
      "is_placeholder": true,                  // ← placeholder detected
      "last_modified_by_agent": null,          // never modified from template
      "last_modified_by_harness": null,
      "encoding": "utf-8"
    }
  },

  // --- File Manifesting Rules (which files should exist) ---
  "required_files": [
    "active-context.md",
    "progress.md",
    "tasks.md",
    "file-map.md",
    "decisions.md"
  ],
  "optional_files": [],
  "deprecated_files": [],                      // files that still exist but should not be read

  // --- Lock State (concurrent session protection) ---
  "locks": {
    "active-context.md": {                     // null if unlocked
      "locked_by_session": "ses_abc123",
      "locked_by_agent": "sisyphus",
      "locked_at": "2026-05-25T12:00:00Z",
      "lock_ttl_seconds": 300                  // auto-expire after 5 minutes
    },
    "progress.md": null,                       // not locked
    "tasks.md": null,
    "file-map.md": null,
    "decisions.md": null
  },

  // --- Migration History ---
  "migrations_applied": [
    "v1-initial-manifest",
    "v2-added-token-budget"
  ],

  // --- Harness Interop ---
  "harness_timestamps": {
    "opencode": "2026-05-25T12:00:00Z",
    "claude-code": null,                        // never written by Claude Code
    "codex": null,
    "cli": "2026-05-25T11:00:00Z"              // last CLI doctor check
  }
}
```

### 2.3 TypeScript Types (for reference in `src/shared/`)

```typescript
// src/shared/memory-manifest.ts

export interface MemoryManifest {
  schema_version: number
  manifest_updated_at: string
  updated_by_agent?: string
  updated_by_harness?: "opencode" | "claude-code" | "codex" | "cli"

  token_budget: {
    total_cost_chars: number
    estimated_total_tokens: number
    reading_cost: "low" | "medium" | "high"
    recommended_read_order: string[]
  }

  files: Record<string, MemoryFileEntry>

  required_files: string[]
  optional_files: string[]
  deprecated_files: string[]

  locks: Record<string, MemoryLock | null>

  migrations_applied: string[]

  harness_timestamps: {
    opencode: string | null
    "claude-code": string | null
    codex: string | null
    cli: string | null
  }
}

export interface MemoryFileEntry {
  size_bytes: number
  last_modified: string
  content_hash: string             // "sha256:<hex>"
  summary: string                  // human-readable one-liner
  summary_chars: number
  section_count: number
  is_placeholder: boolean
  last_modified_by_agent: string | null
  last_modified_by_harness: string | null
  encoding: "utf-8"
}

export interface MemoryLock {
  locked_by_session: string
  locked_by_agent: string
  locked_at: string
  lock_ttl_seconds: number         // default 300 (5 min)
}
```

---

## 3. Lifecycle & Semantics

### 3.1 Manifest Creation

- `memory.json` is created **by the bootstrap hook** (`hecateq-memory-bootstrap`) on first `session.created`, alongside the 8 memory markdown files.
- The initial manifest is populated from template defaults: all files listed with `is_placeholder: true`, `content_hash` computed from the template content, `token_budget.reading_cost` set to `"low"`.
- If a `memory.json` already exists, the bootstrap hook **must not overwrite it** (same no-overwrite rule as the markdown files).

### 3.2 Manifest Refresh Triggers

The manifest is **read on session start** (by the context injector) and **refreshed after any write** to a memory file. Refresh triggers:

| Trigger | Action | Who |
|---------|--------|-----|
| Context injection (session start) | Read manifest → use for token budget hint display | `hecateq-project-context-injector` hook |
| After any Edit/Write to a memory file | Recompute content_hash + summary + size for that file; update manifest | Post-tool guard hook (new: `memory-manifest-updater`) |
| After bootstrap creates new files | Write initial manifest | `hecateq-memory-bootstrap` hook |
| After manual merge/handoff | Mark harness_timestamps for the active harness | Handoff ingestion pipeline |

### 3.3 Read Semantics

1. Agent reads `memory.json` first → learns which files exist, their sizes, summaries, and lock state — **without reading any markdown content**.
2. Agent decides which files to read based on `recommended_read_order`, lock state, and `token_budget.reading_cost`.
3. Locked files are **skipped** unless the agent has the same `locked_by_session` ID (same session holds the lock).
4. Deprecated files are **never read** (the manifest declares them deprecated).

### 3.4 Write Semantics

1. Before writing, agent **must acquire a lock** on the target file via a new `memory_lock` tool or by updating the manifest lock field.
2. After writing, agent **must release the lock** and refresh the file's `content_hash`, `last_modified`, `size_bytes`, and `summary` fields.
3. If the agent crashes or forgets to release, the lock auto-expires after `lock_ttl_seconds` (default 300).
4. If a write attempt finds a lock held by another session, the agent **must not write** and must report a conflict.

---

## 4. Conflict & Lock Behavior

### 4.1 Lock Acquisition

- Lock acquisition is **optimistic**: write the lock field in `memory.json` and re-read it.
- If the lock field changed between write and re-read (stale write detected), the acquire fails.
- If the lock is held by a session whose `lock_ttl_seconds` has expired, the lock is **stale** and can be broken by any agent (with a warning logged).

### 4.2 Lock File (Alternative / Companion)

If writing JSON to `memory.json` on every lock acquire/release is too expensive (it requires a full file read + write + hash check), a companion lock file can be used instead:

```
.opencode/state/memory/
├── .locks/                          ← NEW: lock directory
│   ├── active-context.md.lock       ← contains JSON: {session_id, agent, timestamp, ttl}
│   └── progress.md.lock
├── memory.json
├── active-context.md
...
```

**Decision:** Use the `.locks/` directory approach. Rationale:
- Avoids `memory.json` write contention on every lock acquire/release.
- Lock files have predictable names (`.md.lock`), so detection is O(1).
- No need to parse/rewrite the whole manifest for a lock operation.
- Easy to implement stale lock cleanup (just stat mtime + TTL).

### 4.3 Conflict Resolution

| Scenario | Behavior |
|----------|----------|
| File unlocked, acquire succeeds | Writer proceeds |
| File locked by same session | Writer proceeds (re-entrant) |
| File locked by different session, TTL not expired | Writer **blocks**: reports `MEMORY_LOCKED` error with `locked_by_agent` and `locked_at` |
| File locked by different session, TTL expired | Writer **breaks lock**: logs `STALE_LOCK_BROKEN` warning, acquires lock, proceeds |
| Lock file missing (race) | O_CREAT | O_EXCL atomic create; if EEXIST, wait and retry |
| Write to file that is not in `required_files` or `optional_files` | Warn: `UNREGISTERED_FILE_WRITE` but allow |

---

## 5. Token-Efficiency Behavior

### 5.1 Context Injection Manifest Reading

The `hecateq-project-context-injector` hook currently reads memory files directly in "expanded" mode. With the manifest, it can:

**New "manifest-first" mode (on by default):**
1. Read `memory.json` (typically < 2 KB — ~30 tokens)
2. Display the `token_budget` block in the `<hecateq-project-context>` XML
3. For each file, display only `summary` + `summary_chars` + `is_placeholder` status
4. Agent decides which files to read based on this summary

**Token savings estimate:**

| Scenario | Current (expanded) | With manifest-first | Savings |
|----------|-------------------|---------------------|---------|
| 5 files, 2 KB each | ~10 KB injected (~2500 tokens) | ~2 KB manifest (~500 tokens) + on-demand reads | ~80% for context injection |
| Agent reads 2 of 5 files | ~10 KB still injected | ~2 KB manifest + 4 KB file content = ~6 KB | ~40% |

### 5.2 Summary Generation

Each file entry in the manifest has a `summary` field. Summary generation strategy:

1. **On file write:** extract the first non-heading line of non-TODO content (if any). Fallback: first 120 chars after stripping `#` headings and `- TODO` lines.
2. **On bootstrap:** summary = `"[template placeholder — not yet populated]"` for template files.
3. **Manual override:** Agents can write a better summary to the manifest directly. The summary auto-generator never overwrites a non-placeholder summary with a computed one (only writes if current is the placeholder default).

### 5.3 Recommended Read Order

The `recommended_read_order` field is a hint, computed as:
1. `active-context.md` always first (it has the current goal/state)
2. `progress.md` second (context for what was done)
3. `file-map.md` third (navigation)
4. `decisions.md` fourth
5. `tasks.md` last (lowest urgency for initial context)

Agents may override this. The field is advisory.

---

## 6. Fallback Rules

### 6.1 Manifest Missing

| Condition | Behavior |
|-----------|----------|
| `memory.json` does not exist | All existing fallback logic applies: `PROJECT_MEMORY_FILES` array is used, templates are presumed, no token hints available. The context injector logs `MEMORY_MANIFEST_MISSING` at `info` level. |
| `memory.json` exists but is invalid JSON | Treated as missing. `MEMORY_MANIFEST_INVALID` logged at `warn` level. A `doctor` check warns about this. |
| `memory.json` exists with `schema_version > 1` | Read what you can. Unknown fields are ignored. `MANIFEST_VERSION_MISMATCH` logged. A doctor check warns if the version is newer than what this plugin version supports. |

### 6.2 File Not in Manifest

| Condition | Behavior |
|-----------|----------|
| `.md` file exists in the memory directory but not listed in `files` | Treated as an orphan. Context injector logs `ORPHAN_MEMORY_FILE` at `info` level. Doctor check reports orphan files. Agent may read it but is warned. |
| File listed in `files` but missing from disk | Status: re-compute on next manifest refresh — if missing, update `memory.json` to remove or set `size_bytes: 0`, `is_placeholder: true`. Context injector reports as missing. |

### 6.3 Lock Stale Detection

On every context injection, before the agent reads the manifest:
1. Scan `.locks/` directory
2. For each lock file where `mtime + ttl < now`, delete the lock file and log `STALE_LOCK_CLEANUP`
3. Proceed with no stale locks

---

## 7. Concrete File Change List

### 7.1 NEW Files to Create

| # | File | Purpose | Lines (est.) |
|---|------|---------|-------------|
| F1 | `src/shared/memory-manifest.ts` | Types (`MemoryManifest`, `MemoryFileEntry`, `MemoryLock`), default constants, validation helpers | ~150 |
| F2 | `src/shared/memory-lock.ts` | Lock acquire/release/break/check utilities using `.locks/` directory | ~120 |
| F3 | `src/shared/memory-summarizer.ts` | Auto-summarize a markdown memory file (extract first meaningful line, strip TODO templates) | ~80 |
| F4 | `src/hooks/memory-manifest-updater/index.ts` | Post-write hook that refreshes `memory.json` for the touched file | ~150 |

### 7.2 EXISTING Files to Update

| # | File | Changes | Est. diff |
|---|------|---------|-----------|
| E1 | `src/shared/memory-bootstrap.ts` | Add `createMemoryManifest()` function; export `PROJECT_MEMORY_MANIFEST` constant; call from `bootstrapMemoryFiles()` | +40 lines |
| E2 | `src/hooks/hecateq-memory-bootstrap/index.ts` | Export memory manifest functions alongside existing bootstrap exports | +5 lines (re-exports) |
| E3 | `src/hooks/hecateq-project-context-injector/index.ts` | Add "manifest-first" mode: read `memory.json`, include `token_budget` block in context injection, only list summaries instead of full content in compact mode; add new options `manifest_first: boolean` (default true) | +60 lines |
| E4 | `src/cli/doctor/checks/hecateq-workflow.ts` | Add `collectMemoryManifestIssues()` check: manifest presence, validity, orphan files, stale locks, version mismatch | +120 lines |
| E5 | `src/config/schema/hecateq.ts` (or `context-injection.ts`) | Add `context_injection.manifest_first` boolean field, `context_injection.lock_timeout_seconds` number field | +4 lines |
| E6 | `src/shared/index.ts` (barrel) | Re-export memory manifest types | +1 line |

### 7.3 OPTIONAL Future Files

| # | File | Purpose | Priority |
|---|------|---------|----------|
| O1 | `src/tools/memory-lock/index.ts` | Agent-callable tool for explicit lock acquire/release | Medium (can use file-edit fallback) |
| O2 | `src/tools/memory-manifest-read/index.ts` | Agent-callable tool to read manifest without file-path guesswork | Low (manifest is just a JSON file) |

### 7.4 Dependency Graph / Implementation Order

```
Wave 1 (foundation — must ship together):
  F1 (types) → F2 (locks) → F3 (summarizer)
  → E1 (memory-bootstrap integration)
  → E5 (config schema)
  → E6 (barrel export)
  → E3 (context injector manifest-first mode)
  Tests: F1.test.ts, F2.test.ts, F3.test.ts, E1 integration in existing memory-bootstrap.test.ts

Wave 2 (observability — can ship separately):
  F4 (post-write hook)
  E2 (re-export hook)
  E4 (doctor checks)
  Tests: F4.test.ts, E4.test.ts
```

---

## 8. Migration & Backward-Compatibility

### 8.1 Backward Compatibility Guarantees

1. **Existing projects with no `memory.json`:** Work exactly as before. The manifest is optional. The old `PROJECT_MEMORY_FILES` array remains the fallback.
2. **Existing projects with `memory.json`:** The manifest is read and used for token efficiency. The markdown files remain the source of truth for content.
3. **Old plugin versions on projects with `memory.json`:** Old versions ignore the manifest file. No compatibility issues.
4. **The `.locks/` directory:** Created only when a lock is first acquired. Lock files use the `.md.lock` naming convention and are gitignorable.

### 8.2 Migration Path

1. **Phase 0 (current):** No `memory.json` exists. Bootstrap creates only markdown files.
2. **Phase 1 (this spec):** Bootstrap creates `memory.json` alongside markdown files. No migration needed for existing projects.
3. **Phase 2 (future — explicit migration):** For existing projects that want a `memory.json`, run `bunx oh-my-opencode doctor --fix` or a new `bunx oh-my-opencode memory migrate` command.

### 8.3 Gitignore Recommendation

Add these patterns to `.opencode/.gitignore`:

```
# Memory manifest lock files
state/memory/.locks/
# Generated manifest (auto-regenerated on every session start if missing)
# memory.json is intentionally TRACKED to share across harnesses
```

Note: `memory.json` itself should be tracked in git (it is cross-harness metadata). The `.locks/` directory should NOT be tracked (it is session-local runtime state).

---

## 9. Non-Goals

| Non-goal | Rationale |
|----------|-----------|
| Replacing all memory files with JSON | Markdown is human-readable and agent-friendly. The manifest complements it, not replaces it. |
| Distributed lock server | A filesystem-based lock with TTL is sufficient for a single-project, multi-session setup. |
| Full-text search engine | No need for Elasticsearch/MeiliSearch. Manifest summaries + `grep` on markdown files are sufficient. |
| Real-time sync across machines | The manifest is per-project, per-machine. Cross-machine sync is out of scope (use git). |
| Memory file version history / diffs | Git already handles this. The manifest tracks only current state + hashes for staleness detection. |
| Automatic conflict resolution for concurrent writes | Stale lock detection + warning is sufficient. Automatic merge is outside scope. |
| Agent-to-agent memory negotiation protocol | Too heavy. The lock + manifest system covers the 90% case. |

---

## 10. Doctor Check: `collectMemoryManifestIssues()` Pseudocode

```typescript
// src/cli/doctor/checks/hecateq-workflow.ts (add this function)

export function collectMemoryManifestIssues(cwd = process.cwd()): DoctorIssue[] {
  const issues: DoctorIssue[] = []
  const memoryDir = join(cwd, PROJECT_MEMORY_DIR)
  const manifestPath = join(memoryDir, "memory.json")

  if (!existsSync(memoryDir)) {
    // Missing directory is covered by collectProjectRootMemoryIssues
    return issues
  }

  // Check 1: Manifest presence
  if (!existsSync(manifestPath)) {
    issues.push({
      title: "Memory manifest missing",
      description: "memory.json not found alongside memory files. Token efficiency hints and lock support unavailable.",
      fix: "Start a new session with hecateq-memory-bootstrap enabled (v4.3.0+), or create memory.json manually.",
      severity: "info",
      affects: ["token efficiency", "cross-IDE interop", "concurrent session safety"],
    })
    return issues // No manifest to check further
  }

  // Check 2: Manifest validity
  let manifest: MemoryManifest
  try {
    const raw = readFileSync(manifestPath, "utf-8")
    manifest = JSON.parse(raw)
    // Basic field validation
    if (typeof manifest.schema_version !== "number") throw new Error("schema_version must be a number")
    if (typeof manifest.files !== "object") throw new Error("files must be an object")
  } catch (error) {
    issues.push({
      title: "Memory manifest invalid",
      description: `memory.json could not be parsed: ${error instanceof Error ? error.message : String(error)}`,
      fix: "Fix the JSON syntax in memory.json, or delete it and let the bootstrap regenerate it.",
      severity: "warning",
      affects: ["memory manifest features"],
    })
    return issues
  }

  // Check 3: Version mismatch
  if (manifest.schema_version > 1) {
    issues.push({
      title: "Memory manifest version mismatch",
      description: `memory.json schema_version is ${manifest.schema_version}, but this plugin supports version 1. Some fields may not be recognized.`,
      fix: "Update oh-my-openagent to the latest version.",
      severity: "info",
      affects: ["newer manifest fields"],
    })
  }

  // Check 4: Orphan files (files on disk not in manifest)
  for (const entry of readdirSync(memoryDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue
    if (!entry.name.endsWith(".md")) continue
    if (!manifest.files[entry.name]) {
      issues.push({
        title: "Orphan memory file",
        description: `File ${entry.name} exists in the memory directory but is not listed in memory.json's files registry.`,
        fix: "Add the file to memory.json's files object, or move it out of the memory directory.",
        severity: "info",
        affects: ["memory file tracking"],
      })
    }
  }

  // Check 5: Stale locks
  const locksDir = join(memoryDir, ".locks")
  if (existsSync(locksDir)) {
    const now = Date.now()
    const staleLocks: string[] = []
    for (const lockEntry of readdirSync(locksDir, { withFileTypes: true })) {
      if (!lockEntry.isFile()) continue
      if (!lockEntry.name.endsWith(".lock")) continue
      const lockPath = join(locksDir, lockEntry.name)
      const stat = statSync(lockPath)
      let ttl = 300000 // default 5 min in ms
      try {
        const lockContent = JSON.parse(readFileSync(lockPath, "utf-8"))
        if (typeof lockContent.ttl_seconds === "number") ttl = lockContent.ttl_seconds * 1000
      } catch { /* use default */ }
      if (now - stat.mtimeMs > ttl) {
        staleLocks.push(lockEntry.name.replace(/\.lock$/, ""))
      }
    }
    if (staleLocks.length > 0) {
      issues.push({
        title: "Stale memory locks detected",
        description: `Lock files exist but TTL has expired for: ${staleLocks.join(", ")}`,
        fix: "Run doctor --fix to clean stale locks, or they will be cleaned on the next session start.",
        severity: "info",
        affects: ["concurrent write safety"],
      })
    }
  }

  return issues
}
```

---

## 11. Test Plan

### 11.1 Unit Tests

| File | What to test |
|------|--------------|
| `memory-manifest.test.ts` | Create manifest from file list; validate schema; serialize/deserialize; handle missing required fields |
| `memory-lock.test.ts` | Acquire lock on unlocked file; reject lock on held file; re-entrant lock same session; break stale lock; auto-expiry via mtime + TTL |
| `memory-summarizer.test.ts` | Extract first non-heading line from populated file; detect placeholder-only file (headings + TODO items); handle empty file; handle file with only headings |
| `memory-manifest-updater.test.ts` | After writing to a file, recompute hash + size + summary; handle missing manifest gracefully; error on nonexistent watched file |

### 11.2 Integration Tests

| Scope | What to test |
|-------|--------------|
| `memory-bootstrap.test.ts` (existing) | Add assertion: bootstrap creates `memory.json` alongside `.md` files; manifest is NOT overwritten if it exists |
| `hecateq-project-context-injector.test.ts` (existing) | With `manifest_first: true`, context block includes `token_budget`; with `manifest_first: false`, old behavior preserved |
| `hecateq-workflow.test.ts` (existing) | Add test for `collectMemoryManifestIssues()`: missing manifest, invalid JSON, orphan file, stale lock |
| E2E | Create project with bootstrap → verify `memory.json` + 8 `.md` files; acquire lock → verify lock file; write to file → verify manifest updated |

---

## 12. Open Questions (for Implementation Agent)

1. Should `memory.json` be written atomically (write to temp file, rename)? **Yes** — use the existing atomic write pattern from the codebase.
2. Should lock files use a custom binary format or plain JSON? **Plain JSON** — human-debuggable and consistent with the rest of the config system.
3. Should the manifest updater hook fire on every tool write to ANY file, or only to memory directory files? **Only files under `PROJECT_MEMORY_DIR`** — check the file path prefix.
4. What happens when the manifest is written concurrently with a lock operation? **Lock operations use `.locks/` directory (separate file), so no contention with manifest writes.** The manifest write is a full file write; use atomic rename to avoid partial reads.
5. Should `bun run doctor --fix` clean stale locks? **Yes** — lock files with expired TTL should be deleted.

---

## 13. Stage-2 Portable Continuation Amendment

This amendment keeps the current spec additive, but makes cross-IDE continuation concrete enough for another harness to resume real work.

### 13.1 New portability rule

Treat the memory system as three layers:

1. **Markdown memory** — authoritative deep context
2. **`memory.json`** — small always-read index
3. **`continuation.json`** — on-demand structured resume pack

The directory `.opencode/state/memory/` remains authoritative.

### 13.2 Repo-root pointer file

Add a tracked repo-root pointer file:

```json
{
  "version": 1,
  "kind": "hecateq-memory-pointer",
  "manifest_path": ".opencode/state/memory/memory.json",
  "continuation_path": ".opencode/state/memory/continuation.json",
  "authoritative_root": ".opencode/state/memory"
}
```

Suggested filename:

```
.memory-manifest.json
```

Why a pointer file instead of a symlink:

- portable on Windows
- git-friendly
- readable by any harness with plain filesystem access

### 13.3 `memory.json` v2 additions

The manifest remains compact. Add only these fields:

```jsonc
{
  "schema_version": 2,
  "manifest_revision": 1,
  "updated_by_session": "ses_abc123",
  "project_identity": {
    "project_id": "sha256:<project-root-hash>",
    "project_name": "oh-my-openagent",
    "workspace_kind": "single"
  },
  "discovery": {
    "pointer_file": ".memory-manifest.json",
    "authoritative_root": ".opencode/state/memory",
    "continuation_path": ".opencode/state/memory/continuation.json"
  },
  "resume": {
    "continuation_state": "missing",
    "summary": "Short cross-harness resume summary.",
    "primary_task_ref": "tasks.md#current",
    "next_step_hint": "Read continuation.json when resuming active work.",
    "suggested_reads": ["continuation.json", "active-context.md", "tasks.md"],
    "last_handoff_at": null
  }
}
```

### 13.4 `continuation.json` schema

Add a new optional file:

```jsonc
{
  "schema_version": 1,
  "state_revision": 1,
  "updated_at": "2026-05-25T12:00:00Z",
  "updated_by_agent": "sisyphus",
  "updated_by_harness": "opencode",
  "updated_by_session": "ses_abc123",
  "source_manifest_revision": 1,
  "source_hashes": {
    "active-context.md": "sha256:...",
    "progress.md": "sha256:...",
    "tasks.md": "sha256:...",
    "decisions.md": "sha256:..."
  },
  "work_state": {
    "objective": "What the next harness is trying to finish.",
    "status": "active",
    "primary_task": {
      "ref": "tasks.md#current",
      "title": "Concrete next task",
      "state": "next"
    },
    "branch": "dev",
    "base_ref": null
  },
  "resume_plan": {
    "must_read": [
      { "path": "active-context.md", "reason": "current constraints" }
    ],
    "next_actions": [
      "Do X",
      "Verify Y"
    ],
    "touched_paths": ["src/shared/memory-manifest.ts"],
    "blockers": [],
    "verification_pending": []
  },
  "handoff": {
    "from_harness": "opencode",
    "to_harness": null,
    "reason": "continue work elsewhere",
    "notes": "Optional human note"
  }
}
```

### 13.5 Injection policy amendment

**Compact mode default:** read `memory.json` only and inject only the `resume` block plus top file summaries.

**Expanded mode default:** may additionally inject a bounded summary from `continuation.json`.

**Explicit continue/resume flow:** read `memory.json`, then `continuation.json` if `resume.continuation_state === "fresh"`, then only the markdown files named in `resume.suggested_reads`.

### 13.6 Lock amendment

Per-file markdown locks are not enough. Add two derived-state locks:

- `manifest.lock`
- `continuation.json.lock`

Canonical lock order when multiple locks are needed:

1. markdown lock(s), lexicographic order
2. `continuation.json.lock`
3. `manifest.lock`

Release in reverse order.

### 13.7 Freshness rule

`continuation.json` must never silently pretend to be current. If any source markdown hash differs from `source_hashes`, mark manifest `resume.continuation_state = "stale"`.

Marking stale is preferred over auto-regenerating a guessed resume pack.

### 13.8 Migration amendment

- `memory.json` v1 remains readable.
- Upgrading to v2 should backfill defaults for `project_identity`, `discovery`, and `resume`.
- `continuation.json` is optional on upgrade.
- `.memory-manifest.json` should be created during bootstrap or doctor `--fix`.

### 13.9 Stage-3 first slice recommendation

Implement this in order:

1. pointer file discovery
2. `memory.json` v2 fields
3. `continuation.json` read/write/validate helpers
4. manifest updater freshness marking
5. compact injector `resume` support
6. doctor checks for pointer + continuation freshness
