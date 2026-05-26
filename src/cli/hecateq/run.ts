import { join } from "node:path"
import { analyzePrompt } from "../../features/hecateq-orchestration/prompt-intake"
import {
  resolveOrchestrationConfig,
  runOrchestrationPipeline,
  renderReportAsMarkdown,
} from "../../features/hecateq-orchestration/orchestration-controller"
import type { ResolvedOrchestrationConfig } from "../../features/hecateq-orchestration/types"
import { DryRunExecutionAdapter, createBatchExecutorFromAdapter } from "../../features/hecateq-orchestration/execution-adapter"
import { OpenCodeSessionExecutionAdapter } from "./runtime-adapter"

export interface HecateqRunOptions {
  prompt: string
  force?: boolean
  dryRun?: boolean
  config?: Partial<ResolvedOrchestrationConfig>
  agentsDir?: string
  disabledAgents?: string[]
  projectDir?: string
  json?: boolean
  sessionId?: string
  port?: number
  attach?: string
}

/**
 * `hecateq run <prompt>` — auto-run low-risk work, present plan for
 * higher-risk work unless explicitly forced, run quality gates, emit report.
 *
 * Safe-by-default: high-risk or destructive prompts produce a plan-only
 * output and a non-zero exit code unless --force is passed.
 */
export async function hecateqRun(options: HecateqRunOptions): Promise<{ exitCode: number; output: string }> {
  const {
    prompt,
    force = false,
    dryRun = false,
    config: configOverrides,
    agentsDir = join(process.env.HOME ?? "", ".config", "opencode", "agents"),
    disabledAgents = [],
    projectDir = process.cwd(),
    json,
    sessionId,
    port,
    attach,
  } = options

  const config = resolveOrchestrationConfig({
    enabled: true,
    auto_decompose: true,
    auto_execute_low_risk: true,
    require_plan_for_high_risk: true,
    max_repair_attempts: 2,
    quality_gates: {
      typecheck: dryRun ? false : true,
      lint: dryRun ? false : true,
      test: dryRun ? false : true,
      build: dryRun ? false : true,
      doctor: dryRun ? false : true,
    },
    ...configOverrides,
  })

  // 1. Intake — assess risk
  const intake = analyzePrompt(prompt)

  // If high risk and not forced, present plan only
  if ((intake.riskLevel === "high" || intake.riskLevel === "destructive") && !force) {
    const planResult = await import("./plan").then((m) =>
      m.hecateqPlan({ prompt, config: configOverrides, agentsDir, disabledAgents, projectDir, json })
    )
    const lines = [
      "",
      "=== Hecateq Run: PLAN ONLY ===",
      "",
      `Risk level: ${intake.riskLevel}`,
      "This prompt is classified as high-risk. Execution was blocked by default.",
      "Use --force to execute anyway.",
      "",
      "Plan summary:",
      `  Tasks: ${planResult.tasks.length}`,
      `  Batches: ${planResult.depPlan.totalBatches}`,
      `  Contracts required: ${planResult.contractRequiredCount}`,
      "",
    ]
    return { exitCode: 2, output: lines.join("\n") }
  }

  const adapter = dryRun
    ? new DryRunExecutionAdapter()
    : new OpenCodeSessionExecutionAdapter({
        directory: projectDir,
        port,
        attach,
      })

  const result = await runOrchestrationPipeline({
    prompt,
    config,
    sessionId,
    agentsDir,
    disabledAgents,
    projectDir,
    executeBatch: createBatchExecutorFromAdapter(adapter),
  })

  if (json) {
    return {
      exitCode: result.succeeded ? 0 : 1,
      output: JSON.stringify({
        prompt,
        succeeded: result.succeeded,
        summary: result.summary,
        changedFiles: result.changedFiles,
        executionResults: result.executionResults ?? [],
      }, null, 2),
    }
  }

  const output = [
    renderReportAsMarkdown(result),
    "",
    result.succeeded ? "Done." : "FAILED — review quality gate results above.",
    "",
  ].join("\n")

  return { exitCode: result.succeeded ? 0 : 1, output }
}
