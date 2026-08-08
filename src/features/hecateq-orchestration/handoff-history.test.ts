import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  appendHandoffHistoryEntry,
  clearHandoffHistory,
  loadRecentHandoffHistory,
  _setHandoffHistoryFilePathForTesting,
} from "./handoff-history"
import type { HecateqHandoffHistoryEntry } from "./handoff-history"

function makeEntry(overrides: Partial<HecateqHandoffHistoryEntry> = {}): HecateqHandoffHistoryEntry {
  return {
    timestamp: "2026-08-08T14:30:00.000Z",
    session_id: "ses_test",
    from_agent: "hecateq-planner",
    to_agent: "reviewer",
    status: "done",
    confidence: 0.92,
    ...overrides,
  }
}

describe("handoff history ledger", () => {
  let dir: string
  let ledgerPath: string

  beforeEach(() => {
    // given a fresh temp ledger
    dir = mkdtempSync(join(tmpdir(), "hecateq-handoff-history-"))
    ledgerPath = join(dir, ".opencode", "state", "hecateq", "handoff-history.jsonl")
    _setHandoffHistoryFilePathForTesting(ledgerPath)
  })

  afterEach(() => {
    _setHandoffHistoryFilePathForTesting(null)
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  test("#given an entry #when appended #then a JSON line is written", () => {
    // given
    const entry = makeEntry()
    // when
    appendHandoffHistoryEntry(entry)
    // then
    expect(readFileSync(ledgerPath, "utf-8").trim().split("\n")).toHaveLength(1)
  })

  test("#given seven entries #when loading recent #then returns last five", () => {
    // given
    for (let i = 1; i <= 7; i += 1) {
      appendHandoffHistoryEntry(makeEntry({ timestamp: `2026-08-08T14:${String(i).padStart(2, "0")}:00.000Z` }))
    }
    // when
    const recent = loadRecentHandoffHistory(5)
    // then
    expect(recent).toHaveLength(5)
    expect(recent[0]?.timestamp).toContain("14:03")
    expect(recent[4]?.timestamp).toContain("14:07")
  })

  test("#given entries #when clearing #then the ledger is empty", () => {
    // given
    appendHandoffHistoryEntry(makeEntry())
    // when
    clearHandoffHistory()
    // then
    expect(readFileSync(ledgerPath, "utf-8")).toBe("")
    expect(loadRecentHandoffHistory()).toEqual([])
  })

  test("#given an invalid JSON line in the ledger #when loading #then it is skipped", () => {
    // given
    appendHandoffHistoryEntry(makeEntry())
    // inject a corrupt line directly
    const corrupt = `${readFileSync(ledgerPath, "utf-8")}{broken json\n`
    writeFileSync(ledgerPath, corrupt, "utf-8")
    // when
    const entries = loadRecentHandoffHistory(10)
    // then — no crash, valid line still parsed
    expect(entries).toHaveLength(1)
    expect(entries[0]?.from_agent).toBe("hecateq-planner")
  })

  test("#given an entry #when serialized #then only typed fields are stored (no secrets/prompts)", () => {
    // given
    appendHandoffHistoryEntry(makeEntry({ task_graph_id: "g1", task_id: "t1" }))
    // when
    const line = readFileSync(ledgerPath, "utf-8").trim()
    const parsed = JSON.parse(line) as Record<string, unknown>
    // then
    expect(Object.keys(parsed).sort()).toEqual(
      [
        "timestamp",
        "session_id",
        "from_agent",
        "to_agent",
        "status",
        "confidence",
        "task_graph_id",
        "task_id",
      ].sort(),
    )
    expect(parsed["prompt"]).toBeUndefined()
    expect(parsed["secret"]).toBeUndefined()
    expect(parsed["model_output"]).toBeUndefined()
    expect(line).not.toContain("sk-")
  })

  test("#given no ledger file #when loading #then returns empty array", () => {
    // given — fresh dir, no file created yet
    // when
    const entries = loadRecentHandoffHistory()
    // then
    expect(entries).toEqual([])
  })
})
