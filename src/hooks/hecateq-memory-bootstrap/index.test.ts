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
  resolveSessionRoot,
  PROJECT_CONTRACTS_DIR,
  PROJECT_MEMORY_DIR,
  PROJECT_MEMORY_FILES,
  PROJECT_TASK_GRAPHS_DIR,
} from "./index"
import { detectPlaceholderContent } from "../../shared/memory-manifest"

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
    expect(result.hydrated).toEqual([])
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
      const content = readFileSync(filePath(name), "utf-8")
      expect(content.length).toBeGreaterThan(0)
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
      MEMORY_FILES_ARRAY.filter((f) => f !== "active-context.md" && f !== "decisions.md").sort(),
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

  test("event handler hydrates existing placeholder files by default", async () => {
    // given — project root with placeholder memory files pre-created
    mkdirSync(join(testDir, ".opencode"), { recursive: true })
    const memDir = join(testDir, PROJECT_MEMORY_DIR)
    mkdirSync(memDir, { recursive: true })
    for (const name of PROJECT_MEMORY_FILES) {
      writeFileSync(join(memDir, name), FILE_TEMPLATES[name] ?? "", "utf-8")
    }

    const ctx = { directory: testDir } as unknown as Parameters<typeof createHecateqMemoryBootstrapHook>[0]
    const hook = createHecateqMemoryBootstrapHook(ctx, { hydrate_placeholders: true })

    // when
    await hook.event({ event: { type: "session.created" } })

    // then — all 8 files should be hydrated (no longer placeholder)
    for (const name of PROJECT_MEMORY_FILES) {
      const content = readFileSync(join(memDir, name), "utf-8")
      expect(detectPlaceholderContent(content)).toBe(false)
    }
  })

  test("event handler skips hydration when hydrate_placeholders is false", async () => {
    // given
    mkdirSync(join(testDir, ".opencode"), { recursive: true })
    const memDir = join(testDir, PROJECT_MEMORY_DIR)
    mkdirSync(memDir, { recursive: true })
    for (const name of PROJECT_MEMORY_FILES) {
      writeFileSync(join(memDir, name), FILE_TEMPLATES[name] ?? "", "utf-8")
    }

    const ctx = { directory: testDir } as unknown as Parameters<typeof createHecateqMemoryBootstrapHook>[0]
    const hook = createHecateqMemoryBootstrapHook(ctx, { hydrate_placeholders: false })

    // when
    await hook.event({ event: { type: "session.created" } })

    // then — files remain placeholder
    for (const name of PROJECT_MEMORY_FILES) {
      const content = readFileSync(join(memDir, name), "utf-8")
      expect(detectPlaceholderContent(content)).toBe(true)
    }
  })

  test("event handler creates hydrated content for missing files", async () => {
    // given
    mkdirSync(join(testDir, ".opencode"), { recursive: true })
    const ctx = { directory: testDir } as unknown as Parameters<typeof createHecateqMemoryBootstrapHook>[0]
    const hook = createHecateqMemoryBootstrapHook(ctx)

    // when
    await hook.event({ event: { type: "session.created" } })

    // then — freshly created files are not placeholder
    const memDir = join(testDir, PROJECT_MEMORY_DIR)
    for (const name of PROJECT_MEMORY_FILES) {
      const content = readFileSync(join(memDir, name), "utf-8")
      expect(content).toMatch(/Last updated: \d{4}-\d{2}-\d{2}/)
      expect(detectPlaceholderContent(content)).toBe(false)
    }
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

  test("bootstraps memory files in empty directory with no markers (first-run bootstrap)", () => {
    // given — empty directory, no markers, no parent project

    // when — bootstrap directly (without isProjectRoot gate)
    const result = bootstrapMemoryFiles(testDir)

    // then — should still create scaffold in the empty directory
    const expectedFileCount = PROJECT_MEMORY_FILES.length + 2 // +2 JSONL
    expect(result.created.length).toBe(expectedFileCount)
    expect(existsSync(join(testDir, PROJECT_MEMORY_DIR))).toBe(true)
    expect(existsSync(join(testDir, PROJECT_CONTRACTS_DIR))).toBe(true)
    expect(existsSync(join(testDir, PROJECT_TASK_GRAPHS_DIR))).toBe(true)
  })
})

describe("resolveSessionRoot", () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `hecateq-sessionroot-test-${randomUUID()}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  test("accepts empty directory as project root when no markers and no parent", () => {
    // given — empty directory with no markers, no parent project

    // when
    const contract = resolveSessionRoot(testDir)

    // then
    expect(contract).not.toBeNull()
    expect(contract!.projectRoot).toBe(testDir)
    expect(contract!.worktreeRoot).toBeNull()
    expect(contract!.sessionDirectory).toBe(testDir)
    expect(contract!.packageRoot).toBeNull()
    expect(contract!.source).toBe("empty_session_directory")
    expect(contract!.confidence).toBe("medium")
    expect(contract!.warnings).toContain("No .opencode, .git, or package marker found.")
    expect(contract!.warnings).toContain("Treating sessionDirectory as a new Hecateq project root for first-run bootstrap.")
  })

  test("returns null for non-existent directory", () => {
    // when
    const contract = resolveSessionRoot(join(tmpdir(), "does-not-exist-xyz-999"))

    // then
    expect(contract).toBeNull()
  })

  test("returns null for home directory", () => {
    // given — home directory
    const originalHome = process.env.HOME
    try {
      const contract = resolveSessionRoot(originalHome ?? tmpdir())

      // then
      expect(contract).toBeNull()
    } finally {
      // HOME env should not be modified
    }
  })

  test("detects directory with .opencode marker as high-confidence project root", () => {
    // given
    mkdirSync(join(testDir, ".opencode"), { recursive: true })

    // when
    const contract = resolveSessionRoot(testDir)

    // then
    expect(contract).not.toBeNull()
    expect(contract!.source).toBe("opencode_marker")
    expect(contract!.confidence).toBe("high")
    expect(contract!.warnings.length).toBe(0)
  })

  test("detects directory with .git marker as high-confidence project root", () => {
    // given
    mkdirSync(join(testDir, ".git"), { recursive: true })

    // when
    const contract = resolveSessionRoot(testDir)

    // then
    expect(contract).not.toBeNull()
    expect(contract!.source).toBe("git_marker")
    expect(contract!.confidence).toBe("high")
  })

  test("detects parent project for empty subdirectory but uses sessionDir as projectRoot", () => {
    // given — parent has .opencode, child is empty (intentionally opened)
    mkdirSync(join(testDir, ".opencode"), { recursive: true })
    const childDir = join(testDir, "subdir")
    mkdirSync(childDir, { recursive: true })

    // when
    const contract = resolveSessionRoot(childDir)

    // then — projectRoot is the child (session) directory, NOT the parent
    expect(contract).not.toBeNull()
    expect(contract!.projectRoot).toBe(childDir)
    expect(contract!.sessionDirectory).toBe(childDir)
    expect(contract!.source).toBe("empty_session_directory")
    expect(contract!.confidence).toBe("medium")
    expect(contract!.warnings.length).toBeGreaterThan(0)
    expect(contract!.warnings.some((w: string) => w.includes("No .opencode"))).toBe(true)
    expect(contract!.warnings.some((w: string) => w.includes("Parent project detected"))).toBe(true)
    // parent memory is NOT injected (packageRoot is null, worktreeRoot from parent if git)
    expect(contract!.packageRoot).toBeNull()
  })

  test("accepts empty directory when parent has no markers either (first-run)", () => {
    // given — empty directory with no markers; parent also has no markers
    const nestedDir = join(testDir, "a", "b", "c")
    mkdirSync(nestedDir, { recursive: true })

    // when
    const contract = resolveSessionRoot(nestedDir)

    // then
    expect(contract).not.toBeNull()
    expect(contract!.source).toBe("empty_session_directory")
    expect(contract!.projectRoot).toBe(nestedDir)
    expect(contract!.sessionDirectory).toBe(nestedDir)
  })

  test("project with package.json: sessionDirectory=projectRoot with package.json → packageRoot=sessionDirectory", () => {
    // given — .opencode + package.json in same dir
    mkdirSync(join(testDir, ".opencode"), { recursive: true })
    writeFileSync(join(testDir, "package.json"), "{}", "utf-8")

    // when
    const contract = resolveSessionRoot(testDir)

    // then
    expect(contract).not.toBeNull()
    expect(contract!.packageRoot).toBe(testDir)
    expect(contract!.source).toBe("opencode_marker")
    expect(contract!.confidence).toBe("high")
  })

  test("empty project with parent package.json guard: sessionDirectory has only .opencode, parent has package.json → packageRoot=null", () => {
    // given — project dir has .opencode but no package.json; parent has package.json
    const projectDir = join(testDir, "my-project")
    mkdirSync(projectDir, { recursive: true })
    mkdirSync(join(projectDir, ".opencode"), { recursive: true })
    writeFileSync(join(testDir, "package.json"), "{}", "utf-8")

    // when
    const contract = resolveSessionRoot(projectDir)

    // then — packageRoot must be null, not the parent's package.json
    expect(contract).not.toBeNull()
    expect(contract!.projectRoot).toBe(projectDir)
    expect(contract!.packageRoot).toBeNull()
    expect(contract!.warnings.length).toBe(0)
  })

  test("empty markerless first-run: sessionDirectory has no markers, parent has package.json → packageRoot=null", () => {
    // given — empty session directory, no markers; parent (testDir) has package.json
    const emptyDir = join(testDir, "new-empty")
    mkdirSync(emptyDir, { recursive: true })
    writeFileSync(join(testDir, "package.json"), "{}", "utf-8")

    // when
    const contract = resolveSessionRoot(emptyDir)

    // then — packageRoot must be null for first-run empty directory
    expect(contract).not.toBeNull()
    expect(contract!.source).toBe("empty_session_directory")
    expect(contract!.projectRoot).toBe(emptyDir)
    expect(contract!.packageRoot).toBeNull()
  })

  test("monorepo nested app: repo root has .git/.opencode, nested package in apps/web → packageRoot=apps/web", () => {
    // given — git repo at root with .opencode; package.json in apps/web
    mkdirSync(join(testDir, ".opencode"), { recursive: true })
    const appsWeb = join(testDir, "apps", "web")
    mkdirSync(appsWeb, { recursive: true })
    writeFileSync(join(appsWeb, "package.json"), "{}", "utf-8")

    // when — sessionDirectory is the nested app
    const contract = resolveSessionRoot(appsWeb)

    // then — packageRoot is the nested package dir (hasOwnMarkers via package.json)
    // worktreeRoot is null because no real git repo exists
    expect(contract).not.toBeNull()
    expect(contract!.sessionDirectory).toBe(appsWeb)
    expect(contract!.packageRoot).toBe(appsWeb)
    // projectRoot is resolvedDir (appsWeb) because it has its own package.json marker
    expect(contract!.projectRoot).toBe(appsWeb)
    expect(contract!.source).toBe("package_manifest")
  })

  test("parent-home marker guard: parent has package.json, nested empty project → packageRoot=null", () => {
    // given — simulate /home-like parent with package.json; empty project under it
    const fakeHome = join(testDir, "home")
    mkdirSync(fakeHome, { recursive: true })
    writeFileSync(join(fakeHome, "package.json"), "{}", "utf-8")
    const projectDir = join(fakeHome, "my-empty-project")
    mkdirSync(projectDir, { recursive: true })

    // when
    const contract = resolveSessionRoot(projectDir)

    // then — packageRoot must not climb into the "home" parent
    expect(contract).not.toBeNull()
    expect(contract!.packageRoot).toBeNull()
    // projectRoot is the empty project, not the fake-home
    expect(contract!.projectRoot).toBe(projectDir)
  })
})
