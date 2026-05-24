# call_omo_agent vs task

## task

`task` is the general execution and delegation primitive.

- `task(subagent_type="...")`: exact runtime agent delegation
- `task(category="...")`: explicit category executor path

## call_omo_agent

`call_omo_agent` is a restricted evidence/search lane.

- allowed: `explore`, `librarian`
- not allowed: arbitrary built-in execution
- not allowed: custom-agent execution
- not allowed: category execution

## Why the split exists

`task` owns runtime routing semantics. That includes exact agent matching, disabled filtering, explicit category fallback, and advisory Agent Index enrichment.

`call_omo_agent` is intentionally narrower so worker agents can gather evidence without turning that tool into a second routing system.

## Hecateq policy impact

Hecateq custom-agent-first routing lives on the `task` path.

- exact custom agent delegation should use `task(subagent_type="exact-agent-name", ...)`
- evidence-gathering lanes may use `call_omo_agent` only for `explore` and `librarian`
