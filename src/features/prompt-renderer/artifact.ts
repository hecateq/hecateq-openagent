import { mkdirSync, existsSync, writeFileSync } from "node:fs"
import { join, resolve as pathResolve } from "node:path"
import type { PromptPreview, SaveArtifactOptions } from "./types"

const DEFAULT_ARTIFACT_DIR = ".opencode/artifacts/prompts"

function safeSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9ğüşıöç\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "untitled"
}

function generateTimestamp(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

function resolveUniquePath(baseDir: string, slug: string): string {
  const ts = generateTimestamp()
  const baseName = `${ts}-${slug}`
  let candidate = join(baseDir, `${baseName}.md`)
  if (!existsSync(candidate)) {
    return candidate
  }
  for (let i = 2; i < 1000; i++) {
    candidate = join(baseDir, `${baseName}-${i}.md`)
    if (!existsSync(candidate)) {
      return candidate
    }
  }
  return join(baseDir, `${baseName}-${Date.now()}.md`)
}

function buildMetadataHeader(preview: PromptPreview): string {
  const lines = [
    `---`,
    `title: "${preview.title.replace(/"/g, '\\"')}"`,
    `type: ${preview.type}`,
    `risk: ${preview.risk}`,
    `tests_required: ${preview.testsRequired}`,
    `sections: [${preview.sections.map((s) => `"${s.replace(/"/g, '\\"')}"`).join(", ")}]`,
    `generated_at: ${new Date().toISOString()}`,
    `---`,
    ``,
  ]
  return lines.join("\n")
}

export async function saveRawPromptArtifact(
  preview: PromptPreview,
  options: SaveArtifactOptions,
): Promise<string> {
  const { projectRoot, artifactDir = DEFAULT_ARTIFACT_DIR } = options

  const resolvedProjectRoot = pathResolve(projectRoot)
  const resolvedArtifactDir = pathResolve(resolvedProjectRoot, artifactDir)

  if (!resolvedArtifactDir.startsWith(resolvedProjectRoot + "/") && resolvedArtifactDir !== resolvedProjectRoot) {
    throw new Error(
      `Artifact directory must be under project root. Got: ${resolvedArtifactDir} (project root: ${resolvedProjectRoot})`,
    )
  }

  const slug = safeSlug(preview.title)

  mkdirSync(resolvedArtifactDir, { recursive: true })

  const filePath = resolveUniquePath(resolvedArtifactDir, slug)

  const metadataBlock = buildMetadataHeader(preview)
  const content = metadataBlock + preview.rawPrompt

  writeFileSync(filePath, content, "utf-8")

  return filePath
}
