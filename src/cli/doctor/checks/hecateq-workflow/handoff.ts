import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

import type { DoctorIssue } from "../../types"

// eslint-disable-next-line @typescript-eslint/no-var-requires
const hp = require("../../../../features/hecateq-orchestration/handoff-role-policy") as {
  AGENT_ROLES: { agent: string; role: string; description: string }[]
  getAgentRole: (agent: string) => string
  hasKnownRole: (agent: string) => boolean
  findUnclassifiedAgents: () => string[]
  findOrphanedRoleEntries: () => { agent: string; role: string; description: string }[]
  describeRolePolicy: (agent: string) => string
}

/**
 * Check for invalid or stale handoff state in the run-continuation marker directory.
 *
 * Scans `.omo/run-continuation/` for marker files whose handoff-associated
 * reason data is either unparseable (invalid JSON) or stale (older than 24 hours
 * since the handoff session ended).
 *
 * This is a content quality check that complements the standard marker presence checks.
 *
 * Returns a DoctorIssue list. Empty array = no issues found.
 */
export function collectHandoffStateIssues(cwd = process.cwd()): DoctorIssue[] {
  const issues: DoctorIssue[] = []
  const runContDir = join(cwd, ".omo", "run-continuation")

  if (!existsSync(runContDir)) return issues

  const now = Date.now()
  const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000

  for (const entry of readdirSync(runContDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue

    const filePath = join(runContDir, entry.name)
    let marker: Record<string, unknown>
    try {
      const raw = readFileSync(filePath, "utf-8")
      marker = JSON.parse(raw) as Record<string, unknown>
    } catch {
      continue
    }

    const sources = marker.sources
    if (!sources || typeof sources !== "object" || Array.isArray(sources)) continue

    const bgTask = (sources as Record<string, unknown>)["background-task"]
    if (!bgTask || typeof bgTask !== "object" || Array.isArray(bgTask)) continue

    const bgRecord = bgTask as Record<string, unknown>
    const reason = bgRecord.reason
    if (typeof reason !== "string" || reason.length === 0) continue

    let parsedReason: Record<string, unknown> | null = null
    try {
      const parsed = JSON.parse(reason)
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        parsedReason = parsed as Record<string, unknown>
      }
    } catch {
      // Reason contains invalid JSON — handoff state corruption
      issues.push({
        title: "Invalid handoff marker detected",
        description: `File: ${filePath}. The 'reason' field in background-task source contains invalid JSON and cannot be parsed as handoff state.`,
        fix: "Clear the corrupted run-continuation marker or fix the handoff data manually.",
        severity: "warning",
        affects: ["handoff state recovery", "run continuation accuracy"],
      })
      continue
    }

    if (!parsedReason) continue

    // Check if this reason contains handoff-like fields
    const hasHandoffFields =
      typeof parsedReason.status === "string" &&
      (typeof parsedReason.handoff === "string" || parsedReason.handoff === undefined)
    if (!hasHandoffFields) continue

    // Check staleness
    const updatedAt = bgRecord.updatedAt
    if (typeof updatedAt !== "string") continue

    const updatedMs = new Date(updatedAt).getTime()
    if (isNaN(updatedMs)) continue

    if (now - updatedMs > STALE_THRESHOLD_MS) {
      issues.push({
        title: "Stale handoff state detected",
        description: `File: ${filePath}. Handoff has been active for more than 24 hours (status: ${String(parsedReason.status)}, target: ${parsedReason.handoff != null ? String(parsedReason.handoff) : "none"}).`,
        fix: "Review the handoff target and clear or restart the run-continuation session if no longer needed.",
        severity: "warning",
        affects: ["handoff state recovery", "run continuation accuracy"],
      })
    }
  }

  return issues
}

/**
 * Wave 3: Check role-policy consistency across known agents.
 *
 * Validates:
 * 1. All known agents (from handoff-parser) are classified into a role
 * 2. No role entries reference agents that no longer exist
 * 3. Reports coverage statistics
 */
export function collectHandoffRolePolicyIssues(): { issues: DoctorIssue[]; details: string[] } {
  const issues: DoctorIssue[] = []
  const details: string[] = []

  // Lazy-import to avoid circular dependency at module load time
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getKnownAgentIds } = require("../../../../features/hecateq-orchestration/handoff-parser") as {
    getKnownAgentIds: () => string[]
  }

  const knownIds = getKnownAgentIds().filter(
    (id: string) => id !== "return_to_caller" && id !== "return_to_parent_for_routing",
  )
  const roleEntries = hp.AGENT_ROLES
  const roles = new Set(roleEntries.map((e) => e.role))

  details.push("Handoff role policy status:")
  details.push(`  Role categories defined: ${roles.size} (${Array.from(roles).join(", ")})`)
  details.push(`  Agents with role classification: ${roleEntries.length}`)
  details.push(`  Known agents (non-routing): ${knownIds.length}`)

  // Check 1: Unclassified agents
  const unclassified = hp.findUnclassifiedAgents()
  if (unclassified.length > 0) {
    issues.push({
      title: "Handoff role policy: unclassified agents",
      description: `${unclassified.length} agent(s) from the known agent list have no role classification: ${unclassified.join(", ")}. These agents will not have role-policy enforcement.`,
      fix: "Add entries for these agents to the AGENT_ROLES registry in handoff-role-policy.ts.",
      severity: "warning",
      affects: ["handoff role-policy enforcement completeness"],
    })
    details.push(`  Unclassified agents: ${unclassified.length} (${unclassified.join(", ")})`)
  } else {
    details.push("  Unclassified agents: 0 — all known agents have a role assignment")
  }

  // Check 2: Orphaned role entries
  const orphaned = hp.findOrphanedRoleEntries()
  if (orphaned.length > 0) {
    issues.push({
      title: "Handoff role policy: orphaned role entries",
      description: `${orphaned.length} role entr${orphaned.length === 1 ? "y" : "ies"} reference agent(s) not in the known agent list: ${orphaned.map((e) => e.agent).join(", ")}. ${orphaned.length === 1 ? "This entry may be stale or reference a planned agent." : "These entries may be stale or reference planned agents."}`,
      fix: "Review and either add the agents to getKnownAgentIds() or remove the role entries.",
      severity: "warning",
      affects: ["handoff role-policy registry accuracy"],
    })
    details.push(`  Orphaned role entries: ${orphaned.length} (${orphaned.map((e) => e.agent).join(", ")})`)
  } else {
    details.push("  Orphaned role entries: 0 — all role entries reference known agents")
  }

  // Coverage by role
  details.push("  Role distribution:")
  const roleDist = new Map<string, number>()
  for (const entry of roleEntries) {
    roleDist.set(entry.role, (roleDist.get(entry.role) ?? 0) + 1)
  }
  for (const [role, count] of Array.from(roleDist.entries()).sort()) {
    details.push(`    ${role}: ${count}`)
  }

  return { issues, details }
}
