/**
 * File path extraction and language detection from user prompts.
 *
 * Extracts file paths from prompt text (backtick-wrapped, quoted, absolute,
 * relative) and maps file extensions to language names for agent routing.
 */

/** Language name by file extension (leading dot required). */
export const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".dart": "dart",
  ".py": "python",
  ".pyi": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".swift": "swift",
  ".rb": "ruby",
  ".php": "php",
  ".cs": "csharp",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
  ".c": "c",
  ".h": "c",
  ".sh": "bash",
  ".bash": "bash",
  ".sql": "sql",
  ".md": "markdown",
  ".mdx": "markdown",
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "toml",
  ".html": "html",
  ".htm": "html",
  ".css": "css",
  ".scss": "css",
}

/**
 * Detect the programming language from a file path by examining its extension.
 * Returns `undefined` when the extension is not recognized.
 */
export function detectLanguage(filePath: string): string | undefined {
  const extIndex = filePath.lastIndexOf(".")
  if (extIndex === -1 || extIndex === filePath.length - 1) return undefined
  const ext = filePath.slice(extIndex).toLowerCase()
  return LANGUAGE_BY_EXTENSION[ext]
}

/**
 * Regex patterns used by `extractFilePaths`. Defined at module scope to
 * avoid repeated compilation inside the extraction loop.
 */

/** Backtick-wrapped paths: `src/foo.ts` */
const BACKTICK_PATH_RE = /`([^`]+)`/g

/** Double-quoted paths that end with a file extension */
const DOUBLE_QUOTED_PATH_RE = /"([^"]+\.[a-zA-Z0-9]{1,10})"/g

/** Single-quoted paths that end with a file extension */
const SINGLE_QUOTED_PATH_RE = /'([^']+\.[a-zA-Z0-9]{1,10})'/g

/**
 * Bare (unquoted) paths:
 * - Absolute POSIX: /home/user/project/src/foo.ts
 * - Absolute Windows: C:\Users\foo\bar.ts, C:/Users/foo/bar.ts
 * - Relative: src/foo/bar.ts, lib/widgets/card.dart
 *
 * Must contain at least one path separator AND a file extension.
 * Must NOT start with http:// or https://.
 */
const BARE_PATH_RE = /((?!https?:\/\/)(?:\/[\w.-]+)+\.[a-zA-Z0-9]{1,10}|\b[a-zA-Z]:[/\\][\w.\\/-]+\.[a-zA-Z0-9]{1,10}|\b(?!https?:\/\/)[\w.-]+(?:\/[\w.-]+)+\.[a-zA-Z0-9]{1,10})\b/g

/**
 * Return true when `candidate` looks like a file path (not a URL or
 * other non-path string). Rejects URL-scheme prefixes (:// anywhere)
 * and domain-like leading components (e.g. "example.com/foo.ts").
 */
function isFileLike(candidate: string): boolean {
  // Reject anything containing :// (URL scheme anywhere in the string)
  if (candidate.includes("://")) return false
  // Reject paths whose first component looks like a domain name
  // (contains a dot, no colon — e.g. "example.com/foo.ts")
  if (!candidate.startsWith("/") && !candidate.startsWith(".")) {
    const firstSlash = candidate.indexOf("/")
    if (firstSlash > 0) {
      const firstComponent = candidate.slice(0, firstSlash)
      if (firstComponent.includes(".") && !firstComponent.includes(":")) return false
    }
  }
  return candidate.includes("/") || candidate.includes("\\")
}

/**
 * Return true when `path` appears inside a URL in the original prompt.
 * Bare-path regex can match fragments of URLs (e.g. /foo.ts from
 * https://example.com/foo.ts); this post-filter catches those.
 */
function isPathInsideUrl(path: string, prompt: string): boolean {
  // Quick check: if the prompt has no ://, nothing can be a URL fragment
  if (!prompt.includes("://")) return false
  const urlPattern = /https?:\/\/[^\s"'`<>]+/g
  for (const url of prompt.matchAll(urlPattern)) {
    if (url[0].includes(path)) return true
  }
  return false
}

/**
 * Extract file paths from a user prompt.
 *
 * Handles backtick-wrapped, double-quoted, single-quoted, bare relative,
 * absolute POSIX, and absolute Windows paths. Filters out URLs and
 * non-file-like strings. Returns a deduplicated, order-preserved list.
 */
export function extractFilePaths(prompt: string): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  function add(candidate: string): void {
    const trimmed = candidate.trim()
    if (!trimmed || seen.has(trimmed)) return
    if (!isFileLike(trimmed)) return
    seen.add(trimmed)
    result.push(trimmed)
  }

  // Pass 1: backtick-wrapped paths (aggressive — backticks are always paths)
  for (const match of prompt.matchAll(BACKTICK_PATH_RE)) {
    add(match[1])
  }

  // Pass 2: double-quoted paths
  for (const match of prompt.matchAll(DOUBLE_QUOTED_PATH_RE)) {
    add(match[1])
  }

  // Pass 3: single-quoted paths
  for (const match of prompt.matchAll(SINGLE_QUOTED_PATH_RE)) {
    add(match[1])
  }

  // Pass 4: bare paths in remaining text
  for (const match of prompt.matchAll(BARE_PATH_RE)) {
    const candidate = match[1]
    if (!isFileLike(candidate)) continue
    // Extra guard: reject paths that are fragments of URLs in the prompt
    if (isPathInsideUrl(candidate, prompt)) continue
    add(candidate)
  }

  return result
}
