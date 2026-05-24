# PLUGIN_AGENTS_AND_DELEGATION_MAP

## Scope

This report maps built-in agents, custom agent discovery, exact subagent routing, category fallback behavior, `call_omo_agent` boundaries, and Hecateq-specific delegation policy. Primary runtime sources are `src/agents/`, `src/tools/delegate-task/`, `src/tools/call-omo-agent/`, `src/plugin/tool-registry.ts`, and `src/features/claude-code-agent-loader/`.

## Built-in Agents

Live built-in agent identity sources:

- `src/agents/types.ts`
- `src/agents/builtin-agents.ts`
- `src/shared/agent-display-names.ts`

Confirmed built-in agent keys include:

- `sisyphus`
- `hephaestus`
- `prometheus`
- `atlas`
- `sisyphus-junior`
- `metis`
- `momus`
- `oracle`
- `librarian`
- `explore`
- `multimodal-looker`
- `hecateq-orchestrator`

Prometheus is special-cased in config-building flow rather than just another entry in the generic factory map.

## Custom Agent Discovery

Runtime custom agent loading is spread across `src/features/claude-code-agent-loader/` and delegate-task discovery helpers.

Observed discovery sources:

- user Claude/OpenCode agent directories
- project Claude/OpenCode agent directories
- config-defined agents
- markdown agent files with YAML frontmatter
- JSON/JSONC agent definition files
- Hecateq agent index data via `src/shared/hecateq-agent-indexer.ts`

Important nuance: the index is a discovery/suggestion/enrichment layer, not a proven single runtime source of truth.

## Agent Identity / Display Name / Internal ID

`src/shared/agent-display-names.ts` is the canonical display-name mapping used for UI/prompt normalization. Notable entries:

- `sisyphus` → `Sisyphus - ultraworker`
- `hephaestus` → `Hephaestus - Deep Agent`
- `prometheus` → `Prometheus - Plan Builder`
- `atlas` → `Atlas - Plan Executor`
- `hecateq-orchestrator` → `Hecateq God`

The file also documents a specific runtime/UI constraint: display names must not contain parentheses because they are passed through HTTP headers.

## Agent Visibility

Visibility is shaped by multiple layers:

- hardcoded built-in display-name mapping
- per-agent overrides in config
- hidden/disabled/enabled filtering for discovered custom agents
- registration success in agent config handler

Hecateq-specific visibility work is visible in the fork through modified files like `src/shared/agent-display-names.ts` and Hecateq-related tests in the dirty working tree.

Compatibility note: `src/shared/agent-display-names.ts` also includes display-name mappings for `athena`, `athena-junior`, and `council-member`. These names participate in normalization/display compatibility, but they are not surfaced as primary built-in factory agents in the runtime paths analyzed by this report.

## Exact Subagent Delegation

Exact delegation is driven by `task`/delegate-task, not by `call_omo_agent`.

Primary files:

- `src/tools/delegate-task/tools.ts`
- `src/tools/delegate-task/subagent-resolver.ts`
- `src/tools/delegate-task/subagent-discovery.ts`
- `src/tools/delegate-task/executor-types.ts`

Observed behavior from agent findings:

- `task(subagent_type="...")` attempts exact resolution
- coordinator-style agents are guarded against as subagent targets
- disabled exact agents return explicit disabled behavior rather than silently degrading
- unknown exact names produce explicit failure/suggestion behavior

This aligns with Hecateq policy text that rejects silent fallback for unknown/disabled exact agent names.

## Category Fallback

Category routing is a separate pathway from exact subagent routing.

Main files:

- `src/tools/delegate-task/category-resolver.ts`
- `src/tools/delegate-task/constants.ts`
- `src/plugin/tool-registry.ts`

Runtime evidence indicates:

- `task(category="...")` routes through category configuration and model/category selection logic
- `disabled_categories` is passed into delegate-task creation from `pluginConfig.disabled_categories`
- category routing typically resolves into Sisyphus-Junior-style execution rather than arbitrary exact agent spawning

Important Hecateq nuance: policy text prefers exact custom-agent routing when valid, but runtime still has separate category machinery. Therefore, “custom-agent-first” is partly policy/prompt behavior and partly resolver/discovery assistance, not a single universal executor primitive.

## call_omo_agent Boundary

`call_omo_agent` is deliberately narrower than `task`.

Relevant files:

- `src/tools/call-omo-agent/constants.ts`
- `src/tools/call-omo-agent/agent-resolver.ts`
- `src/tools/call-omo-agent/tools.ts`

Observed behavior from delegated analysis:

- allowed agents are restricted to `explore` and `librarian`
- tool is intended for evidence gathering, not general orchestration
- other built-ins, custom agents, and categories are intentionally outside its scope

That makes `call_omo_agent` a specialist read/search lane, while `task` is the broader execution/delegation lane.

## Background / Foreground Execution

Delegate-task and background-task systems intersect but are distinct.

- background orchestration: `src/features/background-agent/manager.ts`
- tool exposure: `src/tools/background-task/create-background-output.ts`, `create-background-cancel.ts`
- delegate-task receives `BackgroundManager` as a dependency from `src/plugin/tool-registry.ts`

Observed runtime pattern:

- sync execution waits on task completion/polling pathways
- background execution returns `bg_...` task IDs and session metadata
- result retrieval and cancellation happen through `background_output` and `background_cancel`

## Hecateq God Delegation Policy

The strongest Hecateq-specific routing contract lives in `src/agents/hecateq-orchestrator/default.ts`.

Key behavioral claims from that policy, corroborated by delegated analysis:

- never call unknown or disabled agents
- unknown exact names should hard-fail, not silently fall back
- disabled exact agents should return explicit disabled behavior
- category routing is secondary when no valid exact custom agent exists

This policy is partly prompt-level discipline. Runtime enforcement is distributed across subagent discovery/resolution and exact-agent guardrails.

## Agent Index Role

The Hecateq agent index, implemented in `src/shared/hecateq-agent-indexer.ts`, provides:

- domain classification
- capability scoring
- suggestion/ranking metadata
- stale/freshness handling hooks for doctor and runtime helpers

However, based on live code structure, it is best described as an advisory enrichment layer. It influences summaries, suggestions, and possibly custom-agent-first prompt behavior, but live task routing still depends on actual agent registration and resolver logic.

## Runtime Source Of Truth

The closest thing to runtime source of truth is not the index; it is the combination of:

- registered built-in agents
- live discovered custom agents
- agent config handler output
- delegate-task resolver/discovery logic
- tool registry wiring

Therefore:

- `/hecateq-agent-index` is not itself the ultimate source of runtime truth
- the index can be stale or missing while runtime agent registration still exists
- conversely, an index can summarize agents without guaranteeing exact runtime routing success if those agents are disabled or otherwise filtered

## Tests

Evidence of delegation/agent test coverage includes:

- `src/agents/sisyphus-hecateq-handoff.test.ts`
- `src/agents/builtin-agents/hecateq-orchestrator-agent.test.ts`
- `src/agents/utils.test.ts`
- `src/tools/delegate-task/zauc-mocks-subagent-resolver/subagent-resolver.test.ts`
- `src/tools/delegate-task/subagent-discovery.test.ts`
- related modified tests in the dirty workspace

No tests run because this was documentation-only analysis.

## Gaps

- exact per-agent permission tables are distributed across many factory files and supporting tests rather than summarized in one runtime table
- some custom-agent-first semantics are still encoded more strongly in prompt/policy text than in a single deterministic executor layer
- the index/runtime boundary needs a clearer first-party doc statement

## Recommendations

1. Add a single runtime doc or source comment block that states the precedence order: built-in registration, custom discovery, disabled filtering, exact subagent resolution, category fallback, and index/suggestion enrichment.
2. Add or surface tests that explicitly pin stale/missing agent-index behavior versus live routing behavior.
3. Document `call_omo_agent` as a deliberately restricted evidence-gathering tool, not a general delegation primitive.
4. Keep the Hecateq policy and resolver behavior aligned; right now the intent is clear, but the truth is still distributed across prompt text and resolver code.
