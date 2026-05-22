import { beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  buildProjectContextBlock,
  createHecateqProjectContextInjectorHook,
  createProjectContextSnapshot,
  MAX_TOTAL_CONTEXT_CHARS,
} from "./index"
import {
  PROJECT_CONTRACTS_DIR,
  PROJECT_MEMORY_DIR,
  PROJECT_TASK_GRAPHS_DIR,
} from "../../shared/memory-bootstrap"

const MEMORY_FILE_NAMES = [
  "active-context.md",
  "progress.md",
  "tasks.md",
  "file-map.md",
  "decisions.md",
] as const

describe("hecateq-project-context-injector", () => {
  let testDir = ""

  beforeEach(() => {
    if (testDir) rmSync(testDir, { recursive: true, force: true })
    testDir = join(tmpdir(), `hecateq-project-context-${randomUUID()}`)
    mkdirSync(testDir, { recursive: true })
  })

  function setupProjectRoot(): void {
    mkdirSync(join(testDir, ".opencode"), { recursive: true })
    mkdirSync(join(testDir, PROJECT_MEMORY_DIR), { recursive: true })
    mkdirSync(join(testDir, PROJECT_CONTRACTS_DIR), { recursive: true })
    mkdirSync(join(testDir, PROJECT_TASK_GRAPHS_DIR), { recursive: true })
  }

  function writeMemoryFile(name: string, content: string): void {
    writeFileSync(join(testDir, PROJECT_MEMORY_DIR, name), content, "utf-8")
  }

  test("builds a context block from project-root memory and artifact listings", () => {
    setupProjectRoot()
    writeMemoryFile("active-context.md", "# Active Context\n\nCurrent focus")
    writeMemoryFile("progress.md", "# Progress\n\nMilestone A")
    writeMemoryFile("tasks.md", "# Tasks\n\nPending item")
    writeMemoryFile("file-map.md", "# File Map\n\nsrc/app.ts")
    writeMemoryFile("decisions.md", "# Decisions\n\nUse Hecateq")
    writeFileSync(join(testDir, PROJECT_CONTRACTS_DIR, "current-contract.md"), "secret-payload-shape", "utf-8")
    writeFileSync(join(testDir, PROJECT_TASK_GRAPHS_DIR, "current-task-graph.md"), "graph-body", "utf-8")

    const block = buildProjectContextBlock(testDir)

    expect(block).not.toBeNull()
    expect(block).toContain("<hecateq-project-context>")
    expect(block).toContain("Project root: ")
    expect(block).toContain("active-context.md: present")
    expect(block).toContain(`Contracts directory: ${PROJECT_CONTRACTS_DIR}/`)
    expect(block).toContain(`${PROJECT_CONTRACTS_DIR}/current-contract.md`)
    expect(block).toContain(`${PROJECT_TASK_GRAPHS_DIR}/current-task-graph.md`)
    expect(block).not.toContain("secret-payload-shape")
    expect(block).not.toContain("graph-body")
  })

  test("treats missing and empty memory files as non-fatal", () => {
    setupProjectRoot()
    writeMemoryFile("active-context.md", "")
    writeMemoryFile("progress.md", "# Progress\n\nTODO")

    const block = buildProjectContextBlock(testDir)

    expect(block).not.toBeNull()
    expect(block).toContain("active-context.md: present but empty")
    expect(block).toContain("tasks.md: missing")
    expect(block).toContain("[template placeholder omitted]")
  })

  test("truncates oversized memory context and respects total limit", () => {
    setupProjectRoot()
    const huge = `# Active Context\n\n${"a".repeat(12000)}`
    for (const fileName of MEMORY_FILE_NAMES) {
      writeMemoryFile(fileName, huge)
    }

    const block = buildProjectContextBlock(testDir)

    expect(block).not.toBeNull()
    expect(block!.length).toBeLessThanOrEqual(MAX_TOTAL_CONTEXT_CHARS)
    expect(block).toContain("...[truncated]")
  })

  test("returns null when project root cannot be found", () => {
    const block = buildProjectContextBlock(testDir)
    const snapshot = createProjectContextSnapshot(testDir)

    expect(block).toBeNull()
    expect(snapshot).toBeNull()
  })

  test("hook injects context only once for a hecateq session and remains read-only", async () => {
    setupProjectRoot()
    writeMemoryFile("active-context.md", "# Active Context\n\nGoal")
    const beforeFiles = existsSync(join(testDir, PROJECT_CONTRACTS_DIR, "current-contract.md"))
    const hook = createHecateqProjectContextInjectorHook({ directory: testDir } as never)
    const output = { parts: [{ type: "text", text: "Implement feature" }] }

    await hook["chat.message"]({ sessionID: "ses_1", agent: "hecateq-orchestrator" }, output)

    expect(output.parts[0].text).toContain("<hecateq-project-context>")
    expect(output.parts[0].text).toContain("Implement feature")
    expect(existsSync(join(testDir, PROJECT_CONTRACTS_DIR, "current-contract.md"))).toBe(beforeFiles)

    const onceInjected = output.parts[0].text
    await hook["chat.message"]({ sessionID: "ses_1", agent: "hecateq-orchestrator" }, output)
    expect(output.parts[0].text).toBe(onceInjected)
  })

  test("does not inject for non-hecateq agents", async () => {
    setupProjectRoot()
    writeMemoryFile("active-context.md", "# Active Context\n\nGoal")
    const hook = createHecateqProjectContextInjectorHook({ directory: testDir } as never)
    const output = { parts: [{ type: "text", text: "Implement feature" }] }

    await hook["chat.message"]({ sessionID: "ses_2", agent: "sisyphus" }, output)

    expect(output.parts[0].text).toBe("Implement feature")
  })

  test("does not inject when no project root exists and does not create files", async () => {
    const hook = createHecateqProjectContextInjectorHook({ directory: testDir } as never)
    const output = { parts: [{ type: "text", text: "Implement feature" }] }

    await hook["chat.message"]({ sessionID: "ses_3", agent: "hecateq-orchestrator" }, output)

    expect(output.parts[0].text).toBe("Implement feature")
    expect(existsSync(join(testDir, PROJECT_MEMORY_DIR))).toBe(false)
    expect(existsSync(join(testDir, PROJECT_CONTRACTS_DIR))).toBe(false)
    expect(existsSync(join(testDir, PROJECT_TASK_GRAPHS_DIR))).toBe(false)
  })

  test("clears per-session state after session.deleted", async () => {
    setupProjectRoot()
    writeMemoryFile("active-context.md", "# Active Context\n\nGoal")
    const hook = createHecateqProjectContextInjectorHook({ directory: testDir } as never)
    const firstOutput = { parts: [{ type: "text", text: "First" }] }
    await hook["chat.message"]({ sessionID: "ses_4", agent: "hecateq-orchestrator" }, firstOutput)

    await hook.event({ event: { type: "session.deleted", properties: { sessionID: "ses_4" } } })

    const secondOutput = { parts: [{ type: "text", text: "Second" }] }
    await hook["chat.message"]({ sessionID: "ses_4", agent: "hecateq-orchestrator" }, secondOutput)

    expect(secondOutput.parts[0].text).toContain("<hecateq-project-context>")
  })
})
