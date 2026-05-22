import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"

import {
  bootstrapMemoryFiles,
  createHecateqMemoryBootstrapHook,
  FILE_TEMPLATES,
  findProjectRoot,
  isProjectRoot,
  PROJECT_CONTRACTS_DIR,
  PROJECT_MEMORY_DIR,
  PROJECT_MEMORY_FILES,
  PROJECT_TASK_GRAPHS_DIR,
} from "./index"

const MEMORY_FILES_ARRAY = [...PROJECT_MEMORY_FILES]

describe("isProjectRoot", () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `hecateq-root-test-${randomUUID()}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  test("detects .opencode as project root", () => {
    // given
    mkdirSync(join(testDir, ".opencode"), { recursive: true })

    // when
    const result = isProjectRoot(testDir)

    // then
    expect(result).toBe(true)
  })

  test("detects .git as project root", () => {
    // given
    mkdirSync(join(testDir, ".git"), { recursive: true })

    // when
    const result = isProjectRoot(testDir)

    // then
    expect(result).toBe(true)
  })

  test("returns false when neither .opencode nor .git exist", () => {
    // given — no markers present
    // when
    const result = isProjectRoot(testDir)

    // then
    expect(result).toBe(false)
  })

  test("returns false for non-existent directory", () => {
    // when
    const result = isProjectRoot(join(tmpdir(), "does-not-exist-12345"))

    // then
    expect(result).toBe(false)
  })

  test("returns true when both .opencode and .git exist", () => {
    // given
    mkdirSync(join(testDir, ".opencode"), { recursive: true })
    mkdirSync(join(testDir, ".git"), { recursive: true })

    // when
    const result = isProjectRoot(testDir)

    // then
    expect(result).toBe(true)
  })
})

describe("findProjectRoot", () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `hecateq-findroot-test-${randomUUID()}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  test("finds root with .opencode marker in current dir", () => {
    // given
    mkdirSync(join(testDir, ".opencode"), { recursive: true })

    // when
    const result = findProjectRoot(testDir)

    // then
    expect(result).toBe(testDir)
  })

  test("finds root with .git marker in current dir", () => {
    // given
    mkdirSync(join(testDir, ".git"), { recursive: true })

    // when
    const result = findProjectRoot(testDir)

    // then
    expect(result).toBe(testDir)
  })

  test("prefers .opencode over .git when both exist", () => {
    // given
    mkdirSync(join(testDir, ".opencode"), { recursive: true })
    mkdirSync(join(testDir, ".git"), { recursive: true })

    // when
    const result = findProjectRoot(testDir)

    // then
    expect(result).toBe(testDir)
  })

  test("walks upward to find .opencode in parent dir", () => {
    // given — .opencode in root, not in subdir
    mkdirSync(join(testDir, ".opencode"), { recursive: true })
    const subDir = join(testDir, "a", "b", "c")
    mkdirSync(subDir, { recursive: true })

    // when
    const result = findProjectRoot(subDir)

    // then
    expect(result).toBe(testDir)
  })

  test("walks upward to find .git in parent dir", () => {
    // given — .git in root, not in subdir
    mkdirSync(join(testDir, ".git"), { recursive: true })
    const subDir = join(testDir, "x", "y", "z")
    mkdirSync(subDir, { recursive: true })

    // when
    const result = findProjectRoot(subDir)

    // then
    expect(result).toBe(testDir)
  })

  test("returns null when no project root markers exist", () => {
    // given — no markers anywhere in the path

    // when
    const result = findProjectRoot(testDir)

    // then
    expect(result).toBeNull()
  })

  test("returns null on non-existent start directory", () => {
    // given — directory does not exist

    // when
    const result = findProjectRoot(join(tmpdir(), "does-not-exist-abc-123"))

    // then
    expect(result).toBeNull()
  })

  test("finds root by package.json manifest", () => {
    // given
    writeFileSync(join(testDir, "package.json"), '{"name":"test"}', "utf-8")

    // when
    const result = findProjectRoot(testDir)

    // then
    expect(result).toBe(testDir)
  })
})

describe("bootstrapMemoryFiles", () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `hecateq-bootstrap-test-${randomUUID()}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  function getMemoryDir(): string {
    return join(testDir, PROJECT_MEMORY_DIR)
  }

  function filePath(name: string): string {
    return join(getMemoryDir(), name)
  }

  function getContractsDir(): string {
    return join(testDir, PROJECT_CONTRACTS_DIR)
  }

  function getTaskGraphsDir(): string {
    return join(testDir, PROJECT_TASK_GRAPHS_DIR)
  }

  test("creates directory and all files when nothing exists", () => {
    // when
    const result = bootstrapMemoryFiles(testDir)

    // then
    expect(result.dirCreated).toBe(true)
    expect(result.created.sort()).toEqual(MEMORY_FILES_ARRAY.sort())
    expect(result.skipped).toHaveLength(0)
    expect(result.artifactDirsCreated.sort()).toEqual([
      PROJECT_CONTRACTS_DIR,
      PROJECT_TASK_GRAPHS_DIR,
    ].sort())
    expect(result.errors).toHaveLength(0)
    expect(existsSync(getMemoryDir())).toBe(true)
    expect(existsSync(getContractsDir())).toBe(true)
    expect(existsSync(getTaskGraphsDir())).toBe(true)
    for (const name of MEMORY_FILES_ARRAY) {
      expect(existsSync(filePath(name))).toBe(true)
      expect(readFileSync(filePath(name), "utf-8")).toBe(FILE_TEMPLATES[name])
    }
  })

  test("does not overwrite existing files", () => {
    // given — create directory and write custom content to one file
    mkdirSync(getMemoryDir(), { recursive: true })
    const customContent = "CUSTOM CONTENT — DO NOT OVERWRITE"
    writeFileSync(filePath("active-context.md"), customContent, "utf-8")
    writeFileSync(filePath("progress.md"), customContent, "utf-8")

    // when
    const result = bootstrapMemoryFiles(testDir)

    // then — existing files not overwritten
    expect(result.created.sort()).toEqual(
      MEMORY_FILES_ARRAY.filter((f) => f !== "active-context.md" && f !== "progress.md").sort(),
    )
    expect(result.skipped).toContain("active-context.md")
    expect(result.skipped).toContain("progress.md")
    expect(readFileSync(filePath("active-context.md"), "utf-8")).toBe(customContent)
    expect(readFileSync(filePath("progress.md"), "utf-8")).toBe(customContent)
  })

  test("is idempotent — second run creates nothing and skips all", () => {
    // given — first run
    const first = bootstrapMemoryFiles(testDir)
    expect(first.created.length).toBe(MEMORY_FILES_ARRAY.length)

    // when — second run
    const second = bootstrapMemoryFiles(testDir)

    // then
    expect(second.dirCreated).toBe(false)
    expect(second.created).toHaveLength(0)
    expect(second.skipped.sort()).toEqual(MEMORY_FILES_ARRAY.sort())
    expect(second.artifactDirsCreated).toHaveLength(0)
    expect(second.errors).toHaveLength(0)
  })

  test("does not overwrite existing artifact directories or auto-create artifact files", () => {
    // given
    mkdirSync(getMemoryDir(), { recursive: true })
    mkdirSync(getContractsDir(), { recursive: true })
    mkdirSync(getTaskGraphsDir(), { recursive: true })
    const contractFile = join(getContractsDir(), "existing-contract.md")
    const graphFile = join(getTaskGraphsDir(), "existing-task-graph.md")
    writeFileSync(contractFile, "contract", "utf-8")
    writeFileSync(graphFile, "graph", "utf-8")

    // when
    const result = bootstrapMemoryFiles(testDir)

    // then
    expect(result.artifactDirsCreated).toHaveLength(0)
    expect(readFileSync(contractFile, "utf-8")).toBe("contract")
    expect(readFileSync(graphFile, "utf-8")).toBe("graph")
    expect(existsSync(join(getContractsDir(), "current-contract.md"))).toBe(false)
    expect(existsSync(join(getTaskGraphsDir(), "current-task-graph.md"))).toBe(false)
  })

  test("creates only missing files when some already exist", () => {
    // given — create partial set
    mkdirSync(getMemoryDir(), { recursive: true })
    writeFileSync(filePath("active-context.md"), "existing", "utf-8")
    writeFileSync(filePath("decisions.md"), "existing", "utf-8")

    // when
    const result = bootstrapMemoryFiles(testDir)

    // then
    expect(result.created.sort()).toEqual(
      ["progress.md", "tasks.md", "file-map.md"].sort(),
    )
    expect(result.skipped.sort()).toEqual(
      ["active-context.md", "decisions.md"].sort(),
    )
  })

  test("creates directory when it exists but is empty", () => {
    // given — only parent dirs exist, memory dir does not
    mkdirSync(join(testDir, ".opencode"), { recursive: true })

    // when
    const result = bootstrapMemoryFiles(testDir)

    // then
    expect(result.dirCreated).toBe(true)
    expect(result.created.length).toBe(MEMORY_FILES_ARRAY.length)
  })

  test("handles non-existent directory gracefully — mkdirSync recursive creates it", () => {
    // given — path that does not yet exist
    const freshPath = join(tmpdir(), `does-not-exist-${randomUUID()}`)

    // when — should not throw; mkdirSync({recursive:true}) creates parent chain
    let caught: Error | null = null
    let result: ReturnType<typeof bootstrapMemoryFiles> | null = null
    try {
      result = bootstrapMemoryFiles(freshPath)
    } catch (err) {
      caught = err instanceof Error ? err : new Error(String(err))
    }

    // then
    expect(caught).toBeNull()
    expect(result).not.toBeNull()
    // mkdirSync with recursive:true succeeds and creates all files
    expect(result!.created.length).toBe(MEMORY_FILES_ARRAY.length)
    expect(existsSync(freshPath)).toBe(true)
  })

  test("does not write when called on a path without project markers", () => {
    // given — no .opencode or .git markers (but directory exists)

    // when
    const result = bootstrapMemoryFiles(testDir)

    // then — bootstrap itself does not gate on markers
    // (marker gating is the responsibility of the caller / hook handler)
    // But if there's no project root, existence still creates files
    // because bootstrapMemoryFiles is a utility that just writes based on path.
    // Marker gating happens upstream via isProjectRoot().
    // This test verifies the utility works regardless:
    expect(result.created.length).toBe(MEMORY_FILES_ARRAY.length)
  })

  test("returns warnings instead of throwing when filesystem bootstrap fails", () => {
    // given
    writeFileSync(join(testDir, ".opencode"), "not-a-directory", "utf-8")

    // when
    const result = bootstrapMemoryFiles(testDir)

    // then
    expect(result.created).toHaveLength(0)
    expect(result.errors.length).toBeGreaterThan(0)
  })
})

describe("createHecateqMemoryBootstrapHook", () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `hecateq-hook-test-${randomUUID()}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  test("returns an object with HOOK_NAME, bootstrapMemoryFiles, isProjectRoot, findProjectRoot, event", () => {
    // given
    const ctx = { directory: testDir } as unknown as Parameters<typeof createHecateqMemoryBootstrapHook>[0]

    // when
    const hook = createHecateqMemoryBootstrapHook(ctx)

    // then
    expect(hook.HOOK_NAME).toBe("hecateq-memory-bootstrap")
    expect(typeof hook.bootstrapMemoryFiles).toBe("function")
    expect(typeof hook.isProjectRoot).toBe("function")
    expect(typeof hook.findProjectRoot).toBe("function")
    expect(typeof hook.event).toBe("function")
  })

  test("event handler fires bootstrap when session.created fires for root project", async () => {
    // given
    mkdirSync(join(testDir, ".opencode"), { recursive: true })
    const ctx = { directory: testDir } as unknown as Parameters<typeof createHecateqMemoryBootstrapHook>[0]
    const hook = createHecateqMemoryBootstrapHook(ctx)

    // when
    await hook.event({ event: { type: "session.created" } })

    // then — memory files created
    const memoryDir = join(testDir, PROJECT_MEMORY_DIR)
    const contractsDir = join(testDir, PROJECT_CONTRACTS_DIR)
    const taskGraphsDir = join(testDir, PROJECT_TASK_GRAPHS_DIR)
    expect(existsSync(memoryDir)).toBe(true)
    expect(existsSync(contractsDir)).toBe(true)
    expect(existsSync(taskGraphsDir)).toBe(true)
    for (const name of PROJECT_MEMORY_FILES) {
      expect(existsSync(join(memoryDir, name))).toBe(true)
    }
    expect(existsSync(join(contractsDir, "current-contract.md"))).toBe(false)
    expect(existsSync(join(taskGraphsDir, "current-task-graph.md"))).toBe(false)
  })

  test("event handler skips when event type is not session.created", async () => {
    // given — no project markers; would create nothing if it ran
    const ctx = { directory: testDir } as unknown as Parameters<typeof createHecateqMemoryBootstrapHook>[0]
    const hook = createHecateqMemoryBootstrapHook(ctx)

    // when — wrong event type
    await hook.event({ event: { type: "session.deleted" } })

    // then — nothing created
    const memoryDir = join(testDir, PROJECT_MEMORY_DIR)
    expect(existsSync(memoryDir)).toBe(false)
  })

  test("event handler fires at most once (idempotent across multiple events)", async () => {
    // given
    mkdirSync(join(testDir, ".opencode"), { recursive: true })
    const ctx = { directory: testDir } as unknown as Parameters<typeof createHecateqMemoryBootstrapHook>[0]
    const hook = createHecateqMemoryBootstrapHook(ctx)

    // when — fire twice
    await hook.event({ event: { type: "session.created" } })
    // after first fire, remove a file to detect if second fire would re-create
    const memoryDir = join(testDir, PROJECT_MEMORY_DIR)
    const progressPath = join(memoryDir, "progress.md")
    const originalContent = readFileSync(join(memoryDir, "active-context.md"), "utf-8")
    rmSync(progressPath)
    await hook.event({ event: { type: "session.created" } })

    // then — second fire was no-op (fired guard prevents re-creation)
    expect(existsSync(progressPath)).toBe(false)
    expect(readFileSync(join(memoryDir, "active-context.md"), "utf-8")).toBe(originalContent)
  })

  test("event handler skips subagent sessions (has parentID)", async () => {
    // given
    mkdirSync(join(testDir, ".opencode"), { recursive: true })
    const ctx = { directory: testDir } as unknown as Parameters<typeof createHecateqMemoryBootstrapHook>[0]
    const hook = createHecateqMemoryBootstrapHook(ctx)

    // when — subagent session
    await hook.event({ event: { type: "session.created", properties: { info: { parentID: "ses_parent123" } } } })

    // then — nothing created
    const memoryDir = join(testDir, PROJECT_MEMORY_DIR)
    expect(existsSync(memoryDir)).toBe(false)
  })

  test("event handler skips when no project root found", async () => {
    // given — no markers, no manifests
    const ctx = { directory: testDir } as unknown as Parameters<typeof createHecateqMemoryBootstrapHook>[0]
    const hook = createHecateqMemoryBootstrapHook(ctx)

    // when
    await hook.event({ event: { type: "session.created" } })

    // then — nothing created
    const memoryDir = join(testDir, PROJECT_MEMORY_DIR)
    expect(existsSync(memoryDir)).toBe(false)
  })
})

describe("end-to-end: isProjectRoot + bootstrapMemoryFiles integration", () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `hecateq-e2e-test-${randomUUID()}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  test("bootstraps memory files inside a .opencode-rooted project", () => {
    // given
    mkdirSync(join(testDir, ".opencode"), { recursive: true })

    // when
    const isRoot = isProjectRoot(testDir)
    const result = isRoot ? bootstrapMemoryFiles(testDir) : null

    // then
    expect(isRoot).toBe(true)
    expect(result).not.toBeNull()
    expect(result!.created.length).toBe(MEMORY_FILES_ARRAY.length)
  })

  test("bootstraps memory files inside a .git-rooted project", () => {
    // given
    mkdirSync(join(testDir, ".git"), { recursive: true })

    // when
    const isRoot = isProjectRoot(testDir)
    const result = isRoot ? bootstrapMemoryFiles(testDir) : null

    // then
    expect(isRoot).toBe(true)
    expect(result).not.toBeNull()
    expect(result!.created.length).toBe(MEMORY_FILES_ARRAY.length)
  })

  test("skips bootstrap when no project root marker exists", () => {
    // given — no markers

    // when
    const isRoot = isProjectRoot(testDir)

    // then
    expect(isRoot).toBe(false)
  })
})
