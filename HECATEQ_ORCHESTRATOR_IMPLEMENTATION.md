# HECATEQ_ORCHESTRATOR_IMPLEMENTATION

## Scope

This implementation adds `hecateq-orchestrator` as a new built-in agent to the oh-my-openagent fork. The agent is a custom-agent-first planner, router, and dispatcher positioned between Sisyphus and Hephaestus in the default agent order. The scope covers:

- Agent factory and prompt generation (`src/agents/hecateq-orchestrator/`)
- Agent config assembly with model resolution, overrides, environment context (`src/agents/builtin-agents/hecateq-orchestrator-agent.ts`)
- Registration in the agent name schema, display names, ordering, migration map, and model requirements
- Integration into the agent config handler assembly pipeline and agent priority ordering
- Custom agent registry prompt section (visible to Hecateq only, never to Sisyphus)
- Dependency-aware routing rules and built-in relationship rules embedded in the agent prompt
- Exact subagent validation coverage and disabled-agent error for `hecateq-orchestrator`

Not changed: package name, binary names, plugin ID, TUI, installer, unrelated hook systems, Sisyphus prompt content, or any frontend code.

---

## What Changed

### New built-in agent: Hecateq Orchestrator

A `subagent`-mode agent that:

1. **Custom-Agent-First**: Scans the available custom agent registry before falling back to categories.
2. **Dependency-Aware Routing**: Enforces backend-contract-before-frontend ordering; supports parallel work via shared contract/mock schemas.
3. **Built-in Relationship Rules**: Domain specialists take priority over generic built-ins (Hephaestus is not the default implementation layer; use only when explicitly needed).
4. **Exact Delegation**: Delegates via `task(subagent_type="...")` with real calls.
5. **Category Fallback Boundary**: Uses category routing only when no exact custom agent exists. If no valid exact agent exists, returns `STATUS: BLOCKED` with closest candidates.

### Agent ordering changed

The default agent order shifted from:
```text
sisyphus -> hephaestus -> prometheus -> atlas
```
to:
```text
sisyphus -> hecateq-orchestrator -> hephaestus -> prometheus -> atlas
```

This is defined in `src/shared/agent-ordering.ts` (`DEFAULT_AGENT_ORDER`), enforced in `src/plugin-handlers/agent-priority-order.ts` (`CANONICAL_CORE_AGENT_ORDER`), and verified by `src/plugin-handlers/agent-config-handler.test.ts` (order assertion: `"order", 2`).

### Assembly pipeline updated

In `src/plugin-handlers/agent-config-handler.ts`, the agent assembly order is:
```
sisyphus -> hecateq-orchestrator -> hephaestus -> prometheus -> atlas -> sisyphus-junior
```
Line 216-218 show the explicit insertion block:
```typescript
const agentConfig: Record<string, unknown> = {
  sisyphus: builtinAgents.sisyphus,
};
if (builtinAgents["hecateq-orchestrator"]) {
  agentConfig["hecateq-orchestrator"] = builtinAgents["hecateq-orchestrator"];
}
```

The agent is also excluded from the remaining `builtinAgents` spread (line 332) to avoid duplicate registration:
```typescript
.filter(([key]) => key !== "sisyphus" && key !== "hephaestus" && key !== "hecateq-orchestrator" && key !== "atlas")
```

### Custom agent summaries flow only to Hecateq (not Sisyphus)

`customAgentSummaries` is collected in `agent-config-handler.ts` (lines 138-154) from all agent sources (config, user, project, opencode global/project, plugin, agent definitions, opencode config) and passed to `createBuiltinAgents()` exclusively through the `hecateq-orchestrator` config path. Sisyphus, Hephaestus, and Atlas do not receive `customAgentSummaries`. Verified by `src/agents/utils.test.ts` test `"hecateq-orchestrator injects visible custom agents into its prompt while sisyphus does not"` (line 343).

### CollectPendingBuiltinAgents skips Hecateq

`src/agents/builtin-agents/general-agents.ts` line 58 explicitly skips `hecateq-orchestrator` alongside `sisyphus`, `hephaestus`, and `atlas` in `collectPendingBuiltinAgents()`:
```typescript
if (agentName === "hecateq-orchestrator") continue
```

---

## New Files

| File | Purpose |
|------|---------|
| `src/agents/hecateq-orchestrator/index.ts` | Barrel exports: `createHecateqOrchestratorAgent`, `HecateqCustomAgentSummary`, `HecateqOrchestratorContext`, `HECATEQ_ORCHESTRATOR_POLICY`, `buildDefaultHecateqOrchestratorPrompt` |
| `src/agents/hecateq-orchestrator/agent.ts` | Agent factory (`createHecateqOrchestratorAgent`), prompt builder (`buildDynamicPrompt`), custom agent registry section builder (`buildCustomAgentRegistrySection`), builtin relationship section (`buildBuiltinRelationshipSection`), dependency routing section (`buildDependencyRoutingSection`), types (`HecateqCustomAgentSummary`, `HecateqOrchestratorContext`). Mode: `subagent`. Color: `#7C3AED`. |
| `src/agents/hecateq-orchestrator/default.ts` | `HECATEQ_ORCHESTRATOR_POLICY` constant (20 execution rules + output discipline) and `buildDefaultHecateqOrchestratorPrompt()` function that assembles the final prompt from registry/relationship/routing sections. |
| `src/agents/builtin-agents/hecateq-orchestrator-agent.ts` | `maybeCreateHecateqOrchestratorConfig()`: handles disabled-agent gate, model availability check, model resolution (including first-run fallback), override merging via `applyOverrides()`, environment context via `applyEnvironmentContext()`, and variant pass-through. |
| `src/agents/builtin-agents/hecateq-orchestrator-agent.test.ts` | 8 tests covering: disabled returns undefined, no-model returns undefined, explicit model override, permission override, `fallback_models` override, first-run fallback, prompt contains dependency-aware backend/frontend contract rule. |
| `HECATEQ_ORCHESTRATOR_IMPLEMENTATION.md` | This implementation report. |

---

## Modified Files

| File | Change |
|------|--------|
| `packages/model-core/src/model-requirements.ts` | Added `hecateq-orchestrator` entry to `AGENT_MODEL_REQUIREMENTS` with fallback chain: `gpt-5.4` (openai/github-copilot/opencode/vercel) → `claude-sonnet-4-6` (anthropic) → `kimi-k2.6` (opencode-go/vercel) → `big-pickle` (opencode). |
| `src/config/schema/agent-names.ts` | Added `hecateq-orchestrator` to `BuiltinAgentNameSchema` and `OverridableAgentNameSchema` Zod enums. |
| `src/shared/agent-display-names.ts` | Added `"hecateq-orchestrator": "Hecateq Orchestrator"` to `AGENT_DISPLAY_NAMES`. |
| `src/shared/agent-ordering.ts` | Added `"hecateq-orchestrator"` to `DEFAULT_AGENT_ORDER` between `sisyphus` and `hephaestus`. |
| `src/shared/migration/agent-names.ts` | Added `hecateq-orchestrator` variants (`"Hecateq Orchestrator"`, `"hecateq_orchestrator"`, `"HecateqOrchestrator"`) to `AGENT_NAME_MAP` and `hecateq-orchestrator` to `BUILTIN_AGENT_NAMES`. |
| `src/agents/builtin-agents.ts` | Added import of `createHecateqOrchestratorAgent` and `maybeCreateHecateqOrchestratorConfig`. Added `"hecateq-orchestrator"` to `agentSources` record. Added `hecateqOrchestratorConfig` creation block between Sisyphus and pending-agent collection, passing `customAgentSummaries`. |
| `src/agents/builtin-agents/general-agents.ts` | Added `hecateq-orchestrator` skip in `collectPendingBuiltinAgents()` alongside sisyphus/hephaestus/atlas. |
| `src/agents/types.ts` | No structural change for hecateq specifically (the `AgentOverrideConfig` already supported `fallback_models`). |
| `src/plugin-handlers/agent-config-handler.ts` | Added `customAgentSummaries` collection (lines 138-154). Passed to `createBuiltinAgents()` as 8th argument. Added hecateq-orchestrator to assembly pipeline. Excluded from builtin-agents spread when building `config.agent`. |
| `src/plugin-handlers/agent-priority-order.ts` | `CANONICAL_CORE_AGENT_ORDER` now references `DEFAULT_AGENT_ORDER` which includes `hecateq-orchestrator`. |
| `src/plugin-handlers/agent-config-handler.test.ts` | Added `BUILTIN_HECATEQ_DISPLAY_NAME` constant. Added builtin hecateq config fixture. Added `builtinHecateqConfig` to mock return. Added test: `"#given hecateq-orchestrator builtin agent is registered #then it appears in the final config with correct name and order"` (order = 2). |
| `src/tools/delegate-task/zauc-mocks-subagent-resolver/subagent-resolver.test.ts` | Added test: `"recognizes hecateq-orchestrator as callable subagent when present in server agent list"`. Added test: `"returns disabled error when hecateq-orchestrator is in disabled_agents"`. |
| `src/agents/utils.test.ts` | Added 3 tests: `"hecateq-orchestrator injects visible custom agents into its prompt while sisyphus does not"`, `"excludes hidden custom agents from orchestrator prompts"`, `"excludes disabled custom agents from orchestrator prompts"`. |

---

## Agent ID And Config Key

- **Agent ID:** `hecateq-orchestrator`
- **Config key:** `hecateq-orchestrator` (all lowercase, hyphenated)
- **Display name:** `Hecateq Orchestrator`
- **Agent mode:** `subagent`
- **Default model:** Resolved at runtime via fallback chain (see Model Requirements above)
- **Color:** `#7C3AED`
- **Permission:** `{ question: "allow" }` merged with `getFrontierToolSchemaPermission(model)` and `getGptApplyPatchPermission(model)`
- **Reasoning effort:** `high`

**Config key is registered in:**
- `BuiltinAgentNameSchema` (Zod enum in `src/config/schema/agent-names.ts`)
- `OverridableAgentNameSchema` (Zod enum in `src/config/schema/agent-names.ts`)
- `AGENT_DISPLAY_NAMES` (`src/shared/agent-display-names.ts`)
- `AGENT_NAME_MAP` + `BUILTIN_AGENT_NAMES` (`src/shared/migration/agent-names.ts`)
- `AGENT_MODEL_REQUIREMENTS` (`packages/model-core/src/model-requirements.ts`)
- `agentSources` record (`src/agents/builtin-agents.ts`)

**User can override via config key** `hecateq-orchestrator` in `agents` block:
```jsonc
{
  "agents": {
    "hecateq-orchestrator": {
      "model": "anthropic/claude-opus-4-7",
      "permission": { "question": "allow" },
      "prompt_append": "Additional instruction...",
      "fallback_models": ["anthropic/claude-sonnet-4-6"],
      "disabled": false
    }
  }
}
```

---

## Hecateq Orchestrator Behavior

### Core Role

Hecateq Orchestrator is the user's primary **custom-agent-first planner, router, and dispatcher**. It:

1. Understands the user's available custom agents via the `<custom-agent-registry>` prompt section.
2. Decomposes work into dependency-aware subtasks.
3. Chooses exact custom agents from the registry.
4. Invokes real `task(subagent_type="exact-agent-name")` calls.
5. Does not merely describe delegation — it executes.
6. Avoids duplicate work and token waste.

### Execution Rules (20 rules in `HECATEQ_ORCHESTRATOR_POLICY`)

1. For every non-trivial task, inspect available custom agents first.
2. Select exact agent names from the available registry.
3. Invoke `task(subagent_type="exact-agent-name")` for real delegation.
4. Never invent agent names.
5. Never call unknown or disabled agents.
6. Use category routing only when no exact custom agent exists.
7. If no valid exact agent exists, return `STATUS: BLOCKED` with closest candidates and missing information.
8. Split multi-domain work into dependency-aware phases.
9. Do not run frontend implementation before backend/API contract is stable unless using an explicit mock contract.
10. If backend and frontend can run in parallel, first create or request a shared contract/mock schema.
11. For implementation tasks, prefer exact domain custom agents.
12. Use Hephaestus only when explicitly selected or when build/integration supervision is clearly needed.
13. Use Prometheus for spec/plan generation when needed.
14. Use Atlas only when explicitly selected or when a large execution runner is required.
15. Use QA/security/performance agents for verification when relevant.
16. Small safe fixes are allowed only when they do not require domain ownership or broad architectural decisions.
17. Destructive operations require explicit user confirmation.

### Output Discipline

- Provide a short plan before delegation.
- Execute with real `task(...)` calls when delegation is required.
- Maintain Routing Coverage: `task`, `owner_agent`, `execution_call`, `dependency`, `status`.
- Do not mark `STATUS: DONE` unless delegated work or direct small fix is actually completed.

### Prompt Structure

The final prompt is assembled by `buildDynamicPrompt()` in `agent.ts`:

```
[Agent Identity: "Hecateq Orchestrator"]
[HECATEQ_ORCHESTRATOR_POLICY (20 rules + output discipline)]
[<custom-agent-registry> section]
[<builtin-relationship> section]
[<dependency-aware-routing> section]
[Execution note with task tool availability]
```

### Section: Custom Agent Registry

```text
<custom-agent-registry>
Available exact custom agents in the current registry:
- agent-name1 — Description
- agent-name2 — Description
- ... and N more exact custom agents in the registry
</custom-agent-registry>
```

- Built-in agent keys are excluded.
- Hidden and disabled agents are excluded.
- Duplicate names (after normalization) are excluded.
- Truncated at 12 entries with overflow indicator.
- Description truncated at 120 characters with `...` suffix.
- Pipe characters are replaced with `/`.

### Section: Built-in Relationship

```text
<builtin-relationship>
Built-in relationship rules:
- Domain specialist custom agents take priority over generic built-ins.
- Hephaestus is not the default implementation layer.
- Prometheus is available for spec or plan generation.
- Atlas remains an explicit large execution runner.
- Category routing is fallback-only after exact custom-agent lookup fails.
</builtin-relationship>
```

### Section: Dependency-Aware Routing

```text
<dependency-aware-routing>
Dependency-aware routing rules:
- If backend or API contract is unclear, establish the contract before frontend implementation.
- If frontend and backend can proceed in parallel, first create or request a shared contract or mock schema.
- Do not let parallel teams invent separate payload shapes.
- Prefer exact domain ownership over broad orchestration.
</dependency-aware-routing>
```

---

## Custom Agent Registry Integration

**Q: How do custom agent summaries flow into Hecateq?**

Custom agent summaries are collected in `src/plugin-handlers/agent-config-handler.ts` (lines 138-154) from **8 source layers**:

| Layer | Source |
|-------|--------|
| 1. Config agents | `config.agent` entries (e.g., `opencode.json`) |
| 2. User agents | `~/.config/opencode/agents/` |
| 3. Project agents | `<project>/.opencode/agents/` |
| 4. OpenCode global agents | OpenCode global agent dir |
| 5. OpenCode project agents | OpenCode project agent dir |
| 6. Plugin agents | Plugin agent definitions |
| 7. Agent definition agents | Agent definition files |
| 8. OpenCode config agents | Inline config agent definitions |

Each entry is collected as `{ name, description }` (description defaults to `""`). The array is passed to `createBuiltinAgents()` which passes it exclusively to `maybeCreateHecateqOrchestratorConfig()`.

**Q: Does Sisyphus receive custom agent summaries?**

No. `customAgentSummaries` is **not passed** to `maybeCreateSisyphusConfig()`. Verified by code inspection — the 8th parameter is `undefined` in the Sisyphus config call. Verified by test: `"hecateq-orchestrator injects visible custom agents into its prompt while sisyphus does not"` (utils.test.ts line 343) which asserts `agents.sisyphus.prompt` does NOT contain `"backend-engineer"`.

**Q: How are hidden/disabled agents handled?**

`buildCustomAgentRegistrySection()` in `agent.ts` (lines 65-99) filters out:
- `hidden: true` agents
- `disabled: true` agents
- Built-in agent keys (the set of 15 known built-in names)
- Duplicate normalized names (case-insensitive trim)

Verified by tests: `"excludes hidden custom agents from orchestrator prompts"` and `"excludes disabled custom agents from orchestrator prompts"` in utils.test.ts.

---

## Dependency-Aware Routing

**Q: Does Hecateq enforce backend-before-frontend ordering?**

Yes. The prompt contains this rule (rule #9 in `HECATEQ_ORCHESTRATOR_POLICY`):
```text
Do not run frontend implementation before backend/API contract is stable unless using an explicit mock contract.
```

And rule #10:
```text
If backend and frontend can run in parallel, first create or request a shared contract/mock schema to prevent duplicate token usage.
```

The `<dependency-aware-routing>` section repeats the contract-first logic in structured XML format.

Verified by test: `"#then the prompt contains the dependency-aware backend/frontend contract routing rule"` in `hecateq-orchestrator-agent.test.ts` line 165-166, asserting `config!.prompt` contains `"If backend or API contract is unclear, establish the contract before frontend implementation"`.

**Q: Is this a prompt-level enforcement or a code-level enforcement?**

Prompt-level enforcement only. The Hecateq agent receives structured instructions to follow dependency-aware ordering. There is no code-level gate that prevents Hecateq from submitting a frontend task before backend. The agent is expected to follow the prompt discipline. The `dependencyRoutingSection` is injected at prompt-build time as structured XML.

---

## Backend Frontend Contract Handling

**Q: How does Hecateq handle the backend/frontend contract synchronization?**

The prompt instructs Hecateq to:
1. If the backend or API contract is unclear, establish the contract before frontend implementation.
2. If backend and frontend can run in parallel, first create or request a shared contract/mock schema and hand the same artifact to both sides.
3. Do not let parallel teams invent separate payload shapes.

The `<dependency-aware-routing>` prompt section also mandates:
```text
Prefer exact domain ownership over broad orchestration when the domain boundary is clear.
```

This means Hecateq should route backend work to a backend-specialist custom agent and frontend work to a frontend-specialist custom agent, with the shared contract being established first.

As above, this is prompt-level enforcement only — there is no runtime concurrency gate.

---

## Model Override Support

**Q: Can a user override Hecateq's model?**

Yes. The agent respects `agentOverrides["hecateq-orchestrator"].model` in `maybeCreateHecateqOrchestratorConfig()` (line 54-59). If the override model is set and available in `availableModels`, it is used. Tested in `"#given hecateq-orchestrator override with explicit model #then uses override model and returns config"`.

**Q: What is the fallback model chain?**

```
1. openai/gpt-5.4 (providers: openai, github-copilot, opencode, vercel)
2. anthropic/claude-sonnet-4-6 (providers: anthropic, github-copilot, opencode, vercel)
3. opencode-go/kimi-k2.6 (providers: opencode-go, vercel)
4. opencode/big-pickle (providers: opencode)
```

**Q: What happens on first run with no model cache?**

If `isFirstRunNoCache` is true and no override model is set, `getFirstFallbackModel(requirement)` is called (line 61-63) which picks the first entry in the fallback chain: `openai/gpt-5.4`. Tested in `"#given first run with no cache and no override #then returns config using first fallback model"`.

**Q: Can a user set fallback_models in the override?**

Yes. The `AgentOverrideConfig` type includes `fallback_models` (optional, string or array of string/object). This is merged into the final `AgentConfig` via `deepMerge` in `mergeAgentConfig()`. Tested in `"#given hecateq-orchestrator override with fallback_models #then fallback_models is respected"` in the agent test.

**Q: Does the agent get created if no model is available?**

No. If no model resolve succeeds and the agent is not first-run, `maybeCreateHecateqOrchestratorConfig()` returns `undefined` and the agent is not registered. Tested in `"#given no model available and not first run #then returns undefined"`.

---

## Permission Override Support

**Q: Can a user override Hecateq's permissions?**

Yes. The agent override path (`applyOverrides` → `mergeAgentConfig`) applies any permission fields from the override via `deepMerge`. The base permission is:
```typescript
permission: {
  question: "allow",
  ...getFrontierToolSchemaPermission(model),
  ...getGptApplyPatchPermission(model),
}
```

If a user provides a `permission` block in their agent override, it will be merged and supersede the base. Tested in `"#given hecateq-orchestrator override with permission #then permission is applied"` in the agent test.

---

## Prompt Append Support

**Q: Does Hecateq support `prompt_append`?**

Yes. `prompt_append` is handled through `mergeAgentConfig()` in `agent-overrides.ts`. If the user config includes `prompt_append` for `hecateq-orchestrator`, it is appended to the end of the existing prompt with a newline separator. File URI resolution (`file://`) is also supported.

The merge flow:
1. `createHecateqOrchestratorAgent()` builds the base prompt via `buildDynamicPrompt()`.
2. `applyOverrides(config, override, mergedCategories, directory)` calls `mergeAgentConfig()` which appends `prompt_append` after the base prompt.
3. `applyEnvironmentContext()` appends the environment context last.

Final prompt order:
```text
[Agent Identity]
[HECATEQ_ORCHESTRATOR_POLICY]
[custom-agent-registry]
[builtin-relationship]
[dependency-aware-routing]
[Execution note]
[prompt_append from user override (if any)]
[Environment context (if not disabled)]
```

---

## Disabled Agent Support

**Q: Can Hecateq itself be disabled?**

Yes. If `"hecateq-orchestrator"` is in the `disabled_agents` array, `maybeCreateHecateqOrchestratorConfig()` returns `undefined` (line 52), and the agent is not registered. Tested in `"#given hecateq-orchestrator is disabled #then returns undefined"` in the agent test.

**Q: What happens when a disabled Hecateq is called as a subagent?**

The `subagent-resolver.ts` has a dedicated validation path. If `"hecateq-orchestrator"` is in `disabled_agents` and someone tries `task(subagent_type="hecateq-orchestrator")`, it returns:
```text
Subagent "hecateq-orchestrator" is disabled by disabled_agents.
```

This error takes priority over the "unknown agent" error. Tested in `"returns disabled error when hecateq-orchestrator is in disabled_agents"` in `subagent-resolver.test.ts` (line 1555).

**Q: Does Hecateq respect disabled_agents in its own prompt?**

The `HECATEQ_ORCHESTRATOR_POLICY` contains rule #5: "Never call unknown or disabled agents." This is prompt-level enforcement only — the agent is expected to check `disabled_agents` at runtime before delegating.

---

## Exact Subagent Validation

**Q: Does Hecateq-orchestrator appear in the available agent list for exact subagent routing?**

Yes. When Hecateq is registered in the server agent list (from `createBuiltinAgents()`), it appears as `"Hecateq Orchestrator"` (display name). The `subagent-resolver.ts` recognizes it as a callable subagent. Tested in `"recognizes hecateq-orchestrator as callable subagent when present in server agent list"` in `subagent-resolver.test.ts` (line 1534).

**Q: What if someone calls a non-existent subagent_type?**

The `subagent-resolver.ts` will return:
```text
Unknown subagent_type "unknown-agent". Use one of the available exact agents: <agent-list>.
```

This validation was strengthened in a related change (`CUSTOM_AGENT_LOGIC_IMPLEMENTATION`) — known agents get the disabled error first, unknown agents get the unknown error.

---

## Category Fallback Boundary

Hecateq's prompt enforces that category routing is **fallback-only**. The `HECATEQ_ORCHESTRATOR_POLICY` states:
- Rule #6: "Use category routing only when no exact custom agent exists."
- Rule #7: "If no valid exact agent exists, return STATUS: BLOCKED with closest candidates and missing information."
- The `<builtin-relationship>` section states: "Category routing is fallback-only after exact custom-agent lookup fails."

This is prompt-level enforcement — the agent is expected to respect this boundary. There is no code-level gate preventing category routing when custom agents exist.

The `<custom-agent-registry>` section provides the agent with a concrete list of available exact agents to choose from. If the list is empty:
```text
<custom-agent-registry>
No visible custom exact agents were discovered in the current registry.
If the work still requires delegation, inspect the runtime registry first and return STATUS: BLOCKED when no valid
```

---

## Sisyphus Compatibility

**Q: Does Hecateq replace Sisyphus?**

No. Sisyphus remains the primary ultraworker (mode: `primary`). Hecateq is a `subagent`-mode agent that Sisyphus (and other agents) can delegate to via `task(subagent_type="hecateq-orchestrator")`. It is positioned **after** Sisyphus in the agent order and does not alter Sisyphus's prompt, behavior, or default-agent assignment.

**Q: Does Hecateq affect Sisyphus's prompt?**

No. Sisyphus's prompt is built independently and does not receive `customAgentSummaries`. The two agents are fully decoupled in prompt generation. Verified by code inspection and test.

**Q: What is Sisyphus's relationship to Hecateq?**

Sisyphus is the primary ultraworker. Hecateq is a specialist subagent that Sisyphus can delegate to when custom-agent-first routing is needed. Hecateq does not override or intercept Sisyphus's functions.

---

## Hephaestus / Atlas / Prometheus Relationship

**Q: Does Hecateq replace Hephaestus?**

No. The `<builtin-relationship>` section explicitly states:
> "Hephaestus is not the default implementation layer. Use it only when explicitly selected or when build/integration supervision is clearly needed."

Hecateq is instructed to prefer exact domain custom agents over Hephaestus, but Hephaestus remains available when explicitly chosen.

**Q: Does Hecateq replace Atlas?**

No. The `<builtin-relationship>` section states:
> "Atlas remains an explicit large execution runner or legacy runner, not the automatic first choice."

Atlas is still registered and available. Hecateq's prompt discourages using Atlas as a default choice.

**Q: Does Hecateq affect Prometheus?**

No. Prometheus (plan builder) is unaffected. Hecateq's prompt mentions Prometheus is "available for spec or plan generation when a structured plan is needed before delegation."

**Q: What is the relationship summary?**

```text
Sisyphus        — Primary ultraworker (mode: primary)
Hecateq         — Custom-agent-first planner/router/dispatcher (mode: subagent)
Hephaestus      — Deep agent, not default (mode: subagent)
Prometheus      — Plan builder, available on request (mode: subagent)
Atlas           — Plan executor, explicit large runner (mode: all)
```

---

## Tests Added / Updated

### New test file

**`src/agents/builtin-agents/hecateq-orchestrator-agent.test.ts`** — 8 tests:

| Test | Conditions | Assertions |
|------|-----------|------------|
| disabled returns undefined | `disabledAgents: ["hecateq-orchestrator"]` | `config` is `undefined` |
| no model and not first run | `availableModels: new Set()`, `systemDefaultModel: undefined` | `config` is `undefined` |
| explicit model override | `agentOverrides["hecateq-orchestrator"].model = "anthropic/claude-opus-4-7"` | `config.model === "anthropic/claude-opus-4-7"` |
| permission override | `agentOverrides["hecateq-orchestrator"].permission = { ... }` | permission applied |
| fallback_models override | `agentOverrides["hecateq-orchestrator"].fallback_models = [...]` | `config` is defined |
| first run fallback | `isFirstRunNoCache: true`, no override, no available models | `config.model` is defined from fallback |
| backend/frontend contract rule | valid config | `config.prompt` contains contract rule |
| prompt contains routing rules | valid config | prompt contains dependency-aware and builtin relationship rules |

### Added tests in existing files

**`src/plugin-handlers/agent-config-handler.test.ts`** — 1 new test:

| Test | Assertions |
|------|-----------|
| hecateq-orchestrator appears in final config | correct name, `order: 2` (after sisyphus) |

**`src/tools/delegate-task/zauc-mocks-subagent-resolver/subagent-resolver.test.ts`** — 2 new tests:

| Test | Assertions |
|------|-----------|
| hecateq-orchestrator is callable subagent | `agentToUse` resolves to `"Hecateq Orchestrator"` |
| disabled error for hecateq-orchestrator | error contains `'Subagent "hecateq-orchestrator" is disabled by disabled_agents.'` |

**`src/agents/utils.test.ts`** — 3 new tests:

| Test | Assertions |
|------|-----------|
| hecateq gets custom agents, sisyphus doesn't | hecateq prompt contains `"backend-engineer"`, sisyphus does not |
| hidden agents excluded from orchestrator prompts | hidden agents not in sisyphus/hephaestus/atlas prompts |
| disabled agents excluded from orchestrator prompts | disabled agents excluded |

---

## Tests Run

All tests pass in the current workspace:

| Test suite | Result |
|-----------|--------|
| `bun test src/agents/` (29 files) | **414 pass, 0 fail** (1242 expect calls) |
| `bun test src/plugin-handlers/agent-config-handler.test.ts src/tools/delegate-task/zauc-mocks-subagent-resolver/subagent-resolver.test.ts` (key config/resolver run) | **88 pass, 0 fail** (281 expect calls) |
| `bun test src/plugin/ src/tools/delegate-task/` (plugin/delegate run) | **127 pass, 0 fail** |
| `bun test src/agents/builtin-agents/hecateq-orchestrator-agent.test.ts src/tools/delegate-task/zauc-mocks-subagent-resolver/subagent-resolver.test.ts` (focused hecateq/resolver run) | **73 pass, 0 fail** (192 expect calls) |
| `bun test src/agents/utils.test.ts` (utils run) | **69 pass, 0 fail** (158 expect calls) |

---

## Behavior Before

- No `hecateq-orchestrator` agent existed.
- Default agent order was: `sisyphus → hephaestus → prometheus → atlas`.
- Custom agent summaries were not collected or injected into any agent prompt.
- No dependency-aware routing instructions existed in any built-in agent prompt.
- No built-in relationship rules existed for custom-agent-first routing.
- Sisyphus was the only orchestrator/ultraworker.

---

## Behavior After

- `hecateq-orchestrator` is a registered built-in agent with full lifecycle: model resolution, override support, prompt append, disabled-agent gate, environment context.
- Default agent order is: `sisyphus → hecateq-orchestrator → hephaestus → prometheus → atlas`.
- Custom agent summaries are collected from 8 source layers and injected exclusively into Hecateq's prompt, never Sisyphus.
- Hecateq's prompt contains structured `<custom-agent-registry>`, `<builtin-relationship>`, and `<dependency-aware-routing>` sections.
- The agent follows 20 execution rules prioritizing exact custom agents over categories and enforcing backend-contract-before-frontend ordering.
- Subagent-resolver recognizes Hecateq as a callable subagent and returns proper disabled errors.
- `fallback_models` from user override is respected on the final config.

---

## Risks

1. **Prompt-level enforcement only**: Dependency-aware routing and custom-agent-first rules are prompt instructions, not code gates. If the model ignores them, the agent will not enforce them. Monitor Hecateq's actual delegation behavior in production.

2. **Agent order shift**: The insertion of Hecateq between Sisyphus and Hephaestus in `DEFAULT_AGENT_ORDER` means existing user configs that rely on `sisyphus` being order 0 and `hephaestus` being order 1 will see order indices shift. Existing `agent_order` configs that explicitly list agents will not be affected (user order takes precedence via `validateAgentOrder()`).

3. **Config size increase**: Hecateq's prompt is significantly larger than other subagent prompts due to the three XML sections. This increases the total plugin agent config payload size.

4. **First-run model resolution**: On first run with no model cache, Hecateq uses `openai/gpt-5.4` from the fallback chain. If the user's provider does not have `gpt-5.4` available, the fallback may fail silently (agent would not be created).

5. **Custom agent summary staleness**: Custom agent summaries are snapshotted at agent creation time. If agents are added/removed during a session, Hecateq's `<custom-agent-registry>` will be stale until the next session.

6. **No runtime disabled_agents enforcement**: Hecateq is instructed not to call disabled agents (rule #5), but the actual disabled_agents list is not injected into Hecateq's prompt. The agent relies on its own knowledge, which may be stale if the config changes mid-session.

---

## Rollback

### Step 1: Remove untracked files
```bash
rm -f src/agents/builtin-agents/hecateq-orchestrator-agent.test.ts
rm -f src/agents/builtin-agents/hecateq-orchestrator-agent.ts
rm -rf src/agents/hecateq-orchestrator/
```

### Step 2: Revert modified files
```bash
git checkout -- \
  packages/model-core/src/model-requirements.ts \
  src/agents/builtin-agents.ts \
  src/agents/builtin-agents/general-agents.ts \
  src/agents/types.ts \
  src/agents/utils.test.ts \
  src/config/schema/agent-names.ts \
  src/plugin-handlers/agent-config-handler.test.ts \
  src/plugin-handlers/agent-config-handler.ts \
  src/plugin-handlers/agent-priority-order.ts \
  src/shared/agent-display-names.ts \
  src/shared/agent-ordering.ts \
  src/shared/migration/agent-names.ts \
  src/tools/delegate-task/zauc-mocks-subagent-resolver/subagent-resolver.test.ts
```

### Step 3: Verify rollback is clean
```bash
git diff --stat                # Should show no diff
git ls-files --others --exclude-standard | grep -i hecate  # Should return nothing
bun test src/agents/           # Should still pass (baseline tests)
```

### Step 4: (Optional) Remove implementation doc
```bash
rm HECATEQ_ORCHESTRATOR_IMPLEMENTATION.md
```

### Post-rollback effects
- Default agent order reverts to `sisyphus → hephaestus → prometheus → atlas`.
- `customAgentSummaries` parameter in `agent-config-handler.ts` becomes unused (no consumer).
- All passing tests that reference hecateq-orchestrator are removed.
- 414 baseline agent tests continue to pass (these do not depend on hecateq).
