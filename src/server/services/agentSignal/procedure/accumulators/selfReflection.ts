import type { AgentSignalPolicyStateStore } from '../../store/types';

type SelfReflectionScopeType = 'operation' | 'task' | 'topic';

const SELF_REFLECTION_ACCUMULATOR_POLICY_ID = 'self-reflection-accumulator';

/**
 * Weak-signal event families that can update self-reflection counters.
 */
export type SelfReflectionAccumulatorEventType =
  | 'correction'
  | 'execution_failed'
  | 'negative_feedback'
  | 'receipt'
  | 'runtime_step'
  | 'tool_called'
  | 'tool_completed'
  | 'tool_failed';

/**
 * Stable threshold reason emitted when a scoped weak-signal counter crosses.
 */
export type SelfReflectionRequestReason =
  | 'execution_failed'
  | 'failed_tool_count'
  | 'receipt_count'
  | 'runtime_step_count'
  | 'same_tool_failure_count'
  | 'tool_call_count'
  | 'user_correction_count';

/**
 * Scope resolved from a runtime, tool, or receipt signal.
 */
export interface SelfReflectionAccumulatorScope {
  /** Stable scope id selected from task, operation, or topic ids. */
  scopeId: string;
  /** Scope family used by downstream source builders. */
  scopeType: SelfReflectionScopeType;
}

/**
 * Threshold values used by the in-memory self-reflection accumulator.
 */
export interface SelfReflectionAccumulatorThresholds {
  /** User correction count that suggests the agent is being steered repeatedly. */
  correctionCount: number;
  /** Failed tool count that suggests the agent may be stuck. */
  failedToolCount: number;
  /** Receipt count that suggests maintenance actions are piling up in one scope. */
  receiptCount: number;
  /** Runtime step count that suggests the execution is becoming long. */
  runtimeStepCount: number;
  /** Per-tool failure count that suggests repeated failure with one tool. */
  sameToolFailureCount: number;
  /** Total tool activity count that suggests the loop is long enough to review. */
  toolCallCount: number;
}

/**
 * Weak-signal counters retained for one scoped self-reflection window.
 */
export interface SelfReflectionAccumulatorCounters {
  /** Number of user correction signals observed in the scope. */
  correctionCount: number;
  /** Number of failed tool calls observed in the scope. */
  failedToolCount: number;
  /** Number of negative feedback signals observed in the scope. */
  negativeFeedbackCount: number;
  /** Number of receipt signals observed in the scope. */
  receiptCount: number;
  /** Number of runtime step signals observed in the scope. */
  runtimeStepCount: number;
  /** Maximum failed-call count for any one tool name in the scope. */
  sameToolFailureCount: number;
  /** Number of tool activity signals observed in the scope. */
  toolCallCount: number;
}

/**
 * Signal input recorded into the in-memory self-reflection accumulator.
 */
export interface SelfReflectionAccumulatorRecordInput {
  /** Agent associated with this weak signal. */
  agentId: string;
  /** Weak-signal event family. */
  eventType: SelfReflectionAccumulatorEventType;
  /** Runtime operation id, used when task id is absent. */
  operationId?: string;
  /** Source, receipt, runtime step, or tool event id used for traceability. */
  sourceId: string;
  /** Task id, preferred over operation and topic ids for scoping. */
  taskId?: string;
  /** Tool name for per-tool failure accumulation. */
  toolName?: string;
  /** Topic id, used as the broadest fallback scope. */
  topicId?: string;
  /** User associated with this weak signal. */
  userId: string;
}

/**
 * Decision returned after recording one weak signal.
 */
export interface SelfReflectionAccumulatorDecision {
  /** Current counters for the resolved scope after this record is applied. */
  counters?: SelfReflectionAccumulatorCounters;
  /** Threshold reason that crossed on this record. */
  reason?: SelfReflectionRequestReason;
  /** Scope id selected from task, operation, or topic ids. */
  scopeId?: string;
  /** Scope family selected for the decision. */
  scopeType?: SelfReflectionScopeType;
  /** Whether downstream code should enqueue a self-reflection request. */
  shouldRequest: boolean;
}

interface SelfReflectionAccumulatorState {
  counters: SelfReflectionAccumulatorCounters;
  emittedReasons: Set<SelfReflectionRequestReason>;
  toolFailures: Map<string, number>;
}

/**
 * In-memory accumulator instance for self-reflection weak signals.
 */
export interface SelfReflectionAccumulator {
  /**
   * Records one weak signal and returns whether a self-reflection request should be emitted.
   *
   * Use when:
   * - Runtime or tool events need deterministic threshold decisions
   * - Tests and evals need pure in-memory behavior without stores or queues
   *
   * Expects:
   * - At least one of `taskId`, `operationId`, or `topicId` is present for request decisions
   *
   * Returns:
   * - A decision object with threshold reason and scope only when a threshold crosses
   */
  record: (input: SelfReflectionAccumulatorRecordInput) => SelfReflectionAccumulatorDecision;
}

/**
 * Async-compatible accumulator boundary used by workflow-backed procedure handlers.
 */
export interface AsyncSelfReflectionAccumulator {
  /**
   * Records one weak signal and returns whether a self-reflection request should be emitted.
   */
  record: (
    input: SelfReflectionAccumulatorRecordInput,
  ) => Promise<SelfReflectionAccumulatorDecision> | SelfReflectionAccumulatorDecision;
}

const DEFAULT_THRESHOLDS = {
  correctionCount: 2,
  failedToolCount: 2,
  receiptCount: 3,
  runtimeStepCount: 6,
  sameToolFailureCount: 2,
  toolCallCount: 10,
} satisfies SelfReflectionAccumulatorThresholds;

const createInitialCounters = (): SelfReflectionAccumulatorCounters => ({
  correctionCount: 0,
  failedToolCount: 0,
  negativeFeedbackCount: 0,
  receiptCount: 0,
  runtimeStepCount: 0,
  sameToolFailureCount: 0,
  toolCallCount: 0,
});

const copyCounters = (
  counters: SelfReflectionAccumulatorCounters,
): SelfReflectionAccumulatorCounters => ({
  ...counters,
});

const resolveScope = (
  input: SelfReflectionAccumulatorRecordInput,
): SelfReflectionAccumulatorScope | undefined => {
  if (input.taskId) return { scopeId: input.taskId, scopeType: 'task' };
  if (input.operationId) return { scopeId: input.operationId, scopeType: 'operation' };
  if (input.topicId) return { scopeId: input.topicId, scopeType: 'topic' };
};

const getScopeKey = (
  input: SelfReflectionAccumulatorRecordInput,
  scope: SelfReflectionAccumulatorScope,
) => `${input.userId}:${input.agentId}:${scope.scopeType}:${scope.scopeId}`;

const createState = (): SelfReflectionAccumulatorState => ({
  counters: createInitialCounters(),
  emittedReasons: new Set<SelfReflectionRequestReason>(),
  toolFailures: new Map<string, number>(),
});

const serializeCounters = (counters: SelfReflectionAccumulatorCounters) => JSON.stringify(counters);

const parseCounters = (value: string | undefined): SelfReflectionAccumulatorCounters => {
  if (!value) return createInitialCounters();

  try {
    const parsed = JSON.parse(value) as Partial<SelfReflectionAccumulatorCounters>;

    return {
      correctionCount: Number(parsed.correctionCount ?? 0),
      failedToolCount: Number(parsed.failedToolCount ?? 0),
      negativeFeedbackCount: Number(parsed.negativeFeedbackCount ?? 0),
      receiptCount: Number(parsed.receiptCount ?? 0),
      runtimeStepCount: Number(parsed.runtimeStepCount ?? 0),
      sameToolFailureCount: Number(parsed.sameToolFailureCount ?? 0),
      toolCallCount: Number(parsed.toolCallCount ?? 0),
    };
  } catch {
    return createInitialCounters();
  }
};

const serializeReasons = (reasons: Set<SelfReflectionRequestReason>) =>
  JSON.stringify([...reasons]);

const parseReasons = (value: string | undefined): Set<SelfReflectionRequestReason> => {
  if (!value) return new Set<SelfReflectionRequestReason>();

  try {
    const parsed = JSON.parse(value);

    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((item): item is SelfReflectionRequestReason => typeof item === 'string')
        : [],
    );
  } catch {
    return new Set<SelfReflectionRequestReason>();
  }
};

const serializeToolFailures = (toolFailures: Map<string, number>) =>
  JSON.stringify(Object.fromEntries(toolFailures));

const parseToolFailures = (value: string | undefined): Map<string, number> => {
  if (!value) return new Map<string, number>();

  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return new Map<string, number>();
    }

    return new Map(
      Object.entries(parsed)
        .map(([key, count]) => [key, Number(count)] as const)
        .filter(([, count]) => Number.isFinite(count)),
    );
  } catch {
    return new Map<string, number>();
  }
};

const createStateFromStoredFields = (
  fields: Awaited<ReturnType<AgentSignalPolicyStateStore['readPolicyState']>>,
): SelfReflectionAccumulatorState => ({
  counters: parseCounters(fields?.counters),
  emittedReasons: parseReasons(fields?.emittedReasons),
  toolFailures: parseToolFailures(fields?.toolFailures),
});

const createDecisionAfterRecord = (
  input: SelfReflectionAccumulatorRecordInput,
  scope: SelfReflectionAccumulatorScope,
  state: SelfReflectionAccumulatorState,
): SelfReflectionAccumulatorDecision => {
  const previousCounters = copyCounters(state.counters);

  incrementCounters(state, input);

  const newlyCrossedReasons = getNewlyCrossedReasons(
    previousCounters,
    state.counters,
    input.eventType,
  );
  const reason = newlyCrossedReasons.find(
    (crossedReason) => !state.emittedReasons.has(crossedReason),
  );

  for (const crossedReason of newlyCrossedReasons) {
    state.emittedReasons.add(crossedReason);
  }

  if (!reason) {
    return { counters: copyCounters(state.counters), shouldRequest: false };
  }

  return {
    counters: copyCounters(state.counters),
    reason,
    scopeId: scope.scopeId,
    scopeType: scope.scopeType,
    shouldRequest: true,
  };
};

const incrementCounters = (
  state: SelfReflectionAccumulatorState,
  input: SelfReflectionAccumulatorRecordInput,
) => {
  const { counters } = state;

  switch (input.eventType) {
    case 'correction': {
      counters.correctionCount += 1;
      break;
    }

    case 'execution_failed': {
      break;
    }

    case 'negative_feedback': {
      counters.negativeFeedbackCount += 1;
      break;
    }

    case 'receipt': {
      counters.receiptCount += 1;
      break;
    }

    case 'runtime_step': {
      counters.runtimeStepCount += 1;
      break;
    }

    case 'tool_called':
    case 'tool_completed': {
      counters.toolCallCount += 1;
      break;
    }

    case 'tool_failed': {
      counters.failedToolCount += 1;
      counters.toolCallCount += 1;

      if (input.toolName) {
        const toolFailureCount = (state.toolFailures.get(input.toolName) ?? 0) + 1;

        state.toolFailures.set(input.toolName, toolFailureCount);
        counters.sameToolFailureCount = Math.max(counters.sameToolFailureCount, toolFailureCount);
      }

      break;
    }
  }
};

const didCrossThreshold = (previous: number, next: number, threshold: number) =>
  previous < threshold && next >= threshold;

const getNewlyCrossedReasons = (
  previous: SelfReflectionAccumulatorCounters,
  next: SelfReflectionAccumulatorCounters,
  eventType: SelfReflectionAccumulatorEventType,
): SelfReflectionRequestReason[] => {
  const reasons: SelfReflectionRequestReason[] = [];

  if (eventType === 'execution_failed') reasons.push('execution_failed');
  if (
    didCrossThreshold(
      previous.sameToolFailureCount,
      next.sameToolFailureCount,
      DEFAULT_THRESHOLDS.sameToolFailureCount,
    )
  ) {
    reasons.push('same_tool_failure_count');
  }
  if (
    didCrossThreshold(
      previous.failedToolCount,
      next.failedToolCount,
      DEFAULT_THRESHOLDS.failedToolCount,
    )
  ) {
    reasons.push('failed_tool_count');
  }
  if (
    didCrossThreshold(previous.toolCallCount, next.toolCallCount, DEFAULT_THRESHOLDS.toolCallCount)
  ) {
    reasons.push('tool_call_count');
  }
  if (
    didCrossThreshold(
      previous.correctionCount,
      next.correctionCount,
      DEFAULT_THRESHOLDS.correctionCount,
    )
  ) {
    reasons.push('user_correction_count');
  }
  if (
    didCrossThreshold(
      previous.runtimeStepCount,
      next.runtimeStepCount,
      DEFAULT_THRESHOLDS.runtimeStepCount,
    )
  ) {
    reasons.push('runtime_step_count');
  }
  if (
    didCrossThreshold(previous.receiptCount, next.receiptCount, DEFAULT_THRESHOLDS.receiptCount)
  ) {
    reasons.push('receipt_count');
  }

  return reasons;
};

/**
 * Creates a pure weak-signal accumulator for self-reflection request decisions.
 *
 * Use when:
 * - Runtime, tool, feedback, or receipt events need fast-loop self-reflection thresholds
 * - Callers need deterministic in-memory behavior without DB writes, queues, or source emission
 *
 * Expects:
 * - One accumulator instance is scoped to a runtime lifetime or test fixture
 *
 * Returns:
 * - An accumulator with a `record` method that emits only when a threshold crosses once per scope
 */
export const createSelfReflectionAccumulator = (): SelfReflectionAccumulator => {
  const scopes = new Map<string, SelfReflectionAccumulatorState>();

  return {
    record: (input) => {
      const scope = resolveScope(input);

      if (!scope) return { shouldRequest: false };

      const scopeKey = getScopeKey(input, scope);
      const state = scopes.get(scopeKey) ?? createState();

      scopes.set(scopeKey, state);
      return createDecisionAfterRecord(input, scope, state);
    },
  };
};

/**
 * Creates a policy-state-backed accumulator for self-reflection request decisions.
 *
 * Use when:
 * - Workflow events are processed one source event at a time
 * - Count-based self-reflection triggers must persist across workflow invocations
 *
 * Expects:
 * - The provided policy-state store preserves fields for the configured TTL
 * - Store writes merge hash fields for one policy/scope key
 *
 * Returns:
 * - An accumulator that stores counters, emitted reasons, and per-tool failure counts durably
 */
export const createDurableSelfReflectionAccumulator = (input: {
  policyStateStore: AgentSignalPolicyStateStore;
  ttlSeconds: number;
}): AsyncSelfReflectionAccumulator => ({
  record: async (recordInput) => {
    const scope = resolveScope(recordInput);

    if (!scope) return { shouldRequest: false };

    const scopeKey = getScopeKey(recordInput, scope);
    const state = createStateFromStoredFields(
      await input.policyStateStore.readPolicyState(SELF_REFLECTION_ACCUMULATOR_POLICY_ID, scopeKey),
    );
    const decision = createDecisionAfterRecord(recordInput, scope, state);

    await input.policyStateStore.writePolicyState(
      SELF_REFLECTION_ACCUMULATOR_POLICY_ID,
      scopeKey,
      {
        counters: serializeCounters(state.counters),
        emittedReasons: serializeReasons(state.emittedReasons),
        lastSourceId: recordInput.sourceId,
        toolFailures: serializeToolFailures(state.toolFailures),
        version: '1',
      },
      input.ttlSeconds,
    );

    return decision;
  },
});
