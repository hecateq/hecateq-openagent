import { showToastSafe, type ToastInput } from "./notification-toast"

export type HecateqToastKind =
  | "runtime"
  | "agent"
  | "background"
  | "memory"
  | "index"
  | "doctor"
  | "fallback"

export type HecateqToastInput = ToastInput & {
  kind?: HecateqToastKind
}

const HECATEQ_PREFIX = "Hecateq"
const DEFAULT_VARIANT = "info"
const DEFAULT_DURATION = 6000

function buildTitle(input: HecateqToastInput): string {
  if (input.kind) {
    return `${HECATEQ_PREFIX} [${input.kind}] ${input.title}`
  }
  return `${HECATEQ_PREFIX} ${input.title}`
}

export async function showHecateqToastSafe(
  client: unknown,
  input: HecateqToastInput,
): Promise<boolean> {
  const titleWithPrefix = buildTitle(input)
  return showToastSafe(client, {
    title: titleWithPrefix,
    message: input.message,
    variant: input.variant ?? DEFAULT_VARIANT,
    duration: input.duration ?? DEFAULT_DURATION,
  })
}
