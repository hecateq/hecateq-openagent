import { DOMAIN_DEFINITIONS, DOMAIN_HINT_ALIASES } from "./hecateq-agent-indexer"
import type { DomainName } from "./hecateq-agent-indexer"

export { DOMAIN_DEFINITIONS, DOMAIN_HINT_ALIASES }
export type { DomainName }

/**
 * Escape characters that are special in regex, so literal terms
 * can be embedded in a RegExp without triggering unintended operators.
 */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Detect the most likely domain for a given text by consulting the
 * 34-domain vocabulary from hecateq-agent-indexer.
 *
 * Returns the first matching DomainName, or "unknown" if no term matches.
 *
 * Matching algorithm:
 * - Single-word terms: matched with word-boundary regex (\bterm\b).
 * - Multi-word / compound terms (containing space, /, or -): first attempt
 *   a case-insensitive substring match of the full term.
 * - Compound terms with / or - (like "ci/cd", "server-side"): if the full
 *   term does not match, split on separators and test each component as a
 *   single-word match. Space-separated terms are never decomposed this way
 *   (they only have meaning as complete phrases).
 */
export function detectDomainFromText(text: string): DomainName | "unknown" {
  const lower = text.toLowerCase()

  for (const [domain, def] of Object.entries(DOMAIN_DEFINITIONS)) {
    for (const term of def.terms) {
      if (term.includes(" ") || term.includes("/") || term.includes("-")) {
        // compound term: try full match first
        if (lower.includes(term.toLowerCase())) return domain as DomainName
        // for / and - separated terms, also try component matching
        // (space-separated terms like "service layer" are matched as phrases only)
        if (term.includes("/") || term.includes("-")) {
          const components = term.split(/[\/-]+/)
          if (components.some((c) => new RegExp(`\\b${escapeRegex(c)}\\b`, "i").test(text))) {
            return domain as DomainName
          }
        }
      } else {
        // single-word term: word-boundary match
        if (new RegExp(`\\b${escapeRegex(term)}\\b`, "i").test(text)) return domain as DomainName
      }
    }
  }

  return "unknown"
}
