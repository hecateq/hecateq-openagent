import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { readContinuationMarker, setContinuationMarkerSource } from "../run-continuation-state/storage"
import {
  extractHandoffFromAgentResponse,
  buildLiveHandoffContextSummary,
  buildOmoHandoffContextSummary,
  processHandoffInAgentResponse,
  recordHandoffToOmoState,
} from "./runtime-handoff-service"
import { OmoStateManager, HECATEQ_OMO_DIR } from "./omo-state-manager"

const tempDirs: string[] = []

function createTempDir(): string {
  const directory = mkdtempSync(join(tmpdir(), "omo-handoff-runtime-"))
  tempDirs.push(directory)
  return directory
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const directory = tempDirs.pop()
    if (directory) {
      rmSync(directory, { recursive: true, force: true })
    }
  }
})

describe("extractHandoffFromAgentResponse", () => {
  test("#given agent response with handoff block #then extracts handoff metadata", () => {
    const response = [
      "Here is the completed work.",
      "",
      "STATUS: DONE",
      'SIGNALS_EMITTED: [{"signal":"tests_passed","payload":{}}]',
      "HANDOFF: return_to_caller",
      "",
      "Additional notes here.",
    ].join("\n")

    const result = extractHandoffFromAgentResponse(response)

    expect(result).not.toBeNull()
    expect(result!.status).toBe("DONE")
    expect(result!.handoff).toBe("return_to_caller")
    expect(result!.signals).toHaveLength(1)
    expect(result!.signals[0]?.signal).toBe("tests_passed")
  })

  test("#given agent response IN_PROGRESS handoff #then extracts correctly", () => {
    const response = [
      "Working on the backend task.",
      "STATUS: IN_PROGRESS",
      'SIGNALS_EMITTED: [{"signal":"schema_ready","payload":{"version":2}}]',
      "HANDOFF: nodejs-backend-developer",
    ].join("\n")

    const result = extractHandoffFromAgentResponse(response)

    expect(result).not.toBeNull()
    expect(result!.status).toBe("IN_PROGRESS")
    expect(result!.handoff).toBe("nodejs-backend-developer")
    expect(result!.signals).toHaveLength(1)
    expect(result!.signals[0]?.signal).toBe("schema_ready")
  })

  test("#given agent response with no handoff block #then returns null", () => {
    const response = "Task completed successfully with no handoff information."

    const result = extractHandoffFromAgentResponse(response)

    expect(result).toBeNull()
  })

  test("#given empty text #then returns null", () => {
    expect(extractHandoffFromAgentResponse("")).toBeNull()
    expect(extractHandoffFromAgentResponse("  ")).toBeNull()
  })

  test("#given handoff with multi signals #then parses all", () => {
    const response = [
      "Here is my work result.",
      "",
      "STATUS: DONE",
      'SIGNALS_EMITTED: [{"signal":"tests_passed","payload":{}},{"signal":"performance_verified","payload":{"score":0.95}}]',
      "HANDOFF: return_to_parent_for_routing",
    ].join("\n")

    const result = extractHandoffFromAgentResponse(response)

    expect(result).not.toBeNull()
    expect(result!.status).toBe("DONE")
    expect(result!.signals).toHaveLength(2)
    expect(result!.signals[1]?.signal).toBe("performance_verified")
    expect(result!.handoff).toBe("return_to_parent_for_routing")
  })
})

describe("buildLiveHandoffContextSummary", () => {
  test("#given run-continuation marker with handoff reason #then builds summary", () => {
    const directory = createTempDir()
    const sessionId = "ses_handoff_live_1"

    setContinuationMarkerSource(directory, sessionId, "background-task", "active", JSON.stringify({
      status: "DONE",
      handoff: "return_to_caller",
      signalCount: 1,
      signals: [{ signal: "tests_passed", payload: {} }],
    }))

    const summary = buildLiveHandoffContextSummary(directory, sessionId)

    expect(summary.length).toBeGreaterThan(0)
    expect(summary).toMatch(/DONE/)
    expect(summary).toMatch(/return_to_caller/)
  })

  test("#given no handoff state #then returns empty string", () => {
    const directory = createTempDir()
    const sessionId = "ses_no_handoff"

    const summary = buildLiveHandoffContextSummary(directory, sessionId)

    expect(summary).toBe("")
  })

  test("#given marker with corrupted reason #then returns empty", () => {
    const directory = createTempDir()
    const sessionId = "ses_corrupted"

    setContinuationMarkerSource(directory, sessionId, "background-task", "active", "not valid json at all")

    const summary = buildLiveHandoffContextSummary(directory, sessionId)

    // Corrupted data should be silently skipped
    expect(summary).toBe("")
  })

  test("#given IN_PROGRESS handoff in marker #then summary contains target", () => {
    const directory = createTempDir()
    const sessionId = "ses_progress"

    setContinuationMarkerSource(directory, sessionId, "background-task", "active", JSON.stringify({
      status: "IN_PROGRESS",
      handoff: "nodejs-backend-developer",
      signalCount: 1,
      signals: [{ signal: "backend_ready", payload: {} }],
    }))

    const summary = buildLiveHandoffContextSummary(directory, sessionId)

    expect(summary).toMatch(/IN_PROGRESS/)
    expect(summary).toMatch(/nodejs-backend-developer/)
  })
})

describe("processHandoffInAgentResponse", () => {
  test("#given agent text with handoff block #then persists to continuation marker", () => {
    const directory = createTempDir()
    const sessionId = "ses_process_1"

    const response = [
      "Here is the result of the work.",
      "STATUS: DONE",
      'SIGNALS_EMITTED: [{"signal":"tests_passed","payload":{}}]',
      "HANDOFF: return_to_caller",
    ].join("\n")

    const result = processHandoffInAgentResponse(response, directory, sessionId)

    expect(result).not.toBeNull()
    expect(result!.status).toBe("DONE")
    expect(result!.handoff).toBe("return_to_caller")

    const marker = readContinuationMarker(directory, sessionId)
    expect(marker).not.toBeNull()
    expect(marker!.sources["background-task"]).toBeDefined()
    expect(marker!.sources["background-task"]!.reason).toBeDefined()

    const parsed = JSON.parse(marker!.sources["background-task"]!.reason!)
    expect(parsed.status).toBe("DONE")
    expect(parsed.handoff).toBe("return_to_caller")
  })

  test("#given agent text with IN_PROGRESS handoff #then persists correctly", () => {
    const directory = createTempDir()
    const sessionId = "ses_process_2"

    const response = [
      "Working on backend.",
      "STATUS: IN_PROGRESS",
      'SIGNALS_EMITTED: [{"signal":"backend_ready","payload":{}}]',
      "HANDOFF: nodejs-backend-developer",
    ].join("\n")

    const result = processHandoffInAgentResponse(response, directory, sessionId)

    expect(result).not.toBeNull()
    expect(result!.status).toBe("IN_PROGRESS")
    expect(result!.handoff).toBe("nodejs-backend-developer")

    const marker = readContinuationMarker(directory, sessionId)
    expect(marker).not.toBeNull()
    const parsed = JSON.parse(marker!.sources["background-task"]!.reason!)
    expect(parsed.status).toBe("IN_PROGRESS")
    expect(parsed.handoff).toBe("nodejs-backend-developer")
  })

  test("#given agent text without handoff #then does not write marker", () => {
    const directory = createTempDir()
    const sessionId = "ses_process_3"

    const result = processHandoffInAgentResponse("Task completed successfully.", directory, sessionId)

    expect(result).toBeNull()

    const marker = readContinuationMarker(directory, sessionId)
    expect(marker).toBeNull()
  })

  test("#given empty text #then returns null and writes nothing", () => {
    const directory = createTempDir()
    const sessionId = "ses_process_4"

    expect(processHandoffInAgentResponse("", directory, sessionId)).toBeNull()
    expect(processHandoffInAgentResponse("  ", directory, sessionId)).toBeNull()

    const marker = readContinuationMarker(directory, sessionId)
    expect(marker).toBeNull()
  })
})

describe("recordHandoffToOmoState", () => {
  test("#given handoff block #then writes to .omo/hecateq/state.json", () => {
    const directory = createTempDir()

    const handoff = extractHandoffFromAgentResponse([
      "Result of work.",
      "STATUS: DONE",
      'SIGNALS_EMITTED: [{"signal":"tests_passed","payload":{}},{"signal":"backend_ready","payload":{}}]',
      "HANDOFF: return_to_caller",
    ].join("\n"))

    expect(handoff).not.toBeNull()

    const result = recordHandoffToOmoState(directory, handoff!)
    expect(result).toBe(true)

    // Verify the file was created and contains the handoff
    const omoStatePath = join(directory, HECATEQ_OMO_DIR, "state.json")
    expect(existsSync(omoStatePath)).toBe(true)

    const mgr = new OmoStateManager(directory)
    const active = mgr.getActiveHandoff()
    expect(active).not.toBeNull()
    expect(active!.status).toBe("DONE")
    expect(active!.target).toBe("return_to_caller")
    expect(active!.signalCount).toBe(2)
    expect(active!.signalNames).toEqual(["tests_passed", "backend_ready"])
    expect(active!.source).toBe("direct")
  })

  test("#given handoff block with IN_PROGRESS status #then persists correctly", () => {
    const directory = createTempDir()

    const handoff = extractHandoffFromAgentResponse([
      "Working on backend task.",
      "STATUS: IN_PROGRESS",
      'SIGNALS_EMITTED: [{"signal":"schema_ready","payload":{"version":2}}]',
      "HANDOFF: nodejs-backend-developer",
    ].join("\n"))

    const result = recordHandoffToOmoState(directory, handoff!)
    expect(result).toBe(true)

    const mgr = new OmoStateManager(directory)
    const active = mgr.getActiveHandoff()
    expect(active!.status).toBe("IN_PROGRESS")
    expect(active!.target).toBe("nodejs-backend-developer")
    expect(active!.signalCount).toBe(1)

    const history = mgr.getHandoffHistory()
    expect(history).toHaveLength(1)
    expect(history[0]!.status).toBe("IN_PROGRESS")
  })
})

describe("buildOmoHandoffContextSummary", () => {
  test("#given active handoff in .omo/hecateq #then returns summary", () => {
    const directory = createTempDir()
    const mgr = new OmoStateManager(directory)
    mgr.recordHandoff({
      status: "DONE",
      target: "return_to_caller",
      signalCount: 1,
      signalNames: ["tests_passed"],
      timestamp: new Date().toISOString(),
      source: "direct",
    })

    const summary = buildOmoHandoffContextSummary(directory)
    expect(summary.length).toBeGreaterThan(0)
    expect(summary).toMatch(/DONE/)
    expect(summary).toMatch(/return_to_caller/)
  })

  test("#given no .omo/hecateq/ state #then returns empty string", () => {
    const directory = createTempDir()
    const summary = buildOmoHandoffContextSummary(directory)
    expect(summary).toBe("")
  })

  test("#given handoff history but no active handoff #then uses most recent history entry", () => {
    const directory = createTempDir()
    const mgr = new OmoStateManager(directory)
    mgr.recordHandoff({
      status: "IN_PROGRESS",
      target: "nodejs-backend-developer",
      signalCount: 0,
      signalNames: [],
      timestamp: new Date().toISOString(),
      source: "direct",
    })
    mgr.clearActiveHandoff()

    const summary = buildOmoHandoffContextSummary(directory)
    expect(summary).toMatch(/IN_PROGRESS/)
    expect(summary).toMatch(/nodejs-backend-developer/)
  })
})

describe("buildLiveHandoffContextSummary — canonical read path", () => {
  test("#given .omo/hecateq has handoff #then reads it first and ignores fallback sources", () => {
    const directory = createTempDir()
    const sessionId = "ses_canonical_1"

    // Write to .omo/hecateq/ — canonical
    const mgr = new OmoStateManager(directory)
    mgr.recordHandoff({
      status: "DONE",
      target: "return_to_caller",
      signalCount: 1,
      signalNames: ["tests_passed"],
      timestamp: new Date().toISOString(),
      source: "direct",
    })

    // Also write a different handoff to continuation marker — should be ignored
    setContinuationMarkerSource(directory, sessionId, "background-task", "active", JSON.stringify({
      status: "IN_PROGRESS",
      handoff: "different-agent",
      signalCount: 0,
      signals: [],
    }))

    const summary = buildLiveHandoffContextSummary(directory, sessionId)
    expect(summary).toMatch(/DONE/)
    expect(summary).toMatch(/return_to_caller/)
    expect(summary).not.toMatch(/IN_PROGRESS/)
    expect(summary).not.toMatch(/different-agent/)
  })

  test("#given .omo/hecateq has no handoff #then falls back to continuation marker", () => {
    const directory = createTempDir()
    const sessionId = "ses_fallback_1"

    setContinuationMarkerSource(directory, sessionId, "background-task", "active", JSON.stringify({
      status: "IN_PROGRESS",
      handoff: "nodejs-backend-developer",
      signalCount: 1,
      signals: [{ signal: "backend_ready", payload: {} }],
    }))

    const summary = buildLiveHandoffContextSummary(directory, sessionId)
    expect(summary).toMatch(/IN_PROGRESS/)
    expect(summary).toMatch(/nodejs-backend-developer/)
  })
})

describe("processHandoffInAgentResponse — omo persistence", () => {
  test("#given handoff block #then writes to .omo/hecateq/ in addition to continuation marker", () => {
    const directory = createTempDir()
    const sessionId = "ses_omo_1"

    const response = [
      "Here is the result of the work.",
      "STATUS: DONE",
      'SIGNALS_EMITTED: [{"signal":"tests_passed","payload":{}}]',
      "HANDOFF: return_to_caller",
    ].join("\n")

    const result = processHandoffInAgentResponse(response, directory, sessionId)
    expect(result).not.toBeNull()
    expect(result!.status).toBe("DONE")

    // Verify .omo/hecateq/state.json was written
    const mgr = new OmoStateManager(directory)
    const active = mgr.getActiveHandoff()
    expect(active).not.toBeNull()
    expect(active!.status).toBe("DONE")
    expect(active!.target).toBe("return_to_caller")
    expect(active!.source).toBe("direct")

    // Verify continuation marker was also written (backward-compatible fallback)
    const marker = readContinuationMarker(directory, sessionId)
    expect(marker).not.toBeNull()
  })

  test("#given no handoff in response #then does not create .omo/hecateq state file", () => {
    const directory = createTempDir()
    const sessionId = "ses_omo_2"

    const result = processHandoffInAgentResponse("Task completed successfully.", directory, sessionId)
    expect(result).toBeNull()

    const omoStatePath = join(directory, HECATEQ_OMO_DIR, "state.json")
    expect(existsSync(omoStatePath)).toBe(false)
  })
})
