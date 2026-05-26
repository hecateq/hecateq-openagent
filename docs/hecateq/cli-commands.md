# Hecateq OpenAgent — CLI Commands

This document describes all CLI commands provided by Hecateq OpenAgent, including both inherited and Hecateq-specific commands.

---

## Binary Entry Points

The package registers three binary aliases:

```bash
hecateq-openagent <command> [options]
oh-my-opencode <command> [options]      # upstream compatibility
oh-my-openagent <command> [options]     # upstream compatibility
```

All three binaries invoke the same Commander.js program.

---

## Base Commands (Inherited)

### `install`

Interactive or non-interactive setup wizard.

```bash
hecateq-openagent install
hecateq-openagent install --non-interactive
```

Generates provider config, plugin registration, and model settings.

Compatibility alias: `setup`

### `run <message>`

Non-interactive session launcher that runs a prompt and auto-completes when todos are done and no background tasks remain.

```bash
hecateq-openagent run "refactor the user service"
hecateq-openagent run --agent sisyphus "implement auth"
```

Options:
- `--agent <name>` — Override default agent
- `--resume` — Resume previous session
- `--model <id>` — Override model

### `doctor`

4-category health diagnostics.

```bash
hecateq-openagent doctor
hecateq-openagent doctor --verbose
```

Categories:
| Category | Checks |
|----------|--------|
| System | Binary found, OpenCode version >= 1.0.150, plugin registered |
| Config | JSONC validity, Zod schema, model override syntax |
| Tools | AST-Grep, comment-checker, LSP servers, GH CLI, MCP servers |
| Models | Cache exists, model resolution, overrides, availability |

### `version`

Print plugin version.

```bash
hecateq-openagent version
```

### `get-local-version`

Check installed version vs npm latest.

```bash
hecateq-openagent get-local-version
```

### `mcp-oauth`

MCP OAuth 2.0 token management with PKCE + DCR.

```bash
hecateq-openagent mcp-oauth login <server-url>
hecateq-openagent mcp-oauth logout
hecateq-openagent mcp-oauth status
```

### `refresh-model-capabilities`

Refresh the model capabilities cache from models.dev API.

```bash
hecateq-openagent refresh-model-capabilities
```

### `boulder`

Boulder state inspector — format work-state and task progress from `.omo/boulder-state/`.

```bash
hecateq-openagent boulder
```

### `dashboard` / `dashboard serve`

Hecateq orchestration dashboard client and persistent local server.

```bash
# Start persistent server
hecateq-openagent dashboard serve --port 3245

# Query the running server from another terminal
hecateq-openagent dashboard
hecateq-openagent dashboard --json
hecateq-openagent dashboard --view dag --compact
```

Notes:
- `dashboard serve` starts the HTTP server.
- `dashboard` reads from the running server and renders summary, DAG, spawn, or signal views.
- Current test coverage for dashboard is not fully green in this fork; treat it as beta.

---

## Hecateq Commands (Experimental)

These commands are routed through the `hecateq` subcommand namespace and implement the Hecateq orchestration workflow. Source: `src/cli/hecateq/`.

### `hecateq plan <prompt>`

Runs the full pre-execution pipeline without executing anything. Outputs a structured plan report.

```bash
hecateq-openagent hecateq plan "add email validation to user registration"
hecateq-openagent hecateq plan --json "refactor database layer"
```

**Pipeline stages:**
1. Prompt intake — classify intent, risk level, task size, domains
2. Task decomposition — split prompt into atomic task nodes
3. Sensitive task blocking — block tasks targeting `.env`, secrets, keys
4. Dependency plan — build DAG with cycle detection, batch planning
5. Agent selection — match tasks to agents from local AGENTS.md registry
6. Execution plan — order batches, inject contract/plan/verification stages

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--json` | boolean | false | JSON output |
| `--config` | string | — | Config overrides (JSON string) |
| `--agents-dir` | string | `~/.config/opencode/agents` | Local agent registry |
| `--disabled-agents` | string[] | — | Disabled agent names |
| `--project-dir` | string | `cwd` | Project directory |

**Exit codes:**
- `0`: Plan complete, all clear
- `1`: Plan complete with issues (sensitive tasks blocked, cycles detected)
- `2`: High-risk prompt detected, requires `--force`

### `hecateq run <prompt>`

Auto-executes low-risk prompts. Safe-by-default: high-risk or destructive prompts produce plan-only output.

```bash
# Low-risk — executes automatically
hecateq-openagent hecateq run "fix typo in README"

# High-risk — plan only, exits with code 2
hecateq-openagent hecateq run "modify production database schema"

# Force execution of high-risk prompt
hecateq-openagent hecateq run --force "modify production database schema"

# Dry run (plan + simulate)
hecateq-openagent hecateq run --dry-run "implement user service"
```

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--force` | boolean | false | Override high-risk block |
| `--dry-run` | boolean | false | Plan + simulate, no real execution |
| `--json` | boolean | false | JSON output |
| `--config` | string | — | Config overrides |
| `--session-id` | string | — | Attach to existing session |
| `--port` | number | — | OpenCode port |
| `--attach` | string | — | Attach mode |
| `--agents-dir` | string | `~/.config/opencode/agents` | Agent registry directory |
| `--disabled-agents` | string[] | — | Disabled agents |
| `--project-dir` | string | `cwd` | Project directory |

### `hecateq resume [--session-id <id>]`

Recovers unfinished orchestration sessions. Lists available sessions when no ID is given.

```bash
# List available sessions
hecateq-openagent hecateq resume

# Resume specific session
hecateq-openagent hecateq resume --session-id ses_abc123

# Dry-run resume
hecateq-openagent hecateq resume --session-id ses_abc123 --dry-run
```

**Behavior:**
- Marks stale `in_progress` tasks as failed
- Marks pending tasks with failed dependencies as blocked
- Continues execution if pending tasks remain

### `hecateq status`

Summarizes orchestration state for the current project directory.

```bash
hecateq-openagent hecateq status
hecateq-openagent hecateq status --json
```

**Output sections:**
- Orchestration — session count, recent sessions with phase/prompt/status
- Memory — initialized flag, file count, file names
- Contracts — directory exists flag, file count
- Task Graphs — directory exists flag, file count

### `hecateq doctor`

Runs 11 categories of Hecateq-specific workflow diagnostics.

```bash
hecateq-openagent hecateq doctor
hecateq-openagent hecateq doctor --verbose
hecateq-openagent hecateq doctor --json
```

**Check categories:**

| Category | What It Validates |
|----------|-------------------|
| Agent Registration | Hecateq agent entries in OpenCode agent config |
| Configuration | Hecateq config block validity |
| Orchestration | `.opencode/orchestration/` directory and session files |
| Safety Hooks | Required hooks (hecateq-memory-bootstrap, hecateq-project-context-injector) |
| Handoff State | Handoff file presence and parseability |
| Role Policy | Handoff role policy consistency |
| Project Memory | Memory directory, manifest, file quality (no empty files) |
| Memory Manifest | Manifest version freshness, pointer validity |
| Custom Agents | Custom agent definitions in `.opencode/agents/` |
| Agent Index | Agent index freshness (not stale) |
| Artifacts | Artifact directory structure |

---

## CLI Source Files

| File | Command |
|------|---------|
| `src/cli/cli-program.ts` | Commander.js program setup |
| `src/cli/index.ts` | CLI entry point |
| `src/cli/install.ts` | install command |
| `src/cli/run/runner.ts` | run command orchestration |
| `src/cli/doctor/runner.ts` | doctor command |
| `src/cli/boulder/` | boulder command |
| `src/cli/get-local-version/` | get-local-version command |
| `src/cli/mcp-oauth/` | mcp-oauth command |
| `src/cli/refresh-model-capabilities.ts` | refresh-model-capabilities command |
| `src/cli/hecateq/plan.ts` | hecateq plan |
| `src/cli/hecateq/run.ts` | hecateq run |
| `src/cli/hecateq/resume.ts` | hecateq resume |
| `src/cli/hecateq/status.ts` | hecateq status |
| `src/cli/hecateq/doctor.ts` | hecateq doctor |
| `src/cli/hecateq/runtime-adapter.ts` | OpenCode session adapter |
| `src/cli/hecateq/shared.ts` | Shared CLI utilities |
