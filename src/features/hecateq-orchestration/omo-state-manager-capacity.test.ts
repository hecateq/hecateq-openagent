import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { OmoStateManager } from "./omo-state-manager"
import { HECATEQ_DELEGATION_PENDING_MAX } from "./types"
import type { HecateqPendingDelegation } from "./types"

const tempDirs: string[] = []

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "omo-capacity-"))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function createPendingDelegation(id: string, status: "pending" | "consumed" | "skipped" = "pending"): HecateqPendingDelegation {
  return {
    id,
    targetAgent: "sisyphus",
    prompt: "Test prompt for " + id,
    createdAt: new Date().toISOString(),
    status,
    routingDepth: 0,
  }
}

describe("recordPendingDelegation — capacity enforcement", () => {
  // given: a state manager with fresh state

  test("#given capacity full with all terminal entries #then terminal entries pruned before rejecting", () => {
    const dir = createTempDir()
    const mgr = new OmoStateManager(dir)

    // Fill capacity with terminal (consumed) entries
    for (let i = 0; i < HECATEQ_DELEGATION_PENDING_MAX; i++) {
      mgr.recordPendingDelegation(createPendingDelegation(`terminal_${i}`, "consumed"))
    }

    // when: add a new pending entry
    const result = mgr.recordPendingDelegation(createPendingDelegation("new_pending_1"))

    // then: it succeeds because terminal entries were pruned
    expect(result).not.toBeNull()
    const state = mgr.read()
    // Terminal entries were pruned, leaving room for the new entry
    const pendingCount = state?.delegation?.pending?.length ?? 0
    expect(pendingCount).toBeLessThanOrEqual(HECATEQ_DELEGATION_PENDING_MAX)
  })

  test("#given capacity at max with all pending #then 21st entry is REJECTED", () => {
    const dir = createTempDir()
    const mgr = new OmoStateManager(dir)

    // Fill to capacity with ALL pending entries
    for (let i = 0; i < HECATEQ_DELEGATION_PENDING_MAX; i++) {
      mgr.recordPendingDelegation(createPendingDelegation(`pending_${i}`))
    }

    // when: 21st entry
    const result = mgr.recordPendingDelegation(createPendingDelegation("overflow_entry"))

    // then: returned null (rejection)
    // Note: the function returns the state on success, null on rejection.
    // But also null on write failure. We check capacityRejectedTotal for rejection.
    const state = mgr.read()
    expect(state?.delegation?.pendingCapacityRejectedTotal).toBeGreaterThanOrEqual(1)
    expect(state?.delegation?.lastOverflowIncidentAt).toBeTruthy()
  })

  test("#given overflow #then pendingCapacityRejectedTotal increments", () => {
    const dir = createTempDir()
    const mgr = new OmoStateManager(dir)

    // Fill capacity
    for (let i = 0; i < HECATEQ_DELEGATION_PENDING_MAX; i++) {
      mgr.recordPendingDelegation(createPendingDelegation(`fill_${i}`))
    }

    // First overflow
    mgr.recordPendingDelegation(createPendingDelegation("overflow_1"))

    let state = mgr.read()
    expect(state?.delegation?.pendingCapacityRejectedTotal).toBe(1)

    // Second overflow (still at capacity, no terminal entries)
    mgr.recordPendingDelegation(createPendingDelegation("overflow_2"))

    state = mgr.read()
    expect(state?.delegation?.pendingCapacityRejectedTotal).toBe(2)
  })

  test("#given first overflow #then lastOverflowIncidentAt is set", () => {
    const dir = createTempDir()
    const mgr = new OmoStateManager(dir)

    // Fill capacity
    for (let i = 0; i < HECATEQ_DELEGATION_PENDING_MAX; i++) {
      mgr.recordPendingDelegation(createPendingDelegation(`fill_${i}`))
    }

    // Trigger overflow
    mgr.recordPendingDelegation(createPendingDelegation("overflow"))

    const state = mgr.read()
    expect(state?.delegation?.lastOverflowIncidentAt).toBeTruthy()
    // It should be a valid ISO date
    expect(Date.parse(state!.delegation!.lastOverflowIncidentAt!)).toBeGreaterThan(0)
  })
})
