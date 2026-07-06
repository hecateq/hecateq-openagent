import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { CONFIG_BASENAME, LEGACY_CONFIG_BASENAME, getOpenCodeConfigDir, parseJsonc } from "../../../../shared"
import type { CheckResult, DoctorIssue } from "../../types"

export type PluginConfigRecord = Record<string, unknown>

export const HECATEQ_AGENT_NAME = "hecateq-orchestrator"

export function getPluginConfigCandidatePaths(cwd: string): string[] {
  const userConfigDir = getOpenCodeConfigDir({ binary: "opencode" })
  const projectOpencodeDir = join(cwd, ".opencode")

  return [
    join(userConfigDir, `${CONFIG_BASENAME}.json`),
    join(userConfigDir, `${CONFIG_BASENAME}.jsonc`),
    join(userConfigDir, `${LEGACY_CONFIG_BASENAME}.json`),
    join(userConfigDir, `${LEGACY_CONFIG_BASENAME}.jsonc`),
    join(projectOpencodeDir, `${CONFIG_BASENAME}.json`),
    join(projectOpencodeDir, `${CONFIG_BASENAME}.jsonc`),
    join(projectOpencodeDir, `${LEGACY_CONFIG_BASENAME}.json`),
    join(projectOpencodeDir, `${LEGACY_CONFIG_BASENAME}.jsonc`),
  ]
}

export function readJsoncFile(filePath: string): PluginConfigRecord | null {
  try {
    if (!existsSync(filePath)) return null
    return parseJsonc<PluginConfigRecord>(readFileSync(filePath, "utf-8"))
  } catch {
    return null
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function buildIssueStatus(issues: DoctorIssue[]): CheckResult["status"] {
  if (issues.some((issue) => issue.severity === "error")) return "fail"
  if (issues.some((issue) => issue.severity === "warning")) return "warn"
  return "pass"
}

export function buildIssueMessage(status: CheckResult["status"], issues: DoctorIssue[]): string {
  if (status === "pass") return "Hecateq workflow checks passed"
  if (status === "fail") return `${issues.length} Hecateq workflow issue(s) detected`
  return `${issues.length} Hecateq workflow warning(s) detected`
}

export type SecretFinding = {
  filePath: string
  keyPath: string
  maskedValue: string
}
