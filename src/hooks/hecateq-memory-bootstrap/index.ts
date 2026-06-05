import type { PluginInput } from "@opencode-ai/plugin"

import {
  bootstrapMemoryFiles,
  bootstrapMemoryManifest,
  bootstrapMemoryPointer,
  findProjectRoot,
  isProjectRoot,
  resolveSessionRoot,
  type BootstrapOptions,
  type BootstrapResult,
} from "../../shared/memory-bootstrap"
import { log } from "../../shared/logger"
import { showHecateqToastSafe } from "../../shared/hecateq-toast"

export {
  FILE_TEMPLATES,
  PROJECT_ARTIFACT_DIRS,
  PROJECT_CONTRACTS_DIR,
  PROJECT_MEMORY_DIR,
  PROJECT_MEMORY_FILES,
  PROJECT_MEMORY_OPTIONAL_FILES,
  PROJECT_MEMORY_MANIFEST,
  PROJECT_TASK_GRAPHS_DIR,
  bootstrapMemoryFiles,
  bootstrapMemoryManifest,
  bootstrapMemoryPointer,
  isProjectRoot,
  findProjectRoot,
  resolveSessionRoot,
} from "../../shared/memory-bootstrap"
export type { BootstrapResult, ManifestBootstrapResult, PointerBootstrapResult } from "../../shared/memory-bootstrap"

export const HOOK_NAME = "hecateq-memory-bootstrap" as const

export type HecateqMemoryBootstrapHook = {
  HOOK_NAME: typeof HOOK_NAME
  bootstrapMemoryFiles: typeof bootstrapMemoryFiles
  isProjectRoot: typeof isProjectRoot
  findProjectRoot: typeof findProjectRoot
  resolveSessionRoot: typeof resolveSessionRoot
  event: (input: { event: { type: string; properties?: unknown } }) => Promise<void>
}

export type HecateqMemoryBootstrapHookConfig = {
  hydrate_placeholders?: boolean
}

/**
 * Factory function creating a Hecateq memory bootstrap hook.
 *
 * Trigger: fires once on the first `session.created` event for a
 * non-subagent session. Finds the project root from `ctx.directory`,
 * then creates the `.opencode/state/memory/` directory,
 * the `.opencode/contracts/` and `.opencode/task-graphs/` directories,
 * and any missing memory template files.
 *
 * Safety properties:
 * - Fires at most once (fired guard).
 * - Skips subagent sessions (parentID check).
 * - Never overwrites existing files.
 * - All filesystem errors are caught and logged as warnings.
 * - Disableable via `disabled_hooks: ["hecateq-memory-bootstrap"]`.
 * - When hydrate_placeholders is true (default), existing placeholder
 *   files are hydrated with deterministic starter content.
 */
export function createHecateqMemoryBootstrapHook(
  ctx: PluginInput,
  memoryBootstrapConfig?: HecateqMemoryBootstrapHookConfig,
): HecateqMemoryBootstrapHook {
  let fired = false

  const event = async (input: { event: { type: string; properties?: unknown } }): Promise<void> => {
    if (input.event.type !== "session.created" || fired) return

    const props = input.event.properties as { info?: { parentID?: string } } | undefined
    if (props?.info?.parentID) return

    fired = true

    const directory = typeof ctx.directory === "string" ? ctx.directory : process.cwd()
    const rootContract = resolveSessionRoot(directory)

    if (!rootContract) {
      log(`[${HOOK_NAME}] No project root found from ${directory}; skipping bootstrap`, {
        directory,
      })
      return
    }

    const projectRoot = rootContract.projectRoot
    const bootstrapOptions: BootstrapOptions = {
      hydratePlaceholders: memoryBootstrapConfig?.hydrate_placeholders !== false,
    }
    const result: BootstrapResult = bootstrapMemoryFiles(projectRoot, bootstrapOptions)

    const manifestResult = bootstrapMemoryManifest(projectRoot, "opencode")
    if (manifestResult.created) {
      log(`[${HOOK_NAME}] Bootstrapped memory manifest in ${projectRoot}`)
    }

    const pointerResult = bootstrapMemoryPointer(projectRoot)
    if (pointerResult.created) {
      log(`[${HOOK_NAME}] Bootstrapped memory pointer in ${projectRoot}`)
    }

    if (result.errors.length > 0) {
      log(`[${HOOK_NAME}] Memory bootstrap completed with warnings in ${projectRoot}`, {
        rootSource: rootContract.source,
        created: result.created,
        hydrated: result.hydrated,
        skipped: result.skipped,
        dirCreated: result.dirCreated,
        artifactDirsCreated: result.artifactDirsCreated,
        errors: result.errors,
      })
      void showHecateqToastSafe(ctx.client, {
        kind: "memory",
        title: `Memory bootstrap had ${result.errors.length} warning(s)`,
        message: result.errors.slice(0, 3).join("; "),
        variant: "warning",
      })
      return
    }

    if (result.created.length > 0 || result.hydrated.length > 0 || result.dirCreated || result.artifactDirsCreated.length > 0) {
      log(`[${HOOK_NAME}] Bootstrapped memory files in ${projectRoot}`, {
        rootSource: rootContract.source,
        created: result.created,
        hydrated: result.hydrated,
        dirCreated: result.dirCreated,
        artifactDirsCreated: result.artifactDirsCreated,
      })
    } else {
      log(`[${HOOK_NAME}] Memory files already up to date in ${projectRoot}`, {
        rootSource: rootContract.source,
        skipped: result.skipped,
      })
    }
  }

  return {
    HOOK_NAME,
    bootstrapMemoryFiles,
    isProjectRoot,
    findProjectRoot,
    resolveSessionRoot,
    event,
  }
}
