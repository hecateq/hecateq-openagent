import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  _resetExecutionRegistryForTesting,
  attachChannel,
  attachCorrelation,
  checkDuplicateDelegation,
  detachChannel,
  findExecutionByTask,
  findLatestExecutionForTask,
  getExecutionRecord,
  registerExecution,
  transitionProgress,
} from "./execution-registry"
import {
  isLiveResumptionChannel,
  probeBackgroundTaskLiveness,
  probeDelegatedSessionLiveness,
  resolveProgressState,
} from "./resumption-channel"
import {
  _setHandoffHistoryFilePathForTesting,
  appendHandoffHistoryEntry,
  appendRuntimeEvent,
  loadRecentHandoffHistory,
  loadRecentRuntimeEvents,
} from "./handoff-history"
import type { HecateqHandoffHistoryEntry } from "./handoff-history"
import type {
  HecateqExecutionRecord,
  HecateqRuntimeEvent,
  ResumptionChannel,
} from "./runtime-continuity-types"

// ─── Shared fixtures ──────────────────────────────────────────────────────────

function makeLegacyHandoffEntry(
  overrides: Partial<HecateqHandoffHistoryEntry> = {},
): HecateqHandoffHistoryEntry {
  return {
    timestamp: "2026-08-08T14:30:00.000Z",
    session_id: "ses_legacy",
    from_agent: "hecateq-planner",
    to_agent: "reviewer",
    status: "done",
    confidence: 0.92,
    ...overrides,
  }
}

function makeWaitingExecution(options: {
  taskGraphId?: string
  taskId?: string
  attempt?: number
  agent?: string
  channel?: ResumptionChannel
} = {}): { executionId: string; record: HecateqExecutionRecord } {
  const identity = registerExecution({
    taskGraphId: options.taskGraphId ?? "graph-a",
    taskId: options.taskId ?? "task-a",
    attempt: options.attempt ?? 1,
    agent: options.agent ?? "worker",
  })
  transitionProgress(identity.executionId, "waiting")
  if (options.channel) {
    attachChannel(identity.executionId, options.channel)
  }
  return { executionId: identity.executionId, record: mustGetRecord(identity.executionId) }
}

function mustGetRecord(executionId: string): HecateqExecutionRecord {
  const record = getExecutionRecord(executionId)
  if (!record) throw new Error(`record missing for ${executionId}`)
  return record
}

describe("execution registry", () => {
  beforeEach(() => {
    // given a fresh in-memory registry
    _resetExecutionRegistryForTesting()
  })

  test("#given a registration #when created #then progressState defaults to active", () => {
    // given
    // when
    const identity = registerExecution({
      taskGraphId: "g",
      taskId: "t",
      attempt: 1,
      agent: "a",
    })
    // then
    expect(getExecutionRecord(identity.executionId)?.progressState).toBe("active")
    expect(identity.executionId).not.toBe("")
  })

  test("#given same logical task inputs #when registering twice #then executionIds differ (identity immutable)", () => {
    // given
    // when
    const first = registerExecution({ taskGraphId: "g", taskId: "t", attempt: 1, agent: "a" })
    const second = registerExecution({ taskGraphId: "g", taskId: "t", attempt: 1, agent: "a" })
    // then
    expect(first.executionId).not.toBe(second.executionId)
    expect(first.startedAt).toBeTruthy()
    expect(second.startedAt).toBeTruthy()
  })

  test("#given an attempt 1 execution #when registering attempt 2 #then a new executionId is produced", () => {
    // given
    const first = registerExecution({ taskGraphId: "g", taskId: "t", attempt: 1, agent: "a" })
    // when
    const second = registerExecution({ taskGraphId: "g", taskId: "t", attempt: 2, agent: "a" })
    // then
    expect(second.executionId).not.toBe(first.executionId)
    expect(findExecutionByTask("g", "t", 2)?.identity.attempt).toBe(2)
  })

  test("#given no matching registration #when finding by task #then returns null", () => {
    // given
    // when
    const found = findExecutionByTask("g", "missing", 1)
    // then
    expect(found).toBeNull()
  })

  test("#given two attempts #when finding latest #then returns highest attempt", () => {
    // given
    registerExecution({ taskGraphId: "g", taskId: "t", attempt: 1, agent: "a" })
    const second = registerExecution({ taskGraphId: "g", taskId: "t", attempt: 2, agent: "a" })
    // when
    const latest = findLatestExecutionForTask("g", "t")
    // then
    expect(latest?.identity.executionId).toBe(second.executionId)
    expect(latest?.identity.attempt).toBe(2)
  })

  test("#given a registered execution #when attaching a session #then correlation resolves deterministically", () => {
    // given
    const identity = registerExecution({ taskGraphId: "g", taskId: "t", attempt: 1, agent: "a" })
    // when
    attachCorrelation(identity.executionId, { sessionId: "ses-child" })
    const firstRead = getExecutionRecord(identity.executionId)
    const secondRead = getExecutionRecord(identity.executionId)
    // then
    expect(firstRead?.correlation.sessionId).toBe("ses-child")
    expect(secondRead?.correlation.sessionId).toBe("ses-child")
  })

  test("#given a registered execution #when attaching a background task #then correlation resolves deterministically", () => {
    // given
    const identity = registerExecution({ taskGraphId: "g", taskId: "t", attempt: 1, agent: "a" })
    // when
    attachCorrelation(identity.executionId, { backgroundTaskId: "bg-9" })
    const record = getExecutionRecord(identity.executionId)
    // then
    expect(record?.correlation.backgroundTaskId).toBe("bg-9")
  })

  test("#given an unknown executionId #when attaching correlation #then returns null", () => {
    // given
    // when
    const result = attachCorrelation("does-not-exist", { sessionId: "ses-x" })
    // then
    expect(result).toBeNull()
  })

  test("#given an unknown executionId #when transitioning #then returns null", () => {
    // given
    // when
    const result = transitionProgress("does-not-exist", "completed")
    // then
    expect(result).toBeNull()
  })

  test("#given a waiting execution #when transitioning to completed #then record becomes completed", () => {
    // given
    const { executionId } = makeWaitingExecution()
    // when
    const record = transitionProgress(executionId, "completed")
    // then
    expect(record?.progressState).toBe("completed")
  })

  test("#given a completed execution #when transitioning to completed again #then same record returned (idempotent)", () => {
    // given
    const { executionId } = makeWaitingExecution()
    // when
    const first = transitionProgress(executionId, "completed")
    const second = transitionProgress(executionId, "completed")
    // then
    expect(second).toBe(first)
    expect(second?.progressState).toBe("completed")
    expect(second?.updatedAt).toBe(first?.updatedAt)
  })

  test("#given a completed execution #when transitioning to failed #then first terminal wins (no-op)", () => {
    // given
    const { executionId } = makeWaitingExecution()
    // when
    const completed = transitionProgress(executionId, "completed")
    const failed = transitionProgress(executionId, "failed")
    // then
    expect(failed).toBe(completed)
    expect(failed?.progressState).toBe("completed")
  })

  test("#given a completed execution #when transitioning back to active #then rejected with null", () => {
    // given
    const { executionId } = makeWaitingExecution()
    transitionProgress(executionId, "completed")
    // when
    const resumed = transitionProgress(executionId, "active")
    // then
    expect(resumed).toBeNull()
    expect(getExecutionRecord(executionId)?.progressState).toBe("completed")
  })

  test("#given a completed execution #when attaching a parent wake channel #then rejected with null", () => {
    // given
    const { executionId } = makeWaitingExecution()
    transitionProgress(executionId, "completed")
    // when
    const result = attachChannel(executionId, {
      kind: "parent_wake",
      id: "wake-1",
      alive: true,
    })
    // then
    expect(result).toBeNull()
    expect(getExecutionRecord(executionId)?.channel).toBeUndefined()
  })

  test("#given a blocked execution #when attaching a channel #then rejected with null", () => {
    // given
    const identity = registerExecution({ taskGraphId: "g", taskId: "t", attempt: 1, agent: "a" })
    transitionProgress(identity.executionId, "blocked")
    // when
    const result = attachChannel(identity.executionId, {
      kind: "continuation",
      id: "cont-1",
      alive: true,
    })
    // then
    expect(result).toBeNull()
  })

  test("#given an active execution #when attaching a channel #then channel is stored", () => {
    // given
    const identity = registerExecution({ taskGraphId: "g", taskId: "t", attempt: 1, agent: "a" })
    // when
    const record = attachChannel(identity.executionId, {
      kind: "continuation",
      id: "cont-1",
      alive: true,
    })
    // then
    expect(record?.channel?.kind).toBe("continuation")
    expect(record?.channel?.id).toBe("cont-1")
  })

  test("#given an execution with a channel #when detaching #then channel is cleared", () => {
    // given
    const { executionId } = makeWaitingExecution({
      channel: { kind: "background_task", id: "bg-x", alive: true },
    })
    // when
    const record = detachChannel(executionId)
    // then
    expect(record?.channel).toBeUndefined()
  })

  test("#given an unknown executionId #when reading record #then returns null", () => {
    // given
    // when
    const record = getExecutionRecord("does-not-exist")
    // then
    expect(record).toBeNull()
  })
})

describe("duplicate delegation guard", () => {
  beforeEach(() => {
    // given a fresh in-memory registry
    _resetExecutionRegistryForTesting()
  })

  test("#given a non-terminal execution #when checking duplicate delegation #then reuses existing execution", () => {
    // given
    const identity = registerExecution({ taskGraphId: "g", taskId: "t", attempt: 1, agent: "a" })
    // when
    const decision = checkDuplicateDelegation({ taskGraphId: "g", taskId: "t", attempt: 1, agent: "a" })
    // then
    expect(decision.action).toBe("reuse_existing_execution")
    if (decision.action === "reuse_existing_execution") {
      expect(decision.executionId).toBe(identity.executionId)
    }
  })

  test("#given a terminal execution #when checking duplicate delegation #then creates a new attempt", () => {
    // given
    const identity = registerExecution({ taskGraphId: "g", taskId: "t", attempt: 1, agent: "a" })
    transitionProgress(identity.executionId, "completed")
    // when
    const decision = checkDuplicateDelegation({ taskGraphId: "g", taskId: "t", attempt: 1, agent: "a" })
    // then
    expect(decision.action).toBe("create_new_attempt")
    if (decision.action === "create_new_attempt") {
      expect(decision.executionId).not.toBe(identity.executionId)
    }
  })

  test("#given a live execution bound to a different agent #when checking duplicate delegation #then blocked", () => {
    // given
    registerExecution({ taskGraphId: "g", taskId: "t", attempt: 1, agent: "alice" })
    // when
    const decision = checkDuplicateDelegation({ taskGraphId: "g", taskId: "t", attempt: 1, agent: "bob" })
    // then
    expect(decision.action).toBe("blocked")
    if (decision.action === "blocked") {
      expect(decision.reason).toContain("agent")
    }
  })

  test("#given no prior execution #when checking duplicate delegation #then proposes a new attempt", () => {
    // given
    // when
    const decision = checkDuplicateDelegation({ taskGraphId: "g", taskId: "t", attempt: 1, agent: "a" })
    // then
    expect(decision.action).toBe("create_new_attempt")
  })
})

describe("resumption channels", () => {
  beforeEach(() => {
    // given a fresh in-memory registry
    _resetExecutionRegistryForTesting()
  })

  test("#given a waiting execution with a running background child #when resolving #then stays waiting, not blocked", () => {
    // given
    const { executionId } = makeWaitingExecution({
      channel: { kind: "background_task", id: "bg-1", alive: true },
    })
    // when
    const state = resolveProgressState({
      record: mustGetRecord(executionId),
      livenessProbes: { isBackgroundTaskAlive: () => true },
    })
    // then
    expect(state).toBe("waiting")
  })

  test("#given a waiting execution with a live delegated session #when resolving #then stays waiting", () => {
    // given
    const { executionId } = makeWaitingExecution({
      channel: { kind: "delegated_session", id: "ses-child", alive: true },
    })
    attachCorrelation(executionId, { sessionId: "ses-child" })
    // when
    const state = resolveProgressState({
      record: mustGetRecord(executionId),
      livenessProbes: { isDelegatedSessionAlive: () => true },
    })
    // then
    expect(state).toBe("waiting")
  })

  test("#given a waiting execution with no resumption channel #when resolving #then blocked", () => {
    // given
    const { executionId } = makeWaitingExecution()
    // when
    const state = resolveProgressState({
      record: mustGetRecord(executionId),
    })
    // then
    expect(state).toBe("blocked")
  })

  test("#given a waiting execution whose probe reports dead #when resolving #then fails closed to blocked", () => {
    // given
    const { executionId } = makeWaitingExecution({
      channel: { kind: "background_task", id: "bg-ghost", alive: true },
    })
    // when
    const state = resolveProgressState({
      record: mustGetRecord(executionId),
      livenessProbes: { isBackgroundTaskAlive: () => false },
    })
    // then
    expect(state).toBe("blocked")
  })

  test("#given a waiting execution with a stale/ghost session #when resolving #then blocked, not waiting", () => {
    // given
    const { executionId } = makeWaitingExecution({
      channel: { kind: "delegated_session", id: "ses-stale", alive: true },
    })
    // when
    const state = resolveProgressState({
      record: mustGetRecord(executionId),
      livenessProbes: { isDelegatedSessionAlive: () => false },
    })
    // then
    expect(state).toBe("blocked")
  })

  test("#given a waiting execution with a live continuation channel #when resolving #then stays waiting", () => {
    // given
    const { executionId } = makeWaitingExecution({
      channel: { kind: "continuation", id: "cont-1", alive: true },
    })
    // when
    const state = resolveProgressState({
      record: mustGetRecord(executionId),
      livenessProbes: { isContinuationAlive: () => true },
    })
    // then
    expect(state).toBe("waiting")
  })

  test("#given a waiting execution with a live channel #when resolving twice #then idempotent", () => {
    // given
    const { executionId } = makeWaitingExecution({
      channel: { kind: "background_task", id: "bg-1", alive: true },
    })
    const record = mustGetRecord(executionId)
    const probes = { isBackgroundTaskAlive: () => true }
    // when
    const first = resolveProgressState({ record, livenessProbes: probes })
    const second = resolveProgressState({ record, livenessProbes: probes })
    // then
    expect(first).toBe("waiting")
    expect(second).toBe(first)
  })

  test("#given an active execution #when resolving without probes #then stays active", () => {
    // given
    const identity = registerExecution({ taskGraphId: "g", taskId: "t", attempt: 1, agent: "a" })
    // when
    const state = resolveProgressState({
      record: mustGetRecord(identity.executionId),
    })
    // then
    expect(state).toBe("active")
  })

  test("#given a completed execution #when resolving #then terminal state is unchanged", () => {
    // given
    const { executionId } = makeWaitingExecution()
    transitionProgress(executionId, "completed")
    // when
    const state = resolveProgressState({
      record: mustGetRecord(executionId),
    })
    // then
    expect(state).toBe("completed")
  })

  test("#given a waiting execution with a live channel #when completing via transition #then output polling is not required", () => {
    // given
    const identity = registerExecution({ taskGraphId: "g", taskId: "t", attempt: 1, agent: "a" })
    attachCorrelation(identity.executionId, { backgroundTaskId: "bg-19" })
    attachChannel(identity.executionId, {
      kind: "background_task",
      id: "bg-19",
      alive: true,
    })
    transitionProgress(identity.executionId, "waiting")
    let probeReturnedOutput = false
    // when — liveness probe is a boolean check; completion comes from the transition, never from polling output
    const state = resolveProgressState({
      record: mustGetRecord(identity.executionId),
      livenessProbes: {
        isBackgroundTaskAlive: () => {
          probeReturnedOutput = true
          return true
        },
      },
    })
    const finished = transitionProgress(identity.executionId, "completed")
    // then
    expect(state).toBe("waiting")
    expect(probeReturnedOutput).toBe(true)
    expect(finished?.progressState).toBe("completed")
  })

  test("#given no probe #when probing background task liveness #then fails closed to false", () => {
    // given
    // when
    const alive = probeBackgroundTaskLiveness("bg-x")
    // then
    expect(alive).toBe(false)
  })

  test("#given a probe #when probing background task liveness #then returns probe result", () => {
    // given
    // when
    const alive = probeBackgroundTaskLiveness("bg-x", () => true)
    // then
    expect(alive).toBe(true)
  })

  test("#given no probe #when probing delegated session liveness #then fails closed to false", () => {
    // given
    // when
    const alive = probeDelegatedSessionLiveness("ses-x")
    // then
    expect(alive).toBe(false)
  })

  test("#given a probe #when probing delegated session liveness #then returns probe result", () => {
    // given
    // when
    const alive = probeDelegatedSessionLiveness("ses-x", () => true)
    // then
    expect(alive).toBe(true)
  })

  test("#given no channel #when checking liveness #then not live", () => {
    // given
    // when
    const live = isLiveResumptionChannel(undefined, {})
    // then
    expect(live).toBe(false)
  })

  test("#given a channel but no matching probe #when checking liveness #then treated as not live", () => {
    // given
    const channel: ResumptionChannel = { kind: "background_task", id: "bg-1", alive: true }
    // when
    const live = isLiveResumptionChannel(channel)
    // then
    expect(live).toBe(false)
  })

  test("#given a channel with a live probe #when checking liveness #then live", () => {
    // given
    const channel: ResumptionChannel = { kind: "background_task", id: "bg-1", alive: true }
    // when
    const live = isLiveResumptionChannel(channel, { isBackgroundTaskAlive: () => true })
    // then
    expect(live).toBe(true)
  })
})

describe("runtime event ledger", () => {
  let dir: string
  let ledgerPath: string

  beforeEach(() => {
    // given a fresh temp ledger
    dir = mkdtempSync(join(tmpdir(), "hecateq-continuity-"))
    ledgerPath = join(dir, ".opencode", "state", "hecateq", "handoff-history.jsonl")
    _setHandoffHistoryFilePathForTesting(ledgerPath)
    _resetExecutionRegistryForTesting()
  })

  afterEach(() => {
    _setHandoffHistoryFilePathForTesting(null)
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  test("#given a runtime event #when appended #then round-trips via loadRecentRuntimeEvents", () => {
    // given
    const event: HecateqRuntimeEvent = {
      event: "execution_started",
      timestamp: "2026-08-08T15:00:00.000Z",
      task_graph_id: "g1",
      task_id: "t1",
      attempt: 1,
      execution_id: "exec-1",
      agent: "worker",
    }
    // when
    appendRuntimeEvent(event)
    const events = loadRecentRuntimeEvents()
    // then
    expect(events).toHaveLength(1)
    expect(events[0]?.event).toBe("execution_started")
    expect(events[0]?.execution_id).toBe("exec-1")
    expect(events[0]?.agent).toBe("worker")
  })

  test("#given a legacy handoff entry and a runtime event #when loading #then each loader returns only its own lines", () => {
    // given
    appendHandoffHistoryEntry(makeLegacyHandoffEntry())
    appendRuntimeEvent({
      event: "execution_completed",
      timestamp: "2026-08-08T15:01:00.000Z",
      execution_id: "exec-2",
    })
    // when
    const handoffs = loadRecentHandoffHistory()
    const events = loadRecentRuntimeEvents()
    // then
    expect(handoffs).toHaveLength(1)
    expect(handoffs[0]?.from_agent).toBe("hecateq-planner")
    expect(handoffs[0]?.event).toBeUndefined()
    expect(events).toHaveLength(1)
    expect(events[0]?.event).toBe("execution_completed")
  })

  test("#given a runtime event #when serialized #then no prompt/output/secret keys are stored", () => {
    // given
    appendRuntimeEvent({
      event: "execution_failed",
      timestamp: "2026-08-08T15:02:00.000Z",
      execution_id: "exec-3",
      reason: "worker crashed",
    })
    // when
    const line = readFileSync(ledgerPath, "utf-8").trim()
    const parsed = JSON.parse(line) as Record<string, unknown>
    // then
    expect(parsed["prompt"]).toBeUndefined()
    expect(parsed["output"]).toBeUndefined()
    expect(parsed["secret"]).toBeUndefined()
    expect(parsed["model_output"]).toBeUndefined()
    expect(line).not.toContain("sk-")
    expect(Object.keys(parsed)).not.toContain("prompt")
    expect(Object.keys(parsed)).not.toContain("output")
  })

  test("#given a channel on a runtime event #when appended #then channel round-trips", () => {
    // given
    appendRuntimeEvent({
      event: "resumption_channel_attached",
      timestamp: "2026-08-08T15:03:00.000Z",
      execution_id: "exec-4",
      channel: { kind: "background_task", id: "bg-4", alive: true },
    })
    // when
    const events = loadRecentRuntimeEvents()
    // then
    expect(events[0]?.channel?.kind).toBe("background_task")
    expect(events[0]?.channel?.id).toBe("bg-4")
  })

  test("#given seven runtime events #when loading recent #then returns last five", () => {
    // given
    for (let i = 1; i <= 7; i += 1) {
      appendRuntimeEvent({
        event: "execution_started",
        timestamp: `2026-08-08T15:${String(i).padStart(2, "0")}:00.000Z`,
        execution_id: `exec-${i}`,
      })
    }
    // when
    const events = loadRecentRuntimeEvents(5)
    // then
    expect(events).toHaveLength(5)
    expect(events[0]?.execution_id).toBe("exec-3")
    expect(events[4]?.execution_id).toBe("exec-7")
  })

  test("#given an invalid JSON line in the ledger #when loading runtime events #then it is skipped", () => {
    // given
    appendRuntimeEvent({
      event: "execution_started",
      timestamp: "2026-08-08T15:10:00.000Z",
      execution_id: "exec-ok",
    })
    const corrupt = `${readFileSync(ledgerPath, "utf-8")}{broken json\n`
    writeFileSync(ledgerPath, corrupt, "utf-8")
    // when
    const events = loadRecentRuntimeEvents(10)
    // then — no crash, valid line still parsed
    expect(events).toHaveLength(1)
    expect(events[0]?.execution_id).toBe("exec-ok")
  })

  test("#given no ledger file #when loading runtime events #then returns empty array", () => {
    // given — fresh dir, no file created yet
    // when
    const events = loadRecentRuntimeEvents()
    // then
    expect(events).toEqual([])
  })
})
