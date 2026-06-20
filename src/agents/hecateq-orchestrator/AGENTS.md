# src/agents/hecateq-orchestrator/ — Hecateq God Agent

**Generated:** 2026-06-20

## Overview

Hecateq God is the primary custom-agent-first planner, router, and dispatcher in the Hecateq OpenAgent plugin. It is the 12th built-in agent added in this fork (above the 11 upstream agents). It sits first in the canonical agent priority order (before Sisyphus) and serves as the user's main orchestrator interface.

- **Mode:** `all` (visible in both primary and subagent contexts)
- **Color:** `#7C3AED`
- **Reasoning Effort:** `high` (with `thinking: { type: "enabled", budgetTokens: 32000 }`)
- **Factory:** `createHecateqOrchestratorAgent()`
- **Source:** `src/agents/hecateq-orchestrator/agent.ts`

Core distinguishing features from the upstream Sisyphus orchestrator:

- Prefers **custom agents** over built-in agents via `buildCustomAgentRegistrySection()`
- Uses **deterministic routing** with explicit fallback behavior (no silent category fallback)
- Enforces **dependency-aware task ordering** with cycle detection
- Integrates with the **Hecateq orchestration pipeline**
- Emits structured **handoff blocks** for downstream agents
- `write` and `edit` tools are denied at runtime for orchestrator agents

## File Inventory

| File | LOC | Purpose |
|------|-----|---------|
| `agent.ts` | 185 | Main agent factory: `createHecateqOrchestratorAgent()`, `HecateqOrchestratorContext`, `buildDynamicPrompt()`, `buildCustomAgentRegistrySection()`, `renderCustomAgentXml()`, tool restrictions |
| `default.ts` | 677 | Core policy text: `HECATEQ_ORCHESTRATOR_POLICY` (500+ lines of routing rules), `HECATEQ_PROJECT_ROOT_MEMORY_POLICY`, `buildDefaultHecateqOrchestratorPrompt()` |
| `prompt-pack.ts` | 115 | `buildHecateqPromptPack()` — composes core policy + custom agent registry + model adapters + delegation bias + runtime truth block |
| `prompt-adapters.ts` | 123 | 7 model-specific adapter blocks (GPT, Claude, Gemini, Qwen, DeepSeek, small-model, generic) returned by `getHecateqPromptAdapter()` |
| `prompt-profile.ts` | 131 | `detectHecateqPromptProfile()` — auto-detection of model family from provider/model string; `normalizePromptProfile()` |
| `index.ts` | 3 | Barrel exports: `createHecateqOrchestratorAgent`, `buildCustomAgentRegistrySection`, `HECATEQ_ORCHESTRATOR_POLICY`, `buildDefaultHecateqOrchestratorPrompt`, types |
| `prompt-pack.test.ts` | 318 | Tests for prompt pack assembly: adapter selection, delegation bias, runtime truth, memory policy inclusion, `delegationFirst` softening |
| `prompt-profile.test.ts` | 385 | Tests for model profile detection: 30+ combinations of provider/model strings across all 7 profiles |
| `default.test.ts` | 162 | Tests for `HECATEQ_PROJECT_ROOT_MEMORY_POLICY` and `HECATEQ_ORCHESTRATOR_POLICY`: routing language, category fallback prohibition, tool denial, memory contract |
| `agent.test.ts` | 221 | Tests for `buildCustomAgentRegistrySection()`: empty registry, rich signal XML, missing optional fields, hidden/disabled filtering, description truncation, deduplication, 12-cap overflow, builtin name filtering |
| `category-examples-audit.test.ts` | 43 | Regression guard: scans all non-test `.ts` files in this directory for `task(category=` patterns (category routing is permanently disabled) |

## Factory Pattern

```typescript
export function createHecateqOrchestratorAgent(
  model: string,
  availableAgents?: AvailableAgent[],
  availableToolNames?: string[],
  availableSkills?: AvailableSkill[],
  availableCategories?: AvailableCategory[],
  customAgentSummaries?: HecateqCustomAgentSummary[],
  useTaskSystem?: boolean,        // default false
  orchestratorConfig?: HecateqOrchestratorConfig,
): AgentConfig
```

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `model` | `string` | Resolved model ID (e.g., `openai/gpt-5.4`, `anthropic/claude-sonnet-4-6`). Determines prompt adapter selection and tool schema permissions. |
| `availableAgents` | `AvailableAgent[]` | Runtime agent list from the plugin registry. Used by `buildDynamicPrompt()` for awareness of available delegations. |
| `availableToolNames` | `string[]` | Tool names available in the current session. Passed to `categorizeTools()` for the task tool note. |
| `availableSkills` | `AvailableSkill[]` | Skills available in the session. Passed through for prompt context. |
| `availableCategories` | `AvailableCategory[]` | Categories available for routing. Overridden in policy: category routing is permanently disabled (`disable_category_routing: true`). |
| `customAgentSummaries` | `HecateqCustomAgentSummary[]` | Custom (non-builtin) agent summaries discovered at runtime. Filtered, deduplicated, and rendered into `<custom-agent-registry>` XML block. Capped at 12 entries. |
| `useTaskSystem` | `boolean` (default `false`) | Whether the experimental task system is available. Controls the task tool note text. |
| `orchestratorConfig` | `HecateqOrchestratorConfig` | Policy overrides: `delegation_first`, `deny_write_tools`, `prompt_profile`, `model_adapters` (enabled, fallback, strict_runtime_truth, delegation_bias). |

### Returns

`AgentConfig` with:
- `description`: `"Primary custom-agent-first workflow orchestrator"`
- `mode`: `"all"`
- `model`: resolved model string
- `prompt`: dynamically built system prompt from `buildDynamicPrompt()`
- `color`: `"#7C3AED"`
- `reasoningEffort`: `"high"`
- `permission`: composite of `question: "allow"` + `getFrontierToolSchemaPermission(model)` + `getGptApplyPatchPermission(model)`

The factory carries a static property: `createHecateqOrchestratorAgent.mode = "all"` (used by the agent registration system).

## Prompt Builder Architecture

### `buildDynamicPrompt(ctx: HecateqOrchestratorContext): string`

Flow:

```
buildDynamicPrompt(ctx)
  ├─→ categorizeTools(ctx.availableToolNames)            # classifies tools by domain
  ├─→ buildCustomAgentRegistrySection(ctx.customAgentSummaries)  # builds XML registry block
  ├─→ buildAgentIdentitySection("Hecateq God", ...)       # identity header
  └─→ buildHecateqPromptPack({...})                       # compose full prompt
       ├─→ HECATEQ_ORCHESTRATOR_POLICY                    # core policy (677 LOC in default.ts)
       │     optionally softened when delegationFirst=false:
       │     "DELEGATION-FIRST" → "SOFTENED DELEGATION POLICY"
       │     "default" → "preferred" in key delegation rules
       ├─→ customAgentRegistrySection                      # <custom-agent-registry> XML block
       ├─→ taskToolNote                                    # task() guidance text
       ├─→ memoryPolicySection (optional)                  # HECATEQ_PROJECT_ROOT_MEMORY_POLICY
       ├─→ model adapter block                             # detected from prompt_profile + model
       │     ├─ gpt / claude / gemini / qwen / deepseek
       │     ├─ small-model / generic
       │     └─ disabled when model_adapters.enabled = false
       ├─→ runtime truth reinforcement (optional)           # when strict_runtime_truth = true
       └─→ delegation bias block (optional)                 # conservative / expanded / balanced (default: none)
```

### Sections

| Section | Source | Condition |
|---------|--------|-----------|
| Agent Identity | `buildAgentIdentitySection()` (external) | Always |
| Core Policy | `HECATEQ_ORCHESTRATOR_POLICY` (default.ts) | Always |
| Custom Agent Registry | `buildCustomAgentRegistrySection()` (agent.ts) | Always (content depends on registry) |
| Execution Note | Hardcoded in `buildHecateqPromptPack()` | Always |
| Memory Policy | `HECATEQ_PROJECT_ROOT_MEMORY_POLICY` (default.ts) | When `memoryPolicySection` is provided |
| Model Adapter | `getHecateqPromptAdapter()` (prompt-adapters.ts) | When `model_adapters.enabled !== false` |
| Runtime Truth | `buildRuntimeTruthBlock()` (prompt-pack.ts) | When `strict_runtime_truth === true` |
| Delegation Bias | `buildDelegationBiasBlock()` (prompt-pack.ts) | When bias is `conservative` or `expanded` |

## Custom Agent Registry

### `buildCustomAgentRegistrySection(summaries: HecateqCustomAgentSummary[] | undefined): string`

Filtering pipeline:

1. Filters out `hidden` or `disabled` agents
2. Filters out built-in agents (members of `OverridableAgentNameSchema` — ~20+ names including build, plan, sisyphus, hecateq-orchestrator, etc.)
3. Deduplicates by normalized lowercase name
4. Caps visible entries at 12 (`MAX_CUSTOM_AGENT_LINES`)
5. Truncates descriptions to 120 characters (preserving "..." ellipsis)

**When no visible custom agents exist:** Returns an empty string.

**When agents exist:** Produces a structured XML block with per-agent rich signal tags:

```xml
<custom-agent-registry>
<custom_agent name="backend-developer">
  <description>Implements REST APIs with Express and Prisma</description>
  <domain>backend</domain>
  <use-when>routing_signal == "api_implementation"</use-when>
  <avoid-when>routing_signal == "frontend_work"</avoid-when>
  <priority>high</priority>
  <skills>nodejs-backend-developer</skills>
</custom_agent>
<custom_agent name="ui-specialist">
  <description>Builds React components with shadcn/ui</description>
  <domain>frontend</domain>
  <priority>medium</priority>
</custom_agent>
</custom-agent-registry>
```

### Rich Signal Fields (HecateqCustomAgentSummary)

| Field | Type | Required | XML Tag | Description |
|-------|------|----------|---------|-------------|
| `name` | `string` | Yes | attribute `name="..."` | Agent identifier |
| `description` | `string` | No | `<description>` | 120-char truncated, pipe-to-slash normalized |
| `domain` | `string` | No | `<domain>` | Routing domain hint (e.g., backend, frontend, devops) |
| `useWhen` | `string` | No | `<use-when>` | Conditions when this agent should be selected |
| `avoidWhen` | `string` | No | `<avoid-when>` | Conditions when this agent should NOT be selected |
| `priority` | `string` | No | `<priority>` | Selection priority: high, medium, low |
| `skills` | `string` | No | `<skills>` | Associated skill names for delegation |
| `hidden` | `boolean` | No | (filtered out) | Hidden agents are excluded from output |
| `disabled` | `boolean` | No | (filtered out) | Disabled agents are excluded from output |

**Optional fields are omitted from XML when absent** — only `<description>` is always emitted (with fallback text if undefined).

If more than 12 custom agents exist, appends: `<!-- ... and N more exact custom agents in the registry -->`.

## Domain Hints

This agent is the orchestrator. It does not implement, debug, or review code directly. It plans, routes, and dispatches.

### Preferred Domains

| Domain | Why |
|--------|-----|
| Task decomposition | Custom-agent-first routing with dependency awareness |
| Multi-agent orchestration | Sequential and parallel delegation with shared contracts |
| Route resolution | Exact agent selection from custom registry |
| Risk classification | Multi-dimensional intake classification (size, domain, risk, dependency) |
| Execution planning | Task graph creation, phase ordering, dependency enforcement |
| Research + planning first | Tasks needing context gathering before implementation |
| Contract-first multi-domain | Backend + frontend work needing shared API contracts |
| Blocked/unroutable tasks | Clean `STATUS: BLOCKED` with missing signal report |

### Avoid Domains

| Domain | Why |
|--------|-----|
| Direct implementation | `write` and `edit` tools are denied at runtime |
| Code debugging | Delegate to Hephaestus or specialist agents |
| Security audit | Delegate to security-architect |
| QA / test writing | Delegate to qa-test-engineer |
| Prompt engineering | Delegate to Prometheus |
| API contract authoring | Delegate to api-contract-manager or database-specialist |
| Documentation writing | Delegate to technical-writer-documentarian |
| UI implementation | Delegate to nextjs-ui-wizard, flutter-dart-master, etc. |
| Single-file trivial edits | Delegate (use tiny safe bridging fix only in narrow exceptions) |

## use_when / avoid_when

### use_when

Use Hecateq God (hecateq-orchestrator) as the orchestrator when:

- `routing_signal == "task_decomposition"` — multi-step work needing dependency ordering
- `routing_signal == "agent_selection"` — custom agent registry is populated
- `routing_signal == "multi_domain"` — work spans backend + frontend + docs + testing
- `routing_signal == "execution_planning"` — need task graph before delegation
- `routing_signal == "blocked_routing"` — need to report missing agents/signals
- `routing_signal == "contract_first"` — shared contract must exist before downstream work
- `routing_signal == "mixed_risk"` — task contains both low-risk and high-risk substeps
- `context.get("has_hecateq_orchestration") === true` — Hecateq orchestration pipeline is active

### avoid_when

Avoid Hecateq God when:

- `routing_signal == "direct_implementation"` — single-domain, single-file change with clear owner — delegate directly
- `routing_signal == "quick_fix"` — one-file bugfix with obvious fix — delegate to specialist
- `routing_signal == "read_only_review"` — code review or analysis only — delegate to oracle
- `routing_signal == "research_only"` — documentation lookup or code search — delegate to explore/librarian
- `routing_signal == "security_maintenance"` — dependency update or security patch — delegate to security-architect
- `context.get("sisyphus_is_orchestrating") === true` — Sisyphus is already handling orchestration

## Integration Points

Hecateq God consumes these Hecateq orchestration features:

| Integration | Module | Exports Used |
|-------------|--------|-------------|
| Orchestration pipeline | `src/features/hecateq-orchestration/orchestration-controller.ts` | `buildOrchestrationContextBlock()`, `runOrchestrationPipeline()`, `isSensitiveTask()` |
| Prompt intake | `src/features/hecateq-orchestration/prompt-intake.ts` | `analyzePrompt()` — intent classification used by policy |
| Task decomposition | `src/features/hecateq-orchestration/task-decomposer.ts` | `decomposePrompt()` — splits prompt into task nodes |
| Agent selection | `src/features/hecateq-orchestration/agent-selector.ts` | `selectAgents()`, `readLocalAgentRegistry()` |
| Routing policy engine | `src/features/hecateq-orchestration/routing-policy-engine.ts` | `decideRouting()` — decision kind extraction |
| Handoff system | `src/features/hecateq-orchestration/runtime-handoff-service.ts` | `extractHandoffFromAgentResponse()`, `processHandoffInAgentResponse()` |
| Delegation controller | `src/features/hecateq-orchestration/delegation-controller.ts` | `processHandoffsToDelegation()` — converts handoff blocks to delegation requests |
| Decomposition planner | `src/features/hecateq-orchestration/execution-planner.ts` | `buildExecutionPlan()` |
| Dependency planner | `src/features/hecateq-orchestration/dependency-planner.ts` | `buildDependencyPlan()` |
| OMO state manager | `src/features/hecateq-orchestration/omo-state-manager.ts` | `OmoStateManager` — session state persistence |
| Handoff parser | `src/features/hecateq-orchestration/handoff-parser.ts` | `parseHandoffBlock()`, `getKnownAgentIds()` |
| Signal registry | `src/features/hecateq-orchestration/signal-registry.ts` | `KNOWN_SIGNALS` — DAG signal definitions |
| Handoff role policy | `src/features/hecateq-orchestration/handoff-role-policy.ts` | `validateHandoffTargetByRole()` |
| Signal DAG executor | `src/features/hecateq-orchestration/signal-dag-executor.ts` | `signalDagTick()`, `deriveDynamicTasks()` |
| Cycle detector | `src/features/hecateq-orchestration/cycle-detector.ts` | `DelegationCycleDetector` |
| OMO migration | `src/features/hecateq-orchestration/omo-migration.ts` | `runAllMigrations()` |
| Handoff boulder projection | `src/features/hecateq-orchestration/handoff-boulder-projection.ts` | Persists handoff state into boulder |
| Handoff context injection | `src/features/hecateq-orchestration/handoff-context-injection.ts` | Context injection for downstream agents |
| Execution adapter | `src/features/hecateq-orchestration/execution-adapter.ts` | `createBatchExecutorFromAdapter()` — execution gate |
| Policy config | `src/shared/hecateq-orchestrator-policy.ts` | `HecateqOrchestratorConfig`, `isDelegationFirst()`, `shouldDenyWriteTools()`, `maySelfImplement()`, `HecateqTaskClassification` |

## Tool Restrictions

The following tools are denied at runtime for Hecateq God:

| Tool | Reason |
|------|--------|
| `write` | Orchestrator-only by design -- file creation must go through delegated agents |
| `edit` | Orchestrator-only by design -- code modification must go through delegated agents |
| `call_omo_agent` | Use `task(subagent_type="explore", ...)` or `task(subagent_type="librarian", ...)` instead |

Policy text (from `HECATEQ_ORCHESTRATOR_POLICY`):

> The `write` and `edit` tools are denied at runtime for orchestrator agents. Use `task(subagent_type="...", ...)` delegation for any file creation or code modification. Hecateq God is orchestrator-only by default -- do not attempt to use tools that are denied.

The tool denial is enforced at two levels:

1. **Config level:** `shouldDenyWriteTools()` in `src/shared/hecateq-orchestrator-policy.ts` returns `true` by default (when `delegation_first !== false` and `deny_write_tools !== false`)
2. **Prompt level:** The system prompt explicitly states the denial and instructs the agent not to attempt using these tools

The only sanctioned delegation primitive is:
- `task(subagent_type="<exact-agent-name>", ...)` for exact agent delegation

Category routing (`task(category="...")`) is permanently disabled (`disable_category_routing: true`). The `category-examples-audit.test.ts` regression guard scans all source files in this directory for any `task(category=` pattern and fails the test if one is found.

## Tiny Safe Bridging Fix Gate

Hecateq God may self-implement (edit files directly) only when ALL of the following conditions are met:

| Condition | Description |
|-----------|-------------|
| 1. Localized | Change is limited to one file or one tiny closely-related edit surface |
| 2. Low risk | Does not alter architecture, contracts, domain logic, or cross-module behavior |
| 3. Obvious verification | Expected result is obvious and cheap to verify |
| 4. No specialist needed | No specialist ownership is materially needed |
| 5. Overhead exceeds value | Delegating the work would add more overhead than value |

The code-level equivalent in `src/shared/hecateq-orchestrator-policy.ts`:

```typescript
export function maySelfImplement(
  config: HecateqOrchestratorConfig | undefined,
  task: HecateqTaskClassification,
): boolean {
  if (!isDelegationFirst(config)) return true       // non-delegation config = always allow
  if (task.fileCount > 1) return false               // condition 1
  if (task.affectsArchitecture) return false          // condition 2
  if (task.affectsDomainLogic) return false            // condition 2
  if (task.isHighRisk) return false                   // condition 2
  return !task.specialistExists                       // conditions 4 + 5
}
```

Policy text from `HECATEQ_ORCHESTRATOR_POLICY`:

> Direct edits are allowed only as tiny safe bridging fixes when delegation overhead would be wasteful and domain ownership is still clear.
>
> A tiny safe bridging fix must stay localized, low-risk, and must not replace proper specialist delegation for real implementation work.
>
> If there is any real uncertainty about ownership, scope, side effects, or verification burden, delegate instead of editing directly.

The `delegationFirst` flag can soften this: when `delegationFirst=false`, the policy text changes from "Delegation is the default execution mode. Self-implementation is a narrow exception." to "Delegation is the preferred execution mode. Self-implementation is allowed when ownership is clear and the tiny-fix gate passes." This preserves all hard safety rules (no silent fallback, no unknown agents, no unverified completion claims).
