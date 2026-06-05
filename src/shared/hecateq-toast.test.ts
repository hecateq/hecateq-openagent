/// <reference types="bun-types" />

import { describe, expect, test, mock } from "bun:test"

import { showHecateqToastSafe, type HecateqToastKind } from "./hecateq-toast"

type TuiShowToastFn = (input: {
  body: {
    title: string
    message: string
    variant: string
    duration: number
  }
}) => Promise<unknown>

type MockClient = {
  tui: {
    showToast: TuiShowToastFn
  }
}

function createMockClient(): MockClient {
  return {
    tui: {
      showToast: mock(async () => {}),
    },
  }
}

describe("showHecateqToastSafe", () => {
  test("title includes Hecateq prefix", async () => {
    const client = createMockClient()
    await showHecateqToastSafe(client as unknown, { title: "Test message" })
    const callArg = (client.tui.showToast as ReturnType<typeof mock>).mock.calls[0]?.[0] as {
      body: { title: string }
    }
    expect(callArg.body.title).toBe("Hecateq Test message")
  })

  test("kind appears in title when provided", async () => {
    const client = createMockClient()
    await showHecateqToastSafe(client as unknown, {
      title: "Runtime fallback",
      kind: "fallback" as HecateqToastKind,
    })
    const callArg = (client.tui.showToast as ReturnType<typeof mock>).mock.calls[0]?.[0] as {
      body: { title: string }
    }
    expect(callArg.body.title).toBe("Hecateq [fallback] Runtime fallback")
  })

  test("applies default variant 'info'", async () => {
    const client = createMockClient()
    await showHecateqToastSafe(client as unknown, { title: "Test" })
    const callArg = (client.tui.showToast as ReturnType<typeof mock>).mock.calls[0]?.[0] as {
      body: { variant: string }
    }
    expect(callArg.body.variant).toBe("info")
  })

  test("applies default duration 6000", async () => {
    const client = createMockClient()
    await showHecateqToastSafe(client as unknown, { title: "Test" })
    const callArg = (client.tui.showToast as ReturnType<typeof mock>).mock.calls[0]?.[0] as {
      body: { duration: number }
    }
    expect(callArg.body.duration).toBe(6000)
  })

  test("TUI absent returns false", async () => {
    const client = {} as unknown
    const result = await showHecateqToastSafe(client, { title: "Test" })
    expect(result).toBe(false)
  })

  test("never throws", async () => {
    const badClients = [
      null,
      undefined,
      { tui: { showToast: () => { throw new Error("boom") } } },
    ] as unknown[]

    for (const client of badClients) {
      const result = await showHecateqToastSafe(client as unknown, { title: "Test" })
      expect(result).toBe(false)
    }
  })

  test("passes through message and overridden variant/duration", async () => {
    const client = createMockClient()
    await showHecateqToastSafe(client as unknown, {
      title: "Error",
      message: "Something went wrong",
      variant: "error",
      duration: 3000,
    })
    const callArg = (client.tui.showToast as ReturnType<typeof mock>).mock.calls[0]?.[0] as {
      body: { title: string; message: string; variant: string; duration: number }
    }
    expect(callArg.body.title).toBe("Hecateq Error")
    expect(callArg.body.message).toBe("Something went wrong")
    expect(callArg.body.variant).toBe("error")
    expect(callArg.body.duration).toBe(3000)
  })

  test("all HecateqToastKind values produce valid titles", async () => {
    const kinds: HecateqToastKind[] = [
      "runtime",
      "agent",
      "background",
      "memory",
      "index",
      "doctor",
      "fallback",
    ]

    const client = createMockClient()

    for (const kind of kinds) {
      await showHecateqToastSafe(client as unknown, {
        title: "Message",
        kind,
      })
      const callCount = (client.tui.showToast as ReturnType<typeof mock>).mock.calls.length
      const lastCall = (client.tui.showToast as ReturnType<typeof mock>).mock.calls[callCount - 1]?.[0] as {
        body: { title: string }
      }
      expect(lastCall.body.title).toBe(`Hecateq [${kind}] Message`)
    }
  })
})
