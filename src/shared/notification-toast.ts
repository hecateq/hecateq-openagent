export type ToastVariant = "info" | "success" | "warning" | "error"

export type ToastInput = {
  title: string
  message?: string
  variant?: ToastVariant
  duration?: number
}

type TuiShowToastFn = (input: {
  body: {
    title: string
    message: string
    variant: string
    duration: number
  }
}) => Promise<unknown>

type ClientWithOptionalTui = {
  tui?: {
    showToast?: TuiShowToastFn
  }
}

const DEFAULT_VARIANT: ToastVariant = "info"
const DEFAULT_DURATION = 5000

export async function showToastSafe(
  client: unknown,
  input: ToastInput,
  onError?: (error: unknown) => void,
): Promise<boolean> {
  const resolvedVariant: ToastVariant = input.variant ?? DEFAULT_VARIANT
  const resolvedDuration: number = input.duration ?? DEFAULT_DURATION
  const resolvedMessage: string = input.message ?? ""

  const tuiClient = client as ClientWithOptionalTui
  const showToastFn = tuiClient?.tui?.showToast

  if (typeof showToastFn !== "function") {
    return false
  }

  try {
    await showToastFn({
      body: {
        title: input.title,
        message: resolvedMessage,
        variant: resolvedVariant,
        duration: resolvedDuration,
      },
    })
    return true
  } catch (error) {
    try { onError?.(error) } catch { void error }
    return false
  }
}
