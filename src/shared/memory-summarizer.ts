import { detectPlaceholderContent } from "./memory-manifest"

const LAST_UPDATED_PATTERN = /Last\s+updated:\s*(TODO|\d{4})/i
const TODO_LINE_PATTERN = /^- TODO\b/i

export interface MemorySummary {
  summary: string
  isPlaceholder: boolean
  sectionCount: number
}

export const PLACEHOLDER_SUMMARY = "[template placeholder — not yet populated]"
export const EMPTY_SUMMARY = "[no summary — file contains only structural content]"

export function summarizeMarkdownMemory(content: string): MemorySummary {
  const sectionCount = countSections(content)
  const isPlaceholder = detectPlaceholderContent(content)

  if (isPlaceholder) {
    return { summary: PLACEHOLDER_SUMMARY, isPlaceholder: true, sectionCount }
  }

  const summary = extractFirstMeaningfulLine(content)
  return { summary, isPlaceholder: false, sectionCount }
}

function countSections(content: string): number {
  const matches = content.match(/^## /gm)
  return matches ? matches.length : 0
}

function extractFirstMeaningfulLine(content: string): string {
  const lines = content.split("\n")
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (line.length === 0) continue
    if (line.startsWith("#")) continue
    if (LAST_UPDATED_PATTERN.test(line)) continue
    if (TODO_LINE_PATTERN.test(line)) continue

    if (line.length <= 120) return line
    return line.slice(0, 117) + "..."
  }
  return EMPTY_SUMMARY
}
