HECATEQ_GIT_CHECKPOINT_RUNTIME_HELPER_IMPLEMENTATION

## Scope

Add a low-risk runtime Git checkpoint helper for the Hecateq workflow inside this fork only.

Out of scope in this phase:
- runtime scheduler
- task graph executor
- contract validator
- TUI changes
- installer changes
- runtime fallback changes
- package, binary, plugin, schema-path, config-file, or registration identity changes

## What Changed

- Added `hecateq.git_checkpoint` config schema and defaults.
- Added a new shared helper at `src/shared/git-checkpoint.ts`.
- Integrated git checkpoint state detection into the Hecateq project context injector.
- Added optional clean-repo empty checkpoint commit support behind strict config gates.
- Extended the Hecateq doctor check to report git checkpoint configuration behavior.
- Added focused tests for schema, merge behavior, helper behavior, context injection, and doctor reporting.

## Config Schema

Added under top-level `hecateq`:

```json
{
  "git_checkpoint": {
    "enabled": true,
    "mode": "suggest",
    "auto_checkpoint_clean_repo": false,
    "checkpoint_message": "chore: checkpoint before hecateq task",
    "include_status_in_context": true,
    "include_dirty_file_list": true,
    "max_dirty_files": 50,
    "block_destructive_git": true
  }
}
```

## Default Values

- `enabled`: `true`
- `mode`: `suggest`
- `auto_checkpoint_clean_repo`: `false`
- `checkpoint_message`: `chore: checkpoint before hecateq task`
- `include_status_in_context`: `true`
- `include_dirty_file_list`: `true`
- `max_dirty_files`: `50`
- `block_destructive_git`: `true`

## Git State Detection

Runtime helper added: **Yes**.

Implemented in `src/shared/git-checkpoint.ts` with:
- `detectGitState(projectRoot, config?)`
- `resolveGitCheckpointOptions(config?)`

Git commands used:
- `git rev-parse --is-inside-work-tree`
- `git status --short`
- `git commit --allow-empty -m "..."` only under strict clean-repo auto mode
- `git rev-parse HEAD` after successful checkpoint creation

The helper returns one of:
- `CLEAN_REPO`
- `DIRTY_REPO`
- `NO_GIT_REPOSITORY`
- `GIT_ERROR`

## Checkpoint Behavior

Default mode: **`suggest`**.

Default automatic commit behavior: **No**.

`auto_clean_only` behavior:
- only runs when `mode=auto_clean_only`
- only runs when `auto_checkpoint_clean_repo=true`
- only runs when repo is clean
- creates an **empty checkpoint commit** with `--allow-empty`

Clean repo behavior:
- in default `suggest` mode: reports clean state, does not commit
- in `auto_clean_only` + `auto_checkpoint_clean_repo=true`: may create an empty checkpoint commit

## Dirty Repo Behavior

Dirty repo behavior:
- reads `git status --short`
- classifies repo as `DIRTY_REPO`
- returns dirty file count
- optionally returns truncated dirty file list
- **never auto-commits**
- does not read diff content
- does not stage files
- does not stash

Dirty repo blind commit possible: **No**.

## Context Injector Integration

Context block git checkpoint section added: **Yes**.

Integrated into the existing Hecateq context path via:
- `src/hooks/hecateq-project-context-injector/index.ts`
- `src/plugin/hooks/create-session-hooks.ts`

The context block can now include:
- state
- mode
- checkpoint_created
- checkpoint_commit when present
- dirty file list or omission note
- short note/message

Section rules:
- omitted when `git_checkpoint.enabled=false`
- omitted when `include_status_in_context=false`
- omitted when `mode=off`
- dirty file list is truncated by `max_dirty_files`

Existing context injection broken: **No**.

## Doctor Git Checkpoint Checks

Doctor reports new config behavior: **Yes**.

Updated `src/cli/doctor/checks/hecateq-workflow.ts` to report:
- warning when `git_checkpoint.enabled=false`
- detail for `mode=suggest` with no automatic commit
- detail for `mode=auto_clean_only` clean-repo checkpoint behavior
- detail that `block_destructive_git=true` is currently prompt/helper policy only, with no hard guard yet

## Safety Boundaries

Destructive git commands executed by helper: **No**.

The helper does **not** run:
- `git reset --hard`
- `git clean -fd`
- `git push --force`
- branch delete
- rebase
- stash/pop
- `git add .`

Current hard blocking of destructive git commands: **Not added in this phase**.

`block_destructive_git` is currently:
- represented in config
- surfaced by doctor
- reserved for future hard-guard integration

## Files Changed

- `src/config/schema/hecateq.ts`
- `src/shared/git-checkpoint.ts`
- `src/hooks/hecateq-project-context-injector/index.ts`
- `src/plugin/hooks/create-session-hooks.ts`
- `src/cli/doctor/checks/hecateq-workflow.ts`
- `src/config/schema.test.ts`
- `src/plugin-config.test.ts`
- `src/shared/git-checkpoint.test.ts`
- `src/hooks/hecateq-project-context-injector/index.test.ts`
- `src/cli/doctor/checks/hecateq-workflow.test.ts`

## Tests Added / Updated

Updated:
- `src/config/schema.test.ts`
- `src/plugin-config.test.ts`
- `src/hooks/hecateq-project-context-injector/index.test.ts`
- `src/cli/doctor/checks/hecateq-workflow.test.ts`

Added:
- `src/shared/git-checkpoint.test.ts`

## Tests Run

Executed:

1. `bun test src/config/schema.test.ts src/plugin-config.test.ts`
2. `bun test src/shared/git-checkpoint.test.ts src/hooks/hecateq-project-context-injector/index.test.ts`
3. `bun test src/cli/doctor/checks/hecateq-workflow.test.ts src/hooks/hecateq-memory-bootstrap/index.test.ts`
4. `bun test src/agents/builtin-agents/hecateq-orchestrator-agent.test.ts src/agents/utils.test.ts`
5. `bun test src/tools/delegate-task/category-resolver.test.ts src/tools/delegate-task/zauc-mocks-subagent-resolver/subagent-resolver.test.ts`

Also checked changed files with LSP diagnostics and found no diagnostics.

## Behavior Before

- Hecateq prompt policy described git checkpoint expectations.
- No runtime helper existed to classify repo state or safely create checkpoint commits.
- No git checkpoint metadata was injected into Hecateq context.
- Doctor did not report git checkpoint config behavior.

## Behavior After

- Runtime helper classifies repo state.
- Default behavior is still non-destructive and non-committing.
- Clean repo can optionally receive an empty checkpoint commit only under strict auto-clean config.
- Dirty repo never receives an automatic commit.
- No-git repos soft-fail with `NO_GIT_REPOSITORY`.
- Git checkpoint metadata can appear in the Hecateq context block.
- Doctor reports git checkpoint config behavior.

## Risks

- `auto_clean_only` can create repeated empty commits across separate sessions if users enable it and repeatedly start from a clean repo.
- `block_destructive_git` is config-visible but not yet enforced as a hard runtime shell guard.
- The helper currently runs through the Hecateq context injection path, so if Hecateq context injection is disabled, runtime checkpoint automation also does not run in this phase.

## Rollback

To roll back this feature safely:

1. Remove `git_checkpoint` from `src/config/schema/hecateq.ts`.
2. Remove `src/shared/git-checkpoint.ts` and its tests.
3. Remove git checkpoint integration from `src/hooks/hecateq-project-context-injector/index.ts`.
4. Revert `src/plugin/hooks/create-session-hooks.ts` to pass only context injection config.
5. Remove doctor git checkpoint reporting.
6. Re-run the same test list.

## Direct Answers

- Runtime helper eklendi mi? **Evet.**
- Hangi config alanları eklendi? **`hecateq.git_checkpoint.enabled`, `mode`, `auto_checkpoint_clean_repo`, `checkpoint_message`, `include_status_in_context`, `include_dirty_file_list`, `max_dirty_files`, `block_destructive_git`.**
- Default mode nedir? **`suggest`.**
- Default olarak commit atıyor mu? **Hayır.**
- Clean repo’da ne yapıyor? **Durumu `CLEAN_REPO` olarak döndürüyor; defaultta commit atmıyor; sadece strict auto-clean config ile empty checkpoint commit atabiliyor.**
- Dirty repo’da ne yapıyor? **Status okuyor, dirty file summary üretiyor, asla otomatik commit atmıyor.**
- No-git durumda ne yapıyor? **`NO_GIT_REPOSITORY` dönüyor ve ana akışı kırmıyor.**
- `auto_clean_only` ne yapıyor? **Sadece clean repo + `auto_checkpoint_clean_repo=true` iken empty checkpoint commit oluşturabiliyor.**
- Dirty repo’da blind commit mümkün mü? **Hayır.**
- Destructive git komutları çalıştırılıyor mu? **Hayır.**
- Context block’a git checkpoint section ekleniyor mu? **Evet, config izin verirse.**
- Doctor yeni config’i raporluyor mu? **Evet.**
- Existing context injection bozuldu mu? **Hayır.**
- Existing memory/artifact bootstrap bozuldu mu? **Hayır; ilgili regresyon testleri geçti.**
- Hangi testler çalıştı? **Yukarıdaki “Tests Run” bölümündeki 5 komut.**
