GIT_CHECKPOINT_POLICY_IMPLEMENTATION

## Scope

Prompt-level Git checkpoint policy integration for the built-in `hecateq-orchestrator` agent only.

Excluded by design:
- runtime hard enforcement
- new Git checkpoint tools or managers
- runtime fallback changes
- installer changes
- TUI render changes
- package name, binary name, plugin ID, TUI plugin ID, schema path, config file name, installer registration changes

## What Changed

- Added a dedicated `GIT CHECKPOINT POLICY` block to the Hecateq Orchestrator prompt.
- Expanded the Hecateq output contract to include `GIT CHECKPOINT:` and the other requested large-task report fields.
- Extended the project-root memory policy text so Git checkpoint guidance explicitly coordinates with `.opencode/memory/knowledge/context/`.
- Added regression tests proving the new Git checkpoint policy is present in Hecateq and absent from Sisyphus.

## Git Checkpoint Standard

Hecateq is now instructed to:

1. Check whether the current directory is a Git repository.
2. Run or request `git status --short`.
3. Classify the repository as `CLEAN_REPO`, `DIRTY_REPO`, or `NO_GIT_REPOSITORY`.
4. Create a safe checkpoint before modifications when appropriate in a clean repository.
5. Use `chore: checkpoint before hecateq task` as the task-start checkpoint message.
6. Avoid blind commits when the repository is already dirty.
7. Report changed files, checkpoint outcome, and a suggested final commit message at the end of meaningful work.

## Git State Classification

### CLEAN_REPO

- No modified or untracked files.
- Safe to create a checkpoint before changes when appropriate.

### DIRTY_REPO

- Existing modified or untracked files are present.
- Hecateq must not blindly commit them.
- Hecateq should inspect or summarize the dirty state first and proceed carefully.

### NO_GIT_REPOSITORY

- No Git repository is available.
- Hecateq must skip checkpoint creation and report `NO_GIT_REPOSITORY`.

## Destructive Git Boundary

This implementation is not runtime hard enforcement.
It is prompt-level policy only.

Hecateq is instructed to require explicit confirmation before:

- `git reset --hard`
- `git clean -fd`
- `git push --force`
- branch deletion
- history rewrite

## Hecateq Orchestrator Behavior

Before a file-changing task, Hecateq is now directed to inspect Git state with `git status --short`.

- In a clean repository, Hecateq may create or recommend a safe checkpoint.
- In a dirty repository, Hecateq must not blindly commit user changes and must summarize or inspect the state first.
- In a non-Git directory, Hecateq must skip checkpoint creation and report `NO_GIT_REPOSITORY`.

Final large-task output now includes:

- `STATUS:`
- `GIT CHECKPOINT:`
- `MEMORY:`
- `DECISIONS:`
- `ROUTING COVERAGE:`
- `CHANGED FILES:`
- `TESTS:`
- `RISKS:`
- `NEXT STEP:`

## Project-Root Memory Interaction

The existing project-root memory policy remains intact.

Hecateq still uses:

- `.opencode/memory/knowledge/context/`
- `active-context.md`
- `progress.md`
- `tasks.md`
- `file-map.md`
- `decisions.md`

The prompt now also states:

- project-root memory should be read before checkpoint decisions
- memory file changes must be reported explicitly in the final output
- a separate memory-focused commit may use `docs: update project memory context`

## Prompt-Level vs Runtime Enforcement

This is prompt-level policy, not runtime hard enforcement.

Existing repo evidence found during implementation:

- Prompt-level guard already existed in `src/agents/hecateq-orchestrator/default.ts` as a lighter `git status` instruction.
- Prompt-level destructive Git warnings already exist in Sisyphus variants:
  - `src/agents/sisyphus/gpt-5-5.ts`
  - `src/agents/sisyphus/claude-opus-4-7.ts`
- Runtime Git-adjacent hook exists in `src/hooks/non-interactive-env/non-interactive-env-hook.ts`.
  - It injects non-interactive environment variables into Git commands.
  - It prevents editor or pager hangs.
  - It does not hard-block destructive Git commands.
- `src/hooks/non-interactive-env/constants.ts` marks interactive Git modes such as `git add -p` and `git rebase -i` as bad or banned patterns.

### Clear answer

- Runtime hard enforcement: no
- Prompt-level policy: yes

## Files Changed

- `src/agents/hecateq-orchestrator/default.ts`
- `src/agents/builtin-agents/hecateq-orchestrator-agent.test.ts`
- `src/agents/utils.test.ts`
- `GIT_CHECKPOINT_POLICY_IMPLEMENTATION.md`

## Tests Added / Updated

Updated:

- `src/agents/builtin-agents/hecateq-orchestrator-agent.test.ts`
  - verifies `GIT CHECKPOINT POLICY`
  - verifies `git status --short`
  - verifies clean/dirty/no-git classification strings
  - verifies destructive Git confirmation policy text
  - verifies final output includes `GIT CHECKPOINT:` and related report fields
- `src/agents/utils.test.ts`
  - verifies the Git checkpoint policy is present in Hecateq
  - verifies the Git checkpoint policy is not injected into Sisyphus

## Tests Run

Executed successfully:

1. `bun test src/agents/builtin-agents/hecateq-orchestrator-agent.test.ts src/agents/utils.test.ts`
   - 79 pass
   - 0 fail
2. `bun test src/plugin-handlers/agent-config-handler.test.ts src/tools/delegate-task/category-resolver.test.ts src/tools/delegate-task/zauc-mocks-subagent-resolver/subagent-resolver.test.ts`
   - 108 pass
   - 0 fail
3. `bun test src/agents/`
   - 416 pass
   - 0 fail

## Behavior Before

- Hecateq already had light prompt guidance to run `git status` before large or destructive changes.
- There was no dedicated Git checkpoint standard.
- There was no clean/dirty/no-git classification contract.
- There was no required `GIT CHECKPOINT:` section in final large-task output.

## Behavior After

- Hecateq now has an explicit task-start Git checkpoint policy.
- Hecateq is directed to classify repo state as `CLEAN_REPO`, `DIRTY_REPO`, or `NO_GIT_REPOSITORY`.
- Hecateq is directed to use `git status --short`.
- Hecateq is directed not to blindly commit user changes in dirty repositories.
- Hecateq now includes `GIT CHECKPOINT:` in its large-task final output contract.

## Risks

- This is instruction-level behavior, so compliance depends on prompt-following rather than runtime enforcement.
- Existing runtime Git behavior is intentionally unchanged.
- No new destructive Git operations are introduced.
- No existing routing, category-disable, exact-subagent, model override, fallback, permission, or project-root memory policies were changed structurally.

## Rollback

To roll back this change safely, revert:

- `src/agents/hecateq-orchestrator/default.ts`
- `src/agents/builtin-agents/hecateq-orchestrator-agent.test.ts`
- `src/agents/utils.test.ts`
- `GIT_CHECKPOINT_POLICY_IMPLEMENTATION.md`

## Direct Answers

### Bu runtime hard enforcement mı, prompt-level policy mi?

Prompt-level policy.

### Hecateq göreve başlamadan önce git durumunu kontrol etmeye yönlendiriliyor mu?

Evet. `git status --short` çalıştırması veya istemesi söyleniyor.

### Clean repo durumunda ne yapıyor?

Uygunsa güvenli checkpoint oluşturuyor veya bunu öneriyor. Önerilen mesaj: `chore: checkpoint before hecateq task`.

### Dirty repo durumunda ne yapıyor?

Mevcut değişiklikleri körlemesine commit etmiyor. Dirty state'i özetliyor veya inceliyor ve dikkatli ilerliyor.

### No-git durumunda ne yapıyor?

Checkpoint oluşturmuyor ve `NO_GIT_REPOSITORY` raporluyor.

### Destructive git komutları engelleniyor mu, yoksa sadece confirmation policy mi var?

Bu değişiklikte sadece confirmation policy var. Runtime hard block eklenmedi.

### Final output’a GIT CHECKPOINT: alanı eklendi mi?

Evet, Hecateq large-task output contract içine eklendi.

### Project-root memory policy bozuldu mu?

Hayır. Aynı kaldı, sadece Git checkpoint coordination metni eklendi.

### Custom agent registry davranışı bozuldu mu?

Hayır. Promptta `<custom-agent-registry>` bölümü korunuyor.

### Dependency-aware backend/frontend rule bozuldu mu?

Hayır. `<dependency-aware-routing>` bölümü korunuyor.

### Sisyphus/Hephaestus etkileniyor mu?

Sisyphus için testle negatif doğrulama eklendi. Bu değişiklik yalnızca Hecateq prompt yüzeyini hedefliyor.

### Hangi testler çalıştı?

Çalıştırılan testler üstte `Tests Run` bölümünde gerçek sonuçlarıyla listelendi.
