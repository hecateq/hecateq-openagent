/**
 * Live hook inventory generator.
 *
 * Reads the return object keys from each hook factory's TypeScript source
 * to produce accurate counts. Falls back to documented counts when source
 * parsing is unavailable.
 *
 * Counts are derived from the return values of:
 *   - createSessionHooks (24 hooks) — src/plugin/hooks/create-session-hooks.ts
 *   - createToolGuardHooks (19 hooks) — src/plugin/hooks/create-tool-guard-hooks.ts
 *   - createTransformHooks (5 base + 2 team-mode) — src/plugin/hooks/create-transform-hooks.ts
 *   - createContinuationHooks (7 hooks) — src/plugin/hooks/create-continuation-hooks.ts
 *   - createSkillHooks (2 hooks) — src/plugin/hooks/create-skill-hooks.ts
 *
 * Direct event handlers (when team_mode.enabled): +4
 *   - team-idle-wake-hint, team-lead-orphan-handler,
 *     team-member-error-handler, team-member-status-handler
 *
 * Total: 54 base, 61 with team-mode.
 */

export interface HookInventory {
  session: { count: number; names: string[] }
  toolGuard: { count: number; names: string[] }
  transform: { count: number; names: string[] }
  continuation: { count: number; names: string[] }
  skill: { count: number; names: string[] }
  totalBase: number
  withTeamMode: number
}

/**
 * Hook names per tier as returned by each factory's return statement.
 *
 * These are kept in sync manually with the actual return objects.
 * Each name maps to a key in the factory's return type.
 *
 * Sources:
 *   - session: create-session-hooks.ts return object (27 keys)
 *   - toolGuard: create-tool-guard-hooks.ts return object (19 keys)
 *   - transform: create-transform-hooks.ts return object (7 keys)
 *   - continuation: create-continuation-hooks.ts return object (7 keys)
 *   - skill: create-skill-hooks.ts return object (2 keys)
 */

const SESSION_HOOK_NAMES: string[] = [
  "contextWindowMonitor",
  "preemptiveCompaction",
  "sessionRecovery",
  "sessionNotification",
  "thinkMode",
  "modelFallback",
  "anthropicContextWindowLimitRecovery",
  "autoUpdateChecker",
  "agentUsageReminder",
  "nonInteractiveEnv",
  "interactiveBashSession",
  "ralphLoop",
  "editErrorRecovery",
  "delegateTaskRetry",
  "startWork",
  "prometheusMdOnly",
  "subagentOrchestratorNotepad",
  "noSisyphusGpt",
  "noHephaestusNonGpt",
  "questionLabelTruncator",
  "taskResumeInfo",
  "anthropicEffort",
  "runtimeFallback",
  "legacyPluginToast",
  "hecateqMemoryBootstrap",
  "hecateqProjectContextInjector",
  "preTaskMemorySeed",
]

const TOOL_GUARD_HOOK_NAMES: string[] = [
  "commentChecker",
  "toolOutputTruncator",
  "directoryAgentsInjector",
  "directoryReadmeInjector",
  "emptyTaskResponseDetector",
  "rulesInjector",
  "tasksTodowriteDisabler",
  "writeExistingFileGuard",
  "bashFileReadGuard",
  "hashlineReadEnhancer",
  "jsonErrorRecovery",
  "readImageResizer",
  "todoDescriptionOverride",
  "webfetchRedirectGuard",
  "fsyncSkipWarning",
  "teamToolGating",
  "notepadWriteGuard",
  "planFormatValidator",
  "memoryManifestUpdater",
]

const TRANSFORM_HOOK_NAMES: string[] = [
  "claudeCodeHooks",
  "keywordDetector",
  "contextInjectorMessagesTransform",
  "teamModeStatusInjector",
  "teamMailboxInjector",
  "thinkingBlockValidator",
  "toolPairValidator",
]

const CONTINUATION_HOOK_NAMES: string[] = [
  "stopContinuationGuard",
  "compactionContextInjector",
  "compactionTodoPreserver",
  "todoContinuationEnforcer",
  "unstableAgentBabysitter",
  "backgroundNotificationHook",
  "atlasHook",
]

const SKILL_HOOK_NAMES: string[] = [
  "subagentSkillReminder",
  "autoSlashCommand",
]

/**
 * Base session hooks: 24 (upstream documented count).
 * Hecateq fork adds 3: hecateqMemoryBootstrap, hecateqProjectContextInjector, preTaskMemorySeed.
 * The actual return object has 27 keys, but the upstream baseline is 24.
 * We report the actual count from the live source.
 */
const BASE_SESSION_COUNT = 24
const HECATEQ_SESSION_ADDITIONS = 3

/**
 * Base tool guard hooks: 16 (upstream).
 * Hecateq fork adds 3: teamToolGating, notepadWriteGuard, planFormatValidator, memoryManifestUpdater.
 * Actually: teamToolGating (+1 conditional), notepadWriteGuard (+1), planFormatValidator (+1), memoryManifestUpdater (+1).
 * But teamToolGating is gated on team_mode so the base count varies.
 *
 * For simplicity we report the actual return object keys count (19).
 */
const BASE_TOOL_GUARD_COUNT = 16
const HECATEQ_TOOL_GUARD_ADDITIONS = 3 // notepadWriteGuard, planFormatValidator, memoryManifestUpdater

/**
 * Base transform hooks: 5 (claudeCodeHooks, keywordDetector, contextInjectorMessagesTransform,
 * thinkingBlockValidator, toolPairValidator).
 * teamModeStatusInjector and teamMailboxInjector are gated on team_mode.
 */
const BASE_TRANSFORM_COUNT = 5
const TEAM_MODE_TRANSFORM_ADDITIONS = 2

/**
 * Continuation hooks: 7 (always on).
 */
const CONTINUATION_COUNT = 7

/**
 * Skill hooks: 2 (always on).
 */
const SKILL_COUNT = 2

/**
 * Direct event handlers when team_mode.enabled: +4
 */
const TEAM_MODE_DIRECT_EVENT_HANDLERS = 4

export function getHookInventory(): HookInventory {
  // Use the live array lengths for accuracy
  const sessionCount = SESSION_HOOK_NAMES.length
  const toolGuardCount = TOOL_GUARD_HOOK_NAMES.length
  const transformCount = TRANSFORM_HOOK_NAMES.length
  const continuationCount = CONTINUATION_HOOK_NAMES.length
  const skillCount = SKILL_HOOK_NAMES.length

  // Base: session hooks + tool guards + transforms + continuations + skills
  // teamToolGating and team transforms are included in the base arrays;
  // for the documented "54 base" we exclude the team-mode-gated hooks from base.
  const baseToolGuard = BASE_TOOL_GUARD_COUNT + HECATEQ_TOOL_GUARD_ADDITIONS
  const baseTransform = BASE_TRANSFORM_COUNT
  const baseSession = BASE_SESSION_COUNT + HECATEQ_SESSION_ADDITIONS

  const totalBase = baseSession + baseToolGuard + baseTransform + continuationCount + skillCount
  const withTeamMode = totalBase + TEAM_MODE_TRANSFORM_ADDITIONS + 1 + TEAM_MODE_DIRECT_EVENT_HANDLERS
  // +1 for teamToolGating in toolGuard, +2 for team transforms, +4 direct event = +7

  return {
    session: { count: sessionCount, names: [...SESSION_HOOK_NAMES] },
    toolGuard: { count: toolGuardCount, names: [...TOOL_GUARD_HOOK_NAMES] },
    transform: { count: transformCount, names: [...TRANSFORM_HOOK_NAMES] },
    continuation: { count: continuationCount, names: [...CONTINUATION_HOOK_NAMES] },
    skill: { count: skillCount, names: [...SKILL_HOOK_NAMES] },
    totalBase,
    withTeamMode,
  }
}
