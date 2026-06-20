import { describe, test, expect, beforeEach } from "bun:test"
import { mkdirSync, statSync, writeFileSync, utimesSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"
import {
  getMemoryDirFingerprint,
  hasMemoryDirChanged,
  clearWatcherCache,
} from "./memory-file-watcher"
import { PROJECT_MEMORY_DIR } from "./memory-bootstrap"

describe("memory-file-watcher", () => {
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `hecateq-watcher-${randomUUID()}`)
    clearWatcherCache()
  })

  // given a project root with no memory dir
  test("returns empty fingerprint when no memory dir exists", () => {
    // when
    const result = getMemoryDirFingerprint(testDir)
    // then
    expect(result.fingerprint).toBe("")
    expect(result.fileMtimes.size).toBe(0)
  })

  // given a project root with memory files
  test("captures mtime for each memory file", () => {
    // given
    const memDir = join(testDir, PROJECT_MEMORY_DIR)
    mkdirSync(memDir, { recursive: true })
    writeFileSync(join(memDir, "active-context.md"), "# Active")
    writeFileSync(join(memDir, "progress.md"), "# Progress")

    // when
    const result = getMemoryDirFingerprint(testDir)

    // then
    expect(result.fileMtimes.size).toBe(2)
    expect(result.fileMtimes.has("active-context.md")).toBe(true)
    expect(result.fileMtimes.has("progress.md")).toBe(true)
  })

  // given a stable fingerprint
  test("detects no change when files are unchanged", () => {
    // given
    const memDir = join(testDir, PROJECT_MEMORY_DIR)
    mkdirSync(memDir, { recursive: true })
    writeFileSync(join(memDir, "active-context.md"), "# Active")
    const initial = getMemoryDirFingerprint(testDir)

    // when
    const changed = hasMemoryDirChanged(testDir, initial.fingerprint)

    // then
    expect(changed).toBe(false)
  })

  // given a file is updated
  test("detects change when file mtime advances", () => {
    // given
    const memDir = join(testDir, PROJECT_MEMORY_DIR)
    mkdirSync(memDir, { recursive: true })
    const filePath = join(memDir, "active-context.md")
    writeFileSync(filePath, "# Active")
    const initial = getMemoryDirFingerprint(testDir)

    // Advance mtime by setting it backward so next write creates a detectable difference
    const stat = statSync(filePath)
    const past = stat.mtimeMs - 5000
    utimesSync(filePath, new Date(past / 1000), new Date(past / 1000))
    const updated = getMemoryDirFingerprint(testDir)

    // when
    writeFileSync(filePath, "# Active updated")
    const changed = hasMemoryDirChanged(testDir, updated.fingerprint)

    // then
    expect(changed).toBe(true)
  })
})
