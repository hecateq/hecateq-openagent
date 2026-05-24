HECATEQ_GOD_PROMPT_DELEGATION_OPTIMIZATION

## Scope

- Prompt/policy behavior only
- No new slash command
- No runtime scheduler work
- No route resolver work
- No task graph executor work
- No doctor check work
- No config schema work
- No hecateq context injector changes
- No agent indexer logic changes

## What Changed

- Reframed the prompt identity to Hecateq God while keeping the internal agent id as `hecateq-orchestrator`
- Tightened intake-first routing behavior
- Added explicit minimum-agent delegation rules
- Added agent-index-ready routing policy
- Strengthened token-efficiency and memory-first rules
- Made contract-first rules more operational
- Added explicit stop/blocked rules
- Switched output guidance to adaptive-by-task-size
- Removed redundant prompt section duplication from the prompt builder

## Hecateq God Identity

- Prompt now identifies the orchestrator as `Hecateq God`
- Internal id remains `hecateq-orchestrator`
- Display-name behavior was not the target of this change set

## Agent Assignment Logic

- Exact custom agents remain first choice
- Category fallback remains fallback-only
- Unknown or disabled agents remain forbidden
- Owner-first delegation is now explicit
- Same work must not be assigned to two agents
- QA/security/performance delegation is now explicitly conditional

## Minimum Agent Principle

- Added `MINIMUM AGENT PRINCIPLE`
- New rule: one capable owner beats two partial owners
- New rule: direct small safe fixes should stay local when delegation overhead is wasteful
- New rule: no parallel start when one agent depends on another's output

## Agent Index Usage Policy

- Added `AGENT INDEX USAGE POLICY`
- Prompt is now ready to use `<hecateq-agent-capabilities>` or generated summaries
- Prefers `primary_domain`
- Uses `secondary_domains` only as support
- Avoids high-ambiguity agents when a better candidate exists
- Validates routing with `use_when` and `avoid_when`
- Falls back to registry metadata when the index is missing
- Returns `STATUS: BLOCKED` instead of guessing when routing is unreliable

## Token Efficiency Rules

- Reads project context block first
- Keeps project-root memory first
- Keeps `file-map.md` first before broad scan
- Explicitly avoids broad codebase scans until narrow sources fail
- Avoids re-reading the same file set across multiple agents
- Passes only required paths/context to delegated agents
- Keeps final output concise unless the user asked for a report
- Encourages a small validation step before broad execution on large work

## Contract-First Rules

- Frontend/admin/mobile work cannot start when backend/API/data model is still unknown
- Shared contract stays mandatory for multi-surface implementation
- Parallel execution is gated on a shared contract
- Contract artifact path reuse is explicit
- Downstream work must be revalidated if the contract changes

## Stop / Blocked Rules

- Added explicit `STOP / BLOCKED RULES`
- Covers missing agent, disabled agent, destructive confirmation, unsafe repo state, missing contract, unresolved ambiguity, and secret risk
- Prompt now explicitly instructs `STATUS: BLOCKED`

## Adaptive Output Format

- Small tasks: `STATUS / DECISION / NEXT`
- Medium tasks: `STATUS / INTAKE SUMMARY / SELECTED AGENT / REASON / NEXT`
- Large tasks: `STATUS / INTAKE SUMMARY / TASK GRAPH / AGENT ROUTING / SHARED CONTRACT / GIT CHECKPOINT / MEMORY / RISKS / NEXT STEP`
- Output is now explicitly adaptive instead of always long-form

## Prompt Cleanup

- Removed redundant builtin/dependency wrapper sections from the prompt builder
- Consolidated agent-routing policy into clearer top-level sections
- Reduced repeated contract-first and routing instructions
- Kept existing task graph, shared contract, project-memory, and git checkpoint policy blocks intact

## Files Changed

- `src/agents/hecateq-orchestrator/default.ts`
- `src/agents/hecateq-orchestrator/agent.ts`
- `src/agents/builtin-agents/hecateq-orchestrator-agent.test.ts`
- `src/agents/sisyphus-hecateq-handoff.test.ts`
- `HECATEQ_GOD_PROMPT_DELEGATION_OPTIMIZATION.md`

## Tests Added / Updated

- Updated Hecateq orchestrator prompt assertions for:
  - Hecateq God identity
  - Minimum Agent Principle
  - Agent Index Usage Policy
  - memory-first and anti-broad-scan rules
  - contract-first operational rules
  - blocked rules
  - adaptive output format
- Updated Sisyphus handoff assertions to confirm the new Hecateq-only prompt blocks without changing Sisyphus handoff behavior

## Tests Run

- `bun test src/agents/builtin-agents/hecateq-orchestrator-agent.test.ts src/agents/utils.test.ts src/agents/sisyphus-hecateq-handoff.test.ts`
- `bun test src/shared/hecateq-agent-indexer.test.ts src/hooks/auto-slash-command/executor.test.ts src/features/builtin-commands/commands.test.ts`
- `bun test src/tools/delegate-task/category-resolver.test.ts src/tools/delegate-task/zauc-mocks-subagent-resolver/subagent-resolver.test.ts`

## Behavior Before

- Prompt had overlapping agent-routing and contract-first sections
- Minimum-agent behavior was implied but not explicit
- Agent-index consumption readiness was missing
- Token-efficiency guidance existed but was less operational
- Output guidance skewed toward a single longer format

## Behavior After

- Prompt uses a clearer intake-first routing flow
- Delegation now prefers the minimum capable owner
- Prompt is ready for agent-index-driven routing
- Memory-first and anti-broad-scan behavior are clearer
- Contract-first behavior is stricter and more operational
- BLOCKED behavior is more explicit
- Output format is adaptive by task size

## Risks

- Prompt assertion tests are still string-based in places, so future prompt rewrites may require test updates
- Existing dirty repo state means only targeted file ownership was used; no checkpoint was created here
- Other in-progress repo changes outside this scope were intentionally not touched

## Rollback

- Revert the five files listed under Files Changed
- Re-run the same three test batches
- Confirm Hecateq prompt returns to pre-change wording while preserving existing runtime behavior

## Direct Answers

- Yeni slash command eklendi mi? Hayır.
- Runtime scheduler eklendi mi? Hayır.
- Route resolver eklendi mi? Hayır.
- Hecateq promptu agent index’i kullanmaya hazır mı? Evet.
- Agent atama mantığı nasıl iyileşti? Exact-owner first, minimum-agent, no-duplicate-work, index-aware validation eklendi.
- Minimum-agent principle eklendi mi? Evet.
- Token kullanımı nasıl optimize edildi? Memory-first, file-map-first, anti-broad-scan, path-scoped delegation kuralları netleşti.
- Contract-first kuralı güçlendi mi? Evet.
- BLOCKED/STOP kuralları netleşti mi? Evet.
- Output format adaptif mi? Evet.
- Existing `/hecateq-agent-index` bozuldu mu? Testlerle doğrulanacak; bu değişiklikte indexer mantığına dokunulmadı.
- Hangi testler çalıştı? Yukarıdaki üç `bun test` batch'i.
