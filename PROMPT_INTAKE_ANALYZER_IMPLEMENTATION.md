PROMPT_INTAKE_ANALYZER_IMPLEMENTATION

## Scope

This change is limited to prompt-level policy, prompt assertions, and documentation inside this fork.
No runtime hard router, prompt parser, task scheduler, config schema, installer behavior, runtime fallback behavior, TUI render behavior, package name, binary name, plugin ID, TUI plugin ID, schema path, or config file name was changed.

## What Changed

- Added a dedicated `PROMPT INTAKE / TASK ANALYZER POLICY` block to the Hecateq Orchestrator prompt.
- Added an `INTAKE SUMMARY` format for medium and large tasks.
- Added explicit `AGENT SELECTION RULES`.
- Added explicit `EXECUTION MODE` values.
- Added explicit `TOKEN EFFICIENCY RULES`.
- Updated the final output contract to include `INTAKE SUMMARY:`.
- Updated prompt assertion tests to verify the new intake policy while preserving existing Hecateq-only behavior.

## Prompt Intake Policy

Hecateq now classifies the user prompt before broad scanning, delegation, editing, or execution.
The prompt-level intake policy covers:

- task size
- domain scope
- context requirement
- git checkpoint requirement
- dependency requirement
- agent routing
- risk level

It also instructs Hecateq not to start broad code scanning when project-root memory, `file-map.md`, README, or architecture docs can narrow scope first.

## Intake Summary Format

For medium and large tasks, Hecateq now emits this prompt-defined structure:

- `task_size:`
- `domain_scope:`
- `context_needed:`
- `memory_required:`
- `git_checkpoint:`
- `dependency_mode:`
- `selected_agents:`
- `execution_mode:`
- `risk_level:`

Small safe tasks are allowed to keep this intake brief.

## Task Classification

The Hecateq prompt now explicitly classifies tasks as:

- `SMALL`
- `MEDIUM`
- `LARGE`

It also distinguishes:

- `single-domain`
- `multi-domain`
- `unknown-domain`

Answer: yes, Hecateq now classifies the user prompt first at the prompt-policy level.

## Execution Modes

The prompt now defines:

- `DIRECT_SMALL_FIX`
- `SINGLE_AGENT_DELEGATION`
- `MULTI_AGENT_SEQUENTIAL`
- `MULTI_AGENT_PARALLEL_AFTER_CONTRACT`
- `ANALYSIS_ONLY`
- `BLOCKED`

These modes are prompt-level routing guidance only. They do not add runtime enforcement.

## Agent Selection Rules

Hecateq now explicitly prefers exact custom agents from `<custom-agent-registry>`.

Rules added:

1. Prefer exact custom agents from `<custom-agent-registry>`.
2. Do not invent agent names.
3. Do not call disabled or unknown agents.
4. Split multi-domain work into subtasks.
5. Respect dependency order.
6. Require shared contract first for backend/frontend/admin/mobile combinations.
7. Use Hephaestus only when build or integration supervision is clearly needed or explicitly requested.
8. Use Prometheus for plan/spec generation when needed.
9. Use Atlas only when explicitly selected or when a large execution runner is required.
10. Use category routing only when no exact custom agent exists.

Answer: exact custom agent selection remains primary.
Answer: category routing remains fallback-only.

## Token Efficiency Rules

The Hecateq prompt now includes:

- Do not read the whole codebase by default.
- Check project-root memory first.
- Check `file-map.md` before broad search.
- Use README, architecture docs, package/config files, route maps, and known entrypoints to narrow scope.
- Prefer targeted grep/glob over full scans.
- Avoid duplicate ownership and duplicate agent work.
- Do not let frontend and backend invent separate contracts.

Answer: yes, a whole-codebase avoidance rule now exists to reduce token waste.
Answer: yes, memory-first narrowing is now explicit.

## Dependency And Contract Handling

The pre-existing dependency-aware routing behavior was preserved.
The new intake policy was positioned before the existing dependency and git sections so it classifies work before those downstream rules apply.

The prompt now explicitly says:

- do not start frontend/admin/mobile implementation before backend/API/shared contract is stable unless an explicit mock contract exists
- do not spawn parallel tasks until dependencies and shared contracts are explicit

Answer: yes, backend/frontend contract-first behavior is preserved and reinforced.

## Final Output Contract

Large-task output now preserves the existing fields and adds:

- `STATUS:`
- `INTAKE SUMMARY:`
- `GIT CHECKPOINT:`
- `MEMORY:`
- `DECISIONS:`
- `ROUTING COVERAGE:`
- `CHANGED FILES:`
- `TESTS:`
- `RISKS:`
- `NEXT STEP:`

Answer: yes, `INTAKE SUMMARY:` was added.
Existing `GIT CHECKPOINT:` and memory-related output expectations were preserved.

## Prompt-Level vs Runtime Enforcement

This is a prompt-level policy change, not a runtime hard router.

Explicit answer:

- This is **prompt-level policy**.
- This is **not** a runtime hard router.
- No runtime parser, runtime router, scheduler, schema flag, or hard blocking enforcement was added.

## Files Changed

- `src/agents/hecateq-orchestrator/default.ts`
- `src/agents/builtin-agents/hecateq-orchestrator-agent.test.ts`
- `src/agents/sisyphus-hecateq-handoff.test.ts`
- `PROMPT_INTAKE_ANALYZER_IMPLEMENTATION.md`

## Tests Added / Updated

Updated prompt assertions to verify:

- `PROMPT INTAKE / TASK ANALYZER POLICY`
- `INTAKE SUMMARY`
- `SMALL`, `MEDIUM`, `LARGE`
- all execution modes
- token efficiency rules
- memory-first guidance
- contract-first guidance
- final output includes `INTAKE SUMMARY:`
- existing project-root memory policy remains
- existing git checkpoint policy remains
- existing custom-agent registry section remains
- existing dependency-aware routing section remains
- Sisyphus prompt still does not receive the Hecateq-only intake policy block

## Tests Run

Executed successfully:

1. `bun test src/agents/builtin-agents/hecateq-orchestrator-agent.test.ts src/agents/utils.test.ts src/agents/sisyphus-hecateq-handoff.test.ts`
2. `bun test src/tools/delegate-task/category-resolver.test.ts src/tools/delegate-task/zauc-mocks-subagent-resolver/subagent-resolver.test.ts src/cli/doctor/checks/hecateq-workflow.test.ts`
3. `bun test src/agents/`

## Behavior Before

- Hecateq already knew custom-agent-first routing, project-root memory policy, git checkpoint policy, and dependency-aware routing.
- Hecateq did not have an explicit prompt intake classifier for task size, domain scope, context need, dependency mode, execution mode, or token-efficiency discipline as a dedicated section.
- Final output did not explicitly require `INTAKE SUMMARY:`.

## Behavior After

- Hecateq now classifies prompts before broad scanning or delegation.
- Hecateq now distinguishes small, medium, and large tasks.
- Hecateq now distinguishes single-domain and multi-domain work.
- Hecateq now considers memory need before broad search.
- Hecateq now considers git checkpoint need during intake.
- Hecateq now exposes explicit execution modes.
- Hecateq now documents token-efficiency and contract-first discipline more clearly.
- Final output now includes `INTAKE SUMMARY:` for large-task reporting.

Explicit answers:

- Hecateq prompt now classifies the user prompt first: **yes**.
- Small/medium/large split exists: **yes**.
- Single-domain/multi-domain split exists: **yes**.
- Memory is checked first at policy level: **yes**.
- Git checkpoint decision is handled during intake: **yes**.
- Backend/frontend contract-first rule is preserved: **yes**.
- Whole-codebase scanning avoidance is present: **yes**.
- Exact custom agent priority remains: **yes**.
- Category routing remains fallback: **yes**.
- `INTAKE SUMMARY:` was added to final output: **yes**.
- Sisyphus and Hephaestus runtime behavior changed: **no**.

## Risks

- The change is prompt-text only, so risk is limited to prompt wording, routing guidance, and test expectations.
- A longer Hecateq prompt slightly increases prompt size.
- If future tests assert exact prompt phrasing elsewhere, they may need synchronization with this new policy block.

## Rollback

Rollback is low risk:

1. Revert `src/agents/hecateq-orchestrator/default.ts`.
2. Revert the updated prompt assertion tests.
3. Remove `PROMPT_INTAKE_ANALYZER_IMPLEMENTATION.md` if needed.

No runtime migration, schema rollback, or config cleanup is required.
