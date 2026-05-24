HECATEQ_CONTEXT_INJECTOR_COMPACT_MODE

## Scope

Add compact/expanded/off verbosity control to the Hecateq project context injector and reduce default injected context size without changing package identity, plugin identity, slash-command semantics, runtime fallback behavior, TUI rendering, memory/artifact bootstrap, or git checkpoint execution behavior.

## What Changed

- Added `hecateq.context_injection.mode` with `compact | expanded | off`.
- Switched the default context injection behavior to compact output.
- Added `hecateq.git_checkpoint.include_dirty_file_count`.
- Changed default git checkpoint context behavior to hide dirty file lists while still showing dirty counts.
- Split project context rendering into compact and expanded branches.
- Updated doctor reporting to show context injection mode and flag expanded/off modes.
- Preserved expanded-mode access to the prior detailed output shape.

## Config Changes

```json
{
  "hecateq": {
    "context_injection": {
      "mode": "compact",
      "max_memory_file_chars": 500,
      "max_total_chars": 2500,
      "max_artifact_files": 5,
      "include_contracts": true,
      "include_task_graphs": true,
      "inject_on_subagents": false,
      "hecateq_only": true
    },
    "git_checkpoint": {
      "include_dirty_file_list": false,
      "include_dirty_file_count": true,
      "max_dirty_files": 10
    }
  }
}
```

## Default Mode

Default mode is now `compact`.

## Compact Mode Behavior

- Context injection remains enabled by default.
- Project root is shown.
- Git checkpoint section stays short.
- Dirty file list is not printed by default.
- Dirty file count is shown when the repo is dirty.
- Memory file statuses are shown as file state + byte size.
- Full memory content is not injected.
- Artifact directories are summarized as ready/missing plus file count.
- Artifact file listing is omitted from the default compact block.
- Context rules are reduced to three short lines.

## Expanded Mode Behavior

- Existing detailed behavior is still available through `mode: "expanded"`.
- Memory summary content is injected again, subject to `max_memory_file_chars` and `max_total_chars`.
- Artifact file listings are shown again, subject to `max_artifact_files`.
- Dirty file list is still gated by `hecateq.git_checkpoint.include_dirty_file_list`.
- Dirty file count can still be suppressed with `include_dirty_file_count: false`.

## Off Mode Behavior

- `mode: "off"` disables project context injection.
- Hook registration can remain in place, but the injector returns without prepending a block.
- Behavior is effectively aligned with `context_injection.enabled = false` for injection.

## Git Checkpoint Output

Compact mode example on dirty repo:

- state: `DIRTY_REPO`
- mode: `suggest`
- checkpoint_created: `no`
- dirty_file_count: `<n>` when enabled
- dirty_files: `omitted in compact mode`
- note: existing helper message

Expanded mode:

- keeps state/mode/checkpoint lines
- shows dirty count when enabled
- shows dirty file list only when `include_dirty_file_list = true`
- respects `max_dirty_files`

## Memory Output

Compact mode:

- shows per-file status lines and sizes
- shows only a short memory status summary
- does not inject memory body content
- does not inject template placeholder summaries

Expanded mode:

- preserves detailed memory summary injection
- still omits template placeholder content through the existing placeholder logic

## Artifact Output

Compact mode:

- shows `contracts: ready|missing, <count> files`
- shows `task-graphs: ready|missing, <count> files`
- does not list individual artifact files

Expanded mode:

- shows detailed artifact directory headings
- lists files up to `max_artifact_files`

## Doctor Reporting

- Doctor now reports `Hecateq context injection mode: <mode>` in details.
- `expanded` mode adds a token-usage detail.
- `off` mode raises a warning that project context injection is disabled by mode.

## Backward Compatibility

- Existing config remains backward-compatible: older configs without `mode` now default to compact.
- Existing `enabled` flag still works.
- Existing `expanded`-style detail can still be recovered explicitly.
- Existing `/hecateq-agent-index` command behavior was not changed.
- Existing agent index quality upgrade behavior was preserved; one unrelated broken classifier path in `hecateq-agent-indexer.ts` was repaired so regression tests pass again.
- Existing git checkpoint helper behavior was preserved; only context rendering defaults changed.

## Files Changed

- `src/config/schema/hecateq.ts`
- `src/config/schema.test.ts`
- `src/config/index.ts`
- `src/plugin-config.test.ts`
- `src/hooks/hecateq-project-context-injector/index.ts`
- `src/hooks/hecateq-project-context-injector/index.test.ts`
- `src/shared/git-checkpoint.ts`
- `src/shared/git-checkpoint.test.ts`
- `src/cli/doctor/checks/hecateq-workflow.ts`
- `src/cli/doctor/checks/hecateq-workflow.test.ts`
- `src/shared/hecateq-agent-indexer.ts`

## Tests Added / Updated

- Schema/default coverage for `context_injection.mode`
- Schema/default coverage for `git_checkpoint.include_dirty_file_count`
- Compact-mode injector output tests
- Expanded-mode injector output tests
- Off-mode injector tests
- Git checkpoint default dirty-list suppression tests
- Doctor mode reporting tests

## Tests Run

- `bun test src/hooks/hecateq-project-context-injector/index.test.ts src/shared/git-checkpoint.test.ts`
- `bun test src/config/schema.test.ts src/plugin-config.test.ts`
- `bun test src/cli/doctor/checks/hecateq-workflow.test.ts`
- `bun test src/shared/hecateq-agent-indexer.test.ts src/hooks/auto-slash-command/executor.test.ts src/features/builtin-commands/commands.test.ts`
- `bun test src/tools/delegate-task/category-resolver.test.ts src/tools/delegate-task/zauc-mocks-subagent-resolver/subagent-resolver.test.ts`

## Behavior Before

- Default context injection was effectively verbose.
- Dirty repos could inject long dirty file lists.
- Memory summaries could consume substantial prompt space by default.
- Artifact listings were verbose by default.
- Doctor did not report context injection mode.

## Behavior After

- Default mode is `compact`.
- Dirty file list is not printed by default.
- Dirty file count is shown by default.
- Compact mode memory summary does not inject full file contents.
- Compact mode artifact listing is reduced to readiness + counts.
- Expanded mode still supports the old detailed behavior.
- Off mode disables injection.

## Risks

- Users relying on implicit verbose default context now need `mode: "expanded"`.
- Compact mode intentionally hides some detail, so debugging workflows that depended on default injected file lists will need explicit config.
- The agent indexer fix is small and targeted, but it touches classification logic outside the injector path.

## Rollback

1. Set `hecateq.context_injection.mode` to `expanded` to recover detailed injection immediately.
2. Set `hecateq.git_checkpoint.include_dirty_file_list` to `true` if dirty file paths must appear again.
3. Revert the touched files listed above to restore the prior defaults.

## Explicit Answers

- Default mode ne oldu? `compact` oldu.
- Dirty file list defaultta basılıyor mu? Hayır.
- Dirty file count gösteriliyor mu? Evet, varsayılan olarak gösteriliyor.
- Compact mode memory summary ne kadar basıyor? Full content basmıyor; yalnızca kısa status/note düzeyi bilgi bırakıyor.
- Compact mode artifact listing nasıl davranıyor? Sadece ready/missing + file count veriyor, tek tek dosya basmıyor.
- Expanded mode eski detaylı davranışı destekliyor mu? Evet.
- Off mode inject’i kapatıyor mu? Evet.
- Existing config backward-compatible mı? Evet; eski config yeni `mode` alanı olmadan çalışıyor ve compact’a düşüyor.
- Existing `/hecateq-agent-index` bozuldu mu? Hayır.
- Existing agent index quality upgrade bozuldu mu? Hayır; regression testini geçirecek şekilde korundu.
- Existing git checkpoint helper bozuldu mu? Hayır; helper çalışmaya devam ediyor, sadece injected output varsayılanı kısaldı.
- Hangi testler çalıştı? Yukarıdaki `Tests Run` bölümündeki beş komutun tamamı çalıştı.
