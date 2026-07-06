import type { DoctorIssue } from "../../types"
import { type PluginConfigRecord, getPluginConfigCandidatePaths, readJsoncFile } from "./_shared"

const SAFETY_HOOKS = [
  "stop-continuation-guard",
  "unstable-agent-babysitter",
  "notepad-write-guard",
  "plan-format-validator",
  "comment-checker",
] as const

function getDisabledHookLocations(cwd: string, hookName: string): string[] {
  return getPluginConfigCandidatePaths(cwd)
    .map((configPath) => ({ configPath, parsed: readJsoncFile(configPath) }))
    .filter((entry): entry is { configPath: string; parsed: PluginConfigRecord } => entry.parsed !== null)
    .filter((entry) => {
      const hooks = Array.isArray(entry.parsed.disabled_hooks)
        ? entry.parsed.disabled_hooks.filter((value): value is string => typeof value === "string")
        : []
      return hooks.includes(hookName)
    })
    .map((entry) => entry.configPath)
}

export function collectSafetyHookIssues(cwd = process.cwd()): DoctorIssue[] {
  const issues: DoctorIssue[] = []
  const configPaths = getPluginConfigCandidatePaths(cwd)

  const disabledHooks = new Map<string, string[]>()
  for (const configPath of configPaths) {
    const parsed = readJsoncFile(configPath)
    if (!parsed) continue
    const hooks = Array.isArray(parsed.disabled_hooks) ? parsed.disabled_hooks.filter((value): value is string => typeof value === "string") : []
    for (const hook of hooks) {
      if (!disabledHooks.has(hook)) disabledHooks.set(hook, [])
      disabledHooks.get(hook)?.push(configPath)
    }
  }

  for (const hookName of SAFETY_HOOKS) {
    const locations = disabledHooks.get(hookName)
    if (!locations || locations.length === 0) continue

    const affects = {
      "stop-continuation-guard": "stopping/cancelling runaway continuations",
      "unstable-agent-babysitter": "runaway unstable subagent containment",
      "notepad-write-guard": "safe notepad writes",
      "plan-format-validator": "plan output structure validation",
      "comment-checker": "comment policy enforcement",
    }[hookName]

    issues.push({
      title: `Safety hook disabled: ${hookName}`,
      description: `Disabled in: ${locations.join(", ")}`,
      fix: `Remove \`${hookName}\` from disabled_hooks if you want this safety check active.`,
      severity: "warning",
      affects: [affects],
    })
  }

  return issues
}
