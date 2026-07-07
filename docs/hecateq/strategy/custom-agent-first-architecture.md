# Custom-Agent-First Architecture: Feasibility Analysis

**Generated:** 2026-07-07 | **Status:** Draft | **Version:** 1.0

> Analysis of restructuring the Hecateq OpenAgent plugin so that Hecateq God becomes the primary orchestrator, Hecateq Planner becomes the planning decomposition agent, and the other 12 built-in agents become optional/specialist — with custom agents (.md agent files) as the long-term direction.

---

## 1. Executive Summary

The Hecateq God agent (`hecateq-orchestrator`) is already designed as a custom-agent-first orchestrator: it filters built-in agents out of its registry, uses `<custom-agent-registry>` XML blocks, denies write/edit tools, and has `disable_category_routing: true`. However, it does not call Hecateq Planner at runtime, custom agents are passively displayed rather than actively routed, and the 12 other built-in agents are hardcoded into the `BuiltinAgentNameSchema` Zod enum used across 12+ files. The recommended strategy is **Option B (Additive)** evolving into **Option D (Category Executor Pattern)** over 4 phases through v7.0, with the critical prerequisite of a schema breaking-change plan for the agent name enum.

---

## 2. Current State

### 2.1 Hecateq God (`src/agents/hecateq-orchestrator/`)

| Attribute | Value |
|-----------|-------|
| Mode | `all` (visible in primary AND subagent contexts -- unique among agents) |
| Prompt LOC | ~4,794 across 7 files; `default.ts` is 756 LOC |
| Core files | `agent.ts` (factory), `default.ts` (policy), `prompt-pack.ts`, `prompt-adapters.ts`, `prompt-profile.ts` |
| Model adapters | 7: GPT, Claude, Gemini, Qwen, DeepSeek, small-model, generic |
| Tool restrictions | `write`, `edit`, `call_omo_agent` denied; category routing permanently disabled |
| Custom agent integration | Yes -- `buildCustomAgentRegistrySection()` renders `<custom-agent-registry>` XML block; filters out `BuiltinAgentNameSchema` names |
| Orchestration mode flags | `delegation_first` (default true), `deny_write_tools`, `strict_runtime_truth` |
| Sisyphus integration | Hecateq God's `default.ts` policy references `hecateq-planner` explicitly (rule 12). No runtime wiring exists. |

Key design principle from `default.ts` (line 4): "You are Hecateq God, the user's primary custom-agent-first planner, router, and dispatcher."

### 2.2 Hecateq Planner (`src/agents/hecateq-planner/`)

| Attribute | Value |
|-----------|-------|
| Mode | `subagent` |
| Prompt LOC | 109 lines in `agent.ts` |
| Prompt structure | `<role>`, `<core_responsibilities>`, `<planning_framework>`, `<output_format>`, `<parallelization_rules>`, `<agent_selection_guide>` |
| Agent matching table | Hardcoded in prompt (task type -> recommended agent) |
| Tool restrictions | `write`, `edit`, `apply_patch`, `task` denied |
| Hecateq God integration | **None** -- God's prompt says to use planner, but no runtime code invokes it |
| V2 status | Stub (`src/agents/hecateq-planner/v2/`). Flag `shouldUsePlannerV2()` returns `{ enabled: false, source: "stub-pr-a" }`. Planned features: JSON-structured output, agent-registry injection, self-critique, replanning -- all gated behind disabled flags. |

### 2.3 The Other 12 Agents

| Agent | Mode | File | LOC (est) | Role |
|-------|------|------|-----------|------|
| Sisyphus | primary | `src/agents/sisyphus/` | ~2500 | Master orchestrator (upstream default) |
| Hephaestus | primary | `src/agents/hephaestus/` | ~1800 | Implementation agent |
| Prometheus | primary | `src/agents/prometheus/` | ~1200 | Strategic planner (special-cased -- not in `agentSources` record) |
| Oracle | subagent | `src/agents/oracle.ts` | ~200 | Architecture review |
| Librarian | subagent | `src/agents/librarian.ts` | ~150 | Documentation lookup |
| Explore | subagent | `src/agents/explore.ts` | ~150 | Codebase exploration |
| Atlas | primary | `src/agents/atlas/` | ~400 | Background orchestrator |
| Metis | subagent | `src/agents/metis.ts` | ~200 | Pre-planning consultant |
| Momus | subagent | `src/agents/momus.ts` | ~200 | Plan reviewer |
| Multimodal-Looker | subagent | `src/agents/multimodal-looker.ts` | ~100 | Vision/PDF analysis |
| Sisyphus-Junior | subagent | `src/agents/sisyphus-junior/` | ~300 | DEPRECATED (v4.3.0, removal in v5.0.0) |

### 2.4 Custom Agent Infrastructure

Two parallel systems exist for loading custom agents:

| System | Source directory | Integration with Hecateq God | Integration with Planner |
|--------|-----------------|------------------------------|--------------------------|
| `claude-code-agent-loader` | `.opencode/agents/`, `.claude/agents/`, `~/.config/opencode/agents/` | Yes -- `customAgentSummaries` parameter in `createHecateqOrchestratorAgent()` | No |
| `hecateq-orchestration/agent-selector.ts` (`readLocalAgentRegistry`) | `.opencode/agents/` | Yes -- `selectAgentsFromPool()` feeds orchestration pipeline | No |

The `agent_definitions` config field supports `.md` with YAML frontmatter, `.json`, and `.jsonc` formats. Hecateq God's `buildCustomAgentRegistrySection()` filters built-in agents from the registry, deduplicates by normalized name, truncates descriptions to 120 chars, and caps visible entries at 12.

---

## 3. Architectural Analysis

### 3.1 Coupling Assessment (Severity: Tier 2 -- Moderate)

| Coupling Point | Files Affected | Severity | Description |
|----------------|---------------|----------|-------------|
| `BuiltinAgentNameSchema` Zod enum | 12+ files | HIGH | Adding or removing agent names requires coordinated changes across schema validation, type exports, and consumer code |
| `agentSources` record | `src/agents/builtin-agents.ts` | HIGH | Each agent has a factory registration; removal requires conditional handling |
| Sisyphus prompt sections | `sisyphus/` prompt files | MEDIUM | Agent delegation tables hardcoded in Sisyphus prompts -- legacy coupling |
| `OverridableAgentNameSchema` | 5+ files | MEDIUM | Wider than builtins -- includes `build`, `plan`, `OpenCode-Builder` |
| Agent mode assertions (`mode: "primary"`) | `src/agents/builtin-agents/general-agents.ts` | MEDIUM | Code assumes `primary` agents are listed; removing Sisyphus as primary breaks assumptions |

### 3.2 Routing Implications

Current routing flow: Hecateq God is first in canonical order (Hecateq God -> Sisyphus -> Hephaestus -> Prometheus -> Atlas). There is no flag to disable Sisyphus as orchestrator. When both God and Sisyphus are active, the user sees two orchestrator agents. Hecateq God's prompt permanently disables category routing (`disable_category_routing: true`), but the `task()` delegation tool still supports category-style routing at the infrastructure level -- only the prompt forbids it.

### 3.3 Prompt Architecture

Hecateq God's prompt is ~4,794 LOC across 7 files, vs Sisyphus's ~2,500 LOC. The God prompt has:
- 7 model-specific adapter blocks (vs Sisyphus's 5 model-specific variants)
- <custom-agent-registry> XML block injection
- Detailed handoff protocol with STATUS/SIGNALS_EMITTED/HANDOFF format
- Low-read orchestration discipline section
- Flexible work classification (multi-dimensional routing signals)

Removing agent-specific prompt sections (e.g., Sisyphus's delegation tables) carries a **MEDIUM risk** of prompt quality regression. The sections are referenced in the dynamic prompt builder.

### 3.4 Capability Declaration

Agent capabilities are declared through:
- **Zod enums** (`BuiltinAgentNameSchema`, `OverridableAgentNameSchema`)
- **Static prompt metadata** (`AgentPromptMetadata`), which includes `category`, `cost`, `triggers`, `useWhen`, `avoidWhen`
- **Hardcoded tables** in Hecateq Planner's prompt (task type -> recommended agent)
- **Model requirement chains** in `src/shared/model-requirements.ts`

Custom agents declare capabilities only through YAML frontmatter: `name`, `description`, `domain`, `use_when`, `avoid_when`, `model`, `mode`, `priority`, `keywords`. There is no standardized capability schema.

### 3.5 Safety Boundaries

Critical gap: **Custom agents have no tool restrictions by default.** The only restriction is what their `.md` frontmatter declares. Built-in agents have explicit deny lists (e.g., `write`, `edit`, `task` for read-only agents) enforced through `createAgentToolRestrictions()` in `src/shared/permission-compat.ts`. Custom agents bypass this entirely unless the user manually configures `tools: {}` overrides.

Hecateq God itself has robust safety: `deny_write_tools`, `deny_tools` on `AgentOverrideConfig`, and explicit prompt-level restrictions. But the agents God delegates to may not have equivalent safety.

---

## 4. What We Can Do

### Option A: Nuclear Removal of 12 Agents

Remove all 12 non-Hecateq agents from `BuiltinAgentNameSchema`. Hecateq God becomes the only orchestrator; Planner becomes the only planning agent.

| Factor | Assessment |
|--------|-----------|
| Effort | LOW (schema change + prompt removal) |
| Risk | HIGH -- breaks every `.opencode/oh-my-openagent.jsonc` with agent-specific config; breaks team-mode eligibility; breaks `OverridableAgentNameSchema` consumers |
| Back-compat | None -- breaking change on upgrade |
| Recommendation | **Not recommended** for v5.x. May be viable in v7.0+ with deprecation period. |

### Option B: Additive (Hecateq God Primary, Others Optional)

Make Hecateq God the default orchestrator. Sisyphus and other agents remain registered but are not loaded by default -- opt-in via `disabled_agents` override logic inverted.

| Factor | Assessment |
|--------|-----------|
| Effort | MEDIUM (invert default, add soft-deprecation warnings, update agent-config-handler) |
| Risk | LOW -- preserves existing configs, no schema break |
| Back-compat | Full -- existing `disabled_agents` still works; agents become opt-in |
| Recommendation | **Recommended as Phase 2 (v5.0).** |

### Option C: Custom-Agent-First with Hecateq God as Fallback

Make custom agents the primary routing targets. Hecateq God routes to custom agents first; built-in agents are fallbacks only. Requires active agent discovery and dynamic capability matching.

| Factor | Assessment |
|--------|-----------|
| Effort | HIGH (unified agent registry, capability matching engine, Hecateq Planner integration) |
| Risk | MEDIUM -- no schema break, but routing behavior change may surprise existing users |
| Back-compat | Partial -- custom agents were passive; become active by default |
| Recommendation | **Long-term target (Phase 3-4).** Not ready without Planner integration. |

### Option D: New Category Executor Pattern

Replace hardcoded built-in agents with a runtime category-executor system. Built-in agent definitions become `.md` files in a built-in directory. Users add/replace by writing their own `.md` agent files.

| Factor | Assessment |
|--------|-----------|
| Effort | VERY HIGH (new schema, migration tool, backward-compat layer, testing) |
| Risk | MEDIUM -- schema changes, but migration tool can auto-convert; requires `HecateqCategoryExecutor` abstraction |
| Back-compat | Migration layer needed for existing configs referencing agent names |
| Recommendation | **Architecture target (Phase 5, v7.0+).** |

### Recommendation: B -> D Evolution

The recommended path is **Option B (Additive)** as the immediate target (v5.0), evolving toward **Option D (Category Executor Pattern)** over subsequent releases. This provides incremental value (Hecateq God as primary orchestrator) while building toward the long-term custom-agent-first architecture.

| Phase | Version | Action |
|-------|---------|--------|
| 1 | Current | Hecateq God and Sisyphus both available; God documented as preferred orchestrator |
| 2 | v5.0 | Hecateq God becomes default orchestrator. Sisyphus becomes optional specialist. Sisyphus-Junior removed. Planner v2 flag enabled (opt-in). |
| 3 | v5.1 | Unified agent definition schema. Planner receives custom agent registry. Tool restrictions for custom agents. |
| 4 | v5.2 | Hecateq God calls Hecateq Planner at runtime for task decomposition. Soft-deprecation warnings on remaining built-in agents. |
| 5 | v6.0 | Category executor pattern introduced as opt-in. Migration tools for built-in agent configs. |
| 6 | v7.0 | Category executor becomes default. Remaining built-in agents deprecated. Schema breaking-change release. |

---

## 5. Top Risks and Mitigations

| Rank | Risk | Severity | Mitigation |
|------|------|----------|------------|
| 1 | **Custom agents have no tool restrictions by default.** A user-created `.md` agent can write/edit/delete files without any guard. | CRITICAL | Add `tool_restrictions` and `default_deny` fields to the unified agent definition schema. Enforce restrictions in `agent-config-handler.ts` Phase 3. Default all custom agents to deny `write` and `edit` unless explicitly permitted. |
| 2 | **Schema breaking change (`BuiltinAgentNameSchema` Zod enum).** Removing any agent name from the enum breaks validation in 12+ files, including config validation at plugin load time. | HIGH | 1) Plan deprecation over 2 minor versions before removal. 2) Add migration function in `migrateConfigFile()` to auto-remove deprecated agent names from `disabled_agents`. 3) Keep enum entries during deprecation period; remove only in a major version bump. |
| 3 | **Prompt quality regression when removing agent-specific sections.** The dynamic prompt builder stitches per-agent sections from metadata. Removing agents reduces prompt context. | MEDIUM | Maintain sections for custom agents via the unified definition format. Hecateq God's prompt already references custom agent registry; ensure Planner's prompt does too. Run prompt-quality regression tests comparing delegation accuracy before/after changes. |

---

## 6. Hecateq God Capability Gaps vs Sisyphus

| Capability | Sisyphus | Hecateq God | Gap Severity |
|-----------|----------|-------------|--------------|
| Model-specific prompt variants | 5 model-specific files | 7 adapter blocks in `prompt-adapters.ts` | None (God has more) |
| Dynamic per-agent delegation tables | Yes, via `dynamic-agent-prompt-builder.ts` | Yes, via `<custom-agent-registry>` XML | Low (different format, same capability) |
| Category routing | Yes, via `task(category=...)` | Permanently disabled (`disable_category_routing: true`) | N/A by design |
| Intent Gate (Phase 0-3) | Yes, in `sisyphus.ts` | No -- Hecateq God has no Phase 0-3 intent gate | MEDIUM -- users lose ultrawork/search/analyze mode detection |
| Background execution patterns | Via `Atlas` agent | Not explicitly documented | MEDIUM -- needs delegation pattern documentation |
| Todo continuation / boulder | Via `todoContinuationEnforcer` hook | Not mentioned in God prompt | LOW -- hook is independent of agent |
| Ralph loop | Via `ralphLoop` hook | Not mentioned in God prompt | LOW -- hook is independent of agent |
| Handoff protocol | Not structured | Fully structured with `STATUS/SIGNALS_EMITTED/HANDOFF` | God is ahead |

---

## 7. Migration Roadmap

### Phase 1: Current State (v4.x)
- Hecateq God and Sisyphus both registered as orchestrators
- Custom agents loaded but passively displayed
- Planner v2 behind always-disabled flag
- No unified agent definition format

### Phase 2: v5.0 (Target: 6-8 weeks)
- Hecateq God becomes the default orchestrator; Sisyphus moved to opt-in
- Sisyphus-Junior removed per deprecation plan (already announced in v4.3.0)
- Planner v2 flag enabled with opt-in
- Soft-deprecation warnings on non-Hecateq agent factories
- Update `agent-config-handler.ts` to invert agent-loading default
- Add `deprecated_agents` migration function to `migrateConfigFile()`

### Phase 3: v5.1 (Target: 4-6 weeks after v5.0)
- Unified agent definition schema for custom agents (`.md` + `.yaml` + `.json`)
- `HecateqCustomAgentConfig` schema with `tool_restrictions`, `default_deny`, `model_requirements`
- Hecateq Planner receives custom agent registry injection (via `customAgentSummaries` parameter, matching God's pattern)
- Tool restrictions enforced for all custom agents (default deny `write`/`edit`)
- `agent-definitions-loader.ts` extended with unified format support

### Phase 4: v5.2 (Target: 4-6 weeks after v5.1)
- Hecateq God calls Hecateq Planner for multi-step task decomposition
- Planner's output (structured task graph) feeds into Hecateq God's delegation decisions
- Soft-deprecation warnings on remaining built-in agents (Oracle, Librarian, Explore, etc.)
- Documentation: built-in agent equivalents as custom agent examples

### Phase 5: v6.0 (Target: 8-12 weeks after v5.2)
- Category executor pattern introduced as opt-in feature
- Built-in agents registered via internal `.md` definitions rather than hardcoded factories
- Migration tool: `bunx hecateq-openagent migrate-agents` converts existing configs
- Hecateq Planner v2 fully active (JSON-structured output, self-critique, replanning)

### Phase 6: v7.0 (Target: depends on adoption)
- `BuiltinAgentNameSchema` reduced to Hecateq God + Hecateq Planner only
- Category executor pattern becomes default routing
- All prior agent-specific config changes handled by migration tools
- Remaining built-in agents distributed as pre-installed `.md` custom agents
- Clean break: no backward compatibility shims for agent-name-dependent configs

---

## 8. Custom Agent System Requirements

### MVP (Phase 3, v5.1)

| Requirement | Status | Priority |
|-------------|--------|----------|
| Unified `.md` frontmatter format (name, description, domain, model, mode, tool_restrictions, model_requirements) | Not started | P0 |
| `tool_restrictions` YAML block with default deny list (deny `write`/`edit` by default) | Not started | P0 |
| Tool restriction enforcement in `agent-config-handler.ts` | Not started | P0 |
| Planner receives custom agent registry (parameter parity with God) | Not started | P1 |
| Hecateq God actively routes to custom agents (not just display) | Partially done | P1 |
| `hecateq doctor` validates custom agent configurations | Framework exists | P1 |

### Full Scope (Phase 4+, v5.2+)

| Requirement | Status | Priority |
|-------------|--------|----------|
| Skill declarations in agent definitions (list of SKILL.md dependencies) | Not started | P2 |
| Testing/sandbox mode for custom agents (dry-run before activation) | Not started | P2 |
| Versioning in agent definitions (semver metadata in frontmatter) | Not started | P3 |
| Agent dependency declarations (depends_on other agents) | Not started | P3 |
| Agent composition (combine multiple agent definitions) | Not started | P4 |
| Community registry / marketplace concept | Not started | P4 |

---

## 9. Key Gaps to Bridge

1. **Hecateq God does not call Hecateq Planner.** The God prompt mentions planner (rule 12 in `default.ts`), but no runtime code path connects them. Planner's structured output is never consumed.

2. **Custom agents are passively displayed, not actively routed.** The `<custom-agent-registry>` XML block lists available agents, but Hecateq God has no runtime mechanism to match tasks to custom agents. The `agent-selector.ts` module exists but is not wired into God's prompt or delegation loop.

3. **Dual custom agent systems are not unified.** `claude-code-agent-loader` and `hecateq-orchestration/agent-selector.ts` independently discover agents from overlapping directories. Agent A registered via loader may not appear in selector's registry.

4. **Planner v2 is a stub.** The `shouldUsePlannerV2()` function returns `{ enabled: false }` regardless of configuration. JSON-structured output, agent-registry injection, self-critique, and replanning features are unimplemented.

5. **The 12 other agents are hardcoded in `BuiltinAgentNameSchema`.** Removing them requires a coordinated schema change across 12+ files, handled by the deprecation strategy in section 7.

6. **No "orchestration mode" flag on Hecateq God.** There is no single flag to say "Hecateq God is the orchestrator; disable all other primary agents." The `delegation_first` flag controls behavior within God but does not affect agent registration.

7. **No unified agent definition format.** Custom agents use `claude-code-agent-loader` format (YAML frontmatter in `.md`), while built-in agents use TypeScript factories. Category executor pattern requires a single format for all agents.

8. **Planner's agent matching is hardcoded tables.** The `agent_selection_guide` section in Planner's prompt maps task types to agent names. This table must be dynamically generated from the actual agent registry for accurate matching.

9. **Handoff targets are hardcoded.** `HECATEQ_HANDOFF_PROTOCOL` in `default.ts` uses agent IDs that are fixed strings. Custom agents are invisible to the handoff protocol.

10. **No structured plan output from Planner.** Planner returns free-text Markdown. Machine-consumable JSON output (task graph, dependency waves, risk classification) is planned for v2 but not implemented.

---

## 10. Next Steps

### Immediate (1-2 weeks)
- [ ] Open PR to update Hecateq God's prompt to clarify that Planner is not yet wired. Replace rule 12's instruction with a soft note: "When Planner integration is enabled, use ..."
- [ ] Add `hecateq doctor` check for custom agent tool restrictions. Warn when a custom agent has no explicit tool restrictions.
- [ ] Create Github issues/milestones for Phase 2 (v5.0): default orchestrator swap, Sisyphus-Junior removal, soft-deprecation warnings.

### Short-term (3-6 weeks)
- [ ] Design the unified agent definition schema (`HecateqCustomAgentConfig`) with tool_restrictions, default_deny, model_requirements fields.
- [ ] Add `tool_restrictions` enforcement to `agent-config-handler.ts` Phase 3.
- [ ] Wire Hecateq Planner to receive `customAgentSummaries` parameter (matching God's `createHecateqOrchestratorAgent()` signature).

### Medium-term (7-12 weeks)
- [ ] Implement Planner v2 JSON-structured output path (turn on `shouldUsePlannerV2` behind `hecateq.experimental.planner_v2.enabled` flag).
- [ ] Build the runtime connection: Hecateq God calls Planner for tasks classified as LARGE or multi-domain.
- [ ] Add deprecation warnings to `createSisyphusAgent`, `createSisyphusJuniorAgentWithOverrides` in `agentSources`.

### Long-term (3-6 months)
- [ ] Category executor pattern design document and prototype.
- [ ] Migration tool for `BuiltinAgentNameSchema` to category executor format.
- [ ] Full custom agent lifecycle: definition -> validation -> registration -> tool restriction -> active routing -> handoff integration.

---

## References

| File | Purpose |
|------|---------|
| `src/agents/hecateq-orchestrator/agent.ts` | Hecateq God factory and custom agent registry builder |
| `src/agents/hecateq-orchestrator/default.ts` | Core policy (756 LOC), handoff protocol, memory policy |
| `src/agents/hecateq-orchestrator/prompt-pack.ts` | Prompt composition, adapter selection, delegation bias |
| `src/agents/hecateq-planner/agent.ts` | Planner prompt (109 LOC) and factory |
| `src/agents/hecateq-planner/v2/flag.ts` | Planner v2 feature flag (always disabled) |
| `src/agents/builtin-agents.ts` | `agentSources` record -- 12 factory registrations |
| `src/config/schema/agent-names.ts` | `BuiltinAgentNameSchema` (13 entries) and `OverridableAgentNameSchema` |
| `src/features/claude-code-agent-loader/loader.ts` | Custom agent discovery from `.opencode/agents/` and `.claude/agents/` |
| `src/features/hecateq-orchestration/agent-selector.ts` | `readLocalAgentRegistry()`, `selectAgents()`, `buildCandidatePool()` |
| `src/shared/agent-tool-restrictions.ts` | Built-in agent tool restriction definitions |
| `src/plugin-handlers/agent-config-handler.ts` | Phase 3 config loading -- where custom agents enter the pipeline |
