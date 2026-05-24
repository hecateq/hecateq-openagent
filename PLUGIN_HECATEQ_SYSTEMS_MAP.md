# PLUGIN_HECATEQ_SYSTEMS_MAP

## Scope

This report isolates the Hecateq-specific surfaces present in the checked-out fork: agent, config, doctor, memory bootstrap, context injection, git checkpointing, agent indexing, command template support, and routing language. It describes what is clearly implemented in code versus what remains prompt-level or advisory.

## Hecateq God Agent

### Files

- `src/agents/hecateq-orchestrator/agent.ts`
- `src/agents/hecateq-orchestrator/default.ts`
- `src/agents/builtin-agents/hecateq-orchestrator-agent.ts`
- `src/shared/agent-display-names.ts`

### What it is

`hecateq-orchestrator` is a built-in agent key whose display name is `Hecateq God`.

### What it can clearly do now

- exist as a first-class built-in agent
- receive Hecateq-only context injection by default
- operate with explicit routing policy text around exact agents versus category fallback
- receive custom agent summaries/registry information during prompt construction

### What is still partly prompt-level

- “custom-agent-first” orchestration semantics
- blocking silent fallback language
- handoff and contract discipline language

The policy is strong, but it does not by itself prove that every runtime call path shares a single deterministic implementation.

## Hecateq Config Mode

### Files

- `src/config/schema/hecateq.ts`
- `src/config/schema/oh-my-opencode-config.ts`

### Root section

`pluginConfig.hecateq` contains:

- `enabled`
- `context_injection`
- `agent_index`
- `memory_bootstrap`
- `doctor`
- `git_checkpoint`

### Default posture

All top-level Hecateq subsystems default to enabled, but most of them are conservative by behavior. Examples:

- context injection defaults to `compact`
- Hecateq-only injection defaults to `true`
- inject on subagents defaults to `false`
- git checkpoint mode defaults to `suggest`

## Project Memory Bootstrap

### Files

- `src/hooks/hecateq-memory-bootstrap/index.ts`
- `src/shared/memory-bootstrap.ts`

### Problem it solves

Creates predictable project-root memory/artifact scaffolding so later Hecateq systems have somewhere to read/write context.

### Runtime behavior

- first non-subagent session create event triggers bootstrap
- creates memory files and artifact directories if absent
- never overwrites existing files

### Config

- `hecateq.memory_bootstrap.enabled`
- `hecateq.memory_bootstrap.create_memory_files`
- `hecateq.memory_bootstrap.create_artifact_dirs`

### Risks

- low runtime risk
- medium repo-noise risk because it creates files/directories in project root scope

### Tests

- `src/hooks/hecateq-memory-bootstrap/index.test.ts`

## Artifact Bootstrap

Artifact bootstrap is part of `src/shared/memory-bootstrap.ts`, not a separate subsystem.

Created directories include:

- `.opencode/contracts/`
- `.opencode/task-graphs/`

These are then consumed by context injection and doctor checks.

## Project Context Injector

### Files

- `src/hooks/hecateq-project-context-injector/index.ts`
- `src/config/schema/hecateq.ts`
- `src/shared/hecateq-agent-indexer.ts`
- `src/shared/git-checkpoint.ts`

### Problem it solves

Provides project-root memory and structure to Hecateq orchestration without requiring the user to manually feed every file each turn.

### Runtime behavior

- injects on chat-message path
- supports `compact`, `expanded`, or `off`
- can summarize memory files, contracts, task graphs, agent index, and git state

### Config

- `enabled`
- `mode`
- `max_memory_file_chars`
- `max_total_chars`
- `max_artifact_files`
- `include_contracts`
- `include_task_graphs`
- `include_agent_index`
- `max_agent_domains`
- `max_agents_per_domain`
- `inject_on_subagents`
- `hecateq_only`

### Risks

- token-budget pressure
- prompt bias/precedence ambiguity if combined with other context injectors

### Tests

- `src/hooks/hecateq-project-context-injector/index.test.ts`

## Compact Mode

Compact mode is the default Hecateq context-injection mode. It is a token-optimization system rather than a separate runtime engine.

What it clearly reduces:

- memory file payload size via per-file char caps
- total injected chars via `max_total_chars`
- artifact chatter via `max_artifact_files`
- agent-index verbosity via `max_agent_domains` and `max_agents_per_domain`

What remains a token risk:

- stacking with other injected contexts and rules
- expanded mode usage
- large artifact ecosystems even after truncation

## Git Checkpoint Helper

### Files

- `src/shared/git-checkpoint.ts`
- `src/config/schema/hecateq.ts`

### Problem it solves

Provides structured awareness of dirty/clean repo state and optional checkpoint suggestions before Hecateq work.

### Runtime behavior

- detects git repository state
- can include status/dirty counts in injected context
- defaults to suggestion mode, not auto-commit mode

### Config

- `enabled`
- `mode` = `suggest | auto_clean_only | off`
- `auto_checkpoint_clean_repo`
- `checkpoint_message`
- `include_status_in_context`
- `include_dirty_file_list`
- `include_dirty_file_count`
- `max_dirty_files`
- `block_destructive_git`

### Risk notes

- there is no evidence here of unconditional dirty-repo auto-commit behavior
- destructive git blocking depends on runtime helpers/hooks/config, so it is not purely hardwired everywhere

## Agent Index Slash Command

### Files

- `src/features/builtin-commands/commands.ts`
- `src/features/builtin-commands/templates/hecateq-agent-index.ts`

### Behavior

The built-in command `hecateq-agent-index` is registered in `commands.ts` and uses a dedicated template. Its role is generation of the Hecateq global custom-agent capability index.

## Agent Index Quality Upgrade

The checked-out working tree strongly suggests active work on agent-index quality and runtime enrichment because untracked/modified files include:

- `HECATEQ_AGENT_INDEX_QUALITY_UPGRADE.md`
- `HECATEQ_AGENT_INDEX_RUNTIME_ENRICHMENT.md`
- `HECATEQ_AGENT_INDEX_SUMMARY_INJECTION.md`
- `src/shared/hecateq-agent-indexer.ts`

That indicates the subsystem is a current fork priority rather than a finished/closed feature.

## Agent Index Summary Injection

The summary path is implemented through the project context injector, not through direct runtime replacement of agent registration. This matters because it shows the index is currently used as contextual intelligence, not just as a CLI/export artifact.

## Runtime-Aligned Delegation Wording

Modified/untracked workspace artifacts also indicate explicit effort to align prompt wording with runtime constraints, for example:

- `HECATEQ_GOD_RUNTIME_ALIGNED_DELEGATION_WORDING.md`
- changes in `src/agents/hecateq-orchestrator/default.ts`
- changes around `src/tools/delegate-task/subagent-resolver.ts`

This is a sign that the fork is trying to reduce the gap between what the orchestrator says and what the runtime can actually guarantee.

## Task Graph / Contract Policy

The memory bootstrap and context injector together establish task graph and contract directories as first-class Hecateq artifacts. These are then validated by doctor and optionally summarized into prompt context.

This means task-graph/contract policy is currently implemented as:

- filesystem convention
- bootstrap helper
- context injector summary path
- doctor validation path

It is not yet evidence of a full standalone task-graph execution engine.

## Doctor Integration

`src/cli/doctor/checks/hecateq-workflow.ts` is the control-plane validation surface for Hecateq additions. It checks:

- Hecateq config shape
- project memory presence
- artifact directories
- custom agent definitions
- safety hooks
- agent index
- secret leakage patterns

This is one of the clearest signs that Hecateq is integrated as an operational subsystem, not just a prompt theme.

## Current Behavior Chain

The current Hecateq behavior chain is best understood as:

1. config enables Hecateq features
2. memory bootstrap creates persistent project scaffolding
3. agent index can be generated/read for enrichment
4. project context injector feeds compact/expanded summaries to Hecateq agent flows
5. Hecateq orchestrator policy steers exact-agent-first behavior
6. delegate-task/subagent discovery performs actual runtime resolution
7. doctor validates the Hecateq workflow surface

## Known Limits

- the agent index is not proven to be the sole runtime routing truth
- several Hecateq guarantees are still distributed across prompt policy and resolver logic rather than enforced in one place
- the repository is actively changing in this area, so some implementation docs are ahead of or behind checked-in code

## Recommended Next Steps

1. Add a first-party doc or code comment declaring whether agent index is advisory, mandatory, or hybrid for runtime routing.
2. Collapse exact-agent validation rules into a single documented resolver contract.
3. Add explicit tests around stale/missing agent index versus exact runtime delegation behavior.
4. Keep doctor, config schema, and prompt policy versioned together to reduce fork drift.
5. Decide whether task-graph/contracts should remain artifact conventions or evolve into executable planning primitives.

### Verification note

No tests run because this was documentation-only analysis.
