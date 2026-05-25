import { describe, expect, it } from "bun:test"
import {
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  acquireLock,
  releaseLock,
  getLock,
  breakStaleLock,
  listActiveLocks,
  readLockFile,
  isLockStale,
  getLockDir,
  getLockPath,
  MIN_MEMORY_LOCK_TTL_SECONDS,
  MAX_MEMORY_LOCK_TTL_SECONDS,
} from "./memory-lock"
import {
  PROJECT_MEMORY_DIR,
  bootstrapMemoryFiles,
  bootstrapMemoryManifest,
} from "./memory-bootstrap"
import { DEFAULT_MEMORY_LOCK_TTL_SECONDS } from "./memory-manifest"

describe("memory-lock", () => {
  let testDir = ""

  function setupTempDir(): string {
    testDir = join(tmpdir(), `omo-mem-lock-${randomUUID()}`)
    mkdirSync(testDir, { recursive: true })
    // Set up as a project with .opencode marker
    mkdirSync(join(testDir, ".opencode"), { recursive: true })
    bootstrapMemoryFiles(testDir)
    bootstrapMemoryManifest(testDir, "opencode")
    return testDir
  }

  function cleanup(): void {
    if (testDir) rmSync(testDir, { recursive: true, force: true })
  }

  describe("getLockDir / getLockPath", () => {
    it("resolves lock directory under PROJECT_MEMORY_DIR/.locks", () => {
      // given a project root
      const root = setupTempDir()
      const expectedDir = join(root, PROJECT_MEMORY_DIR, ".locks")

      // when
      const result = getLockDir(root)

      // then
      expect(result).toBe(expectedDir)

      cleanup()
    })

    it("resolves lock file path for a given file name", () => {
      // given
      const root = setupTempDir()
      const fileName = "active-context.md"

      // when
      const result = getLockPath(root, fileName)

      // then
      expect(result).toBe(join(root, PROJECT_MEMORY_DIR, ".locks", "active-context.md.lock"))

      cleanup()
    })
  })

  describe("acquireLock", () => {
    it("acquires a lock when no lock exists", () => {
      // given
      const root = setupTempDir()
      const fileName = "active-context.md"

      // when
      const result = acquireLock(root, fileName, "ses_abc", "sisyphus")

      // then
      expect(result.acquired).toBe(true)
      expect(result.brokeStale).toBe(false)
      expect(result.existingLock).toBeNull()
      expect(result.reason).toBeNull()

      // verify lock exists on disk
      const lock = getLock(root, fileName)
      expect(lock).not.toBeNull()
      expect(lock!.locked_by_session).toBe("ses_abc")
      expect(lock!.locked_by_agent).toBe("sisyphus")
      expect(lock!.lock_ttl_seconds).toBe(DEFAULT_MEMORY_LOCK_TTL_SECONDS)

      cleanup()
    })

    it("re-acquires (extends) lock held by same session+agent", () => {
      // given an existing lock
      const root = setupTempDir()
      const fileName = "tasks.md"
      acquireLock(root, fileName, "ses_abc", "sisyphus")

      // when re-acquiring by same identity
      const result = acquireLock(root, fileName, "ses_abc", "sisyphus")

      // then
      expect(result.acquired).toBe(true)
      expect(result.brokeStale).toBe(false)

      cleanup()
    })

    it("refuses to acquire lock held by different session", () => {
      // given a lock held by session A
      const root = setupTempDir()
      const fileName = "progress.md"
      acquireLock(root, fileName, "ses_abc", "sisyphus")

      // when session B tries to acquire
      const result = acquireLock(root, fileName, "ses_xyz", "hephaestus")

      // then
      expect(result.acquired).toBe(false)
      expect(result.brokeStale).toBe(false)
      expect(result.existingLock).not.toBeNull()
      expect(result.existingLock!.locked_by_session).toBe("ses_abc")
      expect(result.reason).toContain("ses_abc")

      // verify original lock still intact
      const lock = getLock(root, fileName)
      expect(lock!.locked_by_session).toBe("ses_abc")

      cleanup()
    })

    it("refuses to acquire lock held by same session but different agent", () => {
      // given a lock held by session ses_abc agent sisyphus
      const root = setupTempDir()
      const fileName = "decisions.md"
      acquireLock(root, fileName, "ses_abc", "sisyphus")

      // when same session but different agent tries to acquire
      const result = acquireLock(root, fileName, "ses_abc", "hephaestus")

      // then
      expect(result.acquired).toBe(false)
      expect(result.existingLock!.locked_by_agent).toBe("sisyphus")

      cleanup()
    })

    it("breaks stale lock and acquires for new owner", () => {
      // given a stale lock (TTL = 1 second, wait > 1s to make it stale)
      const root = setupTempDir()
      const fileName = "file-map.md"

      // Acquire with minimal TTL
      acquireLock(root, fileName, "ses_old", "atlas", MIN_MEMORY_LOCK_TTL_SECONDS)

      // Manually set locked_at to the past to simulate staleness
      const lockPath = getLockPath(root, fileName)
      const staleLock = {
        locked_by_session: "ses_old",
        locked_by_agent: "atlas",
        locked_at: new Date(Date.now() - 200_000).toISOString(), // ~3 min ago
        lock_ttl_seconds: MIN_MEMORY_LOCK_TTL_SECONDS,
      }
      writeFileSync(lockPath, JSON.stringify(staleLock), "utf-8")

      // when a new session acquires
      const result = acquireLock(root, fileName, "ses_new", "prometheus")

      // then
      expect(result.acquired).toBe(true)
      expect(result.brokeStale).toBe(true)

      // verify new owner
      const lock = getLock(root, fileName)
      expect(lock!.locked_by_session).toBe("ses_new")
      expect(lock!.locked_by_agent).toBe("prometheus")

      cleanup()
    })

    it("clamps TTL to allowed range", () => {
      // given
      const root = setupTempDir()

      // when TTL is too low
      acquireLock(root, "active-context.md", "ses_a", "sisyphus", 1)
      const lowLock = getLock(root, "active-context.md")
      expect(lowLock!.lock_ttl_seconds).toBe(MIN_MEMORY_LOCK_TTL_SECONDS)

      breakStaleLock(root, "active-context.md")

      // when TTL is too high
      acquireLock(root, "progress.md", "ses_b", "sisyphus", 99999)
      const highLock = getLock(root, "progress.md")
      expect(highLock!.lock_ttl_seconds).toBe(MAX_MEMORY_LOCK_TTL_SECONDS)

      cleanup()
    })

    it("ensures lock directory is created on first acquire", () => {
      // given a project without the .locks directory
      const root = setupTempDir()
      const lockDir = getLockDir(root)
      // Remove lock directory if it exists
      try { rmSync(lockDir, { recursive: true, force: true }) } catch { /* noop */ }

      // when acquiring a lock
      acquireLock(root, "active-context.md", "ses_test", "explore")

      // then the lock directory was created
      expect(existsSync(lockDir)).toBe(true)

      cleanup()
    })
  })

  describe("releaseLock", () => {
    it("releases a lock held by the same session+agent", () => {
      // given an existing lock
      const root = setupTempDir()
      const fileName = "active-context.md"
      acquireLock(root, fileName, "ses_abc", "sisyphus")

      // when releasing by same identity
      const released = releaseLock(root, fileName, "ses_abc", "sisyphus")

      // then
      expect(released).toBe(true)
      const lock = getLock(root, fileName)
      expect(lock).toBeNull()

      cleanup()
    })

    it("refuses to release a lock held by a different session", () => {
      // given
      const root = setupTempDir()
      const fileName = "tasks.md"
      acquireLock(root, fileName, "ses_abc", "sisyphus")

      // when
      const released = releaseLock(root, fileName, "ses_xyz", "hephaestus")

      // then
      expect(released).toBe(false)
      const lock = getLock(root, fileName)
      expect(lock).not.toBeNull()

      cleanup()
    })

    it("returns false when no lock exists", () => {
      // given
      const root = setupTempDir()

      // when
      const released = releaseLock(root, "active-context.md", "ses_fake", "sisyphus")

      // then
      expect(released).toBe(false)

      cleanup()
    })

    it("refuses to release lock held by same session but different agent", () => {
      // given
      const root = setupTempDir()
      const fileName = "progress.md"
      acquireLock(root, fileName, "ses_abc", "sisyphus")

      // when
      const released = releaseLock(root, fileName, "ses_abc", "oracle")

      // then
      expect(released).toBe(false)
      expect(getLock(root, fileName)).not.toBeNull()

      cleanup()
    })
  })

  describe("getLock", () => {
    it("returns null when no lock exists", () => {
      // given
      const root = setupTempDir()

      // when
      const lock = getLock(root, "active-context.md")

      // then
      expect(lock).toBeNull()

      cleanup()
    })

    it("returns the lock when it exists", () => {
      // given
      const root = setupTempDir()
      acquireLock(root, "decisions.md", "ses_abc", "prometheus")

      // when
      const lock = getLock(root, "decisions.md")

      // then
      expect(lock).not.toBeNull()
      expect(lock!.locked_by_session).toBe("ses_abc")
      expect(lock!.locked_by_agent).toBe("prometheus")

      cleanup()
    })
  })

  describe("breakStaleLock", () => {
    it("removes a lock file regardless of owner", () => {
      // given
      const root = setupTempDir()
      const fileName = "file-map.md"
      acquireLock(root, fileName, "ses_abc", "sisyphus")

      // when
      breakStaleLock(root, fileName)

      // then
      const lock = getLock(root, fileName)
      expect(lock).toBeNull()

      cleanup()
    })

    it("is idempotent (no-op when no lock exists)", () => {
      // given no lock
      const root = setupTempDir()

      // when - should not throw
      breakStaleLock(root, "active-context.md")

      // then - just verifies no error
      cleanup()
    })
  })

  describe("isLockStale", () => {
    it("returns true for a lock older than its TTL", () => {
      // given a lock from 10 minutes ago with 5 minute TTL
      const lock = {
        locked_by_session: "ses_old",
        locked_by_agent: "atlas",
        locked_at: new Date(Date.now() - 600_000).toISOString(),
        lock_ttl_seconds: 300,
      }

      // when
      const result = isLockStale(lock)

      // then
      expect(result).toBe(true)
    })

    it("returns false for a fresh lock", () => {
      // given a lock from 10 seconds ago with 5 minute TTL
      const lock = {
        locked_by_session: "ses_new",
        locked_by_agent: "sisyphus",
        locked_at: new Date(Date.now() - 10_000).toISOString(),
        lock_ttl_seconds: 300,
      }

      // when
      const result = isLockStale(lock)

      // then
      expect(result).toBe(false)
    })

    it("returns true for a lock with invalid timestamp", () => {
      // given a lock with invalid locked_at
      const lock = {
        locked_by_session: "ses_bad",
        locked_by_agent: "sisyphus",
        locked_at: "not-a-date",
        lock_ttl_seconds: 300,
      }

      // when
      const result = isLockStale(lock)

      // then
      expect(result).toBe(true)
    })
  })

  describe("listActiveLocks", () => {
    it("returns empty array when no locks exist", () => {
      // given
      const root = setupTempDir()

      // when
      const result = listActiveLocks(root)

      // then
      expect(result).toEqual([])

      cleanup()
    })

    it("lists only non-stale locks", () => {
      // given two locks — one fresh, one stale
      const root = setupTempDir()
      acquireLock(root, "active-context.md", "ses_a", "sisyphus")

      // Create a stale lock manually
      const staleLockPath = getLockPath(root, "tasks.md")
      const lockDir = getLockDir(root)
      mkdirSync(lockDir, { recursive: true })
      writeFileSync(staleLockPath, JSON.stringify({
        locked_by_session: "ses_old",
        locked_by_agent: "oracle",
        locked_at: new Date(Date.now() - 600_000).toISOString(),
        lock_ttl_seconds: 10,
      }), "utf-8")

      // when
      const result = listActiveLocks(root)

      // then — only the fresh lock should appear
      expect(result.length).toBe(1)
      expect(result[0].fileName).toBe("active-context.md")
      expect(result[0].lock.locked_by_agent).toBe("sisyphus")

      cleanup()
    })

    it("returns empty when lock directory does not exist", () => {
      // given project without lock dir
      const root = setupTempDir()
      const lockDir = getLockDir(root)
      try { rmSync(lockDir, { recursive: true, force: true }) } catch { /* noop */ }

      // when
      const result = listActiveLocks(root)

      // then
      expect(result).toEqual([])

      cleanup()
    })
  })

  describe("readLockFile", () => {
    it("returns null for non-existent lock", () => {
      // given
      const root = setupTempDir()

      // when
      const result = readLockFile(root, "active-context.md")

      // then
      expect(result).toBeNull()

      cleanup()
    })

    it("returns null for invalid lock content", () => {
      // given a lock file with invalid JSON
      const root = setupTempDir()
      const lockPath = getLockPath(root, "active-context.md")
      mkdirSync(getLockDir(root), { recursive: true })
      writeFileSync(lockPath, "not valid json", "utf-8")

      // when
      const result = readLockFile(root, "active-context.md")

      // then
      expect(result).toBeNull()

      cleanup()
    })
  })
})
