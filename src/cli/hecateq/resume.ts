import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { scanProjectState, readSessionState } from "./shared"
import {
  loadSessionState,
  resolveOrchestrationConfig,
  runOrchestrationPipeline,
} from "../../features/hecateq-orchestration/orchestration-controller"
import { createBatchExecutorFromAdapter, DryRunExecutionAdapter } from "../../features/hecateq-orchestration/execution-adapter"
import type { TaskNode } from "../../features/hecateq-orchestration/types"
import { OpenCodeSessionExecutionAdapter } from "./runtime-adapter"

export interface HecateqResumeOptions {
  sessionId?: string
  projectDir?: string
  json?: boolean
  dryRun?: boolean
  port?: number
  attach?: string
}

export interface HecateqResumeResult {
  foundSessions: string[]
  resumedSession: string | null
  recoveredTasks: number
  pausedTasks: number
  failedTasks: number
  canContinue: boolean
}

/**
 * `hecateq resume` — recover unfinished orchestration session state,
 * mark stale in_progress tasks as paused/failed, continue safely.
 *
 * If no session ID is given, lists all available sessions.
 * If a session ID is given, recovers that session and marks stale
 * in_progress tasks as failed (they were running when interrupted).
 */
export async function hecateqResume(options: HecateqResumeOptions): Promise<HecateqResumeResult> {
  const {
    sessionId,
    projectDir = process.cwd(),
    json,
    dryRun = false,
    port,
    attach,
  } = options
  const stateDir = join(projectDir, ".opencode", "orchestration")

  if (!existsSync(stateDir)) {
    const msg = json
      ? JSON.stringify({ foundSessions: [], resumedSession: null, recoveredTasks: 0, pausedTasks: 0, failedTasks: 0, canContinue: false })
      : "No orchestration state directory found (.opencode/orchestration/). Nothing to resume."
    if (!json) console.log(msg)
    return { foundSessions: [], resumedSession: null, recoveredTasks: 0, pausedTasks: 0, failedTasks: 0, canContinue: false }
  }

  const allSessionIds = readdirSync(stateDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))

  if (allSessionIds.length === 0) {
    if (!json) console.log("No orchestration session states found.")
    return { foundSessions: [], resumedSession: null, recoveredTasks: 0, pausedTasks: 0, failedTasks: 0, canContinue: false }
  }

  // If no specific session, list them
  if (!sessionId) {
    if (!json) {
      console.log("")
      console.log("=== Hecateq Resume: Available Sessions ===")
      console.log("")
      for (const sid of allSessionIds) {
        const state = readSessionState(stateDir, sid)
        const phase = state?.phase ?? "unknown"
        const promptPreview = typeof state?.prompt === "string" ? state.prompt.slice(0, 60) : ""
        console.log(`  ${sid} [${phase}]: ${promptPreview}`)
      }
      console.log("")
      console.log(`Use \`hecateq resume --session-id <id>\` to recover a specific session.`)
      console.log("")
    }
    return {
      foundSessions: allSessionIds,
      resumedSession: null,
      recoveredTasks: 0,
      pausedTasks: 0,
      failedTasks: 0,
      canContinue: false,
    }
  }

  // Recover a specific session
  const state = loadSessionState(stateDir, sessionId)
  if (!state) {
    if (!json) console.log(`Session "${sessionId}" not found.`)
    return { foundSessions: allSessionIds, resumedSession: null, recoveredTasks: 0, pausedTasks: 0, failedTasks: 0, canContinue: false }
  }

  // Mark stale in_progress tasks as failed
  let recoveredCount = 0
  let pauseCount = 0
  let failCount = 0

  const updatedTasks = state.tasks.map((task: TaskNode) => {
    if (task.status === "in_progress") {
      pauseCount++
      return { ...task, status: "failed" as const, error: "Session was interrupted — task paused on resume" }
    }
    if (task.status === "pending" && task.dependsOn.some((depId) => {
      const dep = state.tasks.find((t: TaskNode) => t.id === depId)
      return dep?.status === "failed" || dep?.status === "blocked"
    })) {
      failCount++
      return { ...task, status: "failed" as const, error: "Dependency failed — task blocked on resume" }
    }
    return task
  })

  recoveredCount = pauseCount + failCount
  state.tasks = updatedTasks
  state.updatedAt = new Date().toISOString()

  // Determine if the session can continue
  const hasPendingTasks = updatedTasks.some((t: TaskNode) => t.status === "pending" || t.status === "in_progress")
  const canContinue = hasPendingTasks && !state.failed && !state.completed

  if (!json) {
    console.log("")
    console.log(`=== Hecateq Resume: Session ${sessionId} ===`)
    console.log("")
    console.log(`Phase: ${state.phase}`)
    console.log(`Prompt: ${state.prompt.slice(0, 80)}`)
    console.log(`Tasks: ${updatedTasks.length} total`)
    console.log(`  ${pauseCount} in_progress → paused (marked failed)`)
    console.log(`  ${failCount} pending with failed deps → blocked`)
    console.log(`  ${recoveredCount} total recovered`)
    console.log(`Can continue: ${canContinue ? "Yes" : "No"}`)
    console.log("")
  }

  if (canContinue) {
    const config = resolveOrchestrationConfig({
      enabled: true,
      auto_decompose: true,
      auto_execute_low_risk: true,
      require_plan_for_high_risk: true,
      max_repair_attempts: 2,
      quality_gates: {
        typecheck: true,
        lint: true,
        test: true,
        build: true,
        doctor: true,
      },
    })
    const adapter = dryRun
      ? new DryRunExecutionAdapter()
      : new OpenCodeSessionExecutionAdapter({ directory: projectDir, port, attach })

    await runOrchestrationPipeline({
      prompt: state.prompt,
      config,
      sessionId,
      projectDir,
      executeBatch: createBatchExecutorFromAdapter(adapter),
    })
  }

  return {
    foundSessions: allSessionIds,
    resumedSession: sessionId,
    recoveredTasks: recoveredCount,
    pausedTasks: pauseCount,
    failedTasks: failCount,
    canContinue,
  }
}
