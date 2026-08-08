import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { HecateqTaskEvidence } from "./evidence-types"
import {
  _setHandoffHistoryFilePathForTesting,
  loadRecentRuntimeEvents,
} from "./handoff-history"
import { runBoundedVerificationRepair } from "./bounded-verification-repair"
import type {
  HecateqBoundedRepairInput,
  HecateqRepairExecutor,
  HecateqVerificationExecutor,
} from "./bounded-verification-repair"
import type { HecateqVerificationResult } from "./verifier-routing"
import {
  _resetVerificationDirForTesting,
  _setVerificationDirForTesting,
} from "./verifier-routing"

// ─── Shared fixtures ─────────────────────────────────────────────────────────

const TASK_GRAPH = "tg_bounded"
const TASK_ID = "T4"
const EXECUTION_ID = "exec_A"
const AGENT = "nodejs-backend-developer"

function makeEvidence(overrides: Partial<HecateqTaskEvidence> = {}): HecateqTaskEvidence {
  return {
    evidenceId: "ev_1",
    taskGraphId: TASK_GRAPH,
    taskId: TASK_ID,
    attempt: 1,
    executionId: EXECUTION_ID,
    agent: AGENT,
    createdAt: "2026-08-08T15:00:00.000Z",
    filesChanged: ["src/a.ts"],
    ...overrides,
  }
}

function makeVerification(
  overrides: Partial<HecateqVerificationResult> = {},
): HecateqVerificationResult {
  return {
    taskGraphId: TASK_GRAPH,
    taskId: TASK_ID,
    attempt: 1,
    executionId: EXECUTION_ID,
    status: "verified",
    blockers: [],
    createdAt: "2026-08-08T15:00:00.000Z",
    ...overrides,
  }
}

function makeInput(
  overrides: Partial<HecateqBoundedRepairInput> = {},
): HecateqBoundedRepairInput {
  return {
    taskGraphId: TASK_GRAPH,
    taskId: TASK_ID,
    executionId: EXECUTION_ID,
    agent: AGENT,
    evidence: makeEvidence(),
    RunVerifier: async () => makeVerification(),
    ...overrides,
  }
}

// ─── Test suite ──────────────────────────────────────────────────────────────

describe("runBoundedVerificationRepair", () => {
  let dir: string
  let verificationDir: string
  let ledgerPath: string

  beforeEach(() => {
    // given a fresh temp verifications dir + ledger
    dir = mkdtempSync(join(tmpdir(), "hecateq-bounded-"))
    verificationDir = join(dir, ".opencode", "state", "hecateq", "verifications")
    ledgerPath = join(dir, ".opencode", "state", "hecateq", "handoff-history.jsonl")
    _setVerificationDirForTesting(verificationDir)
    _setHandoffHistoryFilePathForTesting(ledgerPath)
  })

  afterEach(() => {
    _resetVerificationDirForTesting()
    _setHandoffHistoryFilePathForTesting(null)
    rmSync(dir, { recursive: true, force: true })
  })

  test("#given verified on first verifier call #when running bounded repair #then returns verified attempt=1 nextAction=done", async () => {
    // given
    const calls: string[] = []
    const runVerifier: HecateqVerificationExecutor = async (_input) => {
      calls.push("verify")
      return makeVerification({ status: "verified" })
    }
    // when
    const outcome = await runBoundedVerificationRepair(makeInput({ RunVerifier: runVerifier }))
    // then
    expect(outcome.status).toBe("verified")
    expect(outcome.attempt).toBe(1)
    expect(outcome.nextAction).toBe("done")
    expect(outcome.evidence.evidenceId).toBe("ev_1")
    expect(calls).toEqual(["verify"])
  })

  test("#given reject then verified #when running bounded repair with repair #then returns verified attempt=2 with repaired evidence", async () => {
    // given
    const verifyCalls: string[] = []
    const runVerifier: HecateqVerificationExecutor = async (_input) => {
      verifyCalls.push("verify")
      if (verifyCalls.length === 1) {
        return makeVerification({ status: "rejected", blockers: ["tests missing"] })
      }
      return makeVerification({ attempt: 2, status: "verified" })
    }
    const runRepair: HecateqRepairExecutor = async () =>
      makeEvidence({ evidenceId: "ev_2", attempt: 2, filesChanged: ["src/a.ts", "src/b.ts"] })
    // when
    const outcome = await runBoundedVerificationRepair(
      makeInput({ RunVerifier: runVerifier, RunRepair: runRepair }),
    )
    // then
    expect(outcome.status).toBe("verified")
    expect(outcome.attempt).toBe(2)
    expect(outcome.nextAction).toBe("done")
    expect(outcome.evidence.evidenceId).toBe("ev_2")
    expect(outcome.evidence.attempt).toBe(2)
    expect(verifyCalls).toEqual(["verify", "verify"])
  })

  test("#given reject then reject #when running bounded repair #then returns blocked attempt=2 nextAction=block", async () => {
    // given
    const verifyCalls: string[] = []
    const runVerifier: HecateqVerificationExecutor = async (_input) => {
      verifyCalls.push("verify")
      return makeVerification({
        attempt: verifyCalls.length,
        status: "rejected",
        blockers: ["still failing"],
      })
    }
    const runRepair: HecateqRepairExecutor = async () =>
      makeEvidence({ evidenceId: "ev_2", attempt: 2 })
    // when
    const outcome = await runBoundedVerificationRepair(
      makeInput({ RunVerifier: runVerifier, RunRepair: runRepair }),
    )
    // then
    expect(outcome.status).toBe("blocked")
    expect(outcome.attempt).toBe(2)
    expect(outcome.nextAction).toBe("block")
    expect(outcome.verification.status).toBe("rejected")
    expect(verifyCalls).toEqual(["verify", "verify"])
  })

  test("#given insufficient_evidence then verified #when running bounded repair #then returns verified attempt=2", async () => {
    // given
    const verifyCalls: string[] = []
    const runVerifier: HecateqVerificationExecutor = async (_input) => {
      verifyCalls.push("verify")
      if (verifyCalls.length === 1) {
        return makeVerification({ status: "insufficient_evidence", blockers: ["no tests"] })
      }
      return makeVerification({ attempt: 2, status: "verified" })
    }
    const runRepair: HecateqRepairExecutor = async () =>
      makeEvidence({ evidenceId: "ev_2", attempt: 2 })
    // when
    const outcome = await runBoundedVerificationRepair(
      makeInput({ RunVerifier: runVerifier, RunRepair: runRepair }),
    )
    // then
    expect(outcome.status).toBe("verified")
    expect(outcome.attempt).toBe(2)
    expect(outcome.nextAction).toBe("done")
  })

  test("#given reject and no runRepair #when running bounded repair #then still verifies attempt 2 and blocks on second reject", async () => {
    // given
    const verifyCalls: string[] = []
    const runVerifier: HecateqVerificationExecutor = async (_input) => {
      verifyCalls.push("verify")
      return makeVerification({
        attempt: verifyCalls.length,
        status: "rejected",
        blockers: ["no repair available"],
      })
    }
    // when
    const outcome = await runBoundedVerificationRepair(makeInput({ RunVerifier: runVerifier }))
    // then
    expect(verifyCalls).toEqual(["verify", "verify"])
    expect(outcome.status).toBe("blocked")
    expect(outcome.attempt).toBe(2)
    expect(outcome.nextAction).toBe("block")
    expect(outcome.evidence.evidenceId).toBe("ev_1")
  })

  test("#given always rejected #when running bounded repair #then never exceeds default maxAttempts (2 verifier calls)", async () => {
    // given
    let verifyCalls = 0
    const runVerifier: HecateqVerificationExecutor = async (_input) => {
      verifyCalls += 1
      return makeVerification({ attempt: verifyCalls, status: "rejected", blockers: ["nope"] })
    }
    // when
    const outcome = await runBoundedVerificationRepair(makeInput({ RunVerifier: runVerifier }))
    // then
    expect(verifyCalls).toBe(2)
    expect(outcome.status).toBe("blocked")
    expect(outcome.attempt).toBe(2)
  })

  test("#given maxAttempts=1 and rejected #when running bounded repair #then second verifier call never happens", async () => {
    // given
    let verifyCalls = 0
    const runVerifier: HecateqVerificationExecutor = async (_input) => {
      verifyCalls += 1
      return makeVerification({ status: "rejected", blockers: ["nope"] })
    }
    // when
    const outcome = await runBoundedVerificationRepair(
      makeInput({ RunVerifier: runVerifier, maxAttempts: 1 }),
    )
    // then
    expect(verifyCalls).toBe(1)
    expect(outcome.status).toBe("blocked")
    expect(outcome.attempt).toBe(1)
    expect(outcome.nextAction).toBe("block")
  })

  test("#given repair path #when running bounded repair #then recordVerificationResult is emitted twice", async () => {
    // given
    const verifyCalls: string[] = []
    const runVerifier: HecateqVerificationExecutor = async (_input) => {
      verifyCalls.push("verify")
      if (verifyCalls.length === 1) {
        return makeVerification({ status: "rejected", blockers: ["tests missing"] })
      }
      return makeVerification({ attempt: 2, status: "verified" })
    }
    const runRepair: HecateqRepairExecutor = async () =>
      makeEvidence({ evidenceId: "ev_2", attempt: 2 })
    // when
    await runBoundedVerificationRepair(
      makeInput({ RunVerifier: runVerifier, RunRepair: runRepair }),
    )
    // then: two verification records on disk and two verification ledger events
    const files = readdirSync(verificationDir).filter((name) => name.endsWith(".json"))
    expect(files).toHaveLength(2)

    const events = loadRecentRuntimeEvents(20)
    const verificationEvents = events.filter(
      (event) =>
        event.event === "handoff_created" &&
        typeof event.reason === "string" &&
        event.reason.startsWith("verification:"),
    )
    expect(verificationEvents).toHaveLength(2)
    expect(verificationEvents.map((event) => event.reason)).toEqual([
      "verification:rejected",
      "verification:verified",
    ])
  })
})
