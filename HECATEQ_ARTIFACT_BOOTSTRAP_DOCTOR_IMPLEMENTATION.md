HECATEQ_ARTIFACT_BOOTSTRAP_DOCTOR_IMPLEMENTATION

## Scope

This change extends the existing `hecateq-memory-bootstrap` workflow to cover Hecateq project artifact directories and adds doctor visibility for those directories.
It does not add a runtime scheduler, task executor, contract parser, validator, hard block, config schema field, installer change, fallback change, or TUI change.

## What Changed

- Extended the shared bootstrap helper with Hecateq artifact directory constants.
- Extended the existing `hecateq-memory-bootstrap` hook so it also creates `.opencode/contracts/` and `.opencode/task-graphs/`.
- Kept bootstrap idempotent and non-destructive.
- Added doctor checks for artifact directory readiness.
- Added regression tests for artifact bootstrap and doctor reporting.

## Bootstrap Behavior

The existing bootstrap flow now does three things at project root:

1. Ensures `.opencode/memory/knowledge/context/` exists.
2. Ensures missing standard memory files exist.
3. Ensures `.opencode/contracts/` and `.opencode/task-graphs/` exist.

Rules preserved:

- missing directories are created
- existing directories are left untouched
- existing files are not overwritten
- no artifact files are auto-created
- errors stay soft and do not break the main flow

## Artifact Paths

- `PROJECT_CONTRACTS_DIR = ".opencode/contracts"`
- `PROJECT_TASK_GRAPHS_DIR = ".opencode/task-graphs"`

The hook creates directories only:

- `<project-root>/.opencode/contracts/`
- `<project-root>/.opencode/task-graphs/`

It does **not** create:

- `current-contract.md`
- `current-task-graph.md`
- any other artifact file

## Hook Name

The hook name remains:

`hecateq-memory-bootstrap`

This hook now bootstraps both project-root memory and Hecateq artifact directories.

If future separation is needed, this can be split into a dedicated `hecateq-artifact-bootstrap` hook later.

## Trigger Point

The trigger is unchanged:

- `session.created`

The hook still:

- runs once per hook instance
- skips subagent sessions with `parentID`
- resolves project root from the current project directory

## Disabled Hook Behavior

No new hook was added.

That means:

```json
{
  "disabled_hooks": ["hecateq-memory-bootstrap"]
}
```

disables both:

- memory bootstrap
- artifact directory bootstrap

## Doctor Artifact Check

Doctor now checks for:

- `.opencode/contracts/`
- `.opencode/task-graphs/`

Behavior:

- if missing, doctor reports a **warning**
- if present but empty, doctor reports no issue
- if present and containing files, doctor also reports no issue

Missing artifact directories are treated as low-severity readiness issues rather than hard failures, because new projects may legitimately not have initialized them yet.

Doctor also notes when the bootstrap hook is disabled and artifact directories are missing.

## Shared Constants

Doctor and runtime bootstrap share the same constants from the shared helper.

Shared constants now include:

- `PROJECT_MEMORY_DIR`
- `PROJECT_MEMORY_FILES`
- `PROJECT_CONTRACTS_DIR`
- `PROJECT_TASK_GRAPHS_DIR`
- `PROJECT_ARTIFACT_DIRS`

This keeps runtime bootstrap and doctor checks aligned.

## Idempotency

Idempotency is preserved.

- existing memory files are skipped
- existing artifact directories are skipped
- existing artifact files are untouched
- repeated runs do not recreate already-initialized directories

## Prompt Impact

Hecateq prompt policy was not changed in this phase.

This task only adds runtime bootstrap support and doctor visibility for artifact directories that the prompt already references.

## Files Changed

- `src/shared/memory-bootstrap.ts`
- `src/hooks/hecateq-memory-bootstrap/index.ts`
- `src/hooks/hecateq-memory-bootstrap/index.test.ts`
- `src/hooks/index.ts`
- `src/cli/doctor/checks/hecateq-workflow.ts`
- `src/cli/doctor/checks/hecateq-workflow.test.ts`
- `HECATEQ_ARTIFACT_BOOTSTRAP_DOCTOR_IMPLEMENTATION.md`

## Tests Added / Updated

Updated coverage includes:

- artifact directory creation
- no auto-created artifact files
- no overwrite of existing artifact files
- idempotent reruns
- no writes when no project root exists through hook path
- doctor warning for missing artifact directories
- doctor no-issue behavior for empty existing directories
- doctor note when bootstrap hook is disabled
- existing memory bootstrap regression coverage remains passing

## Tests Run

Executed successfully:

1. `bun test src/hooks/hecateq-memory-bootstrap/index.test.ts src/cli/doctor/checks/hecateq-workflow.test.ts`
2. `bun test src/agents/builtin-agents/hecateq-orchestrator-agent.test.ts src/agents/utils.test.ts`
3. `bun test src/tools/delegate-task/category-resolver.test.ts src/tools/delegate-task/zauc-mocks-subagent-resolver/subagent-resolver.test.ts`
4. `bun test src/plugin/hooks src/testing`

## Behavior Before

- Memory bootstrap only initialized `.opencode/memory/knowledge/context/` and standard memory files.
- Hecateq prompt referenced `.opencode/contracts/` and `.opencode/task-graphs/`, but runtime did not prepare those directories.
- Doctor did not report artifact directory readiness.

## Behavior After

- Existing bootstrap hook now also initializes `.opencode/contracts/` and `.opencode/task-graphs/`.
- No artifact file is auto-created.
- Doctor now surfaces artifact directory readiness as a low-severity warning when missing.
- Doctor remains quiet when the directories exist, even if empty.

## Risks

- The existing hook now covers a slightly broader responsibility, though still within the same project-root bootstrap concern.
- Artifact directory warnings are intentionally low-severity, but they add one more possible doctor warning in fresh projects.
- Future phases may want to split memory bootstrap from artifact bootstrap for narrower responsibilities.

## Rollback

Low-risk rollback steps:

1. Remove artifact constants from `src/shared/memory-bootstrap.ts`.
2. Remove artifact directory creation from `bootstrapMemoryFiles()`.
3. Remove artifact-related exports from `src/hooks/index.ts` if desired.
4. Remove `collectProjectArtifactIssues()` and related test coverage.
5. Remove `HECATEQ_ARTIFACT_BOOTSTRAP_DOCTOR_IMPLEMENTATION.md`.

No runtime migration or schema rollback is required.

## Explicit Answers

- Ayrı hook mu yazıldı, mevcut hook mu genişletildi? **Mevcut hook genişletildi.**
- Hook adı hâlâ ne? **`hecateq-memory-bootstrap`**
- Hangi trigger’da çalışıyor? **`session.created`**
- `.opencode/contracts/` oluşturuluyor mu? **Evet**
- `.opencode/task-graphs/` oluşturuluyor mu? **Evet**
- Artifact dosyası oluşturuluyor mu, yoksa sadece klasör mü? **Sadece klasör**
- Var olan dosyalar overwrite ediliyor mu? **Hayır**
- `disabled_hooks` ile kapatılınca artifact bootstrap de duruyor mu? **Evet**
- Doctor artifact klasörlerini kontrol ediyor mu? **Evet**
- Missing artifact dirs warning/info mu? **Warning**
- Empty artifact dirs sorun sayılıyor mu? **Hayır**
- Hecateq prompt değişti mi? **Hayır**
- Existing memory bootstrap bozuldu mu? **Hayır**
- Hangi testler çalıştı? **Yukarıdaki dört komut**
