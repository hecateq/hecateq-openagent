import { describe, expect, it, afterEach, beforeEach } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"

import { pruneJsonlFileByLimits } from "./jsonl-retention"

function tmpFilePath(): string {
  const dir = join(tmpdir(), "jsonl-retention-test-" + randomUUID())
  mkdirSync(dir, { recursive: true })
  return join(dir, "test.jsonl")
}

function writeTestJsonl(filePath: string, entries: Array<Record<string, unknown>>): void {
  const content = entries.map((e) => JSON.stringify(e)).join("\n") + "\n"
  writeFileSync(filePath, content, "utf-8")
}

function readTestJsonl(filePath: string): string[] {
  return readFileSync(filePath, "utf-8").split("\n").filter((l) => l.trim().length > 0)
}

function makeEntry(id: number): Record<string, unknown> {
  return { id, value: `entry-${id}`, ts: new Date().toISOString() }
}

describe("pruneJsonlFileByLimits", () => {
  let filePath = ""

  beforeEach(() => {
    filePath = tmpFilePath()
  })

  afterEach(() => {
    try {
      const dir = filePath.split("/").slice(0, -1).join("/")
      if (existsSync(dir)) rmSync(dir, { recursive: true })
    } catch {
      // cleanup best-effort
    }
  })

  describe("#given a non-existent file", () => {
    it("returns attempted=false", () => {
      const result = pruneJsonlFileByLimits(filePath, { maxLines: 10 })
      expect(result.attempted).toBe(false)
      expect(result.pruned).toBe(false)
    })
  })

  describe("#given an empty file", () => {
    it("returns attempted=false", () => {
      writeFileSync(filePath, "", "utf-8")
      const result = pruneJsonlFileByLimits(filePath, { maxLines: 10 })
      expect(result.attempted).toBe(false)
    })
  })

  describe("#given a file within line and byte limits", () => {
    it("returns attempted=false", () => {
      const entries = Array.from({ length: 5 }, (_, i) => makeEntry(i))
      writeTestJsonl(filePath, entries)
      const result = pruneJsonlFileByLimits(filePath, { maxLines: 100, maxBytes: 1_000_000 })
      expect(result.attempted).toBe(false)
      expect(result.pruned).toBe(false)
    })
  })

  describe("#given a file exceeding line limit with preserveNewest=true", () => {
    it("removes oldest lines, keeps newest", () => {
      const entries = Array.from({ length: 20 }, (_, i) => makeEntry(i))
      writeTestJsonl(filePath, entries)
      const result = pruneJsonlFileByLimits(filePath, { maxLines: 10, maxBytes: 1_000_000, preserveNewest: true })
      expect(result.pruned).toBe(true)
      expect(result.originalLines).toBe(20)
      expect(result.keptLines).toBe(10)
      const kept = readTestJsonl(filePath)
      expect(kept).toHaveLength(10)
      const lastEntry = JSON.parse(kept[kept.length - 1])
      expect(lastEntry.id).toBe(19)
    })
  })

  describe("#given a file exceeding byte limit", () => {
    it("removes oldest lines until bytes are within limit", () => {
      const entries = Array.from({ length: 100 }, (_, i) => ({
        id: i,
        value: "x".repeat(500),
      }))
      writeTestJsonl(filePath, entries)
      const perLineBytes = Buffer.byteLength(JSON.stringify(entries[0]) + "\n", "utf-8")
      const totalBytes = perLineBytes * 100
      const limitBytes = perLineBytes * 30
      const result = pruneJsonlFileByLimits(filePath, {
        maxLines: 200,
        maxBytes: limitBytes,
        preserveNewest: true,
      })
      expect(result.pruned).toBe(true)
      expect(result.originalBytes).toBeGreaterThan(limitBytes)
      expect(result.finalBytes).toBeLessThanOrEqual(limitBytes + 500)
    })
  })

  describe("#given malformed lines mixed with valid JSONL", () => {
    it("preserves order and does not remove malformed lines for line count, but total line count includes all", () => {
      const valid = Array.from({ length: 15 }, (_, i) => JSON.stringify(makeEntry(i)))
      const all = [...valid, "this is not json", "{ broken json", ""]
      const content = all.join("\n") + "\n"
      writeFileSync(filePath, content, "utf-8")
      const result = pruneJsonlFileByLimits(filePath, { maxLines: 10, maxBytes: 1_000_000 })
      expect(result.pruned).toBe(true)
      expect(result.originalLines).toBe(17)
      expect(result.keptLines).toBe(10)
    })
  })

  describe("#given a file already within limits after previous prune", () => {
    it("does not prune again (idempotent)", () => {
      const entries = Array.from({ length: 5 }, (_, i) => makeEntry(i))
      writeTestJsonl(filePath, entries)
      const first = pruneJsonlFileByLimits(filePath, { maxLines: 10, maxBytes: 1_000_000 })
      expect(first.pruned).toBe(false)
      const second = pruneJsonlFileByLimits(filePath, { maxLines: 10, maxBytes: 1_000_000 })
      expect(second.pruned).toBe(false)
    })
  })

  describe("#given preserveNewest=false", () => {
    it("keeps oldest lines instead of newest", () => {
      const entries = Array.from({ length: 20 }, (_, i) => makeEntry(i))
      writeTestJsonl(filePath, entries)
      const result = pruneJsonlFileByLimits(filePath, { maxLines: 10, maxBytes: 1_000_000, preserveNewest: false })
      expect(result.pruned).toBe(true)
      const kept = readTestJsonl(filePath)
      expect(kept).toHaveLength(10)
      const firstEntry = JSON.parse(kept[0])
      expect(firstEntry.id).toBe(0)
    })
  })
})
