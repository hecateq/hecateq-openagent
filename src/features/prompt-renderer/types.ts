/**
 * Core types for the Hecateq Prompt Renderer.
 *
 * Extracts metadata from long generated prompts and produces
 * a compact Turkish Markdown card with artifact path.
 */

export type PromptRenderMode = "card" | "raw"

export type PromptType =
  | "research"
  | "implementation"
  | "debug"
  | "report"
  | "unknown"

export type PromptRisk =
  | "low"
  | "medium"
  | "high"
  | "unknown"

export interface PromptPreview {
  /** Extracted title from first # heading or first non-empty line */
  title: string
  /** Classified prompt type */
  type: PromptType
  /** Optional target extracted from the prompt */
  target?: string
  /** Risk classification */
  risk: PromptRisk
  /** Section headings from the prompt (## and optionally ###) */
  sections: string[]
  /** Whether the prompt contains testing/verification requirements */
  testsRequired: boolean
  /** Summary bullets extracted from the prompt */
  summaryBullets: string[]
  /** The original raw prompt text */
  rawPrompt: string
  /** Absolute path to the saved artifact (populated after save) */
  artifactPath?: string
}

export interface SaveArtifactOptions {
  /** Project root directory */
  projectRoot: string
  /** Optional override for artifact directory (default: .opencode/artifacts/prompts) */
  artifactDir?: string
}

export interface RenderOutputResult {
  /** The display text (card or raw) */
  display: string
  /** Absolute path to the saved artifact (undefined if save failed) */
  artifactPath?: string
}

export interface RenderOptions {
  /** Force raw display even if card would be used */
  showRaw?: boolean
  /** Project root for artifact saving */
  projectRoot?: string
  /** Artifact directory override */
  artifactDir?: string
}
