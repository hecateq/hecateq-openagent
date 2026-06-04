import { describe, expect, it } from "bun:test"
import { generateHecateqProfileConfig, describeHecateqProfile, formatHecateqProfileSummary } from "./generate-hecateq-config"

describe("generateHecateqProfileConfig", () => {
  // given
  describe("#recommended", () => {
    // when
    const config = generateHecateqProfileConfig("recommended")

    // then
    it("returns a non-null config", () => {
      expect(config).not.toBeNull()
    })

    it("enables hecateq", () => {
      expect(config?.enabled).toBe(true)
    })

    it("enables context injection with compact mode", () => {
      const ci = config?.context_injection as Record<string, unknown> | undefined
      expect(ci?.enabled).toBe(true)
      expect(ci?.mode).toBe("compact")
      expect(ci?.hecateq_only).toBe(true)
      expect(ci?.inject_on_subagents).toBe(false)
    })

    it("enables memory bootstrap with artifact dirs", () => {
      const mb = config?.memory_bootstrap as Record<string, unknown> | undefined
      expect(mb?.enabled).toBe(true)
      expect(mb?.create_memory_files).toBe(true)
      expect(mb?.create_artifact_dirs).toBe(true)
    })

    it("enables agent index with runtime fallback", () => {
      const ai = config?.agent_index as Record<string, unknown> | undefined
      expect(ai?.enabled).toBe(true)
      expect(ai?.fallback_to_runtime_only).toBe(true)
      expect(ai?.require_fresh).toBe(false)
    })

    it("sets git checkpoint to suggest mode with no auto commits", () => {
      const gc = config?.git_checkpoint as Record<string, unknown> | undefined
      expect(gc?.mode).toBe("suggest")
      expect(gc?.auto_checkpoint_clean_repo).toBe(false)
      expect(gc?.include_dirty_file_list).toBe(false)
      expect(gc?.include_dirty_file_count).toBe(true)
    })

    it("enables all doctor checks", () => {
      const dc = config?.doctor as Record<string, unknown> | undefined
      expect(dc?.check_memory).toBe(true)
      expect(dc?.check_artifacts).toBe(true)
      expect(dc?.check_custom_agents).toBe(true)
      expect(dc?.check_secrets).toBe(true)
      expect(dc?.check_safety_hooks).toBe(true)
    })
  })

  describe("#minimal", () => {
    // when
    const config = generateHecateqProfileConfig("minimal")

    // then
    it("returns a non-null config", () => {
      expect(config).not.toBeNull()
    })

    it("enables hecateq", () => {
      expect(config?.enabled).toBe(true)
    })

    it("disables context injection", () => {
      const ci = config?.context_injection as Record<string, unknown> | undefined
      expect(ci?.enabled).toBe(false)
      expect(ci?.mode).toBe("off")
    })

    it("enables memory bootstrap without artifact dirs", () => {
      const mb = config?.memory_bootstrap as Record<string, unknown> | undefined
      expect(mb?.enabled).toBe(true)
      expect(mb?.create_memory_files).toBe(true)
      expect(mb?.create_artifact_dirs).toBe(false)
    })

    it("enables agent index for suggestions only", () => {
      const ai = config?.agent_index as Record<string, unknown> | undefined
      expect(ai?.enabled).toBe(true)
      expect(ai?.enrich_runtime_agents).toBe(true)
      expect(ai?.use_for_suggestions).toBe(true)
    })

    it("sets git checkpoint to suggest mode without dirty file count", () => {
      const gc = config?.git_checkpoint as Record<string, unknown> | undefined
      expect(gc?.mode).toBe("suggest")
      expect(gc?.include_dirty_file_count).toBe(false)
      expect(gc?.include_dirty_file_list).toBe(false)
    })

    it("enables all doctor checks", () => {
      const dc = config?.doctor as Record<string, unknown> | undefined
      expect(dc?.check_memory).toBe(true)
      expect(dc?.check_artifacts).toBe(true)
      expect(dc?.check_custom_agents).toBe(true)
      expect(dc?.check_secrets).toBe(true)
      expect(dc?.check_safety_hooks).toBe(true)
    })
  })

  describe("#advanced", () => {
    // when
    const config = generateHecateqProfileConfig("advanced")

    // then
    it("returns null (no config block — preserve existing or runtime defaults)", () => {
      expect(config).toBeNull()
    })
  })
})

describe("describeHecateqProfile", () => {
  it("returns a non-empty description for recommended", () => {
    // given/when/then
    const desc = describeHecateqProfile("recommended")
    expect(desc.length).toBeGreaterThan(10)
    expect(desc).toContain("compact")
  })

  it("returns a non-empty description for minimal", () => {
    // given/when/then
    const desc = describeHecateqProfile("minimal")
    expect(desc.length).toBeGreaterThan(10)
    expect(desc).toContain("disabled")
  })

  it("returns a non-empty description for advanced", () => {
    // given/when/then
    const desc = describeHecateqProfile("advanced")
    expect(desc.length).toBeGreaterThan(10)
    expect(desc).toContain("runtime schema defaults")
    expect(desc).toContain("preserves")
  })
})

describe("formatHecateqProfileSummary", () => {
  it("returns 6 lines for recommended", () => {
    // given/when/then
    const lines = formatHecateqProfileSummary("recommended")
    expect(lines.length).toBe(6)
    expect(lines[0]).toContain("enabled")
  })

  it("returns 6 lines for minimal", () => {
    // given/when/then
    const lines = formatHecateqProfileSummary("minimal")
    expect(lines.length).toBe(6)
    expect(lines[1]).toContain("off")
  })

  it("returns 2 lines for advanced stating no block written", () => {
    // given/when/then
    const lines = formatHecateqProfileSummary("advanced")
    expect(lines.length).toBe(2)
    expect(lines[0]).toContain("no config block written")
    expect(lines[1]).toContain("runtime defaults apply otherwise")
  })
})
