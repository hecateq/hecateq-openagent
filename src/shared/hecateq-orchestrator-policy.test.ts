/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import {
  isDelegationFirst,
  shouldDenyWriteTools,
  maySelfImplement,
  type HecateqOrchestratorConfig,
  type HecateqTaskClassification,
} from "./hecateq-orchestrator-policy"

describe("isDelegationFirst", () => {
  describe("#given undefined config", () => {
    test("#then returns true (default)", () => {
      expect(isDelegationFirst(undefined)).toBe(true)
    })
  })

  describe("#given empty config", () => {
    test("#then returns true (default)", () => {
      expect(isDelegationFirst({})).toBe(true)
    })
  })

  describe("#given config with delegation_first: true", () => {
    test("#then returns true", () => {
      const config: HecateqOrchestratorConfig = { delegation_first: true }
      expect(isDelegationFirst(config)).toBe(true)
    })
  })

  describe("#given config with delegation_first: false", () => {
    test("#then returns false", () => {
      const config: HecateqOrchestratorConfig = { delegation_first: false }
      expect(isDelegationFirst(config)).toBe(false)
    })
  })
})

describe("shouldDenyWriteTools", () => {
  describe("#given undefined config", () => {
    test("#then returns true (default)", () => {
      expect(shouldDenyWriteTools(undefined)).toBe(true)
    })
  })

  describe("#given delegation_first: false", () => {
    test("#then returns false even when deny_write_tools is true", () => {
      const config: HecateqOrchestratorConfig = {
        delegation_first: false,
        deny_write_tools: true,
      }
      expect(shouldDenyWriteTools(config)).toBe(false)
    })
  })

  describe("#given delegation_first: true and deny_write_tools: true", () => {
    test("#then returns true", () => {
      const config: HecateqOrchestratorConfig = {
        delegation_first: true,
        deny_write_tools: true,
      }
      expect(shouldDenyWriteTools(config)).toBe(true)
    })
  })

  describe("#given delegation_first: true and deny_write_tools: false", () => {
    test("#then returns false", () => {
      const config: HecateqOrchestratorConfig = {
        delegation_first: true,
        deny_write_tools: false,
      }
      expect(shouldDenyWriteTools(config)).toBe(false)
    })
  })
})

describe("maySelfImplement", () => {
  const baseTask: HecateqTaskClassification = {
    fileCount: 1,
    affectsArchitecture: false,
    affectsDomainLogic: false,
    specialistExists: false,
    isHighRisk: false,
  }

  describe("#given delegation_first is false (legacy mode)", () => {
    const config: HecateqOrchestratorConfig = { delegation_first: false }

    test("#then may self-implement for any task", () => {
      const task: HecateqTaskClassification = {
        ...baseTask,
        fileCount: 10,
        affectsArchitecture: true,
        isHighRisk: true,
      }
      expect(maySelfImplement(config, task)).toBe(true)
    })
  })

  describe("#given delegation_first is true (default)", () => {
    const config: HecateqOrchestratorConfig = { delegation_first: true }

    test("#then may self-implement for tiny low-risk single-file change without specialist", () => {
      expect(maySelfImplement(config, baseTask)).toBe(true)
    })

    test("#then may NOT self-implement when fileCount > 1", () => {
      const task: HecateqTaskClassification = { ...baseTask, fileCount: 2 }
      expect(maySelfImplement(config, task)).toBe(false)
    })

    test("#then may NOT self-implement when architecture is affected", () => {
      const task: HecateqTaskClassification = { ...baseTask, affectsArchitecture: true }
      expect(maySelfImplement(config, task)).toBe(false)
    })

    test("#then may NOT self-implement when domain logic is affected", () => {
      const task: HecateqTaskClassification = { ...baseTask, affectsDomainLogic: true }
      expect(maySelfImplement(config, task)).toBe(false)
    })

    test("#then may NOT self-implement when task is high risk", () => {
      const task: HecateqTaskClassification = { ...baseTask, isHighRisk: true }
      expect(maySelfImplement(config, task)).toBe(false)
    })

    test("#then may NOT self-implement when a specialist exists", () => {
      const task: HecateqTaskClassification = { ...baseTask, specialistExists: true }
      expect(maySelfImplement(config, task)).toBe(false)
    })
  })
})
