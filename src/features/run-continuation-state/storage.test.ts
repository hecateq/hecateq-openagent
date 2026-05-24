import { afterEach, describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  clearContinuationMarker,
  isContinuationMarkerActive,
  readContinuationMarker,
  setContinuationMarkerSource,
} from "./storage"

const tempDirs: string[] = []

function createTempDir(): string {
  const directory = mkdtempSync(join(tmpdir(), "omo-run-marker-"))
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

describe("run-continuation-state storage", () => {
  it("stores and reads per-source marker state", () => {
    // given
    const directory = createTempDir()
    const sessionID = "ses_test"

    // when
    setContinuationMarkerSource(directory, sessionID, "todo", "active", "2 todos remaining")
    setContinuationMarkerSource(directory, sessionID, "stop", "stopped", "user requested stop")
    const marker = readContinuationMarker(directory, sessionID)

    // then
    expect(marker).not.toBeNull()
    expect(marker?.sessionID).toBe(sessionID)
    expect(marker?.sources.todo?.state).toBe("active")
    expect(marker?.sources.todo?.reason).toBe("2 todos remaining")
    expect(marker?.sources.stop?.state).toBe("stopped")
  })

  it("treats marker as active when any source is active", () => {
    // given
    const directory = createTempDir()
    const sessionID = "ses_active"
    setContinuationMarkerSource(directory, sessionID, "todo", "active", "pending")
    setContinuationMarkerSource(directory, sessionID, "stop", "idle")
    const marker = readContinuationMarker(directory, sessionID)

    // when
    const isActive = isContinuationMarkerActive(marker)

    // then
    expect(isActive).toBe(true)
  })

  it("returns inactive when no source is active", () => {
    // given
    const directory = createTempDir()
    const sessionID = "ses_idle"
    setContinuationMarkerSource(directory, sessionID, "todo", "idle")
    setContinuationMarkerSource(directory, sessionID, "stop", "stopped")
    const marker = readContinuationMarker(directory, sessionID)

    // when
    const isActive = isContinuationMarkerActive(marker)

    // then
    expect(isActive).toBe(false)
  })

  it("clears marker for a session", () => {
    // given
    const directory = createTempDir()
    const sessionID = "ses_clear"
    setContinuationMarkerSource(directory, sessionID, "todo", "active")

    // when
    clearContinuationMarker(directory, sessionID)
    const marker = readContinuationMarker(directory, sessionID)

    // then
    expect(marker).toBeNull()
  })

  // ─── Requirement 6: Handoff data can be written/read in continuation marker ─

  it("stores and retrieves handoff block data as a continuation marker reason", () => {
    // given — a serialized handoff block
    const directory = createTempDir()
    const sessionID = "ses_handoff"
    const handoffReason = JSON.stringify({
      status: "DONE",
      handoff: "return_to_caller",
      signalCount: 2,
      signals: ["schema_ready", "tests_passed"],
      issuedAt: "2026-05-24T00:00:00.000Z",
    })

    // when — store the handoff as a background-task marker'ın reason'ı
    setContinuationMarkerSource(directory, sessionID, "background-task", "active", handoffReason)
    const marker = readContinuationMarker(directory, sessionID)

    // then
    expect(marker).not.toBeNull()
    expect(marker?.sessionID).toBe("ses_handoff")
    expect(marker?.sources["background-task"]?.state).toBe("active")
    const parsed = JSON.parse(marker!.sources["background-task"]!.reason!)
    expect(parsed.status).toBe("DONE")
    expect(parsed.handoff).toBe("return_to_caller")
    expect(parsed.signalCount).toBe(2)
    expect(parsed.signals).toContain("schema_ready")
    expect(parsed.signals).toContain("tests_passed")
  })

  it("reads handoff data back from active continuation marker reason", () => {
    // given
    const directory = createTempDir()
    const sessionID = "ses_handoff_read"
    const handoffReason = JSON.stringify({
      status: "IN_PROGRESS",
      handoff: "nodejs-backend-developer",
      signals: [{ signal: "backend_ready", payload: {} }],
    })
    setContinuationMarkerSource(directory, sessionID, "background-task", "active", handoffReason)

    // when
    const marker = readContinuationMarker(directory, sessionID)

    // then
    expect(marker).not.toBeNull()
    const parsed = JSON.parse(marker!.sources["background-task"]!.reason!)
    expect(parsed.status).toBe("IN_PROGRESS")
    expect(parsed.handoff).toBe("nodejs-backend-developer")
    expect(parsed.signals).toHaveLength(1)
    expect(parsed.signals[0].signal).toBe("backend_ready")
  })
})
