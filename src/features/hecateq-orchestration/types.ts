/**
 * Core types for the Hecateq Autonomous Task Orchestration Pipeline.
 *
 * These types define the contract between all orchestration stages:
 * prompt-intake → task-decomposer → dependency-planner → agent-selector →
 * execution-planner → quality-gate-runner → repair-loop-controller → final-report-generator.
 */

// ─── Prompt Intake ───────────────────────────────────────────────────────────

export type TaskSize = "small" | "medium" | "large"

export type DomainScope =
  | "single-domain"
  | "multi-domain"
  | "unknown-domain"

export type RiskLevel =
  | "low"
  | "medium"
  | "high"
  | "destructive"

export type IntentKind =
  | "implementation"
  | "bugfix"
  | "refactor"
  | "research"
  | "planning"
  | "review"
  | "devops"
  | "documentation"
  | "unknown"

export interface PromptIntakeResult {
  /** Original normalized prompt text */
  rawPrompt: string
  /** Normalized/cleaned prompt */
  normalizedPrompt: string
  /** Estimated task size */
  taskSize: TaskSize
  /** Domain scope */
  domainScope: DomainScope
  /** Likely domains inferred from prompt */
  likelyDomains: string[]
  /** Primary intent classification */
  intent: IntentKind
  /** Risk level */
  riskLevel: RiskLevel
  /** Whether planning is required before implementation */
  requiresPlan: boolean
  /** Whether implementation is required */
  requiresImplementation: boolean
  /** Whether testing is required */
  requiresTesting: boolean
  /** User-specified constraints */
  constraints: string[]
  /** User-specified exclusions from prompt */
  userExclusions: string[]
  /** Explicit agents requested in prompt (if any) */
  requestedAgents: string[]
  /** Whether the prompt is ambiguous enough to need clarification */
  ambiguous: boolean
}

// ─── Task Decomposition ──────────────────────────────────────────────────────

export type TaskNodeStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | "blocked"
  | "skipped"

export type TaskDomain =
  | "backend"
  | "frontend"
  | "database"
  | "devops"
  | "security"
  | "qa"
  | "docs"
  | "architecture"
  | "research"
  | "planning"
  | "unknown"

export type TaskAction = "read" | "write" | "both"

export interface TaskNode {
  /** Unique task ID within the graph */
  id: string
  /** Short descriptive label */
  label: string
  /** Detailed prompt for this task */
  prompt: string
  /** Domain classification */
  domain: TaskDomain
  /** Whether this task is read-only, write, or both */
  action: TaskAction
  /** IDs of tasks this task depends on */
  dependsOn: string[]
  /** Current status */
  status: TaskNodeStatus
  /** Arbitrary metadata for routing */
  metadata?: Record<string, unknown>
  /** Estimated complexity score (0-1) */
  complexity?: number
  /** Assigned agent name (set by agent-selector) */
  assignedAgent?: string
  /** Fallback reason if exact agent was not found (set by agent-selector) */
  agentFallbackReason?: string
  /** Whether this task can run in parallel with siblings */
  canParallelize?: boolean
  /** Human-readable error if failed */
  error?: string
  /** Repair attempt counter */
  repairAttempts?: number
}

// ─── Dependency Planning ─────────────────────────────────────────────────────

export interface CycleDetectionResult {
  hasCycle: boolean
  cycle: string[]
  /** IDs of nodes involved in the cycle */
  cycleNodeIds: string[]
}

export interface DependencyPlan {
  /** All task nodes in the graph */
  nodes: TaskNode[]
  /** Batch indices: each inner array is a batch of task IDs that can run in parallel */
  batches: string[][]
  /** Cycle detection result (empty means no cycle) */
  cycle: CycleDetectionResult
  /** IDs of tasks that are blocked (dependencies failed) */
  blockedTaskIds: string[]
  /** IDs of tasks that are ready to execute */
  readyTaskIds: string[]
  /** Total estimated wall-clock batches (sequential layers) */
  totalBatches: number
}

// ─── Agent Selection ─────────────────────────────────────────────────────────

export interface AgentSelectionEntry {
  taskId: string
  /** Selected agent name (exact match if found, else category-based) */
  selectedAgent: string
  /** Whether an exact match was found in the registry */
  exactMatch: boolean
  /** Reason for fallback if exact match was not used */
  fallbackReason?: string
  /** Whether agent is disabled in config */
  disabled?: boolean
  /** Whether agent is unknown in registry */
  unknown?: boolean
}

export interface AgentSelectorResult {
  entries: AgentSelectionEntry[]
  /** Tasks that could not be assigned to any agent */
  unassignedTasks: Array<{ taskId: string; reason: string }>
  /** Count of exact matches */
  exactMatchCount: number
  /** Count of fallback assignments */
  fallbackCount: number
}

// ─── Execution Planning ──────────────────────────────────────────────────────

export type ExecutionBatchKind = "sequential" | "parallel_read" | "parallel_write"

export interface ExecutionBatch {
  /** Batch index (execution order) */
  index: number
  /** Kind of execution */
  kind: ExecutionBatchKind
  /** Task IDs in this batch */
  taskIds: string[]
  /** Whether tasks in this batch can timeout independently */
  timedOutTaskIds?: string[]
}

export interface ExecutionPlan {
  /** Ordered execution batches */
  batches: ExecutionBatch[]
  /** Total estimated duration hint */
  estimatedBatchCount: number
  /** Whether any task is blocked and cannot proceed */
  hasBlockedTasks: boolean
  /** Blocked task IDs */
  blockedTaskIds: string[]
}

// ─── Quality Gates ───────────────────────────────────────────────────────────

export type QualityGateKind = "typecheck" | "lint" | "test" | "build" | "doctor"

export interface QualityGateResult {
  gate: QualityGateKind
  /** Whether this gate passed */
  passed: boolean
  /** Command that was executed */
  command?: string
  /** Exit code (if applicable) */
  exitCode?: number
  /** Stdout summary */
  stdout?: string
  /** Stderr summary */
  stderr?: string
  /** Human-readable message */
  message: string
  /** Whether the gate was skipped (command not found) */
  skipped: boolean
}

export interface QualityGateReport {
  results: QualityGateResult[]
  /** Overall pass/fail */
  allPassed: boolean
  /** Number of gates that passed */
  passedCount: number
  /** Number of gates that failed */
  failedCount: number
  /** Number of gates that were skipped */
  skippedCount: number
  /** Commands discovered in project */
  discoveredCommands: Record<string, string>
}

// ─── Repair Loop ─────────────────────────────────────────────────────────────

export type FailureClassification =
  | "typecheck"
  | "lint"
  | "test"
  | "build"
  | "runtime"
  | "timeout"
  | "unknown"

export interface RepairAction {
  /** Task ID to repair */
  taskId: string
  /** Classification of the failure */
  classification: FailureClassification
  /** Human-readable description of the failure */
  failureDescription: string
  /** Suggested files to target */
  targetFiles: string[]
  /** Suggested repair prompt for the retry */
  repairPrompt: string
  /** Attempt number (1-based) */
  attempt: number
  /** Max allowed attempts */
  maxAttempts: number
  /** Whether this repair was attempted */
  attempted: boolean
  /** Whether this repair succeeded */
  succeeded?: boolean
  /** Error message if repair failed */
  error?: string
}

export interface RepairLoopResult {
  /** All repair actions taken */
  actions: RepairAction[]
  /** Whether the loop succeeded overall */
  succeeded: boolean
  /** Number of repairs attempted */
  totalRepairs: number
  /** Number of successful repairs */
  successfulRepairs: number
  /** Number of failed repairs */
  failedRepairs: number
  /** Whether any repair hit the retry cap */
  hitRetryCap: boolean
}

// ─── Final Report ────────────────────────────────────────────────────────────

export interface ChangedFile {
  path: string
  changeType: "modified" | "created" | "deleted" | "unknown"
}

export interface OrchestrationReportSection {
  title: string
  body: string
}

export interface OrchestrationReport {
  /** ISO timestamp */
  timestamp: string
  /** Original prompt */
  prompt: string
  /** Overall summary */
  summary: string
  /** Sections for the markdown report */
  sections: OrchestrationReportSection[]
  /** Files that were changed */
  changedFiles: ChangedFile[]
  /** Quality gate results summary */
  qualityGatesSummary: string
  /** Repair loop summary */
  repairSummary: string
  /** Whether the overall orchestration succeeded */
  succeeded: boolean
}

// ─── Task Execution Result ───────────────────────────────────────────────────

export interface TaskExecutionResult {
  /** ID of the task that was executed */
  taskId: string
  /** Agent that was assigned to execute */
  agentId: string
  /** Final status after execution */
  status: TaskNodeStatus
  /** Files changed during execution */
  changedFiles: ChangedFile[]
  /** Artifact paths produced (reports, generated files, etc.) */
  producedArtifacts: string[]
  /** Error summary if the task failed */
  errorSummary?: string
}

/**
 * Callback signature for executing a single task batch.
 * The controller calls this for each batch, and the runtime
 * integration (e.g. delegate-task) provides the real implementation.
 */
export type TaskBatchExecutor = (
  batch: ExecutionBatch,
  tasks: TaskNode[],
  agentAssignments: AgentSelectionEntry[],
) => TaskExecutionResult[] | Promise<TaskExecutionResult[]>

// ─── Orchestration State (persisted) ─────────────────────────────────────────

export interface OrchestrationSessionState {
  /** Unique session ID */
  id: string
  /** ISO timestamp started */
  startedAt: string
  /** ISO timestamp last updated */
  updatedAt: string
  /** Original prompt */
  prompt: string
  /** Pipeline phase */
  phase: PipelinePhase
  /** All task nodes */
  tasks: TaskNode[]
  /** Dependency batches */
  batches: string[][]
  /** Agent assignments */
  agentAssignments: AgentSelectionEntry[]
  /** Execution results per task */
  executionResults?: TaskExecutionResult[]
  /** Quality gate results */
  qualityGates?: QualityGateReport
  /** Repair loop results */
  repairResult?: RepairLoopResult
  /** Generated report */
  report?: OrchestrationReport
  /** Whether the session completed */
  completed: boolean
  /** Whether the session failed */
  failed: boolean
  /** Error message if failed */
  error?: string
}

export type PipelinePhase =
  | "intake"
  | "decompose"
  | "dependency_plan"
  | "agent_select"
  | "execution_plan"
  | "execute"
  | "quality_gate"
  | "repair"
  | "report"
  | "done"
  | "failed"

// ─── Orchestration Config (runtime resolved) ─────────────────────────────────

export interface ResolvedOrchestrationConfig {
  enabled: boolean
  autoDecompose: boolean
  autoExecuteLowRisk: boolean
  requirePlanForHighRisk: boolean
  maxRepairAttempts: number
  defaultTaskTimeoutMs: number
  allowParallelReadonlyTasks: boolean
  allowParallelWriteTasks: boolean
  qualityGates: {
    typecheck: boolean
    lint: boolean
    test: boolean
    build: boolean
    doctor: boolean
  }
  stateDir: string
}

// ─── Body-level signal extraction from agent markdown ─────────────────────────

export interface AgentBodySignal {
  /** Agent role extracted from body (e.g., "architect", "implementer", "auditor") */
  bodyRole: string | null
  /** Whether body explicitly says it implements/codes */
  bodySaysImplement: boolean
  /** Whether body explicitly says it reviews/inspects only */
  bodySaysReviewOnly: boolean
  /** Whether body explicitly says it does NOT write code */
  bodySaysNoCode: boolean
  /** Domain terms found in body text */
  bodyDomains: string[]
  /** Stack/framework terms found in body */
  bodyStack: string[]
  /** Delegation targets mentioned in body */
  bodyDelegationTargets: string[]
  /** Tools referenced in body's tool sections */
  bodyTools: string[]
  /** Whether body references critical rules / mission protocol */
  hasCriticalRules: boolean
  /** Whether body has a mission section */
  hasMissionSection: boolean
}

// ─── Agent Signal Quality Audit ──────────────────────────────────────────────

export type AgentSignalIssueSeverity = "error" | "warning" | "info"

export interface AgentSignalIssue {
  agentName: string
  severity: AgentSignalIssueSeverity
  category: "contradiction" | "weak-signal" | "domain-conflict" | "ambiguity" | "compatibility"
  message: string
  detail?: string
}

export interface AgentRoleClassification {
  name: string
  /** classified role: implementer | reviewer | architect | auditor | orchestrator | unknown */
  role: string
  /** confidence 0..1 */
  confidence: number
  /** why this classification was chosen */
  rationale: string
}

export interface AgentSignalAuditReport {
  /** Per-agent signal issues */
  issues: AgentSignalIssue[]
  /** Per-agent role classifications */
  classifications: AgentRoleClassification[]
  /** Agents with strong implementer signal (can write code) */
  implementers: string[]
  /** Agents with strong review-only signal */
  reviewers: string[]
  /** Agents with strong architect/design-only signal */
  architects: string[]
  /** Agents with frontmatter/body contradiction */
  contradictions: Array<{ name: string; field: string; frontmatter: string; body: string }>
  /** Agents with weak exact-routing signal */
  weakSignalAgents: string[]
  /** Overlapping domain groups */
  domainOverlaps: Array<{ domain: string; agents: string[] }>
}

// ─── Local Agent Registry Entry ──────────────────────────────────────────────

export interface LocalAgentRegistryEntry {
  name: string
  description: string
  hidden: boolean
  disabled: boolean
  sourcePath: string
  /** Agent model from frontmatter */
  model?: string
  /** Agent mode (primary/subagent/all) */
  mode?: string
  /** Priority hint (high/medium/low) */
  priority?: string
  /** Domains inferred from description/name */
  domainHints?: string[]
  /** Use-when guidance from frontmatter */
  useWhen?: string[]
  /** Avoid-when guidance from frontmatter */
  avoidWhen?: string[]
}
