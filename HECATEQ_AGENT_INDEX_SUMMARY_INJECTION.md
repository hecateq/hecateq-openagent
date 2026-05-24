HECATEQ_AGENT_INDEX_SUMMARY_INJECTION

## Scope

Add a short generated agent capability summary to the Hecateq Project Context Injector without changing routing, scheduling, slash commands, generated index path, or Hecateq prompt wording.

## What Changed

- Added agent index summary rendering to `src/hooks/hecateq-project-context-injector/index.ts`.
- Reused the generated index schema and default output path from `src/shared/hecateq-agent-indexer.ts`.
- Added small Hecateq context injection config knobs for enabling and limiting the summary.
- Added tests for missing, invalid, compact, expanded, grouping, and limit behavior.

## Config Additions

Added under `hecateq.context_injection`:

```jsonc
{
  "include_agent_index": true,
  "max_agent_domains": 8,
  "max_agents_per_domain": 5
}
```

Yes, `include_agent_index` config was added.

## Agent Index Path

Path: `~/.config/opencode/hecateq/agent-index.generated.json`

Resolution uses the existing OpenCode config dir helper via `getOpenCodeConfigDir({ binary: "opencode" })`.

## Summary Format

The injector now renders a short section like:

```md
Agent capabilities:
- index: present
- agents_indexed: 51
- weak_metadata: 0
- duplicates: 0

Top domains:
- backend: nodejs-backend-architect, nodejs-backend-developer

Routing note:
- Use this index as ranking aid only.
- Final delegation must use runtime-valid `task(subagent_type="...")`.
```

Full JSON is not injected into the prompt.

## Compact Mode Behavior

- Compact mode adds a short summary section only.
- It does not print full JSON.
- It does not print `body_preview`, `use_when`, or `avoid_when`.
- It groups agents by `primary_domain`.
- It limits output with `max_agent_domains` and `max_agents_per_domain`.
- In practice the added section is roughly a few hundred characters, and remains inside the existing `max_total_chars` limit.

## Expanded Mode Behavior

- Expanded mode adds the same summary plus `generated` timestamp.
- Expanded mode still does not print full JSON.

Expanded mode does not inject full JSON.

## Missing / Invalid Index Behavior

Missing index:

```md
Agent capabilities:
- index: missing
- run /hecateq-agent-index to generate capability index
```

Invalid index:

```md
Agent capabilities:
- index: invalid
- run /hecateq-agent-index to regenerate
```

Missing index does not break context injection.
Invalid index does not break context injection.

## Token Safety

- The summary stays inside the existing context block budget.
- Compact mode only shows counters, top grouped domains, and the routing note.
- Expanded mode adds only a small amount of extra metadata.
- Final output is still truncated by existing `max_total_chars` logic if needed.

## Hecateq God Prompt Relationship

- Agent index is still treated as a ranking aid, not runtime truth.
- Final delegation still requires runtime-valid `task(subagent_type="...")`.
- Hecateq prompt was not changed in this phase.

Hecateq prompt did not change.

## Files Changed

- `src/config/schema/hecateq.ts`
- `src/config/schema.test.ts`
- `src/plugin-config.test.ts`
- `src/hooks/hecateq-project-context-injector/index.ts`
- `src/hooks/hecateq-project-context-injector/index.test.ts`
- `HECATEQ_AGENT_INDEX_SUMMARY_INJECTION.md`

## Tests Added / Updated

- Config defaults and override parsing for `include_agent_index`, `max_agent_domains`, `max_agents_per_domain`
- Injector tests for:
  - missing index
  - present index
  - invalid index
  - grouped primary domains
  - per-domain limit
  - domain count limit
  - confidence / ambiguity ordering
  - `include_agent_index=false`
  - compact and expanded no-full-JSON behavior

## Tests Run

Ran:

```bash
bun test src/hooks/hecateq-project-context-injector/index.test.ts src/config/schema.test.ts src/plugin-config.test.ts
bun test src/shared/hecateq-agent-indexer.test.ts src/hooks/auto-slash-command/executor.test.ts src/features/builtin-commands/commands.test.ts
bun test src/agents/builtin-agents/hecateq-orchestrator-agent.test.ts src/agents/sisyphus-hecateq-handoff.test.ts
bun test src/cli/doctor/checks/hecateq-workflow.test.ts src/tools/delegate-task/category-resolver.test.ts src/tools/delegate-task/zauc-mocks-subagent-resolver/subagent-resolver.test.ts
```

Also executed:

- LSP diagnostics on modified files: no error diagnostics
- Manual smoke run of `buildProjectContextBlock()` showing injected `Agent capabilities:` output

## Behavior Before

- Context injector showed project root, git checkpoint summary, memory state, and artifact state.
- It did not expose the generated agent capability index inside `<hecateq-project-context>`.

## Behavior After

- Context injector still preserves existing compact/expanded behavior.
- It now adds a short agent capability summary when enabled.
- Agents are grouped by `primary_domain`.
- High-signal agents sort earlier within a domain.
- Missing or invalid index states are shown safely and briefly.

## Risks

- If the generated index schema changes later, summary parsing must stay aligned with `HecateqAgentIndexSchema`.
- If too many domains are surfaced via config, token usage rises, but existing truncation still protects the full block.

## Rollback

Remove the agent index summary helpers and the three context config fields, then revert the related tests and this report file.

## Direct Answers

- Full JSON prompta basılıyor mu? No.
- Agent index path nedir? `~/.config/opencode/hecateq/agent-index.generated.json`
- `include_agent_index` config eklendi mi? Yes.
- Compact mode’da ne kadar özet basılıyor? Kısa counter + top domain summary + routing note.
- Expanded mode’da full JSON basılıyor mu? No.
- Missing index durumunda ne oluyor? Short `index: missing` section is injected.
- Invalid index durumunda ne oluyor? Short `index: invalid` section is injected.
- Agentlar `primary_domain`’a göre gruplanıyor mu? Yes.
- Agent index runtime truth olarak mı kullanılıyor, ranking aid olarak mı? Ranking aid only.
- Hecateq prompt değişti mi? No.
- `/hecateq-agent-index` bozuldu mu? No regression observed.
- Hangi testler çalıştı? The four requested `bun test` command groups above, plus diagnostics and a manual smoke run.
