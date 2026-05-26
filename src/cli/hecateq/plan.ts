import { existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"

import { analyzePrompt } from "../../features/hecateq-orchestration/prompt-intake"
import { decomposePrompt, resetCounter } from "../../features/hecateq-orchestration/task-decomposer"
import { buildDependencyPlan } from "../../features/hecateq-orchestration/dependency-planner"
import { buildExecutionPlan, validateTaskContract } from "../../features/hecateq-orchestration/execution-planner"
import { selectAgents, readLocalAgentRegistry } from "../../features/hecateq-orchestration/agent-selector"
import { isSensitiveTask, resolveOrchestrationConfig } from "../../features/hecateq-orchestration/orchestration-controller"
import type { ResolvedOrchestrationConfig, LocalAgentRegistryEntry } from "../../features/hecateq-orchestration/types"

export interface HecateqPlanOptions {
  prompt: string
  config?: Partial<ResolvedOrchestrationConfig>
  agentsDir?: string
  disabledAgents?: string[]
  projectDir?: string
  json?: boolean
}

export interface HecateqPlanResult {
  prompt: string
  intake: ReturnType<typeof analyzePrompt>
  tasks: ReturnType<typeof decomposePrompt>
  depPlan: ReturnType<typeof buildDependencyPlan>
  agentSelection: ReturnType<typeof selectAgents>
  execPlan: ReturnType<typeof buildExecutionPlan>
  config: ResolvedOrchestrationConfig
  sensitiveBlockedCount: number
  contractRequiredCount: number
  injectedNodeCount: number
}

/**
 * `hecateq plan <prompt>` — analyze, decompose, dependency graph,
 * show agent assignments, execute nothing.
 *
 * Runs the full pre-execution pipeline: intake → decompose → dependency plan
 * → agent selection → execution plan. Outputs a structured plan report.
 * High-risk tasks default to plan-only; the exit code distinguishes
 * "all clear" from "requires explicit run --force".
 */
export async function hecateqPlan(options: HecateqPlanOptions): Promise<HecateqPlanResult> {
  const {
    prompt,
    config: configOverrides,
    agentsDir = join(process.env.HOME ?? "", ".config", "opencode", "agents"),
    disabledAgents = [],
    projectDir = process.cwd(),
    json,
  } = options

  const config = resolveOrchestrationConfig({
    enabled: true,
    auto_decompose: true,
    auto_execute_low_risk: true,
    require_plan_for_high_risk: true,
    max_repair_attempts: 2,
    allow_parallel_readonly_tasks: true,
    allow_parallel_write_tasks: false,
    ...configOverrides,
  })

  // 1. Intake
  const intake = analyzePrompt(prompt)

  // 2. Decompose
  resetCounter()
  let tasks = decomposePrompt(intake)

  // 3. Block sensitive tasks
  const preBlockCount = tasks.length
  tasks = tasks.map((t) => isSensitiveTask(t) ? { ...t, status: "blocked" as const, error: "Task blocked by sensitive path policy" } : t)
  const sensitiveBlockedCount = tasks.filter((t) => t.status === "blocked").length

  // 4. Dependency plan
  const depPlan = buildDependencyPlan(tasks)

  // 5. Agent selection
  const readFileSync = (p: string) => require("fs").readFileSync(p, "utf-8")
  const readdirSync = (p: string) => { try { return require("fs").readdirSync(p) } catch { return [] } }
  const existsSync = (p: string) => require("fs").existsSync(p)
  const registry = readLocalAgentRegistry(agentsDir, readFileSync, readdirSync, existsSync)
  const agentSelection = selectAgents(tasks, registry, disabledAgents)

  // 6. Execution plan (with contract-first validation)
  const execPlan = buildExecutionPlan(depPlan, agentSelection, config)
  const contractRequiredCount = tasks.filter((t) => validateTaskContract(t, config).requiresContract).length
  const injectedNodeCount = execPlan.injectedNodes?.length ?? 0

  // 7. Report
  if (!json) {
    console.log("")
    console.log("=== Hecateq Plan ===")
    console.log("")
    console.log(`Prompt: ${prompt.slice(0, 120)}${prompt.length > 120 ? "..." : ""}`)
    console.log(`Intent: ${intake.intent} | Size: ${intake.taskSize} | Risk: ${intake.riskLevel} | Domains: ${intake.likelyDomains.join(", ") || "none"}`)
    console.log("")
    console.log(`Tasks: ${tasks.length} (${sensitiveBlockedCount} sensitive-blocked)`)
    console.log(`Batches: ${depPlan.totalBatches}`)
    console.log(`Contract-first stages injected: ${injectedNodeCount}`)
    console.log(`Contracts required: ${contractRequiredCount}`)
    console.log(`Agent assignments: ${agentSelection.exactMatchCount} exact / ${agentSelection.fallbackCount} fallback / ${agentSelection.unassignedTasks.length} unassigned`)
    console.log("")

    if (tasks.length <= 12) {
      console.log("Task breakdown:")
      for (const t of tasks) {
        const status = t.status === "blocked" ? " [BLOCKED]" : ""
        const contract = validateTaskContract(t, config).requiresContract ? " [CONTRACT]" : ""
        console.log(`  ${t.id}: ${t.label} (${t.domain}, ${t.action})${status}${contract}`)
      }
      console.log("")
    }

    if (depPlan.batches.length <= 8) {
      console.log("Execution order:")
      for (let i = 0; i < depPlan.batches.length; i++) {
        console.log(`  Batch ${i + 1}: ${depPlan.batches[i].join(", ")}`)
      }
      console.log("")
    }

    if (depPlan.cycle.hasCycle) {
      console.log(`WARNING: Cycle detected: ${depPlan.cycle.cycleNodeIds.join(" → ")}`)
      console.log("")
    }

    if (sensitiveBlockedCount > 0) {
      console.log(`NOTE: ${sensitiveBlockedCount} sensitive task(s) blocked. These will not execute.`)
      console.log("")
    }

    if (injectedNodeCount > 0) {
      console.log(`NOTE: ${injectedNodeCount} contract/plan/verification stages injected for high-risk tasks.`)
      console.log("")
    }

    if (intake.riskLevel === "high" || intake.riskLevel === "destructive") {
      console.log("RISK: High-risk prompt detected. Use `hecateq run --force` to execute anyway.")
      console.log("")
    }
  }

  return {
    prompt,
    intake,
    tasks,
    depPlan,
    agentSelection,
    execPlan,
    config,
    sensitiveBlockedCount,
    contractRequiredCount,
    injectedNodeCount,
  }
}
