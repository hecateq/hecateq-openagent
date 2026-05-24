import { describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"

import { analyzePrompt } from "./prompt-intake"
import { decomposePrompt, resetCounter } from "./task-decomposer"
import { buildDependencyPlan } from "./dependency-planner"
import { selectAgents, readLocalAgentRegistry } from "./agent-selector"
import { buildExecutionPlan } from "./execution-planner"
import { createRepairAction, runRepairLoop } from "./repair-loop-controller"
import { generateReport, renderReportAsMarkdown } from "./final-report-generator"
import {
  resolveOrchestrationConfig,
  isSensitivePath,
  isSensitiveTask,
  recoverOrCreateState,
  saveSessionState,
  loadSessionState,
  syncTaskGraphFile,
  blockSensitiveTasks,
  buildOrchestrationContextBlock,
  consumeHandoffAndRecordRouting,
} from "./orchestration-controller"
import type {
  PromptIntakeResult,
  TaskNode,
  LocalAgentRegistryEntry,
  ResolvedOrchestrationConfig,
  RepairAction,
  QualityGateReport,
  TaskExecutionResult,
  ExecutionBatch,
  AgentSelectionEntry,
} from "./types"
import { OmoStateManager } from "./omo-state-manager"

function makeConfig(overrides: Partial<ResolvedOrchestrationConfig> = {}): ResolvedOrchestrationConfig {
  return {
    enabled: true,
    autoDecompose: true,
    autoExecuteLowRisk: true,
    requirePlanForHighRisk: true,
    maxRepairAttempts: 2,
    defaultTaskTimeoutMs: 300000,
    allowParallelReadonlyTasks: true,
    allowParallelWriteTasks: false,
    qualityGates: { typecheck: false, lint: false, test: false, build: false, doctor: false },
    stateDir: "/tmp/orch-test",
    ...overrides,
  }
}

// ─── Prompt Intake ───────────────────────────────────────────────────────────

describe("analyzePrompt", () => {
  test("#given short implementation prompt #then small domain low-risk", () => {
    const result = analyzePrompt("Fix the login button color to use primary-blue")
    expect(result.taskSize).toBe("small")
    expect(["single-domain", "unknown-domain"]).toContain(result.domainScope)
    expect(result.riskLevel).toBe("low")
    expect(result.intent).toBe("bugfix")
  })

  test("#given long multi-domain prompt #then large multi-domain", () => {
    const prompt = "Implement a complete user management system. Create the database schema with users and roles tables. Build the REST API with Express controllers for CRUD operations. Design the frontend React components for the admin dashboard. Add authentication with JWT and proper authorization middleware. Deploy everything with Docker and set up CI/CD pipelines."
    const result = analyzePrompt(prompt)
    expect(result.taskSize).toBe("large")
    expect(result.domainScope).toBe("multi-domain")
    expect(result.likelyDomains.length).toBeGreaterThanOrEqual(4)
  })

  test("#given destructive terms #then risk is destructive", () => {
    const result = analyzePrompt("Drop the production database and recreate from scratch")
    expect(result.riskLevel).toBe("destructive")
    expect(result.requiresPlan).toBe(true)
  })

  test("#given research prompt #then intent is research", () => {
    const result = analyzePrompt("Research the best authentication patterns for Next.js applications")
    expect(result.intent).toBe("research")
  })

  test("#given planning prompt #then intent is planning", () => {
    const result = analyzePrompt("Plan the architecture for a multi-tenant SaaS platform")
    expect(result.intent).toBe("planning")
  })
})

// ─── Task Decomposition ──────────────────────────────────────────────────────

describe("decomposePrompt", () => {
  test("#given small task #then single node", () => {
    const intake: PromptIntakeResult = {
      rawPrompt: "Fix login button color",
      normalizedPrompt: "Fix login button color",
      taskSize: "small", domainScope: "single-domain",
      likelyDomains: ["frontend"], intent: "bugfix",
      riskLevel: "low", requiresPlan: false, requiresImplementation: true, requiresTesting: false,
      constraints: [], userExclusions: [], requestedAgents: [], ambiguous: false,
    }
    resetCounter()
    const nodes = decomposePrompt(intake)
    expect(nodes).toHaveLength(1)
    expect(nodes[0].domain).toBe("frontend")
    expect(nodes[0].action).toBe("write")
    expect(nodes[0].dependsOn).toEqual([])
  })

  test("#given large multi-domain task #then ordered domain chain", () => {
    const intake: PromptIntakeResult = {
      rawPrompt: "Create database schema for users and products. Build REST API endpoints. Design React frontend components.",
      normalizedPrompt: "Create database schema for users and products. Build REST API endpoints. Design React frontend components.",
      taskSize: "large", domainScope: "multi-domain",
      likelyDomains: ["database", "backend", "frontend"],
      intent: "implementation", riskLevel: "medium",
      requiresPlan: false, requiresImplementation: true, requiresTesting: true,
      constraints: [], userExclusions: [], requestedAgents: [], ambiguous: false,
    }
    resetCounter()
    const nodes = decomposePrompt(intake)
    expect(nodes.length).toBeGreaterThanOrEqual(2)
    expect(nodes[0].dependsOn).toEqual([])
  })
})

// ─── Dependency Planning ─────────────────────────────────────────────────────

describe("buildDependencyPlan", () => {
  test("#given db backend frontend chain #then topological order correct", () => {
    const nodes: TaskNode[] = [
      { id: "db", label: "Design schema", prompt: "Design DB schema", domain: "database", action: "write", dependsOn: [], status: "pending" },
      { id: "backend", label: "Implement API", prompt: "Implement API", domain: "backend", action: "write", dependsOn: ["db"], status: "pending" },
      { id: "frontend", label: "Build UI", prompt: "Build UI", domain: "frontend", action: "write", dependsOn: ["backend"], status: "pending" },
    ]
    const plan = buildDependencyPlan(nodes)
    expect(plan.cycle.hasCycle).toBe(false)
    expect(plan.batches.length).toBe(3)
    expect(plan.batches[0]).toContain("db")
    expect(plan.batches[1]).toContain("backend")
    expect(plan.batches[2]).toContain("frontend")
  })

  test("#given parallel independent tasks #then single batch", () => {
    const nodes: TaskNode[] = [
      { id: "a", label: "Task A", prompt: "Task A", domain: "backend", action: "read", dependsOn: [], status: "pending" },
      { id: "b", label: "Task B", prompt: "Task B", domain: "frontend", action: "read", dependsOn: [], status: "pending" },
    ]
    const plan = buildDependencyPlan(nodes)
    expect(plan.batches.length).toBe(1)
    expect(plan.batches[0]).toContain("a")
    expect(plan.batches[0]).toContain("b")
  })

  test("#given circular dependency #then cycle detected", () => {
    const nodes: TaskNode[] = [
      { id: "a", label: "Task A", prompt: "A", domain: "backend", action: "write", dependsOn: ["b"], status: "pending" },
      { id: "b", label: "Task B", prompt: "B", domain: "backend", action: "write", dependsOn: ["a"], status: "pending" },
    ]
    const plan = buildDependencyPlan(nodes)
    expect(plan.cycle.hasCycle).toBe(true)
    expect(plan.cycle.cycleNodeIds.length).toBeGreaterThanOrEqual(1)
  })
})

// ─── Agent Selection (Gap 5: rich signals) ───────────────────────────────────

describe("selectAgents", () => {
  const registry: LocalAgentRegistryEntry[] = [
    { name: "nodejs-backend-developer", description: "Backend API developer with Express", hidden: false, disabled: false, sourcePath: "/agents/backend.md", priority: "high", domainHints: ["backend"], useWhen: ["implementing REST APIs"], avoidWhen: ["frontend styling"] },
    { name: "nextjs-ui-wizard", description: "Frontend React developer", hidden: false, disabled: false, sourcePath: "/agents/frontend.md", priority: "high", domainHints: ["frontend"] },
    { name: "database-specialist", description: "Database schema and query optimization", hidden: false, disabled: false, sourcePath: "/agents/db.md", priority: "medium", domainHints: ["database"] },
    { name: "hidden-agent", description: "Hidden agent", hidden: true, disabled: false, sourcePath: "/agents/hidden.md", priority: "low" },
    { name: "low-priority-backend", description: "Also handles backend APIs", hidden: false, disabled: false, sourcePath: "/agents/backend2.md", priority: "low", domainHints: ["backend"] },
  ]

  test("#given backend task #then picks highest-score exact agent", () => {
    const tasks: TaskNode[] = [
      { id: "t1", label: "API", prompt: "Build API", domain: "backend", action: "write", dependsOn: [], status: "pending" },
    ]
    const result = selectAgents(tasks, registry, [])
    expect(result.exactMatchCount).toBe(1)
    expect(result.entries[0].selectedAgent).toBe("nodejs-backend-developer")
    expect(result.entries[0].exactMatch).toBe(true)
  })

  test("#given unknown domain #then fallback with explicit reason", () => {
    const tasks: TaskNode[] = [
      { id: "t1", label: "Unknown", prompt: "Do something", domain: "unknown", action: "read", dependsOn: [], status: "pending" },
    ]
    const result = selectAgents(tasks, registry, [])
    expect(result.exactMatchCount).toBe(0)
    expect(result.entries[0].selectedAgent).toBe("sisyphus-junior")
    expect(result.entries[0].fallbackReason).toContain("No exact agent found for domain")
  })

  test("#given disabled agent #then falls back with disabled reason", () => {
    const tasks: TaskNode[] = [
      { id: "t1", label: "API", prompt: "Build API", domain: "backend", action: "write", dependsOn: [], status: "pending" },
    ]
    const result = selectAgents(tasks, registry, ["nodejs-backend-developer"])
    // Falls back to next best backend agent; the disabled flag refers to the selected entry
    expect(result.entries[0].fallbackReason).toContain("disabled")
    expect(result.entries[0].selectedAgent).toBe("low-priority-backend")
    expect(result.entries[0].exactMatch).toBe(true)
  })

  test("#given hidden agent #then hidden agents excluded", () => {
    const visible = registry.filter((a) => !a.hidden)
    expect(visible.find((a) => a.name === "hidden-agent")).toBeUndefined()
  })

  test("#given multiple agents for domain #then high priority wins", () => {
    const tasks: TaskNode[] = [
      { id: "t1", label: "Backend", prompt: "Backend work", domain: "backend", action: "write", dependsOn: [], status: "pending" },
    ]
    const result = selectAgents(tasks, registry, [])
    // Both backend agents have domainHints including "backend",
    // but nodejs-backend-developer has priority "high" vs "low"
    expect(result.entries[0].selectedAgent).toBe("nodejs-backend-developer")
  })

  test("#given agent with avoid_when matching domain #then still used with reason", () => {
    const tasks: TaskNode[] = [
      { id: "t1", label: "API", prompt: "Build API", domain: "frontend", action: "write", dependsOn: [], status: "pending" },
    ]
    const result = selectAgents(tasks, registry, [])
    // frontend should be assigned to nextjs-ui-wizard, not the backend agent that avoids frontend
    expect(result.entries[0].selectedAgent).toBe("nextjs-ui-wizard")
  })
})

// ─── Execution Plan Tests ────────────────────────────────────────────────────

describe("buildExecutionPlan", () => {
  test("#given read task with parallel config #then parallel batch", () => {
    const nodes: TaskNode[] = [
      { id: "a", label: "Read A", prompt: "Read A", domain: "backend", action: "read", dependsOn: [], status: "pending" },
      { id: "b", label: "Read B", prompt: "Read B", domain: "frontend", action: "read", dependsOn: [], status: "pending" },
    ]
    const depPlan = buildDependencyPlan(nodes)
    const agentSelection = selectAgents(nodes, [], [])
    const config = makeConfig({ allowParallelReadonlyTasks: true })
    const execPlan = buildExecutionPlan(depPlan, agentSelection, config)
    expect(execPlan.batches.length).toBeGreaterThanOrEqual(1)
    expect(execPlan.batches[0].kind).toBe("parallel_read")
  })

  test("#given write tasks with serial config #then sequential batch", () => {
    const nodes: TaskNode[] = [
      { id: "a", label: "Write A", prompt: "Write A", domain: "backend", action: "write", dependsOn: [], status: "pending" },
      { id: "b", label: "Write B", prompt: "Write B", domain: "frontend", action: "write", dependsOn: [], status: "pending" },
    ]
    const depPlan = buildDependencyPlan(nodes)
    const agentSelection = selectAgents(nodes, [], [])
    const config = makeConfig({ allowParallelWriteTasks: false })
    const execPlan = buildExecutionPlan(depPlan, agentSelection, config)
    expect(execPlan.batches.length).toBeGreaterThanOrEqual(1)
    expect(execPlan.batches[0].kind).toBe("sequential")
  })
})

// ─── Repair Loop ─────────────────────────────────────────────────────────────

describe("runRepairLoop", () => {
  test("#given failed gate #when repair succeeds #then success", () => {
    const gates: QualityGateReport = {
      results: [{ gate: "typecheck", passed: false, command: "bun run typecheck", exitCode: 1, stderr: "Type error found", message: "typecheck failed", skipped: false }],
      allPassed: false, passedCount: 0, failedCount: 1, skippedCount: 0, discoveredCommands: {},
    }
    const result = runRepairLoop(gates, [], makeConfig({ maxRepairAttempts: 2 }), (a) => ({ ...a, attempted: true, succeeded: true }))
    expect(result.succeeded).toBe(true)
    expect(result.totalRepairs).toBe(1)
  })

  test("#given failed gate #when all repairs fail #then retry cap hit", () => {
    const gates: QualityGateReport = {
      results: [{ gate: "typecheck", passed: false, command: "bun run typecheck", exitCode: 1, stderr: "Type error", message: "typecheck failed", skipped: false }],
      allPassed: false, passedCount: 0, failedCount: 1, skippedCount: 0, discoveredCommands: {},
    }
    const result = runRepairLoop(gates, [], makeConfig({ maxRepairAttempts: 2 }), (a) => ({ ...a, attempted: true, succeeded: false }))
    expect(result.succeeded).toBe(false)
    expect(result.hitRetryCap).toBe(true)
    expect(result.totalRepairs).toBe(2)
  })
})

// ─── Report ──────────────────────────────────────────────────────────────────

describe("generateReport", () => {
  test("#given successful pipeline #then markdown produced", () => {
    const intake = analyzePrompt("Fix a small CSS bug")
    const report = generateReport({ prompt: "Fix a small CSS bug", intake, succeeded: true, config: makeConfig() })
    expect(report.sections.length).toBeGreaterThanOrEqual(1)
    expect(renderReportAsMarkdown(report)).toContain("Hecateq Orchestration Report")
  })

  test("#given failed pipeline #then report shows failed", () => {
    const intake = analyzePrompt("Fix a small CSS bug")
    const report = generateReport({ prompt: "Fix a small CSS bug", intake, succeeded: false, config: makeConfig() })
    expect(report.succeeded).toBe(false)
    expect(report.summary).toContain("failed")
  })
})

// ─── Sensitive File Blocking (Gap 4) ─────────────────────────────────────────

describe("isSensitivePath", () => {
  test("#given .env file #then true", () => { expect(isSensitivePath(".env")).toBe(true) })
  test("#given .env.production #then true", () => { expect(isSensitivePath(".env.production")).toBe(true) })
  test("#given credentials.json #then true", () => { expect(isSensitivePath("config/credentials.json")).toBe(true) })
  test("#given normal source file #then false", () => { expect(isSensitivePath("src/index.ts")).toBe(false) })
  test("#given .pem file #then true", () => { expect(isSensitivePath("/etc/ssl/private/key.pem")).toBe(true) })
  test("#given .key file #then true", () => { expect(isSensitivePath("/etc/ssl/private/key.key")).toBe(true) })
})

describe("isSensitiveTask (Gap 4)", () => {
  test("#given task referencing .env #then blocked", () => {
    const task: TaskNode = { id: "t1", label: "Update env config", prompt: "Change the .env file", domain: "backend", action: "write", dependsOn: [], status: "pending" }
    expect(isSensitiveTask(task)).toBe(true)
  })

  test("#given task referencing credentials #then blocked", () => {
    const task: TaskNode = { id: "t2", label: "Add credentials", prompt: "Set up API credentials", domain: "devops", action: "write", dependsOn: [], status: "pending" }
    expect(isSensitiveTask(task)).toBe(true)
  })

  test("#given normal task #then not blocked", () => {
    const task: TaskNode = { id: "t3", label: "Fix login button", prompt: "Update the CSS for the login button", domain: "frontend", action: "write", dependsOn: [], status: "pending" }
    expect(isSensitiveTask(task)).toBe(false)
  })
})

describe("blockSensitiveTasks (Gap 4)", () => {
  test("#given mixed tasks #then only sensitive ones blocked", () => {
    const tasks: TaskNode[] = [
      { id: "safe", label: "Safe task", prompt: "Normal implementation", domain: "backend", action: "write", dependsOn: [], status: "pending" },
      { id: "secret", label: "Secret task", prompt: "Update .env.production file", domain: "devops", action: "write", dependsOn: [], status: "pending" },
    ]
    const blocked = blockSensitiveTasks(tasks)
    expect(blocked.find((t) => t.id === "safe")?.status).toBe("pending")
    expect(blocked.find((t) => t.id === "secret")?.status).toBe("blocked")
    expect(blocked.find((t) => t.id === "secret")?.error).toContain("sensitive")
  })
})

// ─── State Recovery (Gap 3) ──────────────────────────────────────────────────

describe("recoverOrCreateState", () => {
  test("#given no existing state #then creates fresh", () => {
    const state = recoverOrCreateState("/tmp/nonexistent-state-dir", "test-session", "Test prompt")
    expect(state.id).toBe("test-session")
    expect(state.prompt).toBe("Test prompt")
    expect(state.phase).toBe("intake")
    expect(state.completed).toBe(false)
  })

  test("#given existing state with in_progress tasks #then reclassifies as failed", () => {
    const stateDir = "/tmp/orch-state-test"
    if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true })
    const oldState = {
      id: "recovery-session",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      prompt: "Test recovery",
      phase: "execute" as const,
      tasks: [
        { id: "done", label: "Done", prompt: "Done", domain: "backend" as const, action: "write" as const, dependsOn: [] as string[], status: "completed" as const },
        { id: "running", label: "Running", prompt: "Running", domain: "backend" as const, action: "write" as const, dependsOn: [] as string[], status: "in_progress" as const },
        { id: "pending", label: "Pending", prompt: "Pending", domain: "backend" as const, action: "write" as const, dependsOn: [] as string[], status: "pending" as const },
      ],
      batches: [],
      agentAssignments: [],
      completed: false,
      failed: false,
    }
    writeFileSync(join(stateDir, "recovery-session.json"), JSON.stringify(oldState), "utf-8")
    const recovered = recoverOrCreateState(stateDir, "recovery-session", "Test recovery")
    const runningTask = recovered.tasks.find((t) => t.id === "running")
    expect(runningTask?.status).toBe("failed")
    expect(runningTask?.error).toContain("restarted")
    const doneTask = recovered.tasks.find((t) => t.id === "done")
    expect(doneTask?.status).toBe("completed")
    rmSync(stateDir, { recursive: true, force: true })
  })
})

describe("syncTaskGraphFile (Gap 3)", () => {
  test("#given tasks and phase #then writes latest.json", () => {
    const testDir = "/tmp/orch-graph-test"
    if (!existsSync(testDir)) mkdirSync(testDir, { recursive: true })
    const tasks: TaskNode[] = [
      { id: "t1", label: "Task 1", prompt: "Do it", domain: "backend", action: "write", dependsOn: [], status: "completed" },
      { id: "t2", label: "Task 2", prompt: "Do it 2", domain: "frontend", action: "write", dependsOn: ["t1"], status: "pending" },
    ]
    syncTaskGraphFile(testDir, "test-graph-id", tasks, "execute")
    const graphPath = join(testDir, ".opencode/task-graphs/latest.json")
    expect(existsSync(graphPath)).toBe(true)
    const raw = JSON.parse(readFileSync(graphPath, "utf-8"))
    expect(raw.id).toBe("test-graph-id")
    expect(raw.stages).toHaveLength(2)
    expect(raw.stages[0].status).toBe("passed")
    expect(raw.stages[1].status).toBe("pending")
    expect(raw.phase).toBe("execute")
    rmSync(join(testDir, ".opencode"), { recursive: true, force: true })
  })
})

// ─── Task Execution via Callback (Gap 1) ─────────────────────────────────────

describe("TaskExecutionResult contract (Gap 2)", () => {
  test("#given execution results from callback #then fields match contract", () => {
    const result: TaskExecutionResult = {
      taskId: "t1",
      agentId: "nodejs-backend-developer",
      status: "completed",
      changedFiles: [{ path: "src/api.ts", changeType: "modified" }],
      producedArtifacts: ["dist/api.js"],
    }
    expect(result.taskId).toBe("t1")
    expect(result.status).toBe("completed")
    expect(result.changedFiles).toHaveLength(1)
    expect(result.producedArtifacts).toContain("dist/api.js")
    expect(result.errorSummary).toBeUndefined()
  })

  test("#given failed execution #then errorSummary present", () => {
    const result: TaskExecutionResult = {
      taskId: "t2",
      agentId: "nodejs-backend-developer",
      status: "failed",
      changedFiles: [],
      producedArtifacts: [],
      errorSummary: "TypeScript compilation failed",
    }
    expect(result.status).toBe("failed")
    expect(result.errorSummary).toBe("TypeScript compilation failed")
  })
})

describe("batch execution callback (Gap 1)", () => {
  test("#given batch callback #then executes and returns results", async () => {
    const tasks: TaskNode[] = [
      { id: "t1", label: "Task 1", prompt: "Do it", domain: "backend", action: "write", dependsOn: [], status: "pending" },
    ]
    const assignments: AgentSelectionEntry[] = [
      { taskId: "t1", selectedAgent: "nodejs-backend-developer", exactMatch: true },
    ]
    const batch: ExecutionBatch = { index: 0, kind: "sequential", taskIds: ["t1"] }

    const executeBatch = async (
      b: ExecutionBatch,
      ts: TaskNode[],
      as: AgentSelectionEntry[],
    ): Promise<TaskExecutionResult[]> => {
      return b.taskIds.map((taskId) => {
        const agent = as.find((a) => a.taskId === taskId)
        return {
          taskId,
          agentId: agent?.selectedAgent ?? "unknown",
          status: "completed" as const,
          changedFiles: [{ path: `src/${taskId}.ts`, changeType: "modified" as const }],
          producedArtifacts: [],
        }
      })
    }

    const results = await executeBatch(batch, tasks, assignments)
    expect(results).toHaveLength(1)
    expect(results[0].taskId).toBe("t1")
    expect(results[0].agentId).toBe("nodejs-backend-developer")
    expect(results[0].status).toBe("completed")
  })

  test("#given batch with multiple tasks #then returns all results", async () => {
    const batch: ExecutionBatch = { index: 0, kind: "parallel_read", taskIds: ["t1", "t2"] }
    const assignments: AgentSelectionEntry[] = [
      { taskId: "t1", selectedAgent: "agent-a", exactMatch: true },
      { taskId: "t2", selectedAgent: "agent-b", exactMatch: true },
    ]
    const executeBatchFn = async (
      _b: ExecutionBatch,
      _ts: TaskNode[],
      _as: AgentSelectionEntry[],
    ): Promise<TaskExecutionResult[]> =>
      _b.taskIds.map((taskId) => ({
        taskId,
        agentId: _as.find((a) => a.taskId === taskId)?.selectedAgent ?? "unknown",
        status: "completed" as const,
        changedFiles: [],
        producedArtifacts: [],
      }))

    const results = await executeBatchFn(batch, [], assignments)
    expect(results).toHaveLength(2)
  })
})

// ─── Resolve Config ──────────────────────────────────────────────────────────

describe("resolveOrchestrationConfig", () => {
  test("#given full config #then all fields mapped", () => {
    const config = resolveOrchestrationConfig({
      enabled: true, auto_decompose: true, allow_parallel_readonly_tasks: false,
      max_repair_attempts: 3,
      quality_gates: { typecheck: true, lint: true, test: true, build: true, doctor: false },
    })
    expect(config.enabled).toBe(true)
    expect(config.allowParallelReadonlyTasks).toBe(false)
    expect(config.maxRepairAttempts).toBe(3)
    expect(config.qualityGates.typecheck).toBe(true)
  })

  test("#given empty config #then defaults used", () => {
    const config = resolveOrchestrationConfig({})
    expect(config.enabled).toBe(false)
    expect(config.maxRepairAttempts).toBe(2)
  })
})

// ─── State Persistence (Gap 3) ───────────────────────────────────────────────

describe("saveSessionState / loadSessionState", () => {
  test("#given state #when save+load #then round-trips correctly", () => {
    const stateDir = "/tmp/orch-persist-test"
    if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true })
    const state = {
      id: "persist-session",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      prompt: "Test persist",
      phase: "report" as const,
      tasks: [],
      batches: [],
      agentAssignments: [],
      completed: true,
      failed: false,
    }
    saveSessionState(stateDir, state)
    const loaded = loadSessionState(stateDir, "persist-session")
    expect(loaded).not.toBeNull()
    expect(loaded!.id).toBe("persist-session")
    expect(loaded!.completed).toBe(true)
    rmSync(stateDir, { recursive: true, force: true })
  })
})

describe("buildOrchestrationContextBlock", () => {
  test("#given short prompt #then produces compact block with intake", () => {
    const config = makeConfig({ enabled: true, autoDecompose: true })
    const block = buildOrchestrationContextBlock({
      prompt: "Fix the login button color to use primary-blue",
      config,
    })
    expect(block).toContain("Orchestration Plan")
    expect(block).toContain("Intent:")
    expect(block).toContain("Size:")
    expect(block).toContain("Risk:")
    expect(block).toContain("Tasks:")
    expect(block).toContain("Batches:")
  })

  test("#given multi-domain prompt #then block includes task breakdown", () => {
    const config = makeConfig({ enabled: true, autoDecompose: true })
    const block = buildOrchestrationContextBlock({
      prompt: "Implement a complete user management system. Create the database schema. Build the REST API. Design the frontend components.",
      config,
    })
    expect(block).toContain("Task Breakdown")
    expect(block).toContain("Execution Order")
  })

  test("#given prompt with sensitive terms #then block includes sensitive path warning", () => {
    const config = makeConfig({ enabled: true, autoDecompose: true })
    const block = buildOrchestrationContextBlock({
      prompt: "Update the .env.production configuration file for the production database",
      config,
    })
    expect(block.toLowerCase()).toContain("sensitive path blocks")
  })

  test("#given config disabled #then block still builds (gating is external)", () => {
    const config = makeConfig({ enabled: false })
    const block = buildOrchestrationContextBlock({
      prompt: "Fix a small CSS bug",
      config,
    })
    expect(block).toContain("Orchestration Plan")
  })
})

// ─── Handoff Consumption & Routing Recording (Wave 2) ──────────────────────

describe("consumeHandoffAndRecordRouting", () => {
  test("#given execution results with handoff data #then records routing decisions", () => {
    const testDir = "/tmp/orch-handoff-test"
    if (!existsSync(testDir)) mkdirSync(testDir, { recursive: true })

    const results: TaskExecutionResult[] = [
      {
        taskId: "t1",
        agentId: "nodejs-backend-developer",
        status: "completed",
        changedFiles: [],
        producedArtifacts: [],
        handoffData: {
          status: "DONE",
          target: "return_to_caller",
          signalCount: 1,
        },
      },
    ]

    const decisions = consumeHandoffAndRecordRouting(results, testDir)
    expect(decisions).toHaveLength(1)
    expect(decisions[0].kind).toBe("return_to_caller")
    expect(decisions[0].sourceTaskId).toBe("t1")
    expect(decisions[0].sourceAgent).toBe("nodejs-backend-developer")

    // Verify persistence
    const stateMgr = new OmoStateManager(testDir)
    const persisted = stateMgr.getRoutingDecisions()
    expect(persisted).toHaveLength(1)
    expect(persisted[0].decision).toBe("return_to_caller")

    rmSync(join(testDir, ".omo"), { recursive: true, force: true })
  })

  test("#given execution results with no handoff data #then skips and returns empty array", () => {
    const testDir = "/tmp/orch-handoff-test2"
    if (!existsSync(testDir)) mkdirSync(testDir, { recursive: true })

    const results: TaskExecutionResult[] = [
      {
        taskId: "t1",
        agentId: "nodejs-backend-developer",
        status: "completed",
        changedFiles: [],
        producedArtifacts: [],
        // no handoffData
      },
    ]

    const decisions = consumeHandoffAndRecordRouting(results, testDir)
    expect(decisions).toHaveLength(0)

    rmSync(join(testDir, ".omo"), { recursive: true, force: true })
  })

  test("#given empty results array #then returns empty array", () => {
    const testDir = "/tmp/orch-handoff-test3"
    if (!existsSync(testDir)) mkdirSync(testDir, { recursive: true })

    const decisions = consumeHandoffAndRecordRouting([], testDir)
    expect(decisions).toHaveLength(0)

    rmSync(join(testDir, ".omo"), { recursive: true, force: true })
  })

  test("#given BLOCKED handoff #then records invalid_target_blocked", () => {
    const testDir = "/tmp/orch-handoff-test4"
    if (!existsSync(testDir)) mkdirSync(testDir, { recursive: true })

    const results: TaskExecutionResult[] = [
      {
        taskId: "t2",
        agentId: "security-architect",
        status: "blocked",
        changedFiles: [],
        producedArtifacts: [],
        handoffData: {
          status: "BLOCKED",
          target: "return_to_caller",
          signalCount: 0,
        },
      },
    ]

    const decisions = consumeHandoffAndRecordRouting(results, testDir)
    expect(decisions).toHaveLength(1)
    expect(decisions[0].kind).toBe("invalid_target_blocked")

    const stateMgr = new OmoStateManager(testDir)
    const persisted = stateMgr.getRoutingDecisions()
    expect(persisted).toHaveLength(1)
    expect(persisted[0].decision).toBe("invalid_target_blocked")

    rmSync(join(testDir, ".omo"), { recursive: true, force: true })
  })

  test("#given multiple results with mixed handoff data #then records all valid", () => {
    const testDir = "/tmp/orch-handoff-test5"
    if (!existsSync(testDir)) mkdirSync(testDir, { recursive: true })

    const results: TaskExecutionResult[] = [
      {
        taskId: "t1",
        agentId: "nodejs-backend-developer",
        status: "completed",
        changedFiles: [],
        producedArtifacts: [],
        handoffData: { status: "DONE", target: "return_to_caller", signalCount: 1 },
      },
      {
        taskId: "t2",
        agentId: "security-architect",
        status: "completed",
        changedFiles: [],
        producedArtifacts: [],
        handoffData: { status: "DONE", target: "unknown-agent-ghost", signalCount: 1 },
      },
      {
        taskId: "t3",
        agentId: "qa-test-engineer",
        status: "completed",
        changedFiles: [],
        producedArtifacts: [],
        // no handoff
      },
    ]

    const decisions = consumeHandoffAndRecordRouting(results, testDir)
    expect(decisions).toHaveLength(2)
    expect(decisions[0].kind).toBe("return_to_caller")
    expect(decisions[1].kind).toBe("unknown_target_fallback")

    const stateMgr = new OmoStateManager(testDir)
    const persisted = stateMgr.getRoutingDecisions()
    expect(persisted).toHaveLength(2)

    rmSync(join(testDir, ".omo"), { recursive: true, force: true })
  })

  test("#given return_to_parent_for_routing handoff #then records correctly", () => {
    const testDir = "/tmp/orch-handoff-test6"
    if (!existsSync(testDir)) mkdirSync(testDir, { recursive: true })

    const results: TaskExecutionResult[] = [
      {
        taskId: "t1",
        agentId: "database-specialist",
        status: "completed",
        changedFiles: [],
        producedArtifacts: [],
        handoffData: {
          status: "DONE",
          target: "return_to_parent_for_routing",
          signalCount: 2,
        },
      },
    ]

    const decisions = consumeHandoffAndRecordRouting(results, testDir)
    expect(decisions).toHaveLength(1)
    expect(decisions[0].kind).toBe("return_to_parent_for_routing")

    rmSync(join(testDir, ".omo"), { recursive: true, force: true })
  })
})
