import type { HecateqPromptProfile, HecateqModelAdaptersConfig } from "../../shared/hecateq-orchestrator-policy"

export type { HecateqPromptProfile }

export type ProfileDetectionInput = {
  prompt_profile?: HecateqPromptProfile
  model?: string
  provider?: string
  model_adapters?: HecateqModelAdaptersConfig
}

const EXACT_PROFILE_VALUES: ReadonlySet<string> = new Set([
  "generic",
  "gpt",
  "claude",
  "gemini",
  "qwen",
  "deepseek",
  "small-model",
])

export function normalizePromptProfile(raw: string | undefined): HecateqPromptProfile {
  if (!raw) return "auto"
  const trimmed = raw.trim().toLowerCase()
  if (EXACT_PROFILE_VALUES.has(trimmed)) return trimmed as HecateqPromptProfile
  return "auto"
}

type ProviderModelInfo = {
  providerLower: string
  modelLower: string
}

function parseProviderModelInfo(input: ProfileDetectionInput): ProviderModelInfo {
  const model = input.model ?? ""
  const explicitProvider = input.provider?.toLowerCase().trim() ?? ""
  const modelLower = model.toLowerCase().trim()

  if (explicitProvider) {
    return { providerLower: explicitProvider, modelLower }
  }

  const slashIdx = model.indexOf("/")
  if (slashIdx > 0) {
    return {
      providerLower: model.slice(0, slashIdx).toLowerCase().trim(),
      modelLower: model.slice(slashIdx + 1).toLowerCase().trim(),
    }
  }

  return { providerLower: "", modelLower }
}

function isSmallSignal(providerLower: string, modelLower: string): boolean {
  const smallTokens = [
    "mini", "nano", "tiny", "small", "lite", "flash",
    "haiku", "fast", "light", "micro",
  ]
  const combined = `${providerLower} ${modelLower}`
  return smallTokens.some((t) => combined.includes(t))
}

function detectByProvider(providerLower: string, modelLower: string): Exclude<HecateqPromptProfile, "auto"> | null {
  if (
    providerLower === "openai" ||
    providerLower === "github-copilot" ||
    providerLower === "codex" ||
    providerLower === "opencode" ||
    providerLower === "vercel" ||
    modelLower.includes("gpt-") ||
    modelLower.includes("o3") ||
    modelLower.includes("o4") ||
    modelLower.includes("chatgpt")
  ) {
    return "gpt"
  }

  if (
    providerLower === "anthropic" ||
    providerLower === "claude" ||
    modelLower.includes("claude") ||
    modelLower.includes("sonnet") ||
    modelLower.includes("opus") ||
    modelLower.includes("haiku")
  ) {
    return "claude"
  }

  if (
    providerLower === "google" ||
    providerLower === "gemini" ||
    modelLower.includes("gemini")
  ) {
    return "gemini"
  }

  if (
    providerLower === "qwen" ||
    providerLower === "dashscope" ||
    providerLower === "alibaba" ||
    modelLower.includes("qwen")
  ) {
    return "qwen"
  }

  if (
    providerLower === "deepseek" ||
    modelLower.includes("deepseek")
  ) {
    return "deepseek"
  }

  return null
}

export function detectHecateqPromptProfile(
  input: ProfileDetectionInput,
): Exclude<HecateqPromptProfile, "auto"> {
  const explicit = normalizePromptProfile(input.prompt_profile)
  if (explicit !== "auto") return explicit

  const { providerLower, modelLower } = parseProviderModelInfo(input)

  const providerMatch = detectByProvider(providerLower, modelLower)
  if (providerMatch) return providerMatch

  if (isSmallSignal(providerLower, modelLower)) return "small-model"

  const fallback = input.model_adapters?.fallback ?? "generic"
  return fallback
}
