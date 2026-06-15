import { log } from "../shared/logger"

type RemoteMcpConfig = {
  type: "remote"
  url: string
  enabled: boolean
  headers?: Record<string, string>
  oauth?: false
}

/**
 * Configuration options for the grep.app MCP.
 */
export type GrepAppConfig = {
  /** Override the default grep.app MCP URL. */
  url?: string
  /** Explicitly enable or disable the MCP. Defaults to true. */
  enabled?: boolean
}

const DEFAULT_URL = "https://mcp.grep.app"

/**
 * Creates the built-in grep.app remote MCP configuration.
 *
 * Returns `undefined` when the MCP is explicitly disabled or the URL is invalid,
 * allowing `createBuiltinMcps()` to gracefully skip registration.
 *
 * Error handling:
 * - Invalid URLs are caught before registration, with a logged warning.
 * - Explicit `enabled: false` skips the MCP silently (no warning).
 * - Network-level failures (connection drops, timeouts) are handled by the
 *   OpenCode MCP client at runtime, not at config-build time.
 */
export function createGrepAppConfig(config?: GrepAppConfig): RemoteMcpConfig | undefined {
  if (config?.enabled === false) {
    log("[grep_app] grep_app MCP explicitly disabled via config")
    return undefined
  }

  const url = config?.url ?? DEFAULT_URL

  if (!isValidUrl(url)) {
    log(`[grep_app] Invalid MCP URL "${url}", skipping grep_app MCP`)
    return undefined
  }

  log("[grep_app] Registering grep_app remote MCP")

  return {
    type: "remote" as const,
    url,
    enabled: true,
    oauth: false as const,
  }
}

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === "http:" || parsed.protocol === "https:"
  } catch {
    return false
  }
}

export const grep_app = createGrepAppConfig()
