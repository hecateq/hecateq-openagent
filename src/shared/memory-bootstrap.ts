import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, isAbsolute, join, parse, resolve } from "node:path"

/**
 * Project-root memory directory, relative to project root.
 * Single source of truth shared by doctor checks and bootstrap hook.
 */
export const PROJECT_MEMORY_DIR = join(".opencode", "memory", "knowledge", "context")

/**
 * Standard memory files. Must match the doctor check file list exactly.
 */
export const PROJECT_MEMORY_FILES = [
  "active-context.md",
  "progress.md",
  "tasks.md",
  "file-map.md",
  "decisions.md",
] as const

/** Default template content for each bootstrapped memory file. */
export const FILE_TEMPLATES: Record<string, string> = {
  "active-context.md": `# Active Context

Last updated: TODO

## Current Goal
- TODO

## Current State
- TODO

## Constraints
- TODO

## Known Risks
- TODO
`,
  "progress.md": `# Progress

Last updated: TODO

## Completed
- TODO

## In Progress
- TODO

## Remaining
- TODO
`,
  "tasks.md": `# Tasks

Last updated: TODO

## Pending
- TODO

## Blocked
- TODO

## Done
- TODO
`,
  "file-map.md": `# File Map

Last updated: TODO

## Important Paths
- TODO

## Entry Points
- TODO

## Do Not Scan Blindly
- TODO
`,
  "decisions.md": `# Decisions

Last updated: TODO

## Accepted Decisions
- TODO

## Rejected Approaches
- TODO

## Notes
- TODO
`,
}

export type BootstrapResult = {
  created: string[]
  skipped: string[]
  dirCreated: boolean
  errors: string[]
}

/**
 * Core bootstrap function. Given an absolute project root path,
 * ensures the memory directory and all standard files exist.
 *
 * - Creates the memory directory if missing.
 * - Creates files only if they do not already exist (no overwrite).
 * - Returns details about what was created vs skipped.
 * - Does NOT throw on filesystem errors; caught and returned as skipped.
 */
export function bootstrapMemoryFiles(projectRoot: string): BootstrapResult {
  const result: BootstrapResult = { created: [], skipped: [], dirCreated: false, errors: [] }

  try {
    const memoryDir = join(projectRoot, PROJECT_MEMORY_DIR)

    if (!existsSync(memoryDir)) {
      mkdirSync(memoryDir, { recursive: true })
      result.dirCreated = true
    }

    for (const fileName of PROJECT_MEMORY_FILES) {
      try {
        const filePath = join(memoryDir, fileName)
        if (existsSync(filePath)) {
          result.skipped.push(fileName)
        } else {
          const template = FILE_TEMPLATES[fileName] ?? ""
          writeFileSync(filePath, template, "utf-8")
          result.created.push(fileName)
        }
      } catch (error) {
        result.skipped.push(fileName)
        result.errors.push(`file:${fileName}:${error instanceof Error ? error.message : String(error)}`)
      }
    }
  } catch (error) {
    result.errors.push(`directory:${error instanceof Error ? error.message : String(error)}`)
  }

  return result
}

/**
 * Detect whether a directory looks like a project root.
 * Returns true if `.opencode` or `.git` exists inside it.
 */
export function isProjectRoot(dirPath: string): boolean {
  try {
    return existsSync(join(dirPath, ".opencode")) || existsSync(join(dirPath, ".git"))
  } catch {
    return false
  }
}

const PROJECT_MANIFEST_FILES = [
  "package.json",
  "pubspec.yaml",
  "Cargo.toml",
  "go.mod",
  "pyproject.toml",
] as const

/**
 * Walk upward from `startDir` to find the project root.
 *
 * Priority:
 * 1. Directory containing `.opencode` (exact marker — most specific)
 * 2. Directory containing `.git`
 * 3. Directory containing a known manifest file
 *    (package.json / pubspec.yaml / Cargo.toml / go.mod / pyproject.toml)
 *
 * Returns the first matching directory, or `null` if no project root found
 * (for example, when called from a directory outside any project).
 */
export function findProjectRoot(startDir: string): string | null {
  try {
    let current = isAbsolute(startDir) ? startDir : resolve(startDir)
    const { root } = parse(current)

    while (true) {
      // Priority 1: .opencode marker
      if (existsSync(join(current, ".opencode"))) {
        return current
      }
      // Priority 2: .git marker
      if (existsSync(join(current, ".git"))) {
        return current
      }
      // Priority 3: manifest files
      for (const manifest of PROJECT_MANIFEST_FILES) {
        if (existsSync(join(current, manifest))) {
          return current
        }
      }

      if (current === root) break
      current = dirname(current)
    }
  } catch (_error) {
    return null
  }

  return null
}
