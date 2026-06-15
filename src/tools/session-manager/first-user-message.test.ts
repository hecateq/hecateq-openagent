import { describe, test, expect, mock, afterAll } from "bun:test"
import type { SessionMessage, MessagePart } from "./types"
import {
  findFirstUserMessage,
  resolveFirstUserMessage,
  type ResolveFirstUserMessageDeps,
} from "./first-user-message"

// ─── Helper: build a session message ─────────────────────────────────────────

function userMsg(text: string, extraParts: MessagePart[] = []): SessionMessage {
  return {
    id: "msg_001",
    role: "user",
    time: { created: Date.now() },
    parts: [
      { id: "part_001", type: "text", text },
      ...extraParts,
    ],
  }
}

function assistantMsg(text: string): SessionMessage {
  return {
    id: "msg_002",
    role: "assistant",
    time: { created: Date.now() },
    parts: [{ id: "part_001", type: "text", text }],
  }
}

function toolUseMsg(toolName: string): SessionMessage {
  return {
    id: "msg_003",
    role: "assistant",
    time: { created: Date.now() },
    parts: [{ id: "part_001", type: "tool_use", tool: toolName }],
  }
}

// ─── findFirstUserMessage ────────────────────────────────────────────────────

describe("findFirstUserMessage", () => {
  describe("normal root session", () => {
    test("returns first real user message", () => {
      const messages = [
        userMsg("Please add email validation to the user registration form"),
        assistantMsg("I'll help you add email validation..."),
      ]

      const result = findFirstUserMessage(messages)
      expect(result).toBe("Please add email validation to the user registration form")
    })
  })

  describe("multiple user messages", () => {
    test("returns the first real user message, not later ones", () => {
      const messages = [
        userMsg("First: refactor the auth module"),
        assistantMsg("Working on it..."),
        userMsg("Second: also update the tests"),
      ]

      const result = findFirstUserMessage(messages)
      expect(result).toBe("First: refactor the auth module")
    })
  })

  describe("assistant-first session", () => {
    test("skips assistant messages and finds the user message", () => {
      const messages = [
        assistantMsg("Hello! How can I help?"),
        userMsg("I need to fix a bug in the login flow"),
      ]

      const result = findFirstUserMessage(messages)
      expect(result).toBe("I need to fix a bug in the login flow")
    })
  })

  describe("system context injection", () => {
    test("skips message with <command-instruction> marker", () => {
      const messages = [
        userMsg("<command-instruction>\nSome system prompt\n</command-instruction>"),
        userMsg("Real user request: optimize the database queries"),
      ]

      const result = findFirstUserMessage(messages)
      expect(result).toBe("Real user request: optimize the database queries")
    })

    test("skips message with <session-context> marker", () => {
      const messages = [
        userMsg("<session-context>\nSession ID: ses_abc\n</session-context>\n<user-request>\nSome request\n</user-request>"),
        userMsg("Build the dashboard component"),
      ]

      const result = findFirstUserMessage(messages)
      expect(result).toBe("Build the dashboard component")
    })

    test("skips message with <system-reminder> marker", () => {
      const messages = [
        userMsg("<system-reminder>\nContext from AGENTS.md\n</system-reminder>"),
        userMsg("Add dark mode toggle"),
      ]

      const result = findFirstUserMessage(messages)
      expect(result).toBe("Add dark mode toggle")
    })
  })

  describe("memory context injection", () => {
    test("skips message with <hecateq- marker", () => {
      const messages = [
        userMsg("<hecateq-memory-state>\nMemory injected context\n</hecateq-memory-state>"),
        userMsg("Fix the pagination bug"),
      ]

      const result = findFirstUserMessage(messages)
      expect(result).toBe("Fix the pagination bug")
    })
  })

  describe("synthetic delegation prompt", () => {
    test("skips message with OMO_INTERNAL marker", () => {
      const messages = [
        userMsg("OMO_INTERNAL: delegation wake"),
        userMsg("Please implement the caching layer"),
      ]

      const result = findFirstUserMessage(messages)
      expect(result).toBe("Please implement the caching layer")
    })
  })

  describe("background wake prompt", () => {
    test("skips message with BACKGROUND_WAKE marker", () => {
      const messages = [
        userMsg("BACKGROUND_WAKE: task resumption"),
        userMsg("Update the error handling in the API layer"),
      ]

      const result = findFirstUserMessage(messages)
      expect(result).toBe("Update the error handling in the API layer")
    })
  })

  describe("handoff-generated prompt", () => {
    test("skips message containing HANDOFF CONTEXT", () => {
      const messages = [
        userMsg("HANDOFF CONTEXT\n==============\nUSER REQUESTS..."),
        userMsg("Add rate limiting to the auth endpoints"),
      ]

      const result = findFirstUserMessage(messages)
      expect(result).toBe("Add rate limiting to the auth endpoints")
    })
  })

  describe("tool-only start", () => {
    test("skips tool messages and returns the first user text message", () => {
      const messages = [
        toolUseMsg("session_read"),
        toolUseMsg("grep"),
        userMsg("Refactor the service layer"),
      ]

      const result = findFirstUserMessage(messages)
      expect(result).toBe("Refactor the service layer")
    })
  })

  describe("long system prompt", () => {
    test("skips messages longer than 4000 characters", () => {
      const longSystemPrompt = "x".repeat(5000)
      const messages = [
        userMsg(longSystemPrompt),
        userMsg("Actual user request here"),
      ]

      const result = findFirstUserMessage(messages)
      expect(result).toBe("Actual user request here")
    })
  })

  describe("empty user message", () => {
    test("skips messages with only whitespace", () => {
      const messages = [
        userMsg("   "),
        userMsg("  \n  "),
        userMsg("Real request: create the migration"),
      ]

      const result = findFirstUserMessage(messages)
      expect(result).toBe("Real request: create the migration")
    })
  })

  describe("compacted session", () => {
    test("handles compaction summary message gracefully", () => {
      const messages = [
        userMsg("[compaction summary] Previous context was compacted"),
        userMsg("Continue working on the modal component"),
      ]

      const result = findFirstUserMessage(messages)
      // "[compaction summary]" doesn't match any synthetic marker so it passes through
      // But in practice the compaction summary would contain markers
      expect(result).toBe("[compaction summary] Previous context was compacted")
    })
  })

  describe("wake message", () => {
    test("skips wake message and finds real user message", () => {
      const messages = [
        userMsg("The task is now running. Please continue."),
        userMsg("Implement the notification system"),
      ]

      const result = findFirstUserMessage(messages)
      expect(result).toBe("Implement the notification system")
    })
  })

  describe("short/invalid messages", () => {
    test("skips messages shorter than 3 characters", () => {
      const messages = [
        userMsg("Hi"),
        userMsg("Add authentication middleware"),
      ]

      const result = findFirstUserMessage(messages)
      // "Hi" is 2 chars, below MIN_USER_MESSAGE_LENGTH (3)
      expect(result).toBe("Add authentication middleware")
    })
  })

  describe("no messages", () => {
    test("returns null for empty message array", () => {
      const result = findFirstUserMessage([])
      expect(result).toBeNull()
    })
  })

  describe("all synthetic messages", () => {
    test("returns null when all messages are synthetic", () => {
      const messages = [
        userMsg("BACKGROUND_WAKE: wakeup"),
        userMsg("<command-instruction>\nDo something\n</command-instruction>"),
        userMsg("OMO_INTERNAL: init"),
      ]

      const result = findFirstUserMessage(messages)
      expect(result).toBeNull()
    })
  })
})

// ─── resolveFirstUserMessage ─────────────────────────────────────────────────

describe("resolveFirstUserMessage", () => {
  afterAll(() => { mock.restore() })

  describe("session source — normal root session", () => {
    test("resolves from session messages", async () => {
      const deps: Partial<ResolveFirstUserMessageDeps> = {
        readSessionMessages: mock(() =>
          Promise.resolve([
            userMsg("Implement the user profile page"),
            assistantMsg("Sure, I'll implement the profile page"),
          ])
        ),
      }

      const result = await resolveFirstUserMessage("ses_abc123", undefined, deps)

      expect(result.text).toBe("Implement the user profile page")
      expect(result.source).toBe("session")
      expect(result.sessionID).toBe("ses_abc123")
      expect(deps.readSessionMessages).toHaveBeenCalledWith("ses_abc123")
    })
  })

  describe("session source — child subagent session", () => {
    test("uses child session's first user message", async () => {
      const deps: Partial<ResolveFirstUserMessageDeps> = {
        readSessionMessages: mock(() =>
          Promise.resolve([
            userMsg("Please refactor the UserService class"),
            assistantMsg("Refactoring UserService..."),
          ])
        ),
      }

      const result = await resolveFirstUserMessage("ses_child_456", undefined, deps)

      expect(result.text).toBe("Please refactor the UserService class")
      expect(result.source).toBe("session")
      expect(result.sessionID).toBe("ses_child_456")
      expect(deps.readSessionMessages).toHaveBeenCalledWith("ses_child_456")
    })
  })

  describe("session with injected system context", () => {
    test("skips system context and finds real user message", async () => {
      const deps: Partial<ResolveFirstUserMessageDeps> = {
        readSessionMessages: mock(() =>
          Promise.resolve([
            userMsg("<command-instruction>\nHandoff command template\n</command-instruction>"),
            userMsg("<session-context>\nSession ID: ses_abc\n</session-context>"),
            userMsg("Fix the navigation bug in the sidebar"),
          ])
        ),
      }

      const result = await resolveFirstUserMessage("ses_abc", undefined, deps)

      expect(result.text).toBe("Fix the navigation bug in the sidebar")
      expect(result.source).toBe("session")
    })
  })

  describe("session with memory context", () => {
    test("skips memory-injected messages", async () => {
      const deps: Partial<ResolveFirstUserMessageDeps> = {
        readSessionMessages: mock(() =>
          Promise.resolve([
            userMsg("<hecateq-memory-state>\nactive-context.md contents\n</hecateq-memory-state>"),
            userMsg("Add a new API endpoint for user search"),
          ])
        ),
      }

      const result = await resolveFirstUserMessage("ses_abc", undefined, deps)

      expect(result.text).toBe("Add a new API endpoint for user search")
      expect(result.source).toBe("session")
    })
  })

  describe("session SDK failure → continuation fallback", () => {
    test("falls back to continuation when session read fails", async () => {
      const deps: Partial<ResolveFirstUserMessageDeps> = {
        readSessionMessages: mock(() => Promise.reject(new Error("SDK unavailable"))),
        readContinuation: mock(() => ({
          work_state: { objective: "Migrate database schema to v3" },
        })),
      }

      const result = await resolveFirstUserMessage("ses_abc", "/project", deps)

      expect(result.text).toBe("Migrate database schema to v3")
      expect(result.source).toBe("continuation")
      expect(deps.readContinuation).toHaveBeenCalledWith("/project")
    })
  })

  describe("session unavailable → memory fallback", () => {
    test("falls back to memory when both session and continuation are unavailable", async () => {
      const deps: Partial<ResolveFirstUserMessageDeps> = {
        readSessionMessages: mock(() => Promise.reject(new Error("Session not found"))),
        readContinuation: mock(() => null),
        readActiveContext: mock(() => `
# Active Context

- Goal: Implement the caching layer for the analytics dashboard
- Status: In progress
`.trim()),
      }

      const result = await resolveFirstUserMessage("ses_abc", "/project", deps)

      expect(result.text).toBe("Implement the caching layer for the analytics dashboard")
      expect(result.source).toBe("memory")
      expect(deps.readActiveContext).toHaveBeenCalledWith("/project")
    })
  })

  describe("only memory available", () => {
    test("returns memory fallback when only activeContext is configured", async () => {
      const deps: Partial<ResolveFirstUserMessageDeps> = {
        readSessionMessages: mock(() => Promise.resolve([])),
        readActiveContext: mock(() => `
- Goal: Setup CI/CD pipeline
- Status: Pending
`.trim()),
      }

      const result = await resolveFirstUserMessage("ses_abc", "/project", deps)

      expect(result.text).toBe("Setup CI/CD pipeline")
      expect(result.source).toBe("memory")
    })
  })

  describe("no source available", () => {
    test("returns unknown when nothing is available", async () => {
      const deps: Partial<ResolveFirstUserMessageDeps> = {
        readSessionMessages: mock(() => Promise.resolve([])),
      }

      const result = await resolveFirstUserMessage("ses_abc", undefined, deps)

      expect(result.text).toBe("unknown")
      expect(result.source).toBe("unknown")
    })
  })

  describe("malformed/empty user message in session", () => {
    test("skips empty/whitespace-only user messages", async () => {
      const deps: Partial<ResolveFirstUserMessageDeps> = {
        readSessionMessages: mock(() =>
          Promise.resolve([
            userMsg("   \n  "),
            userMsg("Real request: fix the CSS grid layout"),
          ])
        ),
      }

      const result = await resolveFirstUserMessage("ses_abc", undefined, deps)

      expect(result.text).toBe("Real request: fix the CSS grid layout")
      expect(result.source).toBe("session")
    })
  })

  describe("tool-only start in session", () => {
    test("skips tool messages and finds the first real user message", async () => {
      const deps: Partial<ResolveFirstUserMessageDeps> = {
        readSessionMessages: mock(() =>
          Promise.resolve([
            toolUseMsg("session_read"),
            toolUseMsg("grep"),
            userMsg("Add integration tests for the checkout flow"),
          ])
        ),
      }

      const result = await resolveFirstUserMessage("ses_abc", undefined, deps)

      expect(result.text).toBe("Add integration tests for the checkout flow")
      expect(result.source).toBe("session")
    })
  })

  describe("wake message in session", () => {
    test("skips background wake message and finds real request", async () => {
      const deps: Partial<ResolveFirstUserMessageDeps> = {
        readSessionMessages: mock(() =>
          Promise.resolve([
            userMsg("The task is now running. You are running in background."),
            userMsg("Refactor the middleware pipeline"),
          ])
        ),
      }

      const result = await resolveFirstUserMessage("ses_abc", undefined, deps)

      expect(result.text).toBe("Refactor the middleware pipeline")
      expect(result.source).toBe("session")
    })
  })

  describe("session with multiple user messages", () => {
    test("returns the first real one after filtering", async () => {
      const deps: Partial<ResolveFirstUserMessageDeps> = {
        readSessionMessages: mock(() =>
          Promise.resolve([
            userMsg("<system-reminder>\nInstructions from AGENTS.md\n</system-reminder>"),
            userMsg("First real request: audit the security middleware"),
            assistantMsg("Auditing security middleware..."),
            userMsg("Also check the rate limiter"),
          ])
        ),
      }

      const result = await resolveFirstUserMessage("ses_abc", undefined, deps)

      expect(result.text).toBe("First real request: audit the security middleware")
      expect(result.source).toBe("session")
    })
  })

  describe("continuation fallback with no projectRoot", () => {
    test("skips continuation when no projectRoot provided", async () => {
      const deps: Partial<ResolveFirstUserMessageDeps> = {
        readSessionMessages: mock(() => Promise.resolve([])),
        readContinuation: mock(() => ({
          work_state: { objective: "Should not be used" },
        })),
      }

      const result = await resolveFirstUserMessage("ses_abc", undefined, deps)

      // No projectRoot, so continuation is skipped
      expect(result.source).toBe("unknown")
      expect(result.text).toBe("unknown")
    })
  })

  describe("memory fallback with no projectRoot", () => {
    test("skips memory when no projectRoot provided", async () => {
      const deps: Partial<ResolveFirstUserMessageDeps> = {
        readSessionMessages: mock(() => Promise.resolve([])),
        readActiveContext: mock(() => "Some context"),
      }

      const result = await resolveFirstUserMessage("ses_abc", undefined, deps)

      // No projectRoot, so memory is skipped
      expect(result.source).toBe("unknown")
      expect(result.text).toBe("unknown")
    })
  })

  describe("memory fallback — first non-header line", () => {
    test("falls back to first meaningful line when no Goal marker", async () => {
      const deps: Partial<ResolveFirstUserMessageDeps> = {
        readSessionMessages: mock(() => Promise.resolve([])),
        readActiveContext: mock(() => `
# Active Context

## Overview

Fix the performance regression in the image pipeline
`.trim()),
      }

      const result = await resolveFirstUserMessage("ses_abc", "/project", deps)

      expect(result.text).toBe("Fix the performance regression in the image pipeline")
      expect(result.source).toBe("memory")
    })
  })

  describe("memory fallback — only headers", () => {
    test("returns unknown when memory file has no meaningful content", async () => {
      const deps: Partial<ResolveFirstUserMessageDeps> = {
        readSessionMessages: mock(() => Promise.resolve([])),
        readActiveContext: mock(() => `
# Active Context

## Goals

## Current Tasks
`.trim()),
      }

      const result = await resolveFirstUserMessage("ses_abc", "/project", deps)

      expect(result.source).toBe("unknown")
      expect(result.text).toBe("unknown")
    })
  })
})
