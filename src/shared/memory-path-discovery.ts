import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { log } from "./logger"
import { findProjectRoot, PROJECT_MEMORY_DIR } from "./memory-bootstrap"
import {
  MEMORY_MANIFEST_FILENAME,
  type MemoryManifest,
  validateManifest,
} from "./memory-manifest"
import { CONTINUATION_FILENAME } from "./memory-continuation"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Repo-root pointer filename. Always at the project-root level. */
export const MEMORY_POINTER_FILENAME = ".memory-manifest.json" as const

/** Magic kind string that identifies the pointer file as a Hecateq artifact. */
export const POINTER_KIND = "hecateq-memory-pointer" as const

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape of the repo-root `.memory-manifest.json` pointer file. */
export interface MemoryPointer {
  version: number
  kind: typeof POINTER_KIND
  manifest_path: string
  continuation_path: string
  authoritative_root: string
  updated_at?: string
}

/** Result of a memory-path discovery attempt. */
export interface DiscoveredPaths {
  /** Absolute path to the project root. */
  projectRoot: string
  /** Absolute path to `memory.json`. May not exist on disk yet. */
  manifestPath: string
  /** Absolute path to `continuation.json`. May not exist on disk yet. */
  continuationPath: string
  /** Absolute path to `.memory-manifest.json` pointer file. */
  pointerPath: string
  /** Absolute path to the authoritative memory directory. */
  authoritativeDir: string
  /** True if `.memory-manifest.json` exists at the project root. */
  pointerExists: boolean
  /** True if `memory.json` exists under the authoritative directory. */
  manifestExists: boolean
  /** True if `continuation.json` exists under the authoritative directory. */
  continuationExists: boolean
}

// ---------------------------------------------------------------------------
// Resolve helpers
// ---------------------------------------------------------------------------

/** Resolve the absolute path to the pointer file for a given project root. */
export function resolvePointerPath(projectRoot: string): string {
  return join(projectRoot, MEMORY_POINTER_FILENAME)
}

/** Resolve the absolute path to the continuation file for a given project root. */
export function resolveContinuationPath(projectRoot: string): string {
  return join(projectRoot, PROJECT_MEMORY_DIR, CONTINUATION_FILENAME)
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/**
 * Discover memory-system paths starting from a working directory.
 *
 * Strategy (ordered):
 * 1. Walk up from `startDir` to find the project root (`.opencode` or `.git`).
 * 2. First try `.memory-manifest.json` at the project root as a pointer.
 *    If it exists and is valid, resolve paths from it.
 * 3. Otherwise fall back to the hardcoded default paths under
 *    `.opencode/state/memory/`.
 *
 * This function is the canonical way for ANY harness (OpenCode, Codex, CLI, etc.)
 * to discover the memory system without hardcoding internal paths.
 *
 * @param startDir - Starting directory for project-root walk (defaults to CWD)
 * @returns DiscoveredPaths or null if no project root found
 */
export function discoverMemoryPaths(startDir = process.cwd()): DiscoveredPaths | null {
  const projectRoot = findProjectRoot(startDir)
  if (!projectRoot) return null

  const pointerPath = resolvePointerPath(projectRoot)
  const defaultManifestPath = join(projectRoot, PROJECT_MEMORY_DIR, MEMORY_MANIFEST_FILENAME)
  const defaultContinuationPath = resolveContinuationPath(projectRoot)
  const authoritativeDir = join(projectRoot, PROJECT_MEMORY_DIR)

  let manifestPath = defaultManifestPath
  let continuationPath = defaultContinuationPath

  // Priority 1: Read the pointer file if it exists
  if (existsSync(pointerPath)) {
    const pointer = readMemoryPointer(pointerPath)
    if (pointer) {
      // Resolve paths relative to project root; security: reject absolute paths
      manifestPath = resolveSafeRelativePath(projectRoot, pointer.manifest_path, defaultManifestPath)
      continuationPath = resolveSafeRelativePath(projectRoot, pointer.continuation_path, defaultContinuationPath)
    }
  }

  return {
    projectRoot,
    manifestPath,
    continuationPath,
    pointerPath,
    authoritativeDir,
    pointerExists: existsSync(pointerPath),
    manifestExists: existsSync(manifestPath),
    continuationExists: existsSync(continuationPath),
  }
}

// ---------------------------------------------------------------------------
// Pointer read/write/validate
// ---------------------------------------------------------------------------

/**
 * Read and validate a pointer file. Returns null if missing, invalid JSON,
 * or wrong kind.
 */
export function readMemoryPointer(pointerPath: string): MemoryPointer | null {
  if (!existsSync(pointerPath)) return null

  try {
    const raw = readFileSync(pointerPath, "utf-8")
    const parsed: unknown = JSON.parse(raw)
    return validateMemoryPointer(parsed)
  } catch {
    log("memory-path-discovery: Failed to parse pointer file", { pointerPath })
    return null
  }
}

/**
 * Validate an unknown object as a MemoryPointer. Returns null on failure.
 */
export function validateMemoryPointer(raw: unknown): MemoryPointer | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== "object" || Array.isArray(raw)) return null

  const m = raw as Record<string, unknown>

  if (typeof m.version !== "number") return null
  if (m.kind !== POINTER_KIND) return null
  if (typeof m.manifest_path !== "string") return null
  if (typeof m.authoritative_root !== "string") return null

  return {
    version: m.version,
    kind: POINTER_KIND,
    manifest_path: m.manifest_path,
    continuation_path:
      typeof m.continuation_path === "string" ? m.continuation_path : ".opencode/state/memory/continuation.json",
    authoritative_root: m.authoritative_root,
    updated_at: typeof m.updated_at === "string" ? m.updated_at : undefined,
  }
}

// ---------------------------------------------------------------------------
// Security helper
// ---------------------------------------------------------------------------

/**
 * Resolve a relative path safely within the project root. Falls back to
 * `fallbackPath` if the pointer-supplied path is absolute or escapes
 * the project root.
 */
function resolveSafeRelativePath(
  projectRoot: string,
  relativePath: string,
  fallbackPath: string,
): string {
  // Reject absolute paths and attempts to escape via ".."
  if (relativePath.startsWith("/") || /^(\\\\|[A-Za-z]:[\\\\/])/.test(relativePath)) {
    return fallbackPath
  }

  const resolved = join(projectRoot, relativePath)

  // Verify the resolved path stays within the project root
  if (!resolved.startsWith(projectRoot + "/") && resolved !== projectRoot) {
    return fallbackPath
  }

  return resolved
}
