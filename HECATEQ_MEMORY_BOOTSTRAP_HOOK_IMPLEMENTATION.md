HECATEQ_MEMORY_BOOTSTRAP_HOOK_IMPLEMENTATION

## Scope

This change adds a minimal runtime bootstrap hook for project-root memory inside this fork only.
It does not change package names, binary names, plugin IDs, schema paths, installer behavior, runtime fallback behavior, TUI rendering, or routing/category/subagent validation semantics.
It does not add a new top-level config field.

## What Changed

- Added a new runtime hook: `hecateq-memory-bootstrap`.
- Added a shared helper for project-root detection, memory path constants, file templates, and idempotent bootstrap writes.
- Registered the hook in session hooks and made it disableable through `disabled_hooks`.
- Reused the same memory path/file standard in the doctor check through shared constants.
- Added focused unit tests for bootstrap behavior and registration behavior.

## Hook Name

`hecateq-memory-bootstrap`

## Trigger Point

The hook runs on `session.created`.

Behavior:

- It only reacts to `session.created`.
- It skips subagent sessions when `parentID` is present.
- It runs once per hook instance via an internal `fired` guard.

Reasoning:

- `session.created` is the safest low-noise event for one-time bootstrap work.
- It avoids broad coupling to tool execution, transforms, or chat message flows.

## Project Root Detection

Project root detection is handled by a small shared helper.

Priority:

1. nearest directory containing `.opencode`
2. nearest directory containing `.git`
3. nearest directory containing one of:
   - `package.json`
   - `pubspec.yaml`
   - `Cargo.toml`
   - `go.mod`
   - `pyproject.toml`

If no root is found, the hook performs no write and logs a soft warning.

Explicit answer:

- Project root is found by upward traversal from `ctx.directory`.
- `.opencode` is preferred over `.git`.
- `.git` is used when `.opencode` is absent.
- Known project manifest files are the final fallback.

## Memory Path

The hook bootstraps:

`<project-root>/.opencode/memory/knowledge/context/`

This is shared with the doctor check via common constants.

## Memory Templates

The hook creates these files only when missing:

- `active-context.md`
- `progress.md`
- `tasks.md`
- `file-map.md`
- `decisions.md`

Templates are short and TODO-based, matching the requested bootstrap shape.

Explicit answer:

- yes, `.opencode/memory/knowledge/context/` is created when missing
- yes, all five files are created when missing

## Idempotency

The bootstrap is idempotent.

- Existing files are never overwritten.
- Empty existing files are still treated as existing and left untouched.
- Missing files are created once.
- Repeated bootstrap calls do not recreate existing files.
- The hook itself also has a per-instance single-fire guard.

Explicit answer:

- yes, var olan dosyalar overwrite edilmiyor
- yes, hook idempotent

## Disabled Hook Support

The hook is integrated into the existing hook registry and can be disabled with:

```json
{
  "disabled_hooks": ["hecateq-memory-bootstrap"]
}
```

Implementation details:

- added to `HookNameSchema`
- respected by existing `isHookEnabled` flow in session hook creation

Explicit answer:

- yes, `disabled_hooks` ile kapatılabiliyor

## Doctor Compatibility

Doctor and runtime bootstrap now share the same standard through shared constants:

- `PROJECT_MEMORY_DIR`
- `PROJECT_MEMORY_FILES`

This keeps the path and file list aligned between runtime bootstrap and `hecateq-workflow` doctor checks.

Explicit answer:

- yes, doctor check ile aynı path/file standardı kullanılıyor

## Runtime Behavior

This runtime behavior is intentionally minimal.

- It only bootstraps missing directory/files.
- It does not continuously read memory files.
- It does not auto-update memory contents.
- It does not add a watcher or manager.
- It does not write outside the detected project root.
- It does not break the main flow if bootstrap fails.
- Failures are softened into logs/warnings.

Because reliable “Hecateq active session” detection is not guaranteed at this stage, the runtime behavior is session/project-general rather than Hecateq-only. It is still scoped to the current project root and remains low-risk.

Explicit answer:

- Hecateq’e özel tam active-agent gating yok
- hook session/project genelinde güvenli bootstrap olarak çalışıyor
- runtime memory içeriği otomatik okunmuyor; sadece bootstrap yapılıyor

## Files Changed

- `src/shared/memory-bootstrap.ts`
- `src/hooks/hecateq-memory-bootstrap/index.ts`
- `src/hooks/hecateq-memory-bootstrap/index.test.ts`
- `src/hooks/index.ts`
- `src/plugin/hooks/create-session-hooks.ts`
- `src/plugin/hooks/create-session-hooks.test.ts`
- `src/config/schema/hooks.ts`
- `src/config/schema.test.ts`
- `src/cli/doctor/checks/hecateq-workflow.ts`
- `src/cli/doctor/checks/hecateq-workflow.test.ts`
- `HECATEQ_MEMORY_BOOTSTRAP_HOOK_IMPLEMENTATION.md`

## Tests Added / Updated

Added or updated coverage for:

- `.opencode` root detection
- `.git` root detection
- manifest-based root detection
- missing directory/file bootstrap
- no overwrite behavior
- idempotency
- no write when no project root is found through the hook entrypoint
- soft failure behavior on filesystem problems
- `disabled_hooks`-style registration behavior via session hook creation
- doctor compatibility with shared memory constants

## Tests Run

Successful:

1. `bun test src/hooks/hecateq-memory-bootstrap`
2. `bun test src/cli/doctor/checks/hecateq-workflow.test.ts src/agents/builtin-agents/hecateq-orchestrator-agent.test.ts src/agents/utils.test.ts`
3. `bun test src/plugin/hooks src/testing`

Additional optional run attempted:

4. `bun test src/hooks src/cli/doctor/checks/hecateq-workflow.test.ts`

The optional broad hooks run exposed unrelated pre-existing module resolution failures under other hook suites and was not required to validate this change.

## Behavior Before

- Hecateq memory policy existed only at prompt level.
- Doctor could warn about missing project-root memory.
- No runtime bootstrap created the memory directory or template files.

## Behavior After

- A minimal runtime hook now bootstraps project-root memory on `session.created`.
- Missing memory directory/files are created safely.
- Existing files remain untouched.
- Doctor and runtime use the same path/file standard.

## Risks

- The hook is intentionally project-general at session start instead of strictly Hecateq-only, because that is safer than unreliable active-agent detection for this phase.
- Prompt policy behavior is preserved, but runtime now adds a small amount of automatic filesystem initialization.
- The optional broad hook test command currently has unrelated failures outside this scope.

## Rollback

Low-risk rollback steps:

1. Remove `src/hooks/hecateq-memory-bootstrap/`.
2. Remove `src/shared/memory-bootstrap.ts` or stop exporting/using it.
3. Remove registration from `src/plugin/hooks/create-session-hooks.ts`.
4. Remove the hook name from `src/config/schema/hooks.ts`.
5. Restore doctor constants inline if shared constants are no longer used.
6. Remove the associated tests and this report file.

No schema migration, installer rollback, or runtime fallback rollback is required.

## Explicit Answers

- Hook adı ne? `hecateq-memory-bootstrap`
- Hangi event/trigger’da çalışıyor? `session.created`
- Hecateq’e özel mi, session/project genelinde mi? Session/project genelinde, current project root ile sınırlı
- Project root nasıl bulunuyor? `.opencode` → `.git` → manifest files, upward traversal from `ctx.directory`
- `.opencode/memory/knowledge/context/` oluşturuluyor mu? Evet
- Beş dosya oluşturuluyor mu? Evet, eksikler oluşturuluyor
- Var olan dosyalar overwrite ediliyor mu? Hayır
- Hook idempotent mi? Evet
- `disabled_hooks` ile kapatılabiliyor mu? Evet
- Doctor check ile aynı path standardı mı kullanılıyor? Evet
- Runtime’da memory içeriği otomatik okunuyor mu, yoksa sadece bootstrap mı? Sadece bootstrap
- Hecateq prompt policy bozuldu mu? Hayır
- Sisyphus/Hephaestus etkileniyor mu? Hayır, doğrudan davranış değişikliği yok
- Hangi testler çalıştı? Yukarıdaki üç hedef komut geçti; opsiyonel geniş hook komutu unrelated failures verdi
