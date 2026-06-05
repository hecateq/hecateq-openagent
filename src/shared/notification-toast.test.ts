/// <reference types="bun-types" />

import { describe, expect, test, mock } from "bun:test"

import { showToastSafe, type ToastInput, type ToastVariant } from "./notification-toast"

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

describe("showToastSafe", () => {
  test("when TUI client exists, showToast is called and returns true", async () => {
    const client = createMockClient()
    const result = await showToastSafe(client as unknown, { title: "Hello" })
    expect(result).toBe(true)
    expect(client.tui.showToast).toHaveBeenCalledTimes(1)
    const callArg = (client.tui.showToast as ReturnType<typeof mock>).mock.calls[0]?.[0] as {
      body: { title: string; message: string; variant: string; duration: number }
    }
    expect(callArg.body.title).toBe("Hello")
  })

  test("when TUI client is absent, returns false", async () => {
    const client = {} as unknown
    const result = await showToastSafe(client, { title: "Hello" })
    expect(result).toBe(false)
  })

  test("when TUI client has no showToast method, returns false", async () => {
    const client = { tui: {} } as unknown
    const result = await showToastSafe(client, { title: "Hello" })
    expect(result).toBe(false)
  })

  test("when showToast rejects, returns false", async () => {
    const client = createMockClient()
    client.tui.showToast = mock(async () => {
      throw new Error("TUI unavailable")
    })
    const result = await showToastSafe(client as unknown, { title: "Hello" })
    expect(result).toBe(false)
  })

  test("never throws regardless of client shape", async () => {
    const badClients = [
      null,
      undefined,
      42,
      "string",
      { tui: null },
      { tui: { showToast: "not a function" } },
      { tui: { showToast: () => { throw new Error("sync throw") } } },
    ] as unknown[]

    for (const client of badClients) {
      const result = await showToastSafe(client as unknown, { title: "Test" })
      expect(result).toBe(false)
    }
  })

  test("applies default variant 'info' when variant is omitted", async () => {
    const client = createMockClient()
    await showToastSafe(client as unknown, { title: "Hello" })
    const callArg = (client.tui.showToast as ReturnType<typeof mock>).mock.calls[0]?.[0] as {
      body: { variant: string }
    }
    expect(callArg.body.variant).toBe("info")
  })

  test("applies default duration 5000 when duration is omitted", async () => {
    const client = createMockClient()
    await showToastSafe(client as unknown, { title: "Hello" })
    const callArg = (client.tui.showToast as ReturnType<typeof mock>).mock.calls[0]?.[0] as {
      body: { duration: number }
    }
    expect(callArg.body.duration).toBe(5000)
  })

  test("applies empty string default for message when omitted", async () => {
    const client = createMockClient()
    await showToastSafe(client as unknown, { title: "Hello" })
    const callArg = (client.tui.showToast as ReturnType<typeof mock>).mock.calls[0]?.[0] as {
      body: { message: string }
    }
    expect(callArg.body.message).toBe("")
  })

  test("uses provided variant and duration when specified", async () => {
    const client = createMockClient()
    const input: ToastInput = {
      title: "Warning",
      message: "Something happened",
      variant: "error" as ToastVariant,
      duration: 3000,
    }
    await showToastSafe(client as unknown, input)
    const callArg = (client.tui.showToast as ReturnType<typeof mock>).mock.calls[0]?.[0] as {
      body: { message: string; variant: string; duration: number }
    }
    expect(callArg.body.message).toBe("Something happened")
    expect(callArg.body.variant).toBe("error")
    expect(callArg.body.duration).toBe(3000)
  })

  // ── onError callback tests (Phase 2E) ──

  test("when showToast rejects, onError is called with the error", async () => {
    const client = createMockClient()
    const rejectionError = new Error("TUI rejected")
    client.tui.showToast = mock(async () => {
      throw rejectionError
    })
    const onError = mock<(error: unknown) => void>()
    const result = await showToastSafe(client as unknown, { title: "Test" }, onError)
    expect(result).toBe(false)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith(rejectionError)
  })

  test("when onError itself throws, showToastSafe still returns false and does not throw", async () => {
    const client = createMockClient()
    client.tui.showToast = mock(async () => {
      throw new Error("TUI rejected")
    })
    const explodingOnError = mock<(error: unknown) => void>(() => {
      throw new Error("onError crashed")
    })
    // Must not throw outward
    const result = await showToastSafe(client as unknown, { title: "Test" }, explodingOnError)
    expect(result).toBe(false)
    expect(explodingOnError).toHaveBeenCalledTimes(1)
  })

  test("when onError is absent, failure is silently handled (old behavior preserved)", async () => {
    const client = createMockClient()
    client.tui.showToast = mock(async () => {
      throw new Error("TUI rejected")
    })
    // No onError argument — must not throw
    const result = await showToastSafe(client as unknown, { title: "Test" })
    expect(result).toBe(false)
  })
})
