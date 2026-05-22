# PROJECT_ROOT_MEMORY_IMPLEMENTATION

## Scope

This document describes the **project-root memory standard** introduced as a prompt-level policy for the Hecateq Orchestrator agent in the oh-my-openagent fork (hecateq branch). The standard defines a well-known filesystem path and file naming convention under `.opencode/memory/knowledge/context/` for persisting project-level working context across sessions — but it is enforced at the **prompt level**, not through a runtime memory manager.

The scope covers:

- The constant `HECATEQ_PROJECT_ROOT_MEMORY_POLICY` defined in `src/agents/hecateq-orchestrator/default.ts` (line 43)
- Injection of this policy text into Hecateq's system prompt via `src/agents/hecateq-orchestrator/agent.ts` (line 143)
- The five standardized memory files: `active-context.md`, `progress.md`, `tasks.md`, `file-map.md`, `decisions.md`
- The rule that global/user-level memory must not override project-root memory
- The fallback behavior when the directory or files do not exist
- The associated test coverage in `src/agents/builtin-agents/hecateq-orchestrator-agent.test.ts` and `src/agents/utils.test.ts`

**Not in scope:** Runtime file watchers, automatic read/write hooks, config schema fields (`memory_bank`), a generic memory manager, or propagation of this policy to agents other than Hecateq Orchestrator.

---

## What Changed

This phase made a targeted prompt-level update to the existing Hecateq implementation:

1. **`src/agents/hecateq-orchestrator/default.ts`** — Modified. Added the exported constant `HECATEQ_PROJECT_ROOT_MEMORY_POLICY` and extended `buildDefaultHecateqOrchestratorPrompt()` so a dedicated memory policy section can be injected into the final prompt.

2. **`src/agents/hecateq-orchestrator/agent.ts`** — Modified. Imports `HECATEQ_PROJECT_ROOT_MEMORY_POLICY` and passes it into `buildDefaultHecateqOrchestratorPrompt()` from `buildDynamicPrompt()`.

3. **`src/agents/builtin-agents/hecateq-orchestrator-agent.test.ts`** — Modified. Added prompt assertions for the project-root memory policy, memory path, standard files, global-memory boundary, and coexistence with existing Hecateq sections.

4. **`src/agents/utils.test.ts`** — Modified. Added assertions proving Hecateq includes the project-root memory policy while Sisyphus does not.

5. **`PROJECT_ROOT_MEMORY_IMPLEMENTATION.md`** — New file. Documents this phase.

No runtime memory loading code was added to any plugin handler, hook, feature module, or tool.

---

## Project-Root Memory Standard

The standard defines a convention for project-scoped working memory:

| Aspect | Value |
|--------|-------|
| Owner | Hecateq Orchestrator agent (prompt-level guidance) |
| Location | Project root (walked up from working directory) |
| Mechanism | LLM prompt instruction, not runtime code |
| Enforcement | Prompt-level policy (LLM compliance, not hard gates) |
| Directory creation | Hecateq proposes or creates on demand if missing |

---

## Memory Path

```
.opencode/memory/knowledge/context/
```

This is a relative path anchored at the project root (the directory containing `.opencode/`). It is the same convention used by OpenCode's own context management, but this standard standardizes its use for Hecateq's orchestration workflow.

---

## Memory File Purposes

| File | Purpose |
|------|---------|
| `active-context.md` | Current session state, active tasks, last-updated timestamp |
| `progress.md` | Milestone tracking, roadmap, phase completion status |
| `tasks.md` | Pending and completed task list |
| `file-map.md` | Project structure overview, key file locations |
| `decisions.md` | Architectural decisions, rationale, ADR references |

These five files are the standard set that Hecateq is instructed to read before making broad scans or delegation decisions.

---

## Hecateq Orchestrator Behavior

The memory policy instructs Hecateq to follow this workflow:

```
START
  ├── Read active-context.md (session state, active work)
  ├── Read progress.md (milestones, roadmap)
  ├── Read tasks.md (pending/completed items)
  ├── Read file-map.md (project structure)
  ├── Read decisions.md (architecture rationale)
  ├── Also read architecture docs, README, etc. when relevant
  │
  ├── If directory/files do NOT exist:
  │     └── Propose or safely create the minimal structure
  │
  ├── Make delegation / planning decisions
  │
  └── After completing meaningful work:
        └── Update or propose updates to relevant memory files
```

**Key behavioral points:**

- **Hecateq reads memory before decisions:** Yes. The policy says "Before broad scans or delegation decisions" read the memory files.
- **Memory does not exist:** Hecateq should "propose or safely create the minimal structure." This is an LLM directive, not an automatic filesystem operation.
- **After work:** Hecateq should "update or propose updates to the relevant memory files." Again, prompt-level guidance.

---

## Global Memory Boundary

The policy explicitly states:

> Project-root memory is the authoritative source for project state.
> Global or user-level memory must not override project-root memory.

This means if OpenCode itself or other plugins maintain a global/user-level memory store, Hecateq is instructed to prefer the project-root `.opencode/memory/knowledge/context/` files as the source of truth. There is no runtime guard preventing global override; the boundary exists only in Hecateq's prompt.

---

## Prompt-Level vs Runtime Enforcement

This is a **prompt-level policy**. There is:

- No `memory_bank` field in any config schema (`src/config/schema/oh-my-opencode-config.ts`, `src/config/schema/experimental.ts`, or any other schema file)
- No runtime code that reads, writes, or watches `.opencode/memory/knowledge/context/` files
- No hook, tool, or plugin handler that enforces the memory standard programmatically
- No file-system watcher, periodic sync, or consistency validator
- The policy exists exclusively as a text block inside Hecateq's system prompt

The LLM is expected to follow the guidance as a best-practice convention. If the LLM ignores or deviates from the memory instructions, there is no runtime enforcement layer to compensate.

---

## Files Changed

The following files contain changes related to the Project-Root Memory Policy for this task:

| File | Change |
|------|--------|
| `src/agents/hecateq-orchestrator/default.ts` | Modified to define `HECATEQ_PROJECT_ROOT_MEMORY_POLICY` and allow `buildDefaultHecateqOrchestratorPrompt()` to inject a dedicated memory policy section. |
| `src/agents/hecateq-orchestrator/agent.ts` | Modified to import the memory policy constant and include it in Hecateq's dynamic prompt assembly. |
| `src/agents/builtin-agents/hecateq-orchestrator-agent.test.ts` | Modified with prompt assertions for the project-root memory policy, standard files, global-memory boundary, custom-agent registry section, and dependency-aware routing section. |
| `src/agents/utils.test.ts` | Modified with assertions proving Hecateq includes the project-root memory policy while Sisyphus does not. |
| `PROJECT_ROOT_MEMORY_IMPLEMENTATION.md` | New implementation report for this phase. |

---

## Tests Added / Updated

### New test file

**`src/agents/builtin-agents/hecateq-orchestrator-agent.test.ts`** (201 lines)

Key memory-related test at line 168:

```typescript
test("#then the prompt contains the project-root memory policy with all standard memory files", () => {
  // then — memory policy header
  expect(config!.prompt).toContain("PROJECT-ROOT MEMORY POLICY");
  // then — memory directory path
  expect(config!.prompt).toContain(".opencode/memory/knowledge/context/");
  // then — all standard memory files
  expect(config!.prompt).toContain("active-context.md");
  expect(config!.prompt).toContain("progress.md");
  expect(config!.prompt).toContain("tasks.md");
  expect(config!.prompt).toContain("file-map.md");
  expect(config!.prompt).toContain("decisions.md");
  // then — global memory must not override project-root memory
  expect(config!.prompt).toContain("Global or user-level memory must not override project-root memory");
  // then — still includes the custom-agent registry section
  expect(config!.prompt).toContain("<custom-agent-registry>");
  // then — still includes the dependency-aware routing section
  expect(config!.prompt).toContain("<dependency-aware-routing>");
});
```

### Updated test file

**`src/agents/utils.test.ts`** — adds two assertions at lines 378-380:

```typescript
// #then — hecateq-orchestrator includes PROJECT-ROOT MEMORY POLICY; sisyphus does not
expect(agents["hecateq-orchestrator"].prompt).toContain("PROJECT-ROOT MEMORY POLICY")
expect(agents.sisyphus.prompt).not.toContain("PROJECT-ROOT MEMORY POLICY")
```

This confirms that the memory policy is **Hecateq-exclusive** and does NOT leak into Sisyphus's prompt.

---

## Tests Run

All tests pass with zero failures.

| Test Suite | Files | Pass | Fail |
|------------|-------|------|------|
| `src/agents/builtin-agents/hecateq-orchestrator-agent.test.ts` + `src/agents/utils.test.ts` | 2 | 78 | 0 |
| `src/plugin-handlers/agent-config-handler.test.ts` + `src/tools/delegate-task/category-resolver.test.ts` + `src/tools/delegate-task/zauc-mocks-subagent-resolver/subagent-resolver.test.ts` | 3 | 108 | 0 |
| `src/agents/` (full suite) | 29 | 415 | 0 |

---

## Behavior Before

- No agent in the oh-my-openagent plugin had a project-root memory policy in its system prompt.
- There was no standardized location or file convention for project-level working memory.
- Agents (Sisyphus, Hephaestus, etc.) relied on their own prompt instructions and the session transcript for context; there was no prompt-level directive to read or write `.opencode/memory/knowledge/context/*.md` files.
- Global or user-level memory stores, if present, had no project-level counterpart or override rule.

---

## Behavior After

- Hecateq Orchestrator's system prompt now includes a `PROJECT-ROOT MEMORY POLICY` section directing it to read `active-context.md`, `progress.md`, `tasks.md`, `file-map.md`, and `decisions.md` under `.opencode/memory/knowledge/context/` before making broad scans or delegation decisions.
- Hecateq is instructed to propose or safely create these files if they do not exist.
- Hecateq is instructed to update or propose updates to these files after completing meaningful work.
- The policy explicitly states that project-root memory is authoritative and global/user-level memory must not override it.
- Other agents (Sisyphus, Hephaestus, etc.) are **not** affected — the policy is Hecateq-exclusive.
- There is still no runtime code that programmatically reads or writes memory files. Compliance depends on the LLM following the prompt instructions.

---

## Risks

| Risk | Severity | Description | Mitigation |
|------|----------|-------------|------------|
| LLM non-compliance | Medium | The memory policy is prompt-level. The LLM may skip reading or writing memory files. | Tests verify the policy is present in the prompt. Runtime enforcement would require a future feature. |
| Stale memory files | Low | If Hecateq updates memory files inconsistently, they may become stale or contradictory. | Prompt instructs concise, operational entries. Manual review remains possible. |
| File creation without user consent | Low | The policy says "propose or safely create." An LLM may create files unprompted. | The phrasing "propose or safely create" invites user confirmation. No automatic file creation code exists. |
| Global memory conflict | Low | Another tool or agent writes to the same path with different semantics. | OpenCode's own context management uses this path. Hecateq is instructed to prefer project-root over global. |
| Directory does not exist | None | If `.opencode/memory/knowledge/context/` does not exist, Hecateq is instructed to handle it gracefully. | Prompt covers this case explicitly. No crash path exists since no runtime code touches it. |

---

## Rollback

To remove the Project-Root Memory Policy from the codebase:

1. **Revert the new files** — delete or unstage:
   - `src/agents/hecateq-orchestrator/default.ts` (remove `HECATEQ_PROJECT_ROOT_MEMORY_POLICY` constant and `memoryPolicySection` parameter from `buildDefaultHecateqOrchestratorPrompt`)
   - `src/agents/hecateq-orchestrator/agent.ts` (remove `memoryPolicySection: HECATEQ_PROJECT_ROOT_MEMORY_POLICY` from the `buildDefaultHecateqOrchestratorPrompt` call)
   - `src/agents/builtin-agents/hecateq-orchestrator-agent.test.ts` (remove the memory-content test block at lines 168-199)

2. **Revert modified files**:
   - `src/agents/utils.test.ts` (remove lines 378-380 asserting `PROJECT-ROOT MEMORY POLICY` in Hecateq and its absence in Sisyphus)

3. **Verify**: Run `bun test src/agents/` to confirm all 415 tests still pass after removal.

4. **Clean up**: If the `.opencode/memory/knowledge/context/` directory was created by a running instance, it can be safely deleted — no code depends on its existence.

---

## Q&A — Explicit Answers

**Q: Memory project-root mu?**
A: Yes. The memory lives under `.opencode/memory/knowledge/context/` at the project root.

**Q: Path ne?**
A: `.opencode/memory/knowledge/context/` — a relative path resolved from the project root directory.

**Q: Hangi files standardize edildi?**
A: Five files: `active-context.md`, `progress.md`, `tasks.md`, `file-map.md`, `decisions.md`.

**Q: Hecateq promptu önce memory okuyor mu?**
A: Evet. Prompt: "Before broad scans or delegation decisions: Read active-context.md, progress.md, tasks.md, file-map.md, decisions.md."

**Q: Memory yoksa ne yapıyor?**
A: "Propose or safely create the minimal structure" — prompt-level directive to handle graceful creation.

**Q: Global memory override ediyor mu?**
A: Hayır. Policy explicitly states: "Global or user-level memory must not override project-root memory." Project-root is authoritative.

**Q: Runtime hard enforcement mi prompt-level policy mi?**
A: Prompt-level policy only. No runtime code enforces memory file reads/writes. No `memory_bank` config field exists.

**Q: Sisyphus/Hephaestus etkileniyor mu?**
A: Hayır. Only Hecateq Orchestrator's prompt contains the memory policy. Verified by `utils.test.ts` line 380: `expect(agents.sisyphus.prompt).not.toContain("PROJECT-ROOT MEMORY POLICY")`.

**Q: Custom agent registry bozuldu mu?**
A: Hayır. The custom-agent registry section (`<custom-agent-registry>`) and the memory policy section coexist in Hecateq's prompt. Both are tested together in `hecateq-orchestrator-agent.test.ts` line 192-194.

**Q: Dependency-aware rule bozuldu mu?**
A: Hayır. The `<dependency-aware-routing>` section remains intact in Hecateq's prompt, verified by the same test at line 196-198.

**Q: Hangi testler çalıştı?**
A: Three batches: (1) Hecateq orchestrator + utils: 78 pass. (2) Config handler + category resolver + subagent resolver: 108 pass. (3) Full agents suite: 415 pass across 29 files. All zero failures.
