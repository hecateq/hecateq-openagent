/// <reference path="../../bun-test.d.ts" />

import { describe, expect, it } from "bun:test"
import { isCanonicalEntry, isLegacyEntry, toCanonicalEntry } from "./plugin-entry-migrator"

describe("plugin-entry-migrator", () => {
  describe("toCanonicalEntry", () => {
    it("canonicalizes oh-my-opencode to @hecateq/hecateq-openagent", () => {
      // given
      const legacyEntry = "oh-my-opencode"

      // when
      const result = toCanonicalEntry(legacyEntry)

      // then
      expect(result).toBe("@hecateq/hecateq-openagent")
    })

    it("canonicalizes oh-my-openagent to @hecateq/hecateq-openagent", () => {
      // given
      const legacyEntry = "oh-my-openagent"

      // when
      const result = toCanonicalEntry(legacyEntry)

      // then
      expect(result).toBe("@hecateq/hecateq-openagent")
    })

    it("canonicalizes oh-my-opencode@version preserving the version", () => {
      // given
      const legacyEntry = "oh-my-opencode@3.11.0"

      // when
      const result = toCanonicalEntry(legacyEntry)

      // then
      expect(result).toBe("@hecateq/hecateq-openagent@3.11.0")
    })

    it("canonicalizes oh-my-openagent@version preserving the version", () => {
      // given
      const legacyEntry = "oh-my-openagent@3.11.0"

      // when
      const result = toCanonicalEntry(legacyEntry)

      // then
      expect(result).toBe("@hecateq/hecateq-openagent@3.11.0")
    })

    it("passes through non-legacy entries unchanged", () => {
      // given
      const entry = "other-plugin@1.0.0"

      // when
      const result = toCanonicalEntry(entry)

      // then
      expect(result).toBe(entry)
    })
  })

  describe("isCanonicalEntry", () => {
    it("recognizes @hecateq/hecateq-openagent as canonical", () => {
      // given
      const entry = "@hecateq/hecateq-openagent"

      // when
      const result = isCanonicalEntry(entry)

      // then
      expect(result).toBe(true)
    })

    it("recognizes @hecateq/hecateq-openagent@version as canonical", () => {
      // given
      const entry = "@hecateq/hecateq-openagent@4.2.0"

      // when
      const result = isCanonicalEntry(entry)

      // then
      expect(result).toBe(true)
    })

    it("does not mistake oh-my-openagent as canonical when target is @hecateq/hecateq-openagent", () => {
      // given
      const entry = "oh-my-openagent"

      // when
      const result = isCanonicalEntry(entry)

      expect(result).toBe(false)
    })
  })

  describe("isLegacyEntry", () => {
    it("recognizes oh-my-opencode as legacy", () => {
      expect(isLegacyEntry("oh-my-opencode")).toBe(true)
      expect(isLegacyEntry("oh-my-opencode@3.11.0")).toBe(true)
    })

    it("recognizes oh-my-openagent as legacy", () => {
      expect(isLegacyEntry("oh-my-openagent")).toBe(true)
      expect(isLegacyEntry("oh-my-openagent@4.2.0")).toBe(true)
    })

    it("does not recognize @hecateq/hecateq-openagent as legacy", () => {
      expect(isLegacyEntry("@hecateq/hecateq-openagent")).toBe(false)
    })
  })
})
