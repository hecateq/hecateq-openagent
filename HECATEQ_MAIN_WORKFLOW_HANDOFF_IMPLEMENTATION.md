HECATEQ_MAIN_WORKFLOW_HANDOFF_IMPLEMENTATION

## Scope

Prompt-level Sisyphus -> Hecateq handoff guidance for large orchestration tasks.

Included:
- Sisyphus prompt-level handoff recommendation
- explicit user-approval gate before handoff
- explicit exact task call requirement for approved handoff
- preservation of current Hecateq visibility without runtime auto-switch

Excluded by design:
- runtime auto-switching
- Hecateq mode changes
- installer changes
- runtime fallback changes
- TUI changes
- disabled_categories behavior changes
- exact subagent validation changes
- Hecateq memory/git/doctor policy changes

## What Changed

- Added a shared `SISYPHUS → HECATEQ HANDOFF POLICY` block in `src/agents/sisyphus.ts`.
- Appended that block to every Sisyphus prompt variant at agent creation time, so GPT, Claude, Kimi, default, and dynamic variants all receive the same handoff instructions.
- Added regression assertions in `src/agents/utils.test.ts`.

## Sisyphus Handoff Policy

Sisyphus is now instructed to recommend Hecateq when a task is:

- large
- multi-domain
- long-running
- project-wide
- memory-dependent
- dependency-heavy
- custom-agent orchestration-heavy

Sisyphus must ask the user first instead of switching automatically.

Included question text:

- English: `This looks like a large multi-domain orchestration task. Do you want me to hand this over to Hecateq Orchestrator?`
- Turkish: `Bu görev büyük ve çok alanlı görünüyor. Bunu Hecateq Orchestrator’a devretmemi ister misin?`

If the user agrees, Sisyphus is instructed to use a real exact call:

- `task(subagent_type="hecateq-orchestrator", ...)`

It is also told not to merely describe the handoff.

## Hecateq Recommended Workflow Role

Hecateq was already described as the primary custom-agent-first planner/router/dispatcher in its own prompt.

This phase does not duplicate or rewrite that policy.
Instead, it makes Sisyphus actively recommend Hecateq as the main workflow agent for large custom-agent-first orchestration.

## Agent Ordering / Visibility

No ordering change was made in this phase.

Current default order already keeps Hecateq highly visible:

- `sisyphus`
- `hecateq-orchestrator`
- `hephaestus`
- `prometheus`
- `atlas`

This was kept intentionally because moving Hecateq ahead of Sisyphus would risk changing perceived primary semantics and would require wider test updates in ordering expectations.

Safe conclusion for this phase:

- Hecateq remains highly visible
- Sisyphus remains the primary agent
- Hecateq becomes the recommended main workflow for large orchestration through prompt guidance, not list reordering

## Hecateq Disabled Behavior

Sisyphus is now instructed that if Hecateq is unknown, unavailable, or disabled:

- the exact handoff cannot be performed
- it should report that clearly to the user
- it should not silently fall back to category routing

Runtime exact-agent disablement behavior itself was not changed.

## Prompt-Level vs Runtime Behavior

This implementation is prompt-level only.

### Clear answer

- Automatic runtime switch: no
- User approval required: yes
- Real exact task call after approval: yes

## Files Changed

- `src/agents/sisyphus.ts`
- `src/agents/sisyphus-hecateq-handoff.test.ts`
- `HECATEQ_MAIN_WORKFLOW_HANDOFF_IMPLEMENTATION.md`

## Tests Added / Updated

Updated:

- `src/agents/sisyphus-hecateq-handoff.test.ts`
  - verifies Sisyphus prompt contains Hecateq handoff policy
  - verifies the large-task English/Turkish handoff questions exist
  - verifies exact `task(subagent_type="hecateq-orchestrator", ...)` instruction exists
  - verifies no runtime auto-switch wording is present
  - verifies Hecateq-specific memory/git prompt blocks remain Hecateq-only

## Tests Run

Executed successfully:

1. `bun test src/agents/sisyphus-hecateq-handoff.test.ts src/agents/utils.test.ts src/agents/builtin-agents/hecateq-orchestrator-agent.test.ts`
   - 79 pass
   - 0 fail
2. `bun test src/plugin-handlers/agent-config-handler.test.ts src/tools/delegate-task/zauc-mocks-subagent-resolver/subagent-resolver.test.ts`
   - 88 pass
   - 0 fail
3. `bun test src/cli/doctor/checks/hecateq-workflow.test.ts src/tools/delegate-task/category-resolver.test.ts`
   - 30 pass
   - 0 fail
4. `bun test src/agents/`
   - 416 pass
   - 0 fail

## Behavior Before

- Hecateq existed as a built-in subagent
- Hecateq already had custom-agent-first, memory, and git checkpoint policies
- Sisyphus did not explicitly recommend Hecateq for large multi-domain work
- Sisyphus did not explicitly instruct itself to ask user approval and then issue a real exact Hecateq task call

## Behavior After

- Sisyphus now explicitly recommends Hecateq for large orchestration-heavy tasks
- Sisyphus now asks the user before handing off
- after approval, Sisyphus is instructed to perform a real exact `task(subagent_type="hecateq-orchestrator", ...)` delegation
- no runtime auto-switch was introduced
- Hecateq remains visible immediately after Sisyphus in ordering

## Risks

- This is still prompt-following behavior, not runtime enforcement
- Ordering was intentionally left unchanged to avoid changing primary semantics and broader ordering expectations
- Exact handoff still depends on the runtime agent being available and not disabled, as before

## Rollback

To revert this phase, revert:

- `src/agents/sisyphus.ts`
- `src/agents/sisyphus-hecateq-handoff.test.ts`
- `HECATEQ_MAIN_WORKFLOW_HANDOFF_IMPLEMENTATION.md`

## Direct Answers

### Sisyphus artık büyük görevde Hecateq’e handoff öneriyor mu?

Evet.

### Otomatik geçiş var mı, yoksa kullanıcı onayı mı gerekiyor?

Kullanıcı onayı gerekiyor. Otomatik geçiş yok.

### Onay sonrası gerçek task(subagent_type="hecateq-orchestrator") çağrısı isteniyor mu?

Evet.

### Hecateq en üstte mi, Sisyphus’tan sonra mı?

Bu aşamada Sisyphus’tan sonra kaldı.

### Hecateq recommended main workflow olarak işaretlendi mi?

Evet, Sisyphus handoff policy üzerinden büyük orchestration işleri için önerilen ana workflow olarak işaretlendi.

### Hecateq mode değişti mi?

Hayır. Subagent olarak kaldı.

### Sisyphus primary davranışı bozuldu mu?

Hayır. Sisyphus primary kaldı.

### Hecateq memory policy bozuldu mu?

Hayır.

### Hecateq git checkpoint policy bozuldu mu?

Hayır.

### Custom agent registry bozuldu mu?

Hayır.

### Existing doctor checks bozuldu mu?

Hayır. Bu aşama doctor check davranışını değiştirmedi.

### Hangi testler çalıştı?

Final task reportta listelenen regression test komutları çalıştırıldı.
