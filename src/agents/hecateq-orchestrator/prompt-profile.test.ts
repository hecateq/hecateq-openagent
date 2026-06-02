import { describe, expect, it } from "bun:test"
import {
  detectHecateqPromptProfile,
  normalizePromptProfile,
} from "./prompt-profile"

describe("detectHecateqPromptProfile", () => {
  describe("#given explicit gpt profile", () => {
    it("#then wins over model=claude", () => {
      expect(
        detectHecateqPromptProfile({
          prompt_profile: "gpt",
          model: "anthropic/claude-sonnet",
        }),
      ).toBe("gpt")
    })
  })

  describe("#given explicit claude profile", () => {
    it("#then wins over model=gpt", () => {
      expect(
        detectHecateqPromptProfile({
          prompt_profile: "claude",
          model: "openai/gpt-5",
        }),
      ).toBe("claude")
    })
  })

  describe("#given explicit small-model profile", () => {
    it("#then wins over model=claude-sonnet", () => {
      expect(
        detectHecateqPromptProfile({
          prompt_profile: "small-model",
          model: "anthropic/claude-sonnet",
        }),
      ).toBe("small-model")
    })
  })

  describe("#given auto with OpenAI GPT model", () => {
    it("#then detects gpt from provider=openai", () => {
      expect(
        detectHecateqPromptProfile({
          prompt_profile: "auto",
          provider: "openai",
          model: "gpt-5",
        }),
      ).toBe("gpt")
    })

    it("#then detects gpt from model string provider/openai prefix", () => {
      expect(
        detectHecateqPromptProfile({
          prompt_profile: "auto",
          model: "openai/gpt-5.4",
        }),
      ).toBe("gpt")
    })

    it("#then detects gpt from gpt- prefix in model name", () => {
      expect(
        detectHecateqPromptProfile({
          prompt_profile: "auto",
          model: "gpt-5.4-mini",
        }),
      ).toBe("gpt")
    })
  })

  describe("#given auto with Codex model", () => {
    it("#then detects gpt from Codex model string", () => {
      expect(
        detectHecateqPromptProfile({
          prompt_profile: "auto",
          model: "opencode/gpt-5.1-codex",
        }),
      ).toBe("gpt")
    })

    it("#then detects gpt from codex provider", () => {
      expect(
        detectHecateqPromptProfile({
          prompt_profile: "auto",
          provider: "codex",
          model: "gpt-5.4",
        }),
      ).toBe("gpt")
    })
  })

  describe("#given auto with o3/o4 models", () => {
    it("#then detects gpt from o3 model", () => {
      expect(
        detectHecateqPromptProfile({
          prompt_profile: "auto",
          model: "openai/o3",
        }),
      ).toBe("gpt")
    })

    it("#then detects gpt from o4 model", () => {
      expect(
        detectHecateqPromptProfile({
          prompt_profile: "auto",
          model: "openai/o4-mini",
        }),
      ).toBe("gpt")
    })
  })

  describe("#given auto with Anthropic Claude model", () => {
    it("#then detects claude from provider=anthropic", () => {
      expect(
        detectHecateqPromptProfile({
          prompt_profile: "auto",
          provider: "anthropic",
          model: "claude-sonnet",
        }),
      ).toBe("claude")
    })

    it("#then detects claude from model string", () => {
      expect(
        detectHecateqPromptProfile({
          prompt_profile: "auto",
          model: "anthropic/claude-opus-4-7",
        }),
      ).toBe("claude")
    })

    it("#then detects claude from claude substring in model name", () => {
      expect(
        detectHecateqPromptProfile({
          prompt_profile: "auto",
          model: "claude-sonnet-4-6",
        }),
      ).toBe("claude")
    })

    it("#then detects claude from sonnet substring", () => {
      expect(
        detectHecateqPromptProfile({
          prompt_profile: "auto",
          model: "some-provider/sonnet-v2",
        }),
      ).toBe("claude")
    })

    it("#then detects claude from opus substring", () => {
      expect(
        detectHecateqPromptProfile({
          prompt_profile: "auto",
          model: "some-provider/opus-v1",
        }),
      ).toBe("claude")
    })
  })

  describe("#given auto with Google Gemini model", () => {
    it("#then detects gemini from provider=google", () => {
      expect(
        detectHecateqPromptProfile({
          prompt_profile: "auto",
          provider: "google",
          model: "gemini-pro",
        }),
      ).toBe("gemini")
    })

    it("#then detects gemini from model string", () => {
      expect(
        detectHecateqPromptProfile({
          prompt_profile: "auto",
          model: "google/gemini-2.0-flash",
        }),
      ).toBe("gemini")
    })

    it("#then detects gemini from gemini substring", () => {
      expect(
        detectHecateqPromptProfile({
          prompt_profile: "auto",
          model: "gemini-3.1-pro",
        }),
      ).toBe("gemini")
    })
  })

  describe("#given auto with Qwen model", () => {
    it("#then detects qwen from provider=dashscope", () => {
      expect(
        detectHecateqPromptProfile({
          prompt_profile: "auto",
          provider: "dashscope",
          model: "qwen-plus",
        }),
      ).toBe("qwen")
    })

    it("#then detects qwen from provider=alibaba", () => {
      expect(
        detectHecateqPromptProfile({
          prompt_profile: "auto",
          provider: "alibaba",
          model: "qwen-max",
        }),
      ).toBe("qwen")
    })

    it("#then detects qwen from qwen substring", () => {
      expect(
        detectHecateqPromptProfile({
          prompt_profile: "auto",
          model: "qwen3.5-plus",
        }),
      ).toBe("qwen")
    })
  })

  describe("#given auto with DeepSeek model", () => {
    it("#then detects deepseek from provider=deepseek", () => {
      expect(
        detectHecateqPromptProfile({
          prompt_profile: "auto",
          provider: "deepseek",
          model: "deepseek-coder",
        }),
      ).toBe("deepseek")
    })

    it("#then detects deepseek from deepseek substring", () => {
      expect(
        detectHecateqPromptProfile({
          prompt_profile: "auto",
          model: "deepseek-r1",
        }),
      ).toBe("deepseek")
    })
  })

  describe("#given auto with unknown model", () => {
    it("#then falls back to generic", () => {
      expect(
        detectHecateqPromptProfile({
          prompt_profile: "auto",
          provider: "unknown",
          model: "random-model",
        }),
      ).toBe("generic")
    })
  })

  describe("#given auto with unknown model and custom fallback", () => {
    it("#then uses configured fallback", () => {
      expect(
        detectHecateqPromptProfile({
          prompt_profile: "auto",
          provider: "unknown",
          model: "random-model",
          model_adapters: { fallback: "claude" },
        }),
      ).toBe("claude")
    })
  })

  describe("#given known provider with small model signal", () => {
    it("#then provider beats small signal (anthropic haiku → claude)", () => {
      expect(
        detectHecateqPromptProfile({
          prompt_profile: "auto",
          provider: "anthropic",
          model: "claude-haiku-4-5",
        }),
      ).toBe("claude")
    })
  })

  describe("#given unknown provider with small model signal", () => {
    it("#then small-model detected from nano/mini tokens", () => {
      expect(
        detectHecateqPromptProfile({
          prompt_profile: "auto",
          provider: "unknown",
          model: "some-nano-model",
        }),
      ).toBe("small-model")
    })

    it("#then small-model detected from mini token", () => {
      expect(
        detectHecateqPromptProfile({
          prompt_profile: "auto",
          model: "gpt-5-mini",
        }),
      ).toBe("gpt")
    })

    it("#then small-model detected from flash token with unknown provider", () => {
      expect(
        detectHecateqPromptProfile({
          prompt_profile: "auto",
          provider: "unknown",
          model: "flash-model-v1",
        }),
      ).toBe("small-model")
    })
  })

  describe("#given github-copilot provider", () => {
    it("#then detects gpt", () => {
      expect(
        detectHecateqPromptProfile({
          prompt_profile: "auto",
          provider: "github-copilot",
          model: "some-copilot-model",
        }),
      ).toBe("gpt")
    })
  })

  describe("#given vercel provider", () => {
    it("#then detects gpt", () => {
      expect(
        detectHecateqPromptProfile({
          prompt_profile: "auto",
          provider: "vercel",
          model: "some-model",
        }),
      ).toBe("gpt")
    })
  })

  describe("#given empty inputs", () => {
    it("#then falls back to generic", () => {
      expect(
        detectHecateqPromptProfile({
          prompt_profile: "auto",
          model: "",
          provider: "",
        }),
      ).toBe("generic")
    })
  })
})

describe("normalizePromptProfile", () => {
  describe("#given valid explicit profile", () => {
    it("#then returns same profile", () => {
      expect(normalizePromptProfile("gpt")).toBe("gpt")
      expect(normalizePromptProfile("claude")).toBe("claude")
      expect(normalizePromptProfile("gemini")).toBe("gemini")
      expect(normalizePromptProfile("qwen")).toBe("qwen")
      expect(normalizePromptProfile("deepseek")).toBe("deepseek")
      expect(normalizePromptProfile("small-model")).toBe("small-model")
      expect(normalizePromptProfile("generic")).toBe("generic")
    })
  })

  describe("#given 'auto'", () => {
    it("#then returns auto", () => {
      expect(normalizePromptProfile("auto")).toBe("auto")
    })
  })

  describe("#given undefined", () => {
    it("#then returns auto", () => {
      expect(normalizePromptProfile(undefined)).toBe("auto")
    })
  })

  describe("#given invalid value", () => {
    it("#then returns auto", () => {
      expect(normalizePromptProfile("invalid")).toBe("auto")
      expect(normalizePromptProfile("")).toBe("auto")
    })
  })

  describe("#given uppercase input", () => {
    it("#then normalizes to lowercase", () => {
      expect(normalizePromptProfile("GPT")).toBe("gpt")
      expect(normalizePromptProfile("Claude")).toBe("claude")
    })
  })
})
