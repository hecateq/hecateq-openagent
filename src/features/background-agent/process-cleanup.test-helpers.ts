type ProcessCleanupEvent =
  | NodeJS.Signals
  | "beforeExit"
  | "exit"
  | "uncaughtException"
  | "unhandledRejection"

export function getNewListener(
  signal: ProcessCleanupEvent,
  existingListeners: Function[],
): Function {
  const allListeners = process.listeners(signal as Parameters<typeof process.listeners>[0])
  const listener = allListeners.find(
    (registeredListener) => !existingListeners.includes(registeredListener as Function),
  )

  if (typeof listener !== "function") {
    throw new Error(`Expected a ${signal} listener to be registered`)
  }

  return listener as Function
}

export async function flushMicrotasks(): Promise<void> {
  for (let iteration = 0; iteration < 10; iteration += 1) {
    await Promise.resolve()
  }
}
