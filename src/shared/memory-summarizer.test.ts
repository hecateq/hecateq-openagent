import { describe, expect, it } from "bun:test"

import {
  summarizeMarkdownMemory,
  PLACEHOLDER_SUMMARY,
  EMPTY_SUMMARY,
} from "./memory-summarizer"

describe("memory-summarizer", () => {
  describe("summarizeMarkdownMemory", () => {
    it("detects placeholder-only content", () => {
      // given
      const content = `# Active Context

Last updated: TODO

## Current Goal
- TODO

## Current State
- TODO
`

      // when
      const result = summarizeMarkdownMemory(content)

      // then
      expect(result.isPlaceholder).toBe(true)
      expect(result.summary).toBe(PLACEHOLDER_SUMMARY)
    })

    it("extracts first meaningful line from populated content", () => {
      // given
      const content = `# Active Context

Last updated: 2026-05-25

## Current Goal
Build the memory manifest system for OpenAgent.

## Current State
Implementation in progress — bootstrap, manifest, and doctor checks done.
`

      // when
      const result = summarizeMarkdownMemory(content)

      // then
      expect(result.isPlaceholder).toBe(false)
      expect(result.summary).toBe("Build the memory manifest system for OpenAgent.")
    })

    it("returns placeholder for content with only headings", () => {
      // given
      const content = `# Active Context

Last updated: 2026-05-25

## Current Goal

## Current State
`

      // when
      const result = summarizeMarkdownMemory(content)

      // then — content with only headings and a date is still a placeholder
      expect(result.isPlaceholder).toBe(true)
      expect(result.summary).toBe(PLACEHOLDER_SUMMARY)
    })

    it("counts sections correctly", () => {
      // given
      const content = `# Title

## Section One
content

## Section Two
more content

## Section Three
even more
`

      // when
      const result = summarizeMarkdownMemory(content)

      // then
      expect(result.sectionCount).toBe(3)
    })

    it("detects empty content as placeholder", () => {
      // given
      const content = ""

      // when
      const result = summarizeMarkdownMemory(content)

      // then
      expect(result.isPlaceholder).toBe(true)
      expect(result.summary).toBe(PLACEHOLDER_SUMMARY)
    })

    it("detects whitespace-only content as placeholder", () => {
      // given
      const content = "   \n  \n  "

      // when
      const result = summarizeMarkdownMemory(content)

      // then
      expect(result.isPlaceholder).toBe(true)
    })

    it("detects content with only headings and last-updated lines", () => {
      // given
      const content = `# Progress

Last updated: 2026-05-25

## Completed
- TODO

## In Progress
- TODO
`

      // when
      const result = summarizeMarkdownMemory(content)

      // then
      expect(result.isPlaceholder).toBe(true)
    })

    it("truncates long summary lines to 120 chars", () => {
      // given
      const longLine = "This is a very long summary line that goes on and on for more than one hundred and twenty characters to test the truncation behavior of the summarizer function"
      const content = `# File Map

Last updated: 2026-05-25

${longLine}
`

      // when
      const result = summarizeMarkdownMemory(content)

      // then
      expect(result.isPlaceholder).toBe(false)
      expect(result.summary.length).toBeLessThanOrEqual(120)
      expect(result.summary.endsWith("...")).toBe(true)
    })

    it("skips heading lines and TODO items when extracting summary", () => {
      // given
      const content = `# Tasks

Last updated: 2026-05-25

## Pending
- TODO: Implement manifest system

## Blocked
- TODO: Add lock support

## Done
Deployed the initial memory bootstrap.
`

      // when
      const result = summarizeMarkdownMemory(content)

      // then
      expect(result.isPlaceholder).toBe(false)
      expect(result.summary).toBe("Deployed the initial memory bootstrap.")
    })
  })
})
