/// <reference types="node" />

import type {
  ArtifactRecord,
  ArtifactSelector,
  ChapterCandidateV1,
  ChapterIndexV1,
  ImportedNovelV1,
  ImportIssueV1,
  JsonValue,
  NovelImportErrorCode,
  ProjectContext,
  SourceAssetRecord,
  TaskRecord,
  TextRangeMapV1,
  TextRevisionRefV1,
  UserSelectedTxtSourceEncoding,
} from '@voxweaver/contracts';
import type { DocumentBlockIndexV1 } from '@voxweaver/novel-domain';
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
  ProjectWorkflowPort,
  SourceAssetCommitPort,
} from '@voxweaver/workflow-core';
import type { ProjectApplicationService } from './projectApplicationService.js';
import type { ProjectSessionIdentity } from './projectWorkflowApplicationService.js';

import { randomUUID } from 'node:crypto';

import {
  BLOCK_ALIGNMENT_POLICY_VERSION,
  NOVEL_IMPORT_ERROR_CODES,
  TXT_SOURCE_ENCODINGS,
} from '@voxweaver/contracts';
import { DOCUMENT_BLOCK_INDEX_SCHEMA_VERSION } from '@voxweaver/novel-domain';
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
  computeInputFingerprint,
  sha256CanonicalJson,
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

export interface NovelImportApplicationServiceOptions {
  readonly createOpaqueId?: () => string;
}

export class NovelImportApplicationError extends Error {
  constructor(
    readonly code: NovelImportErrorCode,
    readonly detailReason: string,
    message: string,
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
          const inputFingerprint = computeInputFingerprint({
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

type FailureBoundary
  = | 'workflow-resolution'
    | 'source-commit'
    | 'task-enqueue'
    | 'task-start'
    | 'adapter-resolution'
    | 'source-resolution'
    | 'adapter-processing'
    | 'text-processing'
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
    'artifact-write': 'Unable to write the temporary novel import bundle.',
    'artifact-validation': 'Temporary novel import bundle validation failed.',
    'artifact-commit': 'Unable to commit the validated novel import bundle.',
  };
  return messages[boundary];
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
