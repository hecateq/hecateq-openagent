import { describe, expect, it } from "bun:test"
import {
  parseMemoryUpdateSignals,
  validateMemoryUpdateSignal,
  VALID_MEMORY_UPDATE_STATUSES,
  MEMORY_UPDATE_CONTRACT,
  type MemoryUpdateSignal,
} from "./memory-update-signal"

describe("memory-update-signal", () => {
  describe("#parseMemoryUpdateSignals", () => {
    describe("#given a valid MEMORY_UPDATE block", () => {
      it("parses a block with entries", () => {
        const text = `<MEMORY_UPDATE>{"entries":[{"target":"decisions","data":{"title":"Use Redis","decision":"Use Redis for caching"}}]}</MEMORY_UPDATE>`

        const result = parseMemoryUpdateSignals(text)

        expect(result.signals).toHaveLength(1)
        expect(result.malformedBlocks).toBe(0)
        expect(result.signals[0].entries).toHaveLength(1)
        expect(result.signals[0].entries[0].target).toBe("decisions")
      })

      it("parses a block with session_id and agent_name", () => {
        const text = `<MEMORY_UPDATE>{"session_id":"ses_abc","agent_name":"hephaestus","status":"completed","entries":[]}</MEMORY_UPDATE>`

        const result = parseMemoryUpdateSignals(text)

        expect(result.signals).toHaveLength(1)
        expect(result.signals[0].sessionId).toBe("ses_abc")
        expect(result.signals[0].agentName).toBe("hephaestus")
        expect(result.signals[0].status).toBe("completed")
      })

      it("parses multiple MEMORY_UPDATE blocks", () => {
        const text = `<MEMORY_UPDATE>{"entries":[{"target":"decisions","data":{}}]}</MEMORY_UPDATE>
<MEMORY_UPDATE>{"entries":[{"target":"changed_files","data":{"files":["src/foo.ts"]}}]}</MEMORY_UPDATE>`

        const result = parseMemoryUpdateSignals(text)

        expect(result.signals).toHaveLength(2)
        expect(result.malformedBlocks).toBe(0)
        expect(result.signals[0].entries[0].target).toBe("decisions")
        expect(result.signals[1].entries[0].target).toBe("changed_files")
      })

      it("parses single-entry shorthand without entries array", () => {
        const text = `<MEMORY_UPDATE>{"target":"quality","data":{"command":"bun test","passed":true}}</MEMORY_UPDATE>`

        const result = parseMemoryUpdateSignals(text)

        expect(result.signals).toHaveLength(1)
        expect(result.signals[0].entries).toHaveLength(1)
        expect(result.signals[0].entries[0].target).toBe("quality")
      })

      it("includes raw JSON in parsed signal", () => {
        const rawJson = '{"entries":[{"target":"decisions","data":{"title":"Test"}}]}'
        const text = `<MEMORY_UPDATE>${rawJson}</MEMORY_UPDATE>`

        const result = parseMemoryUpdateSignals(text)

        expect(result.signals[0].raw).toBe(rawJson)
      })
    })

    describe("#given malformed blocks", () => {
      it("skips blocks with invalid JSON", () => {
        const text = `<MEMORY_UPDATE>{not valid json}</MEMORY_UPDATE>`

        const result = parseMemoryUpdateSignals(text)

        expect(result.signals).toHaveLength(0)
        expect(result.malformedBlocks).toBe(1)
      })

      it("skips empty blocks", () => {
        const text = `<MEMORY_UPDATE></MEMORY_UPDATE>`

        const result = parseMemoryUpdateSignals(text)

        expect(result.signals).toHaveLength(0)
        expect(result.malformedBlocks).toBe(1)
      })

      it("skips blocks where entries is not an array", () => {
        const text = `<MEMORY_UPDATE>{"entries":"not an array"}</MEMORY_UPDATE>`

        const result = parseMemoryUpdateSignals(text)

        expect(result.signals).toHaveLength(0)
        expect(result.malformedBlocks).toBe(1)
      })

      it("skips JSON arrays (top-level)", () => {
        const text = `<MEMORY_UPDATE>[{"target":"decisions"}]</MEMORY_UPDATE>`

        const result = parseMemoryUpdateSignals(text)

        expect(result.signals).toHaveLength(0)
        expect(result.malformedBlocks).toBe(1)
      })

      it("skips JSON primitives", () => {
        const text = `<MEMORY_UPDATE>"just a string"</MEMORY_UPDATE>`

        const result = parseMemoryUpdateSignals(text)

        expect(result.signals).toHaveLength(0)
        expect(result.malformedBlocks).toBe(1)
      })

      it("does not throw on any input", () => {
        expect(() => parseMemoryUpdateSignals("")).not.toThrow()
        expect(() => parseMemoryUpdateSignals("garbage text")).not.toThrow()
        expect(() => parseMemoryUpdateSignals("<MEMORY_UPDATE>broken{")).not.toThrow()
        expect(() => parseMemoryUpdateSignals("<MEMORY_UPDATE>" + "x".repeat(10000))).not.toThrow()
      })
    })

    describe("#given text with no MEMORY_UPDATE blocks", () => {
      it("returns empty signals when text is empty", () => {
        const result = parseMemoryUpdateSignals("")
        expect(result.signals).toHaveLength(0)
        expect(result.malformedBlocks).toBe(0)
      })

      it("returns empty signals for plain text", () => {
        const result = parseMemoryUpdateSignals("Task completed. All tests pass.")
        expect(result.signals).toHaveLength(0)
      })

      it("returns empty signals for HANDOFF blocks only", () => {
        const text = `STATUS: DONE
SIGNALS_EMITTED: []
HANDOFF: return_to_caller`

        const result = parseMemoryUpdateSignals(text)
        expect(result.signals).toHaveLength(0)
      })
    })

    describe("#given unknown fields", () => {
      it("ignores unknown top-level fields", () => {
        const text = `<MEMORY_UPDATE>{"unknown_field":123,"entries":[{"target":"decisions"}]}</MEMORY_UPDATE>`

        const result = parseMemoryUpdateSignals(text)

        expect(result.signals).toHaveLength(1)
        expect(result.signals[0].entries[0].target).toBe("decisions")
      })

      it("ignores unknown entry-level fields", () => {
        const text = `<MEMORY_UPDATE>{"entries":[{"target":"decisions","extra_field":"ignored","data":{}}]}</MEMORY_UPDATE>`

        const result = parseMemoryUpdateSignals(text)

        expect(result.signals[0].entries[0].target).toBe("decisions")
      })
    })
  })

  describe("#validateMemoryUpdateSignal", () => {
    describe("#given valid status values", () => {
      for (const status of VALID_MEMORY_UPDATE_STATUSES) {
        it(`accepts status "${status}"`, () => {
          const signal: MemoryUpdateSignal = {
            status,
            entries: [],
            raw: "{}",
            validationIssues: [],
          }

          const result = validateMemoryUpdateSignal(signal)
          expect(result.valid).toBe(true)
        })
      }
    })

    describe("#given invalid status values", () => {
      it("rejects unknown status", () => {
        const signal: MemoryUpdateSignal = {
          status: "not_a_status" as any,
          entries: [],
          raw: "{}",
          validationIssues: [],
        }

        const result = validateMemoryUpdateSignal(signal)
        expect(result.valid).toBe(false)
        expect(result.issues.some((i) => i.includes("Invalid status"))).toBe(true)
      })
    })

    describe("#given entry validation", () => {
      it("flags entries without target", () => {
        const signal: MemoryUpdateSignal = {
          entries: [{ target: "", data: {} }],
          raw: "{}",
          validationIssues: [],
        }

        const result = validateMemoryUpdateSignal(signal)
        const hasTargetIssue = result.issues.some((i) =>
          i.includes('missing required field "target"'),
        )
        expect(hasTargetIssue).toBe(true)
      })

      it("notes unknown target but does not fail validation", () => {
        const signal: MemoryUpdateSignal = {
          entries: [{ target: "unknown_target", data: {} }],
          raw: "{}",
          validationIssues: [],
        }

        const result = validateMemoryUpdateSignal(signal)
        const hasUnknownIssue = result.issues.some((i) =>
          i.includes("unknown target"),
        )
        expect(hasUnknownIssue).toBe(true)
        // Unknown target is a note, not a validation failure
        expect(result.valid).toBe(false)
      })

      it("flags non-object data field", () => {
        const signal: MemoryUpdateSignal = {
          entries: [{ target: "decisions", data: "not an object" as any }],
          raw: "{}",
          validationIssues: [],
        }

        const result = validateMemoryUpdateSignal(signal)
        expect(result.issues.some((i) => i.includes('"data" must be an object'))).toBe(true)
      })

      it("flags non-string action field", () => {
        const signal: MemoryUpdateSignal = {
          entries: [{ target: "decisions", action: 42 as any }],
          raw: "{}",
          validationIssues: [],
        }

        const result = validateMemoryUpdateSignal(signal)
        expect(result.issues.some((i) => i.includes('"action" must be a string'))).toBe(true)
      })
    })

    describe("#path filtering in data.files", () => {
      it("removes generated paths from data.files", () => {
        const signal: MemoryUpdateSignal = {
          entries: [
            {
              target: "changed_files",
              data: { files: ["dist/bundle.js", "src/foo.ts"] },
            },
          ],
          raw: "{}",
          validationIssues: [],
        }

        const result = validateMemoryUpdateSignal(signal)
        expect(result.issues.some((i) => i.includes("removed"))).toBe(true)

        const files = signal.entries[0].data?.files as string[]
        expect(files).toContain("src/foo.ts")
        expect(files).not.toContain("dist/bundle.js")
      })

      it("removes absolute paths from data.files", () => {
        const signal: MemoryUpdateSignal = {
          entries: [
            {
              target: "changed_files",
              data: { files: ["/home/user/src/foo.ts", "src/bar.ts"] },
            },
          ],
          raw: "{}",
          validationIssues: [],
        }

        validateMemoryUpdateSignal(signal)

        const files = signal.entries[0].data?.files as string[]
        expect(files).toContain("src/bar.ts")
        expect(files).not.toContain("/home/user/src/foo.ts")
      })

      it("removes generated path from data.path field", () => {
        const signal: MemoryUpdateSignal = {
          entries: [
            {
              target: "changed_files",
              data: { path: "node_modules/some-pkg/index.js" },
            },
          ],
          raw: "{}",
          validationIssues: [],
        }

        const result = validateMemoryUpdateSignal(signal)
        expect(result.issues.some((i) => i.includes("removed generated/absolute"))).toBe(true)
        expect(signal.entries[0].data?.path).toBeUndefined()
      })
    })

    describe("#valid entries pass validation", () => {
      it("returns valid for a well-formed decision entry", () => {
        const signal: MemoryUpdateSignal = {
          entries: [
            {
              target: "decisions",
              action: "record",
              data: {
                title: "Use TypeScript strict mode",
                decision: "Use TypeScript strict mode for all project files",
                rationale: "Better type safety",
                impact_area: "convention",
              },
              description: "Decision about TypeScript config",
            },
          ],
          raw: "{}",
          validationIssues: [],
        }

        const result = validateMemoryUpdateSignal(signal)
        expect(result.valid).toBe(true)
      })

      it("returns valid for a well-formed quality entry", () => {
        const signal: MemoryUpdateSignal = {
          entries: [
            {
              target: "quality",
              data: {
                command: "bun test",
                passed: true,
                summary: "All 42 tests passed",
              },
            },
          ],
          raw: "{}",
          validationIssues: [],
        }

        const result = validateMemoryUpdateSignal(signal)
        expect(result.valid).toBe(true)
      })
    })
  })

  describe("#HANDOFF blocks are unchanged", () => {
    it("does not parse HANDOFF text as MEMORY_UPDATE", () => {
      const text = `STATUS: DONE
SIGNALS_EMITTED: [{"signal":"backend_ready","payload":{}}]
HANDOFF: return_to_caller

<MEMORY_UPDATE>{"entries":[{"target":"decisions","data":{"title":"Test"}}]}</MEMORY_UPDATE>`

      const result = parseMemoryUpdateSignals(text)

      expect(result.signals).toHaveLength(1)
      expect(result.signals[0].entries[0].target).toBe("decisions")
    })
  })
})

// Phase 3B.2a — MEMORY_UPDATE Prompt Contract tests
describe("MEMORY_UPDATE_CONTRACT", () => {
  describe("#contract structure", () => {
    it("includes the MEMORY_UPDATE header", () => {
      expect(MEMORY_UPDATE_CONTRACT).toContain("MEMORY UPDATE COMPLETION CONTRACT")
    })

    it("forbids direct editing of .opencode/state/memory/", () => {
      expect(MEMORY_UPDATE_CONTRACT).toContain("Do NOT directly edit files under .opencode/state/memory/")
    })

    it("uses <MEMORY_UPDATE> and </MEMORY_UPDATE> delimiters", () => {
      expect(MEMORY_UPDATE_CONTRACT).toContain("<MEMORY_UPDATE>")
      expect(MEMORY_UPDATE_CONTRACT).toContain("</MEMORY_UPDATE>")
    })

    it("requires JSON only inside the block", () => {
      expect(MEMORY_UPDATE_CONTRACT).toContain("JSON ONLY inside the block")
    })

    it("forbids generated paths", () => {
      expect(MEMORY_UPDATE_CONTRACT).toContain("Do NOT include generated/build paths")
      expect(MEMORY_UPDATE_CONTRACT).toContain(".next/")
      expect(MEMORY_UPDATE_CONTRACT).toContain("node_modules/")
      expect(MEMORY_UPDATE_CONTRACT).toContain("dist/")
    })

    it("forbids invented decisions", () => {
      expect(MEMORY_UPDATE_CONTRACT).toContain("Do NOT invent tests, files, risks, decisions")
    })

    it("requires explicit durable decision for decisions entries", () => {
      expect(MEMORY_UPDATE_CONTRACT).toContain("ONLY when an explicit durable")
    })

    it("forbids fabricating quality results", () => {
      expect(MEMORY_UPDATE_CONTRACT).toContain("Never fabricate quality results")
    })

    it("requires relative source paths", () => {
      expect(MEMORY_UPDATE_CONTRACT).toContain("Use RELATIVE source paths only")
    })

    it("instructs to omit empty fields and empty block", () => {
      expect(MEMORY_UPDATE_CONTRACT).toContain("Omit empty fields")
      expect(MEMORY_UPDATE_CONTRACT).toContain("Omit the entire block when no useful update exists")
    })

    it("forbids direct decisions.md/tasks.md writes", () => {
      expect(MEMORY_UPDATE_CONTRACT).toContain("Do NOT write decisions.md or tasks.md directly")
    })

    it("does not mention category fallback as an allowed routing path", () => {
      expect(MEMORY_UPDATE_CONTRACT).not.toContain("category fallback")
      expect(MEMORY_UPDATE_CONTRACT).not.toContain("category routing")
    })
  })
})
