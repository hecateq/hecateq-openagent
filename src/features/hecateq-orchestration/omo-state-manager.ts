/**
 * Hecateq OmoStateManager — `.omo/hecateq/` Runtime State Manager
 *
 * Wave 1 foundation: typed read/write helpers for `.omo/hecateq/state.json`.
 * This manager owns the canonical runtime handoff state file for the FINAL
 * Hecateq handoff system. The existing MVP flow (Boulder + continuation markers)
 * continues to work alongside — this is additive.
 *
 * Wave 2+ will add auto-routing, background ingestion, and policy engine.
 *
 * File layout:
 *   <projectRoot>/.omo/hecateq/state.json     ← Canonical runtime state
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import type {
  DelegationExecutionResult,
  HecateqDelegationRecord,
  HecateqHandoffState,
  HecateqMigrationState,
  HecateqOmoState,
  HecateqPendingDelegation,
  HecateqRoutingRecord,
  HecateqRoutingState,
  HecateqSignalRegistryState,
  HecateqStoredHandoff,
  HecateqStoredSignal,
  HecateqWriteResult,
} from "./types"
import {
  HECATEQ_DELEGATION_HISTORY_MAX,
  HECATEQ_DELEGATION_PENDING_MAX,
  HECATEQ_ROUTING_HISTORY_MAX,
} from "./types"

// ─── Constants ─────────────────────────────────────────────────────────────

/** Relative path to the `.omo/hecateq/` state directory from project root */
export const HECATEQ_OMO_DIR = join(".omo", "hecateq")

/** Filename for the canonical runtime state file */
export const HECATEQ_OMO_STATE_FILE = "state.json"

/** Full relative path from project root to the state file */
export const HECATEQ_OMO_STATE_PATH = join(HECATEQ_OMO_DIR, HECATEQ_OMO_STATE_FILE)

/** Maximum handoff history entries to retain */
export const HECATEQ_HANDOFF_HISTORY_MAX = 20

/** Maximum pending signals before auto-pruning oldest */
export const HECATEQ_SIGNAL_PENDING_MAX = 100

/** Maximum consumed signal history before auto-pruning oldest */
export const HECATEQ_SIGNAL_CONSUMED_MAX = 200

/** Default empty state for creating a fresh state file */
export function createDefaultState(): HecateqOmoState {
  return {
    schema_version: 1,
    last_updated: new Date().toISOString(),
    handoff: { active: null, history: [] },
    signal_registry: { pending: [], consumed: [] },
    routing: { active_target: null, queue: [], decisions: [] },
    delegation: { pending: [], history: [], routingDepth: 0 },
    migrations: { completed: [], last_run: null },
  }
}

// ─── OmoStateManager ───────────────────────────────────────────────────────

/**
 * Manages the canonical `.omo/hecateq/state.json` file.
 *
 * Usage:
 *   const mgr = new OmoStateManager("/path/to/project/root")
 *   const state = mgr.read() ?? mgr.create()
 *   mgr.recordHandoff(...)
 *   mgr.emitSignal("tests_passed", {})
 */
export class OmoStateManager {
  private readonly projectRoot: string

  constructor(projectRoot: string) {
    if (!projectRoot || projectRoot.trim().length === 0) {
      throw new Error("OmoStateManager: projectRoot is required")
    }
    this.projectRoot = projectRoot
  }

  // ── Path resolution ─────────────────────────────────────────────────────

  /** Absolute path to the `.omo/hecateq/` directory */
  get omoDir(): string {
    return join(this.projectRoot, HECATEQ_OMO_DIR)
  }

  /** Absolute path to the `state.json` file */
  get stateFilePath(): string {
    return join(this.omoDir, HECATEQ_OMO_STATE_FILE)
  }

  // ── Directory management ────────────────────────────────────────────────

  /**
   * Ensure the `.omo/hecateq/` directory exists.
   * Creates it (and parents) if missing. Never throws.
   */
  ensureDir(): void {
    try {
      mkdirSync(this.omoDir, { recursive: true })
    } catch {
      // Best-effort — caller handles write failures
    }
  }

  // ── Read / Write ────────────────────────────────────────────────────────

  /**
   * Read the current state from `.omo/hecateq/state.json`.
   * Returns `null` if the file does not exist or is corrupt.
   * Never throws.
   */
  read(): HecateqOmoState | null {
    try {
      if (!existsSync(this.stateFilePath)) return null
      const raw = readFileSync(this.stateFilePath, "utf-8")
      const parsed = JSON.parse(raw) as HecateqOmoState
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null
      return parsed
    } catch {
      return null
    }
  }

  /**
   * Write state to `.omo/hecateq/state.json`.
   * Updates `last_updated` automatically.
   * Creates the directory if it does not exist.
   * Returns success flag — never throws.
   */
  write(state: HecateqOmoState): HecateqWriteResult {
    try {
      this.ensureDir()
      state.last_updated = new Date().toISOString()
      writeFileSync(this.stateFilePath, JSON.stringify(state, null, 2), "utf-8")
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Create a fresh default state and write it.
   * Returns the new state, or null if the write failed.
   */
  create(): HecateqOmoState | null {
    const state = createDefaultState()
    const result = this.write(state)
    return result.success ? state : null
  }

  /**
   * Read existing state or create fresh default.
   * Never returns null — always returns a valid state.
   */
  readOrCreate(): HecateqOmoState {
    return this.read() ?? this.create() ?? createDefaultState()
  }

  // ── Handoff helpers ─────────────────────────────────────────────────────

  /**
   * Record a handoff in the state.
   * Sets the active handoff and prepends to history.
   * Returns the updated state, or null if the write failed.
   */
  recordHandoff(handoff: HecateqStoredHandoff): HecateqOmoState | null {
    const state = this.readOrCreate()

    // Set up handoff section if missing
    if (!state.handoff) {
      state.handoff = { active: null, history: [] }
    }

    // Set active
    state.handoff.active = handoff

    // Prepend to history
    state.handoff.history.unshift(handoff)

    // Trim history
    if (state.handoff.history.length > HECATEQ_HANDOFF_HISTORY_MAX) {
      state.handoff.history = state.handoff.history.slice(0, HECATEQ_HANDOFF_HISTORY_MAX)
    }

    const result = this.write(state)
    return result.success ? state : null
  }

  /**
   * Get the active handoff, or null if none.
   */
  getActiveHandoff(): HecateqStoredHandoff | null {
    const state = this.read()
    return state?.handoff?.active ?? null
  }

  /**
   * Clear the active handoff (keeps history intact).
   * Returns the updated state, or null if write failed.
   */
  clearActiveHandoff(): HecateqOmoState | null {
    const state = this.readOrCreate()
    if (state.handoff) {
      state.handoff.active = null
    }
    const result = this.write(state)
    return result.success ? state : null
  }

  /** Get handoff history (most recent first). */
  getHandoffHistory(): HecateqStoredHandoff[] {
    const state = this.read()
    return state?.handoff?.history ?? []
  }

  // ── Signal registry helpers ─────────────────────────────────────────────

  /**
   * Emit a signal into the registry.
   * Adds to the pending list. Auto-prunes oldest if over limit.
   * Returns the updated state, or null if write failed.
   */
  emitSignal(
    signal: string,
    payload: Record<string, unknown>,
    emitterAgent?: string,
  ): HecateqOmoState | null {
    const state = this.readOrCreate()

    if (!state.signal_registry) {
      state.signal_registry = { pending: [], consumed: [] }
    }

    const stored: HecateqStoredSignal = {
      signal,
      payload,
      emittedAt: new Date().toISOString(),
      ...(emitterAgent ? { emitterAgent } : {}),
    }

    state.signal_registry.pending.push(stored)

    // Auto-prune oldest pending if over limit
    if (state.signal_registry.pending.length > HECATEQ_SIGNAL_PENDING_MAX) {
      state.signal_registry.pending = state.signal_registry.pending.slice(
        -HECATEQ_SIGNAL_PENDING_MAX,
      )
    }

    const result = this.write(state)
    return result.success ? state : null
  }

  /**
   * Consume a pending signal by name.
   * Moves the first matching pending signal to consumed.
   * Returns the consumed signal, or null if no match.
   */
  consumeSignal(signalName: string): HecateqStoredSignal | null {
    const state = this.read()
    if (!state?.signal_registry) return null

    const idx = state.signal_registry.pending.findIndex((s) => s.signal === signalName)
    if (idx === -1) return null

    const [signal] = state.signal_registry.pending.splice(idx, 1)
    signal.consumedAt = new Date().toISOString()
    state.signal_registry.consumed.push(signal)

    // Auto-prune oldest consumed if over limit
    if (state.signal_registry.consumed.length > HECATEQ_SIGNAL_CONSUMED_MAX) {
      state.signal_registry.consumed = state.signal_registry.consumed.slice(
        -HECATEQ_SIGNAL_CONSUMED_MAX,
      )
    }

    this.write(state)
    return signal
  }

  /** Get all pending (unconsumed) signals. */
  getPendingSignals(): HecateqStoredSignal[] {
    const state = this.read()
    return state?.signal_registry?.pending ?? []
  }

  /** Get all consumed signals. */
  getConsumedSignals(): HecateqStoredSignal[] {
    const state = this.read()
    return state?.signal_registry?.consumed ?? []
  }

  /**
   * Check if a specific signal name is pending.
   */
  hasPendingSignal(signalName: string): boolean {
    const state = this.read()
    if (!state?.signal_registry) return false
    return state.signal_registry.pending.some((s) => s.signal === signalName)
  }

  // ── Migration tracking ──────────────────────────────────────────────────

  /**
   * Mark a migration as completed.
   * Returns the updated state, or null if write failed.
   */
  markMigrationComplete(migrationId: string): HecateqOmoState | null {
    const state = this.readOrCreate()

    if (!state.migrations) {
      state.migrations = { completed: [], last_run: null }
    }

    if (!state.migrations.completed.includes(migrationId)) {
      state.migrations.completed.push(migrationId)
    }
    state.migrations.last_run = new Date().toISOString()

    const result = this.write(state)
    return result.success ? state : null
  }

  /** Check if a specific migration has already completed. */
  isMigrationComplete(migrationId: string): boolean {
    const state = this.read()
    return state?.migrations?.completed?.includes(migrationId) ?? false
  }

  /** Get all completed migration IDs. */
  getCompletedMigrations(): string[] {
    const state = this.read()
    return state?.migrations?.completed ?? []
  }

  // ── Routing decision helpers ────────────────────────────────────────────

  /**
   * Record a routing decision into the routing state.
   * Prepends to the decisions history. Auto-prunes oldest if over limit.
   * Returns the updated state, or null if write failed.
   */
  recordRoutingDecision(record: HecateqRoutingRecord): HecateqOmoState | null {
    const state = this.readOrCreate()

    if (!state.routing) {
      state.routing = { active_target: null, queue: [], decisions: [] }
    }
    if (!state.routing.decisions) {
      state.routing.decisions = []
    }

    // Prepend to history
    state.routing.decisions.unshift(record)

    // Trim history
    if (state.routing.decisions.length > HECATEQ_ROUTING_HISTORY_MAX) {
      state.routing.decisions = state.routing.decisions.slice(0, HECATEQ_ROUTING_HISTORY_MAX)
    }

    const result = this.write(state)
    return result.success ? state : null
  }

  /** Get routing decision history (most recent first). */
  getRoutingDecisions(): HecateqRoutingRecord[] {
    const state = this.read()
    return state?.routing?.decisions ?? []
  }

  // ── Delegation helpers (Wave 3) ────────────────────────────────────────

  /**
   * Get all pending delegation requests.
   */
  getPendingDelegations(): HecateqPendingDelegation[] {
    const state = this.read()
    return state?.delegation?.pending ?? []
  }

  /**
   * Record a pending delegation request.
   * Prepends to the pending list. Auto-prunes oldest if over limit.
   * Returns the updated state, or null if write failed.
   */
  recordPendingDelegation(delegation: HecateqPendingDelegation): HecateqOmoState | null {
    const state = this.readOrCreate()

    if (!state.delegation) {
      state.delegation = { pending: [], history: [], routingDepth: 0 }
    }
    if (!state.delegation.pending) {
      state.delegation.pending = []
    }

    state.delegation.pending.push(delegation)

    // Auto-prune oldest if over limit
    if (state.delegation.pending.length > HECATEQ_DELEGATION_PENDING_MAX) {
      state.delegation.pending = state.delegation.pending.slice(
        -HECATEQ_DELEGATION_PENDING_MAX,
      )
    }

    const result = this.write(state)
    return result.success ? state : null
  }

  /**
   * Consume a pending delegation request by ID.
   * Moves it from pending to history.
   * Returns the consumed delegation, or null if not found.
   */
  consumePendingDelegation(
    delegationId: string,
    result: DelegationExecutionResult,
    blockReason?: string,
  ): HecateqPendingDelegation | null {
    const state = this.read()
    if (!state?.delegation) return null

    const idx = state.delegation.pending.findIndex((d) => d.id === delegationId)
    if (idx === -1) return null

    const [delegation] = state.delegation.pending.splice(idx, 1)
    delegation.status = "consumed"

    const record: HecateqDelegationRecord = {
      id: delegation.id,
      targetAgent: delegation.targetAgent,
      sourceTaskId: delegation.sourceTaskId,
      sourceAgent: delegation.sourceAgent,
      decidedAt: delegation.createdAt,
      executedAt: new Date().toISOString(),
      result,
      ...(blockReason ? { blockReason } : {}),
    }

    if (!state.delegation.history) {
      state.delegation.history = []
    }
    state.delegation.history.unshift(record)

    // Trim history
    if (state.delegation.history.length > HECATEQ_DELEGATION_HISTORY_MAX) {
      state.delegation.history = state.delegation.history.slice(0, HECATEQ_DELEGATION_HISTORY_MAX)
    }

    this.write(state)
    return delegation
  }

  /**
   * Get delegation history (most recent first).
   */
  getDelegationHistory(): HecateqDelegationRecord[] {
    const state = this.read()
    return state?.delegation?.history ?? []
  }

  /**
   * Get current routing depth from the delegation state.
   */
  getRoutingDepth(): number {
    const state = this.read()
    return state?.delegation?.routingDepth ?? 0
  }

  /**
   * Increment routing depth and return the new depth.
   * Returns -1 if write failed.
   */
  incrementRoutingDepth(): number {
    const state = this.readOrCreate()
    if (!state.delegation) {
      state.delegation = { pending: [], history: [], routingDepth: 0 }
    }
    state.delegation.routingDepth = (state.delegation.routingDepth ?? 0) + 1
    const result = this.write(state)
    return result.success ? state.delegation.routingDepth : -1
  }
}
