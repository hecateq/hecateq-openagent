export const PLUGIN_NAME = "oh-my-openagent"
export const LEGACY_PLUGIN_NAME = "oh-my-opencode"
export const PUBLISHED_PACKAGE_NAME = "@hecateq/hecateq-openagent"
export const CANONICAL_PLUGIN_ENTRY = PUBLISHED_PACKAGE_NAME
export const ACCEPTED_PACKAGE_NAMES = [
  PUBLISHED_PACKAGE_NAME,
  PLUGIN_NAME,
  LEGACY_PLUGIN_NAME,
] as const
export const CONFIG_BASENAME = "oh-my-openagent"
export const LEGACY_CONFIG_BASENAME = "oh-my-opencode"
export const LOG_FILENAME = "oh-my-opencode.log"
export const CACHE_DIR_NAME = "oh-my-opencode"

/**
 * Hecateq package name for @hecateq/hecateq-openagent distribution.
 * Used for npm registry lookups and auto-update checks targeting the Hecateq fork.
 */
export const HECATEQ_PACKAGE_NAME = "@hecateq/hecateq-openagent"
