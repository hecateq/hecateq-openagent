import { describe, it, expect } from "bun:test"
import { loadRuntimeAgentInventory } from "./hecateq-runtime-inventory"

describe("hecateq runtime inventory", () => {
  it("returns ids and byId with at least builtin agents", () => {
    // given: a temp project root (runtime sources are env-based; builtins are fixed)
    const inventory = loadRuntimeAgentInventory(process.cwd())

    // then: inventory exposes ids and byId
    expect(inventory.ids).toBeInstanceOf(Set)
    expect(inventory.byId).toBeInstanceOf(Map)
    expect(inventory.ids.size).toBeGreaterThanOrEqual(2)

    // then: builtins are tagged isSystem with source builtin
    const explore = inventory.byId.get("explore")
    expect(explore?.source).toBe("builtin")
    expect(explore?.isSystem).toBe(true)
  })
})
