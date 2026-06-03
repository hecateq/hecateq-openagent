import { describe, it, expect, afterEach } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { HermesEventLog } from "./hermes-event-log"

function createTestDir(): string {
  const dir = join(tmpdir(), `hermes-event-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

describe("HermesEventLog", () => {
  let testDir: string
  let eventLog: HermesEventLog

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }) } catch { /* cleanup */ }
  })

  it("logs session.created event to daily JSONL file", () => {
    testDir = createTestDir()
    eventLog = new HermesEventLog(testDir)
    eventLog.logSessionCreated("ses_abc", "hephaestus", "ses_parent")
    const dateStr = new Date().toISOString().slice(0, 10)
    const eventsPath = join(testDir, ".opencode", "state", "events", `events-${dateStr}.jsonl`)
    expect(existsSync(eventsPath)).toBe(true)
    const entry = JSON.parse(readFileSync(eventsPath, "utf-8").trim())
    expect(entry.type).toBe("session.created")
    expect(entry.session_id).toBe("ses_abc")
    expect(entry.data.agent).toBe("hephaestus")
    expect(entry.data.parent_session_id).toBe("ses_parent")
  })

  it("logs session.idle event", () => {
    testDir = createTestDir()
    eventLog = new HermesEventLog(testDir)
    eventLog.logSessionIdle("ses_abc", "2026-06-03T10:00:00Z", 42)
    const dateStr = new Date().toISOString().slice(0, 10)
    const eventsPath = join(testDir, ".opencode", "state", "events", `events-${dateStr}.jsonl`)
    const entry = JSON.parse(readFileSync(eventsPath, "utf-8").trim())
    expect(entry.type).toBe("session.idle")
    expect(entry.session_id).toBe("ses_abc")
    expect(entry.data.last_active).toBe("2026-06-03T10:00:00Z")
    expect(entry.data.message_count).toBe(42)
  })

  it("logs session.error event with sanitized error message", () => {
    testDir = createTestDir()
    eventLog = new HermesEventLog(testDir)
    eventLog.logSessionError("ses_err", "API key sk-abc123 leaked in error", "hephaestus")
    const dateStr = new Date().toISOString().slice(0, 10)
    const eventsPath = join(testDir, ".opencode", "state", "events", `events-${dateStr}.jsonl`)
    const entry = JSON.parse(readFileSync(eventsPath, "utf-8").trim())
    expect(entry.type).toBe("session.error")
    expect(entry.session_id).toBe("ses_err")
    expect(entry.data.agent).toBe("hephaestus")
    expect(typeof entry.data.error).toBe("string")
  })

  it("logs session.deleted event", () => {
    testDir = createTestDir()
    eventLog = new HermesEventLog(testDir)
    eventLog.logSessionDeleted("ses_abc")
    const dateStr = new Date().toISOString().slice(0, 10)
    const eventsPath = join(testDir, ".opencode", "state", "events", `events-${dateStr}.jsonl`)
    const entry = JSON.parse(readFileSync(eventsPath, "utf-8").trim())
    expect(entry.type).toBe("session.deleted")
    expect(entry.session_id).toBe("ses_abc")
  })

  it("sanitizes secret values in event data", () => {
    testDir = createTestDir()
    eventLog = new HermesEventLog(testDir)
    eventLog.logEvent("test.event", "ses_test", {
      token: "sk-abcdef1234567890",
      public_field: "visible",
      nested: { api_key: "ghp_secret123" },
    })
    const dateStr = new Date().toISOString().slice(0, 10)
    const eventsPath = join(testDir, ".opencode", "state", "events", `events-${dateStr}.jsonl`)
    const entry = JSON.parse(readFileSync(eventsPath, "utf-8").trim())
    expect(entry.data.token).toBe("[redacted]")
    expect(entry.data.public_field).toBe("visible")
    expect(entry.data.nested.api_key).toBe("[redacted]")
  })

  it("appends multiple events to the same daily file", () => {
    testDir = createTestDir()
    eventLog = new HermesEventLog(testDir)
    eventLog.logSessionCreated("ses_1", "agent_a", null)
    eventLog.logSessionCreated("ses_2", "agent_b", null)
    eventLog.logSessionDeleted("ses_1")
    const dateStr = new Date().toISOString().slice(0, 10)
    const eventsPath = join(testDir, ".opencode", "state", "events", `events-${dateStr}.jsonl`)
    const lines = readFileSync(eventsPath, "utf-8").trim().split("\n")
    expect(lines).toHaveLength(3)
    expect(JSON.parse(lines[0]).session_id).toBe("ses_1")
    expect(JSON.parse(lines[1]).session_id).toBe("ses_2")
    expect(JSON.parse(lines[2]).session_id).toBe("ses_1")
  })
})
