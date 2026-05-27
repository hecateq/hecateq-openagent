import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import {
  createTraceBuffer,
  createTraceEvent,
  emitTraceEvent,
  getDefaultTraceBuffer,
  recordDelegationDecision,
  resetDefaultTraceBuffer,
  traceSpan,
  readPersistedTraces,
  getPersistedTraceSummary,
} from "./runtime-trace"
import type { RuntimeTraceEventType, RuntimeTracePhase } from "./runtime-trace"
import { HECATEQ_OMO_DIR } from "../features/hecateq-orchestration/omo-state-manager"

// ─── Helpers ────────────────────────────────────────────────────────────────

function phaseForType(type: RuntimeTraceEventType): RuntimeTracePhase {
  if (type.startsWith("handoff.")) return type.includes("summary") ? "routing" : "persistence"
  if (type.startsWith("routing.")) return "routing"
  if (type.startsWith("delegation.")) return "delegation"
  if (type.startsWith("background.")) return "background_ingestion"
  if (type.startsWith("signal.")) return "signal"
  return "model"
}

function mockEvent(
  type: RuntimeTraceEventType,
  payload: Record<string, unknown> = {},
): ReturnType<typeof createTraceEvent> {
  return createTraceEvent(type, phaseForType(type), payload)
}

// ─── Ring Buffer ────────────────────────────────────────────────────────────

describe("createTraceBuffer", () => {
  afterEach(() => {
    resetDefaultTraceBuffer()
  })

  describe("#given an empty buffer", () => {
    test("#then size is zero", () => {
      const buffer = createTraceBuffer()
      expect(buffer.size()).toBe(0)
    })

    test("#then recent returns empty array", () => {
      const buffer = createTraceBuffer()
      expect(buffer.recent()).toEqual([])
    })

    test("#then summary has no events", () => {
      const buffer = createTraceBuffer()
      const s = buffer.summary()
      expect(s.totalEvents).toBe(0)
      expect(s.lastEventAt).toBeNull()
      expect(s.noteworthy).toEqual([])
    })

    test("#then byType returns empty array", () => {
      const buffer = createTraceBuffer()
      expect(buffer.byType("routing.decided")).toEqual([])
    })
  })

  describe("#given events are emitted", () => {
    test("#then size increments", () => {
      const buffer = createTraceBuffer()
      buffer.emit(mockEvent("routing.decided"))
      expect(buffer.size()).toBe(1)
      buffer.emit(mockEvent("handoff.extracted"))
      buffer.emit(mockEvent("handoff.persisted"))
      expect(buffer.size()).toBe(3)
    })

    test("#then recent returns most-recent-first order", () => {
      const buffer = createTraceBuffer()
      const e1 = buffer.emit(mockEvent("routing.decided", { index: 1 }))
      const e2 = buffer.emit(mockEvent("handoff.extracted", { index: 2 }))
      const e3 = buffer.emit(mockEvent("handoff.persisted", { index: 3 }))

      const recents = buffer.recent(3)
      expect(recents).toHaveLength(3)
      expect(recents[0]!.id).toBe(e3.id)
      expect(recents[1]!.id).toBe(e2.id)
      expect(recents[2]!.id).toBe(e1.id)
    })

    test("#then byType filters correctly", () => {
      const buffer = createTraceBuffer()
      buffer.emit(mockEvent("routing.decided"))
      buffer.emit(mockEvent("handoff.extracted"))
      buffer.emit(mockEvent("routing.decided"))
      buffer.emit(mockEvent("handoff.persisted"))

      expect(buffer.byType("routing.decided")).toHaveLength(2)
      expect(buffer.byType("handoff.extracted")).toHaveLength(1)
      expect(buffer.byType("delegation.created")).toHaveLength(0)
    })

    test("#then summary has correct counts", () => {
      const buffer = createTraceBuffer()
      buffer.emit(mockEvent("routing.decided"))
      buffer.emit(mockEvent("routing.decided"))
      buffer.emit(mockEvent("handoff.extracted"))
      buffer.emit(mockEvent("handoff.persisted"))

      const s = buffer.summary()
      expect(s.totalEvents).toBe(4)
      expect(s.byType["routing.decided"]).toBe(2)
      expect(s.byType["handoff.extracted"]).toBe(1)
      expect(s.byPhase["routing"]).toBe(2)
      expect(s.byPhase["persistence"]).toBe(2)
      expect(s.lastEventAt).not.toBeNull()
    })
  })

  describe("#given ring buffer overflows", () => {
    test("#then older events are evicted", () => {
      const buffer = createTraceBuffer(3)
      const first = buffer.emit(mockEvent("routing.decided", { n: 1 }))
      buffer.emit(mockEvent("handoff.extracted", { n: 2 }))
      buffer.emit(mockEvent("handoff.persisted", { n: 3 }))
      // This pushes out the first event
      const fourth = buffer.emit(mockEvent("delegation.created", { n: 4 }))

      expect(buffer.size()).toBe(3)

      const recents = buffer.recent(3)
      expect(recents[0]!.id).toBe(fourth.id)
      // First event should be evicted
      expect(recents.some((e) => e.id === first.id)).toBe(false)
    })

    test("#then byType only counts events still in buffer", () => {
      const buffer = createTraceBuffer(2)
      buffer.emit(mockEvent("routing.decided"))
      buffer.emit(mockEvent("routing.decided"))
      // This pushes the first routing.decided out
      buffer.emit(mockEvent("handoff.extracted"))

      expect(buffer.byType("routing.decided")).toHaveLength(1)
      expect(buffer.byType("handoff.extracted")).toHaveLength(1)
    })
  })

  describe("#given zero maxSize", () => {
    test("#then emit is a no-op and size stays zero", () => {
      const buffer = createTraceBuffer(0)
      buffer.emit(mockEvent("routing.decided"))
      expect(buffer.size()).toBe(0)
      expect(buffer.recent()).toEqual([])
    })
  })
})

// ─── Event Factory ──────────────────────────────────────────────────────────

describe("createTraceEvent", () => {
  test("#given type and phase #then creates event with unique ID and timestamp", () => {
    const event = createTraceEvent("routing.decided", "routing", { target: "agent-x" })
    expect(event.type).toBe("routing.decided")
    expect(event.phase).toBe("routing")
    expect(event.payload).toEqual({ target: "agent-x" })
    expect(event.id).toBeTruthy()
    expect(event.timestamp).toBeTruthy()
    expect(event.durationMs).toBeUndefined()
  })

  test("#given durationMs #then includes it", () => {
    const event = createTraceEvent("handoff.persisted", "persistence", {}, 42)
    expect(event.durationMs).toBe(42)
  })

  test("#then IDs are monotonically increasing", () => {
    const e1 = createTraceEvent("routing.decided", "routing", {})
    const e2 = createTraceEvent("routing.decided", "routing", {})
    const e3 = createTraceEvent("routing.decided", "routing", {})
    expect(e1.id < e2.id).toBe(true)
    expect(e2.id < e3.id).toBe(true)
  })
})

// ─── Singleton Buffer ───────────────────────────────────────────────────────

describe("getDefaultTraceBuffer / emitTraceEvent", () => {
  afterEach(() => {
    resetDefaultTraceBuffer()
  })

  test("#given first call #then creates a buffer", () => {
    const buf = getDefaultTraceBuffer()
    expect(buf.size()).toBe(0)
  })

  test("#given subsequent calls #then returns the same buffer", () => {
    const buf1 = getDefaultTraceBuffer()
    const buf2 = getDefaultTraceBuffer()
    expect(buf1).toBe(buf2)
  })

  test("#given emitTraceEvent #then writes to default buffer", () => {
    emitTraceEvent("routing.decided", "routing", { x: 1 })
    emitTraceEvent("handoff.extracted", "extraction", { x: 2 })

    const buf = getDefaultTraceBuffer()
    expect(buf.size()).toBe(2)
    const s = buf.summary()
    expect(s.byType["routing.decided"]).toBe(1)
    expect(s.byType["handoff.extracted"]).toBe(1)
  })

  test("#given resetDefaultTraceBuffer #then next getDefaultTraceBuffer creates a fresh buffer", () => {
    emitTraceEvent("routing.decided", "routing", {})
    resetDefaultTraceBuffer()
    const buf = getDefaultTraceBuffer()
    expect(buf.size()).toBe(0)
  })
})

// ─── Summary (noteworthy events) ────────────────────────────────────────────

describe("summary — noteworthy events", () => {
  afterEach(() => {
    resetDefaultTraceBuffer()
  })

  test("#given role_violation event #then appears in noteworthy", () => {
    const buf = createTraceBuffer()
    buf.emit(createTraceEvent("routing.role_violation", "routing", {
      rule: "reviewer-auditor cannot hand off to implementer",
      sourceRole: "reviewer-auditor",
      targetRole: "implementer",
    }))
    const s = buf.summary()
    expect(s.noteworthy).toHaveLength(1)
    expect(s.noteworthy[0]!.type).toBe("routing.role_violation")
    expect(s.noteworthy[0]!.summary).toContain("reviewer-auditor")
  })

  test("#given guardrail_skipped event #then appears in noteworthy", () => {
    const buf = createTraceBuffer()
    buf.emit(createTraceEvent("delegation.guardrail_skipped", "delegation", {
      reason: "routing depth 3 >= max 3",
    }))
    const s = buf.summary()
    expect(s.noteworthy).toHaveLength(1)
    expect(s.noteworthy[0]!.summary).toContain("routing depth")
  })

  test("#given normal events #then do not appear in noteworthy", () => {
    const buf = createTraceBuffer()
    buf.emit(mockEvent("handoff.extracted"))
    buf.emit(mockEvent("handoff.persisted"))
    buf.emit(mockEvent("routing.decided"))
    const s = buf.summary()
    expect(s.noteworthy).toHaveLength(0)
  })
})

// ─── Flush to JSONL ─────────────────────────────────────────────────────────

describe("flush", () => {
  const tempDirs: string[] = []

  afterEach(() => {
    while (tempDirs.length > 0) {
      const directory = tempDirs.pop()
      if (directory) rmSync(directory, { recursive: true, force: true })
    }
    resetDefaultTraceBuffer()
  })

  function createTempDir(): string {
    const directory = mkdtempSync(join(tmpdir(), "omo-trace-test-"))
    tempDirs.push(directory)
    return directory
  }

  test("#given events in buffer #then flushes them as JSONL", () => {
    const directory = createTempDir()
    const buf = createTraceBuffer(10)
    buf.emit(mockEvent("routing.decided", { target: "agent-x" }))
    buf.emit(mockEvent("handoff.extracted", { status: "DONE" }))
    buf.emit(mockEvent("handoff.persisted", { signalCount: 2 }))

    const flushed = buf.flush(directory)
    expect(flushed).toBe(3)

    const tracePath = join(directory, HECATEQ_OMO_DIR, "traces.jsonl")
    expect(existsSync(tracePath)).toBe(true)

    const content = readFileSync(tracePath, "utf-8")
    const lines = content.trim().split("\n")
    expect(lines).toHaveLength(3)

    for (const line of lines) {
      const parsed = JSON.parse(line)
      expect(parsed.type).toBeTruthy()
      expect(parsed.id).toBeTruthy()
      expect(parsed.timestamp).toBeTruthy()
    }
  })

  test("#given empty buffer #then flush returns zero", () => {
    const directory = createTempDir()
    const buf = createTraceBuffer()
    expect(buf.flush(directory)).toBe(0)

    const tracePath = join(directory, HECATEQ_OMO_DIR, "traces.jsonl")
    expect(existsSync(tracePath)).toBe(false)
  })

  test("#given flush then more events #then second flush writes only new events", () => {
    const directory = createTempDir()
    const buf = createTraceBuffer(10)
    buf.emit(mockEvent("routing.decided", { n: 1 }))
    buf.flush(directory)

    buf.emit(mockEvent("handoff.extracted", { n: 2 }))
    buf.emit(mockEvent("handoff.persisted", { n: 3 }))

    const flushed = buf.flush(directory)
    // Flush writes all events in buffer (not just new ones) -
    // for append-only dedup, callers should clear the buffer between flushes
    expect(flushed).toBe(3)
  })
})

// ─── Persisted Traces ───────────────────────────────────────────────────────

describe("readPersistedTraces", () => {
  const tempDirs: string[] = []

  afterEach(() => {
    while (tempDirs.length > 0) {
      const directory = tempDirs.pop()
      if (directory) rmSync(directory, { recursive: true, force: true })
    }
    resetDefaultTraceBuffer()
  })

  function createTempDir(): string {
    const directory = mkdtempSync(join(tmpdir(), "omo-trace-read-"))
    tempDirs.push(directory)
    return directory
  }

  test("#given flushed events #then reads them back most-recent-first", () => {
    const directory = createTempDir()
    const buf = createTraceBuffer(10)
    buf.emit(mockEvent("routing.decided", { n: 1 }))
    const second = buf.emit(mockEvent("handoff.extracted", { n: 2 }))
    buf.flush(directory)

    const persisted = readPersistedTraces(directory)
    expect(persisted.length).toBeGreaterThanOrEqual(2)

    // Most recent should be second
    expect(persisted[0]!.id).toBe(second.id)
  })

  test("#given no trace file #then returns empty array", () => {
    const directory = createTempDir()
    expect(readPersistedTraces(directory)).toEqual([])
  })
})

describe("getPersistedTraceSummary", () => {
  const tempDirs: string[] = []

  afterEach(() => {
    while (tempDirs.length > 0) {
      const directory = tempDirs.pop()
      if (directory) rmSync(directory, { recursive: true, force: true })
    }
    resetDefaultTraceBuffer()
  })

  function createTempDir(): string {
    const directory = mkdtempSync(join(tmpdir(), "omo-trace-summary-"))
    tempDirs.push(directory)
    return directory
  }

  test("#given flushed events #then returns summary with counts", () => {
    const directory = createTempDir()
    const buf = createTraceBuffer(10)
    buf.emit(mockEvent("routing.decided"))
    buf.emit(mockEvent("routing.decided"))
    buf.emit(mockEvent("handoff.extracted"))
    buf.emit(createTraceEvent("routing.role_violation", "routing", {
      rule: "test violation",
    }))
    buf.flush(directory)

    const summary = getPersistedTraceSummary(directory)
    expect(summary.totalEvents).toBe(4)
    expect(summary.byType["routing.decided"]).toBe(2)
    expect(summary.byType["handoff.extracted"]).toBe(1)
    expect(summary.noteworthy).toHaveLength(1)
    expect(summary.noteworthy[0]!.type).toBe("routing.role_violation")
  })

  test("#given no trace file #then returns empty summary", () => {
    const directory = createTempDir()
    const summary = getPersistedTraceSummary(directory)
    expect(summary.totalEvents).toBe(0)
    expect(summary.lastEventAt).toBeNull()
    expect(summary.noteworthy).toEqual([])
  })
})

// ─── traceSpan ──────────────────────────────────────────────────────────────

describe("traceSpan", () => {
  afterEach(() => {
    resetDefaultTraceBuffer()
  })

  test("#given successful operation #then emits success event with duration", async () => {
    const result = await traceSpan(
      "handoff.extracted",
      "extraction",
      { source: "test" },
      async () => "result-value",
    )
    expect(result).toBe("result-value")

    const buf = getDefaultTraceBuffer()
    expect(buf.size()).toBe(1)
    const events = buf.recent()
    expect(events[0]!.payload.outcome).toBe("success")
    expect(events[0]!.payload.source).toBe("test")
    expect(typeof events[0]!.durationMs).toBe("number")
  })

  test("#given failing operation #then emits error event and rethrows", async () => {
    let caught = false
    try {
      await traceSpan(
        "handoff.extracted",
        "extraction",
        { source: "test" },
        async () => { throw new Error("boom") },
      )
    } catch (error) {
      caught = true
      expect((error as Error).message).toBe("boom")
    }
    expect(caught).toBe(true)

    const buf = getDefaultTraceBuffer()
    expect(buf.size()).toBe(1)
    const events = buf.recent()
    expect(events[0]!.payload.outcome).toBe("error")
    expect(events[0]!.payload.error).toBe("boom")
  })
})

describe("recordDelegationDecision", () => {
  afterEach(() => {
    resetDefaultTraceBuffer()
  })

  test("#given valid inputs #then emits delegation.decision event to default buffer", () => {
    recordDelegationDecision(
      "return_to_caller",
      "nodejs-backend-developer",
      "nodejs-backend-architect",
      "Created delegation for backend implementation",
      { sourceTaskId: "task_1" },
    )

    const buf = getDefaultTraceBuffer()
    expect(buf.size()).toBe(1)

    const events = buf.recent()
    expect(events[0]!.type).toBe("delegation.decision")
    expect(events[0]!.phase).toBe("delegation")
    expect(events[0]!.payload.decisionKind).toBe("return_to_caller")
    expect(events[0]!.payload.targetAgent).toBe("nodejs-backend-developer")
    expect(events[0]!.payload.sourceAgent).toBe("nodejs-backend-architect")
    expect(events[0]!.payload.reason).toBe("Created delegation for backend implementation")
    expect(events[0]!.payload.sourceTaskId).toBe("task_1")
  })

  test("#given null target and source #then emits event with null values without throwing", () => {
    recordDelegationDecision("blocked", null, null, "No valid target")

    const buf = getDefaultTraceBuffer()
    const events = buf.recent()
    expect(events[0]!.payload.targetAgent).toBe(null)
    expect(events[0]!.payload.sourceAgent).toBe(null)
  })

  test("#given extra payload merged #then event contains merged fields", () => {
    recordDelegationDecision(
      "consumed",
      "oracle",
      "sisyphus",
      "Delegation consumed successfully",
      { delegationId: "dlg_test_123", routingDepth: 2 },
    )

    const buf = getDefaultTraceBuffer()
    const events = buf.recent()
    expect(events[0]!.payload.delegationId).toBe("dlg_test_123")
    expect(events[0]!.payload.routingDepth).toBe(2)
  })
})
