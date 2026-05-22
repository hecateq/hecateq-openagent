TASK_DEPENDENCY_GRAPH_CONTRACT_IMPLEMENTATION

## Scope

This change is prompt-level policy, artifact convention, test, and report only.
It does not add a runtime scheduler, runtime executor, runtime hook, hard block, config schema, installer change, fallback change, or TUI change.

## What Changed

- Added `TASK DEPENDENCY GRAPH POLICY` to the Hecateq prompt.
- Added `SHARED CONTRACT ARTIFACT POLICY` to the Hecateq prompt.
- Added `.opencode/contracts/` and `.opencode/task-graphs/` artifact conventions to the Hecateq prompt.
- Expanded `INTAKE SUMMARY:` with `contract_required:`, `contract_artifact:`, and `task_graph_required:`.
- Expanded the large-task output contract with `TASK GRAPH:` and `SHARED CONTRACT:`.
- Updated prompt assertion tests.

## Task Dependency Graph Policy

Hecateq is now instructed to build a dependency-aware task graph for medium and large tasks before delegation.

The policy requires these fields:

- `task_id`
- `task_name`
- `domain`
- `owner_agent`
- `depends_on`
- `can_parallelize`
- `required_inputs`
- `expected_outputs`
- `verification`
- `status`

It also states that dependency order comes before parallelism and that downstream implementation should not start before upstream contracts are stable.

## Shared Contract Artifact Policy

Hecateq is now instructed to create or request a shared contract first when backend work affects frontend, admin, or mobile work.

The policy says the contract should include:

- endpoints or data interfaces
- request/response shapes
- domain entities
- validation rules
- error states
- auth/session assumptions
- frontend consumption notes
- test expectations

If a contract cannot be produced yet, the prompt now directs Hecateq to mark the dependency state as blocked or contract-required and request the contract first instead of starting dependent implementation blindly.

## Artifact Paths

Preferred contract path:

- `.opencode/contracts/`

Suggested contract files:

- `.opencode/contracts/current-contract.md`
- `.opencode/contracts/<task-slug>-contract.md`
- `.opencode/contracts/<task-slug>-api-contract.md`

Preferred task graph path:

- `.opencode/task-graphs/`

Suggested task graph files:

- `.opencode/task-graphs/current-task-graph.md`
- `.opencode/task-graphs/<task-slug>-task-graph.md`

## Intake Summary Changes

The existing `INTAKE SUMMARY:` remains and now includes:

- `contract_required:`
- `contract_artifact:`
- `task_graph_required:`

Existing intake fields for memory, git checkpoint, dependency mode, selected agents, execution mode, and risk level remain intact.

## Final Output Contract

For large tasks, Hecateq now includes:

- `STATUS:`
- `INTAKE SUMMARY:`
- `TASK GRAPH:`
- `SHARED CONTRACT:`
- `GIT CHECKPOINT:`
- `MEMORY:`
- `DECISIONS:`
- `ROUTING COVERAGE:`
- `CHANGED FILES:`
- `TESTS:`
- `RISKS:`
- `NEXT STEP:`

The existing `GIT CHECKPOINT:`, `MEMORY:`, and `ROUTING COVERAGE:` sections were preserved.

## Agent Routing Impact

Routing rules remain custom-agent-first.

- Contract generation should go to the most appropriate exact specialist.
- Backend work should go to backend specialists.
- Frontend/admin/mobile work should wait for the contract and then go to the appropriate exact specialist.
- QA/test work should go to QA specialists.
- Security work should go to security specialists.
- Hephaestus remains optional for build/integration supervision, not the default implementation layer.
- Prometheus remains available for spec/plan generation.
- Atlas remains opt-in or large-runner only.
- Category routing remains fallback-only when no exact custom agent exists.

## Project-Root Memory Interaction

The prompt now ties task graph and contract decisions to project-root memory behavior.

- `file-map.md` can reference contract and task graph artifact paths.
- `decisions.md` can summarize important contract/dependency decisions.
- `tasks.md` can summarize task graph state.

The prompt does not require large contract bodies to be embedded inside memory files.
Large artifacts stay under `.opencode/contracts/` and `.opencode/task-graphs/`.

## Git Checkpoint Interaction

The prompt now makes it explicit that contract/task-graph artifacts are file changes.

- Hecateq should evaluate git checkpoint state first.
- If the repo is dirty, it should not blindly checkpoint everything.
- If artifacts were created, they should be reported in `TASK GRAPH:`, `SHARED CONTRACT:`, and `CHANGED FILES:`.

## Prompt-Level vs Runtime Enforcement

This is prompt-level policy, not a runtime scheduler.

Explicit answers:

- This is **not** a runtime scheduler.
- This **is** prompt-level policy.
- No runtime executor, no runtime hook, and no hard runtime block were added.

## Files Changed

- `src/agents/hecateq-orchestrator/default.ts`
- `src/agents/builtin-agents/hecateq-orchestrator-agent.test.ts`
- `src/agents/sisyphus-hecateq-handoff.test.ts`
- `TASK_DEPENDENCY_GRAPH_CONTRACT_IMPLEMENTATION.md`

## Tests Added / Updated

Updated prompt assertions now verify:

- `TASK DEPENDENCY GRAPH POLICY`
- `SHARED CONTRACT ARTIFACT POLICY`
- `.opencode/contracts/`
- `.opencode/task-graphs/`
- `TASK GRAPH:`
- `SHARED CONTRACT:`
- `contract_required:`
- `contract_artifact:`
- `task_graph_required:`
- Sisyphus isolation from Hecateq-only graph/contract policy

## Tests Run

Executed successfully:

1. `bun test src/agents/builtin-agents/hecateq-orchestrator-agent.test.ts src/agents/utils.test.ts src/agents/sisyphus-hecateq-handoff.test.ts`
2. `bun test src/cli/doctor/checks/hecateq-workflow.test.ts src/hooks/hecateq-memory-bootstrap/index.test.ts`
3. `bun test src/tools/delegate-task/category-resolver.test.ts src/tools/delegate-task/zauc-mocks-subagent-resolver/subagent-resolver.test.ts`
4. `bun test src/agents/`

## Behavior Before

- Hecateq already had contract-first hints and dependency-aware phrasing.
- There was no explicit task graph artifact convention.
- There was no explicit shared contract artifact convention.
- Large-task output did not explicitly include `TASK GRAPH:` and `SHARED CONTRACT:`.

## Behavior After

- Hecateq is now explicitly directed to build a dependency-aware task graph.
- Hecateq is now explicitly directed to create or request a shared contract artifact first.
- Artifact paths for task graphs and contracts are now standardized at the prompt level.
- Parallel execution is now conditioned on explicit dependencies, existing shared contract, non-overlapping ownership, and clear outputs.

## Risks

- This is a prompt-only change, so the main risk is instruction drift if future prompt sections are edited independently.
- No runtime enforcement exists yet, so compliance still depends on Hecateq following the prompt.
- The new policy increases prompt length slightly.

## Rollback

Rollback is low-risk:

1. Revert `src/agents/hecateq-orchestrator/default.ts`.
2. Revert the updated prompt assertion tests.
3. Remove `TASK_DEPENDENCY_GRAPH_CONTRACT_IMPLEMENTATION.md`.

No runtime or schema rollback is required.

## Explicit Answers

- Bu runtime scheduler mı, prompt-level policy mi? **Prompt-level policy**.
- Hecateq artık task graph çıkarmaya yönlendiriliyor mu? **Evet**.
- Shared contract artifact path nedir? **`.opencode/contracts/`**.
- `.opencode/contracts/` kullanılıyor mu? **Evet**.
- `.opencode/task-graphs/` kullanılıyor mu? **Evet**.
- Backend/frontend contract-first kuralı güçlendi mi? **Evet**.
- Paralel görevler hangi koşulda başlatılabilir? **Bağımlılıklar explicit ise, shared contract varsa, ownership çakışmıyorsa, expected outputs açıksa**.
- Memory ile ilişkisi nedir? **Artifact path ve kararlar `file-map.md`, `decisions.md`, `tasks.md` içine özetlenebilir; büyük artifact içerikleri memory içine gömülmez**.
- Git checkpoint ile ilişkisi nedir? **Artifact üretimi file change sayılır; önce git checkpoint durumu değerlendirilir, sonra output’ta raporlanır**.
- Sisyphus/Hephaestus etkileniyor mu? **Sisyphus promptuna bu policy enjekte edilmedi; Hephaestus rolü de default implementation layer yapılmadı**.
- Custom agent registry bozuldu mu? **Hayır**.
- Existing doctor/hook tests bozuldu mu? **Hayır, çalıştırılan hedef testler geçti**.
- Hangi testler çalıştı? **Yukarıdaki dört komut**.
