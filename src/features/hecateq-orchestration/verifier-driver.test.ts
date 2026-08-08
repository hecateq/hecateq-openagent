import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { HecateqTaskEvidence } from "./evidence-types"
import {
  _resetExecutionRegistryForTesting,
  getExecutionRecord,
} from "./execution-registry"
import {
  _setHandoffHistoryFilePathForTesting,
  loadRecentRuntimeEvents,
} from "./handoff-history"
import type { HecateqVerificationResult } from "./verifier-routing"
import {
  HECATEQ_MAX_VERIFIER_ATTEMPTS,
  VerifierDriverError,
  _resetVerifierDriverWaitersForTesting,
  completeVerifierExecution,
  startVerifierExecution,
} from "./verifier-driver"
import type {
  HecateqVerifierDriverConfig,
  HecateqVerifierDriverHandle,
  HecateqVerifierDriverResult,
} from "./verifier-driver"

// ─── Shared fixtures ─────────────────────────────────────────────────────────

const TASK_GRAPH = "tg_driver"
const TASK_ID = "T4"
const EXECUTION_ID = "exec_A"
const AGENT = "qa-test-engineer"

function makeConfig(
  overrides: Partial<HecateqVerifierDriverConfig> = {},
): HecateqVerifierDriverConfig {
  return {
    taskGraphId: TASK_GRAPH,
    taskId: TASK_ID,
    executionId: EXECUTION_ID,
    agent: AGENT,
    attempt: 1,
    ...overrides,
  }
}

function makeEvidence(): HecateqTaskEvidence {
  return {
    evidenceId: "ev_1",
    taskGraphId: TASK_GRAPH,
    taskId: TASK_ID,
    attempt: 1,
    executionId: EXECUTION_ID,
    agent: "nodejs-backend-developer",
    createdAt: "2026-08-08T15:00:00.000Z",
    filesChanged: ["src/a.ts"],
  }
}

function makeDriverResult(handle: HecateqVerifierDriverHandle): HecateqVerifierDriverResult {
  const verification: HecateqVerificationResult = {
    taskGraphId: TASK_GRAPH,
    taskId: TASK_ID,
    attempt: 1,
    executionId: EXECUTION_ID,
    status: "verified",
    blockers: [],
    createdAt: "2026-08-08T15:00:00.000Z",
  }
  return {
    verification,
    evidence: makeEvidence(),
    resumptionChannel: handle.channel,
  }
}

// ─── Test suite ──────────────────────────────────────────────────────────────

describe("startVerifierExecution", () => {
  let dir: string
  let ledgerPath: string

  beforeEach(() => {
    // given a fresh temp ledger + empty registries
    dir = mkdtempSync(join(tmpdir(), "hecateq-verifier-driver-"))
    ledgerPath = join(dir, ".opencode", "state", "hecateq", "handoff-history.jsonl")
    _setHandoffHistoryFilePathForTesting(ledgerPath)
    _resetExecutionRegistryForTesting()
    _resetVerifierDriverWaitersForTesting()
  })

  afterEach(() => {
    _setHandoffHistoryFilePathForTesting(null)
    _resetExecutionRegistryForTesting()
    _resetVerifierDriverWaitersForTesting()
    rmSync(dir, { recursive: true, force: true })
  })

  test("#given a fresh task #when starting a verifier execution #then execution is registered and parent_wake channel attached", () => {
    // given
    const config = makeConfig()
    // when
    const handle = startVerifierExecution(config)
    // then
    const record = getExecutionRecord(handle.verifierExecutionId)
    expect(record).not.toBeNull()
    expect(record?.identity.taskGraphId).toBe(TASK_GRAPH)
    expect(record?.identity.taskId).toBe(TASK_ID)
    expect(record?.identity.attempt).toBe(1)
    expect(record?.identity.agent).toBe(AGENT)
    expect(handle.channel.kind).toBe("parent_wake")
    expect(record?.channel?.kind).toBe("parent_wake")

    const events = loadRecentRuntimeEvents(20)
    expect(
      events.some(
        (event) =>
          event.event === "execution_started" &&
          event.execution_id === handle.verifierExecutionId,
      ),
    ).toBe(true)
    expect(events.some((event) => event.event === "resumption_channel_attached")).toBe(true)
  })

  test("#given a completed wait #when completing with a provided result #then wait resolves with that result (no polling, no timers)", async () => {
    // given
    const handle = startVerifierExecution(makeConfig())
    const result = makeDriverResult(handle)
    completeVerifierExecution(handle.verifierExecutionId, result)
    // when
    const got = await handle.wait()
    // then
    expect(got).toBe(result)
    expect(got.resumptionChannel.kind).toBe("parent_wake")
  })

  test("#given a live verifier execution for same task+attempt #when starting again #then duplicate guard blocks", () => {
    // given
    startVerifierExecution(makeConfig())
    // when / then
    expect(() => startVerifierExecution(makeConfig())).toThrow(VerifierDriverError)
    expect(() => startVerifierExecution(makeConfig())).toThrow(/duplicate verifier execution/)
  })

  test("#given attempts 1 and 2 on the same task #when starting both #then each gets a new executionId", () => {
    // given
    // when
    const first = startVerifierExecution(makeConfig({ attempt: 1 }))
    const second = startVerifierExecution(makeConfig({ attempt: 2 }))
    // then
    expect(first.verifierExecutionId).not.toBe(second.verifierExecutionId)
    expect(getExecutionRecord(first.verifierExecutionId)?.identity.attempt).toBe(1)
    expect(getExecutionRecord(second.verifierExecutionId)?.identity.attempt).toBe(2)
  })

  test("#given the driver contract #then HECATEQ_MAX_VERIFIER_ATTEMPTS matches the bounded default", () => {
    // when / then
    expect(HECATEQ_MAX_VERIFIER_ATTEMPTS).toBe(2)
  })
})
