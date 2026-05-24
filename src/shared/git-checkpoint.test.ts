import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { detectGitState, resolveGitCheckpointOptions } from "./git-checkpoint"

function runGit(args: string[], cwd: string): string {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
    },
  })

  const stdout = Buffer.from(result.stdout ?? []).toString("utf-8").trim()
  const stderr = Buffer.from(result.stderr ?? []).toString("utf-8").trim()
  if (result.exitCode !== 0) {
    throw new Error(stderr || stdout || `git ${args.join(" ")} failed`)
  }

  return stdout
}

describe("git-checkpoint", () => {
  let testDir = ""

  beforeEach(() => {
    testDir = join(tmpdir(), `hecateq-git-checkpoint-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    if (testDir) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  function initializeGitRepository(directory = testDir): void {
    runGit(["init"], directory)
    runGit(["config", "user.email", "test@example.com"], directory)
    runGit(["config", "user.name", "Test User"], directory)
    writeFileSync(join(directory, "README.md"), "initial\n", "utf-8")
    runGit(["add", "README.md"], directory)
    runGit(["commit", "-m", "init"], directory)
  }

  test("returns NO_GIT_REPOSITORY outside a git repo", () => {
    const result = detectGitState(testDir)

    expect(result.kind).toBe("NO_GIT_REPOSITORY")
    expect(result.checkpointCreated).toBe(false)
  })

  test("returns CLEAN_REPO for a clean repository", () => {
    initializeGitRepository()

    const result = detectGitState(testDir)

    expect(result.kind).toBe("CLEAN_REPO")
    expect(result.checkpointCreated).toBe(false)
    expect(result.message).toContain("suggest mode")
  })

  test("returns DIRTY_REPO and lists dirty files", () => {
    initializeGitRepository()
    writeFileSync(join(testDir, "README.md"), "changed\n", "utf-8")
    writeFileSync(join(testDir, "notes.txt"), "new file\n", "utf-8")

    const result = detectGitState(testDir, {
      include_dirty_file_list: true,
    })

    expect(result.kind).toBe("DIRTY_REPO")
    expect(result.checkpointCreated).toBe(false)
    expect(result.dirtyFileCount).toBe(2)
    expect(result.dirtyFiles).toEqual(["README.md", "notes.txt"])
  })

  test("defaults to hiding dirty file lists while keeping dirty counts", () => {
    const options = resolveGitCheckpointOptions(undefined)

    expect(options.includeDirtyFileList).toBe(false)
    expect(options.includeDirtyFileCount).toBe(true)
    expect(options.maxDirtyFiles).toBe(10)
  })

  test("does not create a checkpoint on dirty repo in auto_clean_only mode", () => {
    initializeGitRepository()
    writeFileSync(join(testDir, "README.md"), "changed\n", "utf-8")
    const beforeHead = runGit(["rev-parse", "HEAD"], testDir)

    const result = detectGitState(testDir, {
      mode: "auto_clean_only",
      auto_checkpoint_clean_repo: true,
    })

    const afterHead = runGit(["rev-parse", "HEAD"], testDir)
    expect(result.kind).toBe("DIRTY_REPO")
    expect(result.checkpointCreated).toBe(false)
    expect(afterHead).toBe(beforeHead)
  })

  test("does not create a checkpoint by default in suggest mode", () => {
    initializeGitRepository()
    const beforeHead = runGit(["rev-parse", "HEAD"], testDir)

    const result = detectGitState(testDir, {
      mode: "suggest",
      auto_checkpoint_clean_repo: true,
    })

    const afterHead = runGit(["rev-parse", "HEAD"], testDir)
    expect(result.kind).toBe("CLEAN_REPO")
    expect(result.checkpointCreated).toBe(false)
    expect(afterHead).toBe(beforeHead)
  })

  test("creates an empty checkpoint commit only on clean repo with strict auto config", () => {
    initializeGitRepository()
    const beforeHead = runGit(["rev-parse", "HEAD"], testDir)

    const result = detectGitState(testDir, {
      mode: "auto_clean_only",
      auto_checkpoint_clean_repo: true,
      checkpoint_message: "checkpoint now",
    })

    const afterHead = runGit(["rev-parse", "HEAD"], testDir)
    const lastMessage = runGit(["log", "-1", "--pretty=%s"], testDir)

    expect(result.kind).toBe("CLEAN_REPO")
    expect(result.checkpointCreated).toBe(true)
    expect(result.checkpointCommit).toBe(afterHead)
    expect(afterHead).not.toBe(beforeHead)
    expect(lastMessage).toBe("checkpoint now")
  })

  test("truncates dirty file list to configured max", () => {
    initializeGitRepository()
    for (let index = 0; index < 4; index += 1) {
      writeFileSync(join(testDir, `file-${index}.txt`), `${index}\n`, "utf-8")
    }

    const result = detectGitState(testDir, {
      include_dirty_file_list: true,
      max_dirty_files: 2,
    })

    expect(result.kind).toBe("DIRTY_REPO")
    expect(result.dirtyFileCount).toBe(4)
    expect(result.dirtyFiles).toHaveLength(2)
    expect(result.truncated).toBe(true)
  })

  test("omits dirty file list when disabled by config", () => {
    initializeGitRepository()
    writeFileSync(join(testDir, "README.md"), "changed\n", "utf-8")

    const result = detectGitState(testDir, {
      include_dirty_file_list: false,
    })

    expect(result.kind).toBe("DIRTY_REPO")
    expect(result.dirtyFileCount).toBe(1)
    expect(result.dirtyFiles).toBeUndefined()
  })

  test("preserves dirty file count even when list is disabled", () => {
    initializeGitRepository()
    writeFileSync(join(testDir, "README.md"), "changed\n", "utf-8")

    const result = detectGitState(testDir, {
      include_dirty_file_list: false,
      include_dirty_file_count: false,
    })

    expect(result.kind).toBe("DIRTY_REPO")
    expect(result.dirtyFileCount).toBe(1)
    expect(result.dirtyFiles).toBeUndefined()
  })

  test("returns GIT_ERROR without throwing when commit cannot be created", () => {
    initializeGitRepository()
    writeFileSync(join(testDir, ".git", "index.lock"), "locked\n", "utf-8")

    const result = detectGitState(testDir, {
      mode: "auto_clean_only",
      auto_checkpoint_clean_repo: true,
    })

    expect(result.kind).toBe("GIT_ERROR")
    expect(result.checkpointCreated).toBe(false)
  })

  test("normalizes invalid checkpoint messages back to the default", () => {
    const options = resolveGitCheckpointOptions({ checkpoint_message: "   " })

    expect(options.checkpointMessage).toBe("chore: checkpoint before hecateq task")
  })
})
