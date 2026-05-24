# AGENT_DELEGATION_SYSTEM_ANALYSIS

## Scope

This document analyzes the real runtime behavior of agent delegation inside the plugin. It covers tool registration, exact subagent resolution, custom-agent discovery, category routing, background execution, prompt/tool wording implications, Hecateq-specific policy implications, and existing test coverage.

Out of scope: code changes, refactors, test edits, prompt edits, feature additions, and slash-command changes.

## Executive Summary

The plugin has two distinct delegation surfaces:

1. `task` is the real general-purpose delegation tool. It is registered from `src/tools/delegate-task/tools.ts` via `src/plugin/tool-registry.ts`, and it supports both `category="..."` and `subagent_type="..."` paths.
2. `call_omo_agent` is a much narrower tool. It is registered separately and is intentionally hard-restricted to `explore` and `librarian` only. It does not expand to runtime custom agents, built-in workers, or categories.

Exact subagent routing is handled by `resolveSubagentExecution()` in `src/tools/delegate-task/subagent-resolver.ts`. Unknown exact agent names do not silently fall back to categories. Disabled exact agents return explicit disabled errors. Primary/coordinator guards are enforced before any spawn.

Category routing is handled separately by `resolveCategoryExecution()` in `src/tools/delegate-task/category-resolver.ts`. Category delegation always targets `Sisyphus-Junior`; it does not select a custom agent at runtime. The only custom-agent-first behavior in category mode is prompt-level guidance injected into the delegated prompt, not a code-level reroute.

For Hecateq God, the safest runtime-aligned policy is: do small local work directly; for non-trivial delegation, prefer exact runtime agent names through `task(subagent_type="...")`; treat category routing as fallback only; use background mode only for independent research/verification; return `STATUS: BLOCKED` when no reliable exact owner exists.

## High-Level Architecture

The delegation stack has five practical layers:

1. **Tool registration**: `src/plugin/tool-registry.ts`
   - Registers `task` from `createDelegateTask(...)`
   - Registers `call_omo_agent` from `createCallOmoAgent(...)`
   - Registers `background_output` / `background_cancel` via background-task tool wrappers

2. **Argument normalization and dispatch**: `src/tools/delegate-task/tools.ts` and `tool-argument-preparation.ts`
   - Normalizes omitted args
   - Defaults `run_in_background` to `false`
   - Forces `category` calls onto `sisyphus-junior`
   - Chooses between category resolver and subagent resolver

3. **Exact resolution / category resolution**
   - Exact: `src/tools/delegate-task/subagent-resolver.ts`
   - Category: `src/tools/delegate-task/category-resolver.ts`

4. **Execution mode**
   - Background: `src/tools/delegate-task/background-task.ts` → `BackgroundManager.launch()`
   - Sync: `src/tools/delegate-task/sync-task.ts`
   - Continuation: `background-continuation.ts` and `sync-continuation.ts`

5. **Background lifecycle engine**
   - `src/features/background-agent/manager.ts`
   - `src/features/background-agent/spawner.ts`
   - `src/tools/background-task/create-background-output.ts`

From a user prompt to agent execution, the typical flow is:

`chat.message` / prompt -> model emits tool call -> `task` or `call_omo_agent` -> resolver -> sync/background executor -> child session spawn -> polling / completion -> optional `background_output`.

## Agent Sources And Discovery

### Built-in Agents

Built-ins are assembled in `src/agents/builtin-agents.ts` via `createBuiltinAgents(...)`.

Important facts:

- Built-ins include Sisyphus, Hecateq, Hephaestus, Atlas, Oracle, Librarian, Explore, Metis, Momus, Multimodal-Looker, and Sisyphus-Junior.
- Prometheus is special-cased in config handling, not created through the normal raw factory list.
- Hecateq is created by `maybeCreateHecateqOrchestratorConfig(...)` and currently uses `mode: "all"` in `src/agents/hecateq-orchestrator/agent.ts`.
- `src/agents/utils.test.ts` verifies Hecateq is built as an `all`-mode agent, which makes it picker-visible and task-callable.

### Global Custom Agents

Global custom agents are loaded from two sources:

- Claude-style user agents: `loadUserAgents()` from `~/.claude/agents`
- OpenCode global agents: `loadOpencodeGlobalAgents()` from OpenCode config dirs

Implementation: `src/features/claude-code-agent-loader/loader.ts`.

### Project Custom Agents

Project-level custom agents are loaded from:

- `loadProjectAgents(directory)` from `<project>/.claude/agents`
- `loadOpencodeProjectAgents(directory)` from `<project>/.opencode/agents`

Implementation: `src/features/claude-code-agent-loader/loader.ts`.

### Config-defined Agents

There are two config-defined paths:

1. Inline OpenCode config agents from `.opencode/opencode.json[c]` or global OpenCode config via `readOpencodeConfigAgents(directory)` in `opencode-config-agents-reader.ts`
2. Explicit `agent_definitions` files loaded via `loadAgentDefinitions(...)`

Inline config supports both `agents` and legacy/fallback `agent` keys. `opencode-config-agents-reader.test.ts` verifies this.

### Claude Agent Sources

The Claude compatibility loader uses Markdown agent files with frontmatter:

- Parsing: `src/features/claude-code-agent-loader/agent-definitions-loader.ts`
- Discovery: `src/features/claude-code-agent-loader/loader.ts`

Plugin-provided agents are loaded separately by `src/features/claude-code-plugin-loader/agent-loader.ts` and are namespaced as `pluginName:agentName`.

## Agent Identity Model

### Internal ID

The real routing key is the normalized config key, resolved by `getAgentConfigKey()` in `src/shared/agent-display-names.ts`.

Examples:

- `Hecateq God` -> `hecateq-orchestrator`
- `Prometheus - Plan Builder` -> `prometheus`
- `Sisyphus - ultraworker` -> `sisyphus`

### Display Name

Display names are defined in `AGENT_DISPLAY_NAMES` in `src/shared/agent-display-names.ts`.

Key distinction:

- **Display name** is what appears in UI/runtime-facing agent config.
- **Config key / internal ID** is what exact routing and override lookup normalize toward.

Notable mapping:

- `hecateq-orchestrator` -> `Hecateq God`

### Aliases / Migration Names

Alias and migration support exists in `src/shared/migration/agent-names.ts`.

Examples:

- `Hecateq God`, `Hecateq Orchestrator`, `hecateq_orchestrator`, `HecateqOrchestrator` -> `hecateq-orchestrator`
- `Sisyphus (Ultraworker)` -> `sisyphus`
- `Prometheus (Plan Builder)` -> `prometheus`

This matters because exact resolution is tolerant to legacy names, display names, casing, quoting, and even some invisible prefix cleanup.

### Disabled Agents

Disabled agents are applied in two different phases:

1. **Registration filtering** in `src/plugin-handlers/agent-config-handler.ts`
   - final `config.agent` omits disabled entries
2. **Exact subagent runtime guard** in `src/tools/delegate-task/subagent-resolver.ts`
   - if a known requested exact agent is disabled, returns `Subagent "<name>" is disabled by disabled_agents.`

This second guard is important because it beats the weaker “unknown agent” path.

## Delegation Tools And Runtime Names

### `call_omo_agent`

`call_omo_agent` is a real exposed tool name. It is registered directly in `src/plugin/tool-registry.ts` as `call_omo_agent: callOmoAgent`.

Behavior:

- Implemented in `src/tools/call-omo-agent/tools.ts`
- Hard-allowlist only: `explore`, `librarian`
- No dynamic expansion to custom agents or other built-ins
- Supports background or sync execution
- Uses `session_id` to continue an existing lookup-agent session

`src/tools/call-omo-agent/agent-resolver.ts` proves the allowlist is static and returns only `ALLOWED_AGENTS`. `agent-resolver.test.ts` explicitly verifies runtime custom agents are ignored.

### `delegate_task`

`delegate_task` is not the primary exposed runtime tool name in this plugin. It is the historical/internal conceptual name for the delegate-task subsystem under `src/tools/delegate-task/`.

The actual exposed tool name is `task`.

Evidence:

- `src/plugin/tool-registry.ts` registers `task: delegateTask`
- `src/tools/delegate-task/tools.ts` defines the tool factory
- Several docs and tests still refer to “delegate-task” or `delegate_task` as the engine/subsystem name

### `task(subagent_type=...)`

`task(subagent_type="...")` is not just prompt wording. It maps to the real `task` tool’s exact-subagent route.

Flow:

- tool invocation enters `src/tools/delegate-task/tools.ts`
- when `subagent_type` is present and `category` is absent, it calls `resolveSubagentExecution(...)`
- successful resolution then goes to sync or background executor

### Runtime Tool Aliases

Practical relationship:

- **User/runtime tool**: `task`
- **Subsystem / internal directory / historical naming**: `delegate-task`, sometimes discussed as `delegate_task`
- **Separate narrow tool**: `call_omo_agent`

Correct mental model:

- `call_omo_agent` != alias of `task`
- `call_omo_agent` != generic agent dispatcher
- `task(subagent_type=...)` is the real exact-agent delegation path

## Exact Subagent Resolution

Exact subagent resolution happens in `src/tools/delegate-task/subagent-resolver.ts`.

Observed runtime steps:

1. Sanitize requested `subagent_type` with `sanitizeSubagentType()`
2. Fetch runtime agent list via `client.app.agents()`
3. Merge with discovered custom/config/plugin agents using `mergeWithDiscoveredAgents(...)`
4. Check disabled exact agent guard first
5. Block illegal targets:
   - direct `sisyphus-junior` unless explicitly allowed
   - plan-family self/cross delegation
   - coordinator targets
   - primary targets unless explicitly allowed
   - reserved hidden native targets like `build`
6. Match against callable agents (`mode === "all" || "subagent"`, visible to task)
7. Resolve model / fallback chain using overrides, category override, matched model, or requirement chain

Important behavior:

- Exact resolution does not silently fall through to category routing.
- Hidden demoted `plan` may still be callable as a special case.
- Hidden `build` is intentionally not callable.

## Unknown Agent Behavior

Unknown exact agent behavior is deterministic.

Error shape from `buildUnknownSubagentTypeError(...)`:

`Unknown subagent_type "<name>". Use one of the available exact agents: <agent-list>. Do not invent agent names.`

`subagent-resolver.test.ts` verifies this repeatedly, including hidden-agent edge cases.

This is one of the strongest signals for Hecateq policy: if no exact owner exists, the runtime prefers a clear error over a silent guess.

## Disabled Agent Behavior

Disabled exact agent behavior is also explicit.

In `subagent-resolver.ts`, if the requested exact agent name is both disabled and known, the error is:

`Subagent "<name>" is disabled by disabled_agents.`

Verified by tests for both `sisyphus-junior` and `hecateq-orchestrator`.

For `call_omo_agent`, disabled behavior is separate and tool-local:

`Error: Agent "<name>" is disabled via disabled_agents configuration...`

## Category Routing And Fallback

Category routing is a separate path from exact subagent resolution.

Implementation: `src/tools/delegate-task/category-resolver.ts`

Behavior:

- Validates `disabled_categories` and `categories.<name>.disable`
- Resolves category config and model
- Always returns `agentToUse: SISYPHUS_JUNIOR_AGENT`
- Injects category prompt append
- Injects a **prompt-level** custom-agent-first reminder block

Critical distinction:

- There is **no code-level custom-agent-first reroute** from category -> exact agent.
- The only custom-agent-first enforcement in category mode is prompt text:
  - “Before executing through generic category behavior, inspect the available custom agents first.”
  - “If an exact specialist exists, delegate using task(subagent_type="exact-agent-name").”

So category fallback exists, but it is still a fallback implemented via Sisyphus-Junior category execution, not an exact resolver.

Implication for Hecateq:

- If an exact agent is known, Hecateq should prefer exact `task(subagent_type="...")` itself.
- It should not rely on category mode to magically choose the right custom agent.

## Background Execution Model

### `run_in_background=true`

For `task`, background mode goes through `executeBackgroundTask()` in `src/tools/delegate-task/background-task.ts`.

Behavior:

- Calls `BackgroundManager.launch(...)`
- Returns immediately with a `bg_...` task id
- Publishes metadata containing `backgroundTaskId` and, when available, `sessionId`
- Instructs the caller to use `background_output`

`BackgroundManager.launch()` in `src/features/background-agent/manager.ts`:

- creates a `BackgroundTask` with `id: bg_<uuid>`
- queues it by concurrency key
- later spawns the child session and prompt asynchronously

This is the true background orchestration path.

### `run_in_background=false`

For `task`, sync mode goes through `executeSyncTask()` in `src/tools/delegate-task/sync-task.ts`.

Behavior:

- creates a child session immediately
- sends the prompt
- polls until idle / terminal state
- returns the child result inline

This is a blocking decision path. Use it when the parent needs the answer before deciding the next step.

### `session_id`

`session_id` belongs to `call_omo_agent`, not `task`.

In `call_omo_agent`:

- `session_id` means continue an existing lookup-agent session

In `task`:

- continuation uses `task_id`, and it is actually a continuation session id (`ses_...`), not a `bg_...`
- `src/tools/delegate-task/task-id.ts` simply returns `args.task_id`
- `background-continuation.ts` and `sync-continuation.ts` both use that session id to resume the child session

### `description`

`description` is used for:

- task title / toast / metadata title
- background task display text
- child session title in some creation paths

It is not a routing key.

### `prompt`

`prompt` is the actual delegated user work payload.

In `task`, `prompt-builder.ts` may augment system content, skills, category prompt append, and plan-agent-specific additions. The user prompt remains the work payload.

### `background_output`

`background_output` is an LLM-facing wrapper around the background engine, implemented in `src/tools/background-task/create-background-output.ts`.

Behavior:

- expects a `bg_...` task id, not `ses_...`
- optionally blocks until completion
- can return formatted result, status, or full session transcript

It explicitly explains misuse when a session id is passed. `create-background-output.metadata.test.ts` verifies the error text.

## Foreground Execution Model

Foreground means synchronous child-session delegation where the caller waits for the child’s answer in the same turn.

Foreground is appropriate when:

- the next routing decision depends on the result
- a plan/review/architecture answer is needed before proceeding
- a continuation must happen in the same subagent session immediately

Foreground is the default in `task` because omitted `run_in_background` becomes `false` in `tool-argument-preparation.ts`.

## Agent Picker Visibility vs Delegation Availability

These are not the same concept.

Delegation availability is based on resolver logic:

- callable to `task` if mode is `all` or `subagent`, visible to task, not blocked by guards

Picker visibility depends on final built agent config presented to OpenCode.

Important Hecateq fact:

- Historically Hecateq was subagent-only, but in the current code it is `mode: "all"` in `src/agents/hecateq-orchestrator/agent.ts`
- `src/agents/utils.test.ts` and `hecateq-orchestrator-agent.test.ts` verify that Hecateq is visible in both picker and subagent contexts

So in the current runtime, Hecateq is both picker-visible and exact-task-callable.

## Sisyphus Delegation Behavior

Sisyphus remains the primary orchestrator.

Relevant runtime facts:

- tool permissions are granted in `src/plugin-handlers/tool-config-handler.ts`
- Sisyphus gets `task: allow`
- Sisyphus explicitly gets `call_omo_agent: deny` at config-permission level here, although prompt/test surfaces still discuss research spawning patterns; actual effective tool availability depends on merged config/tool restrictions for the running agent session
- Sisyphus prompt includes explicit Hecateq handoff wording, verified by `src/agents/sisyphus-hecateq-handoff.test.ts`

Current prompt-level policy says Sisyphus should ask before handing large multi-domain orchestration to Hecateq and then use real `task(subagent_type="hecateq-orchestrator", ...)` if approved.

## Hecateq God Delegation Behavior

Hecateq is a built-in custom-agent-first orchestrator prompt, not a special runtime dispatcher.

Runtime facts:

- Registered through builtin agent creation
- Exact callable via `task(subagent_type="hecateq-orchestrator")`
- Mode is `all`
- Prompt contains custom-agent registry, memory policy, git checkpoint policy, minimum-agent principle, agent-index usage policy, dependency graph policy, and explicit `STATUS: BLOCKED` language

But crucially:

- those Hecateq routing rules are prompt-level guidance
- the runtime does **not** add a separate code gate that forces Hecateq to choose exact custom agents first

Therefore Hecateq prompt wording matters a lot, but it must align with the actual runtime tool semantics described here.

## Hephaestus / Atlas / Prometheus Roles

- **Hephaestus**: worker/deep agent; exact-callable when allowed by mode/guards
- **Atlas**: primary executor/orchestrator role, not a coordinator hard-reject in the same sense as Prometheus/plan family guards for `task`
- **Prometheus / plan family**: planning path with special restrictions

`coordinator-subagent-guard.test.ts` proves coordinator targets are blocked before spawning. `tools.test.ts` proves plan-family cross-delegation constraints.

## Minimum-Agent Principle

The runtime supports a minimum-agent principle better than a fanout-first policy.

Why:

- exact subagent resolution is strict and explicit
- background tasks carry concurrency cost and lifecycle complexity
- category mode does not magically discover exact owners
- `call_omo_agent` is intentionally narrow and should not be abused as generic delegation

So “smallest capable exact agent first” is aligned with the code.

## Token Efficiency Implications

The codebase pushes token efficiency in several ways:

- `call_omo_agent` is constrained to light research agents
- background work uses `bg_...` plus `background_output` instead of keeping all work inline
- `prompt-builder.ts` merges only necessary skill/category context
- `background_output` can fetch summary vs full transcript

Poor policy for Hecateq would be:

- multi-agent fanout by default
- using category mode when exact agents are available
- foregrounding independent research that could run in background

## Contract-First Implications

The runtime itself does not enforce backend-contract-before-frontend ordering as a hard code gate. That is Hecateq prompt policy, not resolver law.

However, this policy is compatible with the runtime because:

- exact agents can be chosen explicitly
- sync mode can block until a contract-producing agent returns
- background mode can be reserved for independent follow-up analysis/verification after the contract exists

So contract-first should remain a prompt policy layered on top of exact runtime delegation.

## Agent Index Implications

If an agent index exists, Hecateq should use it as a ranking aid, not as a replacement for runtime validation.

Runtime still decides truth through:

- actual registered agents
- disabled filters
- exact `task(subagent_type="...")` validation

Therefore:

- index present -> shortlist and rank candidates
- runtime exact validation -> final authority
- if runtime exact match fails -> do not invent a name; either try another known exact agent or return `STATUS: BLOCKED`

## Existing Tests Covering This System

Strong coverage exists for the most important behaviors.

Key tests:

- `src/tools/delegate-task/zauc-mocks-subagent-resolver/subagent-resolver.test.ts`
  - unknown exact agent errors
  - disabled exact agent errors
  - primary-agent rejection
  - hidden/demoted plan behavior
  - Hecateq exact-callability

- `src/tools/delegate-task/category-resolver.test.ts`
  - disabled categories
  - custom-agent-first prompt hint injection
  - fallback-chain behavior

- `src/tools/delegate-task/coordinator-subagent-guard.test.ts`
  - coordinator target rejection before spawn

- `src/tools/call-omo-agent/agent-resolver.test.ts`
  - `call_omo_agent` static allowlist
  - runtime custom agents ignored

- `src/tools/call-omo-agent/agent-restriction.test.ts`
  - oracle/general/custom targets rejected from `call_omo_agent`

- `src/plugin-handlers/config-handler.test.ts`
  - merge priority across project/global/plugin/opencode sources

- `src/plugin-handlers/agent-config-handler.test.ts`
  - builtin protection
  - mode defaults
  - disabled custom agent filtering
  - Hecateq order in final agent config

- `src/agents/utils.test.ts`
  - Hecateq mode `all`

- `src/agents/builtin-agents/hecateq-orchestrator-agent.test.ts`
  - Hecateq prompt policy structure
  - mode `all`
  - disabled registration behavior

- `src/agents/sisyphus-hecateq-handoff.test.ts`
  - Sisyphus prompt includes real exact Hecateq handoff wording

- `src/tools/delegate-task/background-task.test.ts`
  - background metadata/session behavior
  - agent sanitization
  - late session registration

- `src/tools/background-task/create-background-output.metadata.test.ts`
  - `bg_...` vs `ses_...` guidance

## Missing Tests / Weak Coverage

The largest remaining weakness is not basic delegation mechanics. It is enforcement of Hecateq’s higher-level policy.

What is still mostly prompt-level, not code-enforced:

1. exact custom-agent-first behavior when Hecateq chooses between multiple valid candidates
2. contract-first ordering across backend/frontend/admin/mobile flows
3. when Hecateq should answer directly instead of delegating
4. when Hecateq should pick foreground vs background based on dependency structure
5. when Hecateq should return `STATUS: BLOCKED` versus falling back to category mode

Recommended additional test assertions for future prompt work:

- prompt must explicitly say exact `task(subagent_type="...")` is preferred over category when an exact owner exists
- prompt must state category routing is fallback-only and not a discovery mechanism
- prompt must state `call_omo_agent` is not the generic delegation tool
- prompt must state `STATUS: BLOCKED` when no exact valid owner exists
- prompt must differentiate sync vs background by dependency on result

## Recommended Delegation Policy For Hecateq God

### DELEGATION POLICY FOR HECATEQ GOD

1. Prefer doing small, safe, local tasks directly.
2. For non-trivial work, select the smallest capable exact agent from the available registry or generated agent index.
3. Delegate with the runtime’s exact subagent delegation tool using `subagent_type="<exact-agent-name>"`.
4. In this runtime, if the exposed tool name is `call_omo_agent`, use `call_omo_agent` explicitly only for `explore` or `librarian` when actual tool invocation is required.
5. Use `run_in_background=false` when the result is required before the next decision.
6. Use `run_in_background=true` only for independent analysis or verification that can run in parallel.
7. Do not invent agent names.
8. Do not use category fallback when an exact custom agent exists.
9. Use category fallback only when exact routing is unavailable and the category is enabled.
10. If no reliable agent exists, return `STATUS: BLOCKED`.
11. Avoid multi-agent fanout unless dependencies and ownership are clear.
12. For backend/frontend/admin/mobile work, establish shared contract before downstream implementation.

## Recommended Prompt Wording

Best runtime-aligned wording:

- “Use the `task` tool for real delegation.”
- “When an exact runtime agent exists, delegate with `task(subagent_type="<exact-agent-name>", ...)`.”
- “Use `call_omo_agent(...)` only for `explore` or `librarian` research work.”
- “Use category routing only when no valid exact agent exists.”
- “If no valid exact or enabled fallback owner exists, return `STATUS: BLOCKED`.”
- “Use `run_in_background=true` only when the result is not needed for the next decision.”

If you want wording that survives possible tool renaming while staying grounded, the safest hybrid is:

- “Use the runtime’s exact subagent delegation tool and pass `subagent_type="<exact-agent-name>"`.”
- then, where prompt precision matters, add: “In this runtime the tool is exposed as `task(...)`.”

## Forbidden / Risky Prompt Wording

Avoid these because they mismatch the runtime:

- “call OMO agent” as a generic delegation instruction
- “use `call_omo_agent` for any subagent”
- “delegate_task” as if it were the exposed user-facing tool name
- “category routing will discover the best custom agent for you”
- “if exact agent fails, silently fall back”
- “invent the closest agent name”

These are especially risky because:

- `call_omo_agent` is hard-limited to explore/librarian
- category mode does not perform exact-agent discovery
- unknown exact names are hard errors

## Examples

### Good: small task handled directly

“This is a small local formatting fix in one file. Do it directly instead of delegating.”

### Good: exact foreground agent delegation

“Need an architecture answer before proceeding. Use `task(subagent_type="oracle", run_in_background=false, ...)`.”

### Good: exact background agent delegation

“Need parallel codebase search while continuing non-overlapping work. Use `call_omo_agent(subagent_type="explore", run_in_background=true, ...)`.”

### Good: contract-first multi-agent flow

“First get the backend/API contract via exact foreground delegation. After the contract exists, dispatch independent frontend/admin follow-ups, using background only where results are not immediately gating.”

### Bad: vague “call OMO agent” wording

“Call OMO agent for the backend specialist.”

Why bad: runtime `call_omo_agent` cannot call backend specialists at all.

### Bad: category fallback while exact agent exists

“Use category `deep` for the backend engineer even though `backend-engineer` exists.”

Why bad: category path routes to Sisyphus-Junior, not to the exact custom agent.

### Bad: unnecessary multi-agent fanout

“Send the same task to two similar backend agents and compare.”

Why bad: wastes tokens, duplicates ownership, and is not supported by any strict runtime arbitration layer.

## Files Inspected

- `src/plugin/tool-registry.ts`
- `src/plugin/chat-message.ts`
- `src/tools/delegate-task/tools.ts`
- `src/tools/delegate-task/tool-argument-preparation.ts`
- `src/tools/delegate-task/tool-description.ts`
- `src/tools/delegate-task/types.ts`
- `src/tools/delegate-task/executor-types.ts`
- `src/tools/delegate-task/subagent-resolver.ts`
- `src/tools/delegate-task/subagent-discovery.ts`
- `src/tools/delegate-task/category-resolver.ts`
- `src/tools/delegate-task/background-task.ts`
- `src/tools/delegate-task/sync-task.ts`
- `src/tools/delegate-task/background-continuation.ts`
- `src/tools/delegate-task/sync-continuation.ts`
- `src/tools/delegate-task/prompt-builder.ts`
- `src/tools/delegate-task/task-id.ts`
- `src/tools/call-omo-agent/tools.ts`
- `src/tools/call-omo-agent/agent-resolver.ts`
- `src/tools/call-omo-agent/constants.ts`
- `src/tools/background-task/create-background-output.ts`
- `src/features/background-agent/manager.ts`
- `src/features/background-agent/spawner.ts`
- `src/features/background-agent/types.ts`
- `src/features/claude-code-agent-loader/loader.ts`
- `src/features/claude-code-agent-loader/agent-definitions-loader.ts`
- `src/features/claude-code-agent-loader/opencode-config-agents-reader.ts`
- `src/features/claude-code-plugin-loader/agent-loader.ts`
- `src/plugin-handlers/agent-config-handler.ts`
- `src/plugin-handlers/agent-priority-order.ts`
- `src/plugin-handlers/tool-config-handler.ts`
- `src/agents/builtin-agents.ts`
- `src/agents/builtin-agents/hecateq-orchestrator-agent.ts`
- `src/agents/hecateq-orchestrator/agent.ts`
- `src/agents/types.ts`
- `src/shared/agent-display-names.ts`
- `src/shared/agent-ordering.ts`
- `src/shared/migration/agent-names.ts`
- `src/hooks/auto-slash-command/executor.ts`

Tests inspected:

- `src/tools/delegate-task/zauc-mocks-subagent-resolver/subagent-resolver.test.ts`
- `src/tools/delegate-task/category-resolver.test.ts`
- `src/tools/delegate-task/coordinator-subagent-guard.test.ts`
- `src/tools/delegate-task/tools.test.ts`
- `src/tools/delegate-task/background-task.test.ts`
- `src/tools/delegate-task/sync-prompt-sender.test.ts`
- `src/tools/call-omo-agent/agent-restriction.test.ts`
- `src/tools/call-omo-agent/agent-resolver.test.ts`
- `src/tools/background-task/create-background-output.metadata.test.ts`
- `src/plugin-handlers/agent-config-handler.test.ts`
- `src/plugin-handlers/config-handler.test.ts`
- `src/features/claude-code-agent-loader/loader.test.ts`
- `src/features/claude-code-agent-loader/opencode-config-agents-reader.test.ts`
- `src/agents/utils.test.ts`
- `src/agents/custom-agent-orchestrator-visibility.test.ts`
- `src/agents/builtin-agents/hecateq-orchestrator-agent.test.ts`
- `src/agents/sisyphus-hecateq-handoff.test.ts`
- `src/plugin/tool-registry.test.ts`

## Open Questions / Uncertainties

1. `tool-config-handler.ts` denies `call_omo_agent` for several builtin agents at config-permission level, while some prompt/test materials still discuss research-agent spawning patterns from those agents. The precise effective runtime surface for every agent depends on merged config plus session tool restrictions, so this is worth one focused follow-up if Hecateq prompt work needs per-agent guarantees.
2. The category path contains prompt-level custom-agent-first guidance, but no code-level reroute. That means Hecateq prompt quality remains important, and category fallback should not be over-trusted.
3. Some Hecateq behavior described in prompt tests is intentionally policy-level rather than hard runtime enforcement. Future prompt changes should preserve that distinction.

## Final Recommendation

Treat `task(subagent_type="...")` as the primary exact delegation primitive.

Treat `call_omo_agent(...)` as a specialized research-only primitive for `explore` and `librarian`.

Treat category routing as a separate Sisyphus-Junior fallback path, not as exact-agent discovery.

For Hecateq God, the prompt should explicitly encode:

- direct answer for small safe local work
- exact-agent-first delegation
- background only for independent parallel work
- contract-first ordering when domains depend on shared interfaces
- `STATUS: BLOCKED` when no valid exact owner exists

That policy matches the actual plugin architecture much better than generic “call OMO agent” wording.
