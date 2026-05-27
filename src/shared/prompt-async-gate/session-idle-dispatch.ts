import { log } from "../logger"
import { isSessionActive, settleAfterSessionIdle } from "../session-idle-settle"
import { sessionLatestAssistantBlocksInternalPrompt } from "./pending-tool-turn"
import {
  finishPromptReservation,
  getActiveReservation,
  setPromptReservation,
} from "./reservations"
import { getPromptGateMessagesFetchTimeoutMs, withDispatchTimeout } from "./timing"
import type { InternalPromptDispatchResult, PromptAsyncReservation, PromptDispatchClient, PromptSessionName } from "./types"

function isPromptShapeMismatchError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  return /TypeError/i.test(message)
    && (/(path|body|query)/i.test(message) || /cannot read/i.test(message) || /undefined/i.test(message))
}

function normalizePromptDispatchInput<TInput>(input: TInput, sessionID: string): TInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return input
  }

  const inputRecord = input as Record<string, unknown>
  const existingPath = inputRecord.path
  const normalizedPath = existingPath && typeof existingPath === "object" && !Array.isArray(existingPath)
    ? {
        ...(existingPath as Record<string, unknown>),
        id: typeof (existingPath as Record<string, unknown>).id === "string"
          ? (existingPath as Record<string, unknown>).id
          : sessionID,
      }
    : { id: sessionID }

  return {
    ...inputRecord,
    path: normalizedPath,
    ...(inputRecord.body && typeof inputRecord.body === "object" && !Array.isArray(inputRecord.body)
      ? { body: { ...(inputRecord.body as Record<string, unknown>) } }
      : {}),
    ...(inputRecord.query && typeof inputRecord.query === "object" && !Array.isArray(inputRecord.query)
      ? { query: { ...(inputRecord.query as Record<string, unknown>) } }
      : {}),
  } as TInput
}

export async function dispatchAfterSessionIdle<TInput>(args: {
  readonly sessionName: PromptSessionName
  readonly client: PromptDispatchClient
  readonly sessionID: string
  readonly input: TInput
  readonly source: string
  readonly dedupeKey: string
  readonly settleMs: number
  readonly postDispatchHoldMs: number
  readonly dispatchTimeoutMs: number
  readonly checkStatus: boolean
  readonly checkToolState: boolean
  readonly oneShotRetryForShapeMismatch?: boolean
  readonly dispatch: (input: TInput) => Promise<unknown>
}): Promise<InternalPromptDispatchResult> {
  const {
    sessionName,
    client,
    sessionID,
    input,
    source,
    dedupeKey,
    settleMs,
    postDispatchHoldMs,
    dispatchTimeoutMs,
    checkStatus,
    checkToolState,
    dispatch,
  } = args

  const existing = getActiveReservation(sessionID)
  if (existing) {
    log(`[prompt-async-gate] ${sessionName} skipped because session is reserved`, {
      sessionID,
      source,
      reservedBy: existing.source,
      reservedAgeMs: Date.now() - existing.reservedAt,
    })
    return { status: "reserved", reservedBy: existing.source }
  }

  const reservation: PromptAsyncReservation = {
    source,
    dedupeKey,
    reservedAt: Date.now(),
    token: Symbol(source),
  }
  setPromptReservation(sessionID, reservation)
  let dispatchAttempted = false
  let retriedShapeMismatch = false

  try {
    const canReadStatus = checkStatus && typeof client.session?.status === "function"
    if (settleMs > 0) {
      await settleAfterSessionIdle(settleMs)
    }

    let sessionActive = false
    if (canReadStatus) {
      try {
        sessionActive = await withDispatchTimeout(
          isSessionActive(client, sessionID),
          Math.min(dispatchTimeoutMs, 5000),
          `[prompt-async-gate] ${sessionName} isSessionActive`,
        )
      } catch {
        sessionActive = false
      }
    }
    if (sessionActive) {
      log(`[prompt-async-gate] ${sessionName} skipped because session is active`, { sessionID, source })
      return { status: "active" }
    }

    if (
      checkToolState
      && typeof client.session?.messages === "function"
      && await sessionLatestAssistantBlocksInternalPrompt({
        client,
        sessionID,
        input,
        sessionName,
        source,
        timeoutMs: Math.min(dispatchTimeoutMs, getPromptGateMessagesFetchTimeoutMs()),
      })
    ) {
      log(`[prompt-async-gate] ${sessionName} skipped because latest assistant is still active`, {
        sessionID,
        source,
      })
      return { status: "active" }
    }

    log(`[prompt-async-gate] ${sessionName} dispatching`, { sessionID, source })
    dispatchAttempted = true
    const response = await withDispatchTimeout(
      dispatch(input),
      dispatchTimeoutMs,
      `[prompt-async-gate] ${sessionName} dispatch`,
    )
    log(`[prompt-async-gate] ${sessionName} dispatched`, { sessionID, source })

    if (
      args.oneShotRetryForShapeMismatch
      && typeof response === "object"
      && response !== null
      && !Array.isArray(response)
    ) {
      const resp = response as Record<string, unknown>
      const hasErrorShape = typeof resp.error === "string" && resp.error.length > 0
      if (hasErrorShape && !resp.data && !resp.message && Object.keys(resp).length <= 3) {
        log(`[prompt-async-gate] ${sessionName} returned error-shaped response, retrying once`, {
          sessionID,
          source,
          responseError: resp.error,
        })
        const retryResponse = await withDispatchTimeout(
          dispatch(input),
          dispatchTimeoutMs,
          `[prompt-async-gate] ${sessionName} retry dispatch`,
        )
        return { status: "dispatched", response: retryResponse }
      }
    }

    return { status: "dispatched", response }
  } catch (error) {
    if (
      args.oneShotRetryForShapeMismatch
      && !retriedShapeMismatch
      && isPromptShapeMismatchError(error)
    ) {
      retriedShapeMismatch = true
      try {
        const retryInput = normalizePromptDispatchInput(input, sessionID)
        log(`[prompt-async-gate] ${sessionName} retrying once after shape mismatch`, {
          sessionID,
          source,
          error: String(error),
        })
        dispatchAttempted = true
        const retryResponse = await withDispatchTimeout(
          dispatch(retryInput),
          dispatchTimeoutMs,
          `[prompt-async-gate] ${sessionName} normalized retry dispatch`,
        )
        return { status: "dispatched", response: retryResponse }
      } catch (retryError) {
        log(`[prompt-async-gate] ${sessionName} normalized retry failed`, {
          sessionID,
          source,
          error: String(retryError),
        })
        return { status: "failed", error: retryError, dispatchAttempted: true }
      }
    }

    log(`[prompt-async-gate] ${sessionName} failed`, { sessionID, source, error: String(error) })
    return { status: "failed", error, dispatchAttempted }
  } finally {
    finishPromptReservation(sessionID, reservation, dispatchAttempted, postDispatchHoldMs)
  }
}
