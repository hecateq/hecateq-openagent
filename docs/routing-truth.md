# Runtime Routing Truth

## Scope

This document defines the runtime routing contract for `task(subagent_type=...)`, `task(category=...)`, Agent Index advisory use, and the `call_omo_agent` boundary.

## Non-goals

- It does not redefine package identity, binary names, plugin IDs, or config basenames.
- It does not turn Agent Index output into a runtime executor.
- It does not broaden `call_omo_agent` into a general delegation primitive.

## Source of Truth

Runtime routing truth comes from live runtime registration, discovery, config, disabled filtering, and resolver behavior.

## Resolution Precedence

1. Built-in agent registry
2. Custom agent discovery
3. Config-defined agents
4. Disabled filtering
5. Exact subagent resolution
6. Category fallback
7. Agent index suggestion/enrichment

Agent Index is not the runtime source of truth. It may enrich suggestions and explanations, but live agent execution is determined by runtime registration, discovery, config, disabled filtering, and resolver behavior.

## Exact Subagent Resolution

`task(subagent_type="...")` is the exact routing path.

- Valid exact runtime match returns `exact_agent_found`.
- The resolver may match canonical IDs, display names, or aliases, but execution still resolves to a live runtime agent.
- Exact routing does not silently downgrade into category routing.

## Disabled Agent Behavior

If an exact agent exists but is disabled, resolution returns `exact_agent_disabled`.

- Disabled exact agents do not fall through to category routing.
- Disabled agents are excluded from unknown-agent suggestions.

## Unknown Agent Behavior

If no live runtime exact agent matches, resolution returns `exact_agent_unknown`.

- Suggestions may be enriched by advisory Agent Index metadata.
- Unknown exact routing never silently switches to category fallback, even if a category is also present on the call.

## Category Fallback

`task(category="...")` is the explicit category fallback path.

- It is used only when no exact `subagent_type` is requested.
- It routes through the configured category executor path, normally `sisyphus-junior`.
- Category routing is not a custom-agent discovery mechanism.

## Agent Index Advisory Role

Agent Index may be used for:

- suggestion ordering
- ranking and scoring
- explanatory reasons
- doctor summaries and stale/missing/invalid checks
- project context summaries

Agent Index must not:

- declare a runtime agent executable when it is not live
- reactivate a disabled agent
- convert unknown exact routing into category fallback
- broaden `call_omo_agent`
- break exact runtime routing when it is stale, missing, or invalid

## call_omo_agent Boundary

`call_omo_agent` is a restricted evidence-gathering lane.

- Allowed scope: `explore`, `librarian`
- Not allowed: general custom-agent routing, arbitrary built-in execution, category execution
- Hecateq custom-agent-first routing applies through `task`, not through `call_omo_agent`

## Doctor Visibility

Doctor output may report Agent Index as missing, stale, invalid, weak, or ambiguous, but that reporting is advisory.

- Doctor should distinguish prompt-level policy from runtime-level enforcement.
- Doctor should state that exact runtime routing still depends on live registration, discovery, config, disabled filtering, and resolver behavior.

## Test Matrix

The regression matrix must cover:

- exact builtin/custom/config matches
- exact disabled behavior
- exact unknown behavior without silent fallback
- category fallback only on explicit category path
- stale or missing Agent Index not blocking exact runtime matches
- Agent Index suggestion enrichment without runtime authority
- `call_omo_agent` staying outside general routing
