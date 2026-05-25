import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import {
  resolveReadyTasks,
  consumeSignalsFromResults,
  signalDagTick,
} from "./signal-dag-executor"
import { OmoStateManager } from "./omo-state-manager"
import type { TaskNode, TaskExecutionResult } from "./types"

const tempDirs: string[] = []

function createTempDir(): string {
  const directory = mkdtempSync(join(tmpdir(), "omo-sigdag-"))
  tempDirs.push(directory)
  return directory
}

function makeTask(overrides: Partial<TaskNode> & { id: string }): TaskNode {
  return {
    label: overrides.id,
    prompt: `Task ${overrides.id}`,
    domain: "backend",
    action: "both",
    dependsOn: [],
    status: "pending",
    ...overrides,
  }
}

function makeResult(overrides: Partial<TaskExecutionResult> & { taskId: string; agentId: string }): TaskExecutionResult {
  return {
    status: "completed",
    changedFiles: [],
    producedArtifacts: [],
    ...overrides,
  }
}

describe("signal-dag-executor", () => {
  describe("resolveReadyTasks", () => {
    test("returns tasks with all required signals satisfied", () => {
      const consumed = new Set(["schema_ready", "backend_ready"])
      const tasks: TaskNode[] = [
        makeTask({ id: "t1", requiredSignals: ["schema_ready"], status: "pending" }),
        makeTask({ id: "t2", requiredSignals: ["backend_ready"], status: "pending" }),
        makeTask({ id: "t3", requiredSignals: ["schema_ready", "backend_ready"], status: "pending" }),
      ]

      const ready = resolveReadyTasks(tasks, consumed)
      expect(ready).toHaveLength(3)
      expect(ready.map((t) => t.id)).toEqual(["t1", "t2", "t3"])
    })

    test("skips tasks with unsatisfied signals", () => {
      const consumed = new Set(["schema_ready"])
      const tasks: TaskNode[] = [
        makeTask({ id: "t1", requiredSignals: ["schema_ready"], status: "pending" }),
        makeTask({ id: "t2", requiredSignals: ["backend_ready"], status: "pending" }),
      ]

      const ready = resolveReadyTasks(tasks, consumed)
      expect(ready).toHaveLength(1)
      expect(ready[0]!.id).toBe("t1")
    })

    test("skips tasks that are not pending", () => {
      const consumed = new Set(["schema_ready"])
      const tasks: TaskNode[] = [
        makeTask({ id: "t1", requiredSignals: ["schema_ready"], status: "completed" }),
        makeTask({ id: "t2", requiredSignals: ["schema_ready"], status: "in_progress" }),
        makeTask({ id: "t3", requiredSignals: ["schema_ready"], status: "pending" }),
      ]

      const ready = resolveReadyTasks(tasks, consumed)
      expect(ready).toHaveLength(1)
      expect(ready[0]!.id).toBe("t3")
    })

    test("skips tasks without requiredSignals", () => {
      const consumed = new Set(["schema_ready"])
      const tasks: TaskNode[] = [
        makeTask({ id: "t1" }),
        makeTask({ id: "t2", requiredSignals: [] }),
        makeTask({ id: "t3", requiredSignals: ["schema_ready"], status: "pending" }),
      ]

      const ready = resolveReadyTasks(tasks, consumed)
      expect(ready).toHaveLength(1)
      expect(ready[0]!.id).toBe("t3")
    })
  })

  describe("consumeSignalsFromResults", () => {
    test("records signals from completed task results with handoff data", () => {
      const directory = createTempDir()
      const stateMgr = new OmoStateManager(directory)

      const results: TaskExecutionResult[] = [
        makeResult({
          taskId: "t1",
          agentId: "qa-test-engineer",
          status: "completed",
          handoffData: { status: "DONE", target: "return_to_caller", signalCount: 1 },
        }),
      ]

      const consumed = consumeSignalsFromResults(results, stateMgr)
      expect(consumed).toContain("tests_passed")
    })

    test("does not record signals from failed results", () => {
      const directory = createTempDir()
      const stateMgr = new OmoStateManager(directory)

      const results: TaskExecutionResult[] = [
        makeResult({
          taskId: "t1",
          agentId: "qa-test-engineer",
          status: "failed",
          handoffData: { status: "BLOCKED", target: null, signalCount: 1 },
        }),
      ]

      const consumed = consumeSignalsFromResults(results, stateMgr)
      expect(consumed).toHaveLength(0)
    })

    test("maps known agents to their canonical signals", () => {
      const directory = createTempDir()
      const stateMgr = new OmoStateManager(directory)
      const map: Record<string, string> = {
        "database-specialist": "schema_ready",
        "nodejs-backend-developer": "backend_ready",
        "security-architect": "auth_audit_passed",
        "design-translator": "ui_specs_ready",
        "coolify-devops-specialist": "infra_provisioned",
        "devsecops-pipeline-architect": "pipeline_secured",
        "performance-specialist": "performance_verified",
        "compliance-specialist": "compliance_signed",
      }

      for (const [agent, signal] of Object.entries(map)) {
        const results: TaskExecutionResult[] = [
          makeResult({
            taskId: `t_${agent}`,
            agentId: agent,
            status: "completed",
            handoffData: { status: "DONE", target: "return_to_caller", signalCount: 1 },
          }),
        ]
        const consumed = consumeSignalsFromResults(results, stateMgr)
        expect(consumed).toContain(signal)
      }
    })
  })

  describe("signalDagTick — end-to-end", () => {
    test("triggers delegation for downstream tasks when signals satisfied", () => {
      const directory = createTempDir()
      const stateMgr = new OmoStateManager(directory)

      stateMgr.emitSignal("schema_ready", { source: "database-specialist" })

      const tasks: TaskNode[] = [
        makeTask({
          id: "t_backend",
          requiredSignals: ["schema_ready"],
          status: "pending",
          assignedAgent: "nodejs-backend-developer",
        }),
      ]

      const result = signalDagTick({
        tasks,
        projectDir: directory,
      })

      expect(result.activatedCount).toBe(1)
      expect(result.activatedTaskIds).toContain("t_backend")

      const pending = stateMgr.getPendingDelegations()
      expect(pending).toHaveLength(1)
      expect(pending[0]!.targetAgent).toBe("nodejs-backend-developer")
    })

    test("does not trigger when signals are missing", () => {
      const directory = createTempDir()

      const tasks: TaskNode[] = [
        makeTask({
          id: "t_backend",
          requiredSignals: ["schema_ready"],
          status: "pending",
          assignedAgent: "nodejs-backend-developer",
        }),
      ]

      const result = signalDagTick({
        tasks,
        projectDir: directory,
      })

      expect(result.activatedCount).toBe(0)
    })

    test("returns empty when no tasks have requiredSignals", () => {
      const directory = createTempDir()

      const tasks: TaskNode[] = [
        makeTask({ id: "t1", status: "pending" }),
        makeTask({ id: "t2", status: "completed" }),
      ]

      const result = signalDagTick({ tasks, projectDir: directory })
      expect(result.activatedCount).toBe(0)
      expect(result.activatedTaskIds).toHaveLength(0)
    })
  })
})

// Cleanup
import { afterEach } from "bun:test"
afterEach(() => {
  while (tempDirs.length > 0) {
    const directory = tempDirs.pop()
    if (directory) {
      try { rmSync(directory, { recursive: true, force: true }) } catch {}
    }
  }
})
