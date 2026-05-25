import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { dirname, isAbsolute, join, parse, resolve } from "node:path"

import { createMemoryManifest, type HarnessKind, writeManifest } from "./memory-manifest"
import { log } from "./logger"
import { writeFileAtomically } from "./write-file-atomically"

/**
 * Canonical project state root. All project-scoped runtime state,
 * memory, contracts, task-graphs, and hecateq data live under this
 * single hierarchy.
 */
export const PROJECT_STATE_DIR = join(".opencode", "state")

/**
 * Project-root memory directory, relative to project root.
 * Single source of truth shared by doctor checks and bootstrap hook.
 */
export const PROJECT_MEMORY_DIR = join(PROJECT_STATE_DIR, "memory")
export const PROJECT_MEMORY_MANIFEST = join(PROJECT_MEMORY_DIR, "memory.json")
export const PROJECT_CONTRACTS_DIR = join(PROJECT_STATE_DIR, "contracts")
export const PROJECT_TASK_GRAPHS_DIR = join(PROJECT_STATE_DIR, "task-graphs")
export const PROJECT_ARTIFACT_DIRS = [
  PROJECT_CONTRACTS_DIR,
  PROJECT_TASK_GRAPHS_DIR,
] as const

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
  artifactDirsCreated: string[]
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
  const result: BootstrapResult = {
    created: [],
    skipped: [],
    dirCreated: false,
    artifactDirsCreated: [],
    errors: [],
  }

  try {
    const memoryDir = join(projectRoot, PROJECT_MEMORY_DIR)

    if (!existsSync(memoryDir)) {
      mkdirSync(memoryDir, { recursive: true })
      result.dirCreated = true
    }

    for (const artifactDir of PROJECT_ARTIFACT_DIRS) {
      try {
        const artifactPath = join(projectRoot, artifactDir)
        if (existsSync(artifactPath)) continue
        mkdirSync(artifactPath, { recursive: true })
        result.artifactDirsCreated.push(artifactDir)
      } catch (error) {
        result.errors.push(`artifact-dir:${artifactDir}:${error instanceof Error ? error.message : String(error)}`)
      }
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

export type ManifestBootstrapResult = {
  created: boolean
  skipped: boolean
  error: string | null
}

export function bootstrapMemoryManifest(
  projectRoot: string,
  assignHarness?: HarnessKind,
): ManifestBootstrapResult {
  try {
    const memoryDir = join(projectRoot, PROJECT_MEMORY_DIR)
    const manifestPath = join(memoryDir, "memory.json")

    if (existsSync(manifestPath)) {
      return { created: false, skipped: true, error: null }
    }

    if (!existsSync(memoryDir)) {
      mkdirSync(memoryDir, { recursive: true })
    }

    const manifest = createMemoryManifest(projectRoot, assignHarness)
    writeManifest(projectRoot, manifest)
    return { created: true, skipped: false, error: null }
  } catch (error) {
    log("memory-bootstrap: Failed to create memory manifest", {
      projectRoot,
      error: error instanceof Error ? error.message : String(error),
    })
    return {
      created: false,
      skipped: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export type PointerBootstrapResult = {
  created: boolean
  skipped: boolean
  error: string | null
}

/**
 * Bootstrap the repo-root `.memory-manifest.json` pointer file.
 *
 * The pointer enables other IDEs/harnesses to discover the memory system
 * without hardcoding internal paths. Created only if it doesn't already exist.
 */
export function bootstrapMemoryPointer(projectRoot: string): PointerBootstrapResult {
  const pointerPath = join(projectRoot, ".memory-manifest.json")

  try {
    if (existsSync(pointerPath)) {
      return { created: false, skipped: true, error: null }
    }

    const pointer = {
      version: 1,
      kind: "hecateq-memory-pointer",
      manifest_path: ".opencode/state/memory/memory.json",
      continuation_path: ".opencode/state/memory/continuation.json",
      authoritative_root: ".opencode/state/memory",
      updated_at: new Date().toISOString(),
    }

    const json = JSON.stringify(pointer, null, 2) + "\n"
    writeFileAtomically(pointerPath, json)

    return { created: true, skipped: false, error: null }
  } catch (error) {
    log("memory-bootstrap: Failed to create pointer file", {
      projectRoot,
      pointerPath,
      error: error instanceof Error ? error.message : String(error),
    })
    return {
      created: false,
      skipped: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
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
