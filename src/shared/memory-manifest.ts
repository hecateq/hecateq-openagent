import { existsSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

import { writeFileAtomically } from "./write-file-atomically"
import { log } from "./logger"
import {
  PROJECT_MEMORY_DIR,
  PROJECT_MEMORY_FILES,
  FILE_TEMPLATES,
} from "./memory-bootstrap"

/** File name of the memory manifest, living alongside memory markdown files. */
export const MEMORY_MANIFEST_FILENAME = "memory.json" as const

/** Current schema version. Increment when the manifest format changes. */
export const MEMORY_MANIFEST_SCHEMA_VERSION = 2

/** Revision counter for the manifest itself (incremented on content change). */
export const DEFAULT_MANIFEST_REVISION = 1

/** Default lock TTL in seconds. Locks auto-expire after this duration. */
export const DEFAULT_MEMORY_LOCK_TTL_SECONDS = 300

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HarnessKind = "opencode" | "claude-code" | "codex" | "cli"

export interface MemoryFileEntry {
  size_bytes: number
  last_modified: string
  content_hash: string
  summary: string
  summary_chars: number
  section_count: number
  is_placeholder: boolean
  last_modified_by_agent: string | null
  last_modified_by_harness: HarnessKind | null
  encoding: "utf-8"
}

export interface MemoryLock {
  locked_by_session: string
  locked_by_agent: string
  locked_at: string
  lock_ttl_seconds: number
}

export interface MemoryManifest {
  schema_version: number
  manifest_revision?: number
  manifest_updated_at: string
  updated_by_agent?: string
  updated_by_harness?: HarnessKind
  updated_by_session?: string

  token_budget: {
    total_cost_chars: number
    estimated_total_tokens: number
    reading_cost: "low" | "medium" | "high"
    recommended_read_order: string[]
  }

  files: Record<string, MemoryFileEntry>

  required_files: string[]
  optional_files: string[]
  deprecated_files: string[]

  locks: Record<string, MemoryLock | null>

  migrations_applied: string[]

  harness_timestamps: {
    opencode: string | null
    "claude-code": string | null
    codex: string | null
    cli: string | null
  }

  // v2 portability fields
  project_identity: {
    project_id: string
    project_name: string
    workspace_kind: "single"
  }

  discovery: {
    pointer_file: string
    authoritative_root: string
    continuation_path: string
  }

  resume: {
    continuation_state: "missing" | "fresh" | "stale"
    summary: string
    primary_task_ref: string
    next_step_hint: string
    suggested_reads: string[]
    last_handoff_at: string | null
  }
}

// ---------------------------------------------------------------------------
// Placeholder constants
// ---------------------------------------------------------------------------

const PLACEHOLDER_SUMMARY = "[template placeholder — not yet populated]"

/** Heuristic reading cost thresholds. */
const READING_COST_LOW = 5000
const READING_COST_MEDIUM = 20000

/** Default recommended file read order. */
export const DEFAULT_RECOMMENDED_READ_ORDER = [
  "active-context.md",
  "progress.md",
  "file-map.md",
  "decisions.md",
  "tasks.md",
] as const

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveReadingCost(totalChars: number): MemoryManifest["token_budget"]["reading_cost"] {
  if (totalChars < READING_COST_LOW) return "low"
  if (totalChars <= READING_COST_MEDIUM) return "medium"
  return "high"
}

function estimateTokens(chars: number): number {
  return Math.ceil(chars / 4)
}

/**
 * Compute a sha256 hex digest of the given content.
 * Uses Bun.hash when available, falling back to a simpler approach for non-Bun runtimes.
 */
function computeContentHash(content: string): string {
  try {
    // Bun.hash.wyhash is fast but not SHA-256. For manifest purposes,
    // a stable content hash is sufficient — we use Bun.hash if available.
    if (typeof Bun !== "undefined" && Bun.hash && typeof Bun.hash === "function") {
      const hash = (Bun.hash as (input: string) => number)(content)
      return `bun:${hash.toString(16)}`
    }
  } catch {
    // fall through
  }
  // Simple hash fallback for non-Bun runtimes
  let hash = 0
  for (let i = 0; i < content.length; i += 1) {
    const char = content.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash |= 0
  }
  return `js:${Math.abs(hash).toString(16)}`
}

/** Count top-level ## sections in markdown content. */
function countSections(content: string): number {
  const matches = content.match(/^## /gm)
  return matches ? matches.length : 0
}

// ---------------------------------------------------------------------------
// Read / Write / Validate
// ---------------------------------------------------------------------------

/** Resolve the full path to memory.json for a given project root. */
export function getManifestPath(projectRoot: string): string {
  return join(projectRoot, PROJECT_MEMORY_DIR, MEMORY_MANIFEST_FILENAME)
}

/**
 * Read and deserialize the memory manifest.
 * Returns `null` if the manifest is missing or invalid JSON.
 */
export function readManifest(projectRoot: string): MemoryManifest | null {
  const manifestPath = getManifestPath(projectRoot)
  if (!existsSync(manifestPath)) return null

  try {
    const raw = readFileSync(manifestPath, "utf-8")
    const parsed: unknown = JSON.parse(raw)
    return parsed as MemoryManifest
  } catch (error) {
    log("memory-manifest: Failed to parse memory.json", {
      projectRoot,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/**
 * Validate a manifest object against the v1 schema.
 * Returns the validated manifest or `null` with a reason string.
 */
export function validateManifest(raw: unknown): { valid: true; manifest: MemoryManifest } | { valid: false; reason: string } {
  if (raw === null || raw === undefined) {
    return { valid: false, reason: "manifest is null or undefined" }
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { valid: false, reason: "manifest is not an object" }
  }

  const m = raw as Record<string, unknown>

  if (typeof m.schema_version !== "number") {
    return { valid: false, reason: "schema_version must be a number" }
  }
  if (m.schema_version < 1) {
    return { valid: false, reason: "schema_version must be >= 1" }
  }
  if (typeof m.manifest_updated_at !== "string") {
    return { valid: false, reason: "manifest_updated_at must be a string" }
  }
  if (typeof m.files !== "object" || m.files === null || Array.isArray(m.files)) {
    return { valid: false, reason: "files must be an object" }
  }
  if (!Array.isArray(m.required_files)) {
    return { valid: false, reason: "required_files must be an array" }
  }

  return { valid: true, manifest: m as unknown as MemoryManifest }
}

/**
 * Write (or overwrite) the memory manifest atomically.
 * Writes to a temp file then renames to avoid partial reads.
 */
export function writeManifest(projectRoot: string, manifest: MemoryManifest): void {
  const manifestPath = getManifestPath(projectRoot)
  manifest.manifest_updated_at = new Date().toISOString()
  const json = JSON.stringify(manifest, null, 2) + "\n"
  writeFileAtomically(manifestPath, json)
}

// ---------------------------------------------------------------------------
// Manifest creation / refresh
// ---------------------------------------------------------------------------

/**
 * Create a fresh manifest from the current state of memory files on disk.
 * Does NOT write to disk — call `writeManifest()` separately.
 *
 * If `assignHarness` is provided, it stamps harness_timestamps for that harness.
 */
export function createMemoryManifest(
  projectRoot: string,
  assignHarness?: HarnessKind,
): MemoryManifest {
  const memoryDir = join(projectRoot, PROJECT_MEMORY_DIR)
  const now = new Date().toISOString()
  const files: Record<string, MemoryFileEntry> = {}
  let totalChars = 0
  let placeholderCount = 0

  const requiredFiles = [...PROJECT_MEMORY_FILES] as string[]

  for (const fileName of PROJECT_MEMORY_FILES) {
    const filePath = join(memoryDir, fileName)
    let content = ""
    let isFromTemplate = false

    if (existsSync(filePath)) {
      content = readFileSync(filePath, "utf-8")
    } else {
      // Use the template content for placeholder detection
      content = FILE_TEMPLATES[fileName] ?? ""
      isFromTemplate = true
    }

    const stats = existsSync(filePath) ? statSync(filePath) : null
    const contentHash = computeContentHash(content)
    const sectionCount = countSections(content)
    const isPlaceholder = detectPlaceholderContent(content)
    const summary = isPlaceholder
      ? PLACEHOLDER_SUMMARY
      : extractSummary(content)

    files[fileName] = {
      size_bytes: stats?.size ?? Buffer.byteLength(content, "utf-8"),
      last_modified: stats?.mtime.toISOString() ?? now,
      content_hash: contentHash,
      summary,
      summary_chars: summary.length,
      section_count: sectionCount,
      is_placeholder: isPlaceholder,
      last_modified_by_agent: isFromTemplate ? null : null,
      last_modified_by_harness: isFromTemplate ? null : null,
      encoding: "utf-8",
    }

    totalChars += stats?.size ?? Buffer.byteLength(content, "utf-8")
    if (isPlaceholder) placeholderCount += 1
  }

  const readingCost = resolveReadingCost(totalChars)

  const harnessTimestamps: MemoryManifest["harness_timestamps"] = {
    opencode: null,
    "claude-code": null,
    codex: null,
    cli: null,
  }

  if (assignHarness === "opencode") {
    harnessTimestamps.opencode = now
  } else if (assignHarness === "claude-code") {
    harnessTimestamps["claude-code"] = now
  } else if (assignHarness === "codex") {
    harnessTimestamps.codex = now
  } else if (assignHarness === "cli") {
    harnessTimestamps.cli = now
  }

  const projectId = computeContentHash(projectRoot)
  const projectName = projectRoot.split("/").pop() ?? "unknown"

  return {
    schema_version: MEMORY_MANIFEST_SCHEMA_VERSION,
    manifest_revision: DEFAULT_MANIFEST_REVISION,
    manifest_updated_at: now,
    updated_by_agent: undefined,
    updated_by_harness: assignHarness,
    updated_by_session: undefined,

    token_budget: {
      total_cost_chars: totalChars,
      estimated_total_tokens: estimateTokens(totalChars),
      reading_cost: readingCost,
      recommended_read_order: [...DEFAULT_RECOMMENDED_READ_ORDER],
    },

    files,

    required_files: requiredFiles,
    optional_files: [],
    deprecated_files: [],

    locks: Object.fromEntries(requiredFiles.map((name) => [name, null])),

    migrations_applied: ["v1-initial-manifest"],

    harness_timestamps: harnessTimestamps,

    project_identity: {
      project_id: projectId,
      project_name: projectName,
      workspace_kind: "single",
    },

    discovery: {
      pointer_file: ".memory-manifest.json",
      authoritative_root: ".opencode/state/memory",
      continuation_path: ".opencode/state/memory/continuation.json",
    },

    resume: {
      continuation_state: "missing",
      summary: "",
      primary_task_ref: "tasks.md#current",
      next_step_hint: "Populate memory files with project context.",
      suggested_reads: ["active-context.md", "tasks.md"],
      last_handoff_at: null,
    },  }
}

/**
 * Refresh a single file entry in the manifest.
 * Reads the file from disk, recomputes hash/size/summary, and returns
 * a new manifest object (does NOT mutate the input manifest).
 */
export function refreshFileEntry(
  projectRoot: string,
  manifest: MemoryManifest,
  fileName: string,
): MemoryManifest {
  const memoryDir = join(projectRoot, PROJECT_MEMORY_DIR)
  const filePath = join(memoryDir, fileName)

  if (!existsSync(filePath)) {
    // File removed — remove from manifest
    const { [fileName]: _removed, ...rest } = manifest.files
    const newLocks = { ...manifest.locks }
    delete newLocks[fileName]

    const newTotal = Object.values(rest).reduce((sum, entry) => sum + entry.size_bytes, 0)

    return {
      ...manifest,
      manifest_updated_at: new Date().toISOString(),
      files: rest,
      locks: newLocks,
      token_budget: {
        ...manifest.token_budget,
        total_cost_chars: newTotal,
        estimated_total_tokens: estimateTokens(newTotal),
        reading_cost: resolveReadingCost(newTotal),
      },
    }
  }

  const stats = statSync(filePath)
  const content = readFileSync(filePath, "utf-8")
  const contentHash = computeContentHash(content)
  const isPlaceholder = detectPlaceholderContent(content)
  const summary = isPlaceholder ? PLACEHOLDER_SUMMARY : extractSummary(content)

  const entry: MemoryFileEntry = {
    size_bytes: stats.size,
    last_modified: stats.mtime.toISOString(),
    content_hash: contentHash,
    summary,
    summary_chars: summary.length,
    section_count: countSections(content),
    is_placeholder: isPlaceholder,
    last_modified_by_agent: manifest.files[fileName]?.last_modified_by_agent ?? null,
    last_modified_by_harness: manifest.files[fileName]?.last_modified_by_harness ?? null,
    encoding: "utf-8",
  }

  const newFiles = { ...manifest.files, [fileName]: entry }
  const newTotal = Object.values(newFiles).reduce((sum, e) => sum + e.size_bytes, 0)

  return {
    ...manifest,
    manifest_updated_at: new Date().toISOString(),
    files: newFiles,
    token_budget: {
      ...manifest.token_budget,
      total_cost_chars: newTotal,
      estimated_total_tokens: estimateTokens(newTotal),
      reading_cost: resolveReadingCost(newTotal),
    },
  }
}

// ---------------------------------------------------------------------------
// Content analysis (mirrors memory-summarizer for self-contained use)
// ---------------------------------------------------------------------------

const LAST_UPDATED_TODO_PATTERN = /Last\s+updated:\s*TODO/i

/**
 * Detect whether markdown content is only template placeholders
 * (headings, TODO items, and "Last updated" boilerplate).
 */
function detectPlaceholderContent(content: string): boolean {
  const nonEmptyLines = content.split("\n").filter((line) => line.trim().length > 0)
  if (nonEmptyLines.length === 0) return true

  const NON_TODO_LINE_PATTERN = /Last\s+updated:/i
  return nonEmptyLines.every((line) => {
    const trimmed = line.trim()
    return (
      trimmed.startsWith("#") ||
      trimmed === "- TODO" ||
      trimmed.startsWith("- TODO ") ||
      LAST_UPDATED_TODO_PATTERN.test(trimmed) ||
      NON_TODO_LINE_PATTERN.test(trimmed)
    )
  })
}

/**
 * Extract a human-readable one-line summary from markdown memory content.
 * Strategy:
 * 1. Skip headings and "Last updated: ..." lines
 * 2. Return the first non-TODO, non-empty line
 * 3. Fallback to "[no summary]" if nothing found
 */
function extractSummary(content: string): string {
  const lines = content.split("\n")
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (line.length === 0) continue
    if (line.startsWith("#")) continue
    if (LAST_UPDATED_TODO_PATTERN.test(line)) continue
    if (/^Last\s+updated:\s*\d{4}/i.test(line)) continue
    if (line === "- TODO" || line.startsWith("- TODO ")) continue

    // Found a meaningful line — truncate to ~120 chars
    if (line.length <= 120) return line
    return line.slice(0, 117) + "..."
  }
  return "[no summary — file contains only structural content]"
}
