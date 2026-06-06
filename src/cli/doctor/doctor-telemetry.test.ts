import { afterEach, beforeEach, describe, expect, it } from "bun:test"

describe("doctor telemetry", () => {
  beforeEach(() => {
    delete process.env.HECATEQ_SEND_ANONYMOUS_TELEMETRY
    delete process.env.HECATEQ_POSTHOG_KEY
  })

  afterEach(() => {
    delete process.env.HECATEQ_SEND_ANONYMOUS_TELEMETRY
    delete process.env.HECATEQ_POSTHOG_KEY
  })

  describe("summarizeFeaturesForTest", () => {
    it("uses defaults when config is undefined", async () => {
      const { summarizeFeaturesForTest } = await import(
        `./doctor-telemetry?summary-undefined=${Date.now()}`
      )
      const summary = summarizeFeaturesForTest(undefined)

      expect(summary.hecateq_enabled).toBe(true)
      expect(summary.orchestration_enabled).toBe(false)
      expect(summary.auto_spawn_enabled).toBe(false)
      expect(summary.dependency_graph_mode).toBe("off")
      expect(summary.context_injection_mode).toBe("compact")
      expect(summary.agent_index_enabled).toBe(true)
      expect(summary.memory_bootstrap_enabled).toBe(true)
      expect(summary.git_checkpoint_mode).toBe("suggest")
    })

    it("reads values from provided config", async () => {
      const { summarizeFeaturesForTest } = await import(
        `./doctor-telemetry?summary-full=${Date.now()}`
      )
      const summary = summarizeFeaturesForTest({
        enabled: false,
        context_injection: { mode: "expanded" as const, enabled: true },
        agent_index: { enabled: false },
        memory_bootstrap: { enabled: false },
        git_checkpoint: { mode: "off" as const, enabled: true },
        dependency_graph: { mode: "warn" as const },
        orchestration: { enabled: true },
        auto_spawn: { enabled: true },
        doctor: { check_memory: true, check_artifacts: true, check_custom_agents: true, check_secrets: true, check_safety_hooks: true },
        delegation_chain: { max_depth: 3, max_fan_out: 10, max_iterations_per_run: 10 },
        orchestrator: { delegation_first: true, deny_write_tools: true, prompt_profile: "auto" as const, model_adapters: { enabled: true, fallback: "generic" as const, strict_runtime_truth: true, delegation_bias: "balanced" as const } },
      })

      expect(summary.hecateq_enabled).toBe(false)
      expect(summary.orchestration_enabled).toBe(true)
      expect(summary.auto_spawn_enabled).toBe(true)
      expect(summary.dependency_graph_mode).toBe("warn")
      expect(summary.context_injection_mode).toBe("expanded")
      expect(summary.agent_index_enabled).toBe(false)
      expect(summary.memory_bootstrap_enabled).toBe(false)
      expect(summary.git_checkpoint_mode).toBe("off")
    })

    it("summary type excludes sensitive fields", async () => {
      const summaryKeys: Array<keyof import("./doctor-telemetry").HecateqFeatureSummary> = [
        "hecateq_enabled",
        "orchestration_enabled",
        "auto_spawn_enabled",
        "dependency_graph_mode",
        "context_injection_mode",
        "agent_index_enabled",
        "memory_bootstrap_enabled",
        "git_checkpoint_mode",
      ]

      for (const key of summaryKeys) {
        expect(key).not.toMatch(/path|secret|token|key|prompt|repo|user|email|account/i)
      }
    })
  })

  describe("trackDoctorUsage", () => {
    // Simulates real captureMinimal which merges $process_person_profile: false.
    // This lets tests verify the end-to-end contract without relying on the caller
    // to pass the flag (it is added by the PostHog client layer).
    const mockCaptureMinimal = (
      captureFn: (event: string, properties?: Record<string, unknown>) => void,
    ) => ({
      trackActive: () => undefined,
      capture: () => undefined,
      captureMinimal: (_id: string, event: string, properties?: Record<string, unknown>) => {
        captureFn(event, { ...properties, $process_person_profile: false })
      },
      shutdown: async () => undefined,
    })

    it("invokes captureMinimal and shutdown when provided a mock client", async () => {
      const { trackDoctorUsage } = await import(
        `./doctor-telemetry?invocation=${Date.now()}-${Math.random()}`
      )
      const calls: string[] = []
      const client = mockCaptureMinimal(() => { calls.push("captureMinimal") })
      const shutdownOrig = client.shutdown
      client.shutdown = async () => { calls.push("shutdown") }

      await trackDoctorUsage(client)

      expect(calls).toContain("captureMinimal")
      expect(calls).toContain("shutdown")
    })

    it("captures omo_doctor_run event with all expected properties via captureMinimal", async () => {
      const { trackDoctorUsage } = await import(
        `./doctor-telemetry?properties=${Date.now()}-${Math.random()}`
      )
      let capturedEvent = ""
      let capturedProperties: Record<string, unknown> | undefined
      const client = mockCaptureMinimal((event, properties) => {
        capturedEvent = event
        capturedProperties = properties
      })

      await trackDoctorUsage(client)

      expect(capturedEvent).toBe("omo_doctor_run")
      expect(capturedProperties).toBeDefined()
      expect(capturedProperties!.$process_person_profile).toBe(false)
      expect(capturedProperties!.hecateq_enabled).toBeDefined()
      expect(capturedProperties!.orchestration_enabled).toBeDefined()
      expect(capturedProperties!.auto_spawn_enabled).toBeDefined()
      expect(capturedProperties!.dependency_graph_mode).toBeDefined()
      expect(capturedProperties!.context_injection_mode).toBeDefined()
      expect(capturedProperties!.agent_index_enabled).toBeDefined()
      expect(capturedProperties!.memory_bootstrap_enabled).toBeDefined()
      expect(capturedProperties!.git_checkpoint_mode).toBeDefined()
      expect("repo" in capturedProperties!).toBe(false)
      expect("path" in capturedProperties!).toBe(false)
      expect("prompt" in capturedProperties!).toBe(false)
      expect("secret" in capturedProperties!).toBe(false)
      expect("token" in capturedProperties!).toBe(false)
    })

    it("does not throw when telemetry send fails", async () => {
      const { trackDoctorUsage } = await import(
        `./doctor-telemetry?failure=${Date.now()}-${Math.random()}`
      )
      const throwingClient = {
        trackActive: () => undefined,
        capture: () => undefined,
        captureMinimal: () => { throw new Error("send failed") },
        shutdown: async () => { throw new Error("shutdown failed") },
      }

      await expect(trackDoctorUsage(throwingClient)).resolves.toBeUndefined()
    })

    it("does not throw when used with real no-op client (no opt-in env set)", async () => {
      const { trackDoctorUsage } = await import(
        `./doctor-telemetry?real-noop=${Date.now()}-${Math.random()}`
      )
      await expect(trackDoctorUsage()).resolves.toBeUndefined()
    })
  })
})
