import { CANONICAL_PLUGIN_ENTRY, LEGACY_PLUGIN_NAME, PLUGIN_NAME } from "./plugin-identity"

export function isLegacyEntry(entry: string): boolean {
  return entry === LEGACY_PLUGIN_NAME || entry.startsWith(`${LEGACY_PLUGIN_NAME}@`) ||
         entry === PLUGIN_NAME || entry.startsWith(`${PLUGIN_NAME}@`)
}

export function isCanonicalEntry(entry: string): boolean {
  return entry === CANONICAL_PLUGIN_ENTRY || entry.startsWith(`${CANONICAL_PLUGIN_ENTRY}@`)
}

export function toCanonicalEntry(entry: string): string {
  if (entry === LEGACY_PLUGIN_NAME || entry === PLUGIN_NAME) {
    return CANONICAL_PLUGIN_ENTRY
  }

  if (entry.startsWith(`${LEGACY_PLUGIN_NAME}@`)) {
    return `${CANONICAL_PLUGIN_ENTRY}${entry.slice(LEGACY_PLUGIN_NAME.length)}`
  }

  if (entry.startsWith(`${PLUGIN_NAME}@`)) {
    return `${CANONICAL_PLUGIN_ENTRY}${entry.slice(PLUGIN_NAME.length)}`
  }

  return entry
}
