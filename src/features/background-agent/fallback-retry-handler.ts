import type { BackgroundTask, LaunchInput } from "./types"
import type { FallbackEntry } from "../../shared/model-requirements"
import type { ConcurrencyManager } from "./concurrency"
import type { OpencodeClient, QueueItem } from "./constants"
import { log, readConnectedProvidersCache, readProviderModelsCache } from "../../shared"
import {
  shouldRetryError,
  getNextFallback,
  hasMoreFallbacks,
  selectFallbackProvider,
} from "../../shared/model-error-classifier"
import { transformModelForProvider } from "../../shared/provider-model-id-transform"
import { abortWithTimeout } from "./abort-with-timeout"
import { ensureCurrentAttempt, scheduleRetryAttempt } from "./attempt-lifecycle"

/**
 * Minimum interval (ms) between retry attempts for the same task.
 * Prevents rapid-fire retry cycles when errors are transient but
 * the retry path is fast enough to loop in under a second.
 */
export const BACKGROUND_TASK_RETRY_DEBOUNCE_MS = 2_000

/**
 * Marker error message for retry budget exhaustion.
 * Assigned as the task error string when all fallback entries have been
 * tried without success, making it clear the failure is due to exhaustion
 * rather than a transient error.
 */
export const RETRY_BUDGET_EXHAUSTED_MSG = "retry budget exhausted: all fallback models failed"

export class TeamModeFallbackError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TeamModeFallbackError"
  }
}

function canonicalizeModelID(modelID: string): string {
  return modelID.toLowerCase().replace(/\./g, "-")
}

export type FallbackRetryHandlerDeps = {
  log: typeof log
  readProviderModelsCache: typeof readProviderModelsCache
  readConnectedProvidersCache: typeof readConnectedProvidersCache
  shouldRetryError: typeof shouldRetryError
  getNextFallback: typeof getNextFallback
  hasMoreFallbacks: typeof hasMoreFallbacks
  selectFallbackProvider: typeof selectFallbackProvider
  transformModelForProvider: typeof transformModelForProvider
}

const defaultFallbackRetryHandlerDeps: FallbackRetryHandlerDeps = {
  log,
  readProviderModelsCache,
  readConnectedProvidersCache,
  shouldRetryError,
  getNextFallback,
  hasMoreFallbacks,
  selectFallbackProvider,
  transformModelForProvider,
}

export async function tryFallbackRetry(args: {
  task: BackgroundTask
  errorInfo: { name?: string; message?: string; statusCode?: number }
  source: string
  concurrencyManager: ConcurrencyManager
  client: OpencodeClient
  idleDeferralTimers: Map<string, ReturnType<typeof setTimeout>>
  queuesByKey: Map<string, QueueItem[]>
  processKey: (key: string) => void
  onRetrying?: (details: {
    task: BackgroundTask
    source: string
    previousSessionID?: string
    failedModel?: string
    failedError?: string
    nextModel: string
  }) => void
  deps?: Partial<FallbackRetryHandlerDeps>
}): Promise<boolean> {
  const { task, errorInfo, source, concurrencyManager, client, idleDeferralTimers, queuesByKey, processKey, onRetrying } = args
  const deps = { ...defaultFallbackRetryHandlerDeps, ...args.deps }
  const fallbackChain = task.fallbackChain
  const canRetry =
    deps.shouldRetryError(errorInfo) &&
    fallbackChain &&
    fallbackChain.length > 0 &&
    deps.hasMoreFallbacks(fallbackChain, task.attemptCount ?? 0)

  if (!canRetry) {
    if (task.attemptCount !== undefined && task.attemptCount > 0) {
      deps.log("[background-agent] Retry budget exhausted for task:", {
        taskId: task.id,
        source,
        attemptCount: task.attemptCount,
        errorName: errorInfo.name,
        errorMessage: errorInfo.message?.slice(0, 200),
      })
    }
    return false
  }

  const now = Date.now()
  const lastRetryAt = task.lastRetryAttemptAt
  if (lastRetryAt !== undefined && now - lastRetryAt < BACKGROUND_TASK_RETRY_DEBOUNCE_MS) {
    deps.log("[background-agent] Skipping retry (debounce active):", {
      taskId: task.id,
      source,
      msSinceLastRetry: now - lastRetryAt,
      debounceMs: BACKGROUND_TASK_RETRY_DEBOUNCE_MS,
    })
    return false
  }

  const attemptCount = task.attemptCount ?? 0
  const providerModelsCache = deps.readProviderModelsCache()
  const connectedProviders = providerModelsCache?.connected ?? deps.readConnectedProvidersCache()
  const connectedSet = connectedProviders ? new Set(connectedProviders.map(p => p.toLowerCase())) : null

  const isReachable = (entry: FallbackEntry): boolean => {
    if (!connectedSet) return true
    return entry.providers.some((provider) => connectedSet.has(provider.toLowerCase()))
  }

  let selectedAttemptCount = attemptCount
  let nextFallback: FallbackEntry | undefined
  let nextProviderID: string | undefined
  while (fallbackChain && selectedAttemptCount < fallbackChain.length) {
    const candidate = deps.getNextFallback(fallbackChain, selectedAttemptCount)
    if (!candidate) break
    selectedAttemptCount++
    if (!isReachable(candidate)) {
      deps.log("[background-agent] Skipping unreachable fallback:", {
        taskId: task.id,
        source,
        model: candidate.model,
        providers: candidate.providers,
      })
      continue
    }
    const candidateProviderID = deps.selectFallbackProvider(
      candidate.providers,
      task.model?.providerID,
    )
    const candidateModelID = deps.transformModelForProvider(candidateProviderID, candidate.model)
    const isNoOpFallback =
      !!task.model &&
      candidateProviderID.toLowerCase() === task.model.providerID.toLowerCase() &&
      canonicalizeModelID(candidateModelID) === canonicalizeModelID(task.model.modelID)
    if (isNoOpFallback) {
      deps.log("[background-agent] Skipping no-op fallback:", {
        taskId: task.id,
        source,
        model: candidate.model,
        providers: candidate.providers,
      })
      continue
    }
    nextFallback = candidate
    nextProviderID = candidateProviderID
    break
  }
  if (!nextFallback) {
    deps.log("[background-agent] Retry budget exhausted: no reachable fallback remained:", {
      taskId: task.id,
      source,
      attemptCount: selectedAttemptCount,
    })
    return false
  }

  const providerID = nextProviderID ?? deps.selectFallbackProvider(
    nextFallback.providers,
    task.model?.providerID,
  )

  deps.log("[background-agent] Retryable error, attempting fallback:", {
    taskId: task.id,
    source,
    errorName: errorInfo.name,
    errorMessage: errorInfo.message?.slice(0, 100),
    attemptCount: selectedAttemptCount,
    nextModel: `${providerID}/${nextFallback.model}`,
  })

  if (task.concurrencyKey) {
    concurrencyManager.release(task.concurrencyKey)
    task.concurrencyKey = undefined
  }

  const idleTimer = idleDeferralTimers.get(task.id)
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleDeferralTimers.delete(task.id)
  }

  const previousSessionID = task.sessionId
  const previousModel = task.model

  const transformedModelId = deps.transformModelForProvider(providerID, nextFallback.model)
  const nextModel = {
    providerID,
    modelID: transformedModelId,
    variant: nextFallback.variant,
  }
  task.attemptCount = selectedAttemptCount
  task.lastRetryAttemptAt = Date.now()
  const failedAttemptID = ensureCurrentAttempt(task, previousModel).attemptId
  const nextAttempt = failedAttemptID
    ? scheduleRetryAttempt(task, failedAttemptID, nextModel, errorInfo.message)
    : undefined
  if (!nextAttempt) {
    return false
  }

  task.queuedAt = new Date()
  task.retryNotification = {
    previousSessionID,
    failedModel: previousModel ? `${previousModel.providerID}/${previousModel.modelID}` : undefined,
    failedError: errorInfo.message,
    nextModel: `${providerID}/${transformedModelId}`,
  }

  onRetrying?.({
    task,
    source,
    previousSessionID,
    failedModel: task.retryNotification.failedModel,
    failedError: errorInfo.message,
    nextModel: `${providerID}/${transformedModelId}`,
  })

  // Guard: a team-mode task (teamRunId set) MUST carry an onSessionCreated callback so
  // the fallback session gets registered in the team-session registry under the original
  // member slot. Without it the new session would not appear as a team participant and
  // every subsequent team tool call would throw "not in team". Fail with a bounded
  // structured error instead of silently entering that confusing runtime state.
  if (task.teamRunId && !task.onSessionCreated) {
    deps.log("[background-agent] team-mode fallback denied: task has teamRunId but no onSessionCreated; cannot preserve team membership", {
      taskId: task.id,
      teamRunId: task.teamRunId,
    })
    throw new TeamModeFallbackError(
      `team-mode fallback denied: cannot preserve team context for task ${task.id} (teamRunId=${task.teamRunId})`,
    )
  }

  const key = task.model ? `${task.model.providerID}/${task.model.modelID}` : task.agent
  const queue = queuesByKey.get(key) ?? []
  const retryInput: LaunchInput = {
    description: task.description,
    prompt: task.prompt,
    agent: task.agent,
    parentSessionId: task.parentSessionId,
    parentMessageId: task.parentMessageId,
    parentModel: task.parentModel,
    parentAgent: task.parentAgent,
    parentTools: task.parentTools,
    teamRunId: task.teamRunId,
    model: nextModel,
    fallbackChain: task.fallbackChain,
    skillContent: task.skillContent,
    sessionPermission: task.sessionPermission,
    category: task.category,
    isUnstableAgent: task.isUnstableAgent,
    onSessionCreated: task.onSessionCreated,
  }

  if (previousSessionID) {
    await abortWithTimeout(client, previousSessionID).catch(() => {})
  }

  queue.push({ task, input: retryInput, attemptID: nextAttempt.attemptId })
  queuesByKey.set(key, queue)
  processKey(key)
  return true
}
