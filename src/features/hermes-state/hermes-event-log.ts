import { HermesStateWriter } from "./hermes-state-writer"

export interface EventLogEntry {
  type: string
  timestamp: string
  session_id: string | null
  data: Record<string, unknown>
}

export class HermesEventLog {
  private writer: HermesStateWriter

  constructor(projectRoot: string) {
    this.writer = new HermesStateWriter(projectRoot)
  }

  logEvent(
    type: string,
    sessionId: string | null,
    data: Record<string, unknown> = {},
  ): void {
    const sanitizedData = this.writer.sanitizeForExport(data)
    const entry: EventLogEntry = {
      type,
      timestamp: new Date().toISOString(),
      session_id: sessionId,
      data: sanitizedData,
    }
    const dateStr = new Date().toISOString().slice(0, 10)
    this.writer.appendJSONL(`events/events-${dateStr}.jsonl`, entry as unknown as Record<string, unknown>)
  }

  logSessionCreated(sessionId: string, agent: string, parentSessionId: string | null): void {
    this.logEvent("session.created", sessionId, {
      agent: agent || "unknown",
      parent_session_id: parentSessionId,
    })
  }

  logSessionIdle(sessionId: string, lastActive: string | null, messageCount: number | null): void {
    this.logEvent("session.idle", sessionId, {
      last_active: lastActive,
      message_count: messageCount,
    })
  }

  logSessionError(sessionId: string, error: string, agent: string | null): void {
    this.logEvent("session.error", sessionId, {
      error: HermesStateWriter.truncateDescription(error, 300),
      agent: agent || "unknown",
    })
  }

  logSessionDeleted(sessionId: string): void {
    this.logEvent("session.deleted", sessionId, {})
  }
}
