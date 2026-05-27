import type { RalphLoopConfig } from "../../config"

export interface RalphLoopState {
  active: boolean
  iteration: number
  max_iterations?: number
  message_count_at_start?: number
  zero_progress_count?: number
  completion_promise: string
  initial_completion_promise?: string
  verification_attempt_id?: string
  verification_session_id?: string
  verification_started_at?: string
  started_at: string
  prompt: string
  session_id?: string
  ultrawork?: boolean
  verification_pending?: boolean
  strategy?: "reset" | "continue"
  /** Session ID of the most recent in-flight oracle dispatch for verification */
  in_flight_oracle_session_id?: string
}

export interface IterationCommitExpectation {
  iteration: number
  sessionID: string
}

export interface RalphLoopOptions {
  config?: RalphLoopConfig
  getTranscriptPath?: (sessionId: string) => string
  apiTimeout?: number
  idleSettleMs?: number
  checkSessionExists?: (sessionId: string) => Promise<boolean>
  backgroundManager?: { getTasksByParentSession: (sessionId: string) => Array<{ status: string }> }
}
