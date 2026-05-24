# Agent Prompt Architecture: Sisyphus, Hephaestus, Hecateq God

This document maps how the plugin defines, assembles, modifies, and validates the prompts for the three core orchestration agents:

- `sisyphus`
- `hephaestus`
- `hecateq-orchestrator` (`Hecateq God`)

It focuses on prompt sources, builder flow, registration, runtime modifiers, config overrides, and the tests that pin behavior.

---

## 1. High-level architecture

All three agents follow the same broad pipeline:

1. **Prompt source files** define static or semi-static instructions.
2. **Agent factory/router files** choose the correct prompt variant for the active model.
3. **Builtin-agent wrappers** resolve models, merge config overrides, and apply permission guards.
4. **Plugin config handlers** register the final agent config into the runtime agent map.
5. **Hooks and runtime guards** can further constrain or enrich behavior after registration.
6. **Tests** assert prompt content contracts, model routing, permissions, and handoff logic.

The three agents differ mainly in how much routing logic they own:

- **Sisyphus** is the main orchestrator with multiple model-tuned prompt variants.
- **Hephaestus** is the deep worker with GPT-oriented prompt variants and strong runtime safety guards.
- **Hecateq God** is a custom-agent-first orchestrator whose prompt is policy-heavy and tightly coupled to project memory, contracts, and task-graph artifacts.

---

## 2. Sisyphus

### 2.1 Role

Sisyphus is the main orchestrator. It classifies user intent, decides whether to answer, investigate, delegate, or implement, and coordinates specialist agents.

### 2.2 Primary prompt source files

#### Core router and factory

- `src/agents/sisyphus.ts`
  - Main `createSisyphusAgent()` factory.
  - Chooses the prompt variant based on the model name.
  - Appends shared policy such as the Hecateq handoff block.
  - Produces the final `AgentConfig` including permissions and reasoning settings.

#### Variant prompt files

- `src/agents/sisyphus/default.ts`
  - Base/default prompt builder.
  - Also exports the shared task-management section reused by variants.
- `src/agents/sisyphus/gpt-5-4.ts`
  - GPT-5.4-specific prompt.
  - Uses an 8-block architecture optimized for GPT-style orchestration.
- `src/agents/sisyphus/gpt-5-5.ts`
  - GPT-5.5-specific prompt.
  - Uses a templated structure tailored to GPT-5.5 behavior.
- `src/agents/sisyphus/kimi-k2-6.ts`
  - Kimi/K2.x-specific prompt.
  - Adds stronger exploration budget and verification loop language.
- `src/agents/sisyphus/claude-opus-4-7.ts`
  - Claude Opus 4.7-specific prompt.
  - Uses XML-tagged scaffolding and stronger instruction-shaping.
- `src/agents/sisyphus/gemini.ts`
  - Not a full standalone prompt.
  - Adds Gemini-specific overlays and corrective blocks on top of the base prompt.
- `src/agents/sisyphus/index.ts`
  - Barrel exports for Sisyphus prompt builders.

### 2.3 Shared prompt dependencies

Sisyphus variants reuse shared builders from:

- `src/agents/dynamic-agent-prompt-builder.ts`
- `src/agents/dynamic-agent-core-sections.ts`
- `src/agents/dynamic-agent-policy-sections.ts`
- `src/agents/dynamic-agent-category-skills-guide.ts`
- `src/agents/dynamic-agent-tool-categorization.ts`

These files generate shared sections such as:

- agent identity
- key triggers
- tool selection tables
- explore/librarian delegation guidance
- oracle guidance
- category+skills delegation rules
- hard blocks and anti-patterns
- ultrawork and anti-duplication rules

### 2.4 Registration and config path

- `src/agents/builtin-agents/sisyphus-agent.ts`
  - `maybeCreateSisyphusConfig()` wraps the raw agent factory.
  - Resolves model selection.
  - Applies user overrides.
  - Appends environment context.
  - Applies GPT and frontier-model tool guards.
- `src/agents/builtin-agents.ts`
  - Calls `maybeCreateSisyphusConfig()` inside `createBuiltinAgents()`.
- `src/plugin-handlers/agent-config-handler.ts`
  - Inserts Sisyphus at the front of the main agent assembly order.
- `src/plugin-handlers/config-handler.ts`
  - Phase-3 config pipeline that ultimately registers the final Sisyphus config.

### 2.5 Runtime modifiers and related guards

- `src/hooks/no-sisyphus-gpt/hook.ts`
  - Prevents invalid GPT usage patterns for Sisyphus.
- `src/agents/gpt-apply-patch-guard.ts`
  - Constrains GPT `apply_patch` permission behavior.
- `src/agents/frontier-tool-schema-guard.ts`
  - Alters tool permission behavior for frontier models.
- `src/agents/env-context.ts`
- `src/agents/builtin-agents/environment-context.ts`
  - Append `<omo-env>` prompt context such as timezone and locale.

### 2.6 Config schemas that affect Sisyphus

- `src/config/schema/sisyphus-agent.ts`
  - Sisyphus agent feature toggles like `planner_enabled`, `replace_plan`, and `disabled`.
- `src/config/schema/sisyphus.ts`
  - Sisyphus task-system related config.
- `src/config/schema/agent-overrides.ts`
  - Prompt/model/tools/permission override path.

### 2.7 Tests that validate Sisyphus prompt behavior

- `src/agents/builtin-agents/sisyphus-agent.test.ts`
  - Validates config assembly, permission rules, and model behavior.
- `src/agents/sisyphus-id-contract.test.ts`
  - Checks prompt language around `bg_...` vs `ses_...` IDs.
- `src/agents/delegation-trust-prompt.test.ts`
  - Validates anti-duplication and delegation-trust wording.
- `src/agents/sisyphus-hecateq-handoff.test.ts`
  - Validates the Sisyphus → Hecateq handoff block.

### 2.8 Sisyphus flow summary

```text
config-handler.ts
  -> agent-config-handler.ts
    -> createBuiltinAgents()
      -> maybeCreateSisyphusConfig()
        -> createSisyphusAgent()
          -> choose model-specific prompt variant
          -> compose shared dynamic sections
          -> apply Gemini overlays when relevant
          -> append Hecateq handoff guidance
        -> apply overrides + env context + permission guards
```

---

## 3. Hephaestus

### 3.1 Role

Hephaestus is the autonomous deep worker. It is goal-oriented rather than interview-oriented: give it a concrete objective and it explores, plans locally, executes, and verifies.

### 3.2 Primary prompt source files

#### Core router and factory

- `src/agents/hephaestus/agent.ts`
  - Main `createHephaestusAgent()` factory.
  - Routes to the correct model-specific prompt source.
  - Builds the final `AgentConfig` with GPT-safe permissions.

#### Variant prompt files

- `src/agents/hephaestus/gpt.ts`
  - Base GPT fallback prompt.
- `src/agents/hephaestus/gpt-5-5.ts`
  - GPT-5.5-native prompt used by current preferred Hephaestus routing.
- `src/agents/hephaestus/gpt-5-4.ts`
  - GPT-5.4-native prompt with XML-tagged blocks.
- `src/agents/hephaestus/gpt-5-3-codex.ts`
  - GPT-5.3 Codex-specific variant.
- `src/agents/hephaestus/index.ts`
  - Barrel exports.

### 3.3 Shared prompt dependencies

Hephaestus also relies on the same dynamic prompt section builder family used by Sisyphus:

- `src/agents/dynamic-agent-prompt-builder.ts`
- `src/agents/dynamic-agent-core-sections.ts`
- `src/agents/dynamic-agent-policy-sections.ts`
- `src/agents/dynamic-agent-category-skills-guide.ts`

The key difference is that Hephaestus uses these sections to shape an execution worker, not the primary orchestrator.

### 3.4 Registration and config path

- `src/agents/builtin-agents/hephaestus-agent.ts`
  - `maybeCreateHephaestusConfig()` wraps the factory.
  - Validates provider/model availability.
  - Applies overrides, environment context, and tool guards.
- `src/agents/builtin-agents.ts`
  - Builds and registers the Hephaestus config.
- `src/plugin-handlers/agent-config-handler.ts`
  - Places Hephaestus after Sisyphus and Hecateq in canonical order.

### 3.5 Model requirements and restrictions

- `packages/model-core/src/model-requirements.ts`
  - Defines `AGENT_MODEL_REQUIREMENTS["hephaestus"]`.
  - Hephaestus is tied to OpenAI-compatible/GPT-oriented providers.
- `src/agents/gpt-apply-patch-guard.ts`
  - Denies `apply_patch` for GPT-backed usage.
- `src/agents/frontier-tool-schema-guard.ts`
  - Applies frontier model tool restrictions.

### 3.6 Runtime modifiers and hooks

- `src/hooks/no-hephaestus-non-gpt/hook.ts`
  - Guards against running Hephaestus on invalid non-GPT models.
  - Can redirect or warn depending on override settings.
- `src/config/schema/agent-overrides.ts`
  - Includes the Hephaestus-specific `allow_non_gpt_model` override path.

### 3.7 Team-mode implications

- `src/features/team-mode/types.ts`
  - Marks Hephaestus as conditionally eligible in team mode.
  - Teammate permission controls whether it can act as a team member.
- `src/plugin-handlers/tool-config-handler.ts`
  - Relevant for teammate permission grant behavior.

### 3.8 Tests that validate Hephaestus prompt behavior

- `src/agents/hephaestus/agent.test.ts`
  - Primary prompt and factory behavior tests.
- `src/agents/hephaestus-id-contract.test.ts`
  - Checks `bg_...` vs `ses_...` prompt contract language.
- `src/hooks/no-hephaestus-non-gpt/index.test.ts`
  - Validates runtime guard behavior.
- `packages/model-core/src/model-requirements.test.ts`
  - Validates provider/model requirement behavior.

### 3.9 Hephaestus flow summary

```text
agent-config-handler.ts
  -> createBuiltinAgents()
    -> maybeCreateHephaestusConfig()
      -> createHephaestusAgent()
        -> getHephaestusPromptSource(model)
        -> choose one of gpt / gpt-5-4 / gpt-5-5 / gpt-5-3-codex
        -> compose shared dynamic sections
      -> apply overrides + env context + permission guards
runtime:
  -> no-hephaestus-non-gpt hook can block or redirect invalid model usage
```

---

## 4. Hecateq God (`hecateq-orchestrator`)

### 4.1 Role

Hecateq God is a custom-agent-first planner, router, and dispatcher. Its prompt is much more policy-heavy than the others and is explicitly tied to:

- exact custom-agent discovery
- project memory
- git checkpoint policy
- task dependency graphs
- shared contract artifacts
- prompt intake classification

It is now explicitly **delegation-first**:

- normal implementation should be delegated
- small implementation still defaults to delegation
- direct self-editing is reserved for a narrowly-defined **tiny safe bridging fix** gate

### 4.2 Primary prompt source files

#### Core prompt policy and builder

- `src/agents/hecateq-orchestrator/default.ts`
  - Defines `HECATEQ_ORCHESTRATOR_POLICY`.
  - Defines `HECATEQ_PROJECT_ROOT_MEMORY_POLICY`.
  - Exports `buildDefaultHecateqOrchestratorPrompt()`.
  - This is the main policy text for Hecateq God.

- `src/agents/hecateq-orchestrator/agent.ts`
  - Main `createHecateqOrchestratorAgent()` factory.
  - Builds the `<custom-agent-registry>` section from discovered custom agent summaries.
  - Adds the agent identity block as `Hecateq God`.
  - Composes the final prompt by combining identity + default prompt + memory policy.

- `src/agents/hecateq-orchestrator/index.ts`
  - Barrel exports.

### 4.3 Registration and config path

- `src/agents/builtin-agents/hecateq-orchestrator-agent.ts`
  - `maybeCreateHecateqOrchestratorConfig()`.
  - Resolves model/fallback behavior.
  - Applies permission guards.
  - Merges user overrides.
  - Creates the runtime-facing config for Hecateq.

- `src/agents/builtin-agents.ts`
  - Includes Hecateq in the builtin agent assembly path.

- `src/plugin-handlers/agent-config-handler.ts`
  - Collects `customAgentSummaries` from config, user, project, OpenCode, plugin, and inline sources.
  - Passes those summaries only into the Hecateq config path.
  - Inserts Hecateq between Sisyphus and Hephaestus.

### 4.4 Prompt-related runtime context injection

Hecateq is uniquely coupled to project-root memory and artifact injection.

#### Project context injection

- `src/hooks/hecateq-project-context-injector/index.ts`
  - Builds and injects `<hecateq-project-context>` blocks.
  - Reads:
    - `.opencode/memory/knowledge/context/active-context.md`
    - `progress.md`
    - `tasks.md`
    - `file-map.md`
    - `decisions.md`
    - contract files
    - task-graph files
    - generated agent index summary

#### Memory bootstrap

- `src/hooks/hecateq-memory-bootstrap/index.ts`
  - Ensures Hecateq-related project memory directories and files exist.
  - Supports the prompt assumptions defined in the memory policy.

#### Hook wiring

- `src/plugin/hooks/create-session-hooks.ts`
  - Wires the Hecateq memory bootstrap and project-context hooks.
- `src/hooks/index.ts`
  - Barrel export for Hecateq hooks.

### 4.5 Agent-index and routing metadata support

- `src/shared/hecateq-agent-indexer.ts`
  - Generates and reads agent capability metadata.
  - Supplies ranking signals like:
    - `primary_domain`
    - `confidence`
    - `ambiguity`
    - `use_when`
    - `avoid_when`
- `src/tools/delegate-task/subagent-discovery.ts`
  - Merges runtime agents with discovered agents and optional Hecateq index metadata.
- `src/tools/delegate-task/subagent-resolver.ts`
  - Runtime-validates exact agent targets and suggestion ranking.
- `src/tools/delegate-task/category-resolver.ts`
  - Adds custom-agent-first hinting even in category fallback paths.

These files are not the Hecateq prompt itself, but they materially support its routing model and are part of its effective behavior.

### 4.6 Command and supporting integration

- `src/hooks/auto-slash-command/executor.ts`
  - Handles `/hecateq-agent-index` generation path.
- `src/config/schema/commands.ts`
  - Includes the `hecateq-agent-index` command.

### 4.7 Model requirements and placement

- `packages/model-core/src/model-requirements.ts`
  - Defines `AGENT_MODEL_REQUIREMENTS["hecateq-orchestrator"]`.
  - Fallback chain prefers `gpt-5.4`, then `claude-sonnet-4-6`, then `kimi-k2.6`, then `big-pickle`.
- `src/shared/agent-ordering.ts`
  - Includes Hecateq in canonical order between Sisyphus and Hephaestus.
- `src/shared/agent-display-names.ts`
  - Display-name mapping for Hecateq.
- `src/shared/migration/agent-names.ts`
  - Migration aliases for `hecateq-orchestrator`.

### 4.8 Team-mode implications

- `src/features/team-mode/types.ts`
  - Marks Hecateq as hard-reject for team member mode.
  - It must be invoked through normal task delegation, not as a shared team member runtime.

### 4.9 Tests and implementation docs that validate Hecateq behavior

#### Tests

- `src/agents/builtin-agents/hecateq-orchestrator-agent.test.ts`
  - Validates config creation, overrides, fallback behavior, and prompt-section expectations.
- `src/agents/sisyphus-hecateq-handoff.test.ts`
  - Validates Sisyphus handoff prompt and Hecateq policy visibility.
- `src/hooks/hecateq-project-context-injector/index.test.ts`
  - Validates context injection behavior.
- `src/hooks/hecateq-memory-bootstrap/index.test.ts`
  - Validates memory bootstrap behavior.
- `src/tools/delegate-task/category-resolver.test.ts`
  - Validates custom-agent-first fallback hints.
- `src/tools/delegate-task/zauc-mocks-subagent-resolver/subagent-resolver.test.ts`
  - Validates runtime discovery/suggestion behavior involving Hecateq index metadata.

#### Implementation reports and design notes

- `HECATEQ_ORCHESTRATOR_IMPLEMENTATION.md`
- `HECATEQ_AGENT_INDEX_SUMMARY_INJECTION.md`
- `PROMPT_INTAKE_ANALYZER_IMPLEMENTATION.md`
- `CUSTOM_AGENT_FIRST_ROUTING_IMPLEMENTATION.md`

These markdown files explain how and why Hecateq prompt behavior was added or modified.

### 4.10 Hecateq flow summary

```text
agent-config-handler.ts
  -> collect customAgentSummaries
  -> createBuiltinAgents()
    -> maybeCreateHecateqOrchestratorConfig()
      -> createHecateqOrchestratorAgent()
        -> build custom-agent-registry section
        -> build agent identity as Hecateq God
        -> buildDefaultHecateqOrchestratorPrompt()
      -> apply overrides + permission guards

runtime/session hooks:
  -> hecateq-memory-bootstrap ensures memory/task-graph/contract structure exists
  -> hecateq-project-context-injector injects project memory and artifact summary
supporting routing:
  -> hecateq-agent-index metadata can influence exact-agent ranking and fallback guidance
```

---

## 5. Key cross-agent relationships

### 5.1 Sisyphus → Hecateq

Sisyphus can hand off large multi-domain orchestration work to Hecateq. This behavior is documented and tested in:

- `src/agents/sisyphus.ts`
- `src/agents/sisyphus-hecateq-handoff.test.ts`

### 5.2 Hecateq → specialist agents

Hecateq is designed to prefer exact custom agents first, then builtin/safe fallbacks. Its runtime support path runs through:

- `src/tools/delegate-task/subagent-discovery.ts`
- `src/tools/delegate-task/subagent-resolver.ts`
- `src/tools/delegate-task/category-resolver.ts`

### 5.3 Hephaestus as an owned worker

Hecateq policy explicitly frames Hephaestus as a deep worker or integration supervisor, not the default orchestrator. That policy is in:

- `src/agents/hecateq-orchestrator/default.ts`

---

## 6. Short file index by agent

### Sisyphus

- `src/agents/sisyphus.ts`
- `src/agents/sisyphus/default.ts`
- `src/agents/sisyphus/gpt-5-4.ts`
- `src/agents/sisyphus/gpt-5-5.ts`
- `src/agents/sisyphus/kimi-k2-6.ts`
- `src/agents/sisyphus/claude-opus-4-7.ts`
- `src/agents/sisyphus/gemini.ts`
- `src/agents/sisyphus/index.ts`
- `src/agents/dynamic-agent-prompt-builder.ts`
- `src/agents/builtin-agents/sisyphus-agent.ts`
- `src/plugin-handlers/agent-config-handler.ts`
- `src/hooks/no-sisyphus-gpt/hook.ts`

### Hephaestus

- `src/agents/hephaestus/agent.ts`
- `src/agents/hephaestus/gpt.ts`
- `src/agents/hephaestus/gpt-5-5.ts`
- `src/agents/hephaestus/gpt-5-4.ts`
- `src/agents/hephaestus/gpt-5-3-codex.ts`
- `src/agents/hephaestus/index.ts`
- `src/agents/builtin-agents/hephaestus-agent.ts`
- `src/plugin-handlers/agent-config-handler.ts`
- `src/hooks/no-hephaestus-non-gpt/hook.ts`
- `packages/model-core/src/model-requirements.ts`

### Hecateq God

- `src/agents/hecateq-orchestrator/agent.ts`
- `src/agents/hecateq-orchestrator/default.ts`
- `src/agents/hecateq-orchestrator/index.ts`
- `src/agents/builtin-agents/hecateq-orchestrator-agent.ts`
- `src/plugin-handlers/agent-config-handler.ts`
- `src/hooks/hecateq-project-context-injector/index.ts`
- `src/hooks/hecateq-memory-bootstrap/index.ts`
- `src/shared/hecateq-agent-indexer.ts`
- `src/tools/delegate-task/subagent-discovery.ts`
- `src/tools/delegate-task/subagent-resolver.ts`
- `src/tools/delegate-task/category-resolver.ts`

---

## 7. Practical editing guide

If you want to change a specific kind of behavior, edit these files first:

| Goal | Primary file |
|---|---|
| Change Sisyphus base orchestration policy | `src/agents/sisyphus/default.ts` or the model-specific variant file |
| Change Sisyphus model routing | `src/agents/sisyphus.ts` |
| Change Hephaestus worker prompt | `src/agents/hephaestus/gpt-5-5.ts` or related variant |
| Change Hephaestus model routing | `src/agents/hephaestus/agent.ts` |
| Change Hecateq core routing policy | `src/agents/hecateq-orchestrator/default.ts` |
| Change Hecateq identity or custom-agent registry section | `src/agents/hecateq-orchestrator/agent.ts` |
| Change Hecateq project-memory injection | `src/hooks/hecateq-project-context-injector/index.ts` |
| Change Hecateq bootstrap directories/files | `src/hooks/hecateq-memory-bootstrap/index.ts` |
| Change exact-agent runtime ranking/help | `src/tools/delegate-task/subagent-discovery.ts` and `subagent-resolver.ts` |

---

## 8. Validation references

After changing any of these prompt systems, the most relevant test clusters are:

- Sisyphus:
  - `src/agents/builtin-agents/sisyphus-agent.test.ts`
  - `src/agents/sisyphus-id-contract.test.ts`
  - `src/agents/delegation-trust-prompt.test.ts`
  - `src/agents/sisyphus-hecateq-handoff.test.ts`
- Hephaestus:
  - `src/agents/hephaestus/agent.test.ts`
  - `src/agents/hephaestus-id-contract.test.ts`
  - `src/hooks/no-hephaestus-non-gpt/index.test.ts`
- Hecateq:
  - `src/agents/builtin-agents/hecateq-orchestrator-agent.test.ts`
  - `src/agents/sisyphus-hecateq-handoff.test.ts`
  - `src/hooks/hecateq-project-context-injector/index.test.ts`
  - `src/hooks/hecateq-memory-bootstrap/index.test.ts`
  - `src/tools/delegate-task/category-resolver.test.ts`

This document should be treated as a prompt-architecture map, not as a user-facing feature guide.
