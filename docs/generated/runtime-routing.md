# Runtime Routing

This file is generated from runtime constants.

## Resolution Precedence

1. Built-in agent registry
2. Custom agent discovery
3. Config-defined agents
4. Disabled filtering
5. Exact subagent resolution
6. Category fallback
7. Agent index suggestion/enrichment

## Exact Resolution Statuses

- exact_agent_found
- exact_agent_disabled
- exact_agent_unknown
- category_fallback

## Agent Index Boundary

Agent Index is not the runtime source of truth. It may enrich suggestions and explanations, but live agent execution is determined by runtime registration, discovery, config, disabled filtering, and resolver behavior.

## call_omo_agent Boundary

- Allowed agents: explore, librarian
- Purpose: restricted evidence/search lane only
- Non-goal: general delegation, arbitrary built-in execution, custom-agent execution, or category routing
