import { existsSync } from "node:fs"
import { join, relative } from "node:path"

import { PROJECT_MEMORY_DIR, findProjectRoot } from "./memory-bootstrap"
import {
  readManifest,
  refreshFileEntry,
  writeManifest,
  type HarnessKind,
} from "./memory-manifest"
import { log } from "./logger"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of a manifest refresh operation. */
export interface ManifestRefreshResult {
  /** True if a manifest refresh was attempted (file was in memory dir). */
  attempted: boolean
  /** True if the refresh succeeded and manifest was updated. */
  updated: boolean
  /** The file name relative to the memory directory, or null. */
  memoryFileName: string | null
  /** If not refreshed, a reason string. */
  reason: string | null
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Check whether an absolute file path is inside the project memory directory.
 * Returns the memory file name (relative to PROJECT_MEMORY_DIR) if inside, null otherwise.
 */
export function resolveMemoryFileName(
  projectRoot: string,
  absolutePath: string,
): string | null {
  const memoryDir = join(projectRoot, PROJECT_MEMORY_DIR)

  // Normalize paths for comparison
  const normalizedMemoryDir = memoryDir.endsWith("/") ? memoryDir : memoryDir + "/"
  const normalizedPath = absolutePath.endsWith("/") ? absolutePath : absolutePath

  if (!normalizedPath.startsWith(normalizedMemoryDir)) return null

  const relativePath = relative(memoryDir, absolutePath)
  if (!relativePath || relativePath.startsWith("..") || relativePath.startsWith("/")) {
    return null
  }

  return relativePath
}

// ---------------------------------------------------------------------------
// Core refresh logic
// ---------------------------------------------------------------------------

/**
 * Refresh the memory manifest after a write to a memory file.
 *
 * This function:
 * 1. Resolves the project root from the given working directory
 * 2. Checks if the target file is inside the memory directory
 * 3. If so, reads the current manifest, refreshes the file entry,
 *    and writes the updated manifest
 *
 * This is the production seam for post-write manifest refresh.
 *
 * @param workingDir - Starting directory (usually process.cwd() or ctx.directory)
 * @param absoluteFilePath - Absolute path of the file that was written
 * @param harnessKind - Optional harness kind to stamp on the manifest update
 * @param agent - Optional agent name to stamp on the manifest update
 * @param sessionId - Optional session ID to stamp on the manifest update
 * @returns ManifestRefreshResult describing what happened
 */
export function refreshManifestAfterWrite(
  workingDir: string,
  absoluteFilePath: string,
  harnessKind?: HarnessKind,
  agent?: string,
  sessionId?: string,
): ManifestRefreshResult {
  // Step 1: Find project root
  const projectRoot = findProjectRoot(workingDir)
  if (!projectRoot) {
    return {
      attempted: false,
      updated: false,
      memoryFileName: null,
      reason: "No project root found",
    }
  }

  // Step 2: Check if the file is inside the memory directory
  const memoryFileName = resolveMemoryFileName(projectRoot, absoluteFilePath)
  if (!memoryFileName) {
    return {
      attempted: false,
      updated: false,
      memoryFileName: null,
      reason: "File is outside memory directory",
    }
  }

  // Step 3: Verify the file still exists (it might have been deleted)
  if (!existsSync(absoluteFilePath)) {
    return {
      attempted: true,
      updated: false,
      memoryFileName,
      reason: "File no longer exists",
    }
  }

  // Step 4: Read current manifest
  let manifest = readManifest(projectRoot)
  if (!manifest) {
    return {
      attempted: true,
      updated: false,
      memoryFileName,
      reason: "No manifest found",
    }
  }

  // Step 5: Refresh the file entry
  try {
    manifest = refreshFileEntry(projectRoot, manifest, memoryFileName)

    // Step 6: Stamp update metadata
    manifest.updated_by_harness = harnessKind ?? manifest.updated_by_harness
    manifest.updated_by_agent = agent ?? manifest.updated_by_agent
    if (sessionId) {
      manifest.updated_by_session = sessionId
    }
    manifest.manifest_revision = (manifest.manifest_revision ?? 0) + 1

    // Step 7: Write updated manifest
    writeManifest(projectRoot, manifest)

    return {
      attempted: true,
      updated: true,
      memoryFileName,
      reason: null,
    }
  } catch (error) {
    log("memory-manifest-updater: Failed to refresh manifest", {
      projectRoot,
      memoryFileName,
      error: error instanceof Error ? error.message : String(error),
    })
    return {
      attempted: true,
      updated: false,
      memoryFileName,
      reason: error instanceof Error ? error.message : "Unknown error",
    }
  }
}

// ---------------------------------------------------------------------------
// Tool args detection
// ---------------------------------------------------------------------------

/** Tool names that write files and should trigger manifest refresh. */
const WRITE_TOOL_NAMES = new Set(["write", "edit", "replace"])

/** Known argument keys that carry the target file path. */
const FILE_PATH_ARG_KEYS = ["filePath", "file_path", "path", "target", "file"]

/**
 * Extract a file path string from tool arguments, if present.
 * Returns null if no recognizable file path argument is found.
 */
export function extractFilePathFromArgs(
  args: Record<string, unknown> | undefined,
): string | null {
  if (!args || typeof args !== "object") return null

  for (const key of FILE_PATH_ARG_KEYS) {
    const value = args[key]
    if (typeof value === "string" && value.length > 0) {
      return value
    }
  }

  return null
}

/**
 * Check whether a tool execution should trigger manifest refresh.
 * Returns the file path if it should, null otherwise.
 */
export function shouldRefreshManifest(
  toolName: string,
  args: Record<string, unknown> | undefined,
): string | null {
  if (!WRITE_TOOL_NAMES.has(toolName)) return null
  return extractFilePathFromArgs(args)
}
