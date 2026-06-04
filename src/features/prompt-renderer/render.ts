import type { PromptPreview, PromptRenderMode, RenderOptions, RenderOutputResult } from "./types"
import { extractPromptPreview } from "./extract"
import { saveRawPromptArtifact } from "./artifact"
import { log } from "../../shared/logger"

const LONG_PROMPT_THRESHOLD = 1500

function typeLabel(type: PromptPreview["type"]): string {
  switch (type) {
    case "research": return "Araştırma"
    case "implementation": return "Uygulama"
    case "debug": return "Hata Ayıklama"
    case "report": return "Rapor"
    default: return "Bilinmiyor"
  }
}

function riskLabel(risk: PromptPreview["risk"]): string {
  switch (risk) {
    case "low": return "Düşük"
    case "medium": return "Orta"
    case "high": return "Yüksek"
    default: return "Bilinmiyor"
  }
}

export function renderPromptCard(preview: PromptPreview): string {
  const sectionsDisplay = preview.sections.length > 0
    ? preview.sections.join("\n")
    : "Yok"

  const bulletsDisplay = preview.summaryBullets
    .map((b) => `- ${b}`)
    .join("\n")

  const artifactLine = preview.artifactPath
    ? `\`${preview.artifactPath}\``
    : "Kaydedilmedi"

  const lines = [
    `# Prompt Hazır: ${preview.title}`,
    ``,
    `| Alan | Değer |`,
    `|------|-------|`,
    `| Tür | ${typeLabel(preview.type)} |`,
    `| Risk | ${riskLabel(preview.risk)} |`,
    `| Bölüm Sayısı | ${preview.sections.length > 0 ? preview.sections.filter((s) => !s.startsWith("  ")).length : 0} |`,
    `| Test Gerekli | ${preview.testsRequired ? "Evet" : "Hayır"} |`,
    `| Raw Prompt | ${artifactLine} |`,
  ]

  if (preview.target) {
    lines.splice(3, 0, `| Hedef | ${preview.target} |`)
  }

  lines.push(
    ``,
    `### Özet`,
    ``,
    bulletsDisplay,
    ``,
  )

  if (preview.artifactPath) {
    lines.push(
      `### Kaydedilen Raw Prompt`,
      ``,
      `\`${preview.artifactPath}\``,
      ``,
    )
  }

  lines.push(
    `> Tam prompt varsayılan olarak ekrana basılmadı. \`showRaw=true\` ile ham çıktıyı görebilirsiniz.`,
    ``,
  )

  return lines.join("\n")
}

export async function renderLongGeneratedPromptIfNeeded(
  generatedOutput: string,
  projectRoot?: string,
): Promise<string> {
  if (generatedOutput.length < LONG_PROMPT_THRESHOLD) {
    return generatedOutput
  }

  if (!projectRoot) {
    return generatedOutput
  }

  const preview = extractPromptPreview(generatedOutput)

  try {
    const artifactPath = await saveRawPromptArtifact(preview, { projectRoot })
    preview.artifactPath = artifactPath
    log("prompt-renderer: saved long generated prompt artifact", {
      artifactPath,
      promptLength: generatedOutput.length,
      title: preview.title,
    })
    return renderPromptCard(preview)
  } catch (err) {
    log("prompt-renderer: failed to save artifact, returning raw output", {
      error: String(err),
      promptLength: generatedOutput.length,
    })
    return generatedOutput
  }
}

export async function renderPromptOutput(
  rawPrompt: string,
  options: RenderOptions = {},
): Promise<RenderOutputResult> {
  const preview = extractPromptPreview(rawPrompt)

  if (options.showRaw) {
    return { display: rawPrompt }
  }

  if (rawPrompt.length < LONG_PROMPT_THRESHOLD) {
    return { display: rawPrompt }
  }

  if (options.projectRoot) {
    try {
      const artifactPath = await saveRawPromptArtifact(preview, {
        projectRoot: options.projectRoot,
        artifactDir: options.artifactDir,
      })
      preview.artifactPath = artifactPath
      return {
        display: renderPromptCard(preview),
        artifactPath,
      }
    } catch {
      preview.artifactPath = undefined
      const cardLines = renderPromptCard(preview).split("\n")
      const warningIdx = cardLines.length - 1
      cardLines.splice(warningIdx, 0,
        `> Uyarı: Raw prompt artifact kaydedilemedi.`,
      )
      return {
        display: cardLines.join("\n"),
      }
    }
  }

  return { display: renderPromptCard(preview) }
}
