import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

/**
 * Hecateq CLI shared utilities.
 * Reusable helpers for prompt analysis, state discovery, and project config.
 */

export interface HecateqProjectState {
  hasOrchestrationDir: boolean
  sessionFiles: string[]
  memoryDir: string | null
  hasMemoryFiles: boolean
  contractsDir: string | null
  taskGraphsDir: string | null
}

/**
 * Scan a project directory for Hecateq workflow state.
 */
export function scanProjectState(cwd: string): HecateqProjectState {
  const orchDir = join(cwd, ".opencode", "orchestration")
  const memoryDir = join(cwd, ".opencode", "state", "memory")
  const contractsDir = join(cwd, ".opencode", "state", "contracts")
  const taskGraphsDir = join(cwd, ".opencode", "state", "task-graphs")

  let sessionFiles: string[] = []
  if (existsSync(orchDir)) {
    try {
      sessionFiles = readdirSync(orchDir).filter((f) => f.endsWith(".json"))
    } catch {
      sessionFiles = []
    }
  }

  let hasMemoryFiles = false
  if (existsSync(memoryDir)) {
    try {
      hasMemoryFiles = readdirSync(memoryDir).filter((f) => f.endsWith(".md")).length > 0
    } catch {
      hasMemoryFiles = false
    }
  }

  return {
    hasOrchestrationDir: existsSync(orchDir),
    sessionFiles,
    memoryDir: existsSync(memoryDir) ? memoryDir : null,
    hasMemoryFiles,
    contractsDir: existsSync(contractsDir) ? contractsDir : null,
    taskGraphsDir: existsSync(taskGraphsDir) ? taskGraphsDir : null,
  }
}

/**
 * Read and parse an orchestration session state file.
 */
export function readSessionState(stateDir: string, sessionId: string): Record<string, unknown> | null {
  const filePath = join(stateDir, `${sessionId}.json`)
  if (!existsSync(filePath)) return null
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as Record<string, unknown>
  } catch {
    return null
  }
}
