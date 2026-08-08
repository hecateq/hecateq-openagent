import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildHandoffHistoryContext } from "./handoff-history-context"
import {
  appendHandoffHistoryEntry,
  _setHandoffHistoryFilePathForTesting,
} from "./handoff-history"

function countTokens(text: string): number {
  return text.split(/\s+/).filter((part) => part.length > 0).length
}

describe("buildHandoffHistoryContext", () => {
  let dir: string

  beforeEach(() => {
    // given a fresh temp ledger
    dir = mkdtempSync(join(tmpdir(), "hecateq-handoff-context-"))
    _setHandoffHistoryFilePathForTesting(
      join(dir, ".opencode", "state", "hecateq", "handoff-history.jsonl"),
    )
  })

  afterEach(() => {
    _setHandoffHistoryFilePathForTesting(null)
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  test("#given no history #then returns empty string", () => {
    // when
    const context = buildHandoffHistoryContext()
    // then
    expect(context).toBe("")
  })

  test("#given five entries #then renders the last five", () => {
    // given
    for (let i = 1; i <= 5; i += 1) {
      appendHandoffHistoryEntry({
        timestamp: `2026-08-08T14:${String(i).padStart(2, "0")}:00.000Z`,
        session_id: "ses_test",
        from_agent: "hecateq-planner",
        to_agent: "reviewer",
        task_graph_id: "g1",
        task_id: `t${i}`,
        status: "done",
        confidence: 0.9,
      })
    }
    // when
    const context = buildHandoffHistoryContext(5)
    // then
    expect(context).toContain("# Recent Handoff History (last 5)")
    expect(context).toContain("hecateq-planner → reviewer")
    expect(context).toContain("task_graph_id=g1 task_id=t1")
    expect(context).toContain("status=done conf=0.90")
    expect(context).toContain("task_id=t5")
  })

  test("#given five entries #then stays under ~300 tokens", () => {
    // given
    for (let i = 1; i <= 5; i += 1) {
      appendHandoffHistoryEntry({
        timestamp: "2026-08-08T14:30:00.000Z",
        session_id: "ses_test",
        from_agent: "hecateq-planner",
        to_agent: "reviewer",
        task_graph_id: "g1",
        task_id: `t${i}`,
        status: "done",
        confidence: 0.92,
      })
    }
    // when
    const context = buildHandoffHistoryContext(5)
    // then
    expect(countTokens(context)).toBeLessThan(300)
  })

  test("#given more entries than max #then renders only the last max", () => {
    // given
    for (let i = 1; i <= 8; i += 1) {
      appendHandoffHistoryEntry({
        timestamp: `2026-08-08T14:${String(i).padStart(2, "0")}:00.000Z`,
        session_id: "ses_test",
        from_agent: "hecateq-planner",
        to_agent: "reviewer",
        status: "done",
        confidence: 0.5,
      })
    }
    // when
    const context = buildHandoffHistoryContext(3)
    // then
    expect(context).toContain("(last 3)")
    expect(context).toContain("14:06")
    expect(context).not.toContain("14:01")
  })
})
