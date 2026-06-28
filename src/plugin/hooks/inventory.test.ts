import { describe, expect, test } from "bun:test"
import { getHookInventory, type HookInventory } from "./inventory"

describe("getHookInventory", () => {
  test("returns live hook counts", () => {
    const inventory = getHookInventory()

    // Basic shape
    expect(inventory.session.count).toBeGreaterThan(0)
    expect(inventory.toolGuard.count).toBeGreaterThan(0)
    expect(inventory.transform.count).toBeGreaterThan(0)
    expect(inventory.continuation.count).toBeGreaterThan(0)
    expect(inventory.skill.count).toBeGreaterThan(0)
    expect(inventory.totalBase).toBeGreaterThan(0)
    expect(inventory.withTeamMode).toBeGreaterThan(inventory.totalBase)
  })

  test("session hooks match live count from create-session-hooks return object", () => {
    const inventory = getHookInventory()
    // The return object has 27 keys (24 upstream + 3 Hecateq additions)
    expect(inventory.session.count).toBe(27)
    expect(inventory.session.names).toContain("contextWindowMonitor")
    expect(inventory.session.names).toContain("runtimeFallback")
    expect(inventory.session.names).toContain("hecateqMemoryBootstrap")
    expect(inventory.session.names).toContain("hecateqProjectContextInjector")
    expect(inventory.session.names).toContain("preTaskMemorySeed")
  })

  test("tool guard hooks match live count from create-tool-guard-hooks return object", () => {
    const inventory = getHookInventory()
    // The return object has 19 keys (16 upstream + 3 Hecateq additions: notepadWriteGuard, planFormatValidator, memoryManifestUpdater)
    expect(inventory.toolGuard.count).toBe(19)
    expect(inventory.toolGuard.names).toContain("commentChecker")
    expect(inventory.toolGuard.names).toContain("writeExistingFileGuard")
    expect(inventory.toolGuard.names).toContain("notepadWriteGuard")
    expect(inventory.toolGuard.names).toContain("planFormatValidator")
    expect(inventory.toolGuard.names).toContain("memoryManifestUpdater")
  })

  test("transform hooks match live count from create-transform-hooks return object", () => {
    const inventory = getHookInventory()
    // The return object has 7 keys (5 base + 2 team-mode gated)
    expect(inventory.transform.count).toBe(7)
    expect(inventory.transform.names).toContain("claudeCodeHooks")
    expect(inventory.transform.names).toContain("keywordDetector")
    expect(inventory.transform.names).toContain("teamModeStatusInjector")
    expect(inventory.transform.names).toContain("teamMailboxInjector")
  })

  test("continuation hooks match live count", () => {
    const inventory = getHookInventory()
    expect(inventory.continuation.count).toBe(7)
    expect(inventory.continuation.names).toContain("todoContinuationEnforcer")
    expect(inventory.continuation.names).toContain("unstableAgentBabysitter")
    expect(inventory.continuation.names).toContain("atlasHook")
  })

  test("skill hooks match live count", () => {
    const inventory = getHookInventory()
    expect(inventory.skill.count).toBe(2)
    expect(inventory.skill.names).toContain("subagentSkillReminder")
    expect(inventory.skill.names).toContain("autoSlashCommand")
  })

  test("withTeamMode calculation is correct (60 base + 7 team-mode additions = 67 with Hecateq)", () => {
    const inventory = getHookInventory()
    // Hecateq fork adds 3 session hooks + 3 tool guard hooks = +6 over upstream 54.
    // Upstream base: 54. Hecateq base: 24+3 + 16+3 + 5 + 7 + 2 = 60.
    // Team mode adds: +1 toolGuard + 2 transform + 4 direct event = 7.
    // Total with team mode: 60 + 7 = 67.
    expect(inventory.withTeamMode).toBe(67)
  })

  test("inventory is idempotent", () => {
    const a = getHookInventory()
    const b = getHookInventory()
    expect(a).toEqual(b)
  })

  test("inventory has no duplicate hook names within each tier", () => {
    const inventory = getHookInventory()
    const tiers: { name: string; names: string[] }[] = [
      { name: "session", names: inventory.session.names },
      { name: "toolGuard", names: inventory.toolGuard.names },
      { name: "transform", names: inventory.transform.names },
      { name: "continuation", names: inventory.continuation.names },
      { name: "skill", names: inventory.skill.names },
    ]
    for (const tier of tiers) {
      const unique = new Set(tier.names)
      expect(unique.size).toBe(tier.names.length)
    }
  })
})
