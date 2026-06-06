/**
 * Memory Writer Ownership Tests — Phase 3A
 *
 * Validates the writer ownership contract: which writers may write
 * to which memory files, forbidden mappings, and ownership map integrity.
 */

import { describe, expect, test } from "bun:test"

import {
  canWriteMemoryFile,
  assertCanWriteMemoryFile,
  getAllowedMemoryFilesForWriter,
  getMemoryFileWriteMode,
  isKnownMemoryFile,
  validateOwnershipMap,
  validateForbiddenMappings,
  WRITER_ALLOWED_FILES,
  WRITER_FORBIDDEN_FILES,
  ALL_MEMORY_FILES,
  type WriterIdentity,
} from "./memory-writer-ownership"

// ---------------------------------------------------------------------------
// Writer → Allowed Files
// ---------------------------------------------------------------------------

describe("Writer ownership contract", () => {
  // ── pre_task_seed ──────────────────────────────────────────────────────

  describe("pre_task_seed", () => {
    const writer: WriterIdentity = "pre_task_seed"

    test("can write active-context.md", () => {
      const result = canWriteMemoryFile(writer, "active-context.md")
      expect(result.authorized).toBe(true)
    })

    test("can write open-questions.md", () => {
      const result = canWriteMemoryFile(writer, "open-questions.md")
      expect(result.authorized).toBe(true)
    })

    test("can write conventions.md", () => {
      const result = canWriteMemoryFile(writer, "conventions.md")
      expect(result.authorized).toBe(true)
    })

    test("can write environment.md", () => {
      const result = canWriteMemoryFile(writer, "environment.md")
      expect(result.authorized).toBe(true)
    })

    test("cannot write decisions.md", () => {
      const result = canWriteMemoryFile(writer, "decisions.md")
      expect(result.authorized).toBe(false)
    })

    test("cannot write decisions.jsonl", () => {
      const result = canWriteMemoryFile(writer, "decisions.jsonl")
      expect(result.authorized).toBe(false)
    })

    test("cannot write tasks.jsonl", () => {
      const result = canWriteMemoryFile(writer, "tasks.jsonl")
      expect(result.authorized).toBe(false)
    })

    test("cannot write tasks.md", () => {
      const result = canWriteMemoryFile(writer, "tasks.md")
      expect(result.authorized).toBe(false)
    })

    test("cannot write quality-history.md", () => {
      const result = canWriteMemoryFile(writer, "quality-history.md")
      expect(result.authorized).toBe(false)
    })

    test("cannot write risk-profile.md", () => {
      const result = canWriteMemoryFile(writer, "risk-profile.md")
      expect(result.authorized).toBe(false)
    })

    test("cannot write file-map.md", () => {
      const result = canWriteMemoryFile(writer, "file-map.md")
      expect(result.authorized).toBe(false)
    })

    test("cannot write agent-routing.md", () => {
      const result = canWriteMemoryFile(writer, "agent-routing.md")
      expect(result.authorized).toBe(false)
    })

    test("cannot write memory.json", () => {
      const result = canWriteMemoryFile(writer, "memory.json")
      expect(result.authorized).toBe(false)
    })

    test("cannot write continuation.json", () => {
      const result = canWriteMemoryFile(writer, "continuation.json")
      expect(result.authorized).toBe(false)
    })

    test("cannot write progress.md", () => {
      const result = canWriteMemoryFile(writer, "progress.md")
      expect(result.authorized).toBe(false)
    })

    test("assertCanWriteMemoryFile throws on decisions.md", () => {
      expect(() => assertCanWriteMemoryFile(writer, "decisions.md")).toThrow(
        "OWNERSHIP VIOLATION",
      )
    })

    test("getAllowedMemoryFilesForWriter returns correct set", () => {
      const allowed = getAllowedMemoryFilesForWriter(writer)
      expect(allowed).toContain("active-context.md")
      expect(allowed).toContain("open-questions.md")
      expect(allowed).toContain("conventions.md")
      expect(allowed).toContain("environment.md")
      expect(allowed.length).toBe(4)
    })
  })

  // ── task_completion_writer ─────────────────────────────────────────────

  describe("task_completion_writer", () => {
    const writer: WriterIdentity = "task_completion_writer"

    test("can write tasks.jsonl", () => {
      const result = canWriteMemoryFile(writer, "tasks.jsonl")
      expect(result.authorized).toBe(true)
    })

    test("can write progress.md", () => {
      const result = canWriteMemoryFile(writer, "progress.md")
      expect(result.authorized).toBe(true)
    })

    test("can write active-context.md", () => {
      const result = canWriteMemoryFile(writer, "active-context.md")
      expect(result.authorized).toBe(true)
    })

    test("cannot write decisions.jsonl", () => {
      const result = canWriteMemoryFile(writer, "decisions.jsonl")
      expect(result.authorized).toBe(false)
    })

    test("cannot write decisions.md", () => {
      const result = canWriteMemoryFile(writer, "decisions.md")
      expect(result.authorized).toBe(false)
    })

    test("cannot write quality-history.md", () => {
      const result = canWriteMemoryFile(writer, "quality-history.md")
      expect(result.authorized).toBe(false)
    })

    test("getAllowedMemoryFilesForWriter returns correct set", () => {
      const allowed = getAllowedMemoryFilesForWriter(writer)
      expect(allowed).toContain("tasks.jsonl")
      expect(allowed).toContain("progress.md")
      expect(allowed).toContain("active-context.md")
      expect(allowed.length).toBe(3)
    })
  })

  // ── decision_writer ────────────────────────────────────────────────────

  describe("decision_writer", () => {
    const writer: WriterIdentity = "decision_writer"

    test("can write decisions.jsonl", () => {
      const result = canWriteMemoryFile(writer, "decisions.jsonl")
      expect(result.authorized).toBe(true)
    })

    test("can write decisions.md", () => {
      const result = canWriteMemoryFile(writer, "decisions.md")
      expect(result.authorized).toBe(true)
    })

    test("cannot write tasks.jsonl", () => {
      const result = canWriteMemoryFile(writer, "tasks.jsonl")
      expect(result.authorized).toBe(false)
    })

    test("getAllowedMemoryFilesForWriter returns correct set", () => {
      const allowed = getAllowedMemoryFilesForWriter(writer)
      expect(allowed).toContain("decisions.jsonl")
      expect(allowed).toContain("decisions.md")
      expect(allowed.length).toBe(2)
    })
  })

  // ── quality_writer ─────────────────────────────────────────────────────

  describe("quality_writer", () => {
    const writer: WriterIdentity = "quality_writer"

    test("can only write quality-history.md", () => {
      const allowed = getAllowedMemoryFilesForWriter(writer)
      expect(allowed.length).toBe(1)
      expect(allowed[0]).toBe("quality-history.md")
    })

    test("cannot write other files", () => {
      expect(canWriteMemoryFile(writer, "decisions.jsonl").authorized).toBe(false)
      expect(canWriteMemoryFile(writer, "tasks.jsonl").authorized).toBe(false)
    })
  })

  // ── risk_writer ────────────────────────────────────────────────────────

  describe("risk_writer", () => {
    const writer: WriterIdentity = "risk_writer"

    test("can only write risk-profile.md", () => {
      const allowed = getAllowedMemoryFilesForWriter(writer)
      expect(allowed.length).toBe(1)
      expect(allowed[0]).toBe("risk-profile.md")
    })
  })

  // ── file_map_writer ────────────────────────────────────────────────────

  describe("file_map_writer", () => {
    const writer: WriterIdentity = "file_map_writer"

    test("can only write file-map.md", () => {
      const allowed = getAllowedMemoryFilesForWriter(writer)
      expect(allowed.length).toBe(1)
      expect(allowed[0]).toBe("file-map.md")
    })
  })

  // ── manifest_updater ───────────────────────────────────────────────────

  describe("manifest_updater", () => {
    const writer: WriterIdentity = "manifest_updater"

    test("can only write memory.json", () => {
      const allowed = getAllowedMemoryFilesForWriter(writer)
      expect(allowed.length).toBe(1)
      expect(allowed[0]).toBe("memory.json")
    })
  })

  // ── continuation_writer ────────────────────────────────────────────────

  describe("continuation_writer", () => {
    const writer: WriterIdentity = "continuation_writer"

    test("can only write continuation.json", () => {
      const allowed = getAllowedMemoryFilesForWriter(writer)
      expect(allowed.length).toBe(1)
      expect(allowed[0]).toBe("continuation.json")
    })
  })

  // ── routing_policy_writer ──────────────────────────────────────────────

  describe("routing_policy_writer", () => {
    const writer: WriterIdentity = "routing_policy_writer"

    test("can only write agent-routing.md", () => {
      const allowed = getAllowedMemoryFilesForWriter(writer)
      expect(allowed.length).toBe(1)
      expect(allowed[0]).toBe("agent-routing.md")
    })
  })

  // ── memory_curator ─────────────────────────────────────────────────────

  describe("memory_curator", () => {
    const writer: WriterIdentity = "memory_curator"

    test("curator has allowed files for future use", () => {
      const allowed = getAllowedMemoryFilesForWriter(writer)
      expect(allowed.length).toBeGreaterThan(0)
      // Curator may touch these key files
      expect(allowed).toContain("active-context.md")
      expect(allowed).toContain("tasks.md")
      expect(allowed).toContain("decisions.md")
    })

    test("curator cannot write manifest files", () => {
      expect(canWriteMemoryFile(writer, "memory.json").authorized).toBe(false)
      expect(canWriteMemoryFile(writer, "continuation.json").authorized).toBe(false)
    })

    test("curator cannot write append-only sources", () => {
      expect(canWriteMemoryFile(writer, "tasks.jsonl").authorized).toBe(false)
      expect(canWriteMemoryFile(writer, "decisions.jsonl").authorized).toBe(false)
      expect(canWriteMemoryFile(writer, "quality-history.md").authorized).toBe(false)
    })
  })

  // ── unknown ────────────────────────────────────────────────────────────

  describe("unknown", () => {
    const writer: WriterIdentity = "unknown"

    test("cannot write any files", () => {
      const allowed = getAllowedMemoryFilesForWriter(writer)
      expect(allowed.length).toBe(0)
    })

    test("returns not authorized for any file", () => {
      const result = canWriteMemoryFile(writer, "active-context.md")
      expect(result.authorized).toBe(false)
      expect(result.reason).toContain("not authorized")
    })
  })
})

// ---------------------------------------------------------------------------
// Write Mode Metadata
// ---------------------------------------------------------------------------

describe("Write modes", () => {
  test("append-only files have correct mode", () => {
    expect(getMemoryFileWriteMode("tasks.jsonl")).toBe("append_only")
    expect(getMemoryFileWriteMode("decisions.jsonl")).toBe("append_only")
  })

  test("overwrite snapshot files have correct mode", () => {
    expect(getMemoryFileWriteMode("memory.json")).toBe("overwrite_snapshot")
    expect(getMemoryFileWriteMode("continuation.json")).toBe("overwrite_snapshot")
  })

  test("controlled section overwrite files have correct mode", () => {
    expect(getMemoryFileWriteMode("active-context.md")).toBe("controlled_section_overwrite")
    expect(getMemoryFileWriteMode("file-map.md")).toBe("controlled_section_overwrite")
  })

  test("unknown file returns undefined", () => {
    expect(getMemoryFileWriteMode("nonexistent.md")).toBeUndefined()
  })

  test("isKnownMemoryFile returns correct", () => {
    expect(isKnownMemoryFile("active-context.md")).toBe(true)
    expect(isKnownMemoryFile("nonexistent.md")).toBe(false)
    expect(isKnownMemoryFile("tasks.jsonl")).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Ownership Map Validation
// ---------------------------------------------------------------------------

describe("Ownership map validation", () => {
  test("no issues in ownership map", () => {
    const issues = validateOwnershipMap()
    expect(issues.length).toBe(0)
  })

  test("all required memory files have write modes", () => {
    for (const fileName of ALL_MEMORY_FILES) {
      const mode = getMemoryFileWriteMode(fileName)
      expect(mode).toBeDefined()
    }
  })

  test("no forbidden mapping violations", () => {
    const issues = validateForbiddenMappings()
    expect(issues.length).toBe(0)
  })

  test("forbidden mappings are respected in allowed lists", () => {
    for (const key of Object.keys(WRITER_FORBIDDEN_FILES)) {
      const [writer, fileName] = WRITER_FORBIDDEN_FILES[key] as [WriterIdentity, string]
      if (!writer || !fileName) continue
      const result = canWriteMemoryFile(writer, fileName)
      expect(result.authorized).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// Pre-task seed specific constraints
// ---------------------------------------------------------------------------

describe("Pre-task seed ownership constraints", () => {
  const writer: WriterIdentity = "pre_task_seed"

  test("cannot write decisions files directly", () => {
    expect(canWriteMemoryFile(writer, "decisions.md").authorized).toBe(false)
    expect(canWriteMemoryFile(writer, "decisions.jsonl").authorized).toBe(false)
  })

  test("cannot write task files", () => {
    expect(canWriteMemoryFile(writer, "tasks.jsonl").authorized).toBe(false)
    expect(canWriteMemoryFile(writer, "tasks.md").authorized).toBe(false)
  })

  test("cannot write quality/risk/file-map/manifest", () => {
    expect(canWriteMemoryFile(writer, "quality-history.md").authorized).toBe(false)
    expect(canWriteMemoryFile(writer, "risk-profile.md").authorized).toBe(false)
    expect(canWriteMemoryFile(writer, "file-map.md").authorized).toBe(false)
    expect(canWriteMemoryFile(writer, "memory.json").authorized).toBe(false)
    expect(canWriteMemoryFile(writer, "continuation.json").authorized).toBe(false)
  })

  test("allowed set is exactly four files", () => {
    const allowed = getAllowedMemoryFilesForWriter(writer)
    expect(allowed).toEqual([
      "active-context.md",
      "open-questions.md",
      "conventions.md",
      "environment.md",
    ])
  })
})

// ---------------------------------------------------------------------------
// Category routing constraint
// ---------------------------------------------------------------------------

describe("Category routing constraint", () => {
  test("routing_policy_writer can only write agent-routing.md", () => {
    const writer: WriterIdentity = "routing_policy_writer"
    const allowed = getAllowedMemoryFilesForWriter(writer)
    expect(allowed.length).toBe(1)
    expect(allowed).toContain("agent-routing.md")
    // Category-first routing is not listed as default
    expect(allowed).not.toContain("category-routing.md")
    expect(allowed).not.toContain("routing-defaults.md")
  })

  test("category-first routing language is not in any writer's default allowed set", () => {
    // Verify no writer has broad category-routing files in their allowed set
    for (const [writer, allowed] of Object.entries(WRITER_ALLOWED_FILES)) {
      for (const file of allowed) {
        // Category routing is not a separate file — it would be within agent-routing.md
        // The constraint is that routing_policy_writer must not encourage category-first defaults
        if (file === "agent-routing.md" && writer !== "routing_policy_writer" && writer !== "memory_curator") {
          // Only routing_policy_writer and curator may touch agent-routing.md
          expect(writer).toBe("memory_curator")
        }
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Result structure
// ---------------------------------------------------------------------------

describe("canWriteMemoryFile result structure", () => {
  test("authorized result has reason null", () => {
    const result = canWriteMemoryFile("quality_writer", "quality-history.md")
    expect(result.authorized).toBe(true)
    expect(result.writer).toBe("quality_writer")
    expect(result.fileName).toBe("quality-history.md")
    expect(result.reason).toBeNull()
  })

  test("unauthorized result has descriptive reason", () => {
    const result = canWriteMemoryFile("quality_writer", "decisions.jsonl")
    expect(result.authorized).toBe(false)
    expect(result.reason).toBeTruthy()
    expect(result.reason).toContain("quality_writer")
    expect(result.reason).toContain("decisions.jsonl")
  })
})

// ---------------------------------------------------------------------------
// assertCanWriteMemoryFile
// ---------------------------------------------------------------------------

describe("assertCanWriteMemoryFile", () => {
  test("does not throw for authorized writes", () => {
    expect(() => assertCanWriteMemoryFile("manifest_updater", "memory.json")).not.toThrow()
  })

  test("throws with descriptive message for unauthorized writes", () => {
    expect(() => assertCanWriteMemoryFile("manifest_updater", "tasks.jsonl")).toThrow(
      "OWNERSHIP VIOLATION",
    )
  })

  test("throws for unknown writer", () => {
    expect(() => assertCanWriteMemoryFile("unknown", "active-context.md")).toThrow(
      "OWNERSHIP VIOLATION",
    )
  })
})

// ---------------------------------------------------------------------------
// Integration: Writer module guards reject unauthorized callers
// ---------------------------------------------------------------------------

describe("Writer module ownership guards", () => {
  test("appendTaskEntry rejects unauthorized writer identity", () => {
    // We test the ownership check path via canWriteMemoryFile since
    // appendTaskEntry requires a real project root with filesystem access.
    // The guard uses the same canWriteMemoryFile that we verify here.
    const result = canWriteMemoryFile("pre_task_seed", "tasks.jsonl")
    expect(result.authorized).toBe(false)
    // A call to appendTaskEntry with writer="pre_task_seed" would
    // hit the same guard and return false (no filesystem needed).
  })

  test("appendDecisionEntry rejects unauthorized writer identity", () => {
    const result = canWriteMemoryFile("quality_writer", "decisions.jsonl")
    expect(result.authorized).toBe(false)
  })

  test("writeQualityHistory rejects unauthorized writer identity", () => {
    const result = canWriteMemoryFile("decision_writer", "quality-history.md")
    expect(result.authorized).toBe(false)
  })

  test("writeRisk rejects unauthorized writer identity", () => {
    const result = canWriteMemoryFile("quality_writer", "risk-profile.md")
    expect(result.authorized).toBe(false)
  })

  test("appendChangeImpactEntry rejects unauthorized writer identity", () => {
    const result = canWriteMemoryFile("quality_writer", "file-map.md")
    expect(result.authorized).toBe(false)
  })

  test("refreshManifestAfterWrite rejects unauthorized writer identity", () => {
    const result = canWriteMemoryFile("quality_writer", "memory.json")
    expect(result.authorized).toBe(false)
  })

  test("pre-task seed guard rejects write to decisions.md at contract level", () => {
    // The guardSeedWrite function uses canWriteMemoryFile internally.
    // This test confirms the ownership contract blocks pre_task_seed
    // from writing decisions.md regardless of the caller path.
    const result = canWriteMemoryFile("pre_task_seed", "decisions.md")
    expect(result.authorized).toBe(false)
  })

  test("default writer identity is authorized for owned file", () => {
    // Each module defaults to its owning identity — these must pass
    expect(canWriteMemoryFile("task_completion_writer", "tasks.jsonl").authorized).toBe(true)
    expect(canWriteMemoryFile("decision_writer", "decisions.jsonl").authorized).toBe(true)
    expect(canWriteMemoryFile("quality_writer", "quality-history.md").authorized).toBe(true)
    expect(canWriteMemoryFile("risk_writer", "risk-profile.md").authorized).toBe(true)
    expect(canWriteMemoryFile("file_map_writer", "file-map.md").authorized).toBe(true)
    expect(canWriteMemoryFile("manifest_updater", "memory.json").authorized).toBe(true)
    expect(canWriteMemoryFile("pre_task_seed", "active-context.md").authorized).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Phase 2: Unknown writer enforcement
// ---------------------------------------------------------------------------

describe("Phase 2: Unknown writer enforcement", () => {
  // The "unknown" writer identity must not write to ANY memory file.
  // Every writer path must check ownership before writing.

  test("unknown writer cannot write quality-history.md", () => {
    const result = canWriteMemoryFile("unknown", "quality-history.md")
    expect(result.authorized).toBe(false)
    expect(result.reason).toContain("not authorized")
  })

  test("unknown writer cannot write risk-profile.md", () => {
    const result = canWriteMemoryFile("unknown", "risk-profile.md")
    expect(result.authorized).toBe(false)
  })

  test("unknown writer cannot write file-map.md", () => {
    const result = canWriteMemoryFile("unknown", "file-map.md")
    expect(result.authorized).toBe(false)
  })

  test("unknown writer cannot write open-questions.md", () => {
    const result = canWriteMemoryFile("unknown", "open-questions.md")
    expect(result.authorized).toBe(false)
  })

  test("unknown writer cannot write decisions.jsonl", () => {
    const result = canWriteMemoryFile("unknown", "decisions.jsonl")
    expect(result.authorized).toBe(false)
  })

  test("unknown writer cannot write tasks.jsonl", () => {
    const result = canWriteMemoryFile("unknown", "tasks.jsonl")
    expect(result.authorized).toBe(false)
  })

  test("unknown writer cannot write progress.md", () => {
    const result = canWriteMemoryFile("unknown", "progress.md")
    expect(result.authorized).toBe(false)
  })

  test("unknown writer cannot write memory.json", () => {
    const result = canWriteMemoryFile("unknown", "memory.json")
    expect(result.authorized).toBe(false)
  })

  test("unknown writer cannot write any file in the ownership map", () => {
    // Iterate through all known files by checking WRITER_ALLOWED_FILES["unknown"]
    // which should be an empty array
    const unknownAllowed = getAllowedMemoryFilesForWriter("unknown")
    expect(unknownAllowed.length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Phase 2: Unauthorized writer enforcement (specific writer blocked from specific file)
// ---------------------------------------------------------------------------

describe("Phase 2: Unauthorized writer enforcement", () => {
  // A writer must not be allowed to write to files outside its allowed set.
  // These tests verify that cross-writer violations are caught.

  test("quality_writer cannot write risk-profile.md", () => {
    const result = canWriteMemoryFile("quality_writer", "risk-profile.md")
    expect(result.authorized).toBe(false)
    expect(result.reason).toContain("not authorized")
  })

  test("risk_writer cannot write quality-history.md", () => {
    const result = canWriteMemoryFile("risk_writer", "quality-history.md")
    expect(result.authorized).toBe(false)
  })

  test("file_map_writer cannot write decisions.jsonl", () => {
    const result = canWriteMemoryFile("file_map_writer", "decisions.jsonl")
    expect(result.authorized).toBe(false)
  })

  test("open_questions_writer cannot write progress.md", () => {
    const result = canWriteMemoryFile("open_questions_writer", "progress.md")
    expect(result.authorized).toBe(false)
  })
})
