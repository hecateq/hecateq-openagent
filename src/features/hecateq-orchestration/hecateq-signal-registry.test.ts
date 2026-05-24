import { describe, expect, test } from "bun:test"

import {
  KNOWN_SIGNALS,
  getSignalDefinition,
  getSignalsEmittedBy,
  getSignalsConsumedBy,
  getAllSignalNames,
  isKnownSignal,
  type HecateqSignalDefinition,
} from "./signal-registry"

// ─── Describe ───────────────────────────────────────────────────────────────────

describe("hecateq-signal-registry", () => {
  // ─── Registry structure ──────────────────────────────────────────────────

  describe("KNOWN_SIGNALS", () => {
    test("#given registry #then contains all 9 DAG orchestration signals", () => {
      const names = KNOWN_SIGNALS.map((s) => s.signal)
      expect(names).toContain("schema_ready")
      expect(names).toContain("backend_ready")
      expect(names).toContain("ui_specs_ready")
      expect(names).toContain("auth_audit_passed")
      expect(names).toContain("infra_provisioned")
      expect(names).toContain("pipeline_secured")
      expect(names).toContain("tests_passed")
      expect(names).toContain("performance_verified")
      expect(names).toContain("compliance_signed")
      expect(KNOWN_SIGNALS.length).toBe(9)
    })

    test("#given each signal #then has all required fields", () => {
      for (const signal of KNOWN_SIGNALS) {
        expect(typeof signal.signal).toBe("string")
        expect(signal.signal.length).toBeGreaterThan(0)
        expect(typeof signal.description).toBe("string")
        expect(signal.description.length).toBeGreaterThan(0)
        expect(Array.isArray(signal.emittedBy)).toBe(true)
        expect(signal.emittedBy.length).toBeGreaterThan(0)
        expect(Array.isArray(signal.consumedBy)).toBe(true)
        expect(signal.consumedBy.length).toBeGreaterThan(0)
        expect(["infrastructure", "development", "quality", "deployment", "compliance"]).toContain(signal.category)
      }
    })

    test("#given all signals #then each has unique signal name", () => {
      const names = KNOWN_SIGNALS.map((s) => s.signal)
      expect(new Set(names).size).toBe(names.length)
    })

    test("#given all signals #then each uses snake_case naming convention", () => {
      for (const signal of KNOWN_SIGNALS) {
        expect(signal.signal).toMatch(/^[a-z][a-z0-9_]*$/)
      }
    })

    test("#given each signal #then emittedBy references the canonical emitter agent", () => {
      const allEmitters = KNOWN_SIGNALS.flatMap((s) => s.emittedBy)
      expect(allEmitters).toContain("database-specialist")
      expect(allEmitters).toContain("nodejs-backend-developer")
      expect(allEmitters).toContain("design-translator")
      expect(allEmitters).toContain("security-architect")
      expect(allEmitters).toContain("coolify-devops-specialist")
      expect(allEmitters).toContain("devsecops-pipeline-architect")
      expect(allEmitters).toContain("qa-test-engineer")
      expect(allEmitters).toContain("performance-specialist")
      expect(allEmitters).toContain("compliance-specialist")
    })
  })

  // ─── isKnownSignal ───────────────────────────────────────────────────────

  describe("isKnownSignal", () => {
    test("#given known signal ID #then returns true", () => {
      expect(isKnownSignal("schema_ready")).toBe(true)
      expect(isKnownSignal("tests_passed")).toBe(true)
      expect(isKnownSignal("compliance_signed")).toBe(true)
      expect(isKnownSignal("pipeline_secured")).toBe(true)
      expect(isKnownSignal("infra_provisioned")).toBe(true)
    })

    test("#given unknown signal ID #then returns false", () => {
      expect(isKnownSignal("unknown_signal")).toBe(false)
      expect(isKnownSignal("task_completed")).toBe(false)
      expect(isKnownSignal("")).toBe(false)
    })

    test("#given signal ID with wrong casing #then returns false", () => {
      expect(isKnownSignal("SCHEMA_READY")).toBe(false)
      expect(isKnownSignal("Schema_Ready")).toBe(false)
    })

    test("#given signal ID with extra whitespace #then returns false", () => {
      expect(isKnownSignal(" schema_ready")).toBe(false)
      expect(isKnownSignal("tests_passed ")).toBe(false)
    })
  })

  // ─── getSignalDefinition ─────────────────────────────────────────────────

  describe("getSignalDefinition", () => {
    test("#given known signal #then returns definition with all fields", () => {
      const def = getSignalDefinition("backend_ready")
      expect(def).toBeDefined()
      expect(def!.signal).toBe("backend_ready")
      expect(def!.description.length).toBeGreaterThan(0)
      expect(def!.emittedBy).toContain("nodejs-backend-developer")
      expect(def!.consumedBy.length).toBeGreaterThan(0)
      expect(def!.category).toBe("development")
    })

    test("#given unknown signal #then returns undefined", () => {
      expect(getSignalDefinition("nobody_knows_this")).toBeUndefined()
    })
  })

  // ─── getSignalsEmittedBy ─────────────────────────────────────────────────

  describe("getSignalsEmittedBy", () => {
    test("#given agent that emits a signal #then returns that signal", () => {
      const signals = getSignalsEmittedBy("database-specialist")
      expect(signals.length).toBeGreaterThanOrEqual(1)
      expect(signals.some((s) => s.signal === "schema_ready")).toBe(true)
    })

    test("#given agent that emits nothing #then returns empty array", () => {
      const signals = getSignalsEmittedBy("non-existent-agent")
      expect(signals).toEqual([])
    })
  })

  // ─── getSignalsConsumedBy ────────────────────────────────────────────────

  describe("getSignalsConsumedBy", () => {
    test("#given agent that consumes signals #then returns those signals", () => {
      const signals = getSignalsConsumedBy("release-manager")
      expect(signals.length).toBeGreaterThanOrEqual(4)
      expect(signals.some((s) => s.signal === "tests_passed")).toBe(true)
    })

    test("#given agent that consumes nothing #then returns empty array", () => {
      expect(getSignalsConsumedBy("nobody")).toEqual([])
    })
  })

  // ─── getAllSignalNames ───────────────────────────────────────────────────

  describe("getAllSignalNames", () => {
    test("#given registry #then returns all 9 names", () => {
      const names = getAllSignalNames()
      expect(names).toHaveLength(9)
      expect(names).toContain("schema_ready")
      expect(names).toContain("compliance_signed")
    })

    test("#given registry #then names are unique", () => {
      const names = getAllSignalNames()
      expect(new Set(names).size).toBe(names.length)
    })
  })
})
