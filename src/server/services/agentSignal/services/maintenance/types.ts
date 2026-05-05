/**
 * Shared contracts for Agent Signal self-reflection maintenance.
 *
 * Use when:
 * - Source handlers need stable maintenance plan and result shapes
 * - Planner, executor, receipts, briefs, and evals need one vocabulary
 *
 * Expects:
 * - Domain services still validate memory and skill payloads before writing
 *
 * Returns:
 * - Type-safe contracts and deterministic key builders with no side effects
 */

import type { WriteMaintenanceMemoryInput } from './memory';
import type {
  ConsolidateMaintenanceSkillInput,
  CreateMaintenanceSkillInput,
  RefineMaintenanceSkillInput,
} from './skill';

/** Scope where a maintenance review was requested. */
export enum MaintenanceReviewScope {
  Nightly = 'nightly',
  SelfIterationIntent = 'self_iteration_intent',
  SelfReflection = 'self_reflection',
}

/** Coarse lifecycle state for one maintenance review run. */
export enum ReviewRunStatus {
  Collected = 'collected',
  Completed = 'completed',
  Deduped = 'deduped',
  Failed = 'failed',
  PartiallyApplied = 'partially_applied',
  Planned = 'planned',
  Skipped = 'skipped',
}

/** Action types recognized by the first self-reflection maintenance version. */
export type MaintenanceActionType =
  | 'write_memory'
  | 'create_skill'
  | 'refine_skill'
  | 'consolidate_skill'
  | 'noop'
  | 'proposal_only';

/** Final apply mode assigned by the deterministic planner. */
export enum MaintenanceApplyMode {
  AutoApply = 'auto_apply',
  ProposalOnly = 'proposal_only',
  Skip = 'skip',
}

/** Risk assigned by the deterministic planner after evidence review. */
export enum MaintenanceRisk {
  High = 'high',
  Low = 'low',
  Medium = 'medium',
}

/** Durable result state for one planned maintenance action. */
export enum MaintenanceActionStatus {
  Applied = 'applied',
  Deduped = 'deduped',
  Failed = 'failed',
  Proposed = 'proposed',
  Skipped = 'skipped',
}

/** Reference to the source material that justifies a maintenance decision. */
export interface EvidenceRef {
  /** Stable referenced object id, such as a topic id, message id, source id, or receipt id. */
  id: string;
  /** Optional short quote or summary that lets receipts explain why this evidence mattered. */
  summary?: string;
  /** Object namespace for the referenced evidence. */
  type:
    | 'topic'
    | 'message'
    | 'operation'
    | 'source'
    | 'receipt'
    | 'tool_call'
    | 'task'
    | 'agent_document'
    | 'memory';
}

/** Memory write operation prepared by the planner for the memory domain service. */
export interface MaintenanceMemoryWriteOperation {
  /** Domain service that owns final validation and persistence. */
  domain: 'memory';
  /** Domain-specific input. The memory service validates this before writing. */
  input: WriteMaintenanceMemoryInput;
  /** Operation name inside the selected domain. */
  operation: 'write';
}

/** Skill creation operation prepared by the planner for the skill domain service. */
export interface MaintenanceSkillCreateOperation {
  /** Domain service that owns final validation and persistence. */
  domain: 'skill';
  /** Domain-specific input. The skill service validates this before writing. */
  input: CreateMaintenanceSkillInput;
  /** Operation name inside the selected domain. */
  operation: 'create';
}

/** Skill refinement operation prepared by the planner for the skill domain service. */
export interface MaintenanceSkillRefineOperation {
  /** Domain service that owns final validation and persistence. */
  domain: 'skill';
  /** Domain-specific input. The skill service validates this before writing. */
  input: RefineMaintenanceSkillInput;
  /** Operation name inside the selected domain. */
  operation: 'refine';
}

/** Skill consolidation operation prepared by the planner for the skill domain service. */
export interface MaintenanceSkillConsolidateOperation {
  /** Domain service that owns final validation and persistence. */
  domain: 'skill';
  /** Domain-specific input. The skill service validates this before writing. */
  input: ConsolidateMaintenanceSkillInput;
  /** Operation name inside the selected domain. */
  operation: 'consolidate';
}

/** Normalized domain operation prepared by the planner and validated by domain services. */
export type MaintenanceDomainOperation =
  | MaintenanceMemoryWriteOperation
  | MaintenanceSkillConsolidateOperation
  | MaintenanceSkillCreateOperation
  | MaintenanceSkillRefineOperation;

/** Target resource hints for one maintenance action. */
export interface MaintenanceActionTarget {
  /** Existing memory id when refining or deduping memory. */
  memoryId?: string;
  /** Managed skill agent document id when targeting a writable skill. */
  skillDocumentId?: string;
  /** Stable managed skill name when no id is available yet. */
  skillName?: string;
  /** Task ids that produced evidence for this action. */
  taskIds?: string[];
  /** Topic ids that produced evidence for this action. */
  topicIds?: string[];
}

/** Finding emitted by the reviewer before deterministic policy is applied. */
export interface MaintenanceReviewFinding {
  /** Evidence refs that justify the finding. */
  evidenceRefs: EvidenceRef[];
  /** Reviewer severity before deterministic risk classification. */
  severity: 'high' | 'low' | 'medium';
  /** Short finding summary for audit and reviewer trace output. */
  summary: string;
}

/** Structured reviewer policy hints consumed by deterministic maintenance gates. */
export interface MaintenanceActionPolicyHints {
  /** Reviewer-estimated evidence quality for this specific action. */
  evidenceStrength?: 'medium' | 'strong' | 'weak';
  /** Expected mutation size for skill actions. */
  mutationScope?: 'broad' | 'small';
  /** Whether this action writes durable behavior or only a temporary observation. */
  persistence?: 'stable' | 'temporal';
  /** Whether the action touches sensitive user data or ordinary workflow preferences. */
  sensitivity?: 'normal' | 'sensitive';
  /** How directly the user or running agent requested this maintenance action. */
  userExplicitness?: 'explicit' | 'implicit' | 'inferred';
}

/**
 * Reviewer action proposal before deterministic planning.
 *
 * @param TValue - Draft payload produced by the reviewer for the selected action type.
 */
export interface MaintenanceActionDraft<TValue = unknown> {
  /** Candidate maintenance action type. */
  actionType: MaintenanceActionType;
  /** Reviewer confidence from 0 to 1. */
  confidence: number;
  /** Source material that supports the draft action. */
  evidenceRefs: EvidenceRef[];
  /** Structured policy hints that keep automatic mutation gates deterministic. */
  policyHints?: MaintenanceActionPolicyHints;
  /** Human-readable reviewer rationale. */
  rationale: string;
  /** Optional target resource hints. */
  target?: MaintenanceActionTarget;
  /** Candidate domain payload. */
  value?: TValue;
}

/** Reviewer output envelope consumed by the deterministic planner. */
export interface MaintenancePlanDraft {
  /** Candidate actions from the reviewer. */
  actions: MaintenanceActionDraft[];
  /** Review findings that explain the day or task summary. */
  findings: MaintenanceReviewFinding[];
  /** Short summary of the review. */
  summary: string;
}

/** Request consumed by the deterministic maintenance planner. */
export interface MaintenancePlanRequest {
  /** Reviewer draft to normalize and gate. */
  draft: MaintenancePlanDraft;
  /** Optional user-local date for nightly reviews. */
  localDate?: string;
  /** Scope that produced the review draft. */
  reviewScope: MaintenanceReviewScope;
  /** Stable source id for idempotency key generation. */
  sourceId: string;
  /** Stable user id used to bind reviewer payloads to the owning domain services. */
  userId: string;
}

/** Final deterministic action plan consumed by the executor. */
export interface MaintenanceActionPlan {
  /** First-version action category. */
  actionType: MaintenanceActionType;
  /** Final planner decision for whether the executor may apply the operation. */
  applyMode: MaintenanceApplyMode;
  /** Reviewer/planner confidence from 0 to 1. */
  confidence: number;
  /** Resource-level duplicate key, stable across reviewer retries for the same action. */
  dedupeKey: string;
  /** Evidence that justifies this action. */
  evidenceRefs: EvidenceRef[];
  /** Action replay key, stable for the source event and dedupe key. */
  idempotencyKey: string;
  /** Domain operation envelope. Missing for `noop` or pure proposal records. */
  operation?: MaintenanceDomainOperation;
  /** Human-readable policy reason for receipts, briefs, and eval assertions. */
  rationale: string;
  /** Risk level used by planner gates and brief proposal rules. */
  risk: MaintenanceRisk;
  /** Optional reviewer draft id for audit mapping. */
  sourceActionId?: string;
  /** Optional target resource hints. */
  target?: MaintenanceActionTarget;
}

/** Normalized maintenance plan emitted by the deterministic planner. */
export interface MaintenancePlan {
  /** Ordered action plans. The executor processes this order. */
  actions: MaintenanceActionPlan[];
  /** User-local date for nightly plans. */
  localDate?: string;
  /** Planner implementation version used for audit and eval baselines. */
  plannerVersion: string;
  /** Review loop that produced the plan. */
  reviewScope: MaintenanceReviewScope;
  /** Short user-facing summary for receipts and briefs. */
  summary: string;
}

/** Result for one executed, proposed, skipped, or failed action. */
export interface MaintenanceActionResult {
  /** Action plan idempotency key. */
  idempotencyKey: string;
  /** Optional durable receipt id produced for this action. */
  receiptId?: string;
  /** Optional durable resource id affected by this action. */
  resourceId?: string;
  /** Stable action result status. */
  status: MaintenanceActionStatus;
  /** Optional status details for observability and brief metadata. */
  summary?: string;
}

/** Aggregated result for one maintenance review run. */
export interface MaintenanceReviewRunResult {
  /** Action-level results in executor order. */
  actions: MaintenanceActionResult[];
  /** Optional brief id created for user-visible nightly outcomes. */
  briefId?: string;
  /** Optional source id that triggered this run. */
  sourceId?: string;
  /** Coarse run status for observability and retry semantics. */
  status: ReviewRunStatus;
  /** Optional durable review summary receipt id. */
  summaryReceiptId?: string;
}

/** Input required to build one nightly review source id. */
export interface NightlyReviewSourceIdInput {
  /** Stable agent id. */
  agentId: string;
  /** User-local date in YYYY-MM-DD form. */
  localDate: string;
  /** Stable user id. */
  userId: string;
}

/** Input required to build one self-reflection source id. */
export interface SelfReflectionSourceIdInput {
  /** Stable agent id. */
  agentId: string;
  /** Threshold or policy reason that triggered reflection. */
  reason: string;
  /** Topic, task, or operation id. */
  scopeId: string;
  /** Runtime scope type. */
  scopeType: 'topic' | 'task' | 'operation';
  /** Stable user id. */
  userId: string;
  /** ISO timestamp for the end of the reflection window. */
  windowEnd: string;
  /** ISO timestamp for the beginning of the reflection window. */
  windowStart: string;
}

/** Input required to build one agent-declared intent source id. */
export interface SelfIterationIntentSourceIdInput {
  /** Stable agent id. */
  agentId: string;
  /** Scope id that owns this declaration. */
  scopeId: string;
  /** Scope type that owns this declaration. */
  scopeType: 'operation' | 'topic';
  /** Stable tool-call id when available. */
  toolCallId: string;
  /** Stable user id. */
  userId: string;
}

/** Input required to build one action idempotency key. */
export interface MaintenanceActionIdempotencyInput {
  /** First-version action category. */
  actionType: MaintenanceActionType;
  /** Resource-level duplicate key. */
  dedupeKey: string;
  /** Root source id that produced the action. */
  sourceId: string;
}

/**
 * Builds the stable source id for one user-agent local nightly review.
 *
 * Before:
 * - `{ userId: "u", agentId: "a", localDate: "2026-05-04" }`
 *
 * After:
 * - `"nightly-review:u:a:2026-05-04"`
 */
export const buildNightlyReviewSourceId = (input: NightlyReviewSourceIdInput) =>
  `nightly-review:${input.userId}:${input.agentId}:${input.localDate}`;

/**
 * Builds the stable source id for one self-reflection trigger window.
 *
 * Before:
 * - `{ userId: "u", agentId: "a", scopeType: "task", scopeId: "t", reason: "failed", windowStart: "start", windowEnd: "end" }`
 *
 * After:
 * - `"self-reflection:u:a:task:t:failed:start:end"`
 */
export const buildSelfReflectionSourceId = (input: SelfReflectionSourceIdInput) =>
  [
    'self-reflection',
    input.userId,
    input.agentId,
    input.scopeType,
    input.scopeId,
    input.reason,
    input.windowStart,
    input.windowEnd,
  ].join(':');

/**
 * Builds the stable source id for one runtime-declared maintenance intent.
 *
 * Before:
 * - `{ userId: "u", agentId: "a", scopeType: "topic", scopeId: "topic", toolCallId: "call" }`
 *
 * After:
 * - `"self-iteration-intent:u:a:topic:topic:call"`
 */
export const buildSelfIterationIntentSourceId = (input: SelfIterationIntentSourceIdInput) =>
  `self-iteration-intent:${input.userId}:${input.agentId}:${input.scopeType}:${input.scopeId}:${input.toolCallId}`;

/**
 * Builds a replay guard key for one planned maintenance action.
 *
 * Before:
 * - `{ sourceId: "source", actionType: "write_memory", dedupeKey: "memory:abc" }`
 *
 * After:
 * - `"source:write_memory:memory:abc"`
 */
export const buildMaintenanceActionIdempotencyKey = (input: MaintenanceActionIdempotencyInput) =>
  `${input.sourceId}:${input.actionType}:${input.dedupeKey}`;

/**
 * Returns whether an action apply mode may produce a durable mutation.
 *
 * Use when:
 * - Executors decide whether a normalized action can call a domain service
 * - Tests assert proposal and skip modes remain non-mutating
 *
 * Expects:
 * - Apply mode was already assigned by the deterministic planner
 *
 * Returns:
 * - `true` only for auto-apply actions
 */
export const isActionExecutable = (applyMode: MaintenanceApplyMode) =>
  applyMode === MaintenanceApplyMode.AutoApply;
