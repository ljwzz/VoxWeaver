/// <reference types="node" />

import type {
  ArtifactDependency,
  ArtifactRecord,
  ArtifactSelector,
  ChapterCandidateV1,
  ChapterIndexV1,
  ImportedNovelV1,
  ImportIssueV1,
  JsonValue,
  NovelImportErrorCode,
  NovelImportReviewBaselineV1,
  ProjectContext,
  SourceAssetRecord,
  TaskRecord,
  TextRangeMapV1,
  TextRevisionRefV1,
  UserSelectedTxtSourceEncoding,
} from '@voxweaver/contracts';
import type {
  DocumentBlockIndexV1,
  NovelReimportPlanV1,
} from '@voxweaver/novel-domain';
import type {
  NovelSourceAdapter,
  NovelSourceAsset,
} from '@voxweaver/novel-import';
import type {
  NormalizationApplyResultV1,
  NormalizationProposalV1,
} from '@voxweaver/text-pipeline';
import type {
  EnqueueTaskResult,
  NovelImportImpactSelectorV1,
  ProjectWorkflowPort,
  SourceAssetCommitPort,
} from '@voxweaver/workflow-core';
import type { ProjectApplicationService } from './projectApplicationService.js';
import type { ProjectSessionIdentity } from './projectWorkflowApplicationService.js';

import { randomUUID } from 'node:crypto';

import {
  BLOCK_ALIGNMENT_POLICY_VERSION,
  NOVEL_IMPORT_ERROR_CODES,
  parseTextRevisionRefV1,
  TXT_SOURCE_ENCODINGS,
} from '@voxweaver/contracts';
import {
  buildNovelReimportPlanV1,
  DOCUMENT_BLOCK_INDEX_SCHEMA_VERSION,
} from '@voxweaver/novel-domain';
import {
  TXT_IMPORT_PROCESSOR_ID,
  TXT_IMPORT_PROCESSOR_VERSION,
  TXT_SOURCE_ADAPTER_ID,
  TXT_SOURCE_ADAPTER_VERSION,
} from '@voxweaver/novel-import';
import {
  buildChapterIndexV1,
  buildDocumentBlockIndexV1,
  CANONICAL_RULE_VERSION,
  CANONICALIZER_PROCESSOR_ID,
  CANONICALIZER_PROCESSOR_VERSION,
  canonicalizeRawTextV1,
  CHAPTER_CONFIDENCE_FORMULA_VERSION,
  CHAPTER_HEADING_RULE_VERSION,
  CHAPTER_INDEX_PROCESSOR_ID,
  CHAPTER_INDEX_PROCESSOR_VERSION,
  detectChapterCandidatesV1,
  discoverNormalizationProposalsV1,
  NORMALIZATION_PROPOSER_ID,
  NORMALIZATION_RULE_VERSION,
  NORMALIZER_PROCESSOR_ID,
  NORMALIZER_PROCESSOR_VERSION,
  normalizeTextV1,
} from '@voxweaver/text-pipeline';
import {
  buildNovelImportImpactSelectorsV1,
  computeInputFingerprint,
  sha256CanonicalJson,
  SourceAssetCommitError,
} from '@voxweaver/workflow-core';

import { ProjectApplicationError } from './projectApplicationError.js';

export const NOVEL_IMPORT_APPLICATION_PROCESSOR_ID
  = 'voxweaver.application.novel-import' as const;
export const NOVEL_IMPORT_APPLICATION_PROCESSOR_VERSION = '1.0.0' as const;
export const NOVEL_IMPORT_BUNDLE_ARTIFACT_TYPE = 'novel-import-bundle.v1' as const;
export const NOVEL_IMPORT_BUNDLE_SCHEMA_VERSION = 1 as const;

const INPUT_COMPATIBILITY_VERSION = 'm1-novel-import-input-v1';
const SOURCE_TYPE = 'novel-txt';
const NORMALIZATION_POLICY = Object.freeze({
  contextLineLimit: 2,
  maxPreservedBlankLines: 2,
  repeatedLineMinimumGapLines: 3,
  repeatedLineMinimumOccurrences: 3,
});

export interface ImportTxtSourceCommand {
  readonly temporaryRelativePath: string;
  readonly contentHash: string;
  readonly byteLength: number;
  readonly originalName: string;
  readonly idempotencyKey: string;
}

export interface ImportTxtNovelCommand extends ProjectSessionIdentity {
  readonly createdBy: string;
  readonly source: ImportTxtSourceCommand;
  readonly sourceEncoding?: UserSelectedTxtSourceEncoding;
}

export interface ReimportTxtNovelCommand extends ImportTxtNovelCommand {
  readonly baselineRevision: NovelImportReviewBaselineV1;
}

export type NovelImportWorkflowPort = ProjectWorkflowPort & SourceAssetCommitPort;

export type NovelImportWorkflowFactory = (
  context: ProjectContext,
) => NovelImportWorkflowPort;

export interface NovelImportSourceAssetResolverPort {
  readonly resolveSourceAsset: (
    sourceAsset: SourceAssetRecord,
    expectedByteLength: number,
  ) => Promise<NovelSourceAsset>;
}

export interface NovelImportAdapterResolverPort {
  readonly resolveAdapter: (
    adapterId: typeof TXT_SOURCE_ADAPTER_ID,
  ) => Promise<NovelSourceAdapter> | NovelSourceAdapter;
}

export interface NovelImportTemporaryArtifact {
  readonly outputDirectory: string;
}

export interface WriteNovelImportBundleCommand {
  readonly task: TaskRecord;
  readonly bundle: NovelImportBundleV1;
}

export interface NovelImportTemporaryArtifactWriterPort {
  readonly writeBundle: (
    command: WriteNovelImportBundleCommand,
  ) => Promise<NovelImportTemporaryArtifact>;
}

export interface ValidateNovelImportBundleCommand {
  readonly task: TaskRecord;
  readonly artifact: NovelImportTemporaryArtifact;
  readonly expectedBundle: NovelImportBundleV1;
}

export interface NovelImportTemporaryArtifactValidatorPort {
  readonly validateBundle: (
    command: ValidateNovelImportBundleCommand,
  ) => Promise<void>;
}

export interface NovelReimportArtifactStorePort {
  readonly readBundle: (
    artifact: ArtifactRecord,
  ) => Promise<NovelImportBundleV1>;
  readonly listRevisions: (
    artifactId: string,
  ) => Promise<readonly NovelReimportRevisionEntry[]>;
}

export interface NovelReimportRevisionEntry {
  readonly artifact: ArtifactRecord;
  readonly bundle: NovelImportBundleV1;
}

export type NovelReimportArtifactStoreFactory = (
  context: ProjectContext,
) => NovelReimportArtifactStorePort;

export interface NovelImportBundleV1 {
  readonly documentType: 'novel-import-bundle';
  readonly schemaVersion: typeof NOVEL_IMPORT_BUNDLE_SCHEMA_VERSION;
  readonly sourceAsset: SourceAssetRecord;
  readonly sourceByteLength: number;
  readonly inputFingerprint: string;
  readonly fingerprintParametersHash: string;
  readonly parameters: JsonValue;
  readonly parametersHash: string;
  readonly selectedEncoding: ImportedNovelV1['encodingDecision'];
  readonly importWarnings: readonly ImportIssueV1[];
  readonly importedNovel: ImportedNovelV1;
  readonly canonical: {
    readonly text: string;
    readonly revision: TextRevisionRefV1 & { readonly textLayer: 'canonical' };
    readonly rawToCanonicalRangeMap: TextRangeMapV1;
  };
  readonly blockIndex: DocumentBlockIndexV1;
  readonly chapterCandidates: readonly ChapterCandidateV1[];
  readonly chapterIndex: ChapterIndexV1;
  readonly normalization: {
    readonly proposals: readonly NormalizationProposalV1[];
    readonly result: NormalizationApplyResultV1;
  };
  readonly dependencySelector: ArtifactSelector;
  readonly reimport?: {
    readonly schemaVersion: 1;
    readonly baselineRevision: NovelImportReviewBaselineV1;
    readonly plan: NovelReimportPlanV1;
    readonly impactSelectors: readonly NovelImportImpactSelectorV1[];
  };
}

export type ImportTxtNovelResult
  = | {
    readonly reused: true;
    readonly inputFingerprint: string;
    readonly task: TaskRecord;
  }
  | {
    readonly reused: false;
    readonly inputFingerprint: string;
    readonly artifact: ArtifactRecord;
    readonly taskId: string;
  };

export type ReimportTxtNovelResult
  = | {
    readonly outcome: 'reused-current';
    readonly reused: true;
    readonly inputFingerprint: string;
    readonly artifact: ArtifactRecord;
    readonly plan: NovelReimportPlanV1;
    readonly impactSelectors: readonly NovelImportImpactSelectorV1[];
  }
  | {
    readonly outcome: 'reactivated-history';
    readonly reused: true;
    readonly inputFingerprint: string;
    readonly artifact: ArtifactRecord;
    readonly previousActiveRevisionId: string;
    readonly plan: NovelReimportPlanV1;
    readonly impactSelectors: readonly NovelImportImpactSelectorV1[];
  }
  | {
    readonly outcome: 'task-reused';
    readonly reused: true;
    readonly inputFingerprint: string;
    readonly task: TaskRecord;
  }
  | {
    readonly outcome: 'committed';
    readonly reused: false;
    readonly inputFingerprint: string;
    readonly artifact: ArtifactRecord;
    readonly taskId: string;
    readonly plan: NovelReimportPlanV1;
    readonly impactSelectors: readonly NovelImportImpactSelectorV1[];
  };

export interface NovelImportApplicationServiceOptions {
  readonly createOpaqueId?: () => string;
  readonly reimportArtifactStoreFactory?: NovelReimportArtifactStoreFactory;
}

export class NovelImportApplicationError extends Error {
  constructor(
    readonly code: NovelImportErrorCode,
    readonly detailReason: string,
    message: string,
    readonly details?: JsonValue,
  ) {
    super(message);
    this.name = 'NovelImportApplicationError';
  }
}

export class NovelImportApplicationService {
  readonly #adapterResolver: NovelImportAdapterResolverPort;
  readonly #artifactValidator: NovelImportTemporaryArtifactValidatorPort;
  readonly #artifactWriter: NovelImportTemporaryArtifactWriterPort;
  readonly #createOpaqueId: () => string;
  readonly #projects: ProjectApplicationService;
  readonly #reimportArtifactStoreFactory?: NovelReimportArtifactStoreFactory;
  readonly #sourceAssetResolver: NovelImportSourceAssetResolverPort;
  readonly #workflowFactory: NovelImportWorkflowFactory;

  constructor(
    projects: ProjectApplicationService,
    workflowFactory: NovelImportWorkflowFactory,
    sourceAssetResolver: NovelImportSourceAssetResolverPort,
    adapterResolver: NovelImportAdapterResolverPort,
    artifactWriter: NovelImportTemporaryArtifactWriterPort,
    artifactValidator: NovelImportTemporaryArtifactValidatorPort,
    options: NovelImportApplicationServiceOptions = {},
  ) {
    this.#projects = projects;
    this.#workflowFactory = workflowFactory;
    this.#sourceAssetResolver = sourceAssetResolver;
    this.#adapterResolver = adapterResolver;
    this.#artifactWriter = artifactWriter;
    this.#artifactValidator = artifactValidator;
    this.#createOpaqueId = options.createOpaqueId ?? randomUUID;
    this.#reimportArtifactStoreFactory = options.reimportArtifactStoreFactory;
  }

  async importTxt(command: ImportTxtNovelCommand): Promise<ImportTxtNovelResult> {
    try {
      return await this.#projects.runInActiveProjectSession(
        {
          projectId: command.projectId,
          projectSessionId: command.projectSessionId,
          requiredAccess: 'write',
        },
        async (context) => {
          const source = validateCommand(command);
          let workflow: NovelImportWorkflowPort;
          try {
            workflow = this.#workflowFactory(context);
            assertWorkflowPort(workflow);
          } catch (error) {
            throw normalizeFailure(error, 'workflow-resolution');
          }
          let sourceAsset: SourceAssetRecord;
          try {
            sourceAsset = await workflow.commitSourceAsset({
              temporarySource: { relativePath: source.temporaryRelativePath },
              expectedContentHash: source.contentHash,
              expectedByteLength: source.byteLength,
              originalName: source.originalName,
              sourceType: SOURCE_TYPE,
              createdBy: command.createdBy,
              idempotencyKey: source.idempotencyKey,
            });
          } catch (error) {
            throw normalizeFailure(error, 'source-commit');
          }
          assertCommittedSourceAsset(sourceAsset, source, command.createdBy);

          const fingerprintParameters = createFingerprintParameters(
            sourceAsset,
            source,
            command.sourceEncoding,
          );
          const fingerprintParametersHash = sha256CanonicalJson(
            fingerprintParameters,
          );
          const inputFingerprint = createNovelImportInputFingerprint(
            fingerprintParameters,
          );
          const outputScope = {
            kind: 'novel-import',
            identifiers: [sourceAsset.sourceAssetId],
          } as const;
          let enqueue: EnqueueTaskResult;
          try {
            enqueue = await workflow.enqueueTask({
              inputFingerprint,
              outputScope,
              processorId: NOVEL_IMPORT_APPLICATION_PROCESSOR_ID,
            });
          } catch (error) {
            throw normalizeFailure(error, 'task-enqueue');
          }
          assertEnqueuedTask(
            enqueue.task,
            enqueue.reused,
            context.manifest.projectId,
            inputFingerprint,
            sourceAsset.sourceAssetId,
          );
          if (enqueue.reused) {
            return {
              reused: true,
              inputFingerprint,
              task: enqueue.task,
            };
          }

          const task = enqueue.task;
          let boundary: FailureBoundary = 'task-start';
          try {
            await workflow.startTask(task.taskId);
            boundary = 'adapter-resolution';
            const adapter = await this.#adapterResolver.resolveAdapter(
              TXT_SOURCE_ADAPTER_ID,
            );
            assertTxtAdapter(adapter);

            boundary = 'source-resolution';
            const resolvedSource = await this.#sourceAssetResolver.resolveSourceAsset(
              sourceAsset,
              source.byteLength,
            );
            assertResolvedSource(resolvedSource, sourceAsset, source.byteLength);

            const validationContext = command.sourceEncoding === undefined
              ? {}
              : {
                  userEncoding: {
                    sourceContentHash: sourceAsset.contentHash,
                    sourceEncoding: command.sourceEncoding,
                  },
                };
            boundary = 'adapter-processing';
            const importedNovel = await adapter.extract(resolvedSource, {
              ...validationContext,
              createOpaqueId: this.#createOpaqueId,
            });
            assertImportedNovel(
              importedNovel,
              sourceAsset,
              source.byteLength,
              command.sourceEncoding,
            );

            boundary = 'text-processing';
            const canonical = canonicalizeRawTextV1({
              rawTextRevision: importedNovel.rawTextRevision,
              rawTextParts: importedNovel.orderedBlocks.map(block => block.rawText),
              canonicalTextRevisionId: this.#createOpaqueId(),
            });
            const blockIndex = buildDocumentBlockIndexV1({
              importedNovel,
              canonicalText: canonical.canonicalText,
              canonicalTextRevision: canonical.canonicalTextRevision,
              rawToCanonicalRangeMap: canonical.rangeMap,
            });
            const chapterCandidates = detectChapterCandidatesV1(blockIndex, {
              candidateIdFactory: this.#createOpaqueId,
            });
            const chapterIndex = buildChapterIndexV1({
              blockIndex,
              candidates: chapterCandidates,
              options: {
                chapterIdFactory: this.#createOpaqueId,
                issueIdFactory: this.#createOpaqueId,
                volumeIdFactory: this.#createOpaqueId,
              },
            });
            const proposals = discoverNormalizationProposalsV1({
              canonicalTextRevision: canonical.canonicalTextRevision,
              canonicalText: canonical.canonicalText,
              chapterIndex,
              options: {
                ...NORMALIZATION_POLICY,
                proposalIdFactory: this.#createOpaqueId,
                proposedBy: NORMALIZATION_PROPOSER_ID,
              },
            });
            assertPendingProposals(proposals);
            const normalization = normalizeTextV1({
              canonicalTextRevision: canonical.canonicalTextRevision,
              canonicalText: canonical.canonicalText,
              proposals,
              mode: 'apply',
              selectedProposalIds: [],
              normalizedTextRevisionId: this.#createOpaqueId(),
            });
            if (!normalization.applied) {
              throw new NovelImportApplicationError(
                'NOVEL_IMPORT_STRUCTURE_INVALID',
                'normalized_revision_not_materialized',
                'The independent normalized revision was not materialized.',
              );
            }

            const chapterIds = chapterIndex.entries.map(entry => entry.chapterId);
            const dependencySelector: ArtifactSelector = {
              blockIds: blockIndex.blocks.map(block => block.blockId),
              ...(chapterIds.length > 0 ? { chapterIds } : {}),
            };
            const parameters = createArtifactParameters(
              fingerprintParameters,
              fingerprintParametersHash,
              inputFingerprint,
              dependencySelector,
            );
            const parametersHash = sha256CanonicalJson(parameters);
            const bundle: NovelImportBundleV1 = {
              documentType: 'novel-import-bundle',
              schemaVersion: NOVEL_IMPORT_BUNDLE_SCHEMA_VERSION,
              sourceAsset,
              sourceByteLength: source.byteLength,
              inputFingerprint,
              fingerprintParametersHash,
              parameters,
              parametersHash,
              selectedEncoding: importedNovel.encodingDecision,
              importWarnings: importedNovel.warnings,
              importedNovel,
              canonical: {
                text: canonical.canonicalText,
                revision: canonical.canonicalTextRevision,
                rawToCanonicalRangeMap: canonical.rangeMap,
              },
              blockIndex,
              chapterCandidates,
              chapterIndex,
              normalization: {
                proposals,
                result: normalization,
              },
              dependencySelector,
            };

            boundary = 'artifact-write';
            const temporaryArtifact = await this.#artifactWriter.writeBundle({
              task,
              bundle,
            });
            assertTaskOutputDirectory(temporaryArtifact, task);
            boundary = 'artifact-validation';
            await this.#artifactValidator.validateBundle({
              task,
              artifact: temporaryArtifact,
              expectedBundle: bundle,
            });

            boundary = 'artifact-commit';
            const artifactId = this.#createOpaqueId();
            const revisionId = this.#createOpaqueId();
            const reviewRequired = requiresReview(bundle);
            const artifact = await workflow.commitArtifactRevision({
              artifactId,
              artifactType: NOVEL_IMPORT_BUNDLE_ARTIFACT_TYPE,
              createdBy: command.createdBy,
              dependencies: [],
              inputFingerprint,
              lineageId: artifactId,
              outputDirectory: temporaryArtifact.outputDirectory,
              parameters,
              processorId: NOVEL_IMPORT_APPLICATION_PROCESSOR_ID,
              processorVersion: NOVEL_IMPORT_APPLICATION_PROCESSOR_VERSION,
              revisionId,
              reviewRequired,
              scope: outputScope,
              storageKind: 'imported',
              taskId: task.taskId,
            });
            assertCommittedArtifact(artifact, {
              artifactId,
              createdBy: command.createdBy,
              inputFingerprint,
              parametersHash,
              revisionId,
              reviewRequired,
              sourceAssetId: sourceAsset.sourceAssetId,
            });
            return {
              reused: false,
              inputFingerprint,
              artifact,
              taskId: task.taskId,
            };
          } catch (error) {
            const failure = normalizeFailure(error, boundary);
            try {
              await workflow.failTask({
                errorCode: failure.code,
                errorMessage: failure.message,
                taskId: task.taskId,
              });
            } catch {
              throw new NovelImportApplicationError(
                failure.code,
                'task_failure_persistence_failed',
                'Novel import failed and its task failure could not be persisted.',
              );
            }
            throw failure;
          }
        },
      );
    } catch (error) {
      if (
        error instanceof ProjectApplicationError
        && error.code === 'PROJECT_SESSION_STALE'
      ) {
        throw new NovelImportApplicationError(
          'NOVEL_IMPORT_STALE_SESSION',
          'project_session_stale',
          'The project session is no longer active.',
        );
      }
      throw error;
    }
  }

  async reimportTxt(
    command: ReimportTxtNovelCommand,
  ): Promise<ReimportTxtNovelResult> {
    try {
      return await this.#projects.runInActiveProjectSession(
        {
          projectId: command.projectId,
          projectSessionId: command.projectSessionId,
          requiredAccess: 'write',
        },
        async (context) => {
          const source = validateCommand(command);
          const baseline = validateReimportBaseline(command?.baselineRevision);
          let workflow: NovelImportWorkflowPort;
          let store: NovelReimportArtifactStorePort;
          try {
            workflow = this.#workflowFactory(context);
            assertReimportWorkflowPort(workflow);
            store = this.#resolveReimportStore(context);
          } catch (error) {
            throw normalizeFailure(error, 'reimport-resolution');
          }

          const baselineArtifact = await loadCurrentReimportBaseline(
            workflow,
            baseline,
          );
          const baselineBundle = await readReimportBundle(
            store,
            baselineArtifact,
            baseline,
          );

          const history = await listReimportHistory(
            store,
            baselineArtifact,
          );
          const historicalSourceEntry = findMatchingReimportSourceIdentity(
            history,
            source,
          );
          const historicalEntry = findMatchingReimportHistory(
            history,
            source,
            command.sourceEncoding,
          );
          let reusable: ArtifactRecord | undefined;
          let reusableBundle: NovelImportBundleV1 | undefined;
          let inputFingerprint: string | undefined;
          let fingerprintParameters: JsonValue | undefined;
          if (historicalEntry !== undefined) {
            fingerprintParameters = createFingerprintParameters(
              historicalEntry.bundle.sourceAsset,
              source,
              command.sourceEncoding,
            );
            inputFingerprint = createNovelImportInputFingerprint(
              fingerprintParameters,
            );
            try {
              reusable = await workflow.findReusableRevision(
                inputFingerprint,
                NOVEL_IMPORT_APPLICATION_PROCESSOR_ID,
                baselineArtifact.scope,
              );
            } catch (error) {
              throw normalizeFailure(error, 'reimport-history');
            }
          }

          if (reusable !== undefined && inputFingerprint !== undefined) {
            assertReusableReimportArtifact(
              reusable,
              baselineArtifact,
              inputFingerprint,
            );
            reusableBundle = history.find(entry =>
              entry.artifact.revisionId === reusable?.revisionId)?.bundle
              ?? await readReimportBundle(store, reusable);
            const trace = buildReimportTrace(baselineBundle, reusableBundle);
            if (reusable.revisionId === baselineArtifact.revisionId) {
              if (trace.impactSelectors.length !== 0) {
                invalid(
                  'NOVEL_IMPORT_STRUCTURE_INVALID',
                  'reused_current_revision_changed',
                  'The current reusable revision unexpectedly reports a text change.',
                );
              }
              await assertCurrentReimportBaseline(workflow, baseline);
              return {
                outcome: 'reused-current',
                reused: true,
                inputFingerprint,
                artifact: baselineArtifact,
                plan: trace.plan,
                impactSelectors: trace.impactSelectors,
              };
            }

            const changeSelector = requirePersistableReimportSelector(trace);
            const sourceAsset = await commitReimportSourceAsset(
              workflow,
              source,
              command.createdBy,
              reusableBundle.sourceAsset,
            );
            assertHistoricalReimportSourceAsset(
              sourceAsset,
              reusableBundle.sourceAsset,
              source,
            );
            await assertCurrentReimportBaseline(workflow, baseline);
            let artifact: ArtifactRecord;
            try {
              artifact = await workflow.activateArtifactRevision({
                revisionId: reusable.revisionId,
                changeSelector,
              });
            } catch (error) {
              throw normalizeFailure(error, 'reimport-activation');
            }
            assertReactivatedArtifact(artifact, reusable, baselineArtifact);
            return {
              outcome: 'reactivated-history',
              reused: true,
              inputFingerprint,
              artifact,
              previousActiveRevisionId: baselineArtifact.revisionId,
              plan: trace.plan,
              impactSelectors: trace.impactSelectors,
            };
          }

          const sourceAsset = await commitReimportSourceAsset(
            workflow,
            source,
            command.createdBy,
            historicalSourceEntry?.bundle.sourceAsset,
          );
          if (historicalSourceEntry === undefined) {
            assertCommittedSourceAsset(sourceAsset, source, command.createdBy);
          } else {
            assertHistoricalReimportSourceAsset(
              sourceAsset,
              historicalSourceEntry.bundle.sourceAsset,
              source,
            );
          }
          fingerprintParameters = createFingerprintParameters(
            sourceAsset,
            source,
            command.sourceEncoding,
          );
          const fingerprintParametersHash = sha256CanonicalJson(
            fingerprintParameters,
          );
          inputFingerprint = createNovelImportInputFingerprint(
            fingerprintParameters,
          );

          let enqueue: EnqueueTaskResult;
          try {
            enqueue = await workflow.enqueueTask({
              inputFingerprint,
              outputScope: baselineArtifact.scope,
              processorId: NOVEL_IMPORT_APPLICATION_PROCESSOR_ID,
            });
          } catch (error) {
            throw normalizeFailure(error, 'task-enqueue');
          }
          assertReimportEnqueuedTask(
            enqueue.task,
            enqueue.reused,
            context.manifest.projectId,
            inputFingerprint,
            baselineArtifact.scope,
          );
          if (enqueue.reused) {
            await assertCurrentReimportBaseline(workflow, baseline);
            return {
              outcome: 'task-reused',
              reused: true,
              inputFingerprint,
              task: enqueue.task,
            };
          }

          const task = enqueue.task;
          let boundary: FailureBoundary = 'task-start';
          try {
            await workflow.startTask(task.taskId);
            boundary = 'adapter-resolution';
            const adapter = await this.#adapterResolver.resolveAdapter(
              TXT_SOURCE_ADAPTER_ID,
            );
            assertTxtAdapter(adapter);

            boundary = 'source-resolution';
            const resolvedSource = await this.#sourceAssetResolver.resolveSourceAsset(
              sourceAsset,
              source.byteLength,
            );
            assertResolvedSource(resolvedSource, sourceAsset, source.byteLength);

            const validationContext = command.sourceEncoding === undefined
              ? {}
              : {
                  userEncoding: {
                    sourceContentHash: sourceAsset.contentHash,
                    sourceEncoding: command.sourceEncoding,
                  },
                };
            boundary = 'adapter-processing';
            const importedNovel = await adapter.extract(resolvedSource, {
              ...validationContext,
              createOpaqueId: this.#createOpaqueId,
            });
            assertImportedNovel(
              importedNovel,
              sourceAsset,
              source.byteLength,
              command.sourceEncoding,
            );

            boundary = 'text-processing';
            const canonical = canonicalizeRawTextV1({
              rawTextRevision: importedNovel.rawTextRevision,
              rawTextParts: importedNovel.orderedBlocks.map(block => block.rawText),
              canonicalTextRevisionId: this.#createOpaqueId(),
            });
            const blockIndex = buildDocumentBlockIndexV1({
              importedNovel,
              canonicalText: canonical.canonicalText,
              canonicalTextRevision: canonical.canonicalTextRevision,
              rawToCanonicalRangeMap: canonical.rangeMap,
              previousIndex: baselineBundle.blockIndex,
            });
            const chapterCandidates = detectChapterCandidatesV1(blockIndex, {
              candidateIdFactory: this.#createOpaqueId,
            });
            const generatedChapterIndex = buildChapterIndexV1({
              blockIndex,
              candidates: chapterCandidates,
              options: {
                chapterIdFactory: this.#createOpaqueId,
                issueIdFactory: this.#createOpaqueId,
                volumeIdFactory: this.#createOpaqueId,
              },
            });
            const initialPlan = buildNovelReimportPlanV1({
              previousBlockIndex: baselineBundle.blockIndex,
              currentBlockIndex: blockIndex,
              previousChapterIndex: baselineBundle.chapterIndex,
              currentChapterIndex: generatedChapterIndex,
            });
            const chapterIndex = preserveReimportChapterIds(
              generatedChapterIndex,
              initialPlan,
            );
            const trace = buildReimportTrace(
              baselineBundle,
              { blockIndex, chapterIndex },
            );
            const changeSelector = requirePersistableReimportSelector(trace);
            const proposals = discoverNormalizationProposalsV1({
              canonicalTextRevision: canonical.canonicalTextRevision,
              canonicalText: canonical.canonicalText,
              chapterIndex,
              options: {
                ...NORMALIZATION_POLICY,
                proposalIdFactory: this.#createOpaqueId,
                proposedBy: NORMALIZATION_PROPOSER_ID,
              },
            });
            assertPendingProposals(proposals);
            const normalization = normalizeTextV1({
              canonicalTextRevision: canonical.canonicalTextRevision,
              canonicalText: canonical.canonicalText,
              proposals,
              mode: 'apply',
              selectedProposalIds: [],
              normalizedTextRevisionId: this.#createOpaqueId(),
            });
            if (!normalization.applied) {
              invalid(
                'NOVEL_IMPORT_STRUCTURE_INVALID',
                'normalized_revision_not_materialized',
                'The independent normalized revision was not materialized.',
              );
            }

            const dependencySelector = createDependencySelector(
              blockIndex,
              chapterIndex,
            );
            const parameters = createReimportArtifactParameters(
              fingerprintParameters,
              fingerprintParametersHash,
              inputFingerprint,
              dependencySelector,
              baseline,
              trace,
            );
            const parametersHash = sha256CanonicalJson(parameters);
            const bundle: NovelImportBundleV1 = {
              documentType: 'novel-import-bundle',
              schemaVersion: NOVEL_IMPORT_BUNDLE_SCHEMA_VERSION,
              sourceAsset,
              sourceByteLength: source.byteLength,
              inputFingerprint,
              fingerprintParametersHash,
              parameters,
              parametersHash,
              selectedEncoding: importedNovel.encodingDecision,
              importWarnings: importedNovel.warnings,
              importedNovel,
              canonical: {
                text: canonical.canonicalText,
                revision: canonical.canonicalTextRevision,
                rawToCanonicalRangeMap: canonical.rangeMap,
              },
              blockIndex,
              chapterCandidates,
              chapterIndex,
              normalization: {
                proposals,
                result: normalization,
              },
              dependencySelector,
              reimport: {
                schemaVersion: 1,
                baselineRevision: baseline,
                plan: trace.plan,
                impactSelectors: trace.impactSelectors,
              },
            };

            boundary = 'artifact-write';
            const temporaryArtifact = await this.#artifactWriter.writeBundle({
              task,
              bundle,
            });
            assertTaskOutputDirectory(temporaryArtifact, task);
            boundary = 'artifact-validation';
            await this.#artifactValidator.validateBundle({
              task,
              artifact: temporaryArtifact,
              expectedBundle: bundle,
            });

            boundary = 'reimport-history';
            const dependencies = await workflow.listArtifactDependencies(
              baselineArtifact.revisionId,
            );
            await assertCurrentReimportBaseline(workflow, baseline);
            boundary = 'artifact-commit';
            const revisionId = this.#createOpaqueId();
            const reviewRequired = requiresReview(bundle)
              || trace.plan.reviewStatus === 'pending';
            const artifact = await workflow.commitArtifactRevision({
              artifactId: baselineArtifact.artifactId,
              artifactType: baselineArtifact.artifactType,
              lineageId: baselineArtifact.lineageId,
              revisionId,
              activate: true,
              changeSelector,
              createdBy: command.createdBy,
              dependencies: dependencies.map(toDependencyInput),
              inputFingerprint,
              outputDirectory: temporaryArtifact.outputDirectory,
              parameters,
              processorId: NOVEL_IMPORT_APPLICATION_PROCESSOR_ID,
              processorVersion: NOVEL_IMPORT_APPLICATION_PROCESSOR_VERSION,
              reviewRequired,
              scope: baselineArtifact.scope,
              storageKind: baselineArtifact.storageKind,
              taskId: task.taskId,
            });
            assertCommittedReimportArtifact(artifact, {
              baselineArtifact,
              createdBy: command.createdBy,
              inputFingerprint,
              parametersHash,
              revisionId,
              reviewRequired,
            });
            return {
              outcome: 'committed',
              reused: false,
              inputFingerprint,
              artifact,
              taskId: task.taskId,
              plan: trace.plan,
              impactSelectors: trace.impactSelectors,
            };
          } catch (error) {
            const failure = normalizeFailure(error, boundary);
            try {
              await workflow.failTask({
                errorCode: failure.code,
                errorMessage: failure.message,
                taskId: task.taskId,
              });
            } catch {
              throw new NovelImportApplicationError(
                failure.code,
                'task_failure_persistence_failed',
                'Novel reimport failed and its task failure could not be persisted.',
              );
            }
            throw failure;
          }
        },
      );
    } catch (error) {
      if (
        error instanceof ProjectApplicationError
        && error.code === 'PROJECT_SESSION_STALE'
      ) {
        throw new NovelImportApplicationError(
          'NOVEL_IMPORT_STALE_SESSION',
          'project_session_stale',
          'The project session is no longer active.',
        );
      }
      throw error;
    }
  }

  #resolveReimportStore(
    context: ProjectContext,
  ): NovelReimportArtifactStorePort {
    const store = this.#reimportArtifactStoreFactory?.(context);
    if (
      typeof store?.readBundle !== 'function'
      || typeof store.listRevisions !== 'function'
    ) {
      invalid(
        'NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE',
        'reimport_artifact_store_unavailable',
        'The active project does not provide immutable novel import bundle reads.',
      );
    }
    return store;
  }
}

interface CommittedArtifactExpectation {
  readonly artifactId: string;
  readonly createdBy: string;
  readonly inputFingerprint: string;
  readonly parametersHash: string;
  readonly revisionId: string;
  readonly reviewRequired: boolean;
  readonly sourceAssetId: string;
}

interface CommittedReimportArtifactExpectation {
  readonly baselineArtifact: ArtifactRecord;
  readonly createdBy: string;
  readonly inputFingerprint: string;
  readonly parametersHash: string;
  readonly revisionId: string;
  readonly reviewRequired: boolean;
}

interface ReimportTrace {
  readonly plan: NovelReimportPlanV1;
  readonly impactSelectors: readonly NovelImportImpactSelectorV1[];
}

interface NovelReimportIndexProjection {
  readonly blockIndex: DocumentBlockIndexV1;
  readonly chapterIndex: ChapterIndexV1;
}

type FailureBoundary
  = | 'workflow-resolution'
    | 'source-commit'
    | 'task-enqueue'
    | 'task-start'
    | 'adapter-resolution'
    | 'source-resolution'
    | 'adapter-processing'
    | 'text-processing'
    | 'reimport-resolution'
    | 'reimport-history'
    | 'reimport-activation'
    | 'artifact-write'
    | 'artifact-validation'
    | 'artifact-commit';

function validateCommand(command: ImportTxtNovelCommand): ImportTxtSourceCommand {
  if (typeof command?.createdBy !== 'string' || command.createdBy.trim().length === 0) {
    invalid(
      'NOVEL_IMPORT_INVALID_SOURCE',
      'import_creator_invalid',
      'Novel import creator must be a non-empty string.',
    );
  }
  const source = command?.source;
  if (source === undefined || source === null || typeof source !== 'object') {
    invalid(
      'NOVEL_IMPORT_INVALID_SOURCE',
      'source_command_invalid',
      'TXT source commit information is required.',
    );
  }
  assertPortableTemporaryPath(source.temporaryRelativePath);
  if (!/^[0-9a-f]{64}$/u.test(source.contentHash)) {
    invalid(
      'NOVEL_IMPORT_INVALID_SOURCE',
      'source_hash_invalid',
      'TXT source content hash must be lowercase SHA-256 hex.',
    );
  }
  if (!Number.isSafeInteger(source.byteLength) || source.byteLength < 0) {
    invalid(
      'NOVEL_IMPORT_INVALID_SOURCE',
      'source_byte_length_invalid',
      'TXT source byte length must be a non-negative safe integer.',
    );
  }
  for (const [field, value] of [
    ['original name', source.originalName],
    ['idempotency key', source.idempotencyKey],
  ] as const) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      invalid(
        'NOVEL_IMPORT_INVALID_SOURCE',
        'source_command_invalid',
        `TXT source ${field} must be a non-empty string.`,
      );
    }
  }
  if (
    command.sourceEncoding !== undefined
    && !(TXT_SOURCE_ENCODINGS.slice(1) as readonly string[]).includes(
      command.sourceEncoding,
    )
  ) {
    invalid(
      'NOVEL_IMPORT_ENCODING_REQUIRED',
      'source_encoding_invalid',
      'The selected TXT source encoding is unsupported.',
    );
  }
  return source;
}

function validateReimportBaseline(
  value: NovelImportReviewBaselineV1,
): NovelImportReviewBaselineV1 {
  if (
    typeof value?.artifactId !== 'string'
    || value.artifactId.length === 0
    || typeof value.artifactRevisionId !== 'string'
    || value.artifactRevisionId.length === 0
  ) {
    invalid(
      'NOVEL_IMPORT_INVALID_SOURCE',
      'reimport_baseline_invalid',
      'Novel reimport requires a complete artifact baseline.',
    );
  }
  let canonicalTextRevision: TextRevisionRefV1;
  try {
    canonicalTextRevision = parseTextRevisionRefV1(value.canonicalTextRevision);
  } catch {
    invalid(
      'NOVEL_IMPORT_INVALID_SOURCE',
      'reimport_baseline_invalid',
      'Novel reimport requires a valid canonical text revision baseline.',
    );
  }
  if (canonicalTextRevision.textLayer !== 'canonical') {
    invalid(
      'NOVEL_IMPORT_INVALID_SOURCE',
      'reimport_baseline_invalid',
      'Novel reimport baseline must reference canonical text.',
    );
  }
  return {
    artifactId: value.artifactId,
    artifactRevisionId: value.artifactRevisionId,
    canonicalTextRevision: {
      ...canonicalTextRevision,
      textLayer: 'canonical',
    },
  };
}

function createNovelImportInputFingerprint(
  fingerprintParameters: JsonValue,
): string {
  return computeInputFingerprint({
    compatibilityVersion: INPUT_COMPATIBILITY_VERSION,
    dependencies: [],
    parameters: fingerprintParameters,
    processorId: NOVEL_IMPORT_APPLICATION_PROCESSOR_ID,
    processorVersion: NOVEL_IMPORT_APPLICATION_PROCESSOR_VERSION,
    ruleVersions: {
      blockAlignment: BLOCK_ALIGNMENT_POLICY_VERSION,
      canonical: CANONICAL_RULE_VERSION,
      chapterConfidence: CHAPTER_CONFIDENCE_FORMULA_VERSION,
      chapterHeading: CHAPTER_HEADING_RULE_VERSION,
      normalization: NORMALIZATION_RULE_VERSION,
    },
  });
}

function createFingerprintParameters(
  sourceAsset: SourceAssetRecord,
  source: ImportTxtSourceCommand,
  sourceEncoding: UserSelectedTxtSourceEncoding | undefined,
): JsonValue {
  return {
    schemaVersion: 1,
    source: {
      sourceAssetId: sourceAsset.sourceAssetId,
      contentHash: sourceAsset.contentHash,
      byteLength: source.byteLength,
      sourceType: SOURCE_TYPE,
    },
    requestedSourceEncoding: sourceEncoding ?? null,
    versions: {
      applicationProcessorId: NOVEL_IMPORT_APPLICATION_PROCESSOR_ID,
      applicationProcessorVersion: NOVEL_IMPORT_APPLICATION_PROCESSOR_VERSION,
      adapterId: TXT_SOURCE_ADAPTER_ID,
      adapterVersion: TXT_SOURCE_ADAPTER_VERSION,
      importProcessorId: TXT_IMPORT_PROCESSOR_ID,
      importProcessorVersion: TXT_IMPORT_PROCESSOR_VERSION,
      canonicalProcessorId: CANONICALIZER_PROCESSOR_ID,
      canonicalProcessorVersion: CANONICALIZER_PROCESSOR_VERSION,
      blockIndexSchemaVersion: DOCUMENT_BLOCK_INDEX_SCHEMA_VERSION,
      blockAlignmentPolicyVersion: BLOCK_ALIGNMENT_POLICY_VERSION,
      chapterHeadingRuleVersion: CHAPTER_HEADING_RULE_VERSION,
      chapterConfidenceFormulaVersion: CHAPTER_CONFIDENCE_FORMULA_VERSION,
      chapterIndexProcessorId: CHAPTER_INDEX_PROCESSOR_ID,
      chapterIndexProcessorVersion: CHAPTER_INDEX_PROCESSOR_VERSION,
      normalizationProposerId: NORMALIZATION_PROPOSER_ID,
      normalizationRuleVersion: NORMALIZATION_RULE_VERSION,
      normalizerProcessorId: NORMALIZER_PROCESSOR_ID,
      normalizerProcessorVersion: NORMALIZER_PROCESSOR_VERSION,
    },
    policies: {
      normalization: NORMALIZATION_POLICY,
      dependencySelector: {
        blockIds: 'all-generated-blocks',
        chapterIds: 'all-generated-chapters',
      },
    },
  };
}

function createArtifactParameters(
  fingerprintParameters: JsonValue,
  fingerprintParametersHash: string,
  inputFingerprint: string,
  dependencySelector: ArtifactSelector,
): JsonValue {
  return {
    schemaVersion: 1,
    fingerprintParameters,
    fingerprintParametersHash,
    inputFingerprint,
    dependencySelector: dependencySelector as unknown as JsonValue,
  };
}

function createDependencySelector(
  blockIndex: DocumentBlockIndexV1,
  chapterIndex: ChapterIndexV1,
): ArtifactSelector {
  const chapterIds = chapterIndex.entries.map(entry => entry.chapterId);
  return {
    blockIds: blockIndex.blocks.map(block => block.blockId),
    ...(chapterIds.length > 0 ? { chapterIds } : {}),
  };
}

function createReimportArtifactParameters(
  fingerprintParameters: JsonValue,
  fingerprintParametersHash: string,
  inputFingerprint: string,
  dependencySelector: ArtifactSelector,
  baselineRevision: NovelImportReviewBaselineV1,
  trace: ReimportTrace,
): JsonValue {
  return {
    schemaVersion: 1,
    fingerprintParameters,
    fingerprintParametersHash,
    inputFingerprint,
    dependencySelector: dependencySelector as unknown as JsonValue,
    reimport: {
      schemaVersion: 1,
      baselineRevision,
      plan: trace.plan,
      impactSelectors: trace.impactSelectors,
    },
  } as unknown as JsonValue;
}

function assertWorkflowPort(
  workflow: NovelImportWorkflowPort,
): asserts workflow is NovelImportWorkflowPort {
  for (const method of [
    'commitSourceAsset',
    'enqueueTask',
    'startTask',
    'failTask',
    'commitArtifactRevision',
  ] as const) {
    if (typeof workflow?.[method] !== 'function') {
      invalid(
        'NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE',
        'workflow_capability_unavailable',
        'The active project workflow does not provide the TXT import capability.',
      );
    }
  }
}

function assertReimportWorkflowPort(
  workflow: NovelImportWorkflowPort,
): asserts workflow is NovelImportWorkflowPort {
  assertWorkflowPort(workflow);
  for (const method of [
    'activateArtifactRevision',
    'findReusableRevision',
    'getArtifactRevision',
    'listArtifactDependencies',
  ] as const) {
    if (typeof workflow?.[method] !== 'function') {
      invalid(
        'NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE',
        'reimport_workflow_capability_unavailable',
        'The active project workflow does not provide the reimport capability.',
      );
    }
  }
}

function assertCommittedSourceAsset(
  sourceAsset: SourceAssetRecord,
  expected: ImportTxtSourceCommand,
  createdBy: string,
): void {
  if (
    sourceAsset?.contentHash !== expected.contentHash
    || sourceAsset.sourceType !== SOURCE_TYPE
    || sourceAsset.originalName !== expected.originalName
    || sourceAsset.createdBy !== createdBy
    || typeof sourceAsset.sourceAssetId !== 'string'
    || sourceAsset.sourceAssetId.length === 0
  ) {
    invalid(
      'NOVEL_IMPORT_INVALID_SOURCE',
      'committed_source_mismatch',
      'Committed SourceAsset identity does not match the TXT import request.',
    );
  }
  assertPortableRelativePath(
    sourceAsset.relativePath,
    'committed_source_path_invalid',
    'NOVEL_IMPORT_INVALID_SOURCE',
  );
  if (!sourceAsset.relativePath.startsWith('inputs/source-assets/')) {
    invalid(
      'NOVEL_IMPORT_INVALID_SOURCE',
      'committed_source_path_invalid',
      'Committed SourceAsset path must remain below project inputs/source-assets/.',
    );
  }
}

function assertCommittedArtifact(
  artifact: ArtifactRecord,
  expected: CommittedArtifactExpectation,
): void {
  const expectedReviewStatus = expected.reviewRequired ? 'pending' : 'not_required';
  if (
    artifact?.artifactId !== expected.artifactId
    || artifact.artifactType !== NOVEL_IMPORT_BUNDLE_ARTIFACT_TYPE
    || artifact.lineageId !== expected.artifactId
    || artifact.revisionId !== expected.revisionId
    || artifact.scope?.kind !== 'novel-import'
    || !sameStrings(artifact.scope.identifiers, [expected.sourceAssetId])
    || artifact.storageKind !== 'imported'
    || artifact.inputFingerprint !== expected.inputFingerprint
    || artifact.processorId !== NOVEL_IMPORT_APPLICATION_PROCESSOR_ID
    || artifact.processorVersion !== NOVEL_IMPORT_APPLICATION_PROCESSOR_VERSION
    || artifact.parametersHash !== expected.parametersHash
    || artifact.executionStatus !== 'succeeded'
    || artifact.validityStatus !== 'current'
    || artifact.reviewStatus !== expectedReviewStatus
    || artifact.createdBy !== expected.createdBy
    || !/^[0-9a-f]{64}$/u.test(artifact.contentHash)
  ) {
    invalid(
      'NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE',
      'committed_artifact_projection_mismatch',
      'Committed novel import artifact does not match its validated projection.',
    );
  }
  assertPortableRelativePath(
    artifact.contentPath,
    'committed_artifact_path_invalid',
    'NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE',
  );
  if (
    artifact.contentPath
    !== `artifacts/imported/${expected.revisionId}/content`
  ) {
    invalid(
      'NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE',
      'committed_artifact_path_invalid',
      'Committed novel import artifact path does not match its revision.',
    );
  }
}

async function loadCurrentReimportBaseline(
  workflow: ProjectWorkflowPort,
  baseline: NovelImportReviewBaselineV1,
): Promise<ArtifactRecord> {
  let artifact: ArtifactRecord | undefined;
  try {
    artifact = await workflow.getArtifactRevision(
      baseline.artifactRevisionId,
    );
  } catch {
    invalid(
      'NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE',
      'reimport_baseline_read_failed',
      'The current novel import baseline could not be read.',
    );
  }
  if (
    artifact === undefined
    || artifact.artifactId !== baseline.artifactId
    || artifact.revisionId !== baseline.artifactRevisionId
    || artifact.artifactType !== NOVEL_IMPORT_BUNDLE_ARTIFACT_TYPE
    || artifact.processorId !== NOVEL_IMPORT_APPLICATION_PROCESSOR_ID
    || artifact.executionStatus !== 'succeeded'
    || artifact.validityStatus !== 'current'
    || artifact.reviewStatus === 'rejected'
  ) {
    invalid(
      'NOVEL_IMPORT_REVIEW_REQUIRED',
      'reimport_baseline_not_current',
      'The requested novel import baseline is not the active reusable revision.',
    );
  }
  return artifact;
}

async function assertCurrentReimportBaseline(
  workflow: ProjectWorkflowPort,
  baseline: NovelImportReviewBaselineV1,
): Promise<void> {
  await loadCurrentReimportBaseline(workflow, baseline);
}

async function readReimportBundle(
  store: NovelReimportArtifactStorePort,
  artifact: ArtifactRecord,
  baseline?: NovelImportReviewBaselineV1,
): Promise<NovelImportBundleV1> {
  let bundle: NovelImportBundleV1;
  try {
    bundle = await store.readBundle(artifact);
  } catch {
    invalid(
      'NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE',
      'reimport_bundle_read_failed',
      'The immutable novel import bundle could not be read.',
    );
  }
  assertReimportBundleProjection(bundle, artifact, baseline);
  return bundle;
}

async function listReimportHistory(
  store: NovelReimportArtifactStorePort,
  baseline: ArtifactRecord,
): Promise<readonly NovelReimportRevisionEntry[]> {
  let history: readonly NovelReimportRevisionEntry[];
  try {
    history = await store.listRevisions(baseline.artifactId);
  } catch {
    invalid(
      'NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE',
      'reimport_history_read_failed',
      'The immutable novel import revision history could not be read.',
    );
  }
  if (!Array.isArray(history)) {
    invalid(
      'NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE',
      'reimport_history_invalid',
      'Novel import revision history must be an array.',
    );
  }
  const revisionIds = new Set<string>();
  let baselineFound = false;
  for (const entry of history) {
    if (
      entry?.artifact?.artifactId !== baseline.artifactId
      || entry.artifact.artifactType !== baseline.artifactType
      || entry.artifact.lineageId !== baseline.lineageId
      || entry.artifact.storageKind !== baseline.storageKind
      || !sameArtifactScope(entry.artifact.scope, baseline.scope)
      || revisionIds.has(entry.artifact.revisionId)
    ) {
      invalid(
        'NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE',
        'reimport_history_invalid',
        'Novel import revision history contains an invalid lineage entry.',
      );
    }
    assertReimportBundleProjection(entry.bundle, entry.artifact);
    revisionIds.add(entry.artifact.revisionId);
    baselineFound ||= entry.artifact.revisionId === baseline.revisionId;
  }
  if (!baselineFound) {
    invalid(
      'NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE',
      'reimport_history_baseline_missing',
      'Novel import revision history omits the active baseline.',
    );
  }
  return history;
}

function findMatchingReimportHistory(
  history: readonly NovelReimportRevisionEntry[],
  source: ImportTxtSourceCommand,
  sourceEncoding: UserSelectedTxtSourceEncoding | undefined,
): NovelReimportRevisionEntry | undefined {
  return [...history].reverse().find(entry =>
    matchesReimportSourceIdentity(entry, source)
    && entry.artifact.executionStatus === 'succeeded'
    && entry.artifact.validityStatus !== 'missing'
    && entry.artifact.reviewStatus !== 'rejected'
    && (sourceEncoding === undefined
      ? entry.bundle.selectedEncoding.method !== 'user'
      : entry.bundle.selectedEncoding.method === 'user'
        && entry.bundle.selectedEncoding.sourceEncoding === sourceEncoding));
}

function findMatchingReimportSourceIdentity(
  history: readonly NovelReimportRevisionEntry[],
  source: ImportTxtSourceCommand,
): NovelReimportRevisionEntry | undefined {
  return [...history].reverse().find(entry =>
    entry.artifact.executionStatus === 'succeeded'
    && matchesReimportSourceIdentity(entry, source));
}

function matchesReimportSourceIdentity(
  entry: NovelReimportRevisionEntry,
  source: ImportTxtSourceCommand,
): boolean {
  return entry.bundle.sourceAsset.sourceType === SOURCE_TYPE
    && entry.bundle.sourceAsset.contentHash === source.contentHash
    && entry.bundle.sourceAsset.originalName === source.originalName
    && entry.bundle.sourceByteLength === source.byteLength;
}

async function commitReimportSourceAsset(
  workflow: SourceAssetCommitPort,
  source: ImportTxtSourceCommand,
  createdBy: string,
  historicalSourceAsset?: SourceAssetRecord,
): Promise<SourceAssetRecord> {
  if (historicalSourceAsset !== undefined)
    assertHistoricalReimportSourceIdentity(historicalSourceAsset, source);
  try {
    return await workflow.commitSourceAsset({
      temporarySource: { relativePath: source.temporaryRelativePath },
      expectedContentHash: source.contentHash,
      expectedByteLength: source.byteLength,
      originalName: source.originalName,
      sourceType: SOURCE_TYPE,
      createdBy,
      idempotencyKey: source.idempotencyKey,
    });
  } catch (error) {
    if (
      error instanceof SourceAssetCommitError
      && error.code === 'SOURCE_ASSET_COMMIT_DUPLICATE'
      && historicalSourceAsset !== undefined
    ) {
      return historicalSourceAsset;
    }
    throw normalizeFailure(error, 'source-commit');
  }
}

function assertHistoricalReimportSourceIdentity(
  historical: SourceAssetRecord,
  source: ImportTxtSourceCommand,
): void {
  if (
    historical.sourceType !== SOURCE_TYPE
    || historical.originalName !== source.originalName
    || historical.contentHash !== source.contentHash
    || typeof historical.sourceAssetId !== 'string'
    || historical.sourceAssetId.length === 0
  ) {
    invalid(
      'NOVEL_IMPORT_INVALID_SOURCE',
      'reimport_historical_source_mismatch',
      'The reusable historical SourceAsset does not match the reimport request.',
    );
  }
  assertPortableRelativePath(
    historical.relativePath,
    'committed_source_path_invalid',
    'NOVEL_IMPORT_INVALID_SOURCE',
  );
}

function assertHistoricalReimportSourceAsset(
  sourceAsset: SourceAssetRecord,
  historical: SourceAssetRecord,
  source: ImportTxtSourceCommand,
): void {
  if (
    sourceAsset.sourceAssetId !== historical.sourceAssetId
    || sourceAsset.sourceType !== historical.sourceType
    || sourceAsset.originalName !== historical.originalName
    || sourceAsset.contentHash !== historical.contentHash
    || sourceAsset.contentHash !== source.contentHash
  ) {
    invalid(
      'NOVEL_IMPORT_INVALID_SOURCE',
      'reimport_historical_source_mismatch',
      'The committed SourceAsset does not match the reusable historical revision.',
    );
  }
  assertPortableRelativePath(
    sourceAsset.relativePath,
    'committed_source_path_invalid',
    'NOVEL_IMPORT_INVALID_SOURCE',
  );
}

function assertReimportBundleProjection(
  bundle: NovelImportBundleV1,
  artifact: ArtifactRecord,
  baseline?: NovelImportReviewBaselineV1,
): void {
  let parametersHash: string;
  try {
    parametersHash = sha256CanonicalJson(bundle?.parameters);
  } catch {
    invalid(
      'NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE',
      'reimport_bundle_projection_invalid',
      'The immutable novel import bundle parameters are invalid.',
    );
  }
  const blockIds = bundle?.blockIndex?.blocks?.map(block => block.blockId);
  const chapterIds = bundle?.chapterIndex?.entries?.map(entry => entry.chapterId);
  if (
    bundle?.documentType !== 'novel-import-bundle'
    || bundle.schemaVersion !== NOVEL_IMPORT_BUNDLE_SCHEMA_VERSION
    || bundle.inputFingerprint !== artifact.inputFingerprint
    || bundle.parametersHash !== artifact.parametersHash
    || parametersHash !== bundle.parametersHash
    || bundle.sourceAsset?.sourceAssetId !== bundle.importedNovel?.sourceAssetId
    || bundle.sourceAsset?.contentHash !== bundle.importedNovel?.sourceHash
    || bundle.sourceByteLength !== bundle.importedNovel?.sourceByteLength
    || !sameTextRevision(
      bundle.canonical?.revision,
      bundle.blockIndex?.canonicalTextRevision,
    )
    || !sameTextRevision(
      bundle.canonical?.revision,
      bundle.chapterIndex?.textRevision,
    )
    || !sameStringSets(bundle.dependencySelector?.blockIds, blockIds)
    || !sameStringSets(bundle.dependencySelector?.chapterIds, chapterIds)
    || (baseline !== undefined
      && !sameTextRevision(
        bundle.canonical?.revision,
        baseline.canonicalTextRevision,
      ))
  ) {
    invalid(
      'NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE',
      'reimport_bundle_projection_invalid',
      'The immutable novel import bundle does not match its artifact revision.',
    );
  }
}

function buildReimportTrace(
  previous: NovelReimportIndexProjection,
  current: NovelReimportIndexProjection,
): ReimportTrace {
  let plan: NovelReimportPlanV1;
  try {
    plan = buildNovelReimportPlanV1({
      previousBlockIndex: previous.blockIndex,
      currentBlockIndex: current.blockIndex,
      previousChapterIndex: previous.chapterIndex,
      currentChapterIndex: current.chapterIndex,
    });
  } catch (error) {
    invalid(
      'NOVEL_IMPORT_STRUCTURE_INVALID',
      isNovelImportError(error)
        ? readDetailReason(error) ?? 'reimport_plan_invalid'
        : 'reimport_plan_invalid',
      'The novel reimport plan could not be built from immutable revisions.',
    );
  }
  return {
    plan,
    impactSelectors: buildNovelImportImpactSelectorsV1(plan),
  };
}

function preserveReimportChapterIds(
  chapterIndex: ChapterIndexV1,
  plan: NovelReimportPlanV1,
): ChapterIndexV1 {
  const preservedByCurrent = new Map(
    plan.preservedChapters.map(item => [
      item.currentChapterId,
      item.preservedChapterId,
    ]),
  );
  if (preservedByCurrent.size === 0)
    return chapterIndex;

  return {
    ...chapterIndex,
    entries: chapterIndex.entries.map(entry => ({
      ...entry,
      chapterId: preservedByCurrent.get(entry.chapterId) ?? entry.chapterId,
    })),
    coverageReport: {
      ...chapterIndex.coverageReport,
      segments: chapterIndex.coverageReport.segments.map(segment => (
        segment.classification === 'chapter'
          ? {
              ...segment,
              chapterId: preservedByCurrent.get(segment.chapterId)
                ?? segment.chapterId,
            }
          : segment
      )),
    },
  };
}

function requirePersistableReimportSelector(
  trace: ReimportTrace,
): ArtifactSelector {
  const [impact] = trace.impactSelectors;
  if (
    trace.impactSelectors.length === 1
    && impact.changeScope !== 'display'
  ) {
    return impact.selector;
  }

  const detailReason = trace.impactSelectors.length === 0
    ? 'reimport_empty_change_selector_unavailable'
    : trace.impactSelectors.some(item => item.changeScope === 'display')
      ? 'reimport_display_change_scope_unavailable'
      : 'reimport_multiple_change_scopes_unavailable';
  throw new NovelImportApplicationError(
    'NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE',
    detailReason,
    'The current workflow cannot persist this scoped reimport impact without widening or dropping stale propagation.',
    {
      plan: trace.plan,
      impactSelectors: trace.impactSelectors,
    } as unknown as JsonValue,
  );
}

function assertReusableReimportArtifact(
  artifact: ArtifactRecord,
  baseline: ArtifactRecord,
  inputFingerprint: string,
): void {
  if (
    artifact.artifactId !== baseline.artifactId
    || artifact.artifactType !== baseline.artifactType
    || artifact.lineageId !== baseline.lineageId
    || artifact.storageKind !== baseline.storageKind
    || !sameArtifactScope(artifact.scope, baseline.scope)
    || artifact.inputFingerprint !== inputFingerprint
    || artifact.processorId !== NOVEL_IMPORT_APPLICATION_PROCESSOR_ID
    || artifact.processorVersion !== NOVEL_IMPORT_APPLICATION_PROCESSOR_VERSION
    || artifact.executionStatus !== 'succeeded'
    || (artifact.validityStatus !== 'current'
      && artifact.validityStatus !== 'superseded')
    || artifact.reviewStatus === 'rejected'
  ) {
    invalid(
      'NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE',
      'reimport_reusable_revision_invalid',
      'The reusable novel import revision does not belong to the active lineage.',
    );
  }
}

function assertReactivatedArtifact(
  artifact: ArtifactRecord,
  reusable: ArtifactRecord,
  baseline: ArtifactRecord,
): void {
  if (
    artifact.artifactId !== reusable.artifactId
    || artifact.artifactType !== reusable.artifactType
    || artifact.revisionId !== reusable.revisionId
    || artifact.lineageId !== reusable.lineageId
    || !sameArtifactScope(artifact.scope, reusable.scope)
    || artifact.storageKind !== reusable.storageKind
    || artifact.contentHash !== reusable.contentHash
    || artifact.contentPath !== reusable.contentPath
    || artifact.inputFingerprint !== reusable.inputFingerprint
    || artifact.parametersHash !== reusable.parametersHash
    || artifact.processorId !== reusable.processorId
    || artifact.processorVersion !== reusable.processorVersion
    || artifact.executionStatus !== reusable.executionStatus
    || artifact.executionStatus !== 'succeeded'
    || artifact.validityStatus !== 'current'
    || artifact.reviewStatus !== reusable.reviewStatus
    || artifact.reviewStatus === 'rejected'
    || artifact.createdAt !== reusable.createdAt
    || artifact.createdBy !== reusable.createdBy
    || baseline.revisionId === reusable.revisionId
  ) {
    invalid(
      'NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE',
      'reimport_activation_projection_invalid',
      'The activated historical revision does not match the reusable artifact.',
    );
  }
}

function assertCommittedReimportArtifact(
  artifact: ArtifactRecord,
  expected: CommittedReimportArtifactExpectation,
): void {
  const baseline = expected.baselineArtifact;
  const expectedReviewStatus = expected.reviewRequired ? 'pending' : 'not_required';
  if (
    artifact.artifactId !== baseline.artifactId
    || artifact.artifactType !== baseline.artifactType
    || artifact.lineageId !== baseline.lineageId
    || artifact.revisionId !== expected.revisionId
    || !sameArtifactScope(artifact.scope, baseline.scope)
    || artifact.storageKind !== baseline.storageKind
    || artifact.inputFingerprint !== expected.inputFingerprint
    || artifact.processorId !== NOVEL_IMPORT_APPLICATION_PROCESSOR_ID
    || artifact.processorVersion !== NOVEL_IMPORT_APPLICATION_PROCESSOR_VERSION
    || artifact.parametersHash !== expected.parametersHash
    || artifact.executionStatus !== 'succeeded'
    || artifact.validityStatus !== 'current'
    || artifact.reviewStatus !== expectedReviewStatus
    || artifact.createdBy !== expected.createdBy
    || !/^[0-9a-f]{64}$/u.test(artifact.contentHash)
  ) {
    invalid(
      'NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE',
      'reimport_commit_projection_invalid',
      'The committed reimport revision does not match the active lineage.',
    );
  }
  assertPortableRelativePath(
    artifact.contentPath,
    'committed_artifact_path_invalid',
    'NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE',
  );
  if (artifact.contentPath !== `artifacts/imported/${expected.revisionId}/content`) {
    invalid(
      'NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE',
      'committed_artifact_path_invalid',
      'Committed reimport artifact path does not match its revision.',
    );
  }
}

function assertReimportEnqueuedTask(
  task: TaskRecord,
  reused: boolean,
  projectId: string,
  inputFingerprint: string,
  outputScope: ArtifactRecord['scope'],
): void {
  const allowedStatus = reused
    ? ['pending', 'running', 'succeeded']
    : ['pending'];
  if (
    task?.projectId !== projectId
    || task.processorId !== NOVEL_IMPORT_APPLICATION_PROCESSOR_ID
    || task.inputFingerprint !== inputFingerprint
    || !sameArtifactScope(task.outputScope, outputScope)
    || !allowedStatus.includes(task.executionStatus)
    || typeof task.taskId !== 'string'
    || task.taskId.length === 0
  ) {
    invalid(
      'NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE',
      'reimport_task_projection_mismatch',
      'Enqueued novel reimport task does not match the active artifact lineage.',
    );
  }
  assertPortableRelativePath(
    task.temporaryPath,
    'enqueued_task_path_invalid',
    'NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE',
  );
  if (!task.temporaryPath.startsWith('tmp/')) {
    invalid(
      'NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE',
      'enqueued_task_path_invalid',
      'Enqueued novel reimport task path must remain below project tmp/.',
    );
  }
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

function assertEnqueuedTask(
  task: TaskRecord,
  reused: boolean,
  projectId: string,
  inputFingerprint: string,
  sourceAssetId: string,
): void {
  const allowedStatus = reused
    ? ['pending', 'running', 'succeeded']
    : ['pending'];
  if (
    task?.projectId !== projectId
    || task.processorId !== NOVEL_IMPORT_APPLICATION_PROCESSOR_ID
    || task.inputFingerprint !== inputFingerprint
    || task.outputScope?.kind !== 'novel-import'
    || !sameStrings(task.outputScope.identifiers, [sourceAssetId])
    || !allowedStatus.includes(task.executionStatus)
    || typeof task.taskId !== 'string'
    || task.taskId.length === 0
  ) {
    invalid(
      'NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE',
      'enqueued_task_projection_mismatch',
      'Enqueued novel import task does not match the requested processing identity.',
    );
  }
  assertPortableRelativePath(
    task.temporaryPath,
    'enqueued_task_path_invalid',
    'NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE',
  );
  if (!task.temporaryPath.startsWith('tmp/')) {
    invalid(
      'NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE',
      'enqueued_task_path_invalid',
      'Enqueued novel import task path must remain below project tmp/.',
    );
  }
}

function assertTxtAdapter(adapter: NovelSourceAdapter): void {
  if (
    adapter?.adapterId !== TXT_SOURCE_ADAPTER_ID
    || adapter.adapterVersion !== TXT_SOURCE_ADAPTER_VERSION
    || typeof adapter.probe !== 'function'
    || typeof adapter.validate !== 'function'
    || typeof adapter.extract !== 'function'
  ) {
    invalid(
      'NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE',
      'txt_adapter_version_mismatch',
      'The configured TXT adapter does not match the required version.',
    );
  }
}

function assertResolvedSource(
  source: NovelSourceAsset,
  record: SourceAssetRecord,
  expectedByteLength: number,
): void {
  if (
    source?.sourceAssetId !== record.sourceAssetId
    || source.sourceContentHash !== record.contentHash
    || source.sourceByteLength !== expectedByteLength
    || typeof source.openByteStream !== 'function'
  ) {
    invalid(
      'NOVEL_IMPORT_INVALID_SOURCE',
      'resolved_source_mismatch',
      'Resolved SourceAsset content does not match the committed record.',
    );
  }
}

function assertImportedNovel(
  importedNovel: ImportedNovelV1,
  sourceAsset: SourceAssetRecord,
  expectedByteLength: number,
  selectedEncoding: UserSelectedTxtSourceEncoding | undefined,
): void {
  const decision = importedNovel?.encodingDecision;
  if (
    importedNovel?.sourceAssetId !== sourceAsset.sourceAssetId
    || importedNovel.sourceHash !== sourceAsset.contentHash
    || importedNovel.sourceByteLength !== expectedByteLength
    || importedNovel.sourceFormat !== 'txt'
    || importedNovel.adapterId !== TXT_SOURCE_ADAPTER_ID
    || importedNovel.adapterVersion !== TXT_SOURCE_ADAPTER_VERSION
    || importedNovel.processorId !== TXT_IMPORT_PROCESSOR_ID
    || importedNovel.processorVersion !== TXT_IMPORT_PROCESSOR_VERSION
    || decision?.sourceContentHash !== sourceAsset.contentHash
    || (selectedEncoding !== undefined
      && (decision.sourceEncoding !== selectedEncoding || decision.method !== 'user'))
    || (selectedEncoding === undefined && decision?.method === 'user')
  ) {
    invalid(
      'NOVEL_IMPORT_INVALID_SOURCE',
      'imported_novel_projection_mismatch',
      'TXT adapter output does not match the committed SourceAsset and encoding request.',
    );
  }
}

function assertPendingProposals(
  proposals: readonly NormalizationProposalV1[],
): void {
  if (proposals.some(proposal => proposal.reviewStatus !== 'pending')) {
    invalid(
      'NOVEL_IMPORT_STRUCTURE_INVALID',
      'normalization_proposal_state_invalid',
      'Discovered normalization proposals must remain pending.',
    );
  }
}

function assertTaskOutputDirectory(
  artifact: NovelImportTemporaryArtifact,
  task: TaskRecord,
): void {
  const outputDirectory = artifact?.outputDirectory;
  if (typeof outputDirectory !== 'string') {
    invalid(
      'NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE',
      'artifact_output_invalid',
      'Temporary artifact writer returned an invalid output directory.',
    );
  }
  assertPortableRelativePath(
    outputDirectory,
    'artifact_output_invalid',
    'NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE',
  );
  const expectedPrefix = `${task.temporaryPath}/output/`;
  if (!outputDirectory.startsWith(expectedPrefix)) {
    invalid(
      'NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE',
      'artifact_output_outside_task',
      'Temporary artifact output must remain inside the active task output directory.',
    );
  }
}

function assertPortableTemporaryPath(value: string): void {
  assertPortableRelativePath(value, 'source_temporary_path_invalid');
  if (!value.startsWith('tmp/')) {
    invalid(
      'NOVEL_IMPORT_INVALID_SOURCE',
      'source_temporary_path_invalid',
      'TXT source temporary path must remain below project tmp/.',
    );
  }
}

function assertPortableRelativePath(
  value: string,
  detailReason: string,
  code: NovelImportErrorCode = 'NOVEL_IMPORT_INVALID_SOURCE',
): void {
  const components = typeof value === 'string' ? value.split('/') : [];
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.startsWith('/')
    || value.includes('\\')
    || components.some(component =>
      component.length === 0
      || component === '.'
      || component === '..'
      || component.endsWith('.')
      || component.endsWith(' ')
      || containsUnsafePathCharacter(component))
  ) {
    invalid(
      code,
      detailReason,
      'Project paths must be portable project-relative paths.',
    );
  }
}

function containsUnsafePathCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      '<>:"|?*'.includes(character)
      || (codePoint !== undefined && (codePoint <= 0x1F || codePoint === 0x7F))
    ) {
      return true;
    }
  }
  return false;
}

function requiresReview(bundle: NovelImportBundleV1): boolean {
  return bundle.importWarnings.length > 0
    || bundle.chapterIndex.reviewStatus === 'pending'
    || bundle.normalization.proposals.length > 0;
}

function normalizeFailure(
  error: unknown,
  boundary: FailureBoundary,
): NovelImportApplicationError {
  if (error instanceof NovelImportApplicationError)
    return error;
  if (isNovelImportError(error)) {
    return new NovelImportApplicationError(
      error.code,
      readDetailReason(error) ?? `${boundary}_failed`,
      failureMessage(boundary),
    );
  }
  const code: NovelImportErrorCode = boundary === 'text-processing'
    ? 'NOVEL_IMPORT_STRUCTURE_INVALID'
    : 'NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE';
  return new NovelImportApplicationError(
    code,
    `${boundary}_failed`,
    failureMessage(boundary),
  );
}

function isNovelImportError(
  error: unknown,
): error is { readonly code: NovelImportErrorCode; readonly detailReason?: string } {
  if (typeof error !== 'object' || error === null)
    return false;
  const code = Reflect.get(error, 'code');
  return typeof code === 'string'
    && (NOVEL_IMPORT_ERROR_CODES as readonly string[]).includes(code);
}

function readDetailReason(error: object): string | undefined {
  const value = Reflect.get(error, 'detailReason');
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function failureMessage(boundary: FailureBoundary): string {
  const messages: Record<FailureBoundary, string> = {
    'workflow-resolution': 'Unable to resolve the active project workflow.',
    'source-commit': 'Unable to commit the TXT SourceAsset.',
    'task-enqueue': 'Unable to enqueue the novel import task.',
    'task-start': 'Unable to start the novel import task.',
    'adapter-resolution': 'Unable to resolve the configured TXT adapter.',
    'source-resolution': 'Unable to resolve committed TXT content.',
    'adapter-processing': 'TXT adapter processing failed.',
    'text-processing': 'TXT structure processing failed.',
    'reimport-resolution': 'Unable to resolve novel reimport capabilities.',
    'reimport-history': 'Unable to read novel import revision history.',
    'reimport-activation': 'Unable to activate the reusable novel import revision.',
    'artifact-write': 'Unable to write the temporary novel import bundle.',
    'artifact-validation': 'Temporary novel import bundle validation failed.',
    'artifact-commit': 'Unable to commit the validated novel import bundle.',
  };
  return messages[boundary];
}

function sameTextRevision(
  left: TextRevisionRefV1 | undefined,
  right: TextRevisionRefV1 | undefined,
): boolean {
  return left !== undefined
    && right !== undefined
    && left.textRevisionId === right.textRevisionId
    && left.textLayer === right.textLayer
    && left.contentHash === right.contentHash
    && left.byteLength === right.byteLength;
}

function sameStringSets(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  const leftValues = [...(left ?? [])].sort();
  const rightValues = [...(right ?? [])].sort();
  return leftValues.length === rightValues.length
    && leftValues.every((value, index) => value === rightValues[index]);
}

function sameArtifactScope(
  left: ArtifactRecord['scope'] | undefined,
  right: ArtifactRecord['scope'] | undefined,
): boolean {
  return left !== undefined
    && right !== undefined
    && left.kind === right.kind
    && sameStrings(left.identifiers, right.identifiers);
}

function sameStrings(
  left: readonly string[] | undefined,
  right: readonly string[],
): boolean {
  return left !== undefined
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function invalid(
  code: NovelImportErrorCode,
  detailReason: string,
  message: string,
): never {
  throw new NovelImportApplicationError(code, detailReason, message);
}
