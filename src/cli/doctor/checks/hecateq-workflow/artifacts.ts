import { existsSync } from "node:fs"
import { join } from "node:path"

import type { DoctorIssue } from "../../types"
import { getPluginConfigCandidatePaths, readJsoncFile } from "./_shared"
import { PROJECT_CONTRACTS_DIR, PROJECT_TASK_GRAPHS_DIR } from "../../../../shared/memory-bootstrap"

/**
 * Doctor check: Hecateq artifact directory presence.
 *
 * Validates that the contracts and task-graphs directories exist under
 * the project root. These directories are used by the Hecateq orchestration
 * pipeline for task contracts and dependency graphs.
 *
 * Also checks for disabled hecateq-memory-bootstrap hook and reports a
 * more specific warning when auto-creation is blocked by config.
 *
 * Severity: warning (not error — orchestration is an optional feature).
 */
export function collectProjectArtifactIssues(cwd = process.cwd()): DoctorIssue[] {
  const issues: DoctorIssue[] = []

  const contractsDir = join(cwd, PROJECT_CONTRACTS_DIR)
  const taskGraphsDir = join(cwd, PROJECT_TASK_GRAPHS_DIR)

  const contractsMissing = !existsSync(contractsDir)
  const taskGraphsMissing = !existsSync(taskGraphsDir)

  if (contractsMissing || taskGraphsMissing) {
    const missing = [contractsMissing ? PROJECT_CONTRACTS_DIR : null, taskGraphsMissing ? PROJECT_TASK_GRAPHS_DIR : null]
      .filter(Boolean)
      .join(", ")

    // Check if hecateq-memory-bootstrap hook is disabled — affects auto-creation
    const configPaths = getPluginConfigCandidatePaths(cwd)
    let bootstrapDisabled = false
    for (const configPath of configPaths) {
      const parsed = readJsoncFile(configPath)
      if (!parsed) continue
      const hooks = Array.isArray(parsed.disabled_hooks)
        ? parsed.disabled_hooks.filter((v): v is string => typeof v === "string")
        : []
      if (hooks.includes("hecateq-memory-bootstrap")) {
        bootstrapDisabled = true
        break
      }
    }

    const description = bootstrapDisabled
      ? `Hecateq artifact directories not initialized (${missing}). Bootstrap hook \`hecateq-memory-bootstrap\` is disabled — these directories will not be auto-created by the runtime.`
      : `Hecateq artifact directories not initialized (${missing}).`

    issues.push({
      title: "Hecateq artifact directories not initialized",
      description,
      fix: "Start a session with hecateq-memory-bootstrap enabled, or create the directories manually.",
      severity: "warning",
      affects: ["Hecateq orchestration", "task contract storage", "dependency graphs"],
    })
  }

  return issues
}
