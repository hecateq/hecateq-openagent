import { Command } from "commander"
import { install } from "./install"
import { run } from "./run"
import { getLocalVersion } from "./get-local-version"
import { doctor } from "./doctor"
import { refreshModelCapabilities } from "./refresh-model-capabilities"
import { createMcpOAuthCommand } from "./mcp-oauth"
import { boulder } from "./boulder"
import { dashboard, dashboardServe } from "./dashboard"
import type { DashboardOptions } from "./dashboard"
import type { InstallArgs } from "./types"
import type { RunOptions } from "./run"
import type { GetLocalVersionOptions } from "./get-local-version/types"
import type { DoctorOptions } from "./doctor"
import packageJson from "../../package.json" with { type: "json" }

const VERSION = packageJson.version

const program = new Command()

program
  .name("oh-my-opencode")
  .description("The ultimate OpenCode plugin - multi-model orchestration, LSP tools, and more")
  .version(VERSION, "-v, --version", "Show version number")
  .enablePositionalOptions()

program
  .command("install")
  .alias("setup")
  .description("Install and configure oh-my-opencode with interactive setup")
  .option("--no-tui", "Run in non-interactive mode (requires all options)")
  .option("--claude <value>", "Claude subscription: no, yes, max20")
  .option("--openai <value>", "OpenAI/ChatGPT subscription: no, yes (default: no)")
  .option("--gemini <value>", "Gemini integration: no, yes")
  .option("--copilot <value>", "GitHub Copilot subscription: no, yes")
  .option("--opencode-zen <value>", "OpenCode Zen access: no, yes (default: no)")
  .option("--zai-coding-plan <value>", "Z.ai Coding Plan subscription: no, yes (default: no)")
  .option("--kimi-for-coding <value>", "Kimi For Coding subscription: no, yes (default: no)")
  .option("--opencode-go <value>", "OpenCode Go subscription: no, yes (default: no)")
  .option("--vercel-ai-gateway <value>", "Vercel AI Gateway: no, yes (default: no)")
  .option("--skip-auth", "Skip authentication setup hints")
  .addHelpText("after", `
Examples:
  $ bunx oh-my-opencode install
  $ bunx oh-my-opencode install --no-tui --claude=max20 --openai=yes --gemini=yes --copilot=no
  $ bunx oh-my-opencode install --no-tui --claude=no --gemini=no --copilot=yes --opencode-zen=yes

Model Providers (Priority: Native > Copilot > OpenCode Zen > Z.ai > Kimi > Vercel):
  Claude        Native anthropic/ models (Opus, Sonnet, Haiku)
  OpenAI        Native openai/ models (GPT-5.4 for Oracle)
  Gemini        Native google/ models (Gemini 3.1 Pro, Flash)
  Copilot       github-copilot/ models (fallback)
  OpenCode Zen  opencode/ models (opencode/claude-opus-4-7, etc.)
  Z.ai          zai-coding-plan/glm-5 (visual-engineering fallback)
  Kimi          kimi-for-coding/k2p5 (Sisyphus/Prometheus fallback)
  Vercel        vercel/ models (universal proxy, always last fallback)
`)
  .action(async (options) => {
    const args: InstallArgs = {
      tui: options.tui !== false,
      claude: options.claude,
      openai: options.openai,
      gemini: options.gemini,
      copilot: options.copilot,
      opencodeZen: options.opencodeZen,
      zaiCodingPlan: options.zaiCodingPlan,
      kimiForCoding: options.kimiForCoding,
      opencodeGo: options.opencodeGo,
      vercelAiGateway: options.vercelAiGateway,
      skipAuth: options.skipAuth ?? false,
    }
    const exitCode = await install(args)
    process.exit(exitCode)
  })

program
   .command("run <message>")
   .allowUnknownOption()
   .passThroughOptions()
  .description("Run opencode with todo/background task completion enforcement")
  .option("-a, --agent <name>", "Agent to use (default: from CLI/env/config, fallback: Sisyphus)")
  .option("-m, --model <provider/model>", "Model override (e.g., anthropic/claude-sonnet-4)")
  .option("-d, --directory <path>", "Working directory")
  .option("-p, --port <port>", "Server port (attaches if port already in use)", parseInt)
  .option("--attach <url>", "Attach to existing opencode server URL")
  .option("--on-complete <command>", "Shell command to run after completion")
  .option("--json", "Output structured JSON result to stdout")
  .option("--no-timestamp", "Disable timestamp prefix in run output")
  .option("--verbose", "Show full event stream (default: messages/tools only)")
  .option("--session-id <id>", "Resume existing session instead of creating new one")
  .addHelpText("after", `
Examples:
  $ bunx oh-my-opencode run "Fix the bug in index.ts"
  $ bunx oh-my-opencode run --agent Sisyphus "Implement feature X"
  $ bunx oh-my-opencode run --port 4321 "Fix the bug"
  $ bunx oh-my-opencode run --attach http://127.0.0.1:4321 "Fix the bug"
  $ bunx oh-my-opencode run --json "Fix the bug" | jq .sessionId
  $ bunx oh-my-opencode run --on-complete "notify-send Done" "Fix the bug"
  $ bunx oh-my-opencode run --session-id ses_abc123 "Continue the work"
  $ bunx oh-my-opencode run --model anthropic/claude-sonnet-4 "Fix the bug"
  $ bunx oh-my-opencode run --agent Sisyphus --model openai/gpt-5.5 "Implement feature X"

Agent resolution order:
  1) --agent flag
  2) OPENCODE_DEFAULT_AGENT
  3) oh-my-opencode.json "default_run_agent"
  4) Sisyphus (fallback)

Available core agents:
  Sisyphus, Hephaestus, Prometheus, Atlas

Unlike 'opencode run', this command waits until:
  - All todos are completed or cancelled
  - All child sessions (background tasks) are idle
`)
  .action(async (message: string, options) => {
    if (options.port && options.attach) {
      console.error("Error: --port and --attach are mutually exclusive")
      process.exit(1)
    }
    const runOptions: RunOptions = {
      message,
      agent: options.agent,
      model: options.model,
      directory: options.directory,
      port: options.port,
      attach: options.attach,
      onComplete: options.onComplete,
      json: options.json ?? false,
      timestamp: options.timestamp ?? true,
      verbose: options.verbose ?? false,
      sessionId: options.sessionId,
    }
    const exitCode = await run(runOptions)
    process.exit(exitCode)
  })

program
  .command("get-local-version")
  .description("Show current installed version and check for updates")
  .option("-d, --directory <path>", "Working directory to check config from")
  .option("--json", "Output in JSON format for scripting")
  .addHelpText("after", `
Examples:
  $ bunx oh-my-opencode get-local-version
  $ bunx oh-my-opencode get-local-version --json
  $ bunx oh-my-opencode get-local-version --directory /path/to/project

This command shows:
  - Current installed version
  - Latest available version on npm
  - Whether you're up to date
  - Special modes (local dev, pinned version)
`)
  .action(async (options) => {
    const versionOptions: GetLocalVersionOptions = {
      directory: options.directory,
      json: options.json ?? false,
    }
    const exitCode = await getLocalVersion(versionOptions)
    process.exit(exitCode)
  })

program
  .command("doctor")
  .description("Check oh-my-opencode installation health and diagnose issues")
  .option("--status", "Show compact system dashboard")
  .option("--verbose", "Show detailed diagnostic information")
  .option("--json", "Output results in JSON format")
  .addHelpText("after", `
Examples:
  $ bunx oh-my-opencode doctor            # Show problems only
  $ bunx oh-my-opencode doctor --status   # Compact dashboard
  $ bunx oh-my-opencode doctor --verbose  # Deep diagnostics
  $ bunx oh-my-opencode doctor --json     # JSON output
`)
  .action(async (options) => {
    const mode = options.status ? "status" : options.verbose ? "verbose" : "default"
    const doctorOptions: DoctorOptions = {
      mode,
      json: options.json ?? false,
    }
    const exitCode = await doctor(doctorOptions)
    process.exit(exitCode)
  })

program
  .command("refresh-model-capabilities")
  .description("Refresh the cached models.dev-based model capabilities snapshot")
  .option("-d, --directory <path>", "Working directory to read oh-my-opencode config from")
  .option("--source-url <url>", "Override the models.dev source URL")
  .option("--json", "Output refresh summary as JSON")
  .action(async (options) => {
    const exitCode = await refreshModelCapabilities({
      directory: options.directory,
      sourceUrl: options.sourceUrl,
      json: options.json ?? false,
    })
    process.exit(exitCode)
  })

program
  .command("version")
  .description("Show version information")
  .action(() => {
    console.log(`oh-my-opencode v${VERSION}`)
  })

program
  .command("boulder")
  .description("Show boulder progress, elapsed time, and per-task statistics")
  .option("-d, --directory <path>", "Working directory")
  .option("-w, --work-id <id>", "Filter to a specific work")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const exitCode = await boulder({
      directory: options.directory,
      workId: options.workId,
      json: options.json ?? false,
    })
    process.exit(exitCode)
  })

// ── Dashboard parent command ────────────────────────────────────────────────
// Subcommand: dashboard serve    (persistent server)
// Default:   dashboard [view]    (one-shot or --watch view, with ephemeral auto-start)

const dashboardCmd = program
  .command("dashboard")
  .description("Hecateq orchestration dashboard — views and persistent server")

// ── Subcommand: serve ───────────────────────────────────────────────────────

dashboardCmd
  .command("serve")
  .description("Start a persistent dashboard server on localhost")
  .option("--port <port>", "Server port", (v: string) => Number(v), 3245)
  .option("--host <host>", "Server host", "127.0.0.1")
  .addHelpText("after", `
The server runs until Ctrl+C. While it is running, other terminals can run
  $ oh-my-opencode dashboard [view]
to query the live Hecateq state without starting a new server.

Examples:
  $ oh-my-opencode dashboard serve                        # Port 3245
  $ oh-my-opencode dashboard serve --port 3246            # Custom port
  $ oh-my-opencode dashboard serve --host 0.0.0.0 --port 3245
`)
  .action(async (options) => {
    const exitCode = await dashboardServe({
      host: options.host,
      port: options.port,
    })
    process.exit(exitCode)
  })

// ── Default: view commands ──────────────────────────────────────────────────

dashboardCmd
  .option("--port <port>", "Dashboard server port", (v: string) => Number(v), 3245)
  .option("--host <host>", "Dashboard server host", "127.0.0.1")
  .option("--json", "Output raw JSON for scripting")
  .option("--watch", "Live refresh mode — polls every --interval ms")
  .option("--interval <ms>", "Poll interval in ms for --watch", (v: string) => Number(v), 3000)
  .option("--compact", "Compact display — denser output")
  .option("--graph-id <id>", "Filter DAG by graph ID")
  .option("--status <status>", "Filter DAG nodes by status")
  .option("--agent <name>", "Filter spawns/delegations by agent name")
  .option("--signal <name>", "Filter signals by signal name")
  .argument("[view]", "Dashboard view: summary, dag, signals, delegations, spawns, history, state (default: summary)")
  .addHelpText("after", `
Examples:
  $ oh-my-opencode dashboard                           # Summary view (default)
  $ oh-my-opencode dashboard dag                        # DAG graph view
  $ oh-my-opencode dashboard --watch                    # Live refresh every 3s
  $ oh-my-opencode dashboard --watch --compact          # Live refresh, compact
  $ oh-my-opencode dashboard spawns --agent database    # Filter spawns by agent

Subcommands:
  serve        Start persistent server (see: oh-my-opencode dashboard serve --help)

Views:
  summary      Status overview with key metrics (default)
  dag          DAG execution graph with progress bar, nodes, edges
  signals      Signal registry — known, pending, consumed
  delegations  Delegation chains with depth and timing
  spawns       Active and historical spawn sessions
  history      Orchestration history summary
  state        Full state snapshot

Modes:
  --watch      Live polling — redraws every --interval ms (default: 3000)
               Press Ctrl+C to stop. Auto-starts the dashboard server if needed.
  --compact    Dense single-line entries, no health header, narrow terminal friendly
  --json       Raw JSON for piping into jq

Filters:
  --agent      Filter spawn/delegation views to a specific agent name
  --signal     Filter signal views to a specific signal name
  --graph-id   Filter DAG to a specific graph ID
  --status     Filter DAG nodes by status (pending, in_progress, completed, failed)
`)
  .action(async (view: string | undefined, options) => {
    const exitCode = await dashboard({
      host: options.host,
      port: options.port,
      view: view as DashboardOptions["view"] ?? "summary",
      json: options.json ?? false,
      watch: options.watch ?? false,
      interval: options.interval,
      compact: options.compact ?? false,
      graphId: options.graphId,
      status: options.status,
      agent: options.agent,
      signal: options.signal,
    })
    process.exit(exitCode)
  })

// ─── Hecateq Command Family ────────────────────────────────────────────────

const hecateq = program
  .command("hecateq")
  .description("Hecateq autonomous task orchestration commands")

hecateq
  .command("plan <prompt>")
  .description("Analyze prompt, decompose, build dependency graph, show agent assignments — execute nothing")
  .option("--json", "Output as JSON")
  .option("--project-dir <path>", "Project directory")
  .action(async (prompt: string, options: { json?: boolean; projectDir?: string }) => {
    const { hecateqPlan } = await import("./hecateq/plan")
    const result = await hecateqPlan({
      prompt,
      json: options.json ?? false,
      projectDir: options.projectDir,
    })
    if (options.json) {
      console.log(JSON.stringify({
        prompt: result.prompt,
        intake: { intent: result.intake.intent, taskSize: result.intake.taskSize, riskLevel: result.intake.riskLevel },
        tasks: result.tasks.length,
        batches: result.depPlan.totalBatches,
        sensitiveBlocked: result.sensitiveBlockedCount,
        contractsRequired: result.contractRequiredCount,
        injectedStages: result.injectedNodeCount,
        exactMatches: result.agentSelection.exactMatchCount,
        fallbacks: result.agentSelection.fallbackCount,
        unassigned: result.agentSelection.unassignedTasks.length,
        hasCycle: result.depPlan.cycle.hasCycle,
      }, null, 2))
    }
    process.exit(0)
  })

hecateq
  .command("run <prompt>")
  .description("Auto-run low-risk work, present plan for higher-risk, run quality gates, emit report")
  .option("--force", "Execute even if high-risk prompt detected")
  .option("--dry-run", "Preview execution plan without executing")
  .option("--json", "Output as JSON")
  .option("--project-dir <path>", "Project directory")
  .action(async (prompt: string, options: { force?: boolean; dryRun?: boolean; json?: boolean; projectDir?: string }) => {
    const { hecateqRun } = await import("./hecateq/run")
    const result = await hecateqRun({
      prompt,
      force: options.force ?? false,
      dryRun: options.dryRun ?? false,
      json: options.json ?? false,
      projectDir: options.projectDir,
    })
    if (!options.json) {
      console.log(result.output)
    } else {
      console.log(JSON.stringify({ exitCode: result.exitCode, ...JSON.parse(result.output) }, null, 2))
    }
    process.exit(result.exitCode)
  })

hecateq
  .command("resume")
  .description("Recover unfinished orchestration session, mark stale tasks, continue safely")
  .option("--session-id <id>", "Specific session to resume (lists all if omitted)")
  .option("--dry-run", "Recover state without continuing execution")
  .option("--json", "Output as JSON")
  .option("--project-dir <path>", "Project directory")
  .action(async (options: { sessionId?: string; dryRun?: boolean; json?: boolean; projectDir?: string }) => {
    const { hecateqResume } = await import("./hecateq/resume")
    const result = await hecateqResume({
      sessionId: options.sessionId,
      dryRun: options.dryRun ?? false,
      json: options.json ?? false,
      projectDir: options.projectDir,
    })
    if (options.json) {
      console.log(JSON.stringify(result, null, 2))
    }
    process.exit(result.canContinue ? 0 : result.foundSessions.length > 0 ? 2 : 0)
  })

hecateq
  .command("status")
  .description("Summarize orchestration state, memory, contracts, and task graphs")
  .option("--json", "Output as JSON")
  .option("--project-dir <path>", "Project directory")
  .action((options: { json?: boolean; projectDir?: string }) => {
    const { hecateqStatus } = require("./hecateq/status")
    const result = hecateqStatus({
      json: options.json ?? false,
      projectDir: options.projectDir,
    })
    if (options.json) {
      console.log(JSON.stringify(result, null, 2))
    }
    process.exit(0)
  })

hecateq
  .command("doctor")
  .description("Run Hecateq workflow diagnostics")
  .option("--verbose", "Show detailed descriptions")
  .option("--json", "Output as JSON")
  .option("--project-dir <path>", "Project directory")
  .action(async (options: { verbose?: boolean; json?: boolean; projectDir?: string }) => {
    const { hecateqDoctor } = await import("./hecateq/doctor")
    const result = hecateqDoctor({
      verbose: options.verbose ?? false,
      json: options.json ?? false,
      projectDir: options.projectDir,
    })
    if (options.json) {
      console.log(JSON.stringify(result, null, 2))
    }
    const hasFailures = result.categories.some((c: { status: string }) => c.status === "fail")
    process.exit(hasFailures ? 1 : 0)
  })

program.addCommand(createMcpOAuthCommand())

export function runCli(): void {
  program.parse()
}
