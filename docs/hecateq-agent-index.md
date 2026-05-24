# Hecateq Agent Index

Hecateq Agent Index is a generated advisory layer for routing summaries, suggestion ranking, and doctor visibility.

## What it does

- attaches advisory metadata to live runtime agents when names match
- ranks unknown-agent suggestions
- summarizes domains, ambiguity, and weak metadata in doctor output
- feeds compact project-context summaries

## What it does not do

- it does not decide runtime executability
- it does not bypass disabled filtering
- it does not promote unknown exact agents into category fallback
- it does not broaden `call_omo_agent`

## Runtime boundary

Live routing still depends on:

1. built-in agent registry
2. custom agent discovery
3. config-defined agents
4. disabled filtering
5. exact subagent resolution
6. explicit category fallback

The index may enrich explanations around those decisions, but it does not replace them.

## Operational guidance

- missing index: runtime exact routing still works
- stale index: runtime exact routing still works, but suggestions may degrade
- invalid index: runtime exact routing still works, but advisory summaries should be regenerated
- duplicate index names: runtime exact routing still uses live agents; index attachment should stay conservative
