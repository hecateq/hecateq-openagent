import { existsSync, statSync } from "node:fs"
import { join } from "node:path"
import { PROJECT_MEMORY_DIR, PROJECT_MEMORY_FILES } from "./memory-bootstrap"

export type MemoryFileWatcherSnapshot = {
  fingerprint: string
  fileMtimes: Map<string, number>
}

const watcherCache = new Map<string, MemoryFileWatcherSnapshot>()

function computeFingerprint(projectRoot: string): MemoryFileWatcherSnapshot {
  const memDir = join(projectRoot, PROJECT_MEMORY_DIR)
  const fileMtimes = new Map<string, number>()

  for (const fileName of PROJECT_MEMORY_FILES) {
    const filePath = join(memDir, fileName)
    if (existsSync(filePath)) {
      try {
        const stat = statSync(filePath)
        fileMtimes.set(fileName, stat.mtimeMs)
      } catch {
        // file unreadable, treat as missing
      }
    }
  }

  // Sort by filename for deterministic fingerprint
  const sorted = [...fileMtimes.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  const fingerprint = sorted.map(([name, mtime]) => `${name}:${mtime.toFixed(0)}`).join("|")

  return { fingerprint, fileMtimes }
}

export function getMemoryDirFingerprint(projectRoot: string): MemoryFileWatcherSnapshot {
  const cached = watcherCache.get(projectRoot)
  if (cached) return cached

  const fresh = computeFingerprint(projectRoot)
  watcherCache.set(projectRoot, fresh)
  return fresh
}

export function hasMemoryDirChanged(projectRoot: string, previousFingerprint: string): boolean {
  const current = computeFingerprint(projectRoot)
  watcherCache.set(projectRoot, current)
  return current.fingerprint !== previousFingerprint
}

// For testing only
export function clearWatcherCache(): void {
  watcherCache.clear()
}
