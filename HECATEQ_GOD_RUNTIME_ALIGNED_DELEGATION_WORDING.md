HECATEQ_GOD_RUNTIME_ALIGNED_DELEGATION_WORDING

## Scope

- Prompt/policy wording only
- Prompt assertion test updates only
- No new runtime tools
- No scheduler changes
- No route resolver changes
- No task graph executor changes
- No context injector changes
- No agent indexer logic changes
- No doctor check changes
- No config schema changes

## What Changed

- Added runtime-aligned delegation wording to Hecateq God prompt
- Clarified exact delegation primitive as `task(subagent_type="<exact-agent-name>", ...)`
- Added hard boundary for `call_omo_agent`
- Added explicit category fallback boundary
- Added explicit foreground/background delegation rules via `run_in_background`
- Added agent-index runtime validation wording
- Preserved existing minimum-agent, memory-first, contract-first, blocked, and adaptive output sections

## Runtime Findings Applied

- General delegation tool is `task`
- Exact agent delegation runtime path is `task(subagent_type="<exact-agent-name>", ...)`
- `call_omo_agent` is not a generic dispatcher
- `call_omo_agent` is only appropriate for `explore` and `librarian`
- `delegate_task` is subsystem wording, not the exposed runtime tool name
- Category routing does not discover the best exact custom agent
- Category routing is the Sisyphus-Junior fallback path
- Unknown or disabled exact agents must not silently fall back

## Delegation Tooling Policy

- Added `DELEGATION TOOLING POLICY`
- Prompt now distinguishes exact delegation tooling from research tooling
- Prompt now forbids generic misuse of `call_omo_agent`
- Prompt now forbids treating `delegate_task` as the user-facing tool name

## task(subagent_type=...) Usage

- Prompt now states exact runtime delegation uses `task(subagent_type="<exact-agent-name>", ...)`
- Prompt builder note now points to `task(subagent_type=...)` instead of vague “task tool” wording
- Execution note preserves real runtime invocation wording

## call_omo_agent Boundary

- Prompt now says `call_omo_agent` is not a generic custom-agent dispatcher
- Prompt now says `call_omo_agent` should only be used for `explore` or `librarian` research work

## delegate_task Wording

- Prompt now explicitly says `delegate_task` should not be treated as the exposed runtime tool name
- No runtime code was changed; this is wording alignment only

## Category Fallback Boundary

- Added `CATEGORY FALLBACK POLICY`
- Prompt now says category routing is not custom-agent discovery
- Prompt now says category routing goes through the category/Sisyphus-Junior path
- Prompt now says exact owner beats category fallback

## Background / Foreground Policy

- Added `BACKGROUND / FOREGROUND DELEGATION POLICY`
- Prompt now explains when to use `run_in_background=false`
- Prompt now explains when to use `run_in_background=true`
- Prompt now forbids background fanout for similar-agent comparison

## Agent Index Runtime Validation

- Added `AGENT INDEX RUNTIME VALIDATION RULE`
- Prompt now defines agent index as a ranking/selection aid, not runtime truth
- Prompt keeps `primary_domain`, `secondary_domains`, `use_when`, `avoid_when`, high-confidence, and low-ambiguity rules
- Final delegation still requires actual runtime-valid exact agent names

## Minimum-Agent Alignment

- Existing `MINIMUM AGENT PRINCIPLE` preserved
- Added direct alignment with runtime delegation:
  - one capable exact agent beats two partial agents
  - no multi-agent fanout for same ownership
  - no unnecessary QA/security/performance fanout
  - no background work when foreground result is needed first

## Files Changed

- `src/agents/hecateq-orchestrator/default.ts`
- `src/agents/hecateq-orchestrator/agent.ts`
- `src/agents/builtin-agents/hecateq-orchestrator-agent.test.ts`
- `src/agents/sisyphus-hecateq-handoff.test.ts`
- `HECATEQ_GOD_RUNTIME_ALIGNED_DELEGATION_WORDING.md`

## Tests Added / Updated

- Updated Hecateq prompt assertions for:
  - `DELEGATION TOOLING POLICY`
  - `task(subagent_type=...)` wording
  - `call_omo_agent` boundary
  - `delegate_task` wording boundary
  - category fallback boundary
  - `run_in_background` foreground/background guidance
  - agent index runtime validation wording
- Updated Sisyphus handoff assertions to confirm new Hecateq-only runtime-aligned delegation wording

## Tests Run

- `bun test src/agents/builtin-agents/hecateq-orchestrator-agent.test.ts src/agents/utils.test.ts src/agents/sisyphus-hecateq-handoff.test.ts`
- `bun test src/shared/hecateq-agent-indexer.test.ts src/hooks/auto-slash-command/executor.test.ts src/features/builtin-commands/commands.test.ts`
- `bun test src/tools/delegate-task/category-resolver.test.ts src/tools/delegate-task/zauc-mocks-subagent-resolver/subagent-resolver.test.ts`

## Behavior Before

- Prompt preferred exact agents conceptually, but exact runtime delegation wording was still too generic
- `call_omo_agent` boundary was not stated
- `delegate_task` wording boundary was not stated
- Category fallback was marked fallback-only, but not tied clearly to Sisyphus-Junior runtime path
- `run_in_background` usage guidance was missing
- Agent index runtime validation wording was missing

## Behavior After

- Prompt now matches real runtime delegation semantics
- Exact delegation is described as `task(subagent_type=...)`
- `call_omo_agent` is fenced to `explore` / `librarian`
- Category fallback is explicitly last-resort and not discovery
- Foreground/background delegation choice is explicit
- Agent index is explicitly defined as ranking aid, not runtime truth
- BLOCKED behavior remains explicit and preserved

## Risks

- Prompt assertion tests remain string-based, so future prompt rewrites may need updates
- Repo is already dirty; no checkpoint was created in this task
- Other unrelated repo modifications were intentionally left untouched

## Rollback

- Revert the files listed under Files Changed
- Re-run the three test batches above
- Confirm prompt wording returns to the previous generic delegation language while runtime behavior remains unchanged

## Direct Answers

- Yeni runtime tool eklendi mi? Hayır.
- Prompt artık `task(subagent_type=...)` exact delegation primitive olarak görüyor mu? Evet.
- Prompt `call_omo_agent` genel dispatcher değildir diyor mu? Evet.
- Prompt `call_omo_agent` sadece explore/librarian için diyor mu? Evet.
- Prompt `delegate_task` ifadesini user-facing default gibi kullanıyor mu? Hayır.
- Category fallback sınırı netleşti mi? Evet.
- Background/foreground ayrımı netleşti mi? Evet.
- Agent index runtime truth değil, ranking aid olarak tanımlandı mı? Evet.
- BLOCKED davranışı korundu mu? Evet.
- Existing `/hecateq-agent-index` bozuldu mu? Hayır; regression testleri geçti.
- Hangi testler çalıştı? Yukarıdaki üç `bun test` batch'i.
