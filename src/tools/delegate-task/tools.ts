import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import type { DelegatedModelConfig, ToolContextWithMetadata, DelegateTaskToolOptions } from "./types"
import { log } from "../../shared/logger"
import { buildSystemContent } from "./prompt-builder"
import {
  resolveSkillContent,
  resolveParentContext,
  executeBackgroundContinuation,
  executeSyncContinuation,
  resolveCategoryExecution,
  resolveSubagentExecution,
  executeUnstableAgentTask,
  executeBackgroundTask,
  executeSyncTask,
} from "./executor"
import { prepareDelegateTaskArgs } from "./tool-argument-preparation"
import { createDelegateTaskPresentation } from "./tool-description"
import type { NativeSkillEntry } from "../skill/native-skills"
import { createDependencyGraphStore, canDelegate } from "../../shared/dependency-graph"
import { resolveDependencyGraphMode, isDependencyGraphActive, isDependencyGraphEnforced } from "../../config/schema/hecateq"
import { showHecateqToastSafe } from "../../shared/hecateq-toast"

// ── Hecateq routing toast dedup ────────────────────────────────────────
const routingToastDedup = new Map<string, number>()
const ROUTING_TOAST_DEDUP_MS = 30_000
const ROUTING_TOAST_DEDUP_MAX = 200

function extractRoutingToastTarget(error: string): string {
  const match = error.match(/"([^"]+)"/)
  return match?.[1] ?? "unknown"
}

function classifyHardFail(error: string): { eventKind: "disabled" | "unknown"; title: string; variant: "error" } | null {
  if (error.includes("disabled by disabled_agents")) {
    return { eventKind: "disabled", title: "Exact agent disabled", variant: "error" }
  }
  if (error.startsWith("Unknown subagent_type")) {
    return { eventKind: "unknown", title: "Exact agent unavailable", variant: "error" }
  }
  return null
}

function maybeShowRoutingToast(client: unknown, error: string, sessionID: string): void {
  const classification = classifyHardFail(error)
  if (!classification) return

  const { eventKind, title, variant } = classification
  const target = extractRoutingToastTarget(error)
  const key = `hecateq-routing:${sessionID}:${eventKind}:${target}`
  const now = Date.now()

  const lastSent = routingToastDedup.get(key)
  if (lastSent && (now - lastSent) < ROUTING_TOAST_DEDUP_MS) return

  // Stale cleanup
  if (routingToastDedup.size >= ROUTING_TOAST_DEDUP_MAX) {
    const cutoff = now - ROUTING_TOAST_DEDUP_MS
    for (const [k, ts] of routingToastDedup) {
      if (ts < cutoff) routingToastDedup.delete(k)
    }
  }

  routingToastDedup.set(key, now)

  void showHecateqToastSafe(client, {
    kind: "agent",
    title,
    message: `${target} ${eventKind === "disabled" ? "is disabled" : "is unavailable"}. Hecateq did not silently fallback.`,
    variant,
    duration: 6000,
  }).catch(() => { /* noop — toast is best-effort */ })
}
// ── end dedup ──────────────────────────────────────────────────────────

// ── Hecateq dependency graph toast dedup ──────────────────────────────
const depGraphToastDedup = new Map<string, number>()

function normalizeReason(reason: string): string {
  return reason.trim().toLowerCase().slice(0, 80)
}

function classifyDepGraphSeverity(reason: string): { variant: "warning" | "error"; concise: string } {
  const trimmed = reason.trim()
  if (trimmed.startsWith("Cannot delegate") || trimmed.includes("not found") || trimmed.includes("has already failed")) {
    return { variant: "error", concise: trimmed }
  }
  if (trimmed.startsWith("Warning")) {
    return { variant: "warning", concise: trimmed }
  }
  if (trimmed.includes("already completed")) {
    return { variant: "warning", concise: trimmed }
  }
  // unknown severity → warning
  return { variant: "warning", concise: trimmed }
}

function maybeShowDepGraphToast(
  client: unknown,
  reason: string,
  sessionID: string,
  graphId: string,
  stageId: string,
): void {
  const { variant, concise } = classifyDepGraphSeverity(reason)
  const normalized = normalizeReason(reason)
  const key = `hecateq-routing:${sessionID}:dependency_graph_blocked:${graphId}:${stageId}:${normalized}`
  const now = Date.now()

  const lastSent = depGraphToastDedup.get(key)
  if (lastSent && (now - lastSent) < ROUTING_TOAST_DEDUP_MS) return

  // Stale cleanup
  if (depGraphToastDedup.size >= ROUTING_TOAST_DEDUP_MAX) {
    const cutoff = now - ROUTING_TOAST_DEDUP_MS
    for (const [k, ts] of depGraphToastDedup) {
      if (ts < cutoff) depGraphToastDedup.delete(k)
    }
  }

  depGraphToastDedup.set(key, now)

  const message = concise
    ? `This delegation is blocked by dependency graph requirements: ${concise}`
    : "This task is waiting on required dependencies. Check the task output for details."

  void showHecateqToastSafe(client, {
    kind: "agent",
    title: "Dependency graph blocked delegation",
    message,
    variant,
    duration: 7000,
  }).catch(() => { /* noop */ })
}
// ── end dep-graph toast dedup ──────────────────────────────────────────

async function loadNativeSkillEntries(
  nativeSkills: DelegateTaskToolOptions["nativeSkills"] | undefined,
): Promise<NativeSkillEntry[]> {
  if (!nativeSkills) return []
  try {
    const list = await nativeSkills.all()
    return Array.isArray(list) ? list : []
  } catch (err) {
    log("[delegate-task] nativeSkills.all() failed; skipping native skills", { error: String(err) })
    return []
  }
}

export { resolveCategoryConfig } from "./categories"
export type { SyncSessionCreatedEvent, DelegateTaskToolOptions, BuildSystemContentInput } from "./types"
export { buildSystemContent, buildTaskPrompt } from "./prompt-builder"

const delegateTaskArgsSchema = {
  load_skills: tool.schema
    .array(tool.schema.string())
    .optional()
    .describe("Skill names to inject. Optional; defaults to [] when omitted. Pass an explicit array (e.g. [\"git-master\"]) for skill-specific tasks."),
  description: tool.schema.string().optional().describe("Short task description (3-5 words). Auto-generated from prompt if omitted."),
  prompt: tool.schema.string().describe("Full detailed prompt for the agent"),
  run_in_background: tool.schema
    .boolean()
    .optional()
    .describe("Optional; defaults to false (sync). true=async (returns background task ID `bg_...` for background_output), false=sync (waits). Use true ONLY for parallel exploration; otherwise omit or pass false for task delegation."),
  category: tool.schema.string().optional().describe("REQUIRED if subagent_type not provided. If both category and subagent_type are provided, exact subagent_type routing wins and category is ignored for resolution."),
  subagent_type: tool.schema.string().optional().describe("REQUIRED if category not provided. If both category and subagent_type are provided, exact subagent_type routing wins and category is ignored for resolution."),
  task_id: tool.schema
    .string()
    .optional()
    .describe("Continuation session id (`ses_...`) from task metadata; not a background task id (`bg_...`)."),
  command: tool.schema.string().optional().describe("The command that triggered this task"),
  dependency_graph_id: tool.schema
    .string()
    .optional()
    .describe("Optional dependency graph ID for Hecateq dependency-aware task ordering. If provided with stage_id, the system checks prerequisite stages before allowing delegation."),
  stage_id: tool.schema
    .string()
    .optional()
    .describe("Stage ID within the dependency graph. Must be used with dependency_graph_id. The system checks whether this stage's prerequisites are met before delegating."),
}

export function createDelegateTask(options: DelegateTaskToolOptions): ToolDefinition {
  const { availableCategories, availableSkills, categoryExamples, description } = createDelegateTaskPresentation(options)

  return tool({
    description,
    args: delegateTaskArgsSchema,
    async execute(args, toolContext) {
      const ctx = toolContext as ToolContextWithMetadata
      const delegateTaskArgs = await prepareDelegateTaskArgs(args, ctx)

      // Dependency graph guard: if the caller supplies a dependency_graph_id and stage_id,
      // check whether the stage's prerequisites are met before allowing delegation.
      const depGraphConfig = options.hecateqDependencyGraphConfig
      const depGraphMode = depGraphConfig ? resolveDependencyGraphMode(depGraphConfig) : "off"
      const depGraphActive = depGraphMode !== "off"
      if (depGraphActive && delegateTaskArgs.dependency_graph_id && delegateTaskArgs.stage_id) {
        try {
          const store = createDependencyGraphStore()
          const graph = store.getGraph(delegateTaskArgs.dependency_graph_id)
          if (graph) {
            const enforce = depGraphMode === "enforce"
            const check = canDelegate(graph, delegateTaskArgs.stage_id, enforce)
            if (!check.allowed) {
              log("[task] Dependency graph blocked delegation", {
                graphId: delegateTaskArgs.dependency_graph_id,
                stageId: delegateTaskArgs.stage_id,
                reason: check.reason,
              })
              const reason = check.reason ?? "Dependency graph check blocked this delegation."
              maybeShowDepGraphToast(
                options.client,
                reason,
                ctx.sessionID,
                delegateTaskArgs.dependency_graph_id,
                delegateTaskArgs.stage_id,
              )
              return reason
            }
          } else {
            log("[task] Dependency graph not found, allowing delegation", {
              graphId: delegateTaskArgs.dependency_graph_id,
            })
          }
        } catch (err) {
          log("[task] Dependency graph guard error (non-fatal, allowing delegation)", {
            error: String(err),
          })
        }
      }

      const runInBackground = delegateTaskArgs.run_in_background === true

      const nativeSkillEntries = await loadNativeSkillEntries(options.nativeSkills)

      const { content: skillContent, contents: skillContents, error: skillError } = await resolveSkillContent(delegateTaskArgs.load_skills, {
        gitMasterConfig: options.gitMasterConfig,
        browserProvider: options.browserProvider,
        disabledSkills: options.disabledSkills,
        teamModeEnabled: options.teamModeEnabled,
        directory: options.directory,
        targetAgent: delegateTaskArgs.subagent_type,
        nativeSkills: options.nativeSkills,
        nativeSkillEntries,
      })
      if (skillError) {
        return skillError
      }

      const continuationSystemContent = buildSystemContent({
        skillContent,
        skillContents,
        availableCategories,
        availableSkills,
        nativeSkillInfos: nativeSkillEntries,
      })

      const parentContext = await resolveParentContext(ctx, options.client)

      if (delegateTaskArgs.task_id) {
        if (runInBackground) {
          return executeBackgroundContinuation(delegateTaskArgs, ctx, options, parentContext, continuationSystemContent)
        }
        return executeSyncContinuation(delegateTaskArgs, ctx, options, parentContext, undefined, continuationSystemContent)
      }

      if (!delegateTaskArgs.category && !delegateTaskArgs.subagent_type) {
        return `Invalid arguments: Must provide either category or subagent_type.`
      }

      const hasExplicitSubagentType = typeof delegateTaskArgs.subagent_type === "string"
        && delegateTaskArgs.subagent_type.trim() !== ""

      let systemDefaultModel: string | undefined
      try {
        const openCodeConfig = await options.client.config.get()
        systemDefaultModel = (openCodeConfig as { data?: { model?: string } })?.data?.model
      } catch {
        systemDefaultModel = undefined
      }

      const inheritedModel = parentContext.model
        ? `${parentContext.model.providerID}/${parentContext.model.modelID}`
        : undefined

      let agentToUse: string
      let categoryModel: DelegatedModelConfig | undefined
      let categoryPromptAppend: string | undefined
      let modelInfo: import("../../features/task-toast-manager/types").ModelFallbackInfo | undefined
      let actualModel: string | undefined
      let isUnstableAgent = false
      let fallbackChain: import("../../shared/model-requirements").FallbackEntry[] | undefined
      let maxPromptTokens: number | undefined

      if (!hasExplicitSubagentType && delegateTaskArgs.category) {
        const resolution = await resolveCategoryExecution(delegateTaskArgs, options, inheritedModel, systemDefaultModel)
        if (resolution.error) {
          return resolution.error
        }
        agentToUse = resolution.agentToUse
        categoryModel = resolution.categoryModel
        categoryPromptAppend = resolution.categoryPromptAppend
        modelInfo = resolution.modelInfo
        actualModel = resolution.actualModel
        isUnstableAgent = resolution.isUnstableAgent
        fallbackChain = resolution.fallbackChain
        maxPromptTokens = resolution.maxPromptTokens

        const isRunInBackgroundExplicitlyFalse = isExplicitSyncRun(delegateTaskArgs.run_in_background)

        log("[task] unstable agent detection", {
          category: delegateTaskArgs.category,
          actualModel,
          isUnstableAgent,
          run_in_background_value: delegateTaskArgs.run_in_background,
          run_in_background_type: typeof delegateTaskArgs.run_in_background,
          isRunInBackgroundExplicitlyFalse,
          willForceBackground: isUnstableAgent && isRunInBackgroundExplicitlyFalse,
        })

        if (isUnstableAgent && isRunInBackgroundExplicitlyFalse) {
          const systemContent = buildSystemContent({
            skillContent,
            skillContents,
            categoryPromptAppend,
            agentName: agentToUse,
            maxPromptTokens,
            model: categoryModel,
            availableCategories,
            availableSkills,
            nativeSkillInfos: nativeSkillEntries,
          })
          return executeUnstableAgentTask(delegateTaskArgs, ctx, options, parentContext, agentToUse, categoryModel, systemContent, actualModel)
        }
      } else {
        const resolution = await resolveSubagentExecution(delegateTaskArgs, options, parentContext.agent, categoryExamples)
        if (resolution.error) {
          maybeShowRoutingToast(options.client, resolution.error, ctx.sessionID)
          return resolution.error
        }
        agentToUse = resolution.agentToUse
        categoryModel = resolution.categoryModel
        fallbackChain = resolution.fallbackChain
      }

      const systemContent = buildSystemContent({
        skillContent,
        skillContents,
        categoryPromptAppend,
        agentName: agentToUse,
        maxPromptTokens,
        model: categoryModel,
        availableCategories,
        availableSkills,
        nativeSkillInfos: nativeSkillEntries,
      })

      if (runInBackground) {
        return executeBackgroundTask(delegateTaskArgs, ctx, options, parentContext, agentToUse, categoryModel, systemContent, fallbackChain)
      }

      return executeSyncTask(delegateTaskArgs, ctx, options, parentContext, agentToUse, categoryModel, systemContent, modelInfo, fallbackChain)
    },
  })
}

function isExplicitSyncRun(runInBackground: unknown): boolean {
  return runInBackground === false || runInBackground === "false"
}
