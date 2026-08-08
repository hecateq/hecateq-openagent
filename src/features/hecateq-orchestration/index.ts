export { analyzePrompt } from "./prompt-intake"
export { decomposePrompt, resetCounter } from "./task-decomposer"
export { buildDependencyPlan } from "./dependency-planner"
export { selectAgents, readLocalAgentRegistry } from "./agent-selector"
export { buildExecutionPlan } from "./execution-planner"
export { runQualityGates } from "./quality-gate-runner"
export { createRepairAction, runRepairLoop } from "./repair-loop-controller"
export { generateReport, renderReportAsMarkdown } from "./final-report-generator"
export {
  runOrchestrationPipeline,
  resolveOrchestrationConfig,
  saveSessionState,
  loadSessionState,
  listSessionStates,
  recoverOrCreateState,
  isSensitivePath,
  isSensitiveTask,
  syncTaskGraphFile,
  blockSensitiveTasks,
  buildOrchestrationContextBlock,
  consumeHandoffAndRecordRouting,
} from "./orchestration-controller"

export {
  extractHandoffFromAgentResponse,
  persistHandoffToBoulderSession,
  persistHandoffToContinuationMarker,
  recordHandoffToOmoState,
  processHandoffInAgentResponse,
  buildOmoHandoffContextSummary,
  buildLiveHandoffContextSummary,
  HECATEQ_HANDOFF_TASK_KEY,
} from "./runtime-handoff-service"

export {
  OmoStateManager,
  createDefaultState,
  HECATEQ_OMO_DIR,
  HECATEQ_OMO_STATE_FILE,
  HECATEQ_OMO_STATE_PATH,
  HECATEQ_HANDOFF_HISTORY_MAX,
  HECATEQ_SIGNAL_PENDING_MAX,
  HECATEQ_SIGNAL_CONSUMED_MAX,
} from "./omo-state-manager"

export {
  KNOWN_SIGNALS,
  getSignalDefinition,
  getSignalsEmittedBy,
  getSignalsConsumedBy,
  getAllSignalNames,
  isKnownSignal,
} from "./signal-registry"

export {
  migrateFromBoulderState,
  migrateFromContinuationMarkers,
  runAllMigrations,
  MIGRATION_ID_BOULDER,
  MIGRATION_ID_CONTINUATION,
} from "./omo-migration"

export {
  decideRouting,
  decideRoutingFromTaskHandoff,
  isUserVisibleDecision,
  isTerminalDecision,
} from "./routing-policy-engine"
export type { DecideRoutingFromTaskHandoffArgs } from "./routing-policy-engine"

export {
  TaskStatusSchema,
  TaskNodeSchema,
  TaskGraphSchema,
  validateTaskGraph,
} from "./task-graph-schema"
export type {
  HecateqTaskNode,
  HecateqTaskGraph,
  TaskGraphValidationResult,
} from "./task-graph-schema"

export { validateHandoffWithRepair } from "./handoff-runtime-validator"
export type { HandoffValidatedResult } from "./handoff-runtime-validator"

export {
  appendHandoffHistoryEntry,
  loadRecentHandoffHistory,
  clearHandoffHistory,
  HECATEQ_HANDOFF_HISTORY_REL,
} from "./handoff-history"
export type { HecateqHandoffHistoryEntry } from "./handoff-history"

export { buildHandoffHistoryContext } from "./handoff-history-context"
export { buildHandoffHistoryContextBlock } from "./handoff-history-injection"

export { resolveReviewerAgent } from "./reviewer-routing"
export type {
  ReviewerRoutingResult,
  ReviewerAgentIndex,
} from "./reviewer-routing"

export {
  processHandoffsToDelegation,
  getPendingDelegations,
  getPendingDelegationById,
  consumeDelegation,
} from "./delegation-controller"
export type { DelegationControllerResult } from "./delegation-controller"

export {
  consumePendingDelegations,
  reportDelegationResult,
  executePendingDelegations,
} from "./delegation-executor"
export type {
  GuardrailCheckResult,
  ExecutePendingDelegationsResult,
} from "./delegation-executor"

export {
  AGENT_ROLES,
  getAgentRole,
  getAgentRoleEntry,
  hasKnownRole,
  getAgentsByRole,
  getAllAgentRoles,
  validateHandoffTargetByRole,
  describeRolePolicy,
  findUnclassifiedAgents,
  findOrphanedRoleEntries,
} from "./handoff-role-policy"

export type {
  PromptIntakeResult,
  TaskNode,
  TaskNodeStatus,
  TaskDomain,
  TaskAction,
  DependencyPlan,
  CycleDetectionResult,
  AgentSelectorResult,
  AgentSelectionEntry,
  ExecutionPlan,
  ExecutionBatch,
  ExecutionBatchKind,
  QualityGateResult,
  QualityGateReport,
  QualityGateKind,
  FailureClassification,
  RepairAction,
  RepairLoopResult,
  OrchestrationReport,
  OrchestrationReportSection,
  OrchestrationSessionState,
  PipelinePhase,
  ResolvedOrchestrationConfig,
  ChangedFile,
  LocalAgentRegistryEntry,
  TaskSize,
  DomainScope,
  RiskLevel,
  IntentKind,
  TaskBatchExecutor,
  TaskExecutionResult,
  HecateqOmoState,
  HecateqHandoffState,
  HecateqStoredHandoff,
  HecateqSignalRegistryState,
  HecateqStoredSignal,
  HecateqRoutingState,
  HecateqMigrationState,
  HecateqMigrationResult,
  HecateqWriteResult,
  RoutingDecisionKind,
  RoutingDecision,
  HecateqRoutingRecord,
  DelegationRequestStatus,
  DelegationExecutionResult,
  DelegationExecutionRequest,
  ConsumePendingDelegationsResult,
  DelegationRequestExecutor,
  HecateqDelegationState,
  HecateqPendingDelegation,
  HecateqDelegationRecord,
  HecateqGuardrailBlockKind,
  HecateqGuardrailBlockDetail,
} from "./types"

export {
  HECATEQ_ROUTING_HISTORY_MAX,
  HECATEQ_MAX_ROUTING_DEPTH,
  HECATEQ_SPAWN_HISTORY_MAX,
  HECATEQ_DYNAMIC_DAG_NODES_MAX,
  HECATEQ_MAX_NODES_PER_MUTATION,
  HECATEQ_APPLIED_MUTATIONS_MAX,
} from "./types"
export type {
  HecateqSpawnSession,
  HecateqSpawnState,
  SpawnSessionStatus,
  DynamicDagNode,
  DagMutationBlock,
  DagNodeProposal,
  DagEdgeProposal,
  DagNodeRewrite,
  AppliedDagMutation,
} from "./types"

export {
  DelegationCycleDetector,
  SignalDagTriggerTracker,
} from "./cycle-detector"

export {
  consumeDelegationsAtRuntime,
} from "./runtime-delegation-consumer"
export type {
  ConsumeDelegationsArgs,
  ConsumeDelegationsResult,
} from "./runtime-delegation-consumer"

export {
  createDefaultHandoffBlock,
  parseHandoffBlock,
  getKnownAgentIds,
} from "./handoff-parser"
export type {
  HandoffBlock,
  HandoffStatus,
  HandoffSignal,
  HandoffTarget,
  ChangedFileEntry,
  HandoffValidationIssue,
} from "./handoff-parser"

export {
  resolveReadyTasks,
  consumeSignalsFromResults,
  signalDagTick,
  deriveDynamicTasks,
  extractDagMutations,
  applyDagMutations,
  syncTaskStatuses,
  applyDeleteMutations,
  applyRewriteMutations,
} from "./signal-dag-executor"
export type {
  ApplyMutationsResult,
  SyncTaskStatusesResult,
  DeleteMutationsResult,
  RewriteMutationsResult,
} from "./signal-dag-executor"
export type {
  SignalDagContext,
  SignalDagTickResult,
} from "./signal-dag-executor"

export {
  DryRunExecutionAdapter,
  ManualExecutionAdapter,
  TestExecutionAdapter,
  CallbackExecutionAdapter,
  DeferredExecutionAdapter,
  CompositeExecutionAdapter,
  createBatchExecutorFromAdapter,
  executeBatchViaAdapter,
} from "./execution-adapter"
export type {
  ExecutionAdapter,
  RuntimeAdapterConfig,
  ContractValidationResult,
} from "./types"

export {
  validateTaskContract,
  createContractNode,
  createPlanNode,
  createVerificationNode,
  CONTRACT_STAGE_PREFIX,
  PLAN_STAGE_PREFIX,
  VERIFY_STAGE_PREFIX,
} from "./execution-planner"

export type {
  OrchestrationMetrics,
  OrchestrationEvent,
  OrchestrationMonitor,
} from "./monitoring"
export {
  createOrchestrationMonitor,
  getOrchestrationMonitor,
  _resetOrchestrationMonitorForTesting,
} from "./monitoring"

export {
  registerExecution,
  attachCorrelation,
  getExecutionRecord,
  findExecutionByTask,
  findLatestExecutionForTask,
  checkDuplicateDelegation,
  transitionProgress,
  attachChannel,
  detachChannel,
  _resetExecutionRegistryForTesting,
} from "./execution-registry"

export {
  probeBackgroundTaskLiveness,
  probeDelegatedSessionLiveness,
  resolveProgressState,
  isLiveResumptionChannel,
} from "./resumption-channel"

export {
  appendRuntimeEvent,
  loadRecentRuntimeEvents,
} from "./handoff-history"

export {
  HECATEQ_EVIDENCE_DIR_REL,
  captureFilesChangedFromResult,
  captureCommandEvidence,
  captureTestEvidence,
  recordEvidence,
  readEvidence,
  listEvidence,
  validateEvidenceFreshness,
  assertEvidenceMatchesCurrent,
  EvidenceValidationFailedError,
  _setEvidenceDirForTesting,
  _resetEvidenceDirForTesting,
} from "./evidence-store"
export type {
  RecordEvidenceInput,
  EvidenceFreshnessInput,
} from "./evidence-store"

export {
  setBackgroundManagerAccessorForHecateq,
  getBackgroundManagerAccessorForHecateq,
  defaultBackgroundTaskLivenessProbe,
  attachParentWakeToExecution,
  detachParentWakeFromExecution,
  attachBackgroundTaskChannelToExecution,
  recordExecutionStarted,
  recordExecutionCompleted,
  guardDuplicateDelegation,
  registerExecutionAndRecord,
  deriveDelegationTaskGraphId,
  _resetBackgroundManagerAccessorForTesting,
} from "./runtime-continuity-wiring"

export type {
  HecateqProgressState,
  HecateqExecutionIdentity,
  HecateqExecutionCorrelation,
  HecateqExecutionRecord,
  ResumptionChannel,
  HecateqRuntimeEvent,
  HecateqRuntimeEventKind,
  DuplicateDelegationDecision,
} from "./runtime-continuity-types"

export type {
  HecateqTaskEvidence,
  HecateqCommandEvidence,
  HecateqTestEvidence,
  HecateqCheckEvidence,
  EvidenceFreshness,
  EvidenceValidationError,
} from "./evidence-types"

export {
  HECATEQ_VERIFICATION_DIR_REL,
  resolveVerifierAgent,
  recordVerificationResult,
  readVerificationResult,
  listVerificationResultsForExecution,
  _setVerificationDirForTesting,
  _resetVerificationDirForTesting,
} from "./verifier-routing"
export type {
  HecateqVerificationResult,
  HecateqVerificationStatus,
  HecateqVerifierDecision,
  HecateqRequiredCheck,
  ResolveVerifierAgentInput,
} from "./verifier-routing"

export {
  HECATEQ_FORBIDDEN_AGENTS,
  HECATEQ_FORBIDDEN_AGENT_SET,
  HECATEQ_MOMUS_GUARD_DESCRIPTION,
  isMomus,
  filterMomus,
  assertNoMomus,
} from "./momus-exclusion"

export { runBoundedVerificationRepair } from "./bounded-verification-repair"
export type {
  HecateqBoundedRepairConfig,
  HecateqBoundedRepairOutcome,
  HecateqBoundedRepairInput,
  HecateqVerificationExecutor,
  HecateqRepairExecutor,
} from "./bounded-verification-repair"

export {
  HECATEQ_MAX_VERIFIER_ATTEMPTS,
  startVerifierExecution,
  completeVerifierExecution,
  VerifierDriverError,
  _resetVerifierDriverWaitersForTesting,
} from "./verifier-driver"
export type {
  HecateqVerifierDriverConfig,
  HecateqVerifierDriverHandle,
  HecateqVerifierDriverResult,
} from "./verifier-driver"

export {
  HecateqCompletionGate,
  evaluationStatus,
  isTaskVerified,
  assertTaskVerified,
  isExecutionCompletedEqualsTaskVerified,
  TaskNotVerifiedError,
} from "./completion-gate"
export type { HecateqEvaluationStatus } from "./completion-gate"

export { evaluatePlannerGate, recordPlannerGateEvaluation } from "./planner-gate"
export type {
  HecateqRiskLevel,
  HecateqPlannerDecision,
  HecateqPlannerActivationAssessment,
  HecateqPlannerGateInput,
} from "./planner-gate"

export {
  buildCanonicalIdentityChain,
  assertIdentityChainConsistency,
  createHandoffSignalForVerificationResult,
  createHandoffSignalForPlannerEvaluation,
  createHandoffSignalForEvidenceRecorded,
  createCanonicalHandoffBlock,
} from "./identity-reuse"
export type {
  HecateqCanonicalIdentityChain,
  HecateqVerificationHandoffSignal,
  HecateqPlannerGateHandoffSignal,
  HecateqEvidenceRecordedHandoffSignal,
  HecateqEvidenceSignal,
  HecateqCanonicalHandoffBlockInput,
} from "./identity-reuse"
