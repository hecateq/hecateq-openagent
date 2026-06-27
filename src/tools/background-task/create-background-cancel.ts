import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import type { BackgroundManager } from "../../features/background-agent"
import type { BackgroundCancelArgs } from "./types"
import type { BackgroundCancelClient } from "./clients"
import { BACKGROUND_CANCEL_DESCRIPTION } from "./constants"

export function createBackgroundCancel(manager: BackgroundManager, _client: BackgroundCancelClient): ToolDefinition {
  return tool({
    description: BACKGROUND_CANCEL_DESCRIPTION,
    args: {
      taskId: tool.schema.string().describe("Task ID to cancel (required)"),
    },
    async execute(args: BackgroundCancelArgs, toolContext) {
      try {
        // Legacy `all: true` is now forbidden. See delegation-runtime-contracts.md 1.1
        if ((args as unknown as Record<string, unknown>).all === true) {
          return `[ERROR] GLOBAL_BACKGROUND_CANCEL_FORBIDDEN: Global background cancellation via all=true is forbidden. Use background_cancel({taskId}) to cancel one task.`
        }

        const taskId = args.taskId
        if (!taskId) {
          return `[ERROR] Invalid arguments: Provide a taskId to cancel a specific background task.`
        }

        const task = manager.getTask(taskId)
        if (!task) {
          return `[ERROR] Task not found: ${taskId}`
        }

        if (task.status !== "running" && task.status !== "pending") {
          return `[ERROR] Cannot cancel task: current status is "${task.status}".
Only running or pending tasks can be cancelled.`
        }

        const cancelled = await manager.cancelTask(task.id, {
          source: "background_cancel",
          abortSession: task.status === "running",
          skipNotification: true,
        })
        if (!cancelled) {
          return `[ERROR] Failed to cancel task: ${task.id}`
        }

        if (task.status === "pending") {
          return `Pending task cancelled successfully

Task ID: ${task.id}
Description: ${task.description}
Status: ${task.status}`
        }

        return `Task cancelled successfully

Task ID: ${task.id}
Description: ${task.description}
Session ID: ${task.sessionId}
Status: ${task.status}`
      } catch (error) {
        return `[ERROR] Error cancelling task: ${error instanceof Error ? error.message : String(error)}`
      }
    },
  })
}
