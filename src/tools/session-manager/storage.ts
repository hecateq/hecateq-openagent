import type { PluginInput } from "@opencode-ai/plugin"
import { isSqliteBackend } from "../../shared/opencode-storage-detection"
import { log } from "../../shared"
import { getFileAllSessions, getFileMainSessions, fileSessionExists, getFileSessionInfo, getFileSessionMessages, getFileSessionTodos, getFileSessionTranscript } from "./file-storage"
import { getSdkAllSessions, getSdkMainSessions, getSdkSessionMessages, getSdkSessionTodos, sdkSessionExists } from "./sdk-storage"
import { withTransientRetry } from "./retry-runner"
import { classifySessionReadError } from "./retry-classifier"
import type { SessionInfo, SessionMessage, SessionMetadata, TodoItem } from "./types"

export interface GetMainSessionsOptions {
  directory?: string
  signal?: AbortSignal
}

export interface StorageOptions {
  signal?: AbortSignal
}

function mergeSessionMetadataLists(
  sdkSessions: SessionMetadata[],
  fileSessions: SessionMetadata[],
): SessionMetadata[] {
  const merged = new Map<string, SessionMetadata>()

  for (const session of fileSessions) {
    merged.set(session.id, session)
  }

  for (const session of sdkSessions) {
    merged.set(session.id, session)
  }

  return [...merged.values()].sort((a, b) => b.time.updated - a.time.updated)
}

function mergeSessionIds(sdkSessionIds: string[], fileSessionIds: string[]): string[] {
  return [...new Set([...sdkSessionIds, ...fileSessionIds])]
}

// SDK client reference for beta mode
let sdkClient: PluginInput["client"] | null = null

export function setStorageClient(client: PluginInput["client"]): void {
  sdkClient = client
}

export function resetStorageClient(): void {
  sdkClient = null
}

export async function getMainSessions(options: GetMainSessionsOptions): Promise<SessionMetadata[]> {
  if (isSqliteBackend() && sdkClient) {
    try {
      const sdkSessions = await withTransientRetry(
        () => getSdkMainSessions(sdkClient!, options.directory),
        { signal: options.signal },
      )
      const fileSessions = await getFileMainSessions(options.directory)
      return mergeSessionMetadataLists(sdkSessions, fileSessions)
    } catch (error) {
      const classification = classifySessionReadError(error)
      if (classification !== "fallbackable" && classification !== "retryable-transient") throw error
      if (options.signal?.aborted) throw error
      log("[session-manager] falling back to file session list after SDK error", { error: String(error) })
    }
  }

  return getFileMainSessions(options.directory)
}

export async function getAllSessions(options: StorageOptions = {}): Promise<string[]> {
  if (isSqliteBackend() && sdkClient) {
    try {
      const sdkSessionIds = await withTransientRetry(
        () => getSdkAllSessions(sdkClient!),
        { signal: options.signal },
      )
      const fileSessionIds = await getFileAllSessions()
      return mergeSessionIds(sdkSessionIds, fileSessionIds)
    } catch (error) {
      const classification = classifySessionReadError(error)
      if (classification !== "fallbackable" && classification !== "retryable-transient") throw error
      if (options.signal?.aborted) throw error
      log("[session-manager] falling back to file session ids after SDK error", { error: String(error) })
    }
  }

  return getFileAllSessions()
}

export { getMessageDir } from "../../shared/opencode-message-dir"

export async function sessionExists(sessionID: string, options: StorageOptions = {}): Promise<boolean> {
  if (isSqliteBackend() && sdkClient) {
    try {
      const existsInSdk = await withTransientRetry(
        () => sdkSessionExists(sdkClient!, sessionID),
        { signal: options.signal },
      )
      if (existsInSdk) return true
    } catch (error) {
      const classification = classifySessionReadError(error)
      if (classification !== "fallbackable" && classification !== "retryable-transient") throw error
      if (options.signal?.aborted) throw error
      log("[session-manager] falling back to file sessionExists after SDK error", { error: String(error), sessionID })
    }
  }
  return fileSessionExists(sessionID)
}

export async function readSessionMessages(sessionID: string, options: StorageOptions = {}): Promise<SessionMessage[]> {
  if (isSqliteBackend() && sdkClient) {
    try {
      const sdkMessages = await withTransientRetry(
        () => getSdkSessionMessages(sdkClient!, sessionID),
        { signal: options.signal },
      )
      if (sdkMessages.length > 0) return sdkMessages
    } catch (error) {
      const classification = classifySessionReadError(error)
      if (classification === "fallbackable" || classification === "retryable-transient") {
        if (options.signal?.aborted) throw error
        log("[session-manager] falling back to file session messages after SDK error", { error: String(error), sessionID })
      } else {
        throw error
      }
    }
  }

  return getFileSessionMessages(sessionID)
}

export async function readSessionTodos(sessionID: string, options: StorageOptions = {}): Promise<TodoItem[]> {
  if (isSqliteBackend() && sdkClient) {
    try {
      const sdkTodos = await withTransientRetry(
        () => getSdkSessionTodos(sdkClient!, sessionID),
        { signal: options.signal },
      )
      if (sdkTodos.length > 0) return sdkTodos
    } catch (error) {
      const classification = classifySessionReadError(error)
      if (classification === "fallbackable" || classification === "retryable-transient") {
        if (options.signal?.aborted) throw error
        log("[session-manager] falling back to file session todos after SDK error", { error: String(error), sessionID })
      } else {
        throw error
      }
    }
  }

  return getFileSessionTodos(sessionID)
}

export async function readSessionTranscript(sessionID: string): Promise<number> {
  return getFileSessionTranscript(sessionID)
}

export async function getSessionInfo(sessionID: string, options: StorageOptions = {}): Promise<SessionInfo | null> {
  if (isSqliteBackend() && sdkClient) {
    try {
      const sdkMessages = await withTransientRetry(
        () => getSdkSessionMessages(sdkClient!, sessionID),
        { signal: options.signal },
      )
      if (sdkMessages.length > 0) {
        const agentsUsed = new Set<string>()
        let firstMessage: Date | undefined
        let lastMessage: Date | undefined

        for (const msg of sdkMessages) {
          if (msg.agent) agentsUsed.add(msg.agent)
          if (msg.time?.created) {
            const date = new Date(msg.time.created)
            if (!firstMessage || date < firstMessage) firstMessage = date
            if (!lastMessage || date > lastMessage) lastMessage = date
          }
        }

        const todos = await readSessionTodos(sessionID, options)
        const transcriptEntries = await readSessionTranscript(sessionID)

        return {
          id: sessionID,
          message_count: sdkMessages.length,
          first_message: firstMessage,
          last_message: lastMessage,
          agents_used: Array.from(agentsUsed),
          has_todos: todos.length > 0,
          has_transcript: transcriptEntries > 0,
          todos,
          transcript_entries: transcriptEntries,
        }
      }
    } catch (error) {
      const classification = classifySessionReadError(error)
      if (classification === "fallbackable" || classification === "retryable-transient") {
        if (options.signal?.aborted) throw error
        log("[session-manager] falling back to file session info after SDK error", { error: String(error), sessionID })
      } else {
        throw error
      }
    }
  }

  return getFileSessionInfo(sessionID)
}
