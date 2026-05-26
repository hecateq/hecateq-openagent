import { join } from "node:path"
import {
  collectAgentIndexIssues,
  collectHecateqRegistrationIssues,
  collectHecateqConfigIssues,
  collectOrchestrationIssues,
  collectSafetyHookIssues,
  collectHandoffStateIssues,
  collectHandoffRolePolicyIssues,
  collectProjectRootMemoryIssues,
  collectMemoryQualityIssues,
  collectMemoryManifestIssues,
  collectMemoryPointerIssues,
  collectContinuationFreshnessIssues,
  collectCustomAgentIssues,
  collectProjectArtifactIssues,
} from "../doctor/checks/hecateq-workflow"

export interface HecateqDoctorOptions {
  projectDir?: string
  verbose?: boolean
  json?: boolean
}

export interface HecateqDoctorResult {
  categories: Array<{
    name: string
    issues: Array<{ title: string; description: string; severity: string }>
    details: string[]
    status: "pass" | "warn" | "fail"
  }>
}

/**
 * `hecateq doctor` — surface Hecateq workflow diagnostics.
 * Aggregates all hecateq-specific checks from the existing doctor infrastructure
 * into a focused diagnostic output.
 */
export function hecateqDoctor(options: HecateqDoctorOptions): HecateqDoctorResult {
  const { projectDir = process.cwd(), verbose = false, json } = options

  const categories: HecateqDoctorResult["categories"] = []

  // 1. Registration
  const regIssues = collectHecateqRegistrationIssues()
  categories.push({
    name: "Agent Registration",
    issues: regIssues.map((i) => ({ title: i.title, description: i.description, severity: i.severity })),
    details: regIssues.map((i) => i.fix ?? ""),
    status: regIssues.some((i) => i.severity === "error") ? "fail" : regIssues.length > 0 ? "warn" : "pass",
  })

  // 2. Config
  const configResult = collectHecateqConfigIssues(projectDir)
  categories.push({
    name: "Configuration",
    issues: configResult.issues.map((i) => ({ title: i.title, description: i.description, severity: i.severity })),
    details: configResult.details,
    status: configResult.issues.some((i) => i.severity === "error") ? "fail" : configResult.issues.length > 0 ? "warn" : "pass",
  })

  // 3. Orchestration
  const orchResult = collectOrchestrationIssues(projectDir)
  categories.push({
    name: "Orchestration",
    issues: orchResult.issues.map((i) => ({ title: i.title, description: i.description, severity: i.severity })),
    details: orchResult.details,
    status: orchResult.issues.some((i) => i.severity === "error") ? "fail" : orchResult.issues.length > 0 ? "warn" : "pass",
  })

  // 4. Safety hooks
  const safetyIssues = collectSafetyHookIssues(projectDir)
  categories.push({
    name: "Safety Hooks",
    issues: safetyIssues.map((i) => ({ title: i.title, description: i.description, severity: i.severity })),
    details: [],
    status: safetyIssues.some((i) => i.severity === "error") ? "fail" : safetyIssues.length > 0 ? "warn" : "pass",
  })

  // 5. Handoff state
  const handoffIssues = collectHandoffStateIssues(projectDir)
  categories.push({
    name: "Handoff State",
    issues: handoffIssues.map((i) => ({ title: i.title, description: i.description, severity: i.severity })),
    details: [],
    status: handoffIssues.some((i) => i.severity === "error") ? "fail" : handoffIssues.length > 0 ? "warn" : "pass",
  })

  // 6. Handoff role policy
  const roleResult = collectHandoffRolePolicyIssues()
  categories.push({
    name: "Role Policy",
    issues: roleResult.issues.map((i) => ({ title: i.title, description: i.description, severity: i.severity })),
    details: roleResult.details,
    status: roleResult.issues.some((i) => i.severity === "error") ? "fail" : roleResult.issues.length > 0 ? "warn" : "pass",
  })

  // 7. Project memory
  const memIssues = collectProjectRootMemoryIssues(projectDir)
  const memQualityIssues = collectMemoryQualityIssues(projectDir)
  categories.push({
    name: "Project Memory",
    issues: [...memIssues, ...memQualityIssues].map((i) => ({ title: i.title, description: i.description, severity: i.severity })),
    details: [],
    status: [...memIssues, ...memQualityIssues].some((i) => i.severity === "error") ? "fail" : [...memIssues, ...memQualityIssues].length > 0 ? "warn" : "pass",
  })

  // 8. Manifest & pointers
  const manifestIssues = collectMemoryManifestIssues(projectDir)
  const pointerIssues = collectMemoryPointerIssues(projectDir)
  const contIssues = collectContinuationFreshnessIssues(projectDir)
  const allManifestRelated = [...manifestIssues, ...pointerIssues, ...contIssues]
  categories.push({
    name: "Memory Manifest",
    issues: allManifestRelated.map((i) => ({ title: i.title, description: i.description, severity: i.severity })),
    details: [],
    status: allManifestRelated.some((i) => i.severity === "error") ? "fail" : allManifestRelated.length > 0 ? "warn" : "pass",
  })

  // 9. Custom agents
  const agentIssues = collectCustomAgentIssues(projectDir)
  categories.push({
    name: "Custom Agents",
    issues: agentIssues.map((i) => ({ title: i.title, description: i.description, severity: i.severity })),
    details: [],
    status: agentIssues.some((i) => i.severity === "error") ? "fail" : agentIssues.length > 0 ? "warn" : "pass",
  })

  // 10. Agent index
  const indexResult = collectAgentIndexIssues()
  categories.push({
    name: "Agent Index",
    issues: indexResult.issues.map((i) => ({ title: i.title, description: i.description, severity: i.severity })),
    details: indexResult.details,
    status: indexResult.issues.some((i) => i.severity === "error") ? "fail" : indexResult.issues.length > 0 ? "warn" : "pass",
  })

  // 11. Artifacts
  const artifactIssues = collectProjectArtifactIssues(projectDir)
  categories.push({
    name: "Artifacts",
    issues: artifactIssues.map((i) => ({ title: i.title, description: i.description, severity: i.severity })),
    details: [],
    status: artifactIssues.some((i) => i.severity === "error") ? "fail" : artifactIssues.length > 0 ? "warn" : "pass",
  })

  // Output
  if (!json) {
    console.log("")
    console.log("=== Hecateq Doctor ===")
    console.log("")

    for (const cat of categories) {
      const statusSymbol = cat.status === "pass" ? "✓" : cat.status === "fail" ? "✗" : "⚠"
      console.log(` ${statusSymbol} ${cat.name}: ${cat.status.toUpperCase()}`)

      if (cat.issues.length > 0) {
        for (const issue of cat.issues) {
          const sym = issue.severity === "error" ? "  ✗" : "  ⚠"
          console.log(`${sym} ${issue.title}`)
          if (verbose) {
            console.log(`     ${issue.description}`)
          }
        }
      }

      if (verbose && cat.details.length > 0) {
        for (const d of cat.details) {
          console.log(`   ${d}`)
        }
      }

      console.log("")
    }
  }

  return { categories }
}
