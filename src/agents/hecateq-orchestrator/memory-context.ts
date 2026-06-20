import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { log } from "../../shared/logger"
import { PROJECT_MEMORY_DIR } from "../../shared/memory-bootstrap"

export interface MemoryContext {
  activeContext?: string
  fileMap?: string
  agentRouting?: string
  loadedAt: number
}

const DEFAULT_MAX_CHARS = 500

const FILES_TO_READ = [
  "active-context.md",
  "file-map.md",
  "agent-routing.md",
] as const

function safeReadFile(filePath: string, maxChars: number): string | undefined {
  try {
    if (!existsSync(filePath)) return undefined
    const raw = readFileSync(filePath, "utf-8")
    if (!raw || raw.trim().length === 0) return undefined
    const truncated = raw.length > maxChars ? `${raw.slice(0, maxChars)}...` : raw
    return truncated
  } catch (error) {
    log("hecateq-orchestrator/memory-context: failed to read file", {
      filePath,
      error: error instanceof Error ? error.message : String(error),
    })
    return undefined
  }
}

/**
 * Read project-root memory files for injection into the orchestrator prompt.
 *
 * Reads active-context.md, file-map.md, and agent-routing.md from
 * `<projectRoot>/.opencode/state/memory/`. Each file is truncated to
 * `maxChars` (default 500).
 *
 * Returns null if the memory directory does not exist. Returns a
 * MemoryContext with whatever files were found — even if some are
 * missing — so the prompt can include partial context.
 *
 * Never throws. All errors are caught and logged, then the function
 * returns null.
 */
export function readMemoryContext(
  projectRoot: string,
  maxChars = DEFAULT_MAX_CHARS,
): MemoryContext | null {
  try {
    const memoryDir = join(projectRoot, PROJECT_MEMORY_DIR)
    if (!existsSync(memoryDir)) return null

    const ctx: MemoryContext = {
      loadedAt: Date.now(),
    }

    let foundAny = false

    const [activeContextFile, fileMapFile, agentRoutingFile] = FILES_TO_READ

    const activeContext = safeReadFile(join(memoryDir, activeContextFile), maxChars)
    if (activeContext !== undefined) {
      ctx.activeContext = activeContext
      foundAny = true
    }

    const fileMap = safeReadFile(join(memoryDir, fileMapFile), maxChars)
    if (fileMap !== undefined) {
      ctx.fileMap = fileMap
      foundAny = true
    }

    const agentRouting = safeReadFile(join(memoryDir, agentRoutingFile), maxChars)
    if (agentRouting !== undefined) {
      ctx.agentRouting = agentRouting
      foundAny = true
    }

    return foundAny ? ctx : null
  } catch (error) {
    log("hecateq-orchestrator/memory-context: unexpected error", {
      projectRoot,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}
