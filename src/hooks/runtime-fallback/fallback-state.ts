import type { FallbackState, FallbackResult } from "./types"
import { HOOK_NAME } from "./constants"
import { log } from "../../shared/logger"
import type { RuntimeFallbackConfig } from "../../config"
import { parseModelString } from "../../tools/delegate-task/model-string-parser"

/**
 * OpenCode session events can carry the model as either a "provider/model"
 * string or a `{providerID, modelID}` object. Normalize both to a string
 * so the rest of the fallback chain never sees a raw object.
 */
export function normalizeModelValue(model: unknown): string | undefined {
  if (typeof model === "string") {
    const trimmed = model.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }

  if (model && typeof model === "object") {
    const m = model as Record<string, unknown>
    const providerID = typeof m.providerID === "string" ? m.providerID.trim() : ""
    const modelID = typeof m.modelID === "string" ? m.modelID.trim() : ""
    if (providerID && modelID) {
      return `${providerID}/${modelID}`
    }

    const id = typeof m.id === "string" ? m.id.trim() : ""
    if (id) return id
  }

  return undefined
}

function canonicalizeModelID(modelID: string): string {
  const loweredModelID = modelID.toLowerCase()
  const dottedModelID = loweredModelID.replace(/\./g, "-")

  if (
    dottedModelID.startsWith("claude-opus-") ||
    dottedModelID.startsWith("claude-sonnet-") ||
    dottedModelID.startsWith("claude-haiku-")
  ) {
    return dottedModelID
      .replace(/-thinking$/i, "")
      .replace(/-max$/i, "")
      .replace(/-high$/i, "")
  }

  return dottedModelID
}

function canonicalizeProviderFamily(providerID: string, modelID: string): string {
  const canonicalModelID = canonicalizeModelID(modelID)

  if (
    canonicalModelID.startsWith("claude-opus-") ||
    canonicalModelID.startsWith("claude-sonnet-") ||
    canonicalModelID.startsWith("claude-haiku-")
  ) {
    return "anthropic-compatible-claude"
  }

  return providerID.toLowerCase()
}

/**
 * Parse a model into canonical form. Accepts both a "provider/model" string
 * and a `{providerID, modelID}` object (normalized first via normalizeModelValue).
 */
function parseCanonicalModel(model: unknown): { providerID: string; modelID: string } | undefined {
  const modelStr = normalizeModelValue(model)
  if (!modelStr) return undefined

  const parsed = parseModelString(modelStr)
  if (!parsed?.providerID || !parsed.modelID) return undefined

  const canonicalModelID = canonicalizeModelID(parsed.modelID)
  const variant = parsed.variant?.toLowerCase()

  return {
    providerID: canonicalizeProviderFamily(parsed.providerID, parsed.modelID),
    modelID: variant ? `${canonicalModelID}::${variant}` : canonicalModelID,
  }
}

function isEquivalentModel(candidate: unknown, current: unknown): boolean {
  const parsedCandidate = parseCanonicalModel(candidate)
  const parsedCurrent = parseCanonicalModel(current)

  if (!parsedCandidate || !parsedCurrent) {
    // Fall back to string comparison when canonical parsing fails,
    // but normalize both sides first in case one is an object.
    const candidateStr = normalizeModelValue(candidate)
    const currentStr = normalizeModelValue(current)
    if (typeof candidateStr === "string" && typeof currentStr === "string") {
      return candidateStr.toLowerCase() === currentStr.toLowerCase()
    }
    return false
  }

  return (
    parsedCandidate.providerID === parsedCurrent.providerID &&
    parsedCandidate.modelID === parsedCurrent.modelID
  )
}

export function createFallbackState(originalModel: string): FallbackState {
  return {
    originalModel,
    currentModel: originalModel,
    fallbackIndex: -1,
    failedModels: new Map<string, number>(),
    attemptCount: 0,
    pendingFallbackModel: undefined,
  }
}

export function isModelInCooldown(model: string, state: FallbackState, cooldownSeconds: number): boolean {
  const failedAt = state.failedModels.get(model)
  if (failedAt === undefined) return false
  const cooldownMs = cooldownSeconds * 1000
  return Date.now() - failedAt < cooldownMs
}

export function findNextAvailableFallback(
  state: FallbackState,
  fallbackModels: string[],
  cooldownSeconds: number
): string | undefined {
  for (let i = state.fallbackIndex + 1; i < fallbackModels.length; i++) {
    const candidate = fallbackModels[i]
    if (isEquivalentModel(candidate, state.currentModel)) {
      log(`[${HOOK_NAME}] Skipping equivalent fallback model`, {
        model: candidate,
        currentModel: state.currentModel,
        index: i,
      })
      continue
    }

    if (!isModelInCooldown(candidate, state, cooldownSeconds)) {
      return candidate
    }
    log(`[${HOOK_NAME}] Skipping fallback model in cooldown`, { model: candidate, index: i })
  }
  return undefined
}

export function prepareFallback(
  sessionID: string,
  state: FallbackState,
  fallbackModels: string[],
  config: Required<RuntimeFallbackConfig>
): FallbackResult {
  if (state.attemptCount >= config.max_fallback_attempts) {
    log(`[${HOOK_NAME}] Max fallback attempts reached`, { sessionID, attempts: state.attemptCount })
    return { success: false, error: "Max fallback attempts reached", maxAttemptsReached: true }
  }

  const nextModel = findNextAvailableFallback(state, fallbackModels, config.cooldown_seconds)

  if (!nextModel) {
    log(`[${HOOK_NAME}] No available fallback models`, { sessionID })
    return { success: false, error: "No available fallback models (all in cooldown or exhausted)" }
  }

  log(`[${HOOK_NAME}] Preparing fallback`, {
    sessionID,
    from: state.currentModel,
    to: nextModel,
    attempt: state.attemptCount + 1,
  })

  const failedModel = state.currentModel
  const now = Date.now()

  state.fallbackIndex = fallbackModels.indexOf(nextModel)
  state.failedModels.set(failedModel, now)
  state.attemptCount++
  state.currentModel = nextModel
  state.pendingFallbackModel = nextModel

  return { success: true, newModel: nextModel }
}
