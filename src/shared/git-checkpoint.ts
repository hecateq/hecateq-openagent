import { execFileSync } from "node:child_process"

import {
  DEFAULT_HECATEQ_GIT_CHECKPOINT_CONFIG,
  DEFAULT_HECATEQ_GIT_CHECKPOINT_MESSAGE,
  type HecateqGitCheckpointConfig,
  type HecateqGitCheckpointMode,
} from "../config/schema/hecateq"

const GIT_COMMAND_TIMEOUT_MS = 5000

const NON_INTERACTIVE_GIT_ENV: NodeJS.ProcessEnv = {
  GIT_TERMINAL_PROMPT: "0",
  GCM_INTERACTIVE: "never",
  GIT_EDITOR: ":",
  EDITOR: ":",
  VISUAL: "",
  GIT_SEQUENCE_EDITOR: ":",
  GIT_MERGE_AUTOEDIT: "no",
  GIT_PAGER: "cat",
  PAGER: "cat",
}

export type GitCheckpointState = {
  kind: "CLEAN_REPO" | "DIRTY_REPO" | "NO_GIT_REPOSITORY" | "GIT_ERROR"
  projectRoot: string
  dirtyFiles?: string[]
  dirtyFileCount?: number
  truncated?: boolean
  checkpointCreated?: boolean
  checkpointCommit?: string
  message?: string
}

export type ResolvedGitCheckpointOptions = {
  enabled: boolean
  mode: HecateqGitCheckpointMode
  autoCheckpointCleanRepo: boolean
  checkpointMessage: string
  includeStatusInContext: boolean
  includeDirtyFileList: boolean
  includeDirtyFileCount: boolean
  maxDirtyFiles: number
  blockDestructiveGit: boolean
}

type GitCommandResult = {
  success: boolean
  stdout: string
  stderr: string
}

function normalizeCheckpointMessage(message: string | undefined): string {
  const trimmed = message?.trim()
  return trimmed && trimmed.length > 0
    ? trimmed
    : DEFAULT_HECATEQ_GIT_CHECKPOINT_MESSAGE
}

function normalizeDirtyFileLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit) || limit === undefined) {
    return DEFAULT_HECATEQ_GIT_CHECKPOINT_CONFIG.max_dirty_files
  }

  return Math.max(0, Math.min(500, Math.trunc(limit)))
}

export function resolveGitCheckpointOptions(
  config: Partial<HecateqGitCheckpointConfig> | undefined,
): ResolvedGitCheckpointOptions {
  return {
    enabled: config?.enabled ?? DEFAULT_HECATEQ_GIT_CHECKPOINT_CONFIG.enabled,
    mode: config?.mode ?? DEFAULT_HECATEQ_GIT_CHECKPOINT_CONFIG.mode,
    autoCheckpointCleanRepo:
      config?.auto_checkpoint_clean_repo
      ?? DEFAULT_HECATEQ_GIT_CHECKPOINT_CONFIG.auto_checkpoint_clean_repo,
    checkpointMessage: normalizeCheckpointMessage(config?.checkpoint_message),
    includeStatusInContext:
      config?.include_status_in_context
      ?? DEFAULT_HECATEQ_GIT_CHECKPOINT_CONFIG.include_status_in_context,
    includeDirtyFileList:
      config?.include_dirty_file_list
      ?? DEFAULT_HECATEQ_GIT_CHECKPOINT_CONFIG.include_dirty_file_list,
    includeDirtyFileCount:
      config?.include_dirty_file_count
      ?? DEFAULT_HECATEQ_GIT_CHECKPOINT_CONFIG.include_dirty_file_count,
    maxDirtyFiles: normalizeDirtyFileLimit(config?.max_dirty_files),
    blockDestructiveGit:
      config?.block_destructive_git
      ?? DEFAULT_HECATEQ_GIT_CHECKPOINT_CONFIG.block_destructive_git,
  }
}

function runGitCommand(projectRoot: string, args: string[]): GitCommandResult {
  try {
    const stdout = execFileSync("git", args, {
      cwd: projectRoot,
      encoding: "utf-8",
      timeout: GIT_COMMAND_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ...NON_INTERACTIVE_GIT_ENV,
      },
    })

    return {
      success: true,
      stdout: stdout.trimEnd(),
      stderr: "",
    }
  } catch (error) {
    const withStreams = error as { stdout?: string | Buffer; stderr?: string | Buffer; message?: string }
    const stdout = typeof withStreams.stdout === "string"
      ? withStreams.stdout
      : withStreams.stdout?.toString("utf-8") ?? ""
    const stderr = typeof withStreams.stderr === "string"
      ? withStreams.stderr
      : withStreams.stderr?.toString("utf-8") ?? withStreams.message ?? ""

    return {
      success: false,
      stdout: stdout.trimEnd(),
      stderr: stderr.trimEnd(),
    }
  }
}

function parseDirtyFiles(
  statusOutput: string,
  options: ResolvedGitCheckpointOptions,
): Pick<GitCheckpointState, "dirtyFiles" | "dirtyFileCount" | "truncated"> {
  const dirtyFiles = statusOutput
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => line.slice(3).trim())
    .filter(Boolean)

  const dirtyFileCount = dirtyFiles.length
  const shouldIncludeFileList = options.includeDirtyFileList && options.maxDirtyFiles > 0
  const limitedDirtyFiles = shouldIncludeFileList
    ? dirtyFiles.slice(0, options.maxDirtyFiles)
    : undefined

  return {
    dirtyFiles: limitedDirtyFiles,
    dirtyFileCount,
    truncated: shouldIncludeFileList ? dirtyFiles.length > options.maxDirtyFiles : false,
  }
}

function shouldCreateAutomaticCheckpoint(options: ResolvedGitCheckpointOptions): boolean {
  return options.mode === "auto_clean_only" && options.autoCheckpointCleanRepo
}

export function detectGitState(
  projectRoot: string,
  config?: Partial<HecateqGitCheckpointConfig>,
): GitCheckpointState {
  const options = resolveGitCheckpointOptions(config)

  const gitRepoCheck = runGitCommand(projectRoot, ["rev-parse", "--is-inside-work-tree"])
  if (!gitRepoCheck.success) {
    const message = gitRepoCheck.stderr || gitRepoCheck.stdout
    if (/enoent|not found/i.test(message)) {
      return {
        kind: "GIT_ERROR",
        projectRoot,
        checkpointCreated: false,
        message: message || "Git executable is not available.",
      }
    }

    return {
      kind: "NO_GIT_REPOSITORY",
      projectRoot,
      checkpointCreated: false,
      message: message || "Git repository not found.",
    }
  }

  if (gitRepoCheck.stdout !== "true") {
    return {
      kind: "GIT_ERROR",
      projectRoot,
      checkpointCreated: false,
      message: `Unexpected git repository check output: ${gitRepoCheck.stdout || "[empty]"}`,
    }
  }

  const statusResult = runGitCommand(projectRoot, ["status", "--short"])
  if (!statusResult.success) {
    return {
      kind: "GIT_ERROR",
      projectRoot,
      checkpointCreated: false,
      message: statusResult.stderr || "Failed to read git status.",
    }
  }

  if (statusResult.stdout.length > 0) {
    return {
      kind: "DIRTY_REPO",
      projectRoot,
      checkpointCreated: false,
      message: "Repository has uncommitted changes. Automatic checkpoint skipped.",
      ...parseDirtyFiles(statusResult.stdout, options),
    }
  }

  if (!shouldCreateAutomaticCheckpoint(options)) {
    return {
      kind: "CLEAN_REPO",
      projectRoot,
      checkpointCreated: false,
      message: options.mode === "suggest"
        ? "Repository is clean. Automatic checkpoint is disabled in suggest mode."
        : "Repository is clean. Automatic checkpoint is disabled by config.",
    }
  }

  const commitResult = runGitCommand(projectRoot, [
    "commit",
    "--allow-empty",
    "-m",
    options.checkpointMessage,
  ])
  if (!commitResult.success) {
    return {
      kind: "GIT_ERROR",
      projectRoot,
      checkpointCreated: false,
      message: commitResult.stderr || "Failed to create git checkpoint commit.",
    }
  }

  const headResult = runGitCommand(projectRoot, ["rev-parse", "HEAD"])

  return {
    kind: "CLEAN_REPO",
    projectRoot,
    checkpointCreated: true,
    checkpointCommit: headResult.success ? headResult.stdout : undefined,
    message: "Created empty checkpoint commit for clean repository.",
  }
}
