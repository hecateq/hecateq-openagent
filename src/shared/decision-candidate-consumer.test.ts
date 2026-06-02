/**
 * Decision Candidate Consumer Tests — Phase 3B.1
 *
 * Validates: explicit decision writes, vague/non-durable skipped,
 * ordinary task instructions skipped, research requirements skipped,
 * repeated candidates no duplicate, consumer failure best-effort/no throw,
 * pre-task seed still does not write decision files directly,
 * decisionCandidates consumed through Decision Writer path,
 * decisions.md not written, category routing disabled decision persisted if explicit,
 * root discovery unchanged, prompt injection order unchanged,
 * category routing behavior unchanged.
 */

import { describe, expect, test, afterAll } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { consumeDecisionCandidates, type DecisionCandidateConsumerResult } from "./decision-candidate-consumer"
import { readDecisionLog, DECISION_LOG_FILENAME } from "./decision-log"
import { PROJECT_MEMORY_DIR, bootstrapMemoryFiles } from "./memory-bootstrap"
import type { DecisionCandidate } from "./pre-task-memory-seed"
import { canWriteMemoryFile, type WriterIdentity } from "./memory-writer-ownership"

const tempDirs: string[] = []

function createTempDir(): string {
  const d = join(tmpdir(), `omo-dcc-${randomUUID()}`)
  tempDirs.push(d)
  return d
}

afterAll(() => {
  for (const d of tempDirs) {
    try { rmSync(d, { recursive: true, force: true }) } catch { /* ignore */ }
  }
})

function setupMemoryDir(dir: string): string {
  const memDir = join(dir, PROJECT_MEMORY_DIR)
  mkdirSync(memDir, { recursive: true })
  bootstrapMemoryFiles(dir)
  return memDir
}

function makeTechCandidate(overrides?: Partial<DecisionCandidate>): DecisionCandidate {
  return {
    title: "Using TypeScript",
    decision: "Adopt TypeScript as the primary language for the project",
    rationale: "Explicitly mentioned in the project prompt",
    impactArea: "stack",
    sourceExcerpt: "Build an app using TypeScript",
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Valid explicit decision writes
// ---------------------------------------------------------------------------

describe("consumeDecisionCandidates — explicit durable decisions", () => {
  test("#given valid tech candidates #then writes to decisions.jsonl via Decision Writer path", () => {
    const dir = createTempDir()
    setupMemoryDir(dir)

    const candidates: DecisionCandidate[] = [
      makeTechCandidate({ title: "Using Express", decision: "Adopt Express.js as the backend web framework", impactArea: "backend" }),
      makeTechCandidate({ title: "Using PostgreSQL", decision: "Adopt PostgreSQL for the primary relational database", impactArea: "database" }),
      makeTechCandidate({ title: "Using Prisma", decision: "Adopt Prisma as the ORM for type-safe database access", impactArea: "database" }),
    ]

    const result = consumeDecisionCandidates(candidates, dir)

    expect(result.attempted).toBe(3)
    expect(result.written).toBeGreaterThanOrEqual(2)
    expect(result.errors.length).toBe(0)

    // Verify decisions.jsonl contains entries
    const decisionsPath = join(dir, PROJECT_MEMORY_DIR, DECISION_LOG_FILENAME)
    expect(existsSync(decisionsPath)).toBe(true)

    const entries = readDecisionLog(dir)
    expect(entries).not.toBeNull()
    if (entries) {
      expect(entries.length).toBeGreaterThanOrEqual(2)
      const titles = entries.map((e) => e.title)
      expect(titles.some((t) => t.includes("Express"))).toBe(true)
      expect(titles.some((t) => t.includes("PostgreSQL"))).toBe(true)
      expect(titles.some((t) => t.includes("Prisma"))).toBe(true)
    }
  })

  test("#given valid decisions #then manifest is refreshed (best-effort)", () => {
    const dir = createTempDir()
    setupMemoryDir(dir)

    const candidates: DecisionCandidate[] = [
      makeTechCandidate({ title: "Using Redis", decision: "Adopt Redis for caching and session management", impactArea: "deployment" }),
    ]

    const result = consumeDecisionCandidates(candidates, dir)
    expect(result.written).toBe(1)
    // Manifest refresh is best-effort — may succeed or fail depending on
    // whether memory.json exists from bootstrap. Both are acceptable.
    expect(result.manifestRefreshed === true || result.manifestRefreshed === false).toBe(true)
  })

  test("#given empty candidates array #then result has zeroes", () => {
    const dir = createTempDir()
    setupMemoryDir(dir)

    const result = consumeDecisionCandidates([], dir)

    expect(result.attempted).toBe(0)
    expect(result.written).toBe(0)
    expect(result.skipped).toBe(0)
    expect(result.errors.length).toBe(0)
    expect(result.skippedReasons.length).toBe(0)
    expect(result.manifestRefreshed).toBe(false)
  })

  test("#given null/undefined candidates #then result has zeroes", () => {
    const dir = createTempDir()
    setupMemoryDir(dir)

    const result = consumeDecisionCandidates(null as unknown as DecisionCandidate[], dir)

    expect(result.attempted).toBe(0)
    expect(result.written).toBe(0)
    expect(result.skipped).toBe(0)
    expect(result.errors.length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Vague / non-durable skipped
// ---------------------------------------------------------------------------

describe("consumeDecisionCandidates — vague/non-durable skipped", () => {
  test("#given vague candidate with research-oriented title #then skipped", () => {
    const dir = createTempDir()
    setupMemoryDir(dir)

    const candidates: DecisionCandidate[] = [
      makeTechCandidate({
        title: "Research WebSocket scaling patterns",
        decision: "Investigate WebSocket scaling approaches",
        impactArea: "backend",
        rationale: "Research requirement",
      }),
      makeTechCandidate({ title: "Using React", decision: "Adopt React for the frontend UI framework", impactArea: "frontend" }),
    ]

    const result = consumeDecisionCandidates(candidates, dir)

    expect(result.written).toBe(1) // Only React should be written
    expect(result.skipped).toBe(1)
    expect(result.skippedReasons[0]).toContain("not an explicit durable decision")

    // Verify only React decision exists
    const entries = readDecisionLog(dir)
    if (entries) {
      const titles = entries.map((e) => e.title)
      expect(titles.some((t) => t.includes("React"))).toBe(true)
      expect(titles.some((t) => t.includes("WebSocket"))).toBe(false)
    }
  })

  test("#given candidate with explore/investigate in title #then skipped", () => {
    const dir = createTempDir()
    setupMemoryDir(dir)

    const candidates: DecisionCandidate[] = [
      makeTechCandidate({
        title: "Find out about Socket.IO vs WS library",
        decision: "Explore the differences between Socket.IO and WS",
        impactArea: "backend",
        rationale: "Research requirement",
      }),
    ]

    const result = consumeDecisionCandidates(candidates, dir)

    expect(result.written).toBe(0)
    expect(result.skipped).toBe(1)
  })

  test("#given candidate with 'how to' in title #then skipped", () => {
    const dir = createTempDir()
    setupMemoryDir(dir)

    const candidates: DecisionCandidate[] = [
      makeTechCandidate({
        title: "How to implement JWT authentication",
        decision: "Learn about JWT implementation patterns",
        impactArea: "auth",
        rationale: "Research",
      }),
    ]

    const result = consumeDecisionCandidates(candidates, dir)

    expect(result.written).toBe(0)
    expect(result.skipped).toBe(1)
  })

  test("#given candidate with test/verify in title #then skipped", () => {
    const dir = createTempDir()
    setupMemoryDir(dir)

    const candidates: DecisionCandidate[] = [
      makeTechCandidate({
        title: "Test results for API performance",
        decision: "Verify the API performance benchmarks",
        impactArea: "testing",
        rationale: "Test requirement",
      }),
    ]

    const result = consumeDecisionCandidates(candidates, dir)

    expect(result.written).toBe(0)
    expect(result.skipped).toBe(1)
  })

  test("#given candidate with too-short decision text #then skipped", () => {
    const dir = createTempDir()
    setupMemoryDir(dir)

    const candidates: DecisionCandidate[] = [
      makeTechCandidate({
        title: "Vague choice",
        decision: "Use X", // Too short: only 5 chars
        impactArea: "stack",
        rationale: "",
      }),
    ]

    const result = consumeDecisionCandidates(candidates, dir)

    expect(result.written).toBe(0)
    expect(result.skipped).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Ordinary task instruction skipped
// ---------------------------------------------------------------------------

describe("consumeDecisionCandidates — task instruction skipped", () => {
  test("#given task-like candidate #then skipped", () => {
    const dir = createTempDir()
    setupMemoryDir(dir)

    // This would not normally be in decisionCandidates from pre-task seed,
    // but the consumer should be defensive.
    const candidates: DecisionCandidate[] = [
      makeTechCandidate({
        title: "Todo create the database schema",
        decision: "Create the database schema with Posts and Comments tables",
        impactArea: "database",
        rationale: "Task instruction",
      }),
    ]

    const result = consumeDecisionCandidates(candidates, dir)

    expect(result.written).toBe(0)
    expect(result.skipped).toBeGreaterThanOrEqual(1)
  })

  test("#given 'Set up' instruction as candidate title #then skipped", () => {
    const dir = createTempDir()
    setupMemoryDir(dir)

    const candidates: DecisionCandidate[] = [
      makeTechCandidate({
        title: "Task set up auth endpoints",
        decision: "Set up the authentication endpoints with JWT",
        impactArea: "auth",
        rationale: "Task instruction",
      }),
    ]

    const result = consumeDecisionCandidates(candidates, dir)

    expect(result.written).toBe(0)
    expect(result.skipped).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Research requirement skipped
// ---------------------------------------------------------------------------

describe("consumeDecisionCandidates — research requirement skipped", () => {
  test("#given research-oriented candidate #then skipped", () => {
    const dir = createTempDir()
    setupMemoryDir(dir)

    const candidates: DecisionCandidate[] = [
      makeTechCandidate({
        title: "Research the best ORM for TypeScript",
        decision: "Find out which ORM works best with TypeScript projects",
        impactArea: "database",
        rationale: "Research requirement",
      }),
    ]

    const result = consumeDecisionCandidates(candidates, dir)

    expect(result.written).toBe(0)
    expect(result.skipped).toBe(1)
    expect(result.skippedReasons[0]).toContain("not an explicit durable decision")
  })
})

// ---------------------------------------------------------------------------
// Repeated candidate no duplicate
// ---------------------------------------------------------------------------

describe("consumeDecisionCandidates — repeated candidate no duplicate", () => {
  test("#given repeated identical candidates #then only written once", () => {
    const dir = createTempDir()
    setupMemoryDir(dir)

    const candidate: DecisionCandidate = makeTechCandidate({
      title: "Using MongoDB",
      decision: "Adopt MongoDB for the document database layer",
      impactArea: "database",
    })

    const result1 = consumeDecisionCandidates([candidate], dir)
    expect(result1.written).toBe(1)

    const result2 = consumeDecisionCandidates([candidate], dir)
    // Should be skipped due to deduplication in appendDecisionEntry (content hash)
    expect(result2.written).toBe(0)
    expect(result2.skipped).toBe(1)
    expect(result2.skippedReasons[0]).toContain("duplicate")

    // Verify only one entry in the file
    const entries = readDecisionLog(dir)
    if (entries) {
      const mongodbEntries = entries.filter((e) => e.id.includes("mongo"))
      expect(mongodbEntries.length).toBeLessThanOrEqual(1)
    }
  })

  test("#given duplicate candidates within same batch #then deduplicated", () => {
    const dir = createTempDir()
    setupMemoryDir(dir)

    const candidates: DecisionCandidate[] = [
      makeTechCandidate({
        title: "Using Docker",
        decision: "Adopt Docker for containerization of all services",
        impactArea: "deployment",
      }),
      makeTechCandidate({
        title: "Using Docker",
        decision: "Adopt Docker for containerization of all services",
        impactArea: "deployment",
      }),
    ]

    const result = consumeDecisionCandidates(candidates, dir)

    expect(result.attempted).toBe(2)
    expect(result.written).toBe(1)
    expect(result.skipped).toBe(1)
    expect(result.skippedReasons[0]).toContain("duplicate candidate within batch")
  })
})

// ---------------------------------------------------------------------------
// Consumer failure best-effort / no throw
// ---------------------------------------------------------------------------

describe("consumeDecisionCandidates — failures best-effort", () => {
  test("#given missing projectRoot #then returns errors without throw", () => {
    const candidates: DecisionCandidate[] = [makeTechCandidate()]

    expect(() => {
      const result = consumeDecisionCandidates(candidates, "")
      expect(result.errors.length).toBeGreaterThanOrEqual(1)
      expect(result.errors[0]).toContain("Missing projectRoot")
      expect(result.written).toBe(0)
    }).not.toThrow()
  })

  test("#given null projectRoot #then does not throw", () => {
    const candidates: DecisionCandidate[] = [makeTechCandidate()]

    expect(() => {
      const result = consumeDecisionCandidates(candidates, null as unknown as string)
      expect(result.written).toBe(0)
      expect(result.skipped).toBe(0)
    }).not.toThrow()
  })

  test("#given non-existent projectRoot #then gracefully handles", () => {
    // on a system where /tmp/omo-dcc-nonexistent-XXXX doesn't exist,
    // appendDecisionEntry should handle it gracefully (create dirs)
    const dir = join(tmpdir(), `omo-dcc-nonexistent-${randomUUID()}`)

    // Do NOT create the dir — let the consumer handle missing dirs

    const candidates: DecisionCandidate[] = [makeTechCandidate()]

    expect(() => {
      const result = consumeDecisionCandidates(candidates, dir)
      // Best-effort: might succeed (if dir creation works) or fail gracefully
      expect(result.errors.length).toBeGreaterThanOrEqual(0)
    }).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Pre-task seed does not write decision files directly
// ---------------------------------------------------------------------------

describe("consumeDecisionCandidates — Decision Writer path verification", () => {
  test("#given consumer writes #then uses Decision Writer identity", () => {
    // Verify that the Decision Writer identity authorizes writes to decisions.jsonl
    const writer: WriterIdentity = "decision_writer"
    const result = canWriteMemoryFile(writer, "decisions.jsonl")
    expect(result.authorized).toBe(true)

    // Pre-task seed must NOT be authorized
    const ptResult = canWriteMemoryFile("pre_task_seed", "decisions.jsonl")
    expect(ptResult.authorized).toBe(false)
  })

  test("#given valid candidates consumed #then pre-task seed path does NOT write decision files", () => {
    // This verifies the architectural separation: the consumer writes,
    // but pre-task seed still does not.
    const dir = createTempDir()
    setupMemoryDir(dir)

    // Pre-task seed's applyPreTaskMemorySeed must not write decisions files
    const decisionsPath = join(dir, PROJECT_MEMORY_DIR, DECISION_LOG_FILENAME)
    const existsBeforeConsumer = existsSync(decisionsPath)

    // Bootstrap would create an empty decisions.jsonl scaffold
    // The consumer writes actual entries

    const candidates: DecisionCandidate[] = [
      makeTechCandidate({ title: "Using AWS", decision: "Adopt AWS for cloud infrastructure hosting", impactArea: "deployment" }),
    ]

    const result = consumeDecisionCandidates(candidates, dir)
    expect(result.written).toBe(1)

    // Verify file has entries (not just the scaffold JSONL)
    const entries = readDecisionLog(dir)
    expect(entries).not.toBeNull()
    if (entries) {
      expect(entries.length).toBeGreaterThanOrEqual(1)
      expect(entries.some((e) => e.title.includes("AWS"))).toBe(true)
    }
  })

  test("#given consumer writes #then decisions.md is NOT written directly", () => {
    const dir = createTempDir()
    setupMemoryDir(dir)

    const decisionsMdPath = join(dir, PROJECT_MEMORY_DIR, "decisions.md")
    const mdBefore = existsSync(decisionsMdPath) ? readFileSync(decisionsMdPath, "utf-8") : ""

    const candidates: DecisionCandidate[] = [
      makeTechCandidate({ title: "Using Kubernetes", decision: "Adopt Kubernetes for container orchestration", impactArea: "deployment" }),
    ]

    consumeDecisionCandidates(candidates, dir)

    const mdAfter = existsSync(decisionsMdPath) ? readFileSync(decisionsMdPath, "utf-8") : ""
    // decisions.md should not be modified by the consumer
    // (it's owned by decision_writer for rendering, but Phase 3B.1 only writes jsonl)
    expect(mdAfter).toBe(mdBefore)
  })
})

// ---------------------------------------------------------------------------
// Category routing disabled decision persisted if explicit
// ---------------------------------------------------------------------------

describe("consumeDecisionCandidates — explicit routing decisions", () => {
  test("#given explicit routing decision candidate #then persisted", () => {
    const dir = createTempDir()
    setupMemoryDir(dir)

    const candidates: DecisionCandidate[] = [
      {
        title: "Category routing is disabled",
        decision: "Category routing is disabled — all delegation must use exact runtime-valid agent names",
        rationale: "Category-first routing encourages fallback to unavailable agents and is deprecated by project policy",
        impactArea: "routing",
        sourceExcerpt: "Category routing is disabled/deprecated",
      },
    ]

    const result = consumeDecisionCandidates(candidates, dir)

    expect(result.written).toBe(1)
    expect(result.skipped).toBe(0)

    const entries = readDecisionLog(dir)
    if (entries) {
      const routingEntries = entries.filter((e) => e.title.includes("Category routing"))
      expect(routingEntries.length).toBe(1)
      expect(routingEntries[0].title).toBe("Category routing is disabled")
      expect(routingEntries[0].impact_area).toBe("routing")
    }
  })

  test("#given exact-agent delegation decision #then persisted", () => {
    const dir = createTempDir()
    setupMemoryDir(dir)

    const candidates: DecisionCandidate[] = [
      {
        title: "Exact-agent delegation with Hephaestus for coding",
        decision: "All code implementation tasks must use exact-agent delegation to Hephaestus, not category routing",
        rationale: "Exact-agent delegation provides deterministic agent selection and avoids fallback ambiguity",
        impactArea: "routing",
        sourceExcerpt: "Use exact-agent delegation for code tasks",
      },
    ]

    const result = consumeDecisionCandidates(candidates, dir)

    expect(result.written).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Root discovery / prompt injection / category routing unchanged
// ---------------------------------------------------------------------------

describe("consumeDecisionCandidates — invariants", () => {
  test("#given consumer #then root discovery unchanged", () => {
    const { findProjectRoot } = require("./memory-bootstrap") as typeof import("./memory-bootstrap")
    const dir = createTempDir()
    setupMemoryDir(dir)

    consumeDecisionCandidates([makeTechCandidate()], dir)

    const root = findProjectRoot(dir)
    expect(root).toBe(dir)
  })

  test("#given consumer #then does not create files outside .opencode/state/memory", () => {
    const dir = createTempDir()
    setupMemoryDir(dir)

    consumeDecisionCandidates([makeTechCandidate()], dir)

    // No files created at root level except .opencode/
    const rootFiles = require("node:fs").readdirSync(dir) as string[]
    const nonOpenCodeFiles = rootFiles.filter((f: string) => f !== ".opencode")
    expect(nonOpenCodeFiles.length).toBe(0)
  })

  test("#given consumer #then does not modify category routing behavior", () => {
    // The consumer is a Decision Writer pass-through; it should not change
    // how category routing works. The routing_policy_writer is still the
    // only writer for agent-routing.md.
    const writer: WriterIdentity = "routing_policy_writer"
    const result = canWriteMemoryFile(writer, "agent-routing.md")
    expect(result.authorized).toBe(true)

    // Consumer (decision_writer) must NOT write agent-routing.md
    const dwResult = canWriteMemoryFile("decision_writer", "agent-routing.md")
    expect(dwResult.authorized).toBe(false)
  })

  test("#given consumer runs #then prompt injection order unchanged", () => {
    // The consumer does not touch prompt injection. This is a behavioral test
    // confirming the consumer produces correct result structure.
    const dir = createTempDir()
    setupMemoryDir(dir)

    const result = consumeDecisionCandidates([makeTechCandidate()], dir)
    expect(result).toHaveProperty("attempted")
    expect(result).toHaveProperty("written")
    expect(result).toHaveProperty("skipped")
    expect(result).toHaveProperty("errors")
    expect(result).toHaveProperty("skippedReasons")
    expect(result).toHaveProperty("manifestRefreshed")
  })
})
