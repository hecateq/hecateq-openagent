import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { homedir } from "node:os"
import { z } from "zod"

import { getAgentConfigKey, stripAgentListSortPrefix } from "./agent-display-names"
import { parseFrontmatter } from "./frontmatter"
import { AGENT_NAME_MAP } from "./migration/agent-names"
import { getOpenCodeConfigDir, getOpenCodeConfigDirs } from "./opencode-config-dir"

const INDEX_VERSION = 1 as const
const INDEX_GENERATOR = "oh-my-openagent-hecateq" as const
const INDEX_NOTICE = "Generated file. Do not edit manually. Re-run /hecateq-agent-index." as const
const BODY_PREVIEW_LIMIT = 280
const MAX_KEYWORDS = 12
const MAX_SECONDARY_DOMAINS = 4
const MIN_BODY_LENGTH_FOR_METADATA = 80
const PRIMARY_DOMAIN_MIN_SCORE = 3.2
const SECONDARY_DOMAIN_MIN_SCORE = 1.5
const DOMAIN_TIE_HIGH_THRESHOLD = 0.7
const DOMAIN_TIE_MEDIUM_THRESHOLD = 1.5

const AGENT_TYPE_VALUES = [
  "orchestrator",
  "planner",
  "specialist",
  "implementer",
  "reviewer",
  "tester",
  "documentarian",
  "security",
  "devops",
  "integration",
  "unknown",
] as const

const ROUTING_AMBIGUITY_VALUES = ["low", "medium", "high"] as const

const RELATED_SECONDARY_DOMAINS: Partial<Record<DomainName, DomainName[]>> = {
  accessibility: ["qa", "frontend", "mobile"],
  "agent-orchestration": ["contract-management", "workflow", "coordination"],
  "api-integration": ["third-party-services", "backend", "docs"],
  android: ["devops", "mobile"],
  architecture: ["docs", "workflow", "coordination"],
  graphql: ["backend", "performance", "contract-management"],
  "incident-recovery": ["qa", "devops", "backend"],
  "product-strategy": ["workflow", "coordination", "docs"],
  "risk-analysis": ["workflow", "coordination", "qa"],
  strategy: ["workflow", "coordination", "docs"],
} as const

type AgentType = (typeof AGENT_TYPE_VALUES)[number]
type RoutingAmbiguity = (typeof ROUTING_AMBIGUITY_VALUES)[number]

const DOMAIN_DEFINITIONS = {
  backend: {
    terms: ["backend", "nodejs", "node", "express", "nestjs", "fastify", "controller", "service layer", "api server", "repository", "middleware", "route handler", "graphql api", "grpc", "rest api", "backend developer", "serverside", "server-side"],
  },
  frontend: {
    terms: ["frontend", "react", "nextjs", "next.js", "tailwind", "shadcn", "component", "page", "layout", "framer motion", "css", "html", "ui component", "client-side", "web app", "single page", "responsive", "redux", "zustand", "vue"],
  },
  flutter: {
    terms: ["flutter", "dart", "riverpod", "go_router", "widget", "bloc", "provider", "flutter ui", "material design", "cupertino", "cross platform", "flutter app", "dart language"],
  },
  mobile: {
    terms: ["mobile", "ios/android", "app store", "play store", "native bridge", "methodchannel", "mobile app", "tablet", "smartphone", "mobile platform", "react native"],
  },
  android: {
    terms: ["android", "gradle", "aab", "keystore", "google play", "fastlane android", "android studio", "kotlin", "apk"],
  },
  ios: {
    terms: ["ios", "swift", "xcode", "app store", "cocoapods", "iphone", "ipad", "apple", "ios native", "swiftui", "uikit"],
  },
  security: {
    terms: ["security", "auth", "jwt", "oauth", "owasp", "vulnerability", "hardening", "pentest", "threat model", "secret scanning", "authentication", "authorization", "encryption", "ssl", "tls", "cors", "csrf", "xss", "sqli", "rbac", "zero trust"],
  },
  qa: {
    terms: ["qa", "test", "testing", "e2e", "playwright", "unit test", "integration test", "verification", "regression", "test coverage", "test case", "test suite", "quality assurance", "assertion", "mock", "stub", "test runner", "audit", "validation", "verify"],
  },
  devops: {
    terms: ["devops", "docker", "kubernetes", "nginx", "ci/cd", "deploy", "deployment", "github actions", "infrastructure", "coolify", "terraform", "ansible", "helm", "docker compose", "monitoring", "observability", "prometheus", "grafana"],
  },
  docs: {
    terms: ["docs", "documentation", "technical writer", "documentarian", "markdown", "readme", "report", "guide", "api documentation", "swagger docs", "user guide", "architecture documentation", "changelog"],
  },
  database: {
    terms: ["database", "postgres", "mysql", "sqlite", "prisma", "migration", "schema design", "index optimization", "sql", "query", "orm", "mongodb", "redis", "data model", "entity", "relation", "foreign key", "transaction"],
  },
  realtime: {
    terms: ["realtime", "real-time", "websocket", "socket.io", "webrtc", "streaming", "live chat", "pubsub", "event stream", "server-sent events", "sse", "live update", "push"],
  },
  ai: {
    terms: ["ai", "ml", "llm", "rag", "embedding", "prompt", "model", "machine learning", "data pipeline", "neural network", "training", "inference", "vector database", "semantic search", "openai", "claude", "langchain"],
  },
  scraping: {
    terms: ["scraping", "scraper", "crawling", "extraction", "firecrawl", "puppeteer", "browser automation", "data mining", "web crawl", "headless browser"],
  },
  accessibility: {
    terms: ["accessibility", "a11y", "wcag", "screen reader", "aria", "color contrast", "erişilebilirlik", "keyboard navigation", "semantic html", "alt text"],
  },
  "agent-orchestration": {
    terms: ["orchestrator", "orchestration", "router", "routing", "dispatch", "delegate", "agent communication", "multi-agent", "team coordination", "subagent", "workflow orchestration", "agent routing", "agent delegation", "workflow coordination", "contract manager", "coordination boundaries"],
  },
  "contract-management": {
    terms: ["contract manager", "contract", "openapi", "swagger", "dto", "schema sync", "protocol", "handshake", "sözleşme", "interface agreement", "api contract", "type definition"],
  },
  "api-integration": {
    terms: ["api integration", "api ecosystem", "sdk integration", "external integration", "third party api", "rest api integration", "api client", "webhook", "api wrapper"],
  },
  "third-party-services": {
    terms: ["third party", "stripe", "twilio", "aws sdk", "external service", "vendor integration", "saas", "payment gateway", "email service", "cloud service"],
  },
  workflow: {
    terms: ["workflow", "workflow helper", "process", "lifecycle", "handoff", "approval flow", "pipeline", "automation flow", "business process"],
  },
  coordination: {
    terms: ["coordination", "coordinator", "sync", "alignment", "communication interface", "cross-team", "dependency management", "integration point"],
  },
  architecture: {
    terms: ["architecture", "architectural", "adr", "architectural reasoning", "architectural thinker", "visionary", "conceptual integrity", "system design", "long-term vision", "entropy reduction", "simplification", "architectural purity"],
  },
  graphql: {
    terms: ["graphql", "apollo", "apollo federation", "schema design", "resolver", "resolvers", "typedefs", "subgraph", "federation", "dataloader", "n+1"],
  },
  "incident-recovery": {
    terms: ["incident recovery", "incident", "self-healing", "self healing", "autonomous repair", "root cause", "stack trace", "post-mortem", "healing", "repair engineer", "bug fixing", "recovery"],
  },
  "product-strategy": {
    terms: ["product strategy", "product owner", "business analyst", "user stories", "acceptance criteria", "mvp", "scope control", "feature creep", "prioritization", "business stakeholder", "requirements"],
  },
  "risk-analysis": {
    terms: ["risk analysis", "risk", "devil's advocate", "devils advocate", "assumption", "hidden assumptions", "premortem", "fragility", "worst-case", "failure modes", "strategic failures"],
  },
  strategy: {
    terms: ["strategy", "strategic", "roi", "impact/effort", "impact effort", "roadmap", "prioritization", "sequencing", "trade-off", "tradeoff", "rice", "portfolio", "milestone"],
  },
  performance: {
    terms: ["performance", "profiling", "bundle size", "cache strategy", "memory leak", "optimize", "benchmark", "load time", "response time", "latency", "throughput", "bottleneck", "performans", "darboğaz", "ölçüm", "yavaşlık", "profil"],
  },
  seo: {
    terms: ["seo", "schema.org", "meta tags", "sitemap", "core web vitals", "search engine", "google ranking", "structured data", "canonical", "robots.txt", "open graph"],
  },
  i18n: {
    terms: ["i18n", "l10n", "translation", "localization", "rtl", "arb files", "locale", "internationalization", "multi-language", "language pack"],
  },
  notification: {
    terms: ["notification", "push notification", "fcm", "apns", "deep link", "firebase messaging", "sms", "email notification", "in-app notification"],
  },
  media: {
    terms: ["media", "image optimization", "video transcoding", "ffmpeg", "sharp", "asset generation", "image processing", "video processing", "thumbnail"],
  },
  cli: {
    terms: ["cli", "terminal", "command line", "automation script", "developer tool", "shell", "bash", "zsh", "stdin", "stdout", "cli app"],
  },
  refactoring: {
    terms: ["refactor", "refactoring", "clean code", "code smell", "technical debt", "rename", "extract method", "simplify", "restructure", "modernize", "migration"],
  },
  release: {
    terms: ["release", "semver", "changelog", "rollback", "deploy gate", "versioning", "release note", "tag", "npm publish"],
  },
  compliance: {
    terms: ["compliance", "gdpr", "kvkk", "ccpa", "privacy", "consent", "data protection", "regulation", "audit trail", "data retention", "pii"],
  },
  "design-system": {
    terms: ["design system", "design tokens", "typography", "color palette", "component consistency", "ui kit", "style guide", "theme", "css variables"],
  },
  ux: {
    terms: ["ux", "user journey", "wireframe", "micro-interactions", "motion design", "copywriting", "user research", "usability", "interaction design", "prototype", "user flow"],
  },
} as const

type DomainName = keyof typeof DOMAIN_DEFINITIONS

const DOMAIN_NAMES = Object.keys(DOMAIN_DEFINITIONS) as DomainName[]

const DOMAIN_HINT_ALIASES: Record<string, DomainName> = {
  accessibility: "accessibility",
  "agent orchestration": "agent-orchestration",
  "agent-orchestration": "agent-orchestration",
  android: "android",
  architecture: "architecture",
  "architectural reasoning": "architecture",
  backend: "backend",
  cli: "cli",
  compliance: "compliance",
  coordination: "coordination",
  database: "database",
  devops: "devops",
  docs: "docs",
  documentation: "docs",
  flutter: "flutter",
  frontend: "frontend",
  graphql: "graphql",
  i18n: "i18n",
  "incident recovery": "incident-recovery",
  "incident-recovery": "incident-recovery",
  ios: "ios",
  media: "media",
  mobile: "mobile",
  notification: "notification",
  performance: "performance",
  "product strategy": "product-strategy",
  "product-strategy": "product-strategy",
  prioritization: "strategy",
  qa: "qa",
  realtime: "realtime",
  refactoring: "refactoring",
  release: "release",
  "risk analysis": "risk-analysis",
  "risk-analysis": "risk-analysis",
  scraping: "scraping",
  security: "security",
  seo: "seo",
  strategy: "strategy",
  workflow: "workflow",
}

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "app",
  "application",
  "build",
  "code",
  "core",
  "create",
  "current",
  "custom",
  "data",
  "developer",
  "does",
  "engineer",
  "expert",
  "feature",
  "file",
  "focus",
  "for",
  "from",
  "global",
  "guide",
  "help",
  "implementation",
  "implements",
  "improves",
  "index",
  "manager",
  "more",
  "plugin",
  "project",
  "prompt",
  "responsibilities",
  "role",
  "specialist",
  "supports",
  "system",
  "task",
  "tasks",
  "tool",
  "tools",
  "update",
  "user",
  "users",
  "with",
  "works",
  "görev",
])

const IMPORTANT_TURKISH_TOKENS = new Set([
  "mimari",
  "entegrasyon",
  "güvenlik",
  "test",
  "dokümantasyon",
  "erişilebilirlik",
  "performans",
  "dağıtım",
  "sözleşme",
  "koordinasyon",
])

const DOMAIN_FALLBACK_USE_WHEN: Record<DomainName, string[]> = {
  backend: ["backend architecture review", "API design", "service boundary decisions", "controller/service implementation"],
  frontend: ["frontend UI logic", "React or Next.js component work", "page and layout integration", "client-side state flows"],
  flutter: ["Flutter feature implementation", "mobile UI flow", "Riverpod or go_router work", "widget architecture"],
  mobile: ["mobile platform integration", "cross-platform app flows", "store readiness checks", "device-specific behavior"],
  android: ["Android build and release setup", "Gradle or keystore work", "Google Play delivery", "native Android integration"],
  ios: ["iOS native integration", "Swift bridge work", "App Store readiness", "platform-specific iOS behavior"],
  security: ["security review", "auth hardening", "secret exposure checks", "threat modeling"],
  qa: ["test planning", "E2E verification", "regression testing", "automation coverage review"],
  devops: ["deployment pipeline work", "CI/CD hardening", "container or infra setup", "release automation"],
  docs: ["technical documentation", "implementation report", "markdown documentation", "architecture write-up"],
  database: ["schema design", "migration planning", "query optimization", "database indexing"],
  realtime: ["WebSocket or Socket.IO design", "real-time data flows", "event stream coordination", "live collaboration features"],
  ai: ["AI pipeline planning", "LLM integration", "RAG or embeddings work", "model orchestration"],
  scraping: ["web scraping design", "browser extraction flows", "anti-bot aware data collection", "structured content extraction"],
  accessibility: ["WCAG review", "screen reader support", "color contrast audit", "ARIA or semantic accessibility fixes"],
  "agent-orchestration": ["agent routing design", "delegation boundaries", "multi-agent coordination", "workflow ownership rules"],
  "contract-management": ["contract definition", "DTO or schema alignment", "OpenAPI synchronization", "protocol boundary design"],
  "api-integration": ["third-party API integration", "SDK setup", "provider contract mapping", "external API error handling"],
  "third-party-services": ["vendor integration planning", "Stripe or Twilio work", "external service onboarding", "service-specific configuration"],
  workflow: ["workflow design", "handoff rules", "approval or lifecycle automation", "process orchestration"],
  coordination: ["cross-team coordination", "interface alignment", "ownership boundaries", "communication flow design"],
  architecture: ["architecture reasoning", "ADR review", "long-term simplification", "conceptual integrity checks"],
  graphql: ["GraphQL schema design", "resolver architecture", "Apollo Federation", "N+1 prevention"],
  "incident-recovery": ["incident recovery", "root cause analysis", "autonomous repair", "regression-safe bug recovery"],
  "product-strategy": ["product scope definition", "user story design", "acceptance criteria review", "MVP planning"],
  "risk-analysis": ["premortem analysis", "hidden assumption review", "failure-mode stress test", "risk scenario critique"],
  strategy: ["ROI prioritization", "roadmap sequencing", "impact/effort analysis", "dependency-aware planning"],
  performance: ["performance profiling", "cache strategy review", "bundle or memory optimization", "throughput analysis"],
  seo: ["SEO audits", "meta tag strategy", "structured data work", "Core Web Vitals review"],
  i18n: ["localization setup", "translation workflow", "RTL support", "locale formatting"],
  notification: ["push notification setup", "FCM or APNs flows", "notification routing", "deep link notification handling"],
  media: ["image optimization", "video transcoding", "asset pipeline work", "media processing automation"],
  cli: ["CLI command design", "terminal automation", "developer workflow tooling", "command UX improvements"],
  refactoring: ["code smell cleanup", "safe refactoring", "naming and structure cleanup", "technical debt reduction"],
  release: ["release planning", "versioning decisions", "changelog preparation", "rollback readiness"],
  compliance: ["privacy compliance review", "consent and policy checks", "data handling rules", "regulatory audit prep"],
  "design-system": ["design token governance", "component consistency work", "theme system updates", "UI standardization"],
  ux: ["user flow review", "motion and interaction design", "micro-copy improvements", "UX decision support"],
}

const DOMAIN_FALLBACK_AVOID_WHEN: Record<DomainName, string[]> = {
  backend: ["visual-only UI polish", "Flutter widget-only styling", "copywriting-only tasks", "design token curation"],
  frontend: ["database schema design", "infrastructure provisioning", "secret rotation work", "backend-only service internals"],
  flutter: ["backend service architecture", "database migration design", "server deployment automation", "non-mobile infrastructure work"],
  mobile: ["backend-only API architecture", "database indexing", "server-side deployment pipelines", "docs-only reporting"],
  android: ["frontend web-only styling", "database schema work", "backend auth service design", "copywriting-only tasks"],
  ios: ["frontend web-only UI polish", "database schema changes", "backend API implementation", "docs-only reporting"],
  security: ["visual UI implementation", "copywriting-only tasks", "marketing page polish", "feature work without security scope"],
  qa: ["feature implementation without test scope", "database schema design", "visual-only polish", "release marketing copy"],
  devops: ["business logic implementation", "visual component styling", "copywriting-only tasks", "feature work without deployment scope"],
  docs: ["runtime implementation", "production code changes", "database migration work", "infra provisioning"],
  database: ["visual-only UI polish", "copywriting-only tasks", "motion design", "front-end styling without data scope"],
  realtime: ["static documentation-only updates", "database-only indexing tasks", "visual-only polish", "release note drafting"],
  ai: ["visual-only CSS tweaks", "database-only indexing", "store asset polish", "release paperwork without AI scope"],
  scraping: ["copywriting-only work", "static design polish", "backend auth hardening", "release note drafting"],
  accessibility: ["backend API implementation", "database schema design", "infrastructure provisioning", "server deployment automation"],
  "agent-orchestration": ["single-file UI polish", "database schema design", "pixel-perfect styling", "low-level platform SDK work"],
  "contract-management": ["visual-only UI polish", "database indexing without contract impact", "asset production", "copywriting-only tasks"],
  "api-integration": ["frontend-only visual polish", "database-only migrations", "pure documentation cleanup", "design token updates"],
  "third-party-services": ["isolated local UI styling", "database-only indexing", "copywriting-only tasks", "feature work without external service scope"],
  workflow: ["pixel-perfect UI polish", "database-only indexing", "copywriting-only tasks", "standalone asset generation"],
  coordination: ["single-component styling", "database-only migrations", "copywriting-only tasks", "asset optimization"],
  architecture: ["single bugfix execution", "visual-only polish", "database-only indexing", "vendor onboarding without architecture scope"],
  graphql: ["pure REST-only documentation", "visual-only UI polish", "infra provisioning without API scope", "copywriting-only tasks"],
  "incident-recovery": ["greenfield feature ideation", "visual-only polish", "marketing copy", "non-incident roadmap strategy"],
  "product-strategy": ["low-level code implementation", "runtime bug fixing", "infra provisioning", "pixel-perfect UI polish"],
  "risk-analysis": ["blind implementation", "pixel-perfect styling", "database-only indexing", "copywriting without risk scope"],
  strategy: ["direct code implementation", "low-level debugging", "visual-only polish", "isolated asset generation"],
  performance: ["copywriting-only tasks", "schema documentation only", "non-performance design polish", "content translation without perf scope"],
  seo: ["backend service internals", "database schema design", "native mobile build scripts", "infra secrets rotation"],
  i18n: ["database indexing", "backend auth hardening", "infra provisioning", "visual-only asset optimization"],
  notification: ["database-only migration planning", "copywriting-only tasks", "visual-only polish", "schema-only docs updates"],
  media: ["backend auth architecture", "database schema design", "workflow-only coordination tasks", "copywriting-only tasks"],
  cli: ["visual-only UI polish", "database migration design", "mobile native SDK integration", "copywriting-only tasks"],
  refactoring: ["greenfield feature ideation", "visual-only design polish", "marketing copy", "release paperwork without code cleanup scope"],
  release: ["feature implementation", "visual-only styling", "deep database tuning", "isolated copywriting without release scope"],
  compliance: ["visual UI implementation", "animation polish", "database-only indexing", "feature work without compliance impact"],
  "design-system": ["backend API implementation", "database schema design", "server deployment pipelines", "vendor API onboarding"],
  ux: ["database migration design", "backend auth hardening", "server deployment automation", "secret rotation work"],
}

const CAPABILITY_FALLBACKS: Record<AgentType, HecateqAgentCapabilities> = {
  orchestrator: { can_plan: true, can_implement: false, can_review: true, can_test: false, can_document: false, can_coordinate: true },
  planner: { can_plan: true, can_implement: false, can_review: true, can_test: false, can_document: false, can_coordinate: true },
  specialist: { can_plan: true, can_implement: true, can_review: true, can_test: false, can_document: false, can_coordinate: false },
  implementer: { can_plan: true, can_implement: true, can_review: false, can_test: false, can_document: false, can_coordinate: false },
  reviewer: { can_plan: false, can_implement: false, can_review: true, can_test: true, can_document: false, can_coordinate: false },
  tester: { can_plan: true, can_implement: false, can_review: true, can_test: true, can_document: false, can_coordinate: false },
  documentarian: { can_plan: true, can_implement: false, can_review: true, can_test: false, can_document: true, can_coordinate: false },
  security: { can_plan: true, can_implement: false, can_review: true, can_test: true, can_document: false, can_coordinate: false },
  devops: { can_plan: true, can_implement: true, can_review: true, can_test: true, can_document: false, can_coordinate: false },
  integration: { can_plan: true, can_implement: true, can_review: true, can_test: false, can_document: false, can_coordinate: true },
  unknown: { can_plan: true, can_implement: false, can_review: false, can_test: false, can_document: false, can_coordinate: false },
}

type HecateqAgentCapabilities = {
  can_plan: boolean
  can_implement: boolean
  can_review: boolean
  can_test: boolean
  can_document: boolean
  can_coordinate: boolean
}

type TextSignals = {
  raw: string
  normalized: string
  tokens: Set<string>
}

type DomainComputation = {
  primaryDomain: string
  secondaryDomains: string[]
  domains: string[]
  ambiguity: RoutingAmbiguity
  scores: Map<DomainName, number>
  filenameSignals: string[]
  frontmatterSignals: string[]
  bodySignals: string[]
}

export const HecateqAgentCapabilitiesSchema = z.object({
  can_plan: z.boolean(),
  can_implement: z.boolean(),
  can_review: z.boolean(),
  can_test: z.boolean(),
  can_document: z.boolean(),
  can_coordinate: z.boolean(),
})

export const HecateqAgentRoutingSchema = z.object({
  priority: z.number().int().min(0).max(100),
  ambiguity: z.enum(ROUTING_AMBIGUITY_VALUES),
  best_for: z.array(z.string()),
  not_for: z.array(z.string()),
})

export const HecateqAgentFrontmatterSchema = z.object({
  role: z.string().optional(),
  focus: z.string().optional(),
  domain_hints: z.array(z.string()),
  keywords: z.array(z.string()),
  use_when: z.array(z.string()),
  avoid_when: z.array(z.string()),
  mode: z.string().optional(),
  hidden: z.boolean(),
  enabled_tools: z.array(z.string()),
  denied_tools: z.array(z.string()),
})

export const HecateqAgentIndexEntrySchema = z.object({
  name: z.string().min(1),
  display_name: z.string().min(1),
  filename: z.string().min(1),
  source_file: z.string().min(1),
  description: z.string(),
  body_preview: z.string(),
  role: z.string().min(1),
  domains: z.array(z.string()),
  primary_domain: z.string().min(1),
  secondary_domains: z.array(z.string()),
  agent_type: z.enum(AGENT_TYPE_VALUES),
  capabilities: HecateqAgentCapabilitiesSchema,
  routing: HecateqAgentRoutingSchema,
  keywords: z.array(z.string()),
  use_when: z.array(z.string()),
  avoid_when: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  signals: z.object({
    filename: z.array(z.string()),
    frontmatter: z.array(z.string()),
    body: z.array(z.string()),
  }),
  frontmatter: HecateqAgentFrontmatterSchema.optional(),
  warnings: z.array(z.string()),
})

export const HecateqAgentIndexSchema = z.object({
  version: z.literal(INDEX_VERSION),
  generated_at: z.string().min(1),
  generator: z.literal(INDEX_GENERATOR),
  notice: z.literal(INDEX_NOTICE),
  enrichment_mode: z.literal("deterministic"),
  source: z.object({
    agents_dirs: z.array(z.string()),
  }),
  summary: z.object({
    agents_discovered: z.number().int().min(0),
    agents_indexed: z.number().int().min(0),
    weak_metadata: z.number().int().min(0),
    duplicates: z.number().int().min(0),
    high_ambiguity: z.number().int().min(0),
    unknown_primary_domain: z.number().int().min(0),
    domain_coverage: z.record(z.string(), z.number().int().min(0)),
  }),
  agents: z.array(HecateqAgentIndexEntrySchema),
})

export type HecateqAgentIndexEntry = z.infer<typeof HecateqAgentIndexEntrySchema>
export type HecateqAgentIndex = z.infer<typeof HecateqAgentIndexSchema>

export type AgentMarkdownSource = {
  filePath: string
  fileName: string
  fileStem: string
  declaredName?: string
  description?: string
  declaredRole?: string
  declaredDomainHints: string[]
  declaredKeywords: string[]
  declaredFocus?: string
  declaredUseWhen: string[]
  declaredAvoidWhen: string[]
  declaredMode?: string
  hidden: boolean
  enabledTools: string[]
  deniedTools: string[]
  body: string
  modifiedAtMs: number
}

export type GenerateHecateqAgentIndexResult = {
  ok: boolean
  outputPath: string
  agentsDiscovered: number
  agentsIndexed: number
  weakMetadata: number
  duplicates: number
  highAmbiguity: number
  unknownPrimaryDomain: number
  domainCoverage: Record<string, number>
  warnings: string[]
  overwritten: boolean
  reason?: string
  index?: HecateqAgentIndex
}

export type RuntimeAgentIndexCapabilities = {
  canPlan?: boolean
  canImplement?: boolean
  canReview?: boolean
  canTest?: boolean
  canDocument?: boolean
  canCoordinate?: boolean
}

export type RuntimeAgentIndexMetadata = {
  primaryDomain?: string
  secondaryDomains?: string[]
  agentType?: string
  confidence?: number
  ambiguity?: "low" | "medium" | "high"
  useWhen?: string[]
  avoidWhen?: string[]
  capabilities?: RuntimeAgentIndexCapabilities
  stale?: boolean
}

export type RuntimeAgentIndexConfig = {
  enabled?: boolean
  enrichRuntimeAgents?: boolean
  useForSuggestions?: boolean
  requireFresh?: boolean
  fallbackToRuntimeOnly?: boolean
  maxSuggestions?: number
}

type RuntimeAgentIdentity = {
  name: string
}

export type RuntimeAgentIndexJoinResult<TAgent extends RuntimeAgentIdentity> = {
  agents: Array<TAgent & { agentIndex?: RuntimeAgentIndexMetadata }>
  stale: boolean
  attachedCount: number
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function normalizeText(value: string): string {
  return normalizeWhitespace(value.toLowerCase())
}

function toDisplayName(name: string): string {
  return name
    .split(/[-_/\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value
  return `${value.slice(0, Math.max(0, limit - 14))}...[truncated]`
}

function tokenize(value: string): string[] {
  return Array.from(new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9çğıöşü.+#-]+/iu)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2),
  ))
}

function buildTextSignals(value: string): TextSignals {
  return {
    raw: value,
    normalized: normalizeText(value),
    tokens: new Set(tokenize(value)),
  }
}

function buildHeadingSignals(body: string): TextSignals {
  const headings = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^#{1,6}\s+/.test(line))
    .map((line) => line.replace(/^#{1,6}\s+/, ""))
    .join("\n")

  return buildTextSignals(headings)
}

function normalizeStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return Array.from(new Set(value
      .filter((item): item is string => typeof item === "string")
      .map((item) => normalizeWhitespace(item))
      .filter(Boolean)))
  }

  if (typeof value === "string") {
    return Array.from(new Set(value
      .split(/\r?\n|[,;]+/)
      .map((item) => normalizeWhitespace(item))
      .filter(Boolean)))
  }

  return []
}

function normalizeDomainHints(values: string[]): string[] {
  const normalized = new Set<string>()

  for (const value of values) {
    const input = normalizeText(value)
    const exact = DOMAIN_HINT_ALIASES[input]
    if (exact) {
      normalized.add(exact)
      continue
    }

    for (const [alias, domain] of Object.entries(DOMAIN_HINT_ALIASES)) {
      if (input.includes(alias)) normalized.add(domain)
    }
  }

  return Array.from(normalized)
}

function listEnabledTools(value: unknown): string[] {
  if (!value || typeof value !== "object") return []
  return Object.entries(value as Record<string, unknown>)
    .filter(([, enabled]) => enabled === true)
    .map(([tool]) => tool)
    .sort((left, right) => left.localeCompare(right))
}

function listDeniedTools(value: unknown): string[] {
  if (!value || typeof value !== "object") return []
  const denied = new Set<string>()

  for (const [tool, rule] of Object.entries(value as Record<string, unknown>)) {
    if (rule === "deny") denied.add(tool)
  }

  return Array.from(denied).sort((left, right) => left.localeCompare(right))
}

function hasTerm(source: TextSignals, term: string): boolean {
  const normalizedTerm = normalizeText(term)
  if (!normalizedTerm) return false

  if (normalizedTerm.includes(" ") || normalizedTerm.includes("/") || normalizedTerm.includes("-")) {
    return source.normalized.includes(normalizedTerm)
  }

  return source.tokens.has(normalizedTerm)
}

function extractListSection(body: string, headingPatterns: RegExp[]): string[] {
  const lines = body.split(/\r?\n/)
  let collecting = false
  const collected: string[] = []

  for (const rawLine of lines) {
    const line = rawLine.trim()
    const isHeading = /^#{1,6}\s+/.test(line)

    if (isHeading) {
      collecting = headingPatterns.some((pattern) => pattern.test(line))
      continue
    }

    if (!collecting) continue
    if (!line) {
      if (collected.length > 0) break
      continue
    }

    if (/^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
      collected.push(line.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, "").trim())
      continue
    }

    if (collected.length > 0) break
  }

  return Array.from(new Set(collected.map((item) => normalizeWhitespace(item)).filter(Boolean)))
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function roundToTwo(value: number): number {
  return Number(value.toFixed(2))
}

function incrementScore(map: Map<DomainName, number>, domain: DomainName, delta: number): void {
  map.set(domain, roundToTwo((map.get(domain) ?? 0) + delta))
}

function pushSignal(target: Set<string>, value: string): void {
  if (value.trim()) target.add(value.trim())
}

function computeDomainSignals(args: {
  fileStem: string
  description: string
  body: string
  useWhen: string[]
  avoidWhen: string[]
  declaredRole?: string
  declaredFocus?: string
  declaredDomainHints: string[]
  declaredKeywords: string[]
}): DomainComputation {
  const filenameSignals = new Set<string>()
  const frontmatterSignals = new Set<string>()
  const bodySignals = new Set<string>()
  const scores = new Map<DomainName, number>()

  const fileInfo = buildTextSignals(args.fileStem)
  const descriptionInfo = buildTextSignals(args.description)
  const bodyInfo = buildTextSignals(args.body)
  const headingInfo = buildHeadingSignals(args.body)
  const contextualInfo = buildTextSignals([...args.useWhen, ...args.avoidWhen].join("\n"))
  const metadataInfo = buildTextSignals([
    args.declaredRole ?? "",
    args.declaredFocus ?? "",
    ...args.declaredKeywords,
    ...args.declaredDomainHints,
  ].join("\n"))
  const normalizedHints = normalizeDomainHints(args.declaredDomainHints)

  for (const hintedDomain of normalizedHints) {
    incrementScore(scores, hintedDomain as DomainName, 4.4)
    pushSignal(frontmatterSignals, hintedDomain)
  }

  for (const domain of DOMAIN_NAMES) {
    const terms = DOMAIN_DEFINITIONS[domain].terms
    let bodyMatches = 0

    for (const term of terms) {
      if (hasTerm(fileInfo, term)) {
        incrementScore(scores, domain, 2.4)
        pushSignal(filenameSignals, term)
      }
      if (hasTerm(descriptionInfo, term)) {
        incrementScore(scores, domain, 2.9)
        pushSignal(frontmatterSignals, term)
      }
      if (hasTerm(metadataInfo, term)) {
        incrementScore(scores, domain, 2.6)
        pushSignal(frontmatterSignals, term)
      }
      if (hasTerm(headingInfo, term)) {
        incrementScore(scores, domain, 2.2)
        pushSignal(bodySignals, term)
      }
      if (hasTerm(contextualInfo, term)) {
        incrementScore(scores, domain, 1.6)
        pushSignal(bodySignals, term)
      }
      if (hasTerm(bodyInfo, term)) {
        bodyMatches += 1
        pushSignal(bodySignals, term)
      }
    }

    if (bodyMatches > 0) {
      incrementScore(scores, domain, Math.min(2.4, bodyMatches * 0.7))
    }
  }

  if (
    (scores.get("agent-orchestration") ?? 0) > 0
    && ((scores.get("contract-management") ?? 0) > 0)
    && (hasTerm(fileInfo, "agent") || hasTerm(descriptionInfo, "agent") || hasTerm(bodyInfo, "agent") || hasTerm(metadataInfo, "agent"))
    && (hasTerm(descriptionInfo, "coordination") || hasTerm(bodyInfo, "coordination") || hasTerm(descriptionInfo, "workflow") || hasTerm(bodyInfo, "workflow") || hasTerm(metadataInfo, "coordination") || hasTerm(metadataInfo, "workflow"))
  ) {
    incrementScore(scores, "agent-orchestration", 1.2)
  }

  const ranked = Array.from(scores.entries())
    .filter(([, score]) => score > 0)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))

  if (ranked.length === 0 || (ranked[0]?.[1] ?? 0) < PRIMARY_DOMAIN_MIN_SCORE) {
    return {
      primaryDomain: "unknown",
      secondaryDomains: [],
      domains: ["unknown"],
      ambiguity: "high",
      scores,
      filenameSignals: Array.from(filenameSignals),
      frontmatterSignals: Array.from(frontmatterSignals),
      bodySignals: Array.from(bodySignals),
    }
  }

  const [topDomain, topScore] = ranked[0]
  const secondScore = ranked[1]?.[1] ?? 0
  const competingDomains = ranked.filter(([, score]) => score >= SECONDARY_DOMAIN_MIN_SCORE)

  let ambiguity: RoutingAmbiguity = "low"
  if (topScore - secondScore <= DOMAIN_TIE_HIGH_THRESHOLD) ambiguity = "high"
  else if (topScore - secondScore <= DOMAIN_TIE_MEDIUM_THRESHOLD) ambiguity = "medium"
  if (competingDomains.length >= 5 && ambiguity === "low") ambiguity = "medium"

  const secondaryDomains = ranked
    .slice(1)
    .filter(([, score]) => score >= SECONDARY_DOMAIN_MIN_SCORE && score >= topScore * 0.3)
    .slice(0, MAX_SECONDARY_DOMAINS)
    .map(([domain]) => domain)

  const relatedDomains = RELATED_SECONDARY_DOMAINS[topDomain] ?? []
  const finalSecondaryDomains = Array.from(new Set([
    ...secondaryDomains,
    ...relatedDomains.filter((domain) => {
      if (domain === topDomain) return false
      if (topDomain === "android" && domain === "mobile") return true
      if (topDomain === "accessibility" && domain === "qa") return true
      return (scores.get(domain) ?? 0) > 0 || normalizedHints.includes(domain)
    }),
  ])).slice(0, MAX_SECONDARY_DOMAINS)

  return {
    primaryDomain: topDomain,
    secondaryDomains: finalSecondaryDomains,
    domains: [topDomain, ...finalSecondaryDomains],
    ambiguity,
    scores,
    filenameSignals: Array.from(filenameSignals),
    frontmatterSignals: Array.from(frontmatterSignals),
    bodySignals: Array.from(bodySignals),
  }
}

function buildRole(name: string, description: string, domains: string[], body: string, declaredRole?: string, declaredFocus?: string): string {
  if (description) return description
  if (declaredRole) return declaredRole
  if (declaredFocus) return truncate(declaredFocus, 180)

  const firstSentence = normalizeWhitespace(body.split(/(?<=[.!?])\s+/)[0] ?? "")
  if (firstSentence) return truncate(firstSentence, 180)
  if (domains.length > 0) return `${toDisplayName(name)} focused on ${domains.join(", ")}`
  return `${toDisplayName(name)} capability index entry`
}

function detectAgentType(args: {
  name: string
  description: string
  body: string
  primaryDomain: string
  declaredRole?: string
  declaredFocus?: string
}): AgentType {
  const text = normalizeText(`${args.name} ${args.description} ${args.declaredRole ?? ""} ${args.declaredFocus ?? ""} ${args.body}`)

  if (["agent-orchestration", "workflow", "coordination", "contract-management"].includes(args.primaryDomain) && ["orchestrator", "coordinator", "router", "manager"].some((term) => text.includes(term))) {
    return "orchestrator"
  }
  if (["strategy", "product-strategy", "risk-analysis"].includes(args.primaryDomain)) return "planner"
  if (["security", "compliance"].includes(args.primaryDomain)) {
    return "security"
  }
  if (
    !["devops", "android", "release"].includes(args.primaryDomain)
    && ["security", "devsecops", "owasp", "jwt", "oauth", "pentest", "threat model", "vulnerability", "auth hardening"].some((term) => text.includes(term))
  ) {
    return "security"
  }
  if (["devops", "android", "release"].includes(args.primaryDomain) && ["developer", "builder", "implementer", "deployment", "devops", "engineer", "architect"].some((term) => text.includes(term))) {
    return "devops"
  }
  if (args.primaryDomain === "incident-recovery") return "implementer"
  if (args.primaryDomain === "accessibility") return text.includes("tester") ? "tester" : "reviewer"
  if (args.primaryDomain === "qa" || ["tester", "qa", "verification", "playwright", "e2e"].some((term) => text.includes(term))) return "tester"
  if (args.primaryDomain === "api-integration") return "integration"
  if (["api ecosystem", "integration", "third-party", "third party", "navigator"].some((term) => text.includes(term))) return "integration"
  if (["documentarian", "technical writer", "documentation", "markdown report", "readme"].some((term) => text.includes(term)) || args.primaryDomain === "docs") return "documentarian"
  if (["builder", "developer", "implementer"].some((term) => text.includes(term))) return "implementer"
  if (["reviewer", "auditor", "checker", "guardian"].some((term) => text.includes(term))) return "reviewer"
  if (["planner", "strategy", "analyst"].some((term) => text.includes(term))) return "planner"
  if (["architect", "specialist", "expert"].some((term) => text.includes(term))) return "specialist"
  if (args.primaryDomain !== "unknown") return ["graphql", "backend", "realtime", "database", "mobile", "flutter"].includes(args.primaryDomain) ? "implementer" : "specialist"
  return "unknown"
}

function buildCapabilities(args: {
  name: string
  description: string
  body: string
  agentType: AgentType
  primaryDomain: string
  declaredRole?: string
  declaredFocus?: string
  declaredMode?: string
  enabledTools: string[]
  deniedTools: string[]
}): HecateqAgentCapabilities {
  const text = normalizeText(`${args.name} ${args.description} ${args.declaredRole ?? ""} ${args.declaredFocus ?? ""} ${args.body}`)
  const explicitlyNoCode = [
    "no code writing",
    "kod yazamazsın",
    "kod yazma",
    "source kodlarını okuyamazsın",
    "kaynak kodlarını okuyamazsın",
    "kod implementasyonu yapma",
    "sen kod yazamazsın",
  ].some((term) => text.includes(term))
  const writeDenied = args.deniedTools.includes("edit") || args.deniedTools.includes("write")
  const writeAvailable = args.enabledTools.includes("edit") || args.enabledTools.includes("write")
  const explicitImplementSignal = ["builder", "developer", "implementer", "write api", "build production", "bug fix", "resolver", "schema yazımı"].some((term) => text.includes(term))

  const capabilities: HecateqAgentCapabilities = {
    can_plan: ["architect", "planner", "analyst", "strategy", "scope", "mvp", "prioritization"].some((term) => text.includes(term)),
    can_implement: !explicitlyNoCode && !writeDenied && (explicitImplementSignal || writeAvailable),
    can_review: ["reviewer", "auditor", "checker", "guardian", "hardening", "review", "analysis", "critique", "risk", "scope control"].some((term) => text.includes(term)),
    can_test: ["tester", "qa", "playwright", "e2e", "verification", "regression", "test case"].some((term) => text.includes(term)) || ["qa", "accessibility", "incident-recovery"].includes(args.primaryDomain),
    can_document: ["documentarian", "documentation", "docs", "markdown", "report", "technical writer", "adr"].some((term) => text.includes(term)),
    can_coordinate: ["orchestrator", "manager", "coordinator", "contract manager", "router", "coordination", "handoff"].some((term) => text.includes(term)),
  }

  const fallback = CAPABILITY_FALLBACKS[args.agentType]
  for (const [key, value] of Object.entries(fallback) as [keyof HecateqAgentCapabilities, boolean][]) {
    capabilities[key] = capabilities[key] || value
  }

  if (explicitlyNoCode || writeDenied) capabilities.can_implement = false
  if (["product-strategy", "strategy", "risk-analysis", "architecture"].includes(args.primaryDomain) && !explicitImplementSignal) {
    capabilities.can_implement = false
  }
  if (["planner", "orchestrator", "reviewer", "documentarian", "tester"].includes(args.agentType) && !explicitImplementSignal) {
    capabilities.can_implement = false
  }
  if (args.declaredMode === "subagent" && !writeAvailable && !explicitImplementSignal) capabilities.can_implement = false

  if (!Object.values(capabilities).some(Boolean)) {
    capabilities.can_plan = true
  }

  return capabilities
}

function fallbackUseWhen(primaryDomain: string, secondaryDomains: string[], agentType: AgentType): string[] {
  const domain = (primaryDomain in DOMAIN_FALLBACK_USE_WHEN ? primaryDomain : secondaryDomains[0]) as DomainName | undefined
  const base = domain ? DOMAIN_FALLBACK_USE_WHEN[domain] : ["specialized domain analysis", "routing support", "focused technical review"]

  if (agentType === "implementer") return base.slice(0, 4)
  if (agentType === "tester") return [base[0] ?? "test planning", "verification workflows", "automation coverage review", ...(base.slice(1, 2))].slice(0, 4)
  if (agentType === "documentarian") return ["technical documentation", "implementation report", ...(base.slice(0, 2))].slice(0, 4)
  return base.slice(0, 5)
}

function fallbackAvoidWhen(primaryDomain: string, secondaryDomains: string[]): string[] {
  const domain = (primaryDomain in DOMAIN_FALLBACK_AVOID_WHEN ? primaryDomain : secondaryDomains[0]) as DomainName | undefined
  return (domain ? DOMAIN_FALLBACK_AVOID_WHEN[domain] : ["work outside the stated domain", "visual-only polish", "database-only tuning", "copywriting-only tasks"]).slice(0, 4)
}

function buildUseWhen(body: string, description: string, primaryDomain: string, secondaryDomains: string[], agentType: AgentType, declaredUseWhen: string[]): { items: string[]; usedFallback: boolean } {
  if (declaredUseWhen.length > 0) return { items: declaredUseWhen.slice(0, 5), usedFallback: false }

  const extracted = extractListSection(body, [
    /^#{1,6}\s*(when to use|use when|ne zaman kullanılır|kullanım alanı|mission|responsibilities|focus|core responsibilities)/i,
    /^#{1,6}\s*(scope|purpose|goals|what i do|what this agent does|what i can help with|ideal for|best for|scenarios)/i,
    /^#{1,6}\s*(kapsam|amaç|görev|hedef|yapabileceklerim|kullanım senaryoları)/i,
  ]).slice(0, 5)

  if (extracted.length > 0) return { items: extracted, usedFallback: false }

  const fromDescription = description
    .split(/[,;]|\.(?=\s|$)/)
    .map((item) => normalizeWhitespace(item))
    .filter((item) => item.length >= 8)
    .slice(0, 2)

  const fallback = [...fromDescription, ...fallbackUseWhen(primaryDomain, secondaryDomains, agentType)]
  return {
    items: Array.from(new Set(fallback)).slice(0, 5),
    usedFallback: true,
  }
}

function buildAvoidWhen(body: string, primaryDomain: string, secondaryDomains: string[], declaredAvoidWhen: string[]): { items: string[]; usedFallback: boolean } {
  if (declaredAvoidWhen.length > 0) return { items: declaredAvoidWhen.slice(0, 4), usedFallback: false }

  const extracted = extractListSection(body, [
    /^#{1,6}\s*(avoid when|when not to use|do not use|kullanma|sınırlar|boundaries|out of scope|ne zaman kullanılmaz|must not do)/i,
    /^#{1,6}\s*(limitations|caveats|what i don't do|what not to use|not for|not suitable|exclusions|constraints)/i,
    /^#{1,6}\s*(sınırlamalar|kısıtlamalar|yapamaz|kullanılmaz|uygun değil)/i,
  ]).slice(0, 4)

  if (extracted.length > 0) return { items: extracted, usedFallback: false }

  return {
    items: fallbackAvoidWhen(primaryDomain, secondaryDomains).slice(0, 4),
    usedFallback: true,
  }
}

function buildKeywords(args: {
  fileStem: string
  description: string
  body: string
  primaryDomain: string
  secondaryDomains: string[]
  filenameSignals: string[]
  frontmatterSignals: string[]
  bodySignals: string[]
  agentType: AgentType
}): string[] {
  const keywordWeights = new Map<string, number>()

  function addKeyword(keyword: string, weight: number): void {
    const normalized = normalizeWhitespace(keyword.toLowerCase())
    if (!normalized || normalized.length < 2) return
    if (STOPWORDS.has(normalized)) return
    keywordWeights.set(normalized, (keywordWeights.get(normalized) ?? 0) + weight)
  }

  const weightedSignals: Array<[string, number]> = [
    ...args.filenameSignals.map((signal): [string, number] => [signal, 4]),
    ...args.frontmatterSignals.map((signal): [string, number] => [signal, 5]),
    ...args.bodySignals.map((signal): [string, number] => [signal, 3]),
  ]

  for (const [signal, weight] of weightedSignals) addKeyword(signal, weight)
  addKeyword(args.primaryDomain, 6)
  addKeyword(args.agentType, 4)
  for (const domain of args.secondaryDomains) addKeyword(domain, 3)

  for (const token of tokenize(`${args.fileStem} ${args.description} ${args.body}`)) {
    if (STOPWORDS.has(token)) continue
    const weight = IMPORTANT_TURKISH_TOKENS.has(token) ? 2.5 : 1
    addKeyword(token, weight)
  }

  return Array.from(keywordWeights.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([keyword]) => keyword)
    .slice(0, MAX_KEYWORDS)
}

function computeConfidence(args: {
  filenameSignals: string[]
  description: string
  bodySignals: string[]
  primaryDomain: string
  ambiguity: RoutingAmbiguity
  useWhenFallback: boolean
  avoidWhenFallback: boolean
  bodyLength: number
  domainCount: number
  agentType: AgentType
  frontmatterSignals: string[]
}): number {
  let confidence = 0.25
  confidence += Math.min(0.15, args.filenameSignals.length * 0.05)
  confidence += args.description.length >= 24 ? 0.25 : args.description.length > 0 ? 0.12 : 0
  confidence += Math.min(0.2, args.bodySignals.length * 0.04)
  confidence += args.useWhenFallback ? 0.03 : 0.06
  confidence += args.avoidWhenFallback ? 0.03 : 0.04
  confidence += args.primaryDomain !== "unknown" ? 0.15 : 0
  confidence += args.bodyLength >= MIN_BODY_LENGTH_FOR_METADATA ? 0.05 : 0

  // Agent type bonus: well-defined types boost confidence
  if (args.agentType === "orchestrator" || args.agentType === "specialist") confidence += 0.03
  else if (args.agentType !== "unknown") confidence += 0.02

  // Combined filename+frontmatter signal richness bonus
  const totalSignals = args.filenameSignals.length + args.frontmatterSignals.length
  if (totalSignals >= 4) confidence += 0.05
  else if (totalSignals >= 2) confidence += 0.02

  // Body quality bonus: proportionate to length beyond minimum
  if (args.bodyLength > MIN_BODY_LENGTH_FOR_METADATA * 2) confidence += 0.04
  else if (args.bodyLength > MIN_BODY_LENGTH_FOR_METADATA * 1.5) confidence += 0.02

  if (args.ambiguity === "medium") confidence -= 0.08
  if (args.ambiguity === "high") confidence -= 0.18
  if (!args.description) confidence -= 0.08
  if (args.primaryDomain === "unknown") confidence -= 0.15
  if (args.domainCount > 4) confidence -= 0.08

  return roundToTwo(clamp(confidence, 0, 1))
}

function buildWarnings(args: {
  description: string
  body: string
  primaryDomain: string
  domains: string[]
  ambiguity: RoutingAmbiguity
  confidence: number
  duplicateCount: number
  useWhenFallback: boolean
  avoidWhenFallback: boolean
  agentType: AgentType
  filenameSignals: string[]
  frontmatterSignals: string[]
}): string[] {
  const warnings: string[] = []
  const normalizedBodyLength = normalizeWhitespace(args.body).length

  if (!args.description) warnings.push("missing description")
  if (normalizedBodyLength < MIN_BODY_LENGTH_FOR_METADATA) warnings.push("body too short")
  if (args.primaryDomain === "unknown") warnings.push("no clear domain detected")
  if (args.ambiguity === "high") warnings.push("high routing ambiguity")
  if (args.duplicateCount > 1) warnings.push("duplicate effective name")
  if (args.domains.length > 4 && args.ambiguity !== "low") warnings.push("too many competing domains")
  if (args.useWhenFallback) warnings.push("use_when generated from fallback")
  if (args.avoidWhenFallback) warnings.push("avoid_when generated from fallback")
  if (args.agentType === "unknown" && args.primaryDomain !== "unknown") warnings.push("agent type undetermined")
  if (args.description && args.description.length < 24) warnings.push("description too short")

  // Missing frontmatter name signal
  if (args.filenameSignals.length === 0 && args.frontmatterSignals.length === 0) {
    warnings.push("no domain signals found")
  }

  const isWeak = (
    args.confidence < 0.6
    || args.primaryDomain === "unknown"
    || args.ambiguity === "high"
    || !args.description
    || normalizedBodyLength < MIN_BODY_LENGTH_FOR_METADATA
  )
  if (isWeak) warnings.push("weak metadata")

  return warnings
}

function buildRouting(args: {
  confidence: number
  ambiguity: RoutingAmbiguity
  useWhen: string[]
  avoidWhen: string[]
  capabilities: HecateqAgentCapabilities
  agentType: AgentType
}): z.infer<typeof HecateqAgentRoutingSchema> {
  let priority = 35 + Math.round(args.confidence * 40)
  if (args.capabilities.can_coordinate) priority += 5
  if (args.capabilities.can_implement) priority += 5
  if (args.agentType === "unknown") priority -= 10
  if (args.ambiguity === "medium") priority -= 5
  if (args.ambiguity === "high") priority -= 12

  return {
    priority: clamp(priority, 5, 95),
    ambiguity: args.ambiguity,
    best_for: args.useWhen.slice(0, 4),
    not_for: args.avoidWhen.slice(0, 4),
  }
}

function getGlobalAgentDirs(): string[] {
  return Array.from(new Set(
    getOpenCodeConfigDirs({ binary: "opencode" }).map((configDir) => join(configDir, "agents")),
  ))
}

export function getHecateqAgentIndexOutputPath(): string {
  const configDir = getOpenCodeConfigDir({ binary: "opencode" })
  return join(configDir, "hecateq", "agent-index.generated.json")
}

export function discoverGlobalAgentMarkdownSources(): AgentMarkdownSource[] {
  const sources: AgentMarkdownSource[] = []

  for (const agentsDir of getGlobalAgentDirs()) {
    if (!existsSync(agentsDir)) continue

    const entries = readdirSync(agentsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
      .sort((left, right) => left.name.localeCompare(right.name))

    for (const entry of entries) {
      const filePath = join(agentsDir, entry.name)
      const content = readFileSync(filePath, "utf-8")
      const { data, body } = parseFrontmatter<Record<string, unknown>>(content)
      const fileStem = entry.name.replace(/\.md$/i, "")
      const stats = statSync(filePath)
      const declaredDomainHints = normalizeDomainHints([
        ...normalizeStringList(data.domain),
        ...normalizeStringList(data.domains),
      ])

      sources.push({
        filePath,
        fileName: entry.name,
        fileStem,
        declaredName: typeof data.name === "string" && data.name.trim().length > 0 ? data.name.trim() : undefined,
        description: typeof data.description === "string" ? normalizeWhitespace(data.description) : undefined,
        declaredRole: typeof data.role === "string" ? normalizeWhitespace(data.role) : undefined,
        declaredDomainHints,
        declaredKeywords: normalizeStringList(data.keywords),
        declaredFocus: typeof data.focus === "string" ? normalizeWhitespace(data.focus) : undefined,
        declaredUseWhen: normalizeStringList(data.use_when),
        declaredAvoidWhen: normalizeStringList(data.avoid_when),
        declaredMode: typeof data.mode === "string" ? normalizeWhitespace(data.mode) : undefined,
        hidden: data.hidden === true,
        enabledTools: listEnabledTools(data.tools),
        deniedTools: listDeniedTools(data.permission),
        body: body.trim(),
        modifiedAtMs: stats.mtimeMs,
      })
    }
  }

  return sources
}

function createIndexEntry(source: AgentMarkdownSource, duplicateCounts: Map<string, number>): HecateqAgentIndexEntry {
  const effectiveName = source.declaredName?.trim() || source.fileStem
  const description = source.description ?? ""
  const bodyPreview = truncate(normalizeWhitespace(source.body), BODY_PREVIEW_LIMIT)
  const initialUseWhen = source.declaredUseWhen.length > 0
    ? source.declaredUseWhen
    : extractListSection(source.body, [/^#{1,6}\s*(when to use|use when|ne zaman kullanılır|kullanım alanı|mission|responsibilities|focus|core responsibilities)/i])
  const initialAvoidWhen = source.declaredAvoidWhen.length > 0
    ? source.declaredAvoidWhen
    : extractListSection(source.body, [/^#{1,6}\s*(avoid when|when not to use|do not use|kullanma|sınırlar|boundaries|out of scope|ne zaman kullanılmaz|must not do)/i])
  const domainComputation = computeDomainSignals({
    fileStem: source.fileStem,
    description,
    body: source.body,
    useWhen: initialUseWhen,
    avoidWhen: initialAvoidWhen,
    declaredRole: source.declaredRole,
    declaredFocus: source.declaredFocus,
    declaredDomainHints: source.declaredDomainHints,
    declaredKeywords: source.declaredKeywords,
  })
  const agentType = detectAgentType({
    name: effectiveName,
    description,
    body: source.body,
    primaryDomain: domainComputation.primaryDomain,
    declaredRole: source.declaredRole,
    declaredFocus: source.declaredFocus,
  })
  const useWhenResult = buildUseWhen(
    source.body,
    description,
    domainComputation.primaryDomain,
    domainComputation.secondaryDomains,
    agentType,
    source.declaredUseWhen,
  )
  const avoidWhenResult = buildAvoidWhen(source.body, domainComputation.primaryDomain, domainComputation.secondaryDomains, source.declaredAvoidWhen)
  const capabilities = buildCapabilities({
    name: effectiveName,
    description,
    body: source.body,
    agentType,
    primaryDomain: domainComputation.primaryDomain,
    declaredRole: source.declaredRole,
    declaredFocus: source.declaredFocus,
    declaredMode: source.declaredMode,
    enabledTools: source.enabledTools,
    deniedTools: source.deniedTools,
  })
  const confidence = computeConfidence({
    filenameSignals: domainComputation.filenameSignals,
    description,
    bodySignals: domainComputation.bodySignals,
    primaryDomain: domainComputation.primaryDomain,
    ambiguity: domainComputation.ambiguity,
    useWhenFallback: useWhenResult.usedFallback,
    avoidWhenFallback: avoidWhenResult.usedFallback,
    bodyLength: normalizeWhitespace(source.body).length,
    domainCount: domainComputation.domains.length,
    agentType,
    frontmatterSignals: domainComputation.frontmatterSignals,
  })
  const warnings = buildWarnings({
    description,
    body: source.body,
    primaryDomain: domainComputation.primaryDomain,
    domains: domainComputation.domains,
    ambiguity: domainComputation.ambiguity,
    confidence,
    duplicateCount: duplicateCounts.get(effectiveName.toLowerCase()) ?? 0,
    useWhenFallback: useWhenResult.usedFallback,
    avoidWhenFallback: avoidWhenResult.usedFallback,
    agentType,
    filenameSignals: domainComputation.filenameSignals,
    frontmatterSignals: domainComputation.frontmatterSignals,
  })
  const routing = buildRouting({
    confidence,
    ambiguity: domainComputation.ambiguity,
    useWhen: useWhenResult.items,
    avoidWhen: avoidWhenResult.items,
    capabilities,
    agentType,
  })

  return {
    name: effectiveName,
    display_name: toDisplayName(effectiveName),
    filename: source.fileName,
    source_file: source.filePath,
    description,
    body_preview: bodyPreview,
    role: buildRole(effectiveName, description, domainComputation.domains, source.body, source.declaredRole, source.declaredFocus),
    domains: domainComputation.domains,
    primary_domain: domainComputation.primaryDomain,
    secondary_domains: domainComputation.secondaryDomains,
    agent_type: agentType,
    capabilities,
    routing,
    keywords: buildKeywords({
      fileStem: source.fileStem,
      description,
      body: source.body,
      primaryDomain: domainComputation.primaryDomain,
      secondaryDomains: domainComputation.secondaryDomains,
      filenameSignals: domainComputation.filenameSignals,
      frontmatterSignals: [...domainComputation.frontmatterSignals, ...source.declaredKeywords, ...source.declaredDomainHints],
      bodySignals: domainComputation.bodySignals,
      agentType,
    }),
    use_when: useWhenResult.items,
    avoid_when: avoidWhenResult.items,
    confidence,
    signals: {
      filename: domainComputation.filenameSignals,
      frontmatter: domainComputation.frontmatterSignals,
      body: domainComputation.bodySignals,
    },
    frontmatter: {
      role: source.declaredRole,
      focus: source.declaredFocus,
      domain_hints: source.declaredDomainHints,
      keywords: source.declaredKeywords,
      use_when: source.declaredUseWhen,
      avoid_when: source.declaredAvoidWhen,
      mode: source.declaredMode,
      hidden: source.hidden,
      enabled_tools: source.enabledTools,
      denied_tools: source.deniedTools,
    },
    warnings,
  }
}

function buildDomainCoverage(agents: HecateqAgentIndexEntry[]): Record<string, number> {
  const coverage: Record<string, number> = {}
  for (const agent of agents) {
    const key = agent.primary_domain
    coverage[key] = (coverage[key] ?? 0) + 1
  }
  return Object.fromEntries(Object.entries(coverage).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])))
}

export function buildHecateqAgentIndex(sources = discoverGlobalAgentMarkdownSources()): HecateqAgentIndex {
  const duplicateCounts = new Map<string, number>()
  for (const source of sources) {
    const effectiveName = (source.declaredName?.trim() || source.fileStem).toLowerCase()
    duplicateCounts.set(effectiveName, (duplicateCounts.get(effectiveName) ?? 0) + 1)
  }

  const agents = sources.map((source) => createIndexEntry(source, duplicateCounts))
  const weakMetadata = agents.filter((agent) => agent.warnings.includes("weak metadata")).length
  const duplicates = Array.from(duplicateCounts.values()).filter((count) => count > 1).length
  const highAmbiguity = agents.filter((agent) => agent.routing.ambiguity === "high").length
  const unknownPrimaryDomain = agents.filter((agent) => agent.primary_domain === "unknown").length
  const domainCoverage = buildDomainCoverage(agents)

  return HecateqAgentIndexSchema.parse({
    version: INDEX_VERSION,
    generated_at: new Date().toISOString(),
    generator: INDEX_GENERATOR,
    notice: INDEX_NOTICE,
    enrichment_mode: "deterministic",
    source: {
      agents_dirs: getGlobalAgentDirs(),
    },
    summary: {
      agents_discovered: sources.length,
      agents_indexed: agents.length,
      weak_metadata: weakMetadata,
      duplicates,
      high_ambiguity: highAmbiguity,
      unknown_primary_domain: unknownPrimaryDomain,
      domain_coverage: domainCoverage,
    },
    agents,
  })
}

function canOverwriteExistingIndex(outputPath: string): boolean {
  if (!existsSync(outputPath)) return true

  try {
    const parsed = JSON.parse(readFileSync(outputPath, "utf-8")) as Record<string, unknown>
    return parsed.generator === INDEX_GENERATOR || parsed.notice === INDEX_NOTICE
  } catch {
    return false
  }
}

export function writeHecateqAgentIndex(): GenerateHecateqAgentIndexResult {
  const outputPath = getHecateqAgentIndexOutputPath()
  const sources = discoverGlobalAgentMarkdownSources()
  const index = buildHecateqAgentIndex(sources)

  if (!canOverwriteExistingIndex(outputPath)) {
    return {
      ok: false,
      outputPath,
      agentsDiscovered: index.summary.agents_discovered,
      agentsIndexed: index.summary.agents_indexed,
      weakMetadata: index.summary.weak_metadata,
      duplicates: index.summary.duplicates,
      highAmbiguity: index.summary.high_ambiguity,
      unknownPrimaryDomain: index.summary.unknown_primary_domain,
      domainCoverage: index.summary.domain_coverage,
      warnings: ["Existing index file is not recognized as generated output; refusing to overwrite."],
      overwritten: false,
      reason: "non-generated-existing-file",
      index,
    }
  }

  mkdirSync(dirname(outputPath), { recursive: true })
  const existed = existsSync(outputPath)
  writeFileSync(outputPath, `${JSON.stringify(index, null, 2)}\n`, "utf-8")

  return {
    ok: true,
    outputPath,
    agentsDiscovered: index.summary.agents_discovered,
    agentsIndexed: index.summary.agents_indexed,
    weakMetadata: index.summary.weak_metadata,
    duplicates: index.summary.duplicates,
    highAmbiguity: index.summary.high_ambiguity,
    unknownPrimaryDomain: index.summary.unknown_primary_domain,
    domainCoverage: index.summary.domain_coverage,
    warnings: [],
    overwritten: existed,
    index,
  }
}

function buildSummaryAgentTypeDistribution(result: GenerateHecateqAgentIndexResult): string[] {
  if (!result.index || result.index.agents.length === 0) return []
  const typeDist = new Map<string, number>()
  for (const agent of result.index.agents) {
    const at = agent.agent_type ?? "unknown"
    typeDist.set(at, (typeDist.get(at) ?? 0) + 1)
  }
  const sorted = Array.from(typeDist.entries()).sort((a, b) => b[1] - a[1])
  return sorted.map(([type, count]) => `  ${type}: ${count}`)
}

export function formatHecateqAgentIndexSummary(result: GenerateHecateqAgentIndexResult): string {
  const coverageLines = Object.entries(result.domainCoverage)
    .filter(([, count]) => count > 0)
    .slice(0, 8)
    .map(([domain, count]) => `- ${domain}: ${count}`)

  const typeDistLines = buildSummaryAgentTypeDistribution(result)

  const lines = [
    result.ok ? "Hecateq Agent Index generated" : "Hecateq Agent Index not written",
    "",
    `Agents discovered: ${result.agentsDiscovered}`,
    `Agents indexed: ${result.agentsIndexed}`,
    `Weak metadata/routing: ${result.weakMetadata}`,
    `High ambiguity: ${result.highAmbiguity}`,
    `Unknown primary domain: ${result.unknownPrimaryDomain}`,
    `Duplicates: ${result.duplicates}`,
  ]

  if (typeDistLines.length > 0) {
    lines.push("", "Agent type distribution:")
    lines.push(...typeDistLines)
  }

  lines.push("", "Domain coverage:")
  lines.push(...(coverageLines.length > 0 ? coverageLines : ["- none"]))
  lines.push("", `Output: ${result.outputPath}`)

  if (!result.ok && result.reason === "non-generated-existing-file") {
    lines.push("", "Refused to overwrite an existing non-generated file at the output path.")
  }

  lines.push("", "Next:", "- Run oh-my-openagent doctor to verify quality.")

  return lines.join("\n")
}

export function readHecateqAgentIndexFile(outputPath = getHecateqAgentIndexOutputPath()): HecateqAgentIndex | null {
  if (!existsSync(outputPath)) return null

  try {
    const parsed = JSON.parse(readFileSync(outputPath, "utf-8"))
    return HecateqAgentIndexSchema.parse(parsed)
  } catch {
    return null
  }
}

function normalizeAgentIndexSlug(value: string): string {
  return stripAgentListSortPrefix(value)
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/-+/g, "-")
}

function normalizeAgentIndexLookupKeys(value: string): string[] {
  const trimmed = stripAgentListSortPrefix(value).trim()
  if (!trimmed) return []

  const lower = trimmed.toLowerCase()
  const configKey = getAgentConfigKey(trimmed)
  const migrated = AGENT_NAME_MAP[lower] ?? AGENT_NAME_MAP[trimmed] ?? AGENT_NAME_MAP[configKey] ?? configKey
  const slug = normalizeAgentIndexSlug(trimmed)
  const migratedSlug = normalizeAgentIndexSlug(migrated)

  return Array.from(new Set([
    migrated,
    configKey,
    lower,
    slug,
    migratedSlug,
  ].filter((entry) => entry.length > 0)))
}

export function normalizeAgentIndexName(value: string): string {
  return normalizeAgentIndexLookupKeys(value)[0] ?? ""
}

function buildAgentIndexEntryLookupKeys(entry: HecateqAgentIndexEntry): string[] {
  const fileStem = entry.filename.replace(/\.[^.]+$/u, "")
  return Array.from(new Set([
    ...normalizeAgentIndexLookupKeys(entry.name),
    ...normalizeAgentIndexLookupKeys(entry.display_name),
    ...normalizeAgentIndexLookupKeys(fileStem),
  ]))
}

function toRuntimeAgentIndexMetadata(entry: HecateqAgentIndexEntry, stale: boolean): RuntimeAgentIndexMetadata {
  return {
    primaryDomain: entry.primary_domain,
    secondaryDomains: entry.secondary_domains,
    agentType: entry.agent_type,
    confidence: entry.confidence,
    ambiguity: entry.routing.ambiguity,
    useWhen: entry.use_when,
    avoidWhen: entry.avoid_when,
    capabilities: {
      canPlan: entry.capabilities.can_plan,
      canImplement: entry.capabilities.can_implement,
      canReview: entry.capabilities.can_review,
      canTest: entry.capabilities.can_test,
      canDocument: entry.capabilities.can_document,
      canCoordinate: entry.capabilities.can_coordinate,
    },
    ...(stale ? { stale: true } : {}),
  }
}

export function isHecateqAgentIndexStale(
  index: HecateqAgentIndex,
  latestSourceMtimeMs = getLatestGlobalAgentSourceMtimeMs(),
): boolean {
  if (!Number.isFinite(latestSourceMtimeMs) || latestSourceMtimeMs <= 0) {
    return false
  }

  const generatedAtMs = Date.parse(index.generated_at)
  if (!Number.isFinite(generatedAtMs)) {
    return true
  }

  return generatedAtMs < latestSourceMtimeMs
}

export function joinAgentIndexMetadata<TAgent extends RuntimeAgentIdentity>(
  runtimeAgents: TAgent[],
  agentIndex: HecateqAgentIndex | null,
  config: RuntimeAgentIndexConfig = {},
): RuntimeAgentIndexJoinResult<TAgent> {
  const enabled = config.enabled ?? true
  const enrichRuntimeAgents = config.enrichRuntimeAgents ?? true
  const requireFresh = config.requireFresh ?? false

  if (!enabled || !enrichRuntimeAgents || !agentIndex) {
    return { agents: runtimeAgents.map((agent) => ({ ...agent })), stale: false, attachedCount: 0 }
  }

  const stale = isHecateqAgentIndexStale(agentIndex)
  if (stale && requireFresh) {
    return { agents: runtimeAgents.map((agent) => ({ ...agent })), stale: true, attachedCount: 0 }
  }

  const canonicalCounts = new Map<string, number>()
  for (const entry of agentIndex.agents) {
    const canonicalKey = normalizeAgentIndexName(entry.name)
    if (!canonicalKey) continue
    canonicalCounts.set(canonicalKey, (canonicalCounts.get(canonicalKey) ?? 0) + 1)
  }

  const metadataByKey = new Map<string, RuntimeAgentIndexMetadata>()
  const duplicateKeys = new Set<string>()

  for (const entry of agentIndex.agents) {
    const canonicalKey = normalizeAgentIndexName(entry.name)
    if (canonicalKey && (canonicalCounts.get(canonicalKey) ?? 0) > 1) {
      continue
    }

    const metadata = toRuntimeAgentIndexMetadata(entry, stale)
    for (const key of buildAgentIndexEntryLookupKeys(entry)) {
      if (duplicateKeys.has(key)) continue
      if (metadataByKey.has(key)) {
        metadataByKey.delete(key)
        duplicateKeys.add(key)
        continue
      }
      metadataByKey.set(key, metadata)
    }
  }

  let attachedCount = 0
  const agents = runtimeAgents.map((agent) => {
    const match = normalizeAgentIndexLookupKeys(agent.name)
      .map((key) => metadataByKey.get(key))
      .find((metadata) => metadata !== undefined)

    if (!match) {
      return { ...agent }
    }

    attachedCount += 1
    return {
      ...agent,
      agentIndex: match,
    }
  })

  return { agents, stale, attachedCount }
}

export function getLatestGlobalAgentSourceMtimeMs(): number {
  const sources = discoverGlobalAgentMarkdownSources()
  return sources.reduce((latest, source) => Math.max(latest, source.modifiedAtMs), 0)
}

export function getGlobalAgentSourceCount(): number {
  return discoverGlobalAgentMarkdownSources().length
}

export function toTildePath(filePath: string): string {
  const home = homedir()
  return filePath.startsWith(home) ? filePath.replace(home, "~") : filePath
}
