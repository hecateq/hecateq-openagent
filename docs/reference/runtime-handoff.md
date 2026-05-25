# Hecateq Runtime Handoff

**Status:** Wave 5 live, stretch features partially landed
**Last updated:** 2026-05-25

---

## 1. Handoff Block Format

Agents signal handoff intent by emitting a three-line block anywhere in their text response:

```
STATUS: [DONE | IN_PROGRESS | BLOCKED]
SIGNALS_EMITTED: [{"signal":"<name>","payload":{}}]
HANDOFF: [return_to_caller | return_to_parent_for_routing | <agent-id>]
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `STATUS` | `DONE \| IN_PROGRESS \| BLOCKED` | Yes | Agent's completion state |
| `SIGNALS_EMITTED` | JSON array of `{signal, payload}` | No | DAG signals for downstream agents (see [Delegation Akisi](AGENTS.md#delegasyon-akisi)) |
| `HANDOFF` | `string` | Yes | Routing target: `return_to_caller`, `return_to_parent_for_routing`, or a concrete agent ID |

Types defined in `src/features/hecateq-orchestration/handoff-parser.ts`:

```typescript
type HandoffStatus = "DONE" | "IN_PROGRESS" | "BLOCKED"
type HandoffTarget = "return_to_caller" | "return_to_parent_for_routing" | (string & {})
```

---

## 2. What Is Live Today

### 2.1 Parser (`handoff-parser.ts`)

- Parses `STATUS`, `SIGNALS_EMITTED`, `HANDOFF` from any text block.
- Never throws. Malformed input produces `validationIssues` array (severity `error` or `warning`).
- Unknown lines are silently ignored.
- Last occurrence wins for duplicate fields.
- `getKnownAgentIds()` returns the known agent list for target validation.

**File:** `src/features/hecateq-orchestration/handoff-parser.ts`

### 2.2 Sync Delegated Execution Wiring

Both sync task paths extract handoff at response time:

- **`sync-task.ts`** — line 329: `processHandoffInAgentResponse(result.textContent, ...)`
- **`sync-continuation.ts`** — line 228: `processHandoffInAgentResponse(result.textContent, ...)`

**Files:**
- `src/tools/delegate-task/sync-task.ts`
- `src/tools/delegate-task/sync-continuation.ts`

### 2.3 Background Handoff Ingestion (Wave 2)

`ingestHandoffFromBackgroundTask()` extracts handoff metadata from a completed background task's last assistant message and persists it through the same `processHandoffInAgentResponse()` path used by sync tasks.

Called from `BackgroundManager.tryCompleteTask()` (line 2384-2388) using cached output text to avoid an extra `session.messages()` fetch. Best-effort — never blocks task completion, never throws.

A `createSessionMessageTextFetcher()` factory wraps the OpenCode SDK `session.messages()` API to retrieve the last assistant text for manual ingestion outside the auto-wired path.

**Files:**
- `src/features/background-agent/background-handoff-ingestor.ts`
- `src/features/background-agent/background-handoff-ingestor.test.ts`

### 2.4 Boulder Persistence

`persistHandoffToBoulderSession()` writes handoff metadata into `BoulderState.task_sessions["__handoff__"]` for the active work. The key `__handoff__` is not in the package's `RESERVED_KEYS` set, so `upsertTaskSessionStateForWork` accepts it.

Storage format is a JSON string in the `task_title` field:

```json
{"status":"DONE","target":"return_to_caller","signalCount":1,"signalNames":["schema_ready"]}
```

A standalone file-based projection also exists (`handoff-boulder-projection.ts`) which writes `<boulderDir>/handoff/<workId>.json` — this is a secondary read path.

**Files:**
- `src/features/hecateq-orchestration/runtime-handoff-service.ts` (`persistHandoffToBoulderSession`)
- `src/features/hecateq-orchestration/handoff-boulder-projection.ts` (file-based projection)

### 2.5 Run-Continuation Marker Persistence

`persistHandoffToContinuationMarker()` writes handoff metadata into the run-continuation marker's `sources["background-task"]` reason field. This makes handoff state durable across agent sessions and discoverable by doctor checks.

**File:** `src/features/hecateq-orchestration/runtime-handoff-service.ts` (`persistHandoffToContinuationMarker`)

### 2.6 Hecateq Context Injection Summary

`buildLiveHandoffContextSummary()` checks two sources (run-continuation marker first, Boulder state second) and produces a compact `<hecateq-handoff-state>` XML block. This block is injected into the session context by the `hecateq-project-context-injector` hook.

Injection produces a line like:

```
Handoff: status=DONE | target=return_to_caller | signals=1(schema_ready)
```

**Files:**
- `src/features/hecateq-orchestration/runtime-handoff-service.ts` (`buildLiveHandoffContextSummary`)
- `src/features/hecateq-orchestration/handoff-context-injection.ts` (`buildHandoffContextSummary`)
- `src/hooks/hecateq-project-context-injector/index.ts` (line 680-683)

### 2.7 Doctor Handoff Checks

The Hecateq workflow doctor check runs two handoff-related scanners:

**`collectHandoffStateIssues()`** scans `.omo/run-continuation/` for marker files with handoff-associated reason data. It detects:

- **Invalid handoff markers** — JSON parse failure in the `reason` field.
- **Stale handoff state** — handoff active for more than 24 hours (configurable via `STALE_THRESHOLD_MS`).

**`collectHandoffRolePolicyIssues()`** (Wave 3) validates agent role classifications against the handoff role policy (`handoff-role-policy.ts`). It detects:

- **Unclassified agents** — known agents missing a role mapping.
- **Orphaned role entries** — role entries referencing agents that no longer exist.
- Reports role distribution statistics (orchestrator, implementer, architect-builder, reviewer-auditor, docs-research).

**File:** `src/cli/doctor/checks/hecateq-workflow.ts` (`collectHandoffStateIssues`, lines 980-1056; `collectHandoffRolePolicyIssues`, delegated to `handoff-role-policy.ts`)

### 2.8 End-to-End Processing

`processHandoffInAgentResponse()` combines extraction + persistence into a single call:

1. Extracts handoff metadata via `extractHandoffFromAgentResponse()` (wraps the parser)
2. Persists to run-continuation marker
3. Persists to Boulder state if an active work exists

Returns the parsed `HandoffBlock` or null. Best-effort — never throws.

**File:** `src/features/hecateq-orchestration/runtime-handoff-service.ts` (`processHandoffInAgentResponse`)

### 2.9 Routing Policy Engine (Wave 2)

`decideRouting()` classifies a parsed `HandoffBlock` into one of five structural decisions:

| Decision Kind | When It Fires |
|--------------|---------------|
| `return_to_caller` | Target is `"return_to_caller"` or matches a known agent ID |
| `return_to_parent_for_routing` | Target is `"return_to_parent_for_routing"` |
| `invalid_target_blocked` | Target is valid but status is `BLOCKED` |
| `no_handoff_data` | No handoff metadata present, or no target specified |
| `unknown_target_fallback` | Target is not a known agent ID or routing directive |

`decideRoutingFromTaskHandoff()` is a convenience wrapper that constructs a synthetic `HandoffBlock` from `TaskExecutionResult.handoffData`. `isUserVisibleDecision()` identifies decisions that should surface to the parent session. `isTerminalDecision()` identifies terminal states where no further routing can occur.

This is a pure decision engine — it evaluates targets but does NOT auto-spawn or re-dispatch agents.

**Files:**
- `src/features/hecateq-orchestration/routing-policy-engine.ts`
- `src/features/hecateq-orchestration/routing-policy-engine.test.ts`

### 2.10 Routing Decision Recording (Wave 2)

`consumeHandoffAndRecordRouting()` iterates over `TaskExecutionResult[]`, calls `decideRoutingFromTaskHandoff()` for each entry that carries handoff metadata, and persists the resulting `RoutingDecision` into `.omo/hecateq/state.json` via `OmoStateManager.recordRoutingDecision()`. This is additive to the existing Boulder + continuation-marker persistence.

History is capped at 50 entries (`HECATEQ_ROUTING_HISTORY_MAX`), auto-pruned from the oldest.

**Files:**
- `src/features/hecateq-orchestration/orchestration-controller.ts` (`consumeHandoffAndRecordRouting`)
- `src/features/hecateq-orchestration/omo-state-manager.ts` (`recordRoutingDecision`)

### 2.11 Signal Registry (Wave 1 Foundation)

`KNOWN_SIGNALS` enumerates all 9 DAG signals from the agent handoff protocol:

| Signal | Emitter(s) | Primary Consumers |
|--------|-----------|-------------------|
| `schema_ready` | database-specialist | backend developers |
| `backend_ready` | backend developers | qa, security, performance |
| `ui_specs_ready` | design-translator, ux-motion-designer | ui wizard, flutter, qa |
| `auth_audit_passed` | security-architect | backend, release-manager |
| `infra_provisioned` | coolify-devops-specialist, devops-engineer | backend, release-manager |
| `pipeline_secured` | devsecops-pipeline-architect | release-manager, coolify |
| `tests_passed` | qa-test-engineer | release-manager, developers |
| `performance_verified` | performance-specialist | release-manager, qa |
| `compliance_signed` | compliance-specialist | release-manager, security |

Lookup helpers: `getSignalDefinition()`, `getSignalsEmittedBy()`, `getSignalsConsumedBy()`, `isKnownSignal()`.

**Files:**
- `src/features/hecateq-orchestration/signal-registry.ts`
- `src/features/hecateq-orchestration/hecateq-signal-registry.test.ts`

### 2.12 OmoStateManager (Wave 1 Foundation + Wave 5 Spawn State)

`OmoStateManager` provides typed read/write access to `.omo/hecateq/state.json` — the canonical runtime state file for the Hecateq handoff system. Sections:

- **handoff**: active handoff + history (max 20 entries)
- **signal_registry**: pending + consumed signals (pending max 100, consumed max 200)
- **routing**: active target, queue, decision history (max 50)
- **delegation**: pending + consumed delegation requests, routing depth
- **spawn**: active spawn sessions + terminal spawn history (Wave 5 stage 1)
- **migrations**: which migrations have been applied

Key methods: `recordHandoff()`, `emitSignal()`, `consumeSignal()`, `recordRoutingDecision()`, `recordPendingDelegation()`, `recordSpawnStart()`, `recordSpawnComplete()`, `markMigrationComplete()`. Construction requires a `projectRoot` path. All methods are best-effort — never throw.

**Files:**
- `src/features/hecateq-orchestration/omo-state-manager.ts`
- `src/features/hecateq-orchestration/omo-state-manager.test.ts`

---

### 2.13 Auto-Spawn Foundation and Config-Driven Chain Depth (Wave 5 Stage 1-2)

`runOrchestrationPipeline()` now has a caller-gated auto-spawn foundation:

- `delegationExecutor` remains the canonical execution surface.
- `autoSpawnConfig` can gate spawn-state recording and spawn-capacity checks inside the delegation consumption loop.
- `maxRoutingDepth` can override the old hardcoded depth guard while preserving `HECATEQ_MAX_ROUTING_DEPTH = 3` as the default fallback.
- `hecateq.auto_spawn` and `hecateq.delegation_chain.max_depth` exist in schema/config, but a higher-level runtime caller still needs to thread those values into `runOrchestrationPipeline()` outside test-only paths.

This foundation is now used by the live Hecateq project-context hook path, not just tests. The same shared helper is also used by the orchestration pipeline path.

**Files:**
- `src/features/hecateq-orchestration/orchestration-controller.ts`
- `src/features/hecateq-orchestration/delegation-executor.ts`
- `src/features/hecateq-orchestration/delegation-controller.ts`
- `src/features/hecateq-orchestration/omo-state-manager.ts`
- `src/features/hecateq-orchestration/runtime-delegation-consumer.ts`
- `src/features/autonomous-spawn/`
- `src/config/schema/hecateq.ts`

### 2.14 Production Runtime Consumption Path

The current live production path is:

1. `createSessionHooks()` threads `hecateq.context_injection`, `hecateq.orchestration`, `hecateq.auto_spawn`, and `hecateq.delegation_chain` into the Hecateq hook.
2. `createHecateqProjectContextInjectorHook()` injects project/orchestration context on `chat.message`.
3. When auto-spawn is enabled, the same hook also calls `consumeDelegationsAtRuntime()`.
4. `consumeDelegationsAtRuntime()` executes pending delegations, applies rate/depth/fan-out guards, records spawn state, consumes signals, and can trigger downstream DAG work.

This keeps the live runtime on a single canonical execution surface.

### 2.15 Static + Dynamic Signal-DAG Execution

The runtime now supports two bounded DAG behaviors:

- **Static DAG triggering:** tasks with `requiredSignals` become eligible when all required signals are consumed.
- **Dynamic DAG node derivation:** completed task results with handoff targets and emitted signals can derive bounded runtime DAG nodes that re-enter the same guarded delegation path.
- **Planner mutations:** completed task results can optionally carry structured `dagMutations` blocks that propose bounded node/edge additions on the same runtime graph.

Current protections:

- Full N-hop delegation cycle blocking on the active runtime graph
- DAG re-trigger suppression for already-triggered tasks in the same run
- Max depth, max fan-out, per-run iteration cap, and spawn rate limiting
- Mutation caps for planner-added nodes and edges

Dynamic DAG state is persisted in `.omo/hecateq/state.json` under:

- `dynamic_dag.nodes`
- `dynamic_dag.edges`
- `dynamic_dag.applied_mutations`

Planner mutation semantics in the current slice:

- `dagMutations.addNodes[]` can add multiple guarded runtime task nodes.
- `dagMutations.addEdges[]` can add visual/runtime edges and enrich target-node readiness via signal requirements.
- `dagMutations.removeNodes[]` can remove planner-managed pending dynamic nodes only.
- `dagMutations.removeEdges[]` can remove planner-managed dynamic edges only.
- `dagMutations.rewriteNodes[]` can rewrite bounded mutable fields on planner-managed pending dynamic nodes only.
- Ready checks now consider both `requiredSignals` and `dependsOn` completion.
- Dynamic node status is synchronized from live execution results back into persisted dynamic DAG state.

---

## 3. What Is NOT Live Yet

| Feature | Status | Notes |
|---------|--------|-------|
| **Unconstrained self-modifying DAG planning** | Not implemented | Planner mutations are bounded and validated; there is no free-form unbounded planner loop |
| **Broad destructive graph rewrites** | Not implemented | Current planner mutations support bounded dynamic-node delete/rewrite only; static graph/core tasks remain protected |
| **Unsafe dashboard controls** | Not implemented | Dashboard remains read-only in the current slice |

---

## 4. File Paths for Maintainers

| Concern | Path |
|---------|------|
| Types and interfaces | `src/features/hecateq-orchestration/types.ts` (lines 333-341: `TaskExecutionResult.handoffData`) |
| Handoff block parser | `src/features/hecateq-orchestration/handoff-parser.ts` |
| Parser tests | `src/features/hecateq-orchestration/handoff-parser.test.ts` |
| Runtime handoff service | `src/features/hecateq-orchestration/runtime-handoff-service.ts` |
| Service tests | `src/features/hecateq-orchestration/runtime-handoff-service.test.ts` |
| Context injection builder | `src/features/hecateq-orchestration/handoff-context-injection.ts` |
| Context injection tests | `src/features/hecateq-orchestration/handoff-context-injection.test.ts` |
| Handoff role policy | `src/features/hecateq-orchestration/handoff-role-policy.ts` |
| Handoff role policy tests | `src/features/hecateq-orchestration/handoff-role-policy.test.ts` |
| Boulder file projection | `src/features/hecateq-orchestration/handoff-boulder-projection.ts` |
| Boulder projection tests | `src/features/hecateq-orchestration/handoff-boulder-projection.test.ts` |
| Module barrel exports | `src/features/hecateq-orchestration/index.ts` |
| Sync task wiring | `src/tools/delegate-task/sync-task.ts` |
| Sync continuation wiring | `src/tools/delegate-task/sync-continuation.ts` |
| Context injector hook | `src/hooks/hecateq-project-context-injector/index.ts` |
| Doctor handoff checks | `src/cli/doctor/checks/hecateq-workflow.ts` |
| Doctor handoff checks tests | `src/cli/doctor/checks/hecateq-workflow.test.ts` |
| Sisyphus Hecateq handoff prompt | `src/agents/sisyphus-hecateq-handoff.test.ts` |
| Sisyphus prompt assembly | `src/agents/sisyphus.ts` |
| `/handoff` command template | `src/features/builtin-commands/templates/handoff.ts` |
| `/handoff` command registration | `src/features/builtin-commands/commands.ts` |
| Boulder state storage | `src/features/boulder-state/` |
| Run-continuation marker storage | `src/features/run-continuation-state/storage.ts` |
| Background handoff ingestor | `src/features/background-agent/background-handoff-ingestor.ts` |
| Background ingestor tests | `src/features/background-agent/background-handoff-ingestor.test.ts` |
| Routing policy engine | `src/features/hecateq-orchestration/routing-policy-engine.ts` |
| Routing policy engine tests | `src/features/hecateq-orchestration/routing-policy-engine.test.ts` |
| Routing decision recording | `src/features/hecateq-orchestration/orchestration-controller.ts` (`consumeHandoffAndRecordRouting`) |
| OmoStateManager (`.omo/hecateq/`) | `src/features/hecateq-orchestration/omo-state-manager.ts` |
| OmoStateManager tests | `src/features/hecateq-orchestration/omo-state-manager.test.ts` |
| Signal registry | `src/features/hecateq-orchestration/signal-registry.ts` |
| Signal registry tests | `src/features/hecateq-orchestration/hecateq-signal-registry.test.ts` |

---

## 5. Troubleshooting

| Symptom | Likely Cause | Check |
|---------|-------------|-------|
| Handoff block present but `processHandoffInAgentResponse` returns null | Parser heuristic requires at least one meaningful field (status, handoff, or signals) | Verify the block has at least `STATUS:` and `HANDOFF:` lines |
| `__handoff__` entry missing in Boulder state | No active work when handoff was processed | Check `boulderState.active_work_id` at persistence time |
| Doctor reports stale handoff state | Handoff marker older than 24h in `.omo/run-continuation/` | Review the marker file. Clear it if the handoff session is no longer active |
| Doctor reports invalid handoff marker | JSON corruption in the continuation marker reason field | Inspect the marker file, verify valid JSON in `sources["background-task"].reason` |
| Handoff context summary not appearing in session | `hecateq-project-context-injector` hook is disabled or handoff state is empty | Check `disabled_hooks` in config. Verify a marker or Boulder entry exists |
| Duplicate field values in parsed block | Parser uses last-occurrence-wins | Check the agent output for multiple `STATUS:` or `HANDOFF:` lines |
| Handoff not ingested from background task | No cached text in `handoffTextCache` at completion time | Verify `validateSessionHasOutput` ran before completion. Handoff ingestion requires the output text to be fetched first |
| Routing decision not appearing in `.omo/hecateq/state.json` | `consumeHandoffAndRecordRouting` not called for the execution result | Check that `orchestration-controller.ts` processes the `TaskExecutionResult[]` through the routing pipeline |
| Routing decisions accumulating but never acted upon | Auto-routing not yet implemented | Routing decisions are persisted but no runtime agent spawner reads them yet |
