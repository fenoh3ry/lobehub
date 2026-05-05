import type { MemoryMaintenanceWriteRequest, MemoryMaintenanceWriteResult } from './memory';
import type {
  SkillMaintenanceConsolidateRequest,
  SkillMaintenanceCreateRequest,
  SkillMaintenanceRefineRequest,
  SkillMaintenanceResult,
} from './skill';
import type {
  MaintenanceActionPlan,
  MaintenanceDomainOperation,
  MaintenancePlan,
  MaintenanceReviewRunResult,
} from './types';
import {
  isActionExecutable,
  MaintenanceActionStatus,
  MaintenanceApplyMode,
  ReviewRunStatus,
} from './types';

/** Dependencies used by the maintenance executor. */
export interface MaintenanceExecutorDependencies {
  /** Memory domain service used for auto-apply memory operations. */
  memoryService: {
    /** Writes a memory maintenance request. */
    writeMemory: (request: MemoryMaintenanceWriteRequest) => Promise<MemoryMaintenanceWriteResult>;
  };
  /** Skill domain service used for auto-apply skill operations. */
  skillService: Partial<{
    /** Creates a managed skill. */
    createSkill: (request: SkillMaintenanceCreateRequest) => Promise<SkillMaintenanceResult>;
    /** Refines a managed skill. */
    refineSkill: (request: SkillMaintenanceRefineRequest) => Promise<SkillMaintenanceResult>;
    /** Consolidates managed skills. */
    consolidateSkill: (
      request: SkillMaintenanceConsolidateRequest,
    ) => Promise<SkillMaintenanceResult>;
  }>;
}

const toSkippedResult = (action: MaintenanceActionPlan) => ({
  idempotencyKey: action.idempotencyKey,
  status: MaintenanceActionStatus.Skipped,
  summary: 'Maintenance action was skipped by planner policy.',
});

const toProposedResult = (action: MaintenanceActionPlan) => ({
  idempotencyKey: action.idempotencyKey,
  status: MaintenanceActionStatus.Proposed,
  summary: action.rationale,
});

const toFailedResult = (action: MaintenanceActionPlan, error: unknown) => ({
  idempotencyKey: action.idempotencyKey,
  status: MaintenanceActionStatus.Failed,
  summary: error instanceof Error ? error.message : String(error),
});

const executeMemoryAction = async (
  dependencies: MaintenanceExecutorDependencies,
  action: MaintenanceActionPlan,
  operation: Extract<MaintenanceDomainOperation, { domain: 'memory' }>,
) => {
  const result = await dependencies.memoryService.writeMemory({
    evidenceRefs: action.evidenceRefs,
    idempotencyKey: action.idempotencyKey,
    input: operation.input,
  });

  return {
    idempotencyKey: action.idempotencyKey,
    resourceId: result.memoryId,
    status: MaintenanceActionStatus.Applied,
    summary: result.summary,
  };
};

const executeSkillAction = async (
  dependencies: MaintenanceExecutorDependencies,
  action: MaintenanceActionPlan,
  operation: Extract<MaintenanceDomainOperation, { domain: 'skill' }>,
) => {
  if (operation.operation === 'create' && dependencies.skillService.createSkill) {
    const result = await dependencies.skillService.createSkill({
      evidenceRefs: action.evidenceRefs,
      idempotencyKey: action.idempotencyKey,
      input: operation.input,
    });

    return {
      idempotencyKey: action.idempotencyKey,
      resourceId: result.skillDocumentId,
      status: MaintenanceActionStatus.Applied,
      summary: result.summary,
    };
  }

  if (operation.operation === 'refine' && dependencies.skillService.refineSkill) {
    const result = await dependencies.skillService.refineSkill({
      evidenceRefs: action.evidenceRefs,
      idempotencyKey: action.idempotencyKey,
      input: operation.input,
    });

    return {
      idempotencyKey: action.idempotencyKey,
      resourceId: result.skillDocumentId,
      status: MaintenanceActionStatus.Applied,
      summary: result.summary,
    };
  }

  if (operation.operation === 'consolidate' && dependencies.skillService.consolidateSkill) {
    const result = await dependencies.skillService.consolidateSkill({
      evidenceRefs: action.evidenceRefs,
      idempotencyKey: action.idempotencyKey,
      input: operation.input,
    });

    return {
      idempotencyKey: action.idempotencyKey,
      resourceId: result.skillDocumentId,
      status: MaintenanceActionStatus.Applied,
      summary: result.summary,
    };
  }

  throw new Error('Skill operation adapter is required');
};

const executeAction = async (
  dependencies: MaintenanceExecutorDependencies,
  action: MaintenanceActionPlan,
) => {
  if (action.applyMode === MaintenanceApplyMode.Skip) {
    return toSkippedResult(action);
  }

  if (action.applyMode === MaintenanceApplyMode.ProposalOnly) {
    return toProposedResult(action);
  }

  if (!isActionExecutable(action.applyMode)) {
    return toSkippedResult(action);
  }

  if (!action.operation) {
    return toSkippedResult(action);
  }

  try {
    const { operation } = action;

    if (operation.domain === 'memory') {
      return await executeMemoryAction(dependencies, action, operation);
    }

    return await executeSkillAction(dependencies, action, operation);
  } catch (error) {
    return toFailedResult(action, error);
  }
};

const getReviewRunStatus = (actions: MaintenanceReviewRunResult['actions']) => {
  if (actions.some((action) => action.status === MaintenanceActionStatus.Failed)) {
    return actions.some((action) => action.status === MaintenanceActionStatus.Applied)
      ? ReviewRunStatus.PartiallyApplied
      : ReviewRunStatus.Failed;
  }

  return ReviewRunStatus.Completed;
};

/**
 * Creates an ordered executor for normalized maintenance plans.
 *
 * Use when:
 * - Source handlers need to apply a planner-approved maintenance plan
 * - Tests need a dry executor with injected memory and skill services
 *
 * Expects:
 * - Risk and apply modes have already been assigned by the planner
 * - Domain services validate payloads again before writing
 *
 * Returns:
 * - An executor that records per-action results and continues after failures
 */
export const createMaintenanceExecutorService = (
  dependencies: MaintenanceExecutorDependencies,
) => ({
  execute: async (plan: MaintenancePlan): Promise<MaintenanceReviewRunResult> => {
    const actions = [];

    for (const action of plan.actions) {
      actions.push(await executeAction(dependencies, action));
    }

    return {
      actions,
      status: getReviewRunStatus(actions),
    };
  },
});
