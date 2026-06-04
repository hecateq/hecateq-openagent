import type { PromptPreview, PromptType, PromptRisk } from "./types"

const TYPE_KEYWORDS: Record<Exclude<PromptType, "unknown">, RegExp> = {
  implementation: /implementation|implement|geliştirme|geliştir|uygula|uygulama|build|create|kod|code|yaz|write|add|ekle|feature|özellik/i,
  research: /research|araştırma|araştır|analiz|analyze|analysis|investigate|incele|keşfet|explore|learn|öğren/i,
  debug: /debug|hata|bug|fix|düzelt|tamir|broken|bozuk|crash|çökme|error|sorun|issue|problem|hatalı|yanlış|wrong/i,
  report: /report|rapor|summary|özet|document|doküman|changelog|generate.*report/i,
}

const RISK_HIGH_TERMS = /high-risk|yüksek risk|security|güvenlik|migration|göç|auth|yetkilendirme|password|şifre|payment|ödeme|destructive|yıkıcı|delete|sil|drop|production|prodüksiyon|canlı|live|secret|gizli|sensitive|hassas|personal data|kişisel veri/i
const RISK_MEDIUM_TERMS = /implementation|uygulama|config|ayar|schema|şema|runtime|çalışma zamanı|agent|ajan|orchestration|orkestrasyon|refactor|düzenle|performance|performans/i
const RISK_LOW_TERMS = /docs|doküman|comment|yorum|format|biçim|minor|küçük|typo|yazım|readme|style|stil/i

const TEST_KEYWORDS = /test|typecheck|bun test|bun run typecheck|quality gate|kalite kapısı|doğrulama|verification|verify|doğrula|check|kontrol et/i

const TARGET_PATTERNS = [
  /target[:\s]+(.+?)(?:\n|$)/i,
  /hedef[:\s]+(.+?)(?:\n|$)/i,
  /for[:\s]+(.+?)(?:\n|$)/i,
  /in[:\s]+(src\/[^\s]+)/i,
]

function extractTitle(rawPrompt: string): string {
  const lines = rawPrompt.split(/\r?\n/)
  const h1 = lines.find((l) => /^#\s/.test(l.trim()))
  if (h1) {
    return h1.replace(/^#\s*/, "").trim()
  }
  const firstNonEmpty = lines.find((l) => l.trim().length > 0)
  if (firstNonEmpty) {
    const cleaned = firstNonEmpty.trim().replace(/^[#*>*-]+\s*/, "").replace(/\*+$/, "").trim()
    if (cleaned.length > 100) {
      return cleaned.slice(0, 97) + "..."
    }
    return cleaned
  }
  return "Untitled Prompt"
}

function extractType(normalized: string): PromptType {
  for (const [type, regex] of Object.entries(TYPE_KEYWORDS)) {
    if (regex.test(normalized)) {
      return type as Exclude<PromptType, "unknown">
    }
  }
  return "unknown"
}

function extractRisk(normalized: string): PromptRisk {
  if (RISK_HIGH_TERMS.test(normalized)) return "high"
  if (RISK_MEDIUM_TERMS.test(normalized)) return "medium"
  if (RISK_LOW_TERMS.test(normalized)) return "low"
  return "unknown"
}

function extractSections(rawPrompt: string): string[] {
  const lines = rawPrompt.split(/\r?\n/)
  const sections: string[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    const h2 = /^##\s+(.+)/.exec(trimmed)
    if (h2) {
      sections.push(h2[1].trim())
      continue
    }
    const h3 = /^###\s+(.+)/.exec(trimmed)
    if (h3) {
      sections.push(`  ${h3[1].trim()}`)
    }
  }
  if (sections.length > 15) {
    return [...sections.slice(0, 15), `... (${sections.length - 15} more)`]
  }
  return sections
}

function extractTestsRequired(normalized: string): boolean {
  return TEST_KEYWORDS.test(normalized)
}

function extractSummaryBullets(rawPrompt: string): string[] {
  const lines = rawPrompt.split(/\r?\n/)

  const amacSectionStart = lines.findIndex(
    (l) => /^#{1,3}\s*(?:Amaç|Purpose|Goal|Hedef)/i.test(l.trim()),
  )
  if (amacSectionStart >= 0) {
    const bullets: string[] = []
    for (let i = amacSectionStart + 1; i < lines.length; i++) {
      const line = lines[i].trim()
      if (line.length === 0) continue
      if (/^#{1,3}\s/.test(line)) break
      const bullet = /^[-*+>]\s+(.+)/.exec(line)
      if (bullet) {
        bullets.push(bullet[1].trim())
      } else if (bullets.length > 0) {
        break
      }
    }
    if (bullets.length > 0) return bullets.slice(0, 8)
  }

  const allBullets: string[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    const bullet = /^[-*+>]\s+(.+)/.exec(trimmed)
    if (bullet) {
      allBullets.push(bullet[1].trim())
    }
    if (allBullets.length >= 5) break
  }

  if (allBullets.length > 0) return allBullets
  return ["No bullet summary found in prompt."]
}

function extractTarget(rawPrompt: string): string | undefined {
  for (const pattern of TARGET_PATTERNS) {
    const match = pattern.exec(rawPrompt)
    if (match?.[1]) {
      return match[1].trim()
    }
  }
  return undefined
}

export function extractPromptPreview(rawPrompt: string): PromptPreview {
  const title = extractTitle(rawPrompt)
  const normalized = rawPrompt.toLowerCase()
  const type = extractType(normalized)
  const risk = extractRisk(normalized)
  const sections = extractSections(rawPrompt)
  const testsRequired = extractTestsRequired(normalized)
  const summaryBullets = extractSummaryBullets(rawPrompt)
  const target = extractTarget(rawPrompt)

  return {
    title,
    type,
    target,
    risk,
    sections,
    testsRequired,
    summaryBullets,
    rawPrompt,
  }
}
