import { describe, test, expect } from "bun:test"
import {
  createWakeEventBus,
  type WakeEvent,
  type WakeEventType,
} from "./wake-event-bus"

function makeEvent(
  type: WakeEventType,
  sessionID = "ses-test",
  metadata?: Record<string, unknown>,
): WakeEvent {
  return { type, sessionID, timestamp: Date.now(), metadata }
}

describe("WakeEventBus", () => {
  describe("subscribe and emit", () => {
    test("subscribed callback fires on emit", () => {
      // given
      const bus = createWakeEventBus()
      let received: WakeEvent | undefined
      bus.subscribe("wake:dispatched", (event) => {
        received = event
      })

      // when
      const event = makeEvent("wake:dispatched", "ses-1", { taskID: "bg_1" })
      void bus.emit(event)

      // then
      expect(received).toBeDefined()
      expect(received!.type).toBe("wake:dispatched")
      expect(received!.sessionID).toBe("ses-1")
      expect(received!.metadata).toEqual({ taskID: "bg_1" })
    })

    test("multiple subscribers all receive the same event", () => {
      // given
      const bus = createWakeEventBus()
      const calls: string[] = []
      bus.subscribe("wake:completed", () => { calls.push("sub-1") })
      bus.subscribe("wake:completed", () => { calls.push("sub-2") })
      bus.subscribe("wake:completed", () => { calls.push("sub-3") })

      // when
      void bus.emit(makeEvent("wake:completed"))

      // then
      expect(calls).toEqual(["sub-1", "sub-2", "sub-3"])
    })

    test("emit with no subscribers is a no-op", async () => {
      // given
      const bus = createWakeEventBus()

      // when / then — should not throw
      await bus.emit(makeEvent("wake:failed"))
    })
  })

  describe("unsubscribe", () => {
    test("returned unsubscribe function removes the callback", () => {
      // given
      const bus = createWakeEventBus()
      const calls: string[] = []
      const unsubscribe = bus.subscribe("wake:dispatched", () => { calls.push("first") })

      // when
      unsubscribe()
      void bus.emit(makeEvent("wake:dispatched"))

      // then
      expect(calls).toEqual([])
    })

    test("unsubscribing one callback does not affect others", () => {
      // given
      const bus = createWakeEventBus()
      const calls: string[] = []
      const unsubA = bus.subscribe("wake:dispatched", () => { calls.push("a") })
      bus.subscribe("wake:dispatched", () => { calls.push("b") })

      // when
      unsubA()
      void bus.emit(makeEvent("wake:dispatched"))

      // then
      expect(calls).toEqual(["b"])
    })

    test("repeated unsubscribe is harmless", () => {
      // given
      const bus = createWakeEventBus()
      const calls: string[] = []
      const unsubscribe = bus.subscribe("wake:dispatched", () => { calls.push("x") })

      // when
      unsubscribe()
      unsubscribe()
      void bus.emit(makeEvent("wake:dispatched"))

      // then
      expect(calls).toEqual([])
    })
  })

  describe("async callbacks", () => {
    test("emit awaits async callbacks before resolving", async () => {
      // given
      const bus = createWakeEventBus()
      let asyncDone = false
      bus.subscribe("wake:completed", async () => {
        await Promise.resolve()
        asyncDone = true
      })

      // when
      await bus.emit(makeEvent("wake:completed"))

      // then
      expect(asyncDone).toBe(true)
    })

    test("mix of sync and async callbacks all complete", async () => {
      // given
      const bus = createWakeEventBus()
      const order: string[] = []
      bus.subscribe("wake:completed", () => { order.push("sync") })
      bus.subscribe("wake:completed", async () => {
        await Promise.resolve()
        order.push("async")
      })

      // when
      await bus.emit(makeEvent("wake:completed"))

      // then
      expect(order).toContain("sync")
      expect(order).toContain("async")
    })
  })

  describe("error isolation", () => {
    test("error in one subscriber does not prevent others from running", () => {
      // given
      const bus = createWakeEventBus()
      const calls: string[] = []
      bus.subscribe("wake:dispatched", () => {
        throw new Error("boom")
      })
      bus.subscribe("wake:dispatched", () => { calls.push("survivor") })

      // when
      void bus.emit(makeEvent("wake:dispatched"))

      // then
      expect(calls).toEqual(["survivor"])
    })

    test("async error in one subscriber does not prevent others from running", async () => {
      // given
      const bus = createWakeEventBus()
      const calls: string[] = []
      bus.subscribe("wake:dispatched", async () => {
        await Promise.resolve()
        throw new Error("async-boom")
      })
      bus.subscribe("wake:dispatched", () => { calls.push("survivor") })

      // when
      await bus.emit(makeEvent("wake:dispatched"))

      // then
      expect(calls).toEqual(["survivor"])
    })

    test("emit does not throw when all subscribers error", async () => {
      // given
      const bus = createWakeEventBus()
      bus.subscribe("wake:failed", () => {
        throw new Error("err-1")
      })
      bus.subscribe("wake:failed", () => {
        throw new Error("err-2")
      })

      // when / then — should not throw
      await bus.emit(makeEvent("wake:failed"))
    })
  })

  describe("clear", () => {
    test("removes all subscriptions across all event types", () => {
      // given
      const bus = createWakeEventBus()
      const calls: string[] = []
      bus.subscribe("wake:dispatched", () => { calls.push("d") })
      bus.subscribe("wake:completed", () => { calls.push("c") })
      bus.subscribe("wake:failed", () => { calls.push("f") })

      // when
      bus.clear()
      void bus.emit(makeEvent("wake:dispatched"))
      void bus.emit(makeEvent("wake:completed"))
      void bus.emit(makeEvent("wake:failed"))

      // then
      expect(calls).toEqual([])
    })

    test("clear on an empty bus is a no-op", () => {
      // given
      const bus = createWakeEventBus()

      // when / then — should not throw
      bus.clear()
    })

    test("can re-subscribe after clear", () => {
      // given
      const bus = createWakeEventBus()
      const calls: string[] = []
      bus.subscribe("wake:dispatched", () => { calls.push("old") })
      bus.clear()

      // when
      bus.subscribe("wake:dispatched", () => { calls.push("new") })
      void bus.emit(makeEvent("wake:dispatched"))

      // then
      expect(calls).toEqual(["new"])
    })
  })

  describe("event type isolation", () => {
    test("subscriber to one type does not receive other types", () => {
      // given
      const bus = createWakeEventBus()
      let completedCallCount = 0
      let failedCallCount = 0
      bus.subscribe("wake:completed", () => { completedCallCount++ })
      bus.subscribe("wake:failed", () => { failedCallCount++ })

      // when
      void bus.emit(makeEvent("wake:completed"))

      // then
      expect(completedCallCount).toBe(1)
      expect(failedCallCount).toBe(0)
    })

    test("subscriber to all four types receives only its own", () => {
      // given
      const bus = createWakeEventBus()
      const received: Record<string, number> = {}
      const types: WakeEventType[] = [
        "wake:dispatched",
        "wake:completed",
        "wake:failed",
        "wake:retry",
      ]
      for (const type of types) {
        bus.subscribe(type, () => {
          received[type] = (received[type] ?? 0) + 1
        })
      }

      // when
      void bus.emit(makeEvent("wake:retry"))

      // then
      expect(received["wake:retry"]).toBe(1)
      expect(received["wake:dispatched"]).toBeUndefined()
      expect(received["wake:completed"]).toBeUndefined()
      expect(received["wake:failed"]).toBeUndefined()
    })
  })

  describe("factory", () => {
    test("createWakeEventBus returns an object with all methods", () => {
      const bus = createWakeEventBus()
      expect(typeof bus.subscribe).toBe("function")
      expect(typeof bus.emit).toBe("function")
      expect(typeof bus.clear).toBe("function")
    })

    test("each factory call produces an independent bus", () => {
      // given
      const busA = createWakeEventBus()
      const busB = createWakeEventBus()
      let aCalls = 0
      let bCalls = 0
      busA.subscribe("wake:dispatched", () => { aCalls++ })
      busB.subscribe("wake:dispatched", () => { bCalls++ })

      // when
      void busA.emit(makeEvent("wake:dispatched"))

      // then
      expect(aCalls).toBe(1)
      expect(bCalls).toBe(0)
    })
  })
})
