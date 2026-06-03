import { describe, it, expect, afterEach } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { HermesStateWriter } from "./hermes-state-writer"

function createTestDir(): string {
  const dir = join(tmpdir(), `hermes-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

describe("HermesStateWriter", () => {
  let testDir: string
  let writer: HermesStateWriter

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }) } catch { /* cleanup best-effort */ }
  })

  // given a fresh test directory
  // when constructing a HermesStateWriter
  // then it resolves the correct state directory paths
  it("resolves stateDir and eventsDir from projectRoot", () => {
    testDir = createTestDir()
    writer = new HermesStateWriter(testDir)
    expect(writer.stateDir).toBe(join(testDir, ".opencode", "state"))
    expect(writer.eventsDir).toBe(join(testDir, ".opencode", "state", "events"))
  })

  // given a new project root
  // when ensureStateDir is called
  // then the state directory exists on disk
  it("ensureStateDir creates the state directory", () => {
    testDir = createTestDir()
    writer = new HermesStateWriter(testDir)
    const result = writer.ensureStateDir()
    expect(result).toBe(true)
    expect(existsSync(writer.stateDir)).toBe(true)
  })

  // given a valid state writer
  // when writeAtomically is called with a filename and content
  // then the file exists with the correct content
  it("writeAtomically writes a file to the state directory", () => {
    testDir = createTestDir()
    writer = new HermesStateWriter(testDir)
    const content = '{"key":"value"}'
    const result = writer.writeAtomically("test.json", content)
    expect(result).toBe(true)
    const filePath = join(writer.stateDir, "test.json")
    expect(existsSync(filePath)).toBe(true)
    expect(readFileSync(filePath, "utf-8")).toBe(content)
    const tmpPath = join(writer.stateDir, "test.json.tmp")
    expect(existsSync(tmpPath)).toBe(false)
  })

  // given a state writer
  // when appendJSONL is called multiple times
  // then each line is a valid JSON object
  it("appendJSONL appends multiple valid JSON lines", () => {
    testDir = createTestDir()
    writer = new HermesStateWriter(testDir)
    const result1 = writer.appendJSONL("events/test.jsonl", { type: "a", value: 1 })
    const result2 = writer.appendJSONL("events/test.jsonl", { type: "b", value: 2 })
    expect(result1).toBe(true)
    expect(result2).toBe(true)
    const filePath = join(writer.stateDir, "events", "test.jsonl")
    expect(existsSync(filePath)).toBe(true)
    const lines = readFileSync(filePath, "utf-8").trim().split("\n")
    expect(lines).toHaveLength(2)
    expect(() => JSON.parse(lines[0])).not.toThrow()
    expect(() => JSON.parse(lines[1])).not.toThrow()
    expect(JSON.parse(lines[0])).toEqual({ type: "a", value: 1 })
    expect(JSON.parse(lines[1])).toEqual({ type: "b", value: 2 })
  })

  // given a state writer
  // when appendJSONL is called and the parent dir does not exist
  // then it creates the directory and appends successfully
  it("appendJSONL creates parent directories when missing", () => {
    testDir = createTestDir()
    writer = new HermesStateWriter(testDir)
    const result = writer.appendJSONL("events/2026/sub/test.jsonl", { x: 1 })
    expect(result).toBe(true)
    const filePath = join(writer.stateDir, "events", "2026", "sub", "test.jsonl")
    expect(existsSync(filePath)).toBe(true)
  })

  // given an object with secret-like keys
  // when sanitizeForExport is called
  // then secret-like keys are redacted
  it("sanitizeForExport redacts secret-like keys", () => {
    testDir = createTestDir()
    writer = new HermesStateWriter(testDir)
    const input = {
      name: "test",
      api_key: "sk-abc123",
      password: "secret123",
      token: "eyJhbGciOiJI",
      nested: { secret: "hidden", normal: "visible" },
      array: [{ token: "xoxb-123", ok: true }],
    }
    const sanitized = writer.sanitizeForExport(input)
    expect(sanitized.name).toBe("test")
    expect(sanitized.api_key).toBe("[redacted]")
    expect(sanitized.password).toBe("[redacted]")
    expect(sanitized.token).toBe("[redacted]")
    expect((sanitized.nested as Record<string, unknown>).secret).toBe("[redacted]")
    expect((sanitized.nested as Record<string, unknown>).normal).toBe("visible")
    expect((sanitized.array as Array<Record<string, unknown>>)[0].token).toBe("[redacted]")
    expect((sanitized.array as Array<Record<string, unknown>>)[0].ok).toBe(true)
  })

  // given a value that looks like an API key
  // when isSecretValue is called
  // then it returns true
  it("isSecretValue detects API-key-like strings", () => {
    testDir = createTestDir()
    writer = new HermesStateWriter(testDir)
    expect(writer.isSecretValue("sk-abc123def456ghi789jkl012")).toBe(true)
    expect(writer.isSecretValue("ghp_abcdefghijklmno12345pqrs")).toBe(true)
    expect(writer.isSecretValue("hello world")).toBe(false)
    expect(writer.isSecretValue("")).toBe(false)
  })

  // given a state writer
  // when truncateDescription is called on a long string
  // then it truncates to maxLen
  it("truncateDescription truncates long strings", () => {
    testDir = createTestDir()
    writer = new HermesStateWriter(testDir)
    const long = "a".repeat(300)
    const result = HermesStateWriter.truncateDescription(long, 200)
    expect(result).toHaveLength(200)
    expect(result.endsWith("...")).toBe(true)
  })

  it("truncateDescription returns empty string for null input", () => {
    expect(HermesStateWriter.truncateDescription(null)).toBe("")
    expect(HermesStateWriter.truncateDescription(undefined)).toBe("")
  })

  // given a valid Date
  // when toISO is called
  // then it returns ISO-8601 string
  it("toISO formats dates correctly", () => {
    const date = new Date("2026-06-03T12:00:00Z")
    expect(HermesStateWriter.toISO(date)).toBe("2026-06-03T12:00:00.000Z")
    expect(HermesStateWriter.toISO(null)).toBe(null)
    expect(HermesStateWriter.toISO(undefined)).toBe(null)
  })

  // given a writer where writeAtomically fails (e.g. invalid path)
  // when writeAtomically is called
  // then it returns false without throwing
  it("writeAtomically returns false on failure instead of throwing", () => {
    writer = new HermesStateWriter("/nonexistent/path/that/cannot/be/created/+/invalid")
    const result = writer.writeAtomically("test.json", "content")
    expect(result).toBe(false)
  })
})
