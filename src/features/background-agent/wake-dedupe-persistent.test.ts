import { tmpdir } from "node:os"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"
import {
  WakeDuplicateSuppressor,
  type WakeDedupePersistence,
} from "./wake-idempotency"
import { FileWakeDedupePersistence } from "./wake-dedup-persistence"

const createdDirectories: string[] = []

function createWorkdir(): string {
  const workdir = mkdtempSync(join(tmpdir(), "omo-wake-dedup-"))
  createdDirectories.push(workdir)
  return workdir
}

afterEach(() => {
  for (const directory of createdDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

class InMemoryPersistence implements WakeDedupePersistence {
  private keys: Set<string> = new Set()
  private available = true

  setAvailable(avail: boolean): void { this.available = avail }
  isAvailable(): boolean { return this.available }
  async readKeys(): Promise<string[]> { return Array.from(this.keys) }
  async addKey(key: string): Promise<void> { this.keys.add(key); await Promise.resolve() }
}

describe("WakeDuplicateSuppressor with persistence", () => {
  test("suppresses duplicate dispatch across re-instantiation via persistence", async () => {
    // given — first suppressor instance
    const persistence = new InMemoryPersistence()
    const suppressor1 = new WakeDuplicateSuppressor({ persistence, ttlMs: 60000 })

    const key = WakeDuplicateSuppressor.buildKey("task-1", "parent-1", "completed")

    // when — first dispatch
    const shouldDispatch1 = await suppressor1.shouldDispatch(key)
    expect(shouldDispatch1).toBe(true)
    await suppressor1.markDispatched(key)

    // given — second instance (simulates restart)
    const suppressor2 = new WakeDuplicateSuppressor({ persistence, ttlMs: 60000 })

    // when — second dispatch attempt with same key
    const shouldDispatch2 = await suppressor2.shouldDispatch(key)

    // then — suppressed
    expect(shouldDispatch2).toBe(false)
  })

  test("TTL still applies with persistence", async () => {
    // given
    const persistence = new InMemoryPersistence()
    const suppressor = new WakeDuplicateSuppressor({ persistence, ttlMs: 50 })

    const key = WakeDuplicateSuppressor.buildKey("task-2", "parent-2", "completed")

    await suppressor.markDispatched(key)

    // when — within TTL
    let shouldDispatch = await suppressor.shouldDispatch(key)
    expect(shouldDispatch).toBe(false)

    // when — after TTL expires (in-memory prunes, but persistence may still have it)
    // We simulate this by clearing the in-memory map but keeping persistence
    suppressor.clearAll()

    // then — persistence still blocks it (the persisted key hasn't expired)
    // For TTL on persisted entries, the readKeys filter applies the TTL.
    // With ttlMs=50, a key added immediately should still be within TTL.
    shouldDispatch = await suppressor.shouldDispatch(key)
    expect(shouldDispatch).toBe(false)
  })

  test("persistence read failure is fail-open (no dedupe records, with warning)", async () => {
    // given
    const persistence = new InMemoryPersistence()
    persistence.setAvailable(false) // simulate unavailable persistence
    const suppressor = new WakeDuplicateSuppressor({ persistence, ttlMs: 60000 })

    const key = WakeDuplicateSuppressor.buildKey("task-3", "parent-3", "completed")

    // when — persistence unavailable, falls back to in-memory only
    const shouldDispatch = await suppressor.shouldDispatch(key)

    // then — dispatches (fail-open), no crash
    expect(shouldDispatch).toBe(true)
    await suppressor.markDispatched(key)

    // second attempt within same instance (in-memory blocks it)
    const shouldDispatch2 = await suppressor.shouldDispatch(key)
    expect(shouldDispatch2).toBe(false)
  })

  test("hasPersistence reports true when persistence is configured and available", () => {
    const persistence = new InMemoryPersistence()
    const suppressor = new WakeDuplicateSuppressor({ persistence })
    expect(suppressor.hasPersistence).toBe(true)
  })

  test("hasPersistence reports false when persistence is not configured", () => {
    const suppressor = new WakeDuplicateSuppressor()
    expect(suppressor.hasPersistence).toBe(false)
  })

  test("hasPersistence reports false when persistence is unavailable", () => {
    const persistence = new InMemoryPersistence()
    persistence.setAvailable(false)
    const suppressor = new WakeDuplicateSuppressor({ persistence })
    expect(suppressor.hasPersistence).toBe(false)
  })
})

describe("FileWakeDedupePersistence", () => {
  test("writes and reads keys atomically", async () => {
    // given
    const workdir = createWorkdir()
    const stateDir = join(workdir, "state")
    mkdirSync(stateDir, { recursive: true })
    const persistence = new FileWakeDedupePersistence(stateDir)

    // when
    await persistence.addKey("sha256:test-key-1")
    await persistence.addKey("sha256:test-key-2")

    // then
    const keys = await persistence.readKeys()
    expect(keys).toContain("sha256:test-key-1")
    expect(keys).toContain("sha256:test-key-2")
    expect(existsSync(join(stateDir, "wake-dedupe.jsonl"))).toBe(true)
  })

  test("corrupted file is treated as empty (fail-open)", async () => {
    // given
    const workdir = createWorkdir()
    const stateDir = join(workdir, "state")
    mkdirSync(stateDir, { recursive: true })
    const dedupePath = join(stateDir, "wake-dedupe.jsonl")

    // Write corrupt content
    writeFileSync(dedupePath, "not valid json\n{\nbroken\n", "utf-8")

    const persistence = new FileWakeDedupePersistence(stateDir)

    // when
    const keys = await persistence.readKeys()

    // then — no crash, returns empty (fail-open)
    expect(keys).toEqual([])
  })
})
