import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

describe("hecateq plan command", () => {
  test("#given simple prompt #then parses and decomposes", async () => {
    const { hecateqPlan } = await import("./plan")
    const result = await hecateqPlan({
      prompt: "Fix the login button color to use primary-blue",
      json: true,
    })
    expect(result.intake.taskSize).toBe("small")
    expect(result.intake.riskLevel).toBe("low")
    expect(result.tasks.length).toBeGreaterThanOrEqual(1)
    expect(result.depPlan.totalBatches).toBeGreaterThanOrEqual(1)
  })

  test("#given destructive prompt #then risk detected", async () => {
    const { hecateqPlan } = await import("./plan")
    const result = await hecateqPlan({
      prompt: "Drop the production database and recreate from scratch",
      json: true,
    })
    expect(result.intake.riskLevel).toBe("destructive")
    expect(result.intake.requiresPlan).toBe(true)
  })

  test("#given multi-domain large prompt #then multiple tasks and batches", async () => {
    const { hecateqPlan } = await import("./plan")
    const prompt = "Implement a complete user management system. Create the database schema with users and roles tables. Build the REST API with Express controllers for CRUD operations. Design the frontend React components. Add authentication with JWT. Deploy with Docker and CI/CD."
    const result = await hecateqPlan({ prompt, json: true })
    expect(result.tasks.length).toBeGreaterThanOrEqual(3)
    expect(result.depPlan.totalBatches).toBeGreaterThanOrEqual(1)
    expect(result.contractRequiredCount).toBeGreaterThanOrEqual(0)
  })

  test("#given destructive prompt #then contract-first stages injected", async () => {
    const { hecateqPlan } = await import("./plan")
    const prompt = "Drop the production database and recreate from scratch"
    const result = await hecateqPlan({ prompt, json: true })
    expect(result.injectedNodeCount).toBeGreaterThanOrEqual(1)
  })
})

describe("hecateq run command", () => {
  test("#given high-risk prompt without force #then blocks quickly", async () => {
    const { hecateqRun } = await import("./run")
    const result = await hecateqRun({
      prompt: "Drop the production database and recreate from scratch",
      force: false,
      dryRun: true,
      json: true,
    })
    // High risk without force returns exit 2 and does not execute
    expect(result.exitCode).toBe(2)
  })

  test("#given low-risk prompt with json #then returns quickly", async () => {
    const { hecateqRun } = await import("./run")
    const result = await hecateqRun({
      prompt: "Fix a typo in the README",
      dryRun: true,
      json: true,
    })
    expect(result.exitCode).toBe(0)
  })

  test("#given high-risk prompt with force #then returns plan", async () => {
    const { hecateqRun } = await import("./run")
    const result = await hecateqRun({
      prompt: "Drop the production database and recreate from scratch",
      force: true,
      dryRun: true,
      json: true,
    })
    expect(result.exitCode).toBe(0)
  })
})

describe("hecateq resume command", () => {
  test("#given no sessions #then returns empty", async () => {
    const { hecateqResume } = await import("./resume")
    const dir = mkdtempSync(join(tmpdir(), "hecateq-test-"))
    const result = await hecateqResume({ projectDir: dir, json: true })
    expect(result.foundSessions).toEqual([])
    expect(result.canContinue).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })

  test("#given existing session with in_progress tasks #then pauses them", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hecateq-test-"))
    const stateDir = join(dir, ".opencode", "orchestration")
    mkdirSync(stateDir, { recursive: true })
    writeFileSync(join(stateDir, "test-session.json"), JSON.stringify({
      id: "test-session",
      phase: "execute",
      prompt: "Test prompt",
      tasks: [
        { id: "task_1", label: "Running task", status: "in_progress", dependsOn: [], domain: "backend", action: "write", prompt: "do it" },
        { id: "task_2", label: "Pending task", status: "pending", dependsOn: ["task_1"], domain: "backend", action: "read", prompt: "verify" },
        { id: "task_3", label: "Done task", status: "completed", dependsOn: [], domain: "backend", action: "read", prompt: "was done" },
      ],
      completed: false,
      failed: false,
    }, null, 2))

    const { hecateqResume } = await import("./resume")
    const result = await hecateqResume({ sessionId: "test-session", projectDir: dir, json: true, dryRun: true })
    expect(result.resumedSession).toBe("test-session")
    expect(result.pausedTasks).toBeGreaterThanOrEqual(1)
    // At minimum the in_progress task was recovered

    rmSync(dir, { recursive: true, force: true })
  })
})

describe("hecateq status command", () => {
  test("#given fresh project #then reports no state", () => {
    const { hecateqStatus } = require("./status")
    const dir = mkdtempSync(join(tmpdir(), "hecateq-test-"))
    const result = hecateqStatus({ projectDir: dir, json: true })
    expect(result.orchestration.sessionCount).toBe(0)
    expect(result.memory.initialized).toBe(false)
    expect(result.contracts.exists).toBe(false)
    expect(result.taskGraphs.exists).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })

  test("#given project with orchestration state #then reports sessions", () => {
    const dir = mkdtempSync(join(tmpdir(), "hecateq-test-"))
    const stateDir = join(dir, ".opencode", "orchestration")
    mkdirSync(stateDir, { recursive: true })
    writeFileSync(join(stateDir, "session-1.json"), JSON.stringify({
      id: "session-1", phase: "done", prompt: "Build auth", completed: true, failed: false,
    }))

    const { hecateqStatus } = require("./status")
    const result = hecateqStatus({ projectDir: dir, json: true })
    expect(result.orchestration.sessionCount).toBe(1)
    expect(result.orchestration.recentSessions[0].id).toBe("session-1")
    rmSync(dir, { recursive: true, force: true })
  })
})

describe("hecateq doctor command", () => {
  test("#given fresh project #then runs all checks", () => {
    const { hecateqDoctor } = require("./doctor")
    const dir = mkdtempSync(join(tmpdir(), "hecateq-test-"))
    const result = hecateqDoctor({ projectDir: dir, json: true })
    expect(result.categories.length).toBeGreaterThanOrEqual(10)
    for (const cat of result.categories) {
      expect(["pass", "warn", "fail"]).toContain(cat.status)
    }
    rmSync(dir, { recursive: true, force: true })
  })

  test("#given project dir #then categories have expected names", () => {
    const { hecateqDoctor } = require("./doctor")
    const result = hecateqDoctor({ projectDir: process.cwd(), json: true })
    const names = result.categories.map((c: { name: string }) => c.name)
    expect(names).toContain("Agent Registration")
    expect(names).toContain("Configuration")
    expect(names).toContain("Orchestration")
    expect(names).toContain("Safety Hooks")
    expect(names).toContain("Project Memory")
    expect(names).toContain("Custom Agents")
    expect(names).toContain("Agent Index")
  })
})
