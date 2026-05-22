import { describe, expect, it } from "bun:test"
import type { OhMyOpenCodeConfig } from "../../config"
import type { ModelCacheState } from "../../plugin-state"
import type { PluginContext } from "../types"
import { createSessionHooks } from "./create-session-hooks"
import { unsafeTestValue } from "../../../test-support/unsafe-test-value"

const mockContext = unsafeTestValue<PluginContext>({
  directory: "/tmp",
  client: {
    tui: {
      showToast: async () => ({}),
    },
    session: {
      get: async () => ({ data: null }),
      update: async () => ({}),
    },
  },
})

const mockModelCacheState = {} as ModelCacheState

describe("createSessionHooks", () => {
  it("keeps model fallback disabled when config is unset", () => {
    // given
    const pluginConfig = {} as OhMyOpenCodeConfig

    // when
    const result = createSessionHooks({
      ctx: mockContext,
      pluginConfig,
      modelCacheState: mockModelCacheState,
      isHookEnabled: (hookName) => hookName === "model-fallback",
      safeHookEnabled: true,
    })

    // then
    expect(result.modelFallback).toBeNull()
  })

  it("creates model fallback hook when config explicitly enables it", () => {
    // given
    const pluginConfig = { model_fallback: true } as OhMyOpenCodeConfig

    // when
    const result = createSessionHooks({
      ctx: mockContext,
      pluginConfig,
      modelCacheState: mockModelCacheState,
      isHookEnabled: (hookName) => hookName === "model-fallback",
      safeHookEnabled: true,
    })

    // then
    expect(result.modelFallback).not.toBeNull()
  })

  it("skips interactive bash session hook when tmux integration is disabled", () => {
    // given
    const pluginConfig = {
      tmux: {
        enabled: false,
        layout: "main-vertical",
        main_pane_size: 60,
        main_pane_min_width: 120,
        agent_pane_min_width: 40,
        isolation: "inline",
      },
    } as OhMyOpenCodeConfig

    // when
    const result = createSessionHooks({
      ctx: mockContext,
      pluginConfig,
      modelCacheState: mockModelCacheState,
      isHookEnabled: (hookName) => hookName === "interactive-bash-session",
      safeHookEnabled: true,
    })

    // then
    expect(result.interactiveBashSession).toBeNull()
  })

  it("creates hecateq memory bootstrap hook when enabled", () => {
    // given
    const pluginConfig = {} as OhMyOpenCodeConfig

    // when
    const result = createSessionHooks({
      ctx: mockContext,
      pluginConfig,
      modelCacheState: mockModelCacheState,
      isHookEnabled: (hookName) => hookName === "hecateq-memory-bootstrap",
      safeHookEnabled: true,
    })

    // then
    expect(result.hecateqMemoryBootstrap).not.toBeNull()
  })

  it("does not register hecateq memory bootstrap hook when disabled", () => {
    // given
    const pluginConfig = {} as OhMyOpenCodeConfig

    // when
    const result = createSessionHooks({
      ctx: mockContext,
      pluginConfig,
      modelCacheState: mockModelCacheState,
      isHookEnabled: () => false,
      safeHookEnabled: true,
    })

    // then
    expect(result.hecateqMemoryBootstrap).toBeNull()
  })

  it("creates hecateq project context injector hook when enabled", () => {
    // given
    const pluginConfig = {} as OhMyOpenCodeConfig

    // when
    const result = createSessionHooks({
      ctx: mockContext,
      pluginConfig,
      modelCacheState: mockModelCacheState,
      isHookEnabled: (hookName) => hookName === "hecateq-project-context-injector",
      safeHookEnabled: true,
    })

    // then
    expect(result.hecateqProjectContextInjector).not.toBeNull()
  })

  it("does not register hecateq project context injector hook when disabled", () => {
    // given
    const pluginConfig = {} as OhMyOpenCodeConfig

    // when
    const result = createSessionHooks({
      ctx: mockContext,
      pluginConfig,
      modelCacheState: mockModelCacheState,
      isHookEnabled: () => false,
      safeHookEnabled: true,
    })

    // then
    expect(result.hecateqProjectContextInjector).toBeNull()
  })
})
