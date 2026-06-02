import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { join } from "node:path"
import {
  checkSubagentMemoryWrite,
  detectSubagentMemoryWrite,
} from "./memory-subagent-guard"
import { subagentSessions, syncSubagentSessions } from "../features/claude-code-session-state/state"
import { PROJECT_MEMORY_DIR } from "./memory-bootstrap"

describe("memory-subagent-guard", () => {
  describe("#checkSubagentMemoryWrite", () => {
    beforeEach(() => {
      subagentSessions.clear()
      syncSubagentSessions.clear()
    })

    afterEach(() => {
      subagentSessions.clear()
      syncSubagentSessions.clear()
    })

    it("blocks subagent write to .opencode/state/memory/ path", () => {
      subagentSessions.add("ses_sub_1")

      const result = checkSubagentMemoryWrite(
        join("/project", PROJECT_MEMORY_DIR, "decisions.jsonl"),
        "ses_sub_1",
      )

      expect(result.blocked).toBe(true)
      expect(result.reason).toContain("MEMORY_UPDATE")
    })

    it("blocks sync subagent write to memory path", () => {
      syncSubagentSessions.add("ses_sync_1")

      const result = checkSubagentMemoryWrite(
        join("/project", PROJECT_MEMORY_DIR, "tasks.jsonl"),
        "ses_sync_1",
      )

      expect(result.blocked).toBe(true)
    })

    it("allows non-subagent sessions", () => {
      const result = checkSubagentMemoryWrite(
        join("/project", PROJECT_MEMORY_DIR, "file.md"),
        "ses_main_1",
      )

      expect(result.blocked).toBe(false)
    })

    it("allows writes to non-memory paths from subagent", () => {
      subagentSessions.add("ses_sub_2")

      const result = checkSubagentMemoryWrite(
        join("/project", "src", "foo.ts"),
        "ses_sub_2",
      )

      expect(result.blocked).toBe(false)
    })

    it("allows writes from undefined session ID", () => {
      const result = checkSubagentMemoryWrite(
        join("/project", PROJECT_MEMORY_DIR, "file.md"),
        undefined,
      )

      expect(result.blocked).toBe(false)
    })

    it("block message includes MEMORY_UPDATE guidance", () => {
      subagentSessions.add("ses_sub_3")

      const result = checkSubagentMemoryWrite(
        join("/project", PROJECT_MEMORY_DIR, "decisions.jsonl"),
        "ses_sub_3",
      )

      expect(result.reason).toContain("MEMORY_UPDATE block instead")
    })

    it("handles Windows-style paths", () => {
      subagentSessions.add("ses_sub_4")

      const result = checkSubagentMemoryWrite(
        `C:\\project\\${PROJECT_MEMORY_DIR}\\file.md`,
        "ses_sub_4",
      )

      expect(result.blocked).toBe(true)
    })
  })

  describe("#detectSubagentMemoryWrite", () => {
    beforeEach(() => {
      subagentSessions.clear()
      syncSubagentSessions.clear()
    })

    afterEach(() => {
      subagentSessions.clear()
      syncSubagentSessions.clear()
    })

    it("detects when subagent text mentions writing to memory files", () => {
      subagentSessions.add("ses_sub_5")

      const result = detectSubagentMemoryWrite(
        "I will write to .opencode/state/memory/decisions.jsonl to record this decision.",
        "ses_sub_5",
      )

      expect(result.detected).toBe(true)
      expect(result.count).toBeGreaterThan(0)
    })

    it("does not detect for non-subagent sessions", () => {
      const result = detectSubagentMemoryWrite(
        "I will write to .opencode/state/memory/decisions.jsonl",
        "ses_main_2",
      )

      expect(result.detected).toBe(false)
    })

    it("returns zero count for non-subagent text", () => {
      const result = detectSubagentMemoryWrite(
        "Task completed successfully.",
        "ses_sub_6",
      )

      expect(result.detected).toBe(false)
    })
  })
})
