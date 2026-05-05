import type { EvidenceRef } from './types';

/** Shared fields for skill maintenance domain requests. */
export interface SkillMaintenanceBaseInput {
  /** Whether the target is readonly because it is builtin, marketplace, or otherwise immutable. */
  readonly?: boolean;
  /** User that owns the writable managed skill. */
  userId: string;
}

/** Input for creating a managed skill. */
export interface CreateMaintenanceSkillInput extends SkillMaintenanceBaseInput {
  /** Skill body or authoring payload. */
  bodyMarkdown?: string;
  /** Optional description. */
  description?: string;
  /** Stable skill name. */
  name?: string;
  /** Optional title. */
  title?: string;
}

/** Input for refining an existing managed skill. */
export interface RefineMaintenanceSkillInput extends SkillMaintenanceBaseInput {
  /** Patch, replacement body, or maintainer payload. */
  patch?: string;
  /** Writable managed skill agent document id. */
  skillDocumentId: string;
}

/** Input for consolidating managed skills into a canonical skill. */
export interface ConsolidateMaintenanceSkillInput extends SkillMaintenanceBaseInput {
  /** Approval context that allows a consolidation mutation. */
  approval?: {
    /** Source of the approval decision. */
    source: 'proposal' | 'same_turn_feedback';
  };
  /** Canonical writable managed skill agent document id. */
  canonicalSkillDocumentId: string;
  /** Source managed skill ids used to build the canonical skill. */
  sourceSkillIds: string[];
}

/** Request envelope for creating one skill. */
export interface SkillMaintenanceCreateRequest {
  /** Evidence supporting the skill creation. */
  evidenceRefs: EvidenceRef[];
  /** Stable action idempotency key. */
  idempotencyKey: string;
  /** Domain payload. */
  input: CreateMaintenanceSkillInput;
}

/** Request envelope for refining one skill. */
export interface SkillMaintenanceRefineRequest {
  /** Evidence supporting the refinement. */
  evidenceRefs: EvidenceRef[];
  /** Stable action idempotency key. */
  idempotencyKey: string;
  /** Domain payload. */
  input: RefineMaintenanceSkillInput;
}

/** Request envelope for consolidating managed skills. */
export interface SkillMaintenanceConsolidateRequest {
  /** Evidence supporting the consolidation. */
  evidenceRefs: EvidenceRef[];
  /** Stable action idempotency key. */
  idempotencyKey: string;
  /** Domain payload. */
  input: ConsolidateMaintenanceSkillInput;
}

/** Result returned by skill maintenance adapters. */
export interface SkillMaintenanceResult {
  /** Affected writable managed skill document id. */
  skillDocumentId: string;
  /** Optional short persistence summary. */
  summary?: string;
}

/** Dependencies used by the skill maintenance service. */
export interface SkillManagementServiceDependencies {
  /** Adapter that consolidates managed skills through the existing skill stack. */
  consolidateSkill?: (
    request: SkillMaintenanceConsolidateRequest,
  ) => Promise<SkillMaintenanceResult>;
  /** Adapter that creates managed skills through the existing skill stack. */
  createSkill?: (request: SkillMaintenanceCreateRequest) => Promise<SkillMaintenanceResult>;
  /** Adapter that refines managed skills through the existing skill stack. */
  refineSkill?: (request: SkillMaintenanceRefineRequest) => Promise<SkillMaintenanceResult>;
}

const assertWritableSkill = (readonly: boolean | undefined) => {
  if (readonly) {
    throw new Error('Skill target is readonly');
  }
};

const assertApprovedConsolidation = (input: ConsolidateMaintenanceSkillInput) => {
  if (!input.approval) {
    throw new Error('Skill consolidation requires proposal or explicit same-turn approval');
  }
};

/**
 * Creates a skill management maintenance service.
 *
 * Use when:
 * - Maintenance executor needs one skill domain validation boundary
 * - Same-turn skill actions need to share readonly and consolidation guards
 *
 * Expects:
 * - Builtin and marketplace skills are marked readonly before mutation
 * - Server callers inject adapters backed by the existing managed-skill stack
 *
 * Returns:
 * - A service that validates skill targets before delegating persistence
 */
export const createSkillManagementService = (
  dependencies: SkillManagementServiceDependencies = {},
) => ({
  consolidateSkill: async (
    request: SkillMaintenanceConsolidateRequest,
  ): Promise<SkillMaintenanceResult> => {
    assertWritableSkill(request.input.readonly);
    assertApprovedConsolidation(request.input);

    if (!dependencies.consolidateSkill) {
      throw new Error('Skill consolidate adapter is required');
    }

    return dependencies.consolidateSkill(request);
  },
  createSkill: async (request: SkillMaintenanceCreateRequest): Promise<SkillMaintenanceResult> => {
    assertWritableSkill(request.input.readonly);

    if (!dependencies.createSkill) {
      throw new Error('Skill create adapter is required');
    }

    return dependencies.createSkill(request);
  },
  refineSkill: async (request: SkillMaintenanceRefineRequest): Promise<SkillMaintenanceResult> => {
    assertWritableSkill(request.input.readonly);

    if (!dependencies.refineSkill) {
      throw new Error('Skill refine adapter is required');
    }

    return dependencies.refineSkill(request);
  },
});
