import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { scanProjectState } from "./shared"

export interface HecateqStatusOptions {
  projectDir?: string
  json?: boolean
}

export interface HecateqStatusResult {
  orchestration: {
    enabled: boolean
    sessionCount: number
    recentSessions: Array<{ id: string; phase: string; prompt: string; completed: boolean; failed: boolean }>
  }
  memory: {
    initialized: boolean
    fileCount: number
    files: string[]
  }
  contracts: {
    exists: boolean
    count: number
  }
  taskGraphs: {
    exists: boolean
    count: number
  }
}

/**
 * `hecateq status` — summarize orchestration state/history.
 * Scans project directories for evidence of Hecateq workflow activity.
 */
export function hecateqStatus(options: HecateqStatusOptions): HecateqStatusResult {
  const { projectDir = process.cwd(), json } = options
  const state = scanProjectState(projectDir)

  // Orchestration sessions
  const recentSessions: HecateqStatusResult["orchestration"]["recentSessions"] = []
  const stateDir = join(projectDir, ".opencode", "orchestration")

  if (state.hasOrchestrationDir) {
    const sorted = [...state.sessionFiles].sort().reverse().slice(0, 5)
    for (const file of sorted) {
      try {
        const raw = readFileSync(join(stateDir, file), "utf-8")
        const parsed = JSON.parse(raw) as { id?: string; phase?: string; prompt?: string; completed?: boolean; failed?: boolean }
        recentSessions.push({
          id: parsed.id ?? file.replace(/\.json$/, ""),
          phase: parsed.phase ?? "unknown",
          prompt: (parsed.prompt ?? "").slice(0, 80),
          completed: parsed.completed ?? false,
          failed: parsed.failed ?? false,
        })
      } catch {
        // skip unparseable
      }
    }
  }

  // Memory files
  const memoryFiles: string[] = []
  if (state.memoryDir) {
    try {
      const entries = require("fs").readdirSync(state.memoryDir) as string[]
      memoryFiles.push(...entries.filter((f: string) => f.endsWith(".md")))
    } catch {
      // ignore
    }
  }

  // Contracts
  let contractCount = 0
  if (state.contractsDir) {
    try {
      contractCount = require("fs").readdirSync(state.contractsDir).length
    } catch {
      contractCount = 0
    }
  }

  // Task graphs
  let taskGraphCount = 0
  if (state.taskGraphsDir) {
    try {
      taskGraphCount = require("fs").readdirSync(state.taskGraphsDir).length
    } catch {
      taskGraphCount = 0
    }
  }

  const result: HecateqStatusResult = {
    orchestration: {
      enabled: state.hasOrchestrationDir,
      sessionCount: state.sessionFiles.length,
      recentSessions,
    },
    memory: {
      initialized: state.hasMemoryFiles,
      fileCount: memoryFiles.length,
      files: memoryFiles,
    },
    contracts: {
      exists: state.contractsDir !== null,
      count: contractCount,
    },
    taskGraphs: {
      exists: state.taskGraphsDir !== null,
      count: taskGraphCount,
    },
  }

  if (!json) {
    console.log("")
    console.log("=== Hecateq Status ===")
    console.log("")
    console.log("Orchestration:")
    console.log(`  Sessions: ${result.orchestration.sessionCount}`)
    if (result.orchestration.recentSessions.length > 0) {
      console.log("  Recent sessions:")
      for (const s of result.orchestration.recentSessions) {
        const status = s.completed ? "completed" : s.failed ? "failed" : s.phase
        console.log(`    ${s.id}: [${status}] ${s.prompt}`)
      }
    }
    console.log("")
    console.log("Memory:")
    console.log(`  Initialized: ${result.memory.initialized ? "Yes" : "No"}`)
    console.log(`  Files: ${result.memory.fileCount}`)
    if (result.memory.files.length > 0) {
      console.log(`    ${result.memory.files.join(", ")}`)
    }
    console.log("")
    console.log("Contracts:")
    console.log(`  Directory: ${result.contracts.exists ? "Yes" : "No"}`)
    console.log(`  Files: ${result.contracts.count}`)
    console.log("")
    console.log("Task Graphs:")
    console.log(`  Directory: ${result.taskGraphs.exists ? "Yes" : "No"}`)
    console.log(`  Files: ${result.taskGraphs.count}`)
    console.log("")
  }

  return result
}
