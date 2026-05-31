import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, isAbsolute, join, parse, resolve, relative } from "node:path"

import {
  createMemoryManifest,
  detectPlaceholderContent,
  refreshFileEntry,
  readManifest,
  type HarnessKind,
  writeManifest,
} from "./memory-manifest"
import { hydrateMemoryFile } from "./memory-hydrator"
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

// ─── Root Contract Types ──────────────────────────────────────────────────────

/** Discriminated source that explains how the project root was resolved. */
export type RootSource =
  | "opencode_marker"
  | "git_marker"
  | "package_manifest"
  | "empty_session_directory"
  | "explicit_override"
  | "cwd_fallback"

/** Confidence level for the resolved root. */
export type ConfidenceLevel = "high" | "medium" | "low"

/**
 * Structured contract describing the resolved project root.
 *
 * When a first-run empty/markerless directory is opened, the resolver
 * accepts it as a valid Hecateq project root (source: empty_session_directory)
 * instead of throwing, climbing to an unrelated parent, or falling back
 * to process.cwd().
 */
export type RootContract = {
  /** Absolute path to the project root. */
  projectRoot: string
  /** Git worktree root, or null if not inside a git repository. */
  worktreeRoot: string | null
  /** Session working directory (may differ from projectRoot). */
  sessionDirectory: string
  /** Package root (directory containing package.json or equivalent), or null. */
  packageRoot: string | null
  /** How the root was resolved. */
  source: RootSource
  /** Confidence in the resolved root. */
  confidence: ConfidenceLevel
  /** Human-readable warnings about the resolution. */
  warnings: string[]
}

/** Directories that should never be treated as a project root. */
const SYSTEM_DIRECTORIES = new Set<string>([
  "/", "/root", "/etc", "/var", "/usr", "/bin", "/sbin",
  "/tmp", "/dev", "/proc", "/sys", "/boot", "/opt", "/mnt",
  "/snap", "/lost+found",
])

/** Check whether a directory is the user home directory. */
function isHomeDirectory(directory: string): boolean {
  const normalizedDir = resolve(directory)
  const normalizedHome = resolve(homedir())
  return normalizedDir === normalizedHome
}

/** Check whether a directory is a system/dangerous directory. */
function isSystemDirectory(directory: string): boolean {
  return SYSTEM_DIRECTORIES.has(resolve(directory))
}

/**
 * Standard memory files. Must match the doctor check file list exactly.
 */
export const PROJECT_MEMORY_FILES = [
  "active-context.md",
  "progress.md",
  "tasks.md",
  "file-map.md",
  "decisions.md",
  "agent-routing.md",
  "quality-history.md",
  "risk-profile.md",
] as const

/** JSONL memory files bootstrapped as empty files — never overwritten. */
export const PROJECT_MEMORY_JSONL_FILES = [
  "tasks.jsonl",
  "decisions.jsonl",
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
  "agent-routing.md": `# Agent Routing

Last updated: TODO

## Preferred Agents by Domain
- TODO

## Agent Assignment Rules
- TODO

## Disabled / Restricted Agents
- TODO

## Custom Agent Paths
- TODO
`,
  "quality-history.md": `# Quality History

Last updated: TODO

## Quality Gate Results
- TODO

## Known Test Failures
- TODO

## Linting / Typecheck Notes
- TODO

## Regression History
- TODO
`,
  "risk-profile.md": `# Risk Profile

Last updated: TODO

## Sensitive Paths
- TODO

## Destructive Operations
- TODO

## Security Constraints
- TODO

## Rollback Plans
- TODO
`,
}

export type BootstrapResult = {
  created: string[]
  skipped: string[]
  hydrated: string[]
  dirCreated: boolean
  artifactDirsCreated: string[]
  errors: string[]
}

export type BootstrapOptions = {
  hydratePlaceholders?: boolean
}

/**
 * Core bootstrap function. Given an absolute project root path,
 * ensures the memory directory and all standard files exist.
 *
 * - Creates the memory directory if missing.
 * - Creates files only if they do not already exist (no overwrite).
 * - When hydratePlaceholders is true (default), existing placeholder
 *   files are hydrated with deterministic non-LLM starter content.
 * - Freshly created files receive hydrated starter content
 *   (not raw TODO-only templates).
 * - Returns details about what was created / hydrated / skipped.
 * - Does NOT throw on filesystem errors; caught and returned as skipped.
 */
export function bootstrapMemoryFiles(
  projectRoot: string,
  options: BootstrapOptions = {},
): BootstrapResult {
  const hydrateEnabled = options.hydratePlaceholders !== false
  const result: BootstrapResult = {
    created: [],
    skipped: [],
    hydrated: [],
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
          const existingContent = readFileSync(filePath, "utf-8")
          if (hydrateEnabled && detectPlaceholderContent(existingContent)) {
            const hydrated = hydrateMemoryFile({
              projectRoot,
              fileName,
              existingContent,
            })
            if (hydrated !== null) {
              writeFileSync(filePath, hydrated, "utf-8")
              result.hydrated.push(fileName)
            } else {
              result.skipped.push(fileName)
            }
          } else {
            result.skipped.push(fileName)
          }
        } else {
          // Fresh create: use hydrated starter, not raw TODO template
          const hydrated = hydrateMemoryFile({
            projectRoot,
            fileName,
            existingContent: "",
          })
          const content = hydrated ?? FILE_TEMPLATES[fileName] ?? ""
          writeFileSync(filePath, content, "utf-8")
          result.created.push(fileName)
        }
      } catch (error) {
        result.skipped.push(fileName)
        result.errors.push(`file:${fileName}:${error instanceof Error ? error.message : String(error)}`)
      }
    }

    // JSONL memory files: create empty if missing, never overwrite, never hydrate
    for (const fileName of PROJECT_MEMORY_JSONL_FILES) {
      try {
        const filePath = join(memoryDir, fileName)
        if (existsSync(filePath)) {
          result.skipped.push(fileName)
        } else {
          writeFileSync(filePath, "", "utf-8")
          result.created.push(fileName)
        }
      } catch (error) {
        result.skipped.push(fileName)
        result.errors.push(`file:${fileName}:${error instanceof Error ? error.message : String(error)}`)
      }
    }

    // Manifest consistency: refresh entries for hydrated files
    if (hydrateEnabled && result.hydrated.length > 0) {
      try {
        let manifest = readManifest(projectRoot)
        if (manifest) {
          for (const fileName of result.hydrated) {
            manifest = refreshFileEntry(projectRoot, manifest, fileName)
          }
          writeManifest(projectRoot, manifest)
        }
      } catch (error) {
        log("memory-bootstrap: Failed to refresh manifest after hydration", {
          projectRoot,
          error: error instanceof Error ? error.message : String(error),
        })
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

/**
 * Resolve the session project root with empty-directory awareness.
 *
 * When `sessionDir` is an existing directory with no project markers
 * and no better root is found above it, the directory is accepted as
 * a valid Hecateq project root for first-run bootstrap instead of
 * throwing or climbing to an unrelated parent.
 *
 * Safety gates:
 * - Directory must exist and be a directory.
 * - Not the user home directory.
 * - Not a system/dangerous directory.
 * - Session directory takes precedence over walked-up roots for
 *   first-run scenarios.
 *
 * Returns a RootContract describing the resolution.
 */
export function resolveSessionRoot(sessionDir: string): RootContract | null {
  try {
    const resolvedDir = resolve(sessionDir)

    if (!existsSync(resolvedDir)) return null

    // Safety: never treat home or system directories as project roots
    if (isHomeDirectory(resolvedDir)) return null
    if (isSystemDirectory(resolvedDir)) return null

    // Check if directory has its own markers
    const hasOwnMarkers =
      existsSync(join(resolvedDir, ".opencode")) ||
      existsSync(join(resolvedDir, ".git")) ||
      PROJECT_MANIFEST_FILES.some((m) => existsSync(join(resolvedDir, m)))

    // Check for a parent project root by walking up
    const parentRoot = findProjectRoot(dirname(resolvedDir))

    // Case 1: Directory has its own markers → traditional resolution
    if (hasOwnMarkers) {
      const worktreeRoot = findWorktreeRoot(resolvedDir)
      const boundary = worktreeRoot ?? resolvedDir
      const packageRoot = findPackageRoot(resolvedDir, boundary)
      return {
        projectRoot: resolvedDir,
        worktreeRoot,
        sessionDirectory: resolvedDir,
        packageRoot,
        source: existsSync(join(resolvedDir, ".opencode"))
          ? "opencode_marker"
          : existsSync(join(resolvedDir, ".git"))
            ? "git_marker"
            : "package_manifest",
        confidence: "high",
        warnings: [],
      }
    }

    // Case 2: Directory has NO markers, but a parent project exists above.
    // The empty directory was intentionally opened as the session — use it as
    // projectRoot to avoid accidentally injecting parent project memory.
    // Detect and report the parent worktree but do not inherit its state.
    if (parentRoot && parentRoot !== resolvedDir) {
      const worktreeRoot = findWorktreeRoot(parentRoot)
      const warnings: string[] = [
        "No .opencode, .git, or package marker found.",
        "Treating sessionDirectory as a new Hecateq project root for first-run bootstrap.",
        `Parent project detected at ${parentRoot}.`,
      ]
      if (worktreeRoot) {
        warnings.push(`Worktree root set to parent: ${worktreeRoot}`)
      } else {
        warnings.push("Parent project has no git worktree; worktreeRoot is null.")
      }
      return {
        projectRoot: resolvedDir,
        worktreeRoot,
        sessionDirectory: resolvedDir,
        packageRoot: null,
        source: "empty_session_directory",
        confidence: "medium",
        warnings,
      }
    }

    // Case 3: Directory has NO markers and NO parent project
    // → Accept as a new Hecateq project root for first-run bootstrap
    return {
      projectRoot: resolvedDir,
      worktreeRoot: null,
      sessionDirectory: resolvedDir,
      packageRoot: null,
      source: "empty_session_directory",
      confidence: "medium",
      warnings: [
        "No .opencode, .git, or package marker found.",
        "Treating sessionDirectory as a new Hecateq project root for first-run bootstrap.",
      ],
    }
  } catch {
    return null
  }
}

function findWorktreeRoot(directory: string): string | null {
  try {
    const output = require("node:child_process").execFileSync(
      "git",
      ["rev-parse", "--show-toplevel"],
      { cwd: directory, encoding: "utf-8", timeout: 3000, stdio: ["ignore", "pipe", "pipe"] },
    )
    const trimmed = output.trim()
    return trimmed.length > 0 ? resolve(trimmed) : null
  } catch {
    return null
  }
}

/**
 * Walk upward from `directory` to find the nearest directory containing a
 * package manifest (package.json, pubspec.yaml, Cargo.toml, etc.).
 *
 * Boundaries:
 * - Never climbs above `boundary` (inclusive). When `boundary` is provided,
 *   the search is confined to directories between `directory` and `boundary`.
 * - Never climbs into the user home directory ($HOME).
 * - Never climbs above the filesystem root (`/`).
 *
 * @param directory  Starting directory for the upward search.
 * @param boundary   Highest directory to search (inclusive). If omitted,
 *                    defaults to the user home directory.
 */
function findPackageRoot(
  directory: string,
  boundary?: string,
): string | null {
  try {
    const homeDir = resolve(homedir())
    let current = resolve(directory)
    const { root } = parse(current)
    const stopAt = boundary ? resolve(boundary) : homeDir

    while (true) {
      for (const manifest of PROJECT_MANIFEST_FILES) {
        if (existsSync(join(current, manifest))) return current
      }

      if (current === root) break
      if (current === stopAt) break
      if (current === homeDir) break

      const parent = dirname(current)

      if (parent !== stopAt && !parent.startsWith(stopAt + "/")) break
      if (parent !== homeDir && !parent.startsWith(homeDir + "/")) break

      current = parent
    }
  } catch {
    // ignore
  }
  return null
}
