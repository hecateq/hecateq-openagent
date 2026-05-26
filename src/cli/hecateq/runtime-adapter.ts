import { createEventState } from "../run/events"
import { createServerConnection } from "../run/server-connection"
import { resolveSession } from "../run/session-resolver"
import { pollForCompletion } from "../run/poll-for-completion"
import { dispatchInternalPrompt, isInternalPromptDispatchAccepted } from "../../shared/prompt-async-gate"
import { isAmbiguousPostDispatchPromptFailure } from "../../shared/prompt-failure-classifier"
import { normalizeSDKResponse } from "../../shared/normalize-sdk-response"
import { parseHandoffBlock } from "../../features/hecateq-orchestration/handoff-parser"
import type {
  AgentSelectionEntry,
  ExecutionAdapter,
  ExecutionBatch,
  TaskExecutionResult,
  TaskNode,
} from "../../features/hecateq-orchestration/types"

type MessagePart = {
  type?: string
  text?: string
}

type SessionMessage = {
  role?: string
  parts?: MessagePart[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function extractLatestAssistantText(messages: unknown[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!isRecord(message) || message.role !== "assistant") continue
    const parts = Array.isArray(message.parts) ? message.parts : []
    const text = parts
      .filter((part): part is MessagePart => isRecord(part))
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text ?? "")
      .join("\n")
      .trim()
    if (text.length > 0) return text
  }

  return ""
}

export interface OpenCodeExecutionAdapterOptions {
  directory: string
  port?: number
  attach?: string
}

export class OpenCodeSessionExecutionAdapter implements ExecutionAdapter {
  readonly label = "opencode-task"

  constructor(private readonly options: OpenCodeExecutionAdapterOptions) {}

  canExecute(agentId: string): boolean {
    return agentId.trim().length > 0
  }

  async executeTask(task: TaskNode, assignment: AgentSelectionEntry): Promise<TaskExecutionResult> {
    const abortController = new AbortController()
    const { client, cleanup } = await createServerConnection({
      port: this.options.port,
      attach: this.options.attach,
      signal: abortController.signal,
    })

    try {
      const sessionID = await resolveSession({
        client,
        directory: this.options.directory,
      })

      const promptResult = await dispatchInternalPrompt({
        mode: "async",
        client,
        sessionID,
        source: "hecateq-cli-run",
        settleMs: 0,
        queueBehavior: "defer",
        input: {
          path: { id: sessionID },
          body: {
            agent: assignment.selectedAgent,
            tools: {
              question: false,
            },
            parts: [{ type: "text", text: task.prompt }],
          },
          query: { directory: this.options.directory },
        },
      })

      const promptMayHaveBeenAccepted = promptResult.status === "failed"
        && isAmbiguousPostDispatchPromptFailure(promptResult)
      if (promptResult.status === "failed" && !promptMayHaveBeenAccepted) {
        throw promptResult.error
      }
      if (!promptMayHaveBeenAccepted && !isInternalPromptDispatchAccepted(promptResult)) {
        throw new Error(`Session ${sessionID} is not idle; promptAsync skipped by gate: ${promptResult.status}`)
      }

      const eventState = createEventState()
      eventState.hasReceivedMeaningfulWork = true

      const exitCode = await pollForCompletion(
        {
          client,
          sessionID,
          directory: this.options.directory,
          abortController,
          verbose: false,
        },
        eventState,
        abortController,
      )

      const messagesResponse = await client.session.messages({
        path: { id: sessionID },
        query: { directory: this.options.directory },
      })
      const messages = normalizeSDKResponse<unknown[]>(messagesResponse, [])
      const latestAssistantText = extractLatestAssistantText(messages)
      const handoff = latestAssistantText.length > 0 ? parseHandoffBlock(latestAssistantText) : null

      return {
        taskId: task.id,
        agentId: assignment.selectedAgent,
        status: exitCode === 0 ? "completed" : "failed",
        changedFiles: [],
        producedArtifacts: [],
        errorSummary: exitCode === 0 ? undefined : `OpenCode session exited with code ${exitCode}`,
        handoffData: handoff
          ? {
              status: handoff.status,
              target: handoff.handoff,
              signalCount: handoff.signals.length,
            }
          : undefined,
      }
    } catch (error) {
      return {
        taskId: task.id,
        agentId: assignment.selectedAgent,
        status: "failed",
        changedFiles: [],
        producedArtifacts: [],
        errorSummary: error instanceof Error ? error.message : String(error),
      }
    } finally {
      abortController.abort()
      cleanup()
    }
  }

  async executeBatch(
    batch: ExecutionBatch,
    tasks: TaskNode[],
    agentAssignments: AgentSelectionEntry[],
  ): Promise<TaskExecutionResult[]> {
    const assignmentMap = new Map(agentAssignments.map((entry) => [entry.taskId, entry]))
    const taskMap = new Map(tasks.map((task) => [task.id, task]))
    const results: TaskExecutionResult[] = []

    for (const taskId of batch.taskIds) {
      const task = taskMap.get(taskId)
      const assignment = assignmentMap.get(taskId)
      if (!task || !assignment) {
        results.push({
          taskId,
          agentId: assignment?.selectedAgent ?? "unknown",
          status: "failed",
          changedFiles: [],
          producedArtifacts: [],
          errorSummary: "Task or assignment missing for runtime execution",
        })
        continue
      }

      results.push(await this.executeTask(task, assignment))
    }

    return results
  }
}
