/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { migrateConfigFile } from "./config-migration"
import { getSidecarPath } from "./migrations-sidecar"

const createdDirectories: string[] = []
const MIGRATION_KEY = "model-version:anthropic/claude-opus-4-5->anthropic/claude-opus-4-7"

function createWorkdir(): string {
  const workdir = mkdtempSync(join(tmpdir(), "omo-config-migration-"))
  createdDirectories.push(workdir)
  return workdir
}

function createLegacyConfig(): Record<string, unknown> {
  return {
    agents: {
      prometheus: { model: "anthropic/claude-opus-4-5" },
    },
  }
}

afterEach(() => {
  for (const directory of createdDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("migrateConfigFile sidecar write ordering", () => {
  test("writes the migrated config before recording the sidecar when both writes succeed", () => {
    // given
    const workdir = createWorkdir()
    const configPath = join(workdir, "oh-my-opencode.json")
    const rawConfig = createLegacyConfig()

    writeFileSync(configPath, JSON.stringify(rawConfig, null, 2) + "\n")

    // when
    const needsWrite = migrateConfigFile(configPath, rawConfig)

    // then
    expect(needsWrite).toBe(true)
    expect(rawConfig._migrations).toBeUndefined()
    expect((rawConfig.agents as Record<string, Record<string, unknown>>).prometheus.model).toBe(
      "anthropic/claude-opus-4-7",
    )

    const persistedConfig = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>
    expect(persistedConfig._migrations).toBeUndefined()
    expect((persistedConfig.agents as Record<string, Record<string, unknown>>).prometheus.model).toBe(
      "anthropic/claude-opus-4-7",
    )

    const sidecar = JSON.parse(readFileSync(getSidecarPath(configPath), "utf-8")) as {
      appliedMigrations: string[]
    }
    expect(sidecar.appliedMigrations).toEqual([MIGRATION_KEY])
  })

  test("skips the sidecar when the config write fails so the migration retries on next startup", () => {
    // given
    const workdir = createWorkdir()
    const configPath = join(workdir, "missing-parent", "oh-my-opencode.json")
    const firstAttemptConfig = createLegacyConfig()

    // when
    const firstAttemptNeedsWrite = migrateConfigFile(configPath, firstAttemptConfig)

    // then
    expect(firstAttemptNeedsWrite).toBe(true)
    expect(existsSync(getSidecarPath(configPath))).toBe(false)
    expect(firstAttemptConfig._migrations).toEqual([MIGRATION_KEY])

    // given
    mkdirSync(join(workdir, "missing-parent"), { recursive: true })
    writeFileSync(configPath, JSON.stringify(createLegacyConfig(), null, 2) + "\n")
    const retriedConfig = createLegacyConfig()

    // when
    const retriedNeedsWrite = migrateConfigFile(configPath, retriedConfig)

    // then
    expect(retriedNeedsWrite).toBe(true)
    expect(retriedConfig._migrations).toBeUndefined()
    expect((retriedConfig.agents as Record<string, Record<string, unknown>>).prometheus.model).toBe(
      "anthropic/claude-opus-4-7",
    )
    expect(existsSync(getSidecarPath(configPath))).toBe(true)
  })

  test("preserves _migrations in the config when the sidecar write fails after the config write succeeds", () => {
    // given
    const workdir = createWorkdir()
    const configPath = join(workdir, "oh-my-opencode.json")
    const rawConfig = createLegacyConfig()

    writeFileSync(configPath, JSON.stringify(rawConfig, null, 2) + "\n")
    mkdirSync(getSidecarPath(configPath))

    // when
    const needsWrite = migrateConfigFile(configPath, rawConfig)

    // then
    expect(needsWrite).toBe(true)
    expect(rawConfig._migrations).toEqual([MIGRATION_KEY])
    expect((rawConfig.agents as Record<string, Record<string, unknown>>).prometheus.model).toBe(
      "anthropic/claude-opus-4-7",
    )

    const persistedConfig = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>
    expect(persistedConfig._migrations).toEqual([MIGRATION_KEY])
    expect((persistedConfig.agents as Record<string, Record<string, unknown>>).prometheus.model).toBe(
      "anthropic/claude-opus-4-7",
    )
    expect(statSync(getSidecarPath(configPath)).isDirectory()).toBe(true)
  })

  test("treats top-level appliedMigrations as migration history and does not reapply the model update", () => {
    // given
    const workdir = createWorkdir()
    const configPath = join(workdir, "oh-my-openagent.json")
    const rawConfig: Record<string, unknown> = {
      agents: {
        oracle: { model: "anthropic/claude-opus-4-6" },
      },
      appliedMigrations: ["model-version:anthropic/claude-opus-4-6->anthropic/claude-opus-4-7"],
    }

    writeFileSync(configPath, JSON.stringify(rawConfig, null, 2) + "\n")

    // when
    const needsWrite = migrateConfigFile(configPath, rawConfig)

    // then
    expect(needsWrite).toBe(true)
    expect(rawConfig.appliedMigrations).toBeUndefined()
    expect((rawConfig.agents as Record<string, Record<string, unknown>>).oracle.model).toBe(
      "anthropic/claude-opus-4-6",
    )

    const sidecar = JSON.parse(readFileSync(getSidecarPath(configPath), "utf-8")) as {
      appliedMigrations: string[]
    }
    expect(sidecar.appliedMigrations).toEqual([
      "model-version:anthropic/claude-opus-4-6->anthropic/claude-opus-4-7",
    ])
  })
})

describe("migrateConfigFile backup skipping", () => {
  test("skips backup when file content is identical after migration", () => {
    // given - config with legacy key that migrates to same on-disk content
    const workdir = createWorkdir()
    const configPath = join(workdir, "oh-my-opencode.json")
    const migratedContent = {
      disabled_hooks: ["comment-checker"],
    }

    // Write the already-migrated content to disk
    writeFileSync(configPath, JSON.stringify(migratedContent, null, 2) + "\n")

    // rawConfig still has the legacy hook that will be removed
    const rawConfig: Record<string, unknown> = {
      disabled_hooks: ["gpt-permission-continuation", "comment-checker"],
    }

    // when
    migrateConfigFile(configPath, rawConfig)

    // then - no backup file should be created since file content is unchanged
    const files = require("fs").readdirSync(workdir) as string[]
    const backupFiles = files.filter((f: string) => f.includes(".bak."))
    expect(backupFiles.length).toBe(0)
  })

  test("creates backup when file content actually changes", () => {
    // given - config with model that needs migration
    const workdir = createWorkdir()
    const configPath = join(workdir, "oh-my-opencode.json")
    const rawConfig = {
      agents: {
        prometheus: { model: "anthropic/claude-opus-4-5" },
      },
    }

    writeFileSync(configPath, JSON.stringify(rawConfig, null, 2) + "\n")

    // when
    const needsWrite = migrateConfigFile(configPath, rawConfig as Record<string, unknown>)

    // then - backup should be created since content changed
    expect(needsWrite).toBe(true)
    const files = require("fs").readdirSync(workdir) as string[]
    const backupFiles = files.filter((f: string) => f.includes(".bak."))
    expect(backupFiles.length).toBe(1)
  })
})

describe("migrateConfigFile new_task_system_enabled → experimental.task_system", () => {
  const MIGRATION_KEY_TASK_SYSTEM = "new_task_system_enabled_to_experimental_v1"

  test("migrates new_task_system_enabled: true → experimental.task_system: true", () => {
    // given
    const workdir = createWorkdir()
    const configPath = join(workdir, "oh-my-opencode.json")
    const rawConfig: Record<string, unknown> = {
      new_task_system_enabled: true,
    }

    writeFileSync(configPath, JSON.stringify(rawConfig, null, 2) + "\n")

    // when
    const needsWrite = migrateConfigFile(configPath, rawConfig)

    // then - root flag removed, experimental.task_system set
    expect(needsWrite).toBe(true)
    expect(rawConfig.new_task_system_enabled).toBeUndefined()
    const exp = rawConfig.experimental as Record<string, unknown> | undefined
    expect(exp?.task_system).toBe(true)

    // Verify config was persisted to disk
    const persistedConfig = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>
    expect(persistedConfig.new_task_system_enabled).toBeUndefined()
    const persistedExp = persistedConfig.experimental as Record<string, unknown> | undefined
    expect(persistedExp?.task_system).toBe(true)
  })

  test("does not override existing experimental.task_system when new_task_system_enabled set", () => {
    // given
    const workdir = createWorkdir()
    const configPath = join(workdir, "oh-my-opencode.json")
    const rawConfig: Record<string, unknown> = {
      new_task_system_enabled: true,
      experimental: { task_system: false },
    }

    writeFileSync(configPath, JSON.stringify(rawConfig, null, 2) + "\n")

    // when
    const needsWrite = migrateConfigFile(configPath, rawConfig)

    // then - existing experimental.task_system preserved
    expect(needsWrite).toBe(true)
    expect(rawConfig.new_task_system_enabled).toBeUndefined()
    const exp = rawConfig.experimental as Record<string, unknown> | undefined
    expect(exp?.task_system).toBe(false)
  })

  test("no change when new_task_system_enabled is not present", () => {
    // given
    const workdir = createWorkdir()
    const configPath = join(workdir, "oh-my-opencode.json")
    const rawConfig: Record<string, unknown> = {
      experimental: { preemptive_compaction: true },
    }

    writeFileSync(configPath, JSON.stringify(rawConfig, null, 2) + "\n")

    // when
    const needsWrite = migrateConfigFile(configPath, rawConfig)

    // then - no migration triggered
    expect(needsWrite).toBe(false)
    expect(rawConfig.new_task_system_enabled).toBeUndefined()
    expect(rawConfig.experimental).toEqual({ preemptive_compaction: true })
  })

  test("idempotent: applying twice does not duplicate migration", () => {
    // given
    const workdir = createWorkdir()
    const configPath = join(workdir, "oh-my-opencode.json")
    const rawConfig: Record<string, unknown> = {
      new_task_system_enabled: true,
    }

    writeFileSync(configPath, JSON.stringify(rawConfig, null, 2) + "\n")

    // when - first migration
    const firstNeedsWrite = migrateConfigFile(configPath, rawConfig)
    expect(firstNeedsWrite).toBe(true)

    // given - second run: re-read from disk, which has the migrated content
    const reReadConfig = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>
    // Re-inject the raw config state (mutated by first pass)
    const rawConfig2 = { ...reReadConfig }
    // when - second migration
    const secondNeedsWrite = migrateConfigFile(configPath, rawConfig2)

    // then - no additional write since already migrated (idempotent via config state)
    expect(secondNeedsWrite).toBe(false)
    expect(rawConfig2.new_task_system_enabled).toBeUndefined()
  })
})
