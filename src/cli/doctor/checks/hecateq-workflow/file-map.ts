import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import type { DoctorIssue } from "../../types"
import { PROJECT_MEMORY_DIR } from "../../../../shared/memory-bootstrap"

const GENERATED_PATH_PATTERNS = [
  /(?:^|\s|[/\\])\.next\//,
  /(?:^|\s|[/\\])node_modules\//,
  /(?:^|\s|[/\\])dist\//,
  /(?:^|\s|[/\\])build\//,
  /(?:^|\s|[/\\])coverage\//,
  /(?:^|\s|[/\\])\.turbo\//,
  /(?:^|\s|[/\\])\.cache\//,
  /(?:^|\s|[/\\])out\//,
  /(?:^|\s|[/\\])\.git\//,
  /(?:^|\s|[/\\])__pycache__\//,
  /(?:^|\s|[/\\])\.svelte-kit\//,
]

/**
 * Doctor check: file-map.md generated path detection.
 *
 * Warns when file-map.md contains paths inside generated/build directories.
 */
export function collectFileMapGeneratedPathIssues(cwd = process.cwd()): DoctorIssue[] {
  const issues: DoctorIssue[] = []
  const filePath = join(cwd, PROJECT_MEMORY_DIR, "file-map.md")

  if (!existsSync(filePath)) return issues

  const content = readFileSync(filePath, "utf-8")
  const lines = content.split("\n")
  const matchedLines: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    if (trimmed.startsWith("<!--")) continue

    for (const pattern of GENERATED_PATH_PATTERNS) {
      if (pattern.test(trimmed)) {
        matchedLines.push(trimmed.slice(0, 120))
        break
      }
    }
  }

  if (matchedLines.length > 0) {
    issues.push({
      title: "file-map.md references generated paths",
      description: `file-map.md contains ${matchedLines.length} reference(s) to generated/build paths: ${matchedLines.join("; ")}`,
      fix: "Remove generated directory paths from file-map.md. These paths belong to .gitignore, not the change impact map.",
      severity: "warning",
      affects: ["memory file quality", "context injection accuracy"],
    })
  }

  return issues
}
