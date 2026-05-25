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
  /** Signals this task waits for before becoming ready (static DAG) */
  requiredSignals?: string[]
  /** Signal this task emits upon completion (static DAG) */
  emittedSignal?: string | null
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
  /**
   * Handoff metadata extracted from the agent's response text.
   * Present when the agent emitted a STATUS/SIGNALS_EMITTED/HANDOFF block.
   */
  handoffData?: {
    /** Handoff status: DONE, IN_PROGRESS, BLOCKED, or null */
    status: string | null
    /** Handoff target agent ID or routing directive */
    target: string | null
    /** Number of signals emitted */
    signalCount: number
    /** Structured DAG mutations proposed by the completing agent */
    dagMutations?: DagMutationBlock
  }
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

/**
 * Callback signature for executing a single delegation request.
 *
 * Wave 4: The delegation consumption loop calls this for each
 * pending delegation that passes guardrails. It follows the same
 * callback style as TaskBatchExecutor but operates on individual
 * delegation requests rather than execution batches.
 *
 * The callback receives a delegation execution request and should
 * dispatch it through the existing runtime (e.g. task(category=..., prompt=...))
 * returning the execution result (success, failure, blocked).
 */
export type DelegationRequestExecutor = (
  request: DelegationExecutionRequest,
) => Promise<TaskExecutionResult>

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
  | "delegation_consume"
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

/**
 * Wave 3: Role classification model for agent handoff behavior enforcement.
 *
 * Agents are classified into mutually exclusive roles that determine which
 * handoff targets are allowed. The policy is enforced at the routing decision
 * layer and can be audited via doctor checks.
 *
 * Role hierarchy / handoff rules:
 *   orchestrator       → can hand off to anyone (sisyphus, prometheus, atlas)
 *   implementer        → can hand off to caller, parent, or any valid next agent
 *   architect-builder   → should prefer parent routing; can hand off to specific
 *                         specialists but NOT to other architects directly
 *   reviewer-auditor   → MUST NOT hand off directly to implementers;
 *                         should use return_to_parent_for_routing
 *   docs-research      → can hand off to caller or orchestrator only;
 *                         NOT to implementers directly
 *   unknown            → no role classification; no policy enforcement
 */
export type AgentRole =
  | "orchestrator"
  | "implementer"
  | "architect-builder"
  | "reviewer-auditor"
  | "docs-research"
  | "unknown"

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

// ─── FINAL Hecateq Runtime Handoff — .omo/hecateq/ State Model ────────────
//
// Wave 1 foundation: typed runtime state model for the `.omo/hecateq/`
// directory. Handoff state, signal registry state, and routing state
// structures. These are additive — the existing MVP handoff flow
// (Boulder + continuation markers) continues to work alongside.
//
// Wave 2+ will add auto-routing, background ingestion, and policy.

/**
 * Schema version for `.omo/hecateq/state.json`.
 * Increment when making breaking changes to the persisted structure.
 */
export const HECATEQ_OMO_SCHEMA_VERSION = 1 as const

/**
 * Root persisted state for `.omo/hecateq/state.json`.
 * All sections are optional — the file can grow as features land.
 */
export interface HecateqOmoState {
  /** Schema version for forward/backward compatibility */
  schema_version: number
  /** ISO-8601 timestamp of last write */
  last_updated: string
  /** Current handoff state (Wave 1) */
  handoff?: HecateqHandoffState
  /** Signal registry state (Wave 1) */
  signal_registry?: HecateqSignalRegistryState
  /** Routing state — reserved for Wave 2+ auto-routing */
  routing?: HecateqRoutingState
  /** Delegation state — Wave 3 controlled delegation */
  delegation?: HecateqDelegationState
  /** Spawn state — Wave 5 autonomous spawn tracking */
  spawn?: HecateqSpawnState
  /** Dynamic DAG nodes — runtime-evolved task graph entries */
  dynamic_dag?: { nodes: DynamicDagNode[]; edges: DynamicDagEdge[]; applied_mutations?: AppliedDagMutation[] }
  /** Migration tracking — records which migrations have run */
  migrations?: HecateqMigrationState
}

/** Handoff state section of the `.omo/hecateq/` state */
export interface HecateqHandoffState {
  /** Current active handoff, or null if none */
  active: HecateqStoredHandoff | null
  /** Recent handoff history (most recent first) */
  history: HecateqStoredHandoff[]
}

/** A single persisted handoff record */
export interface HecateqStoredHandoff {
  /** Parsed handoff status */
  status: "DONE" | "IN_PROGRESS" | "BLOCKED" | null
  /** Handoff target agent or routing directive */
  target: string | null
  /** Number of signals in this handoff */
  signalCount: number
  /** Signal names for quick inspection */
  signalNames: string[]
  /** ISO-8601 timestamp when this handoff was persisted */
  timestamp: string
  /** Origin source of the handoff data */
  source: "boulder" | "continuation-marker" | "direct"
}

/** Signal registry section — tracks emitted and consumed DAG signals */
export interface HecateqSignalRegistryState {
  /** Signals emitted but not yet consumed */
  pending: HecateqStoredSignal[]
  /** Signals that have been consumed */
  consumed: HecateqStoredSignal[]
}

/** A single signal record in the registry */
export interface HecateqStoredSignal {
  /** Signal name (e.g. "schema_ready", "tests_passed") */
  signal: string
  /** Arbitrary payload attached to the signal */
  payload: Record<string, unknown>
  /** ISO-8601 timestamp when emitted */
  emittedAt: string
  /** ISO-8601 timestamp when consumed (undefined if pending) */
  consumedAt?: string
  /** Agent that emitted this signal (if known) */
  emitterAgent?: string
}

/** Routing state — Wave 2 controlled routing engine */
export interface HecateqRoutingState {
  /** Currently active routing target, or null */
  active_target: string | null
  /** Queue of pending routing targets */
  queue: string[]
  /** History of routing decisions (most recent first) */
  decisions: HecateqRoutingRecord[]
}

// ─── Routing Policy Engine — Wave 2 ────────────────────────────────────────

/** Classification of a routing decision from the policy engine */
export type RoutingDecisionKind =
  | "return_to_caller"
  | "return_to_parent_for_routing"
  | "invalid_target_blocked"
  | "no_handoff_data"
  | "unknown_target_fallback"
  | "role_policy_violation"

/** A single routing decision produced by the policy engine */
export interface RoutingDecision {
  /** Which decision was made */
  kind: RoutingDecisionKind
  /** Human-readable explanation of how the decision was reached */
  reason: string
  /** The original handoff target that triggered this decision */
  originalTarget: string | null
  /** ISO-8601 timestamp of decision */
  decidedAt: string
  /** Source task ID that produced the handoff (if any) */
  sourceTaskId?: string
  /** Source agent that emitted the handoff (if known) */
  sourceAgent?: string
  /**
   * Role violation details — present when kind is "role_policy_violation".
   * Describes which role rule was broken.
   */
  roleViolation?: {
    /** Role of the source agent that issued the handoff */
    sourceRole: string
    /** Role of the target agent */
    targetRole: string
    /** The specific rule that was violated */
    rule: string
  }
}

/** Persisted routing decision record */
export interface HecateqRoutingRecord {
  decision: RoutingDecisionKind
  reason: string
  originalTarget: string | null
  decidedAt: string
  sourceTaskId?: string
  sourceAgent?: string
}

/** Maximum routing decision history entries to retain */
export const HECATEQ_ROUTING_HISTORY_MAX = 50

// ─── Delegation State — Wave 3 controlled handoff-target delegation ────────

/** Maximum routing depth to prevent infinite delegation chains */
export const HECATEQ_MAX_ROUTING_DEPTH = 3

/** Maximum pending delegation entries before pruning oldest */
export const HECATEQ_DELEGATION_PENDING_MAX = 20

/** Maximum delegation history entries before pruning oldest */
export const HECATEQ_DELEGATION_HISTORY_MAX = 100

/** Delegation request status */
export type DelegationRequestStatus = "pending" | "consumed" | "skipped"

/** Delegation execution result */
export type DelegationExecutionResult = "executed" | "skipped" | "blocked" | "guardrail_blocked"

/**
 * A pending delegation request created by the delegation controller.
 * Represents a "next delegation request" that the orchestrator (Hecateq God)
 * can immediately consume via the existing task/delegate infrastructure.
 */
export interface HecateqPendingDelegation {
  /** Unique delegation request ID */
  id: string
  /** Target agent to delegate to (must be a known agent ID) */
  targetAgent: string
  /** Task prompt from the source task node */
  prompt: string
  /** Source task ID that triggered this delegation */
  sourceTaskId?: string
  /** Source agent that emitted the handoff */
  sourceAgent?: string
  /** ISO-8601 timestamp when this delegation was created */
  createdAt: string
  /** Current status of this delegation request */
  status: DelegationRequestStatus
  /** Routing depth at the time this delegation was created */
  routingDepth: number
  /** Which guardrails were checked (for debugging) */
  guardrailChecks?: string[]
}

/**
 * A persisted record of a delegation execution or block decision.
 * Written after the orchestrator consumes a pending delegation.
 */
export interface HecateqDelegationRecord {
  /** Matching delegation request ID */
  id: string
  /** Target agent */
  targetAgent: string
  /** Source task ID */
  sourceTaskId?: string
  /** Source agent */
  sourceAgent?: string
  /** ISO-8601 when the routing decision was made */
  decidedAt: string
  /** ISO-8601 when the delegation was executed (if consumed) */
  executedAt?: string
  /** Execution result classification */
  result: DelegationExecutionResult
  /** Reason for block/skip/guardrail_blocked */
  blockReason?: string
}

/**
 * Delegation state section of the `.omo/hecateq/` state.
 * Added in Wave 3 — controlled handoff-target delegation.
 */
export interface HecateqDelegationState {
  /** Pending delegation requests awaiting orchestrator consumption */
  pending: HecateqPendingDelegation[]
  /** History of delegation executions */
  history: HecateqDelegationRecord[]
  /** Current routing depth counter */
  routingDepth: number
}

/**
 * Execution request returned by consumePendingDelegations().
 * Carries all info the orchestrator needs to delegate through
 * the existing task() infrastructure.
 */
export interface DelegationExecutionRequest {
  /** Unique delegation request ID (matches HecateqPendingDelegation.id) */
  delegationId: string
  /** Target agent to delegate to */
  targetAgent: string
  /** Task prompt extracted from the source task */
  prompt: string
  /** Source task ID that triggered this delegation */
  sourceTaskId?: string
  /** Source agent that emitted the handoff */
  sourceAgent?: string
  /**
   * Resolved category for the task() delegation call.
   * Derived from the target agent name using AGENT_TO_CATEGORY mapping.
   */
  category: string
  /** Routing depth at the time this delegation was created */
  routingDepth: number
}

/** Result of batch-consume operation */
export interface ConsumePendingDelegationsResult {
  /** Execution requests that passed guardrails and were consumed */
  requests: DelegationExecutionRequest[]
  /** Count of delegations blocked by guardrails */
  guardrailBlocked: number
  /** Human-readable details of each guardrail block */
  guardrailDetails: string[]
}

// ─── Auto-Spawn State — Wave 5 autonomous spawn tracking ─────────────────

export type SpawnSessionStatus =
  | "running"
  | "completed"
  | "failed"
  | "timeout"
  | "aborted"

export interface HecateqSpawnSession {
  sessionId: string
  delegationId: string
  targetAgent: string
  spawnedAt: string
  status: SpawnSessionStatus
  routingDepth: number
  sourceTaskId?: string
  completedAt?: string
  errorSummary?: string
}

export interface HecateqSpawnState {
  activeSessions: HecateqSpawnSession[]
  history: HecateqSpawnSession[]
  config: {
    maxConcurrent: number
    pausedUntil: string | null
  }
}

/** Max spawn history entries before pruning oldest */
export const HECATEQ_SPAWN_HISTORY_MAX = 100

// ─── Dynamic DAG Nodes — runtime-evolved task graph ─────────────────────

export interface DynamicDagNode {
  id: string
  label: string
  prompt: string
  domain: string
  requiredSignals: string[]
  emittedSignal: string | null
  sourceAgent: string
  sourceTaskId: string
  createdAt: string
  status: "pending" | "triggered" | "completed"
}

export const HECATEQ_DYNAMIC_DAG_NODES_MAX = 50

// ─── DAG Planner Mutations — self-modifying task graph proposals ──────

export interface DagNodeProposal {
  id: string
  label: string
  prompt: string
  domain?: string
  requiredSignals?: string[]
  emittedSignal?: string | null
  assignedAgent?: string
  dependsOn?: string[]
}

export interface DagEdgeProposal {
  from: string
  to: string
  signal?: string
}

export interface DagNodeRewrite {
  id: string
  label?: string
  prompt?: string
  requiredSignals?: string[]
  dependsOn?: string[]
  emittedSignal?: string | null
  assignedAgent?: string
}

export interface DagMutationBlock {
  addNodes?: DagNodeProposal[]
  addEdges?: DagEdgeProposal[]
  removeNodes?: string[]
  removeEdges?: Array<{ from: string; to: string }>
  rewriteNodes?: DagNodeRewrite[]
  plannerNote?: string
}

export interface AppliedDagMutation {
  mutationId: string
  sourceTaskId: string
  sourceAgent: string
  appliedAt: string
  nodesAdded: number
  edgesAdded: number
  nodesRejected: number
  rejectReasons: string[]
  plannerNote?: string
}

export const HECATEQ_MAX_NODES_PER_MUTATION = 10
export const HECATEQ_MAX_EDGES_PER_MUTATION = 20
export const HECATEQ_APPLIED_MUTATIONS_MAX = 50
export const HECATEQ_DYNAMIC_EDGES_MAX = 100

export interface DynamicDagEdge {
  from: string
  to: string
  signal?: string
  sourceTaskId: string
  sourceAgent: string
  createdAt: string
}

/** Tracks which migrations have been applied */
export interface HecateqMigrationState {
  /** IDs of completed migrations */
  completed: string[]
  /** ISO-8601 timestamp of last migration run */
  last_run: string | null
}

/** Result of a migration operation */
export interface HecateqMigrationResult {
  /** Whether the migration produced changes */
  changed: boolean
  /** Number of handoffs migrated */
  handoffsMigrated: number
  /** Number of signals migrated */
  signalsMigrated: number
  /** Error messages (non-empty means partial failure) */
  errors: string[]
}

/** Result returned by OmoStateManager.write() */
export interface HecateqWriteResult {
  /** Whether the write succeeded */
  success: boolean
  /** Error message if write failed */
  error?: string
}
