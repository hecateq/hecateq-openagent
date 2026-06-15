import { describe, test, expect } from "bun:test"
import {
  findReplyRequiredWake,
  lastMessageIsNoReply,
  type SessionTailMessage,
} from "./wake-tail-resolver"

function makeMessage(role: string, overrides?: Partial<SessionTailMessage>): SessionTailMessage {
  return {
    info: { role },
    ...overrides,
  }
}

function makeSyntheticUser(text?: string): SessionTailMessage {
  return {
    info: { role: "user" },
    parts: [{ type: "text", text: text ?? "system reminder", synthetic: true }],
  }
}

function makeRealUser(text?: string): SessionTailMessage {
  return {
    info: { role: "user" },
    parts: [{ type: "text", text: text ?? "hello" }],
  }
}

describe("findReplyRequiredWake", () => {
  describe("empty or malformed tails", () => {
    test("returns null for empty tail", () => {
      // given
      const tail: SessionTailMessage[] = []

      // when
      const result = findReplyRequiredWake(tail)

      // then
      expect(result).toBeNull()
    })

    test("returns null for tail with only assistant messages", () => {
      // given
      const tail = [
        makeMessage("assistant"),
        makeMessage("assistant"),
      ]

      // when
      const result = findReplyRequiredWake(tail)

      // then
      expect(result).toBeNull()
    })

    test("returns null for tail with only synthetic user messages (noReply wakes)", () => {
      // given
      const tail = [
        makeSyntheticUser("TASK COMPLETED"),
        makeSyntheticUser("TASK COMPLETED"),
      ]

      // when
      const result = findReplyRequiredWake(tail)

      // then
      expect(result).toBeNull()
    })
  })

  describe("backward traversal with noReply skip", () => {
    test("finds real user message after skipping synthetic ones", () => {
      // given — tail: [real user, synthetic wake (noReply), synthetic wake (noReply)]
      const tail = [
        makeRealUser("do task"),
        makeSyntheticUser("BACKGROUND TASK COMPLETED"),
        makeSyntheticUser("BACKGROUND TASK COMPLETED"),
      ]

      // when
      const result = findReplyRequiredWake(tail)

      // then
      expect(result).not.toBeNull()
      expect(result!.shouldReply).toBe(true)
      expect(result!.isInternalWake).toBe(false)
      expect(result!.offsetFromEnd).toBe(2) // the real user message is 2 positions from end
    })

    test("skips mixed assistant and synthetic messages to find real user", () => {
      // given — tail: [real user, assistant, synthetic wake (noReply)]
      const tail = [
        makeRealUser("do task"),
        makeMessage("assistant"),
        makeSyntheticUser("BACKGROUND TASK COMPLETED"),
      ]

      // when
      const result = findReplyRequiredWake(tail)

      // then
      expect(result).not.toBeNull()
      expect(result!.offsetFromEnd).toBe(2)
    })

    test("finds real user when it's the most recent message", () => {
      // given
      const tail = [
        makeRealUser("do task"),
      ]

      // when
      const result = findReplyRequiredWake(tail)

      // then
      expect(result).not.toBeNull()
      expect(result!.offsetFromEnd).toBe(0)
    })
  })

  describe("max depth boundary", () => {
    test("respects maxDepth parameter", () => {
      // given — real user is deep in the tail, beyond maxDepth
      const tail: SessionTailMessage[] = [makeRealUser("original prompt")]
      for (let i = 0; i < 15; i++) {
        tail.push(makeSyntheticUser(`wake ${i}`))
      }

      // when — search only 5 deep from end, won't reach the real user at position 15
      const result = findReplyRequiredWake(tail, 5)

      // then — won't find real user beyond depth
      expect(result).toBeNull()
    })

    test("finds real user within maxDepth", () => {
      // given
      const tail: SessionTailMessage[] = [
        makeRealUser("original prompt"),
        makeSyntheticUser("wake 1"),
        makeSyntheticUser("wake 2"),
        makeSyntheticUser("wake 3"),
      ]

      // when
      const result = findReplyRequiredWake(tail, 5)

      // then
      expect(result).not.toBeNull()
      expect(result!.offsetFromEnd).toBe(3)
    })
  })

  describe("edge cases", () => {
    test("handles messages with null parts", () => {
      // given — a message with undefined parts is treated as non-synthetic user
      const tail = [
        makeRealUser("do task"),
        { info: { role: "user" }, parts: undefined } as SessionTailMessage,
        makeSyntheticUser("wake"),
      ]

      // when
      const result = findReplyRequiredWake(tail)

      // then — the message with undefined parts (index 1) is found as the reply anchor
      expect(result).not.toBeNull()
      expect(result!.offsetFromEnd).toBe(1)
    })

    test("handles messages without info.role but with top-level role", () => {
      // given
      const tail = [
        { role: "user", parts: [{ type: "text", text: "do task" }] } as SessionTailMessage,
        makeSyntheticUser("wake"),
      ]

      // when
      const result = findReplyRequiredWake(tail)

      // then
      expect(result).not.toBeNull()
      expect(result!.offsetFromEnd).toBe(1)
    })

    test("handles all-synthetic tail with max depth 0", () => {
      // given
      const tail = [makeSyntheticUser("a"), makeSyntheticUser("b")]

      // when — maxDepth 0 means no searching at all
      const result = findReplyRequiredWake(tail, 0)

      // then
      expect(result).toBeNull()
    })
  })
})

describe("lastMessageIsNoReply", () => {
  test("returns false for empty tail", () => {
    // when
    const result = lastMessageIsNoReply([])

    // then
    expect(result).toBe(false)
  })

  test("returns false when last message is a real user message", () => {
    // given
    const tail = [makeRealUser("do something")]

    // when
    const result = lastMessageIsNoReply(tail)

    // then
    expect(result).toBe(false)
  })

  test("returns false for synthetic message without BACKGROUND TASK pattern", () => {
    // given
    const tail = [makeSyntheticUser("some other system note")]

    // when
    const result = lastMessageIsNoReply(tail)

    // then
    expect(result).toBe(false)
  })

  test("returns true when last message is a synthetic BACKGROUND TASK COMPLETED wake", () => {
    // given
    const tail = [makeSyntheticUser("BACKGROUND TASK bg_abc: COMPLETED")]

    // when
    const result = lastMessageIsNoReply(tail)

    // then
    expect(result).toBe(true)
  })

  test("returns false when last message is an assistant message", () => {
    // given
    const tail = [makeMessage("assistant")]

    // when
    const result = lastMessageIsNoReply(tail)

    // then
    expect(result).toBe(false)
  })
})
