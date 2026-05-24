# HECATEQ_AGENT_INDEX_RUNTIME_ENRICHMENT

## Scope

Attach generated Hecateq agent index metadata to runtime-discovered agents as optional enrichment.

## What Changed

- Added `hecateq.agent_index` config defaults and validation.
- Added reusable runtime enrichment helpers in `src/shared/hecateq-agent-indexer.ts`.
- Enriched `AgentInfo` with optional `agentIndex` metadata in discovery.
- Improved unknown-agent suggestion ranking in subagent resolution.
- Added small doctor details for runtime enrichment config.

## Runtime Source Of Truth

Runtime loader remains the source of truth.

- Built-in/runtime agent discovery still comes from existing loader/discovery paths.
- `agent-index.generated.json` is not used to create, remove, or authorize agents.

## Agent Index Role

The generated index is metadata only.

- ranking
- suggestion formatting
- optional domain/capability hints on runtime-valid agents

## Config Additions

Added under `hecateq.agent_index`:

- `enabled`
- `enrich_runtime_agents`
- `use_for_suggestions`
- `require_fresh`
- `fallback_to_runtime_only`
- `max_suggestions`

Defaults:

```json
{
  "enabled": true,
  "enrich_runtime_agents": true,
  "use_for_suggestions": true,
  "require_fresh": false,
  "fallback_to_runtime_only": true,
  "max_suggestions": 10
}
```

## Metadata Fields

Runtime `AgentInfo` now supports:

- `agentIndex.primaryDomain`
- `agentIndex.secondaryDomains`
- `agentIndex.agentType`
- `agentIndex.confidence`
- `agentIndex.ambiguity`
- `agentIndex.useWhen`
- `agentIndex.avoidWhen`
- `agentIndex.capabilities`
- `agentIndex.stale`

## Join Strategy

Join is runtime-first and non-destructive.

Matching uses normalized variants derived from:

- internal/config key
- migrated alias key
- display name
- filename stem fallback

Duplicate canonical index identities are skipped for attachment.

## Subagent Discovery Integration

`mergeWithDiscoveredAgents()` now:

1. builds the runtime-valid merged list
2. reads the generated index
3. attaches metadata only to already-discovered agents

It does not add index-only agents.

## Subagent Resolver Suggestion Ranking

Unknown-agent suggestions now prefer:

1. name similarity
2. higher confidence
3. lower ambiguity
4. agents with primary-domain metadata

If metadata is absent or suggestion enrichment is disabled, legacy comma-separated suggestions remain.

## Missing / Invalid / Stale Index Behavior

- missing index: no-op
- invalid index: no-op
- stale + `require_fresh=false`: metadata may still attach and is marked `stale`
- stale + `require_fresh=true`: metadata is skipped

Runtime discovery still proceeds in all cases.

## Disabled / Unknown Agent Behavior

- disabled exact agents still return the same disabled-agent error
- unknown exact agents still fail exact validation
- suggestions are improved only when safe metadata exists

## Category Fallback Preservation

Category fallback behavior is unchanged.

- exact `task(subagent_type="...")` validation remains exact
- category routing still uses the existing path
- no deterministic prompt-to-agent router was added

## Doctor Reporting

Doctor now reports:

- runtime enrichment enabled/disabled
- suggestions enabled/disabled
- require_fresh true/false

## Files Changed

- `src/config/schema/hecateq.ts`
- `src/config/schema.test.ts`
- `src/plugin/tool-registry.ts`
- `src/plugin-config.test.ts`
- `src/shared/hecateq-agent-indexer.ts`
- `src/shared/hecateq-agent-indexer.test.ts`
- `src/tools/delegate-task/types.ts`
- `src/tools/delegate-task/executor-types.ts`
- `src/tools/delegate-task/subagent-discovery.ts`
- `src/tools/delegate-task/subagent-discovery.test.ts`
- `src/tools/delegate-task/subagent-resolver.ts`
- `src/tools/delegate-task/zauc-mocks-subagent-resolver/subagent-resolver.test.ts`
- `src/cli/doctor/checks/hecateq-workflow.ts`
- `src/cli/doctor/checks/hecateq-workflow.test.ts`

## Tests Added / Updated

- new discovery tests for runtime enrichment and suggestion fallback
- new shared helper tests for normalization, duplicate safety, stale handling
- resolver tests for ranked unknown-agent suggestions and legacy fallback mode
- config schema/default tests for `hecateq.agent_index`
- doctor detail tests for runtime enrichment config reporting

## Tests Run

```bash
bun test src/shared/hecateq-agent-indexer.test.ts
bun test src/tools/delegate-task/subagent-discovery.test.ts src/tools/delegate-task/zauc-mocks-subagent-resolver/subagent-resolver.test.ts src/tools/delegate-task/category-resolver.test.ts
bun test src/config/schema.test.ts src/plugin-config.test.ts
bun test src/cli/doctor/checks/hecateq-workflow.test.ts src/hooks/hecateq-project-context-injector/index.test.ts
bun test src/hooks/auto-slash-command/executor.test.ts src/features/builtin-commands/commands.test.ts
```

## Behavior Before

- index was used for context summary and doctor only
- runtime discovery had no access to index metadata
- unknown-agent suggestions were plain alphabetical/truncated lists

## Behavior After

- runtime-valid agents can carry optional index metadata
- unknown-agent suggestions can rank by similarity + confidence + ambiguity
- runtime loader remains authoritative
- index-only agents are still not callable

## Risks

- stale generated metadata may influence suggestion ordering when `require_fresh=false`
- alias normalization could over-match if future custom names intentionally collide
- duplicate canonical identities are intentionally dropped from enrichment to stay safe

## Rollback

Safe rollback path:

1. disable with config:
   - `hecateq.agent_index.enrich_runtime_agents=false`
   - `hecateq.agent_index.use_for_suggestions=false`
2. revert the files listed above

## Direct Answers

- Index source of truth oldu mu? **No.**
- Runtime loader source of truth olarak kaldı mı? **Yes.**
- Index metadata runtime-valid agentlara attach ediliyor mu? **Yes.**
- Index’te olup runtime’da olmayan agent ekleniyor mu? **No.**
- Unknown agent suggestion iyileşti mi? **Yes.**
- Exact validation bozuldu mu? **No.**
- Disabled agent behavior bozuldu mu? **No.**
- Category fallback behavior bozuldu mu? **No.**
- Missing/invalid/stale index ne yapıyor? **No-op or stale-marked enrichment only; runtime discovery continues.**
- Hangi config alanları eklendi? **`hecateq.agent_index.*` fields listed above.**
- Hangi testler çalıştı? **See Tests Run.**
