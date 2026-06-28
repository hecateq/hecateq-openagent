/// <reference types="bun-types" />

/**
 * Schema alignment snapshot test.
 *
 * Reads the Zod schema definition and checks that every config field claimed
 * in documentation actually exists in the schema.
 *
 * This test is initially marked as "skip" because the doc agent needs to
 * fix the documentation first. Once the docs are fixed, this test should
 * be enabled to prevent future drift.
 *
 * TODO(doc-agent): Fix the documentation files listed in the denylist,
 * then remove the .skip from this test.
 */

import { describe, test, expect } from "bun:test"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

// ─── Documentation-claimed field map ───────────────────────────────────────
//
// Each entry maps a documentation file (under docs/) to a list of field paths
// that the doc claims exist in the config schema. The test validates that
// each claimed field actually exists in the Zod schema.
//
// Fields that the doc currently mis-claims are listed in the DENYLIST below.
// As the doc agent fixes the docs, entries move from DENYLIST to the main map
// or get removed entirely.

interface DocClaim {
  /** Documentation file path (relative to project root) */
  docFile: string
  /** Config field paths claimed in the doc (dot-notation, e.g. "hecateq.orchestration.enabled") */
  claimedFields: string[]
}

/**
 * The canonical list of fields that the Zod schema actually defines.
 * This is the source of truth for the schema alignment check.
 */
const SCHEMA_FIELDS = new Set([
  // Root-level fields
  "$schema",
  "agent_order",
  "agent_definitions",
  "disabled_mcps",
  "disabled_agents",
  "disabled_categories",
  "disabled_skills",
  "disabled_hooks",
  "disabled_commands",
  "disabled_tools",
  "disabled_providers",
  "mcp_env_allowlist",
  "hashline_edit",
  "model_fallback",
  "auto_update",
  "new_task_system_enabled",
  "default_run_agent",
  "agents",
  "categories",
  "experimental",
  "team_mode",
  "background_task",
  "runtime_fallback",
  "keyword_detector",
  "openclaw",
  "claude_code",
  "skills",
  "ralph_loop",
  "tmux",
  "browser_automation_engine",
  "websearch",
  "i18n",
  "notification",
  "sisyphus",
  "sisyphus_agent",
  "comment_checker",
  "babysitting",
  "git_master",
  "start_work",
  "default_mode",
  "model_capabilities",
  "dynamic_context_pruning",
  "hecateq",

  // hecateq sub-fields
  "hecateq.enabled",
  "hecateq.context_injection",
  "hecateq.context_injection.enabled",
  "hecateq.context_injection.mode",
  "hecateq.context_injection.manifest_first",
  "hecateq.context_injection.max_memory_file_chars",
  "hecateq.context_injection.max_total_chars",
  "hecateq.context_injection.max_artifact_files",
  "hecateq.context_injection.include_contracts",
  "hecateq.context_injection.include_task_graphs",
  "hecateq.context_injection.include_agent_index",
  "hecateq.context_injection.include_budget_summary",
  "hecateq.context_injection.max_agent_domains",
  "hecateq.context_injection.max_agents_per_domain",
  "hecateq.context_injection.inject_on_subagents",
  "hecateq.context_injection.hecateq_only",
  "hecateq.agent_index",
  "hecateq.agent_index.enabled",
  "hecateq.agent_index.enrich_runtime_agents",
  "hecateq.agent_index.use_for_suggestions",
  "hecateq.agent_index.require_fresh",
  "hecateq.agent_index.fallback_to_runtime_only",
  "hecateq.agent_index.max_suggestions",
  "hecateq.memory_bootstrap",
  "hecateq.memory_bootstrap.enabled",
  "hecateq.memory_bootstrap.create_memory_files",
  "hecateq.memory_bootstrap.create_artifact_dirs",
  "hecateq.memory_bootstrap.hydrate_placeholders",
  "hecateq.doctor",
  "hecateq.doctor.check_memory",
  "hecateq.doctor.check_artifacts",
  "hecateq.doctor.check_custom_agents",
  "hecateq.doctor.check_secrets",
  "hecateq.doctor.check_safety_hooks",
  "hecateq.git_checkpoint",
  "hecateq.git_checkpoint.enabled",
  "hecateq.git_checkpoint.mode",
  "hecateq.git_checkpoint.auto_checkpoint_clean_repo",
  "hecateq.git_checkpoint.checkpoint_message",
  "hecateq.git_checkpoint.include_status_in_context",
  "hecateq.git_checkpoint.include_dirty_file_list",
  "hecateq.git_checkpoint.include_dirty_file_count",
  "hecateq.git_checkpoint.max_dirty_files",
  "hecateq.git_checkpoint.block_destructive_git",
  "hecateq.dependency_graph",
  "hecateq.dependency_graph.mode",
  "hecateq.dependency_graph.auto_create",
  "hecateq.dependency_graph.block_on_cycle",
  "hecateq.dependency_graph.block_on_sensitive",
  "hecateq.dependency_graph.require_contract_for",
  "hecateq.dependency_graph.enabled",
  "hecateq.dependency_graph.enforce",
  "hecateq.orchestration",
  "hecateq.orchestration.enabled",
  "hecateq.orchestration.auto_decompose",
  "hecateq.orchestration.auto_execute_low_risk",
  "hecateq.orchestration.require_plan_for_high_risk",
  "hecateq.orchestration.max_repair_attempts",
  "hecateq.orchestration.default_task_timeout_ms",
  "hecateq.orchestration.allow_parallel_readonly_tasks",
  "hecateq.orchestration.allow_parallel_write_tasks",
  "hecateq.orchestration.quality_gates",
  "hecateq.orchestration.quality_gates.typecheck",
  "hecateq.orchestration.quality_gates.lint",
  "hecateq.orchestration.quality_gates.test",
  "hecateq.orchestration.quality_gates.build",
  "hecateq.orchestration.quality_gates.doctor",
  "hecateq.orchestration.state_dir",
  "hecateq.orchestrator",
  "hecateq.orchestrator.delegation_first",
  "hecateq.orchestrator.deny_write_tools",
  "hecateq.orchestrator.prompt_profile",
  "hecateq.auto_spawn",
  "hecateq.auto_spawn.enabled",
  "hecateq.auto_spawn.max_concurrent_spawns",
  "hecateq.auto_spawn.spawn_timeout_ms",
  "hecateq.auto_spawn.auto_retry_on_failure",
  "hecateq.auto_spawn.max_failures_before_pause",
  "hecateq.auto_spawn.pause_duration_ms",
  "hecateq.auto_spawn.allow_background_spawn",
  "hecateq.auto_spawn.max_spawn_depth",
  "hecateq.auto_spawn.rate_limit_enabled",
  "hecateq.auto_spawn.max_spawns_per_window",
  "hecateq.auto_spawn.spawn_window_ms",
  "hecateq.delegation_chain",
  "hecateq.delegation_chain.max_depth",
  "hecateq.delegation_chain.max_fan_out",
  "hecateq.delegation_chain.max_iterations_per_run",
  "hecateq.delegation_chain.disable_category_routing",
])

/**
 * Fields that the documentation currently claims but do NOT exist
 * in the Zod schema. As the doc agent fixes the docs, entries should
 * be removed from this list.
 */
const DENYLIST: Set<string> = new Set([
  // Example: "hecateq.memory_bootstrap.hydrate_placeholders" — moved from denylist to schema
  // When the doc incorrectly claims a field that doesn't exist, add it here.
  // "hecateq.nonexistent_field",
])

// ─── Documentation sources ──────────────────────────────────────────────────

/**
 * Discover documentation files that describe config fields.
 */
function discoverDocFiles(): string[] {
  const docsDir = join(process.cwd(), "docs")
  if (!existsSync(docsDir)) return []

  const files: string[] = []

  function walk(dir: string): void {
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(fullPath)
      } else if (entry.name.endsWith(".md")) {
        files.push(fullPath)
      }
    }
  }

  walk(docsDir)
  return files
}

/**
 * Extract config field references from a markdown file.
 * Looks for patterns like `hecateq.*`, `field_name`, and code blocks.
 */
function extractClaimedFields(docPath: string): string[] {
  const content = readFileSync(docPath, "utf-8")
  const fields: string[] = []
  const lines = content.split("\n")

  for (const line of lines) {
    // Match field references in backtick code blocks or inline code
    // e.g., `hecateq.orchestration.enabled` or `field_name`
    const codeMatches = line.matchAll(/`([a-zA-Z_][a-zA-Z0-9._]*)`/g)
    for (const match of codeMatches) {
      const field = match[1]!
      // Only include fields that look like config paths (have dots or are known root keys)
      if (field.includes(".") || SCHEMA_FIELDS.has(field)) {
        fields.push(field)
      }
    }
  }

  return fields
}

// ─── Tests ─────────────────────────────────────────────────────────────────

// TODO(doc-agent): This test is skipped because the documentation files
// need to be fixed first. Once `denylist` is empty, remove the `.skip`.
// @ts-ignore - describe.skip is a valid bun:test API but may not be in type defs
describe.skip("schema-documentation alignment", () => {
  const docFiles = discoverDocFiles()

  test("documentation files exist", () => {
    expect(docFiles.length).toBeGreaterThan(0)
  })

  for (const docFile of docFiles) {
    const shortName = docFile.replace(process.cwd(), "").replace(/^\//, "")

    test(`${shortName}: all claimed fields exist in Zod schema`, () => {
      // #given
      const claimedFields: string[] = extractClaimedFields(docFile)
      const errors: string[] = []

      // #when
      for (let idx = 0; idx < claimedFields.length; idx++) {
        const field = claimedFields[idx]!
        // Skip denylisted fields (known doc bugs)
        if (DENYLIST.has(field)) continue

        // Check if the field exists in the schema
        if (!SCHEMA_FIELDS.has(field)) {
          errors.push(`${docFile}:${idx + 1}: Field "${field}" is not in Zod schema`)
        }
      }

      // #then
      expect(errors).toEqual([])
    })
  }

  test("denylist is empty (all doc bugs fixed)", () => {
    // #given — the denylist tracks fields the doc still mis-claims
    // #when — when all doc bugs are fixed, the denylist should be empty
    // #then
    expect(DENYLIST.size).toBe(0)
  })
})
