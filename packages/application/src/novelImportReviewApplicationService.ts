/// <reference types="node" />

import type {
  ArtifactDependency,
  ArtifactRecord,
  ArtifactSelector,
  ChapterCandidateV1,
  ChapterIndexEntryV1,
  ChapterIndexV1,
  CoverageSegmentV1,
  JsonValue,
  NovelImportChangeSelectorV1,
  NovelImportLayerDiffHunkV1,
  NovelImportLayerDiffOperationV1,
  NovelImportReviewBaselineV1,
  NovelImportReviewCommandV1,
  NovelImportReviewQueryV1,
  NovelImportReviewSnapshotV1,
  NovelImportRevisionHistoryEntryV1,
  NovelImportStalePreviewQueryV1,
  NovelImportStalePreviewV1,
  ProjectContext,
  TextRangeV1,
  TextRevisionRefV1,
} from '@voxweaver/contracts';
import type { ProjectWorkflowPort } from '@voxweaver/workflow-core';
import type { NovelImportBundleV1 } from './novelImportApplicationService.js';
import type { ProjectApplicationService } from './projectApplicationService.js';
import type { ProjectSessionIdentity } from './projectWorkflowApplicationService.js';

import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';

import {
  NOVEL_IMPORT_REVIEW_SCHEMA_VERSION,
  parseArtifactRecord,
  parseChapterIndexV1,
  parseNovelImportReviewCommandV1,
  parseNovelImportReviewQueryV1,
  parseNovelImportReviewSnapshotV1,
  parseNovelImportStalePreviewQueryV1,
  parseNovelImportStalePreviewV1,
  parseTextRangeMapV1,
} from '@voxweaver/contracts';
import {
  validateChapterIndexDomainV1,
  validateDocumentBlockIndexV1,
} from '@voxweaver/novel-domain';
import {
  normalizeTextV1,
  validateNormalizationProposalsV1,
} from '@voxweaver/text-pipeline';
import {
  computeInputFingerprint,
  sha256CanonicalJson,
} from '@voxweaver/workflow-core';

import {
  NOVEL_IMPORT_BUNDLE_ARTIFACT_TYPE,
  NOVEL_IMPORT_BUNDLE_SCHEMA_VERSION,
} from './novelImportApplicationService.js';
import { ProjectApplicationError } from './projectApplicationError.js';

export const NOVEL_IMPORT_REVIEW_APPLICATION_PROCESSOR_ID
  = 'voxweaver.application.novel-import-review' as const;
export const NOVEL_IMPORT_REVIEW_APPLICATION_PROCESSOR_VERSION = '1.0.0' as const;

const REVIEW_INPUT_COMPATIBILITY_VERSION = 'm1-novel-import-review-v1';
const MANUAL_BOUNDARY_RULE_ID = 'manual.chapter-boundary';
const MANUAL_BOUNDARY_RULE_VERSION = '1.0.0';

export interface NovelImportReviewQueryRequest extends ProjectSessionIdentity {
  readonly query: NovelImportReviewQueryV1;
}

export interface NovelImportReviewStalePreviewRequest extends ProjectSessionIdentity {
  readonly query: NovelImportStalePreviewQueryV1;
}

export interface NovelImportReviewCommandRequest extends ProjectSessionIdentity {
  readonly command: NovelImportReviewCommandV1;
}

export interface NovelImportReviewRevisionEntry {
  readonly artifact: ArtifactRecord;
  readonly bundle: NovelImportBundleV1;
}

export interface NovelImportReviewTemporaryArtifact {
  readonly outputDirectory: string;
}

export interface NovelImportReviewMetadataSaveCommand {
  readonly artifactId: string;
  readonly expectedCurrentRevisionId: string;
  readonly command: NovelImportReviewCommandV1;
}

export type NovelImportReviewMetadataSaveResult
  = | {
    readonly status: 'saved';
    readonly currentArtifactRevisionId: string;
  }
  | {
    readonly status: 'conflict';
    readonly currentArtifactRevisionId: string;
  };

export interface StageNovelImportReviewBundleCommand {
  readonly artifactId: string;
  readonly expectedCurrentRevisionId: string;
  readonly revisionId: string;
  readonly command: NovelImportReviewCommandV1;
  readonly bundle: NovelImportBundleV1;
}

export type StageNovelImportReviewBundleResult
  = | {
    readonly status: 'staged';
    readonly currentArtifactRevisionId: string;
    readonly artifact: NovelImportReviewTemporaryArtifact;
  }
  | {
    readonly status: 'conflict';
    readonly currentArtifactRevisionId: string;
  };

export interface ValidateNovelImportReviewBundleCommand {
  readonly expectedCurrentRevisionId: string;
  readonly revisionId: string;
  readonly artifact: NovelImportReviewTemporaryArtifact;
  readonly expectedBundle: NovelImportBundleV1;
}

/**
 * Formal review metadata and immutable bundle bytes remain outside Application.
 * Implementations must persist metadata append-only and must return `conflict`
 * before writing when their observed current revision differs from the expected
 * revision. This is an explicit port precondition, not an atomic workflow CAS.
 */
export interface NovelImportReviewArtifactStorePort {
  readonly readBundle: (
    artifact: ArtifactRecord,
  ) => Promise<NovelImportBundleV1>;
  readonly listRevisions: (
    artifactId: string,
  ) => Promise<readonly NovelImportReviewRevisionEntry[]>;
  readonly listMetadataCommands: (
    artifact: ArtifactRecord,
  ) => Promise<readonly NovelImportReviewCommandV1[]>;
  readonly appendMetadataCommand: (
    command: NovelImportReviewMetadataSaveCommand,
  ) => Promise<NovelImportReviewMetadataSaveResult>;
  readonly stageBundle: (
    command: StageNovelImportReviewBundleCommand,
  ) => Promise<StageNovelImportReviewBundleResult>;
  readonly validateStagedBundle: (
    command: ValidateNovelImportReviewBundleCommand,
  ) => Promise<void>;
}

export type NovelImportReviewArtifactStoreFactory = (
  context: ProjectContext,
) => NovelImportReviewArtifactStorePort;

export interface RerunNovelImportReviewSelectionCommand {
  readonly baselineArtifact: ArtifactRecord;
  readonly baselineBundle: NovelImportBundleV1;
  readonly requestedBy: string;
  readonly selector: NovelImportChangeSelectorV1;
}

/** Pure processing capability. It must not stage or persist output. */
export interface NovelImportReviewSelectionRerunnerPort {
  readonly rerunSelection: (
    command: RerunNovelImportReviewSelectionCommand,
  ) => Promise<NovelImportBundleV1>;
}

export type NovelImportReviewSelectionRerunnerFactory = (
  context: ProjectContext,
) => NovelImportReviewSelectionRerunnerPort;

export type NovelImportReviewCommandResult
  = | {
    readonly outcome: 'unchanged';
    readonly artifact: ArtifactRecord;
    readonly snapshot: NovelImportReviewSnapshotV1;
  }
  | {
    readonly outcome: 'committed';
    readonly artifact: ArtifactRecord;
    readonly snapshot: NovelImportReviewSnapshotV1;
  };

export interface NovelImportReviewApplicationServiceOptions {
  readonly createOpaqueId?: () => string;
}

export class NovelImportReviewApplicationError extends Error {
  constructor(
    readonly code:
      | 'NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE'
      | 'NOVEL_IMPORT_REVIEW_REQUIRED'
      | 'NOVEL_IMPORT_STALE_SESSION'
      | 'NOVEL_IMPORT_STRUCTURE_INVALID',
    readonly detailReason: string,
    message: string,
  ) {
    super(message);
    this.name = 'NovelImportReviewApplicationError';
  }
}

interface LoadedReviewState {
  readonly artifact: ArtifactRecord;
  readonly bundle: NovelImportBundleV1;
  readonly history: readonly NovelImportReviewRevisionEntry[];
}

interface RevisionPlan {
  readonly effect: 'revision';
  readonly bundle: NovelImportBundleV1;
  readonly changeSelector: ArtifactSelector;
}

interface MetadataPlan {
  readonly effect: 'metadata';
  readonly bundle: NovelImportBundleV1;
}

interface UnchangedPlan {
  readonly effect: 'unchanged';
  readonly bundle: NovelImportBundleV1;
}

type ReviewCommandPlan = RevisionPlan | MetadataPlan | UnchangedPlan;

export class NovelImportReviewApplicationService {
  readonly #artifactStoreFactory: NovelImportReviewArtifactStoreFactory;
  readonly #createOpaqueId: () => string;
  readonly #projects: ProjectApplicationService;
  readonly #rerunnerFactory: NovelImportReviewSelectionRerunnerFactory;
  readonly #workflowFactory: (context: ProjectContext) => ProjectWorkflowPort;

  constructor(
    projects: ProjectApplicationService,
    workflowFactory: (context: ProjectContext) => ProjectWorkflowPort,
    artifactStoreFactory: NovelImportReviewArtifactStoreFactory,
    rerunnerFactory: NovelImportReviewSelectionRerunnerFactory,
    options: NovelImportReviewApplicationServiceOptions = {},
  ) {
    this.#projects = projects;
    this.#workflowFactory = workflowFactory;
    this.#artifactStoreFactory = artifactStoreFactory;
    this.#rerunnerFactory = rerunnerFactory;
    this.#createOpaqueId = options.createOpaqueId ?? randomUUID;
  }

  inspect(
    request: NovelImportReviewQueryRequest,
  ): Promise<NovelImportReviewSnapshotV1> {
    const query = parseReviewQuery(request?.query);
    return this.#withSession(request, 'read', async (context) => {
      const { workflow, store } = this.#resolvePorts(context, 'read');
      const state = await loadReviewState(workflow, store, query.baselineRevision, true);
      return buildSnapshot(
        state.artifact,
        state.bundle,
        state.history,
        context.accessMode === 'read-only',
      );
    });
  }

  previewStaleImpact(
    request: NovelImportReviewStalePreviewRequest,
  ): Promise<NovelImportStalePreviewV1> {
    const query = parseStaleQuery(request?.query);
    return this.#withSession(request, 'read', async (context) => {
      const { workflow, store } = this.#resolvePorts(context, 'read');
      await loadReviewState(
        workflow,
        store,
        query.baselineRevision,
        false,
      );
      const impact = await workflow.previewArtifactImpact({
        producerArtifactId: query.baselineRevision.artifactId,
        changeSelector: query.changeSelector,
      });
      assertImpactPreview(impact, query);
      return parseStalePreview({
        documentType: 'novel-import-stale-preview',
        schemaVersion: NOVEL_IMPORT_REVIEW_SCHEMA_VERSION,
        baselineRevision: query.baselineRevision,
        currentArtifactRevisionId: impact.producerRevisionId,
        baselineStatus: impact.producerRevisionId
          === query.baselineRevision.artifactRevisionId
          ? 'current'
          : 'stale',
        canApply: impact.producerRevisionId
          === query.baselineRevision.artifactRevisionId,
        changeSelector: query.changeSelector,
        impacts: impact.impacts.map(item => ({
          consumerArtifactId: item.consumerArtifactId,
          consumerRevisionId: item.consumerRevisionId,
          producerArtifactId: item.producerArtifactId,
          producerRevisionId: item.producerRevisionId,
          dependencyType: item.dependencyType,
          depth: item.depth,
          ...(item.selector === undefined ? {} : { selector: item.selector }),
        })),
      });
    });
  }

  execute(
    request: NovelImportReviewCommandRequest,
  ): Promise<NovelImportReviewCommandResult> {
    const command = parseReviewCommand(request?.command);
    return this.#withSession(request, 'write', async (context) => {
      const { workflow, store } = this.#resolvePorts(context, 'write');
      const state = await loadReviewState(
        workflow,
        store,
        command.baselineRevision,
        true,
      );
      const plan = await this.#planCommand(context, state, command);
      await assertBaselineCurrent(workflow, command.baselineRevision);

      if (plan.effect === 'unchanged') {
        return {
          outcome: 'unchanged',
          artifact: state.artifact,
          snapshot: buildSnapshot(
            state.artifact,
            plan.bundle,
            state.history,
            false,
          ),
        };
      }

      if (plan.effect === 'metadata') {
        const saved = await store.appendMetadataCommand({
          artifactId: command.baselineRevision.artifactId,
          expectedCurrentRevisionId:
            command.baselineRevision.artifactRevisionId,
          command,
        });
        assertMetadataSave(saved, command.baselineRevision);
        return {
          outcome: 'unchanged',
          artifact: state.artifact,
          snapshot: buildSnapshot(
            state.artifact,
            plan.bundle,
            state.history,
            false,
          ),
        };
      }

      const revisionId = nextOpaqueId(this.#createOpaqueId, 'artifact revision');
      const staged = await store.stageBundle({
        artifactId: state.artifact.artifactId,
        expectedCurrentRevisionId: state.artifact.revisionId,
        revisionId,
        command,
        bundle: plan.bundle,
      });
      const temporaryArtifact = assertStaged(staged, command.baselineRevision);
      await store.validateStagedBundle({
        expectedCurrentRevisionId: state.artifact.revisionId,
        revisionId,
        artifact: temporaryArtifact,
        expectedBundle: plan.bundle,
      });

      const dependencies = await workflow.listArtifactDependencies(
        state.artifact.revisionId,
      );
      // The workflow API has no expected-current CAS. Rechecking immediately
      // before commit minimizes the race and turns observed changes into a
      // stable typed conflict, but it does not claim cross-port atomicity.
      await assertBaselineCurrent(workflow, command.baselineRevision);
      const artifact = await workflow.commitArtifactRevision({
        artifactId: state.artifact.artifactId,
        artifactType: state.artifact.artifactType,
        lineageId: state.artifact.lineageId,
        revisionId,
        activate: true,
        changeSelector: plan.changeSelector,
        createdBy: command.requestedBy,
        dependencies: dependencies.map(toDependencyInput),
        inputFingerprint: plan.bundle.inputFingerprint,
        outputDirectory: temporaryArtifact.outputDirectory,
        parameters: plan.bundle.parameters,
        processorId: NOVEL_IMPORT_REVIEW_APPLICATION_PROCESSOR_ID,
        processorVersion: NOVEL_IMPORT_REVIEW_APPLICATION_PROCESSOR_VERSION,
        reviewRequired: bundleRequiresReview(plan.bundle),
        scope: state.artifact.scope,
        storageKind: state.artifact.storageKind,
      });
      assertCommittedArtifact(
        artifact,
        state.artifact,
        plan.bundle,
        revisionId,
        command.requestedBy,
      );
      const history = appendHistory(state.history, artifact, plan.bundle);
      return {
        outcome: 'committed',
        artifact,
        snapshot: buildSnapshot(artifact, plan.bundle, history, false),
      };
    });
  }

  async #planCommand(
    context: ProjectContext,
    state: LoadedReviewState,
    command: NovelImportReviewCommandV1,
  ): Promise<ReviewCommandPlan> {
    switch (command.commandType) {
      case 'classify-uncovered-range':
        return planClassification(state.bundle, command);
      case 'adjust-chapter-boundary':
        return planBoundaryAdjustment(state.bundle, command);
      case 'decide-normalization-proposal':
        return planNormalizationDecision(
          state.bundle,
          command,
          this.#createOpaqueId,
        );
      case 'rerun-selection': {
        assertSelectorTargetsExist(state.bundle, command.selector);
        const rerunner = this.#rerunnerFactory(context);
        if (typeof rerunner?.rerunSelection !== 'function') {
          dependencyUnavailable(
            'rerunner_capability_unavailable',
            'The active project does not provide selected-range rerun processing.',
          );
        }
        const rerunBundle = await rerunner.rerunSelection({
          baselineArtifact: state.artifact,
          baselineBundle: state.bundle,
          requestedBy: command.requestedBy,
          selector: command.selector,
        });
        assertBundleIdentity(rerunBundle, state.bundle);
        assertRerunScoped(state.bundle, rerunBundle, command.selector);
        if (sameBundleProjection(rerunBundle, state.bundle)) {
          return { effect: 'unchanged', bundle: state.bundle };
        }
        return {
          effect: 'revision',
          bundle: finalizeRevisionBundle(state.bundle, rerunBundle, command),
          changeSelector: toArtifactSelector(command.selector),
        };
      }
    }
  }

  async #withSession<T>(
    request: ProjectSessionIdentity,
    requiredAccess: 'read' | 'write',
    operation: (context: ProjectContext) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.#projects.runInActiveProjectSession(
        {
          projectId: request?.projectId,
          projectSessionId: request?.projectSessionId,
          requiredAccess,
        },
        operation,
      );
    } catch (error) {
      if (
        error instanceof ProjectApplicationError
        && error.code === 'PROJECT_SESSION_STALE'
      ) {
        throw new NovelImportReviewApplicationError(
          'NOVEL_IMPORT_STALE_SESSION',
          'project_session_stale',
          'The project session is no longer active.',
        );
      }
      throw error;
    }
  }

  #resolvePorts(
    context: ProjectContext,
    requiredAccess: 'read' | 'write',
  ): {
    readonly workflow: ProjectWorkflowPort;
    readonly store: NovelImportReviewArtifactStorePort;
  } {
    let workflow: ProjectWorkflowPort;
    let store: NovelImportReviewArtifactStorePort;
    try {
      workflow = this.#workflowFactory(context);
      store = this.#artifactStoreFactory(context);
    } catch {
      dependencyUnavailable(
        'review_port_resolution_failed',
        'The active project review capabilities could not be resolved.',
      );
    }
    assertReviewPorts(workflow, store, requiredAccess);
    return { workflow, store };
  }
}

function parseReviewQuery(value: unknown): NovelImportReviewQueryV1 {
  try {
    return parseNovelImportReviewQueryV1(value);
  } catch {
    structureInvalid(
      'review_query_invalid',
      'The novel import review query is invalid.',
    );
  }
}

function parseReviewCommand(value: unknown): NovelImportReviewCommandV1 {
  try {
    return parseNovelImportReviewCommandV1(value);
  } catch {
    structureInvalid(
      'review_command_invalid',
      'The novel import review command is invalid.',
    );
  }
}

function parseStaleQuery(value: unknown): NovelImportStalePreviewQueryV1 {
  try {
    return parseNovelImportStalePreviewQueryV1(value);
  } catch {
    structureInvalid(
      'stale_preview_query_invalid',
      'The novel import stale preview query is invalid.',
    );
  }
}

function parseStalePreview(value: unknown): NovelImportStalePreviewV1 {
  try {
    return parseNovelImportStalePreviewV1(value);
  } catch {
    dependencyUnavailable(
      'stale_preview_projection_invalid',
      'The workflow returned an invalid novel import stale preview.',
    );
  }
}

function assertReviewPorts(
  workflow: ProjectWorkflowPort,
  store: NovelImportReviewArtifactStorePort,
  requiredAccess: 'read' | 'write',
): void {
  const workflowMethods = requiredAccess === 'write'
    ? [
        'getArtifactRevision',
        'previewArtifactImpact',
        'listArtifactDependencies',
        'commitArtifactRevision',
      ] as const
    : [
        'getArtifactRevision',
        'previewArtifactImpact',
      ] as const;
  for (const method of workflowMethods) {
    if (typeof workflow?.[method] !== 'function') {
      dependencyUnavailable(
        'workflow_capability_unavailable',
        'The active project workflow does not provide novel import review.',
      );
    }
  }
  const storeMethods = requiredAccess === 'write'
    ? [
        'readBundle',
        'listRevisions',
        'listMetadataCommands',
        'appendMetadataCommand',
        'stageBundle',
        'validateStagedBundle',
      ] as const
    : [
        'readBundle',
        'listRevisions',
        'listMetadataCommands',
      ] as const;
  for (const method of storeMethods) {
    if (typeof store?.[method] !== 'function') {
      dependencyUnavailable(
        'artifact_store_capability_unavailable',
        'The active project artifact store does not provide novel import review.',
      );
    }
  }
}

async function loadReviewState(
  workflow: ProjectWorkflowPort,
  store: NovelImportReviewArtifactStorePort,
  baseline: NovelImportReviewBaselineV1,
  requireCurrent: boolean,
): Promise<LoadedReviewState> {
  const artifact = await workflow.getArtifactRevision(
    baseline.artifactRevisionId,
  );
  assertBaselineArtifact(artifact, baseline, requireCurrent);
  const immutableBundle = await store.readBundle(artifact);
  assertBundleForArtifact(immutableBundle, artifact, baseline);

  const metadataCommands = await store.listMetadataCommands(artifact);
  const bundle = applyMetadataCommands(
    immutableBundle,
    metadataCommands,
    baseline,
  );
  const history = await store.listRevisions(baseline.artifactId);
  assertHistory(history, baseline, artifact, bundle);
  return { artifact, bundle, history };
}

function assertBaselineArtifact(
  artifact: ArtifactRecord | undefined,
  baseline: NovelImportReviewBaselineV1,
  requireCurrent: boolean,
): asserts artifact is ArtifactRecord {
  try {
    parseArtifactRecord(artifact);
  } catch {
    dependencyUnavailable(
      'baseline_artifact_projection_invalid',
      'The requested novel import artifact projection is invalid.',
    );
  }
  if (
    artifact === undefined
    || artifact.artifactId !== baseline.artifactId
    || artifact.revisionId !== baseline.artifactRevisionId
    || artifact.artifactType !== NOVEL_IMPORT_BUNDLE_ARTIFACT_TYPE
    || artifact.executionStatus !== 'succeeded'
    || artifact.validityStatus === 'missing'
  ) {
    dependencyUnavailable(
      'baseline_artifact_unavailable',
      'The requested novel import artifact revision is unavailable.',
    );
  }
  if (requireCurrent && artifact.validityStatus !== 'current')
    baselineConflict(artifact.revisionId);
}

async function assertBaselineCurrent(
  workflow: ProjectWorkflowPort,
  baseline: NovelImportReviewBaselineV1,
): Promise<void> {
  const current = await workflow.getArtifactRevision(
    baseline.artifactRevisionId,
  );
  assertBaselineArtifact(current, baseline, true);
}

function assertBundleForArtifact(
  bundle: NovelImportBundleV1,
  artifact: ArtifactRecord,
  baseline: NovelImportReviewBaselineV1,
): void {
  if (
    bundle?.documentType !== 'novel-import-bundle'
    || bundle.schemaVersion !== NOVEL_IMPORT_BUNDLE_SCHEMA_VERSION
    || bundle.inputFingerprint !== artifact.inputFingerprint
    || bundle.parametersHash !== artifact.parametersHash
    || !sameRevision(bundle.canonical.revision, baseline.canonicalTextRevision)
  ) {
    dependencyUnavailable(
      'baseline_bundle_projection_mismatch',
      'The novel import bundle does not match its artifact revision.',
    );
  }
  validateBundleProjection(bundle);
}

function validateBundleProjection(bundle: NovelImportBundleV1): void {
  const rangeMap = bundle.canonical.rawToCanonicalRangeMap;
  const blockIds = bundle.blockIndex.blocks.map(block => block.blockId);
  const chapterIds = bundle.chapterIndex.entries.map(entry => entry.chapterId);
  if (
    bundle.sourceAsset.sourceAssetId !== bundle.importedNovel.sourceAssetId
    || bundle.sourceAsset.contentHash !== bundle.importedNovel.sourceHash
    || bundle.sourceByteLength !== bundle.importedNovel.sourceByteLength
    || bundle.parametersHash !== sha256CanonicalJson(bundle.parameters)
    || !sameJson(bundle.selectedEncoding, bundle.importedNovel.encodingDecision)
    || !sameJson(bundle.importWarnings, bundle.importedNovel.warnings)
    || !sameRevision(
      bundle.canonical.revision,
      bundle.blockIndex.canonicalTextRevision,
    )
    || !sameRevision(
      bundle.canonical.revision,
      bundle.chapterIndex.textRevision,
    )
    || !sameJson(bundle.chapterCandidates, bundle.chapterIndex.candidates)
    || !sameRevision(
      rangeMap.inputRevision,
      bundle.importedNovel.rawTextRevision,
    )
    || !sameRevision(rangeMap.outputRevision, bundle.canonical.revision)
    || !sameStringSet(bundle.dependencySelector.blockIds ?? [], blockIds)
    || !sameStringSet(bundle.dependencySelector.chapterIds ?? [], chapterIds)
    || bundle.dependencySelector.scriptUnitIds !== undefined
    || bundle.dependencySelector.voiceProfileIds !== undefined
    || bundle.dependencySelector.dictionaryEntryIds !== undefined
  ) {
    dependencyUnavailable(
      'bundle_identity_invalid',
      'The novel import bundle contains inconsistent source or text identity.',
    );
  }
  const canonicalBytes = exactBytes(bundle.canonical.text, 'canonical text');
  if (
    canonicalBytes.byteLength !== bundle.canonical.revision.byteLength
    || sha256(canonicalBytes) !== bundle.canonical.revision.contentHash
  ) {
    dependencyUnavailable(
      'canonical_revision_invalid',
      'The novel import canonical revision does not match its bytes.',
    );
  }
  const normalizedBytes = exactBytes(
    bundle.normalization.result.normalizedText,
    'normalized text',
  );
  if (
    normalizedBytes.byteLength
    !== bundle.normalization.result.normalizedTextRevision.byteLength
    || sha256(normalizedBytes)
    !== bundle.normalization.result.normalizedTextRevision.contentHash
  ) {
    dependencyUnavailable(
      'normalized_revision_invalid',
      'The novel import normalized revision does not match its bytes.',
    );
  }
  try {
    parseChapterIndexV1(bundle.chapterIndex);
    validateChapterIndexDomainV1(bundle.chapterIndex);
    validateDocumentBlockIndexV1(bundle.blockIndex);
    parseTextRangeMapV1(bundle.canonical.rawToCanonicalRangeMap);
    validateNormalizationProposalsV1({
      canonicalTextRevision: bundle.canonical.revision,
      canonicalText: bundle.canonical.text,
      proposals: bundle.normalization.proposals,
    });
    const expectedNormalization = normalizeTextV1({
      canonicalTextRevision: bundle.canonical.revision,
      canonicalText: bundle.canonical.text,
      proposals: bundle.normalization.proposals,
      mode: 'apply',
      selectedProposalIds: bundle.normalization.proposals
        .filter(proposal => proposal.reviewStatus === 'approved')
        .map(proposal => proposal.proposalId),
      normalizedTextRevisionId:
        bundle.normalization.result.normalizedTextRevision.textRevisionId,
    });
    if (
      !expectedNormalization.applied
      || !sameJson(expectedNormalization, bundle.normalization.result)
    ) {
      throw new Error('Normalization result projection mismatch');
    }
  } catch {
    dependencyUnavailable(
      'bundle_structure_invalid',
      'The novel import bundle structure is invalid.',
    );
  }
}

function assertHistory(
  history: readonly NovelImportReviewRevisionEntry[],
  baseline: NovelImportReviewBaselineV1,
  artifact: ArtifactRecord,
  currentBundle: NovelImportBundleV1,
): void {
  if (!Array.isArray(history)) {
    dependencyUnavailable(
      'revision_history_invalid',
      'Novel import revision history must be an array.',
    );
  }
  const revisionIds = new Set<string>();
  let found = false;
  for (const entry of history) {
    try {
      parseArtifactRecord(entry?.artifact);
    } catch {
      dependencyUnavailable(
        'revision_history_invalid',
        'Novel import revision history contains an invalid artifact.',
      );
    }
    if (
      entry?.artifact?.artifactId !== baseline.artifactId
      || entry.artifact.artifactType !== NOVEL_IMPORT_BUNDLE_ARTIFACT_TYPE
      || revisionIds.has(entry.artifact.revisionId)
      || entry.bundle?.inputFingerprint !== entry.artifact.inputFingerprint
      || entry.bundle.parametersHash !== entry.artifact.parametersHash
    ) {
      dependencyUnavailable(
        'revision_history_invalid',
        'Novel import revision history contains an invalid entry.',
      );
    }
    validateBundleProjection(entry.bundle);
    revisionIds.add(entry.artifact.revisionId);
    if (entry.artifact.revisionId === baseline.artifactRevisionId) {
      found = true;
      if (
        entry.artifact.inputFingerprint !== artifact.inputFingerprint
        || !sameRevision(
          entry.bundle.canonical.revision,
          currentBundle.canonical.revision,
        )
      ) {
        dependencyUnavailable(
          'revision_history_baseline_mismatch',
          'Novel import revision history does not match the baseline.',
        );
      }
    }
  }
  if (!found) {
    dependencyUnavailable(
      'revision_history_baseline_missing',
      'Novel import revision history omits the baseline revision.',
    );
  }
}

function applyMetadataCommands(
  bundle: NovelImportBundleV1,
  commands: readonly NovelImportReviewCommandV1[],
  baseline: NovelImportReviewBaselineV1,
): NovelImportBundleV1 {
  if (!Array.isArray(commands)) {
    dependencyUnavailable(
      'review_metadata_invalid',
      'Novel import review metadata must be an array.',
    );
  }
  let projected = bundle;
  for (const value of commands) {
    const command = parseReviewCommand(value);
    if (!sameBaseline(command.baselineRevision, baseline)) {
      dependencyUnavailable(
        'review_metadata_baseline_mismatch',
        'Novel import review metadata is bound to another baseline.',
      );
    }
    if (command.commandType !== 'decide-normalization-proposal') {
      dependencyUnavailable(
        'review_metadata_command_invalid',
        'Only content-neutral normalization decisions may be metadata overlays.',
      );
    }
    projected = applyContentNeutralNormalizationDecision(projected, command);
  }
  return projected;
}

function planClassification(
  bundle: NovelImportBundleV1,
  command: Extract<
    NovelImportReviewCommandV1,
    { readonly commandType: 'classify-uncovered-range' }
  >,
): ReviewCommandPlan {
  const chapterIndex = classifyCoverageRange(
    bundle.chapterIndex,
    command.targetRange,
    command.classification,
  );
  if (sha256CanonicalJson(chapterIndex as unknown as JsonValue)
    === sha256CanonicalJson(bundle.chapterIndex as unknown as JsonValue)) {
    return { effect: 'unchanged', bundle };
  }
  const selector = selectorForRanges(bundle, [command.targetRange]);
  const next = { ...bundle, chapterIndex };
  return {
    effect: 'revision',
    bundle: finalizeRevisionBundle(bundle, next, command),
    changeSelector: selector,
  };
}

function classifyCoverageRange(
  chapterIndex: ChapterIndexV1,
  target: TextRangeV1,
  classification: Exclude<
    ChapterIndexV1['coverageReport']['segments'][number]['classification'],
    'chapter'
  >,
): ChapterIndexV1 {
  const report = chapterIndex.coverageReport;
  const targetLength = rangeLength(target);
  let changed = false;
  const segments: CoverageSegmentV1[] = [];
  for (const segment of report.segments) {
    if (!containsRange(segment.range, target)) {
      segments.push(segment);
      continue;
    }
    if (segment.classification === 'chapter') {
      structureInvalid(
        'classification_overlaps_chapter',
        'A chapter coverage range cannot be classified as non-chapter text.',
      );
    }
    if (segment.classification === classification)
      return chapterIndex;
    appendSplitCoverage(
      segments,
      segment,
      target,
      classification,
    );
    changed = true;
  }

  let removedUnclassified = false;
  const unclassifiedRanges: TextRangeV1[] = [];
  if (!changed) {
    for (const range of report.unclassifiedRanges) {
      if (!containsRange(range, target)) {
        unclassifiedRanges.push(range);
        continue;
      }
      appendNonEmptyRange(unclassifiedRanges, range, range.startByte, target.startByte);
      appendNonEmptyRange(unclassifiedRanges, range, target.endByte, range.endByte);
      segments.push({ classification, range: target });
      removedUnclassified = true;
    }
  } else {
    unclassifiedRanges.push(...report.unclassifiedRanges);
  }
  if (!changed && !removedUnclassified) {
    structureInvalid(
      'classification_target_not_uncovered',
      'The classification target is not within non-chapter or unclassified coverage.',
    );
  }

  const classifiedByteLength = report.classifiedByteLength
    + (removedUnclassified ? targetLength : 0);
  const unclassifiedByteLength = report.unclassifiedByteLength
    - (removedUnclassified ? targetLength : 0);
  const next: ChapterIndexV1 = {
    ...chapterIndex,
    coverageReport: {
      ...report,
      classifiedByteLength,
      unclassifiedByteLength,
      complete: unclassifiedByteLength === 0,
      segments: mergeCoverageSegments(segments),
      unclassifiedRanges: unclassifiedRanges.sort(compareRanges),
    },
  };
  validateChapterIndex(next);
  return next;
}

function appendSplitCoverage(
  target: CoverageSegmentV1[],
  original: Exclude<CoverageSegmentV1, { readonly classification: 'chapter' }>,
  selected: TextRangeV1,
  classification: Exclude<CoverageSegmentV1['classification'], 'chapter'>,
): void {
  if (original.range.startByte < selected.startByte) {
    target.push({
      classification: original.classification,
      range: rangeLike(original.range, original.range.startByte, selected.startByte),
    });
  }
  target.push({ classification, range: selected });
  if (selected.endByte < original.range.endByte) {
    target.push({
      classification: original.classification,
      range: rangeLike(original.range, selected.endByte, original.range.endByte),
    });
  }
}

function planBoundaryAdjustment(
  bundle: NovelImportBundleV1,
  command: Extract<
    NovelImportReviewCommandV1,
    { readonly commandType: 'adjust-chapter-boundary' }
  >,
): ReviewCommandPlan {
  const entryIndex = bundle.chapterIndex.entries.findIndex(
    entry => entry.chapterId === command.chapterId,
  );
  if (entryIndex < 0) {
    structureInvalid(
      'chapter_not_found',
      'The adjusted chapter does not exist in the baseline revision.',
    );
  }
  const currentEntry = bundle.chapterIndex.entries[entryIndex];
  if (
    sameRange(currentEntry.headingRange, command.headingRange)
    && sameRange(currentEntry.contentRange, command.contentRange)
  ) {
    return { effect: 'unchanged', bundle };
  }

  const canonicalBytes = exactBytes(bundle.canonical.text, 'canonical text');
  assertUtf8Range(canonicalBytes, command.headingRange, 'chapter heading');
  assertUtf8Range(canonicalBytes, command.contentRange, 'chapter content');
  const rawTitle = sliceText(canonicalBytes, command.headingRange);
  const normalizedTitle = rawTitle.trim();
  if (normalizedTitle.length === 0) {
    structureInvalid(
      'chapter_heading_empty',
      'The adjusted chapter heading must contain visible text.',
    );
  }

  const candidateIndex = bundle.chapterIndex.candidates.findIndex(candidate =>
    sameRange(candidate.headingRange, currentEntry.headingRange));
  if (candidateIndex < 0) {
    structureInvalid(
      'chapter_candidate_missing',
      'The adjusted chapter is not bound to a baseline candidate.',
    );
  }
  const headingLineRange = sourceLinesForRange(
    bundle,
    command.headingRange.startByte,
    command.headingRange.endByte,
  );
  const sourceLineRange = sourceLinesForRange(
    bundle,
    command.headingRange.startByte,
    command.contentRange.endByte,
  );
  const currentCandidate = bundle.chapterIndex.candidates[candidateIndex];
  const candidate: ChapterCandidateV1 = {
    ...currentCandidate,
    headingRange: command.headingRange,
    lineRange: headingLineRange,
    rawTitle,
    normalizedTitle,
    ruleId: MANUAL_BOUNDARY_RULE_ID,
    ruleVersion: MANUAL_BOUNDARY_RULE_VERSION,
    ruleConfidence: 1,
    confidenceSource: 'human-review',
    evidence: ['manual-review:chapter-boundary'],
    reviewStatus: 'approved',
  };
  const entry: ChapterIndexEntryV1 = {
    ...currentEntry,
    title: normalizedTitle,
    rawHeading: rawTitle,
    headingRange: command.headingRange,
    contentRange: command.contentRange,
    sourceLineRange,
    confidence: 1,
    detectedBy: `rule:${MANUAL_BOUNDARY_RULE_ID}@${MANUAL_BOUNDARY_RULE_VERSION}`,
    reviewStatus: 'approved',
  };
  const candidates = bundle.chapterIndex.candidates
    .map((value, index) => index === candidateIndex ? candidate : value)
    .sort((left, right) => compareRanges(left.headingRange, right.headingRange));
  const entries = bundle.chapterIndex.entries.map(
    (value, index) => index === entryIndex ? entry : value,
  );
  const coverageReport = adjustChapterCoverage(
    bundle.chapterIndex,
    currentEntry,
    entry,
  );
  const chapterIndex: ChapterIndexV1 = {
    ...bundle.chapterIndex,
    candidates,
    entries,
    coverageReport,
    reviewStatus: hasPendingReview(
      candidates,
      entries,
      bundle.chapterIndex.issues,
    )
      ? 'pending'
      : 'approved',
  };
  validateChapterIndex(chapterIndex);
  const selector = selectorForRanges(bundle, [
    combinedChapterRange(currentEntry),
    combinedChapterRange(entry),
  ], [command.chapterId]);
  return {
    effect: 'revision',
    bundle: finalizeRevisionBundle(
      bundle,
      { ...bundle, chapterCandidates: candidates, chapterIndex },
      command,
    ),
    changeSelector: selector,
  };
}

function adjustChapterCoverage(
  index: ChapterIndexV1,
  previousEntry: ChapterIndexEntryV1,
  currentEntry: ChapterIndexEntryV1,
): ChapterIndexV1['coverageReport'] {
  const segments = [...index.coverageReport.segments];
  const position = segments.findIndex(segment =>
    segment.classification === 'chapter'
    && segment.chapterId === previousEntry.chapterId);
  if (position < 0) {
    structureInvalid(
      'chapter_coverage_missing',
      'The adjusted chapter has no coverage segment.',
    );
  }
  const nextRange = combinedChapterRange(currentEntry);
  const before = segments[position - 1];
  const after = segments[position + 1];
  if (before === undefined && nextRange.startByte !== 0) {
    structureInvalid(
      'chapter_boundary_gap',
      'The first coverage segment must start at byte zero.',
    );
  }
  if (before?.classification === 'chapter'
    && before.range.endByte !== nextRange.startByte) {
    structureInvalid(
      'chapter_boundary_overlaps_adjacent_chapter',
      'A boundary adjustment cannot move an adjacent chapter implicitly.',
    );
  }
  if (after === undefined
    && nextRange.endByte !== index.coverageReport.totalByteLength) {
    structureInvalid(
      'chapter_boundary_gap',
      'The final coverage segment must reach the canonical revision end.',
    );
  }
  if (after?.classification === 'chapter'
    && after.range.startByte !== nextRange.endByte) {
    structureInvalid(
      'chapter_boundary_overlaps_adjacent_chapter',
      'A boundary adjustment cannot move an adjacent chapter implicitly.',
    );
  }
  if (before !== undefined && before.classification !== 'chapter') {
    if (nextRange.startByte < before.range.startByte) {
      structureInvalid('chapter_boundary_overlap', 'The adjusted chapter overlaps coverage.');
    }
    segments[position - 1] = {
      classification: before.classification,
      range: rangeLike(before.range, before.range.startByte, nextRange.startByte),
    };
  }
  segments[position] = {
    classification: 'chapter',
    chapterId: currentEntry.chapterId,
    range: nextRange,
  };
  if (after !== undefined && after.classification !== 'chapter') {
    if (nextRange.endByte > after.range.endByte) {
      structureInvalid('chapter_boundary_overlap', 'The adjusted chapter overlaps coverage.');
    }
    segments[position + 1] = {
      classification: after.classification,
      range: rangeLike(after.range, nextRange.endByte, after.range.endByte),
    };
  }
  return {
    ...index.coverageReport,
    segments: mergeCoverageSegments(segments.filter(segment =>
      rangeLength(segment.range) > 0)),
  };
}

function planNormalizationDecision(
  bundle: NovelImportBundleV1,
  command: Extract<
    NovelImportReviewCommandV1,
    { readonly commandType: 'decide-normalization-proposal' }
  >,
  createOpaqueId: () => string,
): ReviewCommandPlan {
  const proposal = bundle.normalization.proposals.find(
    item => item.proposalId === command.proposalId,
  );
  if (proposal === undefined) {
    structureInvalid(
      'normalization_proposal_not_found',
      'The normalization proposal does not exist in the baseline revision.',
    );
  }
  if (proposal.reviewStatus === command.decision) {
    return command.note === undefined
      ? { effect: 'unchanged', bundle }
      : { effect: 'metadata', bundle };
  }
  const proposals = bundle.normalization.proposals.map((item) => {
    if (item.proposalId === command.proposalId) {
      return command.decision === 'approved'
        ? {
            ...item,
            reviewStatus: 'approved' as const,
            reviewedBy: command.requestedBy,
            operator: `operator:${command.requestedBy}`,
          }
        : withoutOperator({
            ...item,
            reviewStatus: 'rejected' as const,
            reviewedBy: command.requestedBy,
          });
    }
    if (
      command.decision === 'approved'
      && proposal.conflictProposalIds.includes(item.proposalId)
    ) {
      return withoutOperator({
        ...item,
        reviewStatus: 'rejected' as const,
        reviewedBy: command.requestedBy,
      });
    }
    return item;
  });
  validateProposals(bundle, proposals);
  const selectedProposalIds = proposals
    .filter(item => item.reviewStatus === 'approved')
    .map(item => item.proposalId);
  const currentAppliedIds = bundle.normalization.result.changes.map(
    change => change.proposalId,
  );
  if (sameStringSet(selectedProposalIds, currentAppliedIds)) {
    return {
      effect: 'metadata',
      bundle: {
        ...bundle,
        normalization: { ...bundle.normalization, proposals },
      },
    };
  }
  const result = normalizeTextV1({
    canonicalTextRevision: bundle.canonical.revision,
    canonicalText: bundle.canonical.text,
    proposals,
    mode: 'apply',
    selectedProposalIds,
    normalizedTextRevisionId: nextOpaqueId(
      createOpaqueId,
      'normalized text revision',
    ),
  });
  if (!result.applied) {
    structureInvalid(
      'normalization_revision_not_materialized',
      'The normalization decision did not materialize a revision.',
    );
  }
  const ranges = proposals
    .filter(item => selectedProposalIds.includes(item.proposalId)
      || currentAppliedIds.includes(item.proposalId))
    .map(item => item.canonicalRange);
  const selector = selectorForRanges(bundle, ranges);
  const next = {
    ...bundle,
    normalization: { proposals, result },
  };
  return {
    effect: 'revision',
    bundle: finalizeRevisionBundle(bundle, next, command),
    changeSelector: selector,
  };
}

function applyContentNeutralNormalizationDecision(
  bundle: NovelImportBundleV1,
  command: Extract<
    NovelImportReviewCommandV1,
    { readonly commandType: 'decide-normalization-proposal' }
  >,
): NovelImportBundleV1 {
  const plan = planNormalizationDecision(bundle, command, () => {
    dependencyUnavailable(
      'review_metadata_changed_content',
      'Content-changing normalization cannot be stored as metadata.',
    );
  });
  if (plan.effect === 'revision') {
    dependencyUnavailable(
      'review_metadata_changed_content',
      'Stored review metadata would change normalized content.',
    );
  }
  return plan.bundle;
}

function finalizeRevisionBundle(
  baseline: NovelImportBundleV1,
  next: NovelImportBundleV1,
  command: NovelImportReviewCommandV1,
): NovelImportBundleV1 {
  assertBundleIdentity(next, baseline);
  const parameters: JsonValue = {
    schemaVersion: 1,
    baselineInputFingerprint: baseline.inputFingerprint,
    baselineParametersHash: baseline.parametersHash,
    baselineArtifactRevisionId: command.baselineRevision.artifactRevisionId,
    command: command as unknown as JsonValue,
    dependencySelector: next.dependencySelector as unknown as JsonValue,
  };
  const inputFingerprint = computeInputFingerprint({
    compatibilityVersion: REVIEW_INPUT_COMPATIBILITY_VERSION,
    dependencies: [],
    parameters,
    processorId: NOVEL_IMPORT_REVIEW_APPLICATION_PROCESSOR_ID,
    processorVersion: NOVEL_IMPORT_REVIEW_APPLICATION_PROCESSOR_VERSION,
    ruleVersions: { manualBoundary: MANUAL_BOUNDARY_RULE_VERSION },
  });
  const bundle: NovelImportBundleV1 = {
    ...next,
    inputFingerprint,
    parameters,
    parametersHash: sha256CanonicalJson(parameters),
  };
  validateBundleProjection(bundle);
  return bundle;
}

function assertBundleIdentity(
  value: NovelImportBundleV1,
  baseline: NovelImportBundleV1,
): void {
  if (
    value?.documentType !== 'novel-import-bundle'
    || value.schemaVersion !== NOVEL_IMPORT_BUNDLE_SCHEMA_VERSION
    || value.sourceAsset.sourceAssetId !== baseline.sourceAsset.sourceAssetId
    || value.sourceAsset.contentHash !== baseline.sourceAsset.contentHash
    || value.sourceByteLength !== baseline.sourceByteLength
    || !sameRevision(value.importedNovel.rawTextRevision, baseline.importedNovel.rawTextRevision)
    || !sameRevision(value.canonical.revision, baseline.canonical.revision)
    || value.canonical.text !== baseline.canonical.text
  ) {
    dependencyUnavailable(
      'rerun_bundle_identity_mismatch',
      'Review processing must preserve the immutable source and canonical revision.',
    );
  }
}

function sameBundleProjection(
  left: NovelImportBundleV1,
  right: NovelImportBundleV1,
): boolean {
  return sha256CanonicalJson({
    sourceAsset: left.sourceAsset,
    sourceByteLength: left.sourceByteLength,
    selectedEncoding: left.selectedEncoding,
    importWarnings: left.importWarnings,
    importedNovel: left.importedNovel,
    canonical: left.canonical,
    blockIndex: left.blockIndex,
    chapterCandidates: left.chapterCandidates,
    chapterIndex: left.chapterIndex,
    normalization: left.normalization,
    dependencySelector: left.dependencySelector,
  } as unknown as JsonValue) === sha256CanonicalJson({
    sourceAsset: right.sourceAsset,
    sourceByteLength: right.sourceByteLength,
    selectedEncoding: right.selectedEncoding,
    importWarnings: right.importWarnings,
    importedNovel: right.importedNovel,
    canonical: right.canonical,
    blockIndex: right.blockIndex,
    chapterCandidates: right.chapterCandidates,
    chapterIndex: right.chapterIndex,
    normalization: right.normalization,
    dependencySelector: right.dependencySelector,
  } as unknown as JsonValue);
}

function assertRerunScoped(
  baseline: NovelImportBundleV1,
  rerun: NovelImportBundleV1,
  selector: NovelImportChangeSelectorV1,
): void {
  for (const [label, left, right] of [
    ['source asset', baseline.sourceAsset, rerun.sourceAsset],
    ['encoding decision', baseline.selectedEncoding, rerun.selectedEncoding],
    ['import warnings', baseline.importWarnings, rerun.importWarnings],
    ['imported source', baseline.importedNovel, rerun.importedNovel],
    ['canonical projection', baseline.canonical, rerun.canonical],
  ] as const) {
    if (!sameJson(left, right)) {
      structureInvalid(
        'rerun_changed_immutable_projection',
        `Selected-range rerun changed the immutable ${label}.`,
      );
    }
  }
  const selectedBlockIds = new Set(selector.blockIds ?? []);
  const selectedChapterIds = new Set(selector.chapterIds ?? []);
  const selectedRanges = [
    ...baseline.blockIndex.blocks
      .filter(block => selectedBlockIds.has(block.blockId))
      .map(block => block.canonicalRange),
    ...baseline.chapterIndex.entries
      .filter(chapter => selectedChapterIds.has(chapter.chapterId))
      .map(combinedChapterRange),
  ];
  assertCoverageScoped(
    baseline.chapterIndex.coverageReport,
    rerun.chapterIndex.coverageReport,
    selectedRanges,
  );
  assertUnrangedIssuesUnchanged(
    baseline.blockIndex.issues,
    rerun.blockIndex.issues,
  );
  assertIssueCollectionScoped(
    baseline.chapterIndex.issues,
    rerun.chapterIndex.issues,
    selectedRanges,
  );
  const baselineBlocks = new Map(
    baseline.blockIndex.blocks.map(block => [block.blockId, block]),
  );
  for (const block of rerun.blockIndex.blocks) {
    if (
      !rangeIntersectsAny(block.canonicalRange, selectedRanges)
      && !sameJson(block, baselineBlocks.get(block.blockId))
    ) {
      structureInvalid(
        'rerun_changed_unselected_block',
        'Selected-range rerun changed an unselected block.',
      );
    }
  }
  const rerunBlocks = new Map(rerun.blockIndex.blocks.map(block => [block.blockId, block]));
  for (const block of baseline.blockIndex.blocks) {
    if (
      !rangeIntersectsAny(block.canonicalRange, selectedRanges)
      && !rerunBlocks.has(block.blockId)
    ) {
      structureInvalid(
        'rerun_changed_unselected_block',
        'Selected-range rerun removed an unselected block.',
      );
    }
  }

  assertCandidateCollectionScoped(
    baseline.chapterCandidates,
    rerun.chapterCandidates,
    selectedRanges,
  );
  assertCandidateCollectionScoped(
    baseline.chapterIndex.candidates,
    rerun.chapterIndex.candidates,
    selectedRanges,
  );

  const baselineChapters = new Map(
    baseline.chapterIndex.entries.map(chapter => [chapter.chapterId, chapter]),
  );
  for (const chapter of rerun.chapterIndex.entries) {
    if (
      !selectedChapterIds.has(chapter.chapterId)
      && !rangeIntersectsAny(combinedChapterRange(chapter), selectedRanges)
      && !sameJson(chapter, baselineChapters.get(chapter.chapterId))
    ) {
      structureInvalid(
        'rerun_changed_unselected_chapter',
        'Selected-range rerun changed an unselected chapter.',
      );
    }
  }
  const rerunChapters = new Map(
    rerun.chapterIndex.entries.map(chapter => [chapter.chapterId, chapter]),
  );
  for (const chapter of baseline.chapterIndex.entries) {
    if (
      !selectedChapterIds.has(chapter.chapterId)
      && !rangeIntersectsAny(combinedChapterRange(chapter), selectedRanges)
      && !rerunChapters.has(chapter.chapterId)
    ) {
      structureInvalid(
        'rerun_changed_unselected_chapter',
        'Selected-range rerun removed an unselected chapter.',
      );
    }
  }
  const baselineProposals = new Map(
    baseline.normalization.proposals.map(proposal => [proposal.proposalId, proposal]),
  );
  for (const proposal of rerun.normalization.proposals) {
    if (
      !rangeIntersectsAny(proposal.canonicalRange, selectedRanges)
      && !sameJson(proposal, baselineProposals.get(proposal.proposalId))
    ) {
      structureInvalid(
        'rerun_changed_unselected_normalization',
        'Selected-range rerun changed an unselected normalization proposal.',
      );
    }
  }
  const rerunProposals = new Map(
    rerun.normalization.proposals.map(proposal => [proposal.proposalId, proposal]),
  );
  for (const proposal of baseline.normalization.proposals) {
    if (
      !rangeIntersectsAny(proposal.canonicalRange, selectedRanges)
      && !rerunProposals.has(proposal.proposalId)
    ) {
      structureInvalid(
        'rerun_changed_unselected_normalization',
        'Selected-range rerun removed an unselected normalization proposal.',
      );
    }
  }
}

function assertCoverageScoped(
  baseline: ChapterIndexV1['coverageReport'],
  rerun: ChapterIndexV1['coverageReport'],
  selectedRanges: readonly TextRangeV1[],
): void {
  const boundaries = uniqueNumbers([
    0,
    baseline.totalByteLength,
    rerun.totalByteLength,
    ...coverageRanges(baseline).flatMap(range => [range.startByte, range.endByte]),
    ...coverageRanges(rerun).flatMap(range => [range.startByte, range.endByte]),
    ...selectedRanges.flatMap(range => [range.startByte, range.endByte]),
  ]).sort((left, right) => left - right);
  const template = baseline.segments[0]?.range
    ?? baseline.unclassifiedRanges[0]
    ?? selectedRanges[0];
  if (template === undefined) {
    if (!sameJson(baseline, rerun)) {
      structureInvalid(
        'rerun_changed_unselected_coverage',
        'Selected-range rerun changed coverage outside the selection.',
      );
    }
    return;
  }
  for (let index = 1; index < boundaries.length; index += 1) {
    const startByte = boundaries[index - 1];
    const endByte = boundaries[index];
    if (startByte === endByte)
      continue;
    const slice = rangeLike(template, startByte, endByte);
    if (rangeIntersectsAny(slice, selectedRanges))
      continue;
    if (
      coverageLabelAt(baseline, startByte, endByte)
      !== coverageLabelAt(rerun, startByte, endByte)
    ) {
      structureInvalid(
        'rerun_changed_unselected_coverage',
        'Selected-range rerun changed coverage outside the selection.',
      );
    }
  }
}

function coverageRanges(
  report: ChapterIndexV1['coverageReport'],
): readonly TextRangeV1[] {
  return [
    ...report.segments.map(segment => segment.range),
    ...report.unclassifiedRanges,
  ];
}

function coverageLabelAt(
  report: ChapterIndexV1['coverageReport'],
  startByte: number,
  endByte: number,
): string {
  const segment = report.segments.find(item =>
    item.range.startByte <= startByte && endByte <= item.range.endByte);
  if (segment !== undefined) {
    return segment.classification === 'chapter'
      ? `chapter:${segment.chapterId}`
      : segment.classification;
  }
  const unclassified = report.unclassifiedRanges.some(range =>
    range.startByte <= startByte && endByte <= range.endByte);
  return unclassified ? 'unclassified' : 'missing';
}

function assertUnrangedIssuesUnchanged(
  baseline: NovelImportBundleV1['blockIndex']['issues'],
  rerun: NovelImportBundleV1['blockIndex']['issues'],
): void {
  if (!sameJson(baseline, rerun)) {
    structureInvalid(
      'rerun_changed_unselected_issue',
      'Selected-range rerun changed an issue without a text range.',
    );
  }
}

function assertIssueCollectionScoped(
  baseline: ChapterIndexV1['issues'],
  rerun: ChapterIndexV1['issues'],
  selectedRanges: readonly TextRangeV1[],
): void {
  const baselineIssues = new Map(baseline.map(issue => [issue.issueId, issue]));
  const rerunIssues = new Map(rerun.map(issue => [issue.issueId, issue]));
  for (const issue of rerun) {
    const previous = baselineIssues.get(issue.issueId);
    if (previous === undefined) {
      if (!issueIntersectsSelection(issue, selectedRanges))
        changedUnselectedIssue();
      continue;
    }
    if (
      !sameJson(previous, issue)
      && (
        !issueIntersectsSelection(previous, selectedRanges)
        || !issueIntersectsSelection(issue, selectedRanges)
      )
    ) {
      changedUnselectedIssue();
    }
  }
  for (const issue of baseline) {
    if (
      !rerunIssues.has(issue.issueId)
      && !issueIntersectsSelection(issue, selectedRanges)
    ) {
      changedUnselectedIssue();
    }
  }
}

function issueIntersectsSelection(
  issue: ChapterIndexV1['issues'][number],
  selectedRanges: readonly TextRangeV1[],
): boolean {
  return issue.textRange !== undefined
    && rangeIntersectsAny(issue.textRange, selectedRanges);
}

function changedUnselectedIssue(): never {
  structureInvalid(
    'rerun_changed_unselected_issue',
    'Selected-range rerun changed an issue outside the selection.',
  );
}

function assertCandidateCollectionScoped(
  baseline: readonly ChapterCandidateV1[],
  rerun: readonly ChapterCandidateV1[],
  selectedRanges: readonly TextRangeV1[],
): void {
  const baselineCandidates = new Map(
    baseline.map(candidate => [candidate.chapterCandidateId, candidate]),
  );
  for (const candidate of rerun) {
    if (
      !rangeIntersectsAny(candidate.headingRange, selectedRanges)
      && !sameJson(
        candidate,
        baselineCandidates.get(candidate.chapterCandidateId),
      )
    ) {
      structureInvalid(
        'rerun_changed_unselected_candidate',
        'Selected-range rerun changed an unselected chapter candidate.',
      );
    }
  }
  const rerunCandidates = new Map(
    rerun.map(candidate => [candidate.chapterCandidateId, candidate]),
  );
  for (const candidate of baseline) {
    if (
      !rangeIntersectsAny(candidate.headingRange, selectedRanges)
      && !rerunCandidates.has(candidate.chapterCandidateId)
    ) {
      structureInvalid(
        'rerun_changed_unselected_candidate',
        'Selected-range rerun removed an unselected chapter candidate.',
      );
    }
  }
}

function assertSelectorTargetsExist(
  bundle: NovelImportBundleV1,
  selector: NovelImportChangeSelectorV1,
): void {
  const blockIds = new Set(bundle.blockIndex.blocks.map(block => block.blockId));
  for (const blockId of selector.blockIds ?? []) {
    if (!blockIds.has(blockId)) {
      structureInvalid(
        'rerun_selector_block_unknown',
        'Selected-range rerun references an unknown block ID.',
      );
    }
  }
  const chapterIds = new Set(
    bundle.chapterIndex.entries.map(chapter => chapter.chapterId),
  );
  for (const chapterId of selector.chapterIds ?? []) {
    if (!chapterIds.has(chapterId)) {
      structureInvalid(
        'rerun_selector_chapter_unknown',
        'Selected-range rerun references an unknown chapter ID.',
      );
    }
  }
}

function rangeIntersectsAny(
  range: TextRangeV1,
  selectedRanges: readonly TextRangeV1[],
): boolean {
  return selectedRanges.some(selected => rangesOverlap(range, selected));
}

function sameJson(left: unknown, right: unknown): boolean {
  if (right === undefined)
    return false;
  return sha256CanonicalJson(left as JsonValue)
    === sha256CanonicalJson(right as JsonValue);
}

function selectorForRanges(
  bundle: NovelImportBundleV1,
  ranges: readonly TextRangeV1[],
  explicitChapterIds: readonly string[] = [],
): ArtifactSelector {
  const blockIds = bundle.blockIndex.blocks
    .filter(block => ranges.some(range => rangesOverlap(block.canonicalRange, range)))
    .map(block => block.blockId);
  const chapterIds = uniqueStrings([
    ...explicitChapterIds,
    ...bundle.chapterIndex.entries
      .filter(entry => ranges.some(range =>
        rangesOverlap(combinedChapterRange(entry), range)))
      .map(entry => entry.chapterId),
  ]);
  if (blockIds.length === 0 && chapterIds.length === 0) {
    structureInvalid(
      'change_selector_empty',
      'The review change does not intersect a stable block or chapter.',
    );
  }
  return {
    ...(blockIds.length === 0 ? {} : { blockIds: uniqueStrings(blockIds) }),
    ...(chapterIds.length === 0 ? {} : { chapterIds }),
  };
}

function toArtifactSelector(selector: NovelImportChangeSelectorV1): ArtifactSelector {
  return {
    ...(selector.blockIds === undefined ? {} : { blockIds: [...selector.blockIds] }),
    ...(selector.chapterIds === undefined
      ? {}
      : { chapterIds: [...selector.chapterIds] }),
  };
}

function buildSnapshot(
  artifact: ArtifactRecord,
  bundle: NovelImportBundleV1,
  history: readonly NovelImportReviewRevisionEntry[],
  readOnly: boolean,
): NovelImportReviewSnapshotV1 {
  validateBundleProjection(bundle);
  const baselineRevision: NovelImportReviewBaselineV1 = {
    artifactId: artifact.artifactId,
    artifactRevisionId: artifact.revisionId,
    canonicalTextRevision: bundle.canonical.revision,
  };
  const rawRevision = bundle.importedNovel.rawTextRevision;
  const canonicalRevision = bundle.canonical.revision;
  const normalizedRevision = bundle.normalization.result.normalizedTextRevision;
  const snapshot: NovelImportReviewSnapshotV1 = {
    documentType: 'novel-import-review-snapshot',
    schemaVersion: NOVEL_IMPORT_REVIEW_SCHEMA_VERSION,
    readOnly,
    baselineRevision,
    source: {
      sourceAssetId: bundle.sourceAsset.sourceAssetId,
      format: 'txt',
      byteLength: bundle.sourceByteLength,
      contentHash: bundle.sourceAsset.contentHash,
      encoding: bundle.selectedEncoding.sourceEncoding,
    },
    adapter: {
      adapterId: bundle.importedNovel.adapterId,
      adapterVersion: bundle.importedNovel.adapterVersion,
      selectionMethod: bundle.selectedEncoding.method === 'user'
        ? 'explicit'
        : 'probe',
    },
    textRevisions: [rawRevision, canonicalRevision, normalizedRevision],
    layerDiffs: buildLayerDiffs(bundle),
    chapterCandidates: bundle.chapterIndex.candidates,
    chapters: bundle.chapterIndex.entries,
    tableOfContentsEvidence: buildTableOfContentsEvidence(bundle),
    coverage: bundle.chapterIndex.coverageReport,
    issues: mergeIssues(bundle),
    uncoveredRanges: bundle.chapterIndex.coverageReport.unclassifiedRanges.map(
      range => ({
        range: range as TextRangeV1 & { readonly textLayer: 'canonical' },
        suggestedClassification: 'unknown' as const,
        reviewStatus: 'pending' as const,
      }),
    ),
    revisionHistory: buildRevisionHistory(history, artifact, bundle),
    normalizationProposals: bundle.normalization.proposals,
  };
  try {
    return parseNovelImportReviewSnapshotV1(snapshot);
  } catch {
    dependencyUnavailable(
      'review_snapshot_projection_invalid',
      'The novel import review snapshot projection is invalid.',
    );
  }
}

function buildLayerDiffs(
  bundle: NovelImportBundleV1,
): NovelImportReviewSnapshotV1['layerDiffs'] {
  const rawText = bundle.importedNovel.orderedBlocks.map(block => block.rawText).join('');
  const rawBytes = exactBytes(rawText, 'raw text');
  const canonicalBytes = exactBytes(bundle.canonical.text, 'canonical text');
  const rawToCanonical: NovelImportLayerDiffHunkV1[] = bundle
    .canonical
    .rawToCanonicalRangeMap
    .segments
    .filter(segment => segment.operation !== 'identity')
    .map(segment => ({
      operation: segment.operation as NovelImportLayerDiffOperationV1,
      fromRange: segment.inputRange,
      toRange: segment.outputRange,
      beforeText: sliceText(rawBytes, segment.inputRange),
      afterText: sliceText(canonicalBytes, segment.outputRange),
    }));
  const canonicalToNormalized: NovelImportLayerDiffHunkV1[]
    = bundle.normalization.result.changes.map(change => ({
      operation: change.operation,
      fromRange: change.canonicalRange,
      toRange: change.normalizedRange,
      beforeText: change.beforeText,
      afterText: change.afterText,
    }));
  return [
    {
      fromRevision: bundle.importedNovel.rawTextRevision,
      toRevision: bundle.canonical.revision,
      hunks: rawToCanonical,
    },
    {
      fromRevision: bundle.canonical.revision,
      toRevision: bundle.normalization.result.normalizedTextRevision,
      hunks: canonicalToNormalized,
    },
  ];
}

function buildTableOfContentsEvidence(
  bundle: NovelImportBundleV1,
): NovelImportReviewSnapshotV1['tableOfContentsEvidence'] {
  return bundle.chapterIndex.candidates
    .filter(candidate => candidate.evidence.includes(
      'directory-context:after-marker-before-explicit-boundary',
    ))
    .map(candidate => ({
      evidenceId: candidate.chapterCandidateId,
      kind: 'candidate-sequence' as const,
      range: candidate.headingRange as TextRangeV1 & {
        readonly textLayer: 'canonical';
      },
      rawText: candidate.rawTitle,
      candidateIds: [candidate.chapterCandidateId],
      confidence: candidate.ruleConfidence,
      reviewStatus: candidate.reviewStatus,
    }));
}

function mergeIssues(bundle: NovelImportBundleV1): NovelImportReviewSnapshotV1['issues'] {
  const byId = new Map<string, NovelImportReviewSnapshotV1['issues'][number]>();
  for (const issue of [...bundle.importWarnings, ...bundle.chapterIndex.issues])
    byId.set(issue.issueId, issue);
  return [...byId.values()];
}

function buildRevisionHistory(
  history: readonly NovelImportReviewRevisionEntry[],
  currentArtifact: ArtifactRecord,
  currentBundle: NovelImportBundleV1,
): readonly NovelImportRevisionHistoryEntryV1[] {
  const byRevision = new Map(history.map(entry => [
    entry.artifact.revisionId,
    entry,
  ]));
  byRevision.set(currentArtifact.revisionId, {
    artifact: currentArtifact,
    bundle: currentBundle,
  });
  return [...byRevision.values()]
    .sort((left, right) => compareStrings(
      left.artifact.createdAt,
      right.artifact.createdAt,
    ) || compareStrings(left.artifact.revisionId, right.artifact.revisionId))
    .map(entry => ({
      artifactId: entry.artifact.artifactId,
      artifactRevisionId: entry.artifact.revisionId,
      sourceAssetId: entry.bundle.sourceAsset.sourceAssetId,
      sourceHash: entry.bundle.sourceAsset.contentHash,
      processorId: entry.artifact.processorId,
      processorVersion: entry.artifact.processorVersion,
      rawTextRevision: entry.bundle.importedNovel.rawTextRevision,
      canonicalTextRevision: entry.bundle.canonical.revision,
      normalizedTextRevision:
        entry.bundle.normalization.result.normalizedTextRevision,
      active: entry.artifact.revisionId === currentArtifact.revisionId,
    }));
}

function appendHistory(
  history: readonly NovelImportReviewRevisionEntry[],
  artifact: ArtifactRecord,
  bundle: NovelImportBundleV1,
): readonly NovelImportReviewRevisionEntry[] {
  return [
    ...history.filter(entry => entry.artifact.revisionId !== artifact.revisionId),
    { artifact, bundle },
  ];
}

function sourceLinesForRange(
  bundle: NovelImportBundleV1,
  startByte: number,
  endByte: number,
): ChapterIndexEntryV1['sourceLineRange'] {
  const blocks = bundle.blockIndex.blocks.filter(block =>
    block.canonicalRange.startByte < endByte
    && block.canonicalRange.endByte > startByte);
  if (blocks.length === 0) {
    structureInvalid(
      'chapter_source_locator_missing',
      'The adjusted chapter range has no source-backed block.',
    );
  }
  return {
    lineBase: 1,
    startLine: Math.min(...blocks.map(
      block => block.sourceLocator.lineRange.startLine,
    )),
    endLineExclusive: Math.max(...blocks.map(
      block => block.sourceLocator.lineRange.endLineExclusive,
    )),
  };
}

function validateChapterIndex(index: ChapterIndexV1): void {
  try {
    parseChapterIndexV1(index);
    validateChapterIndexDomainV1(index);
  } catch {
    structureInvalid(
      'chapter_adjustment_invalid',
      'The requested review change violates ChapterIndex invariants.',
    );
  }
}

function validateProposals(
  bundle: NovelImportBundleV1,
  proposals: NovelImportBundleV1['normalization']['proposals'],
): void {
  try {
    validateNormalizationProposalsV1({
      canonicalTextRevision: bundle.canonical.revision,
      canonicalText: bundle.canonical.text,
      proposals,
    });
  } catch {
    structureInvalid(
      'normalization_decision_invalid',
      'The normalization decision violates proposal invariants.',
    );
  }
}

function withoutOperator<T extends { readonly operator?: string }>(
  value: T,
): Omit<T, 'operator'> {
  const { operator: _operator, ...result } = value;
  return result;
}

function hasPendingReview(
  candidates: readonly ChapterCandidateV1[],
  entries: readonly ChapterIndexEntryV1[],
  issues: ChapterIndexV1['issues'],
): boolean {
  return candidates.some(item => item.reviewStatus === 'pending')
    || entries.some(item => item.reviewStatus === 'pending')
    || issues.some(item => item.reviewStatus === 'pending');
}

function bundleRequiresReview(bundle: NovelImportBundleV1): boolean {
  return bundle.importWarnings.some(item => item.reviewStatus === 'pending')
    || bundle.chapterIndex.reviewStatus === 'pending'
    || bundle.normalization.proposals.some(item => item.reviewStatus === 'pending');
}

function mergeCoverageSegments(
  values: readonly CoverageSegmentV1[],
): readonly CoverageSegmentV1[] {
  const sorted = [...values].sort((left, right) => compareRanges(
    left.range,
    right.range,
  ));
  const result: CoverageSegmentV1[] = [];
  for (const segment of sorted) {
    const previous = result[result.length - 1];
    if (
      previous !== undefined
      && previous.classification !== 'chapter'
      && segment.classification !== 'chapter'
      && previous.classification === segment.classification
      && previous.range.endByte === segment.range.startByte
    ) {
      result[result.length - 1] = {
        classification: previous.classification,
        range: rangeLike(
          previous.range,
          previous.range.startByte,
          segment.range.endByte,
        ),
      };
    } else {
      result.push(segment);
    }
  }
  return result;
}

function appendNonEmptyRange(
  target: TextRangeV1[],
  template: TextRangeV1,
  startByte: number,
  endByte: number,
): void {
  if (startByte < endByte)
    target.push(rangeLike(template, startByte, endByte));
}

function combinedChapterRange(entry: ChapterIndexEntryV1): TextRangeV1 {
  return rangeLike(
    entry.headingRange,
    entry.headingRange.startByte,
    entry.contentRange.endByte,
  );
}

function containsRange(container: TextRangeV1, candidate: TextRangeV1): boolean {
  return sameRangeRevision(container, candidate)
    && container.startByte <= candidate.startByte
    && candidate.endByte <= container.endByte;
}

function rangesOverlap(left: TextRangeV1, right: TextRangeV1): boolean {
  return sameRangeRevision(left, right)
    && left.startByte < right.endByte
    && right.startByte < left.endByte;
}

function sameRange(left: TextRangeV1, right: TextRangeV1): boolean {
  return sameRangeRevision(left, right)
    && left.startByte === right.startByte
    && left.endByte === right.endByte;
}

function sameRangeRevision(left: TextRangeV1, right: TextRangeV1): boolean {
  return left.textRevisionId === right.textRevisionId
    && left.textLayer === right.textLayer
    && left.offsetUnit === right.offsetUnit;
}

function rangeLike(
  template: TextRangeV1,
  startByte: number,
  endByte: number,
): TextRangeV1 {
  return { ...template, startByte, endByte };
}

function rangeLength(range: TextRangeV1): number {
  return range.endByte - range.startByte;
}

function compareRanges(left: TextRangeV1, right: TextRangeV1): number {
  return left.startByte - right.startByte
    || left.endByte - right.endByte
    || compareStrings(left.textRevisionId, right.textRevisionId);
}

function assertUtf8Range(
  bytes: Uint8Array,
  range: TextRangeV1,
  label: string,
): void {
  if (
    range.startByte < 0
    || range.endByte > bytes.byteLength
    || !isUtf8Boundary(bytes, range.startByte)
    || !isUtf8Boundary(bytes, range.endByte)
  ) {
    structureInvalid(
      'review_range_invalid',
      `The ${label} range must use canonical UTF-8 scalar boundaries.`,
    );
  }
}

function isUtf8Boundary(bytes: Uint8Array, offset: number): boolean {
  if (offset === 0 || offset === bytes.byteLength)
    return true;
  const byte = bytes[offset];
  return byte !== undefined && (byte & 0b1100_0000) !== 0b1000_0000;
}

function exactBytes(value: string, label: string): Buffer {
  if (typeof value !== 'string') {
    dependencyUnavailable(
      'bundle_text_invalid',
      `The ${label} must be a string.`,
    );
  }
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.toString('utf8') !== value) {
    dependencyUnavailable(
      'bundle_text_invalid',
      `The ${label} must be exact UTF-8 text.`,
    );
  }
  return bytes;
}

function sliceText(bytes: Uint8Array, range: TextRangeV1): string {
  assertUtf8Range(bytes, range, 'text diff');
  const slice = Buffer.from(bytes).subarray(range.startByte, range.endByte);
  const text = slice.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(slice)) {
    dependencyUnavailable(
      'bundle_text_invalid',
      'A novel import text range does not contain exact UTF-8 bytes.',
    );
  }
  return text;
}

function sameRevision(
  left: TextRevisionRefV1,
  right: TextRevisionRefV1,
): boolean {
  return left.textRevisionId === right.textRevisionId
    && left.textLayer === right.textLayer
    && left.contentHash === right.contentHash
    && left.byteLength === right.byteLength;
}

function sameBaseline(
  left: NovelImportReviewBaselineV1,
  right: NovelImportReviewBaselineV1,
): boolean {
  return left.artifactId === right.artifactId
    && left.artifactRevisionId === right.artifactRevisionId
    && sameRevision(left.canonicalTextRevision, right.canonicalTextRevision);
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length)
    return false;
  const values = new Set(left);
  return right.every(value => values.has(value));
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function uniqueNumbers(values: readonly number[]): number[] {
  return [...new Set(values)];
}

function compareStrings(left: string, right: string): number {
  if (left < right)
    return -1;
  if (left > right)
    return 1;
  return 0;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function assertImpactPreview(
  impact: Awaited<ReturnType<ProjectWorkflowPort['previewArtifactImpact']>>,
  query: NovelImportStalePreviewQueryV1,
): void {
  if (
    impact?.producerArtifactId !== query.baselineRevision.artifactId
    || typeof impact.producerRevisionId !== 'string'
    || !sameSelector(impact.changeSelector, query.changeSelector)
    || !Array.isArray(impact.impacts)
  ) {
    dependencyUnavailable(
      'impact_preview_projection_invalid',
      'The workflow returned an invalid impact preview projection.',
    );
  }
  for (const item of impact.impacts) {
    if (
      !Number.isSafeInteger(item.depth)
      || item.depth < 1
      || (item.depth === 1
        && (
          item.producerArtifactId !== query.baselineRevision.artifactId
          || item.producerRevisionId !== impact.producerRevisionId
        ))
    ) {
      dependencyUnavailable(
        'impact_preview_projection_invalid',
        'The workflow returned an invalid impact item projection.',
      );
    }
  }
}

function sameSelector(
  left: ArtifactSelector | undefined,
  right: ArtifactSelector,
): boolean {
  if (left === undefined)
    return false;
  return sameOptionalStrings(left.blockIds, right.blockIds)
    && sameOptionalStrings(left.chapterIds, right.chapterIds)
    && sameOptionalStrings(left.scriptUnitIds, right.scriptUnitIds)
    && sameOptionalStrings(left.voiceProfileIds, right.voiceProfileIds)
    && sameOptionalStrings(left.dictionaryEntryIds, right.dictionaryEntryIds);
}

function sameOptionalStrings(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  if (left === undefined || right === undefined)
    return left === right;
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function assertMetadataSave(
  result: NovelImportReviewMetadataSaveResult,
  baseline: NovelImportReviewBaselineV1,
): void {
  if (
    result?.status === 'conflict'
    || result?.currentArtifactRevisionId !== baseline.artifactRevisionId
  ) {
    baselineConflict(result?.currentArtifactRevisionId);
  }
  if (result.status !== 'saved') {
    dependencyUnavailable(
      'review_metadata_result_invalid',
      'The review metadata store returned an invalid result.',
    );
  }
}

function assertStaged(
  result: StageNovelImportReviewBundleResult,
  baseline: NovelImportReviewBaselineV1,
): NovelImportReviewTemporaryArtifact {
  if (
    result?.status === 'conflict'
    || result?.currentArtifactRevisionId !== baseline.artifactRevisionId
  ) {
    baselineConflict(result?.currentArtifactRevisionId);
  }
  if (result.status !== 'staged') {
    dependencyUnavailable(
      'review_stage_result_invalid',
      'The review artifact store returned an invalid staging result.',
    );
  }
  const outputDirectory = result.artifact?.outputDirectory;
  if (
    typeof outputDirectory !== 'string'
    || outputDirectory.length === 0
    || outputDirectory.startsWith('/')
    || outputDirectory.split('/').some(segment =>
      segment.length === 0 || segment === '.' || segment === '..')
    || !outputDirectory.startsWith('tmp/')
  ) {
    dependencyUnavailable(
      'review_stage_path_invalid',
      'The staged review artifact must remain below project tmp/.',
    );
  }
  return result.artifact;
}

function toDependencyInput(dependency: ArtifactDependency): {
  readonly dependencyType: ArtifactDependency['dependencyType'];
  readonly producerArtifactId: string;
  readonly producerRevisionId: string;
  readonly selector?: ArtifactSelector;
} {
  return {
    dependencyType: dependency.dependencyType,
    producerArtifactId: dependency.producerArtifactId,
    producerRevisionId: dependency.producerRevisionId,
    ...(dependency.selector === undefined ? {} : { selector: dependency.selector }),
  };
}

function assertCommittedArtifact(
  artifact: ArtifactRecord,
  baseline: ArtifactRecord,
  bundle: NovelImportBundleV1,
  revisionId: string,
  expectedCreatedBy: string,
): void {
  try {
    parseArtifactRecord(artifact);
  } catch {
    dependencyUnavailable(
      'committed_review_artifact_mismatch',
      'The committed review artifact projection is invalid.',
    );
  }
  const expectedReviewStatus = bundleRequiresReview(bundle)
    ? 'pending'
    : 'not_required';
  if (
    artifact?.artifactId !== baseline.artifactId
    || artifact.artifactType !== baseline.artifactType
    || artifact.lineageId !== baseline.lineageId
    || artifact.revisionId !== revisionId
    || artifact.inputFingerprint !== bundle.inputFingerprint
    || artifact.parametersHash !== bundle.parametersHash
    || artifact.processorId !== NOVEL_IMPORT_REVIEW_APPLICATION_PROCESSOR_ID
    || artifact.processorVersion
    !== NOVEL_IMPORT_REVIEW_APPLICATION_PROCESSOR_VERSION
    || artifact.executionStatus !== 'succeeded'
    || artifact.validityStatus !== 'current'
    || artifact.reviewStatus !== expectedReviewStatus
    || artifact.createdBy !== expectedCreatedBy
    || artifact.storageKind !== baseline.storageKind
    || artifact.contentPath
    !== `artifacts/${artifact.storageKind}/${revisionId}/content`
    || !sameScope(artifact.scope, baseline.scope)
  ) {
    dependencyUnavailable(
      'committed_review_artifact_mismatch',
      'The committed review artifact does not match its validated projection.',
    );
  }
}

function sameScope(
  left: ArtifactRecord['scope'],
  right: ArtifactRecord['scope'],
): boolean {
  return left.kind === right.kind
    && left.identifiers.length === right.identifiers.length
    && left.identifiers.every((value, index) => value === right.identifiers[index]);
}

function nextOpaqueId(factory: () => string, label: string): string {
  const value = factory();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) {
    dependencyUnavailable(
      'opaque_id_invalid',
      `The generated ${label} ID is invalid.`,
    );
  }
  return value;
}

function baselineConflict(currentRevisionId: string | undefined): never {
  throw new NovelImportReviewApplicationError(
    'NOVEL_IMPORT_REVIEW_REQUIRED',
    'baseline_revision_stale',
    currentRevisionId === undefined
      ? 'The review baseline is no longer current.'
      : 'The review baseline changed before the operation could be committed.',
  );
}

function structureInvalid(detailReason: string, message: string): never {
  throw new NovelImportReviewApplicationError(
    'NOVEL_IMPORT_STRUCTURE_INVALID',
    detailReason,
    message,
  );
}

function dependencyUnavailable(detailReason: string, message: string): never {
  throw new NovelImportReviewApplicationError(
    'NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE',
    detailReason,
    message,
  );
}
