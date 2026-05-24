import type {
  OrchestrationReport,
  OrchestrationReportSection,
  ChangedFile,
  PromptIntakeResult,
  DependencyPlan,
  AgentSelectorResult,
  ExecutionPlan,
  QualityGateReport,
  RepairLoopResult,
  ResolvedOrchestrationConfig,
} from "./types"

/**
 * Generate a markdown report section for the prompt intake.
 */
function buildIntakeSection(intake: PromptIntakeResult): OrchestrationReportSection {
  return {
    title: "Prompt Intake",
    body: [
      `- **Intent:** ${intake.intent}`,
      `- **Task Size:** ${intake.taskSize}`,
      `- **Domain Scope:** ${intake.domainScope}`,
      `- **Likely Domains:** ${intake.likelyDomains.join(", ") || "none"}`,
      `- **Risk Level:** ${intake.riskLevel}`,
      `- **Requires Plan:** ${intake.requiresPlan ? "yes" : "no"}`,
      `- **Requires Implementation:** ${intake.requiresImplementation ? "yes" : "no"}`,
      `- **Ambiguous:** ${intake.ambiguous ? "yes" : "no"}`,
      ...(intake.constraints.length > 0 ? [`- **Constraints:** ${intake.constraints.join("; ")}`] : []),
      ...(intake.userExclusions.length > 0 ? [`- **Exclusions:** ${intake.userExclusions.join("; ")}`] : []),
      ...(intake.requestedAgents.length > 0 ? [`- **Requested Agents:** ${intake.requestedAgents.join(", ")}`] : []),
    ].join("\n"),
  }
}

/**
 * Generate a markdown report section for the dependency plan.
 */
function buildDependencySection(plan: DependencyPlan): OrchestrationReportSection {
  const taskDetails = plan.nodes.map((node) => {
    const deps = node.dependsOn.length > 0 ? ` (depends on: ${node.dependsOn.join(", ")})` : ""
    return `  - \`${node.id}\`: ${node.label} [${node.domain}, ${node.action}]${deps}`
  }).join("\n")

  const batchDetails = plan.batches.map(
    (batch, i) => `  - Batch ${i + 1}: ${batch.join(", ")}`,
  ).join("\n")

  return {
    title: "Dependency Plan",
    body: [
      `- **Total Tasks:** ${plan.nodes.length}`,
      `- **Total Batches:** ${plan.totalBatches}`,
      plan.cycle.hasCycle
        ? `- **Cycle Detected:** ${plan.cycle.cycle.join(" -> ")}`
        : "- **No Cycles Detected**",
      plan.blockedTaskIds.length > 0
        ? `- **Blocked Tasks:** ${plan.blockedTaskIds.join(", ")}`
        : "- **No Blocked Tasks**",
      plan.readyTaskIds.length > 0
        ? `- **Ready Tasks:** ${plan.readyTaskIds.join(", ")}`
        : "- **No Ready Tasks**",
      "",
      "### Tasks",
      taskDetails,
      "",
      "### Execution Batches",
      batchDetails,
    ].join("\n"),
  }
}

/**
 * Generate a markdown report section for agent selection.
 */
function buildAgentSection(selection: AgentSelectorResult): OrchestrationReportSection {
  const entryDetails = selection.entries.map((entry) => {
    const matchType = entry.exactMatch ? "exact" : "fallback"
    const status = entry.disabled ? "disabled" : entry.unknown ? "unknown" : "ok"
    const reasonLine = entry.fallbackReason ? `\n    - reason: ${entry.fallbackReason}` : ""
    return `  - \`${entry.taskId}\` → **${entry.selectedAgent}** (${matchType}, ${status})${reasonLine}`
  }).join("\n")

  return {
    title: "Agent Selection",
    body: [
      `- **Exact Matches:** ${selection.exactMatchCount}`,
      `- **Fallback Assignments:** ${selection.fallbackCount}`,
      `- **Unassigned Tasks:** ${selection.unassignedTasks.length}`,
      ...(selection.unassignedTasks.length > 0
        ? selection.unassignedTasks.map((u) => `  - ${u.taskId}: ${u.reason}`)
        : []),
      "",
      "### Assignments",
      entryDetails,
    ].join("\n"),
  }
}

/**
 * Generate a markdown report section for quality gates.
 */
function buildQualitySection(gates: QualityGateReport): OrchestrationReportSection {
  const resultDetails = gates.results.map((result) => {
    if (result.skipped) return `  - **${result.gate}**: skipped (${result.message})`
    const icon = result.passed ? "PASS" : "FAIL"
    const detailLines = [
      `  - **${result.gate}**: ${icon}`,
      `    - command: \`${result.command}\``,
      `    - message: ${result.message}`,
    ]
    if (result.stdout) detailLines.push(`    - stdout: ${result.stdout.slice(0, 200)}`)
    if (result.stderr) detailLines.push(`    - stderr: ${result.stderr.slice(0, 200)}`)
    return detailLines.join("\n")
  }).join("\n")

  const discovered = Object.entries(gates.discoveredCommands).length > 0
    ? `\n\n### Discovered Commands\n${Object.entries(gates.discoveredCommands).map(([k, v]) => `  - ${k}: \`bun run ${v}\``).join("\n")}`
    : "\n\nNo project validation scripts discovered."

  return {
    title: "Quality Gates",
    body: [
      `- **Overall:** ${gates.allPassed ? "ALL PASSED" : "SOME FAILED"}`,
      `- **Passed:** ${gates.passedCount}`,
      `- **Failed:** ${gates.failedCount}`,
      `- **Skipped:** ${gates.skippedCount}`,
      "",
      "### Results",
      resultDetails,
      discovered,
    ].join("\n"),
  }
}

/**
 * Generate a markdown report section for the repair loop.
 */
function buildRepairSection(repair: RepairLoopResult): OrchestrationReportSection {
  const actionDetails = repair.actions.map((action) => {
    const status = action.succeeded ? "FIXED" : action.attempted ? "FAILED" : "PENDING"
    return [
      `  - **Task:** ${action.taskId} (attempt ${action.attempt}/${action.maxAttempts})`,
      `    - Classification: ${action.classification}`,
      `    - Status: ${status}`,
      action.error ? `    - Error: ${action.error}` : "",
      action.targetFiles.length > 0 ? `    - Target files: ${action.targetFiles.join(", ")}` : "",
    ].filter(Boolean).join("\n")
  }).join("\n")

  return {
    title: "Repair Loop",
    body: [
      `- **Overall:** ${repair.succeeded ? "ALL REPAIRS SUCCEEDED" : "SOME REPAIRS FAILED"}`,
      `- **Total Repairs:** ${repair.totalRepairs}`,
      `- **Successful:** ${repair.successfulRepairs}`,
      `- **Failed:** ${repair.failedRepairs}`,
      `- **Hit Retry Cap:** ${repair.hitRetryCap ? "yes" : "no"}`,
      ...(repair.hitRetryCap ? ["\n**WARNING**: Some repairs hit the maximum retry limit."] : []),
      "",
      "### Actions",
      actionDetails,
    ].join("\n"),
  }
}

/**
 * Generate a final evidence-based markdown report for the orchestration run.
 */
export function generateReport(args: {
  prompt: string
  intake: PromptIntakeResult
  depPlan?: DependencyPlan
  agentSelection?: AgentSelectorResult
  execPlan?: ExecutionPlan
  qualityGates?: QualityGateReport
  repairResult?: RepairLoopResult
  changedFiles?: ChangedFile[]
  succeeded: boolean
  config: ResolvedOrchestrationConfig
}): OrchestrationReport {
  const {
    prompt,
    intake,
    depPlan,
    agentSelection,
    qualityGates,
    repairResult,
    changedFiles,
    succeeded,
  } = args

  const sections: OrchestrationReportSection[] = []
  sections.push(buildIntakeSection(intake))

  if (depPlan) {
    sections.push(buildDependencySection(depPlan))
  }

  if (agentSelection) {
    sections.push(buildAgentSection(agentSelection))
  }

  if (qualityGates) {
    sections.push(buildQualitySection(qualityGates))
  }

  if (repairResult) {
    sections.push(buildRepairSection(repairResult))
  }

  const qualityGatesSummary = qualityGates
    ? `Quality gates: ${qualityGates.passedCount} passed, ${qualityGates.failedCount} failed, ${qualityGates.skippedCount} skipped`
    : "Quality gates: not run"

  const repairSummary = repairResult
    ? `Repairs: ${repairResult.successfulRepairs} successful, ${repairResult.failedRepairs} failed${repairResult.hitRetryCap ? " (hit cap)" : ""}`
    : "Repairs: none needed"

  const changedFileSummary = changedFiles && changedFiles.length > 0
    ? changedFiles.map((f) => `  - ${f.changeType}: ${f.path}`).join("\n")
    : "  - No files changed"

  const summary = succeeded
    ? `Orchestration completed successfully. Task size: ${intake.taskSize}, domains: ${intake.likelyDomains.join(", ") || "none"}`
    : `Orchestration failed. Task size: ${intake.taskSize}, domains: ${intake.likelyDomains.join(", ") || "none"}`

  const summarySection: OrchestrationReportSection = {
    title: "Summary",
    body: [
      summary,
      "",
      "### Changed Files",
      changedFileSummary,
      "",
      `### ${qualityGatesSummary}`,
      "",
      `### ${repairSummary}`,
    ].join("\n"),
  }

  sections.unshift(summarySection)

  return {
    timestamp: new Date().toISOString(),
    prompt,
    summary,
    sections,
    changedFiles: changedFiles ?? [],
    qualityGatesSummary,
    repairSummary,
    succeeded,
  }
}

/**
 * Render the report as markdown text.
 */
export function renderReportAsMarkdown(report: OrchestrationReport): string {
  const lines: string[] = [
    `# Hecateq Orchestration Report`,
    ``,
    `**Timestamp:** ${report.timestamp}`,
    `**Status:** ${report.succeeded ? "SUCCESS" : "FAILED"}`,
    ``,
    `## Prompt`,
    ``,
    `\`\`\``,
    report.prompt,
    `\`\`\``,
    ``,
  ]

  for (const section of report.sections) {
    lines.push(`## ${section.title}`, "", section.body, "")
  }

  return lines.join("\n")
}
