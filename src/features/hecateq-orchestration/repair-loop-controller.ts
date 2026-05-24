import type {
  FailureClassification,
  RepairAction,
  RepairLoopResult,
  QualityGateReport,
  TaskNode,
  ResolvedOrchestrationConfig,
} from "./types"

/**
 * Classify a quality gate failure into a structured category.
 */
function classifyFailure(
  gateResult: { gate: string; stderr?: string; stdout?: string },
): FailureClassification {
  const gate = gateResult.gate
  const stderr = (gateResult.stderr ?? "").toLowerCase()
  const stdout = (gateResult.stdout ?? "").toLowerCase()

  if (gate === "typecheck") return "typecheck"
  if (gate === "lint") return "lint"
  if (gate === "test") {
    if (stderr.includes("timeout") || stdout.includes("timeout")) return "timeout"
    return "test"
  }
  if (gate === "build") return "build"

  if (stderr.includes("timeout") || stdout.includes("timeout")) return "timeout"
  if (stderr.includes("error") || stdout.includes("error")) return "runtime"

  return "unknown"
}

/**
 * Suggest files to target based on failure type.
 */
function suggestTargetFiles(
  classification: FailureClassification,
  gates: QualityGateReport,
): string[] {
  const files: string[] = []

  switch (classification) {
    case "typecheck":
      files.push("src/**/*.ts", "src/**/*.tsx")
      break
    case "lint":
      files.push("src/**/*.ts", "src/**/*.tsx")
      break
    case "test":
      files.push("src/**/*.test.ts", "src/**/*.spec.ts")
      break
    case "build":
      files.push("package.json", "tsconfig.json")
      break
    case "runtime":
    case "timeout":
    case "unknown":
      break
  }

  // Add files from failed gates
  for (const result of gates.results) {
    if (!result.passed && !result.skipped) {
      files.push(result.gate)
    }
  }

  return files
}

/**
 * Build a repair prompt for the agent based on failure classification.
 */
function buildRepairPrompt(
  classification: FailureClassification,
  failedGates: QualityGateReport,
): string {
  const failedResults = failedGates.results
    .filter((r) => !r.passed && !r.skipped)

  const details = failedResults
    .map((r) => `- ${r.gate}: ${r.message}${r.stderr ? `\n  stderr: ${r.stderr.slice(0, 200)}` : ""}`)
    .join("\n")

  const classificationMessages: Record<FailureClassification, string> = {
    typecheck: "Fix TypeScript type errors.",
    lint: "Fix lint issues.",
    test: "Fix failing tests.",
    build: "Fix build errors.",
    runtime: "Fix runtime errors.",
    timeout: "Investigate and fix timeout issues.",
    unknown: "Investigate and fix the reported errors.",
  }

  return `Quality gates reported failures:\n${details}\n\nAction: ${classificationMessages[classification] ?? "Fix the reported issues."}\n\nRun the relevant quality gate again after fixing.`
}

/**
 * Run a single repair attempt.
 *
 * This is a pure logic function. Actual execution is delegated to the
 * orchestration controller.
 */
export function createRepairAction(
  taskId: string,
  classification: FailureClassification,
  gates: QualityGateReport,
  attempt: number,
  maxAttempts: number,
): RepairAction {
  return {
    taskId,
    classification,
    failureDescription: `Quality gate failure: ${classification}`,
    targetFiles: suggestTargetFiles(classification, gates),
    repairPrompt: buildRepairPrompt(classification, gates),
    attempt,
    maxAttempts,
    attempted: false,
  }
}

/**
 * Control the repair loop for failed quality gates.
 *
 * Rules:
 * - Maximum retry attempts capped by config.maxRepairAttempts (default: 2)
 * - Each repair targets relevant task/files based on failure classification
 * - Timeout handling: if a gate times out, it is classified as "timeout"
 * - After max attempts, the loop stops and reports failure
 */
export function runRepairLoop(
  gates: QualityGateReport,
  tasks: TaskNode[],
  config: ResolvedOrchestrationConfig,
  runRepair: (action: RepairAction) => RepairAction,
): RepairLoopResult {
  const maxAttempts = config.maxRepairAttempts
  const actions: RepairAction[] = []
  let totalRepairs = 0
  let successfulRepairs = 0
  let failedRepairs = 0
  let hitRetryCap = false

  const failedGates = gates.results.filter((r) => !r.passed && !r.skipped)

  // Create repair actions for each failed gate
  for (const failedGate of failedGates) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const classification = classifyFailure(failedGate)
      const repairAction = createRepairAction(
        `quality_gate_${failedGate.gate}`,
        classification,
        gates,
        attempt,
        maxAttempts,
      )

      const result = runRepair(repairAction)
      totalRepairs++

      if (result.succeeded) {
        successfulRepairs++
        actions.push({ ...result, attempted: true, succeeded: true })
        break // Stop retrying this gate
      }

      if (attempt >= maxAttempts) {
        hitRetryCap = true
        failedRepairs++
        actions.push({
          ...result,
          attempted: true,
          succeeded: false,
          error: `Repair failed after ${maxAttempts} attempts`,
        })
      } else {
        // Continue to next attempt
        actions.push({ ...result, attempted: true, succeeded: false })
      }
    }
  }

  return {
    actions,
    succeeded: failedRepairs === 0,
    totalRepairs,
    successfulRepairs,
    failedRepairs,
    hitRetryCap,
  }
}
