HECATEQ_PROJECT_CONTEXT_INJECTOR_IMPLEMENTATION

## Scope

This change adds a read-only Project Context Injector for Hecateq workflow sessions.
It does not add a scheduler, task executor, git checkpoint helper, config schema field, file watcher, memory auto-update system, contract validator, or artifact parser.

## What Changed

- Added a new hook: `hecateq-project-context-injector`.
- Added a read-only helper that builds a short Hecateq project context block from project-root memory and artifact listings.
- Registered the hook in session hooks and made it disableable via `disabled_hooks`.
- Wired the hook into `chat.message` so the context is injected before Hecateq starts working on the user prompt.
- Added focused tests for read-only behavior, truncation, missing files, artifact listing, session guard, and registration.

## Hook Name

`hecateq-project-context-injector`

## Trigger Point

The hook runs on `chat.message`.

It injects the context block on the first eligible Hecateq message for a session, before the prompt continues through the rest of the chat-message pipeline.

## Injection Strategy

The injector works by prepending a generated block to the first text part of the Hecateq user message:

```text
<hecateq-project-context>
...
</hecateq-project-context>
```

It uses a simple per-session guard so the same session is not injected repeatedly.

It also listens for `session.deleted` and clears the session guard entry.

## Hecateq Boundary

This implementation is **Hecateq-only** by agent name.

The hook checks the active `chat.message` agent and only injects when the normalized agent key is `hecateq-orchestrator`.

This means:

- Sisyphus static prompt is unchanged
- Hephaestus static prompt is unchanged
- non-Hecateq sessions do not receive this block

The hook still relies on runtime agent naming in `chat.message`, so the boundary is runtime-Hecateq-scoped rather than compile-time guaranteed.

## Project Root Detection

Project root detection reuses the existing shared helper from `src/shared/memory-bootstrap.ts`.

The same root priority is preserved:

1. `.opencode`
2. `.git`
3. manifest files:
   - `package.json`
   - `pubspec.yaml`
   - `Cargo.toml`
   - `go.mod`
   - `pyproject.toml`

If no project root is found, the hook does not inject and does not create files.

## Memory Context Injection

The hook reads these project-root memory files when present:

- `.opencode/memory/knowledge/context/active-context.md`
- `.opencode/memory/knowledge/context/progress.md`
- `.opencode/memory/knowledge/context/tasks.md`
- `.opencode/memory/knowledge/context/file-map.md`
- `.opencode/memory/knowledge/context/decisions.md`

It injects:

- present/missing/empty status
- file size
- a clipped memory summary from readable files

Missing files are not treated as errors.
Empty files are shown as `present but empty`.
Template-only TODO files are compressed into a placeholder note instead of dumping repetitive content.

## Artifact Listing Injection

The hook lists artifact files from:

- `.opencode/contracts/`
- `.opencode/task-graphs/`

It **does not read artifact contents**.

It injects only directory listings with relative path and file size.

This keeps the block token-efficient and avoids loading full contract/task-graph bodies unless Hecateq later chooses to do a targeted read.

## Token Limits

Conservative fixed limits are used in code:

- max per memory file: `2000` chars
- max total context block: `10000` chars
- max artifact files listed per directory: `20`

Oversized memory content is truncated with `...[truncated]`.

## Read-Only Safety

The hook is read-only.

- it reads files
- it lists artifact directory entries
- it does not create files
- it does not update memory
- it does not modify artifacts

Project creation/bootstrap remains the responsibility of `hecateq-memory-bootstrap`.

## Disabled Hook Support

The hook is added to the hook name schema and can be disabled with:

```json
{
  "disabled_hooks": ["hecateq-project-context-injector"]
}
```

When disabled, `createSessionHooks()` does not register it.

## Files Changed

- `src/hooks/hecateq-project-context-injector/index.ts`
- `src/hooks/hecateq-project-context-injector/index.test.ts`
- `src/hooks/index.ts`
- `src/plugin/hooks/create-session-hooks.ts`
- `src/plugin/hooks/create-session-hooks.test.ts`
- `src/plugin/chat-message.ts`
- `src/config/schema/hooks.ts`
- `src/config/schema.test.ts`
- `HECATEQ_PROJECT_CONTEXT_INJECTOR_IMPLEMENTATION.md`

## Tests Added / Updated

Added or updated coverage for:

- context block generation from memory + artifact listing
- missing memory files not treated as errors
- empty memory files not treated as errors
- truncation of oversized memory content
- max total context size enforcement
- artifact listings without reading file contents
- no injection when project root is missing
- read-only behavior
- per-session single injection guard
- session.deleted cleanup
- disabled hook registration behavior

## Tests Run

Executed successfully:

1. `bun test src/hooks/hecateq-project-context-injector`
2. `bun test src/plugin/hooks/create-session-hooks.test.ts src/hooks/hecateq-memory-bootstrap/index.test.ts`
3. `bun test src/cli/doctor/checks/hecateq-workflow.test.ts src/agents/builtin-agents/hecateq-orchestrator-agent.test.ts src/agents/utils.test.ts`
4. `bun test src/tools/delegate-task/category-resolver.test.ts src/tools/delegate-task/zauc-mocks-subagent-resolver/subagent-resolver.test.ts`

Optional broad run attempted:

5. `bun test src/hooks src/plugin/hooks src/testing`

The optional broad suite still shows pre-existing unrelated module-resolution failures in other hook areas; this injector change did not require or fix those suites.

## Behavior Before

- Hecateq could see prompt-level policy about memory and artifacts.
- Project-root memory/artifact directories could be bootstrapped.
- Hecateq did not automatically receive a short runtime project context block.

## Behavior After

- Hecateq now receives a short, read-only project context block at message time.
- The block summarizes project-root memory state and artifact directory listings.
- The injector remains token-aware and only fires once per session.

## Risks

- The Hecateq boundary relies on runtime `chat.message` agent naming.
- The context block increases prompt size slightly.
- If future sessions use unusual agent naming or omit the agent field, Hecateq-only injection may not fire.

## Rollback

Low-risk rollback steps:

1. Remove `src/hooks/hecateq-project-context-injector/`.
2. Remove its export from `src/hooks/index.ts`.
3. Remove registration from `src/plugin/hooks/create-session-hooks.ts`.
4. Remove the `chat.message` call from `src/plugin/chat-message.ts`.
5. Remove the hook name from `src/config/schema/hooks.ts`.
6. Remove related tests and this report file.

No schema migration or runtime fallback rollback is required.

## Explicit Answers

- Hook adı ne? **`hecateq-project-context-injector`**
- Hangi trigger’da çalışıyor? **`chat.message`**
- Hecateq-only mi, project/session-scoped mı? **Hecateq-only by runtime agent check**
- Project root nasıl bulunuyor? **Existing shared root detection helper with `.opencode` → `.git` → manifest fallback**
- Hangi memory dosyaları okunuyor? **active-context.md, progress.md, tasks.md, file-map.md, decisions.md**
- Memory içerikleri ne kadar inject ediliyor? **max 2000 chars per file, max 10000 chars total**
- Artifact içerikleri okunuyor mu, sadece listing mi? **Sadece listing**
- `.opencode/contracts/` listeleniyor mu? **Evet**
- `.opencode/task-graphs/` listeleniyor mu? **Evet**
- Hook read-only mi? **Evet**
- Dosya oluşturuyor mu? **Hayır**
- `disabled_hooks` ile kapatılıyor mu? **Evet**
- Subagent session’larda inject ediyor mu? **Aynı session’a tekrar inject etmiyor; Hecateq agent adına bağlı olarak yalnız ilk eligible mesajda inject ediyor**
- Hata durumunda ana akışı kırıyor mu? **Hayır**
- Existing memory bootstrap bozuldu mu? **Hayır**
- Existing doctor checks bozuldu mu? **Hayır**
- Hangi testler çalıştı? **Yukarıdaki dört hedef komut + bir opsiyonel geniş suite denemesi**
