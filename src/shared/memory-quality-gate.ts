import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import {
  PROJECT_MEMORY_DIR,
  PROJECT_MEMORY_FILES,
} from "./memory-bootstrap"
import {
  detectPlaceholderContent,
  readManifest,
} from "./memory-manifest"
import {
  readContinuation,
  computeContinuationState,
} from "./memory-continuation"

export interface MemoryReadinessResult {
  score: number
  status: "PASS" | "WARN" | "FAIL"
  issues: Array<{ file: string; issue: string; severity: "low" | "medium" | "high" }>
  checks: Array<{ name: string; passed: boolean; message: string }>
  recommendations: string[]
}

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000
const TOTAL_CHECKS = 9

function getMemoryDir(projectRoot: string): string {
  return join(projectRoot, PROJECT_MEMORY_DIR)
}

function resolveMemoryPath(projectRoot: string, fileName: string): string {
  return join(getMemoryDir(projectRoot), fileName)
}

function checkMemoryFile(
  projectRoot: string,
  fileName: string,
  label: string,
): { passed: boolean; message: string } {
  const filePath = resolveMemoryPath(projectRoot, fileName)

  if (!existsSync(filePath)) {
    return { passed: false, message: `${label} (${fileName}) is missing` }
  }

  const content = readFileSync(filePath, "utf-8")

  if (content.trim().length === 0) {
    return { passed: false, message: `${label} (${fileName}) is empty` }
  }

  if (detectPlaceholderContent(content)) {
    return { passed: false, message: `${label} (${fileName}) contains only template placeholders` }
  }

  return { passed: true, message: `${label} (${fileName}) has real content and looks healthy` }
}

export function checkActiveContext(projectRoot: string): { passed: boolean; message: string } {
  return checkMemoryFile(projectRoot, "active-context.md", "Active Context")
}

export function checkProgress(projectRoot: string): { passed: boolean; message: string } {
  return checkMemoryFile(projectRoot, "progress.md", "Progress")
}

export function checkTasks(projectRoot: string): { passed: boolean; message: string } {
  return checkMemoryFile(projectRoot, "tasks.md", "Tasks")
}

export function checkDecisions(projectRoot: string): { passed: boolean; message: string } {
  return checkMemoryFile(projectRoot, "decisions.md", "Decisions")
}

export function checkQualityHistory(projectRoot: string): { passed: boolean; message: string } {
  return checkMemoryFile(projectRoot, "quality-history.md", "Quality History")
}

export function checkRiskProfile(projectRoot: string): { passed: boolean; message: string } {
  return checkMemoryFile(projectRoot, "risk-profile.md", "Risk Profile")
}

export function checkContinuation(projectRoot: string): { passed: boolean; message: string } {
  const continuation = readContinuation(projectRoot)

  if (!continuation) {
    return { passed: false, message: "No continuation.json found — session state will not persist across restarts" }
  }

  const manifest = readManifest(projectRoot)

  if (!manifest) {
    return { passed: false, message: "No manifest found — cannot verify continuation freshness" }
  }

  try {
    const state = computeContinuationState(projectRoot, manifest)

    if (state === "fresh") {
      return { passed: true, message: "Continuation is fresh and its source hashes match the manifest" }
    }

    if (state === "stale") {
      return { passed: false, message: "Continuation is stale — memory files have changed since the continuation was written" }
    }

    return { passed: false, message: "Continuation state is unknown" }
  } catch {
    return { passed: false, message: "Failed to compute continuation state" }
  }
}

export function checkManifest(projectRoot: string): { passed: boolean; message: string } {
  const manifest = readManifest(projectRoot)

  if (!manifest) {
    return { passed: false, message: "No memory manifest (memory.json) found" }
  }

  if (typeof manifest.manifest_updated_at !== "string") {
    return { passed: false, message: "Manifest is missing manifest_updated_at field" }
  }

  const updatedAt = new Date(manifest.manifest_updated_at).getTime()

  if (isNaN(updatedAt)) {
    return { passed: false, message: "Manifest has an invalid manifest_updated_at timestamp" }
  }

  const age = Date.now() - updatedAt

  if (age > TWENTY_FOUR_HOURS_MS) {
    const hoursAgo = Math.round(age / (60 * 60 * 1000))
    return { passed: false, message: `Manifest was last updated ${hoursAgo}h ago — exceeds 24h freshness window` }
  }

  return { passed: true, message: "Manifest is current (updated within the last 24 hours)" }
}

export function checkPlaceholders(projectRoot: string): { passed: boolean; message: string } {
  const placeholderFiles: string[] = []

  for (const fileName of PROJECT_MEMORY_FILES) {
    const filePath = resolveMemoryPath(projectRoot, fileName)

    if (!existsSync(filePath)) {
      placeholderFiles.push(fileName)
      continue
    }

    const content = readFileSync(filePath, "utf-8")

    if (detectPlaceholderContent(content)) {
      placeholderFiles.push(fileName)
    }
  }

  if (placeholderFiles.length === 0) {
    return { passed: true, message: "No remaining placeholders — all memory files contain real content" }
  }

  return {
    passed: false,
    message: `Found ${placeholderFiles.length} file(s) with remaining placeholders: "${placeholderFiles.join('", "')}"`,
  }
}

export function checkMemoryReadiness(projectRoot: string): MemoryReadinessResult {
  const checkFunctions: Array<{
    name: string
    fn: (root: string) => { passed: boolean; message: string }
  }> = [
    { name: "active-context", fn: checkActiveContext },
    { name: "progress", fn: checkProgress },
    { name: "tasks", fn: checkTasks },
    { name: "decisions", fn: checkDecisions },
    { name: "quality-history", fn: checkQualityHistory },
    { name: "risk-profile", fn: checkRiskProfile },
    { name: "continuation", fn: checkContinuation },
    { name: "manifest", fn: checkManifest },
    { name: "placeholders", fn: checkPlaceholders },
  ]

  const checks: Array<{ name: string; passed: boolean; message: string }> = []
  const issues: Array<{ file: string; issue: string; severity: "low" | "medium" | "high" }> = []
  const recommendations: string[] = []
  let passedCount = 0

  for (const { name, fn } of checkFunctions) {
    const result = fn(projectRoot)
    checks.push({ name, passed: result.passed, message: result.message })

    if (result.passed) {
      passedCount++
    } else {
      const severity = (name === "continuation" || name === "manifest")
        ? "high" as const
        : "medium" as const

      issues.push({
        file: name,
        issue: result.message,
        severity,
      })
    }
  }

  const score = Math.round((passedCount / TOTAL_CHECKS) * 100)

  let status: "PASS" | "WARN" | "FAIL"
  if (score >= 80) {
    status = "PASS"
  } else if (score >= 50) {
    status = "WARN"
  } else {
    status = "FAIL"
  }

  const manifestCheck = checks.find((c) => c.name === "manifest")
  const continuationCheck = checks.find((c) => c.name === "continuation")
  const placeholdersCheck = checks.find((c) => c.name === "placeholders")
  const activeContextCheck = checks.find((c) => c.name === "active-context")
  const progressCheck = checks.find((c) => c.name === "progress")

  if (!manifestCheck?.passed) {
    recommendations.push("Create or update the memory manifest via bootstrapMemoryManifest()")
  }

  if (!continuationCheck?.passed) {
    recommendations.push("Continuation is missing or stale — build a new one via buildContinuation()")
  }

  if (!placeholdersCheck?.passed) {
    recommendations.push("Hydrate placeholder files via bootstrapMemoryFiles({ hydratePlaceholders: true })")
  }

  if (!activeContextCheck?.passed) {
    recommendations.push("Populate active-context.md with the current goal, state, constraints, and known risks")
  }

  if (!progressCheck?.passed) {
    recommendations.push("Record completed milestones and remaining work in progress.md")
  }

  if (passedCount < TOTAL_CHECKS) {
    recommendations.push(`Run bootstrapMemoryFiles() to create any missing memory files and repair placeholders`)
  }

  return { score, status, issues, checks, recommendations }
}
