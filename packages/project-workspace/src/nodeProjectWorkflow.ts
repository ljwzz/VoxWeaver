import type {
  ArtifactDependency,
  ArtifactRecord,
  ArtifactRevisionDocument,
  ArtifactScope,
  ArtifactSelector,
  ExportSnapshotRecord,
  JsonValue,
  ProjectContext,
  ReviewDecisionRecord,
  SourceAssetRecord,
  StageRunRecord,
  StaleCause,
  TaskRecord,
} from '@voxweaver/contracts';
import type {
  ActivateArtifactRevisionCommand,
  ArtifactImpactPreview,
  CommitArtifactRevisionCommand,
  CreateExportSnapshotCommand,
  CreateStageRunCommand,
  EnqueueTaskCommand,
  EnqueueTaskResult,
  FailTaskCommand,
  PreviewArtifactImpactCommand,
  ProjectWorkflowPort,
  RecordReviewDecisionCommand,
  RegisterSourceAssetCommand,
  SourceAssetCommitCommand,
  SourceAssetCommitIntent,
  SourceAssetCommitPort,
  WorkflowRecoveryReport,
} from '@voxweaver/workflow-core';
import type { Stats } from 'node:fs';
import type {
  ProjectStateLifecycleOptions,
  SourceAssetCommitMapping,
} from './nodeProjectStateStore.js';
import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, constants as fileSystemConstants } from 'node:fs';
import {
  link,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rmdir,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
  sep,
} from 'node:path';
import {
  ARTIFACT_REVISION_DOCUMENT_SCHEMA_VERSION,
  parseArtifactRecord,
  parseArtifactRevisionDocument,
  parseProjectWriteLock,
  parseSourceAssetRecord,
} from '@voxweaver/contracts';
import {
  classifySourceAssetCommitAttempt,
  parseSourceAssetCommitCommand,
  sha256CanonicalJson,
  SourceAssetCommitError,
} from '@voxweaver/workflow-core';

import { NodeProjectStateStore } from './nodeProjectStateStore.js';
import { ProjectStateError } from './projectStateError.js';
import { ProjectWorkflowError } from './projectWorkflowError.js';

export type SourceAssetCommitCheckpoint
  = | 'before-inputs-write'
    | 'finalize-result-unknown'
    | 'publishing-temporary-ready'
    | 'published'
    | 'finalized';

export interface SourceAssetCommitCheckpointContext {
  readonly idempotencyKey: string;
  readonly publishingTemporaryRelativePath: string;
  readonly sourceAssetId: string;
  readonly targetRelativePath: string;
}

export interface NodeProjectWorkflowOptions extends ProjectStateLifecycleOptions {
  /** Deterministic crash-window barrier for SourceAsset commit tests. @internal */
  sourceAssetCommitCheckpoint?: (
    checkpoint: SourceAssetCommitCheckpoint,
    context: SourceAssetCommitCheckpointContext,
  ) => Promise<void> | void;
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SOURCE_ASSET_COPY_BUFFER_BYTES = 64 * 1024;
const SOURCE_ASSET_PUBLISHING_DIRECTORY_RELATIVE_PATH
  = 'inputs/.source-asset-commit-staging';
const SOURCE_ASSET_COMMIT_RECOVERY_REASON = 'source_asset_commit_unproven';
const PROJECT_WRITE_LOCK_MAX_BYTES = 16 * 1024;
const PROJECT_WRITE_LOCK_RELATIVE_PATH = 'state/locks/project-write.lock';

interface PhysicalFileIdentity {
  readonly device: number;
  readonly inode: number;
}

interface PhysicalFileEvidence {
  readonly byteLength: number;
  readonly contentHash: string;
  readonly identity: PhysicalFileIdentity;
  readonly linkCount: number;
}

type PhysicalFileObservation
  = | { readonly kind: 'missing' }
    | { readonly cause: unknown; readonly kind: 'invalid' }
    | { readonly byteLength: number; readonly kind: 'size-mismatch' }
    | { readonly evidence: PhysicalFileEvidence; readonly kind: 'file' };

interface SourceAssetCommitPaths {
  readonly publishingDirectory: string;
  readonly publishingTemporaryPath: string;
  readonly publishingTemporaryRelativePath: string;
  readonly targetDirectory: string;
  readonly targetPath: string;
}

interface SourceAssetCopyResult {
  readonly publishingEvidence: PhysicalFileEvidence;
  readonly sourceIdentity: PhysicalFileIdentity;
}

class SourceAssetCommitSupersededByCommitted extends Error {
  readonly mapping: SourceAssetCommitMapping;

  constructor(mapping: SourceAssetCommitMapping) {
    super('The source asset commit completed concurrently.');
    this.mapping = mapping;
  }
}

export class NodeProjectWorkflow implements ProjectWorkflowPort, SourceAssetCommitPort {
  readonly #context: ProjectContext;
  readonly #generateId: () => string;
  readonly #now: () => Date;
  readonly #sourceAssetCommitCheckpoint?: NonNullable<
    NodeProjectWorkflowOptions['sourceAssetCommitCheckpoint']
  >;

  constructor(
    context: ProjectContext,
    options: NodeProjectWorkflowOptions = {},
  ) {
    this.#context = context;
    this.#generateId = options.generateId ?? randomUUID;
    this.#now = options.now ?? (() => new Date());
    this.#sourceAssetCommitCheckpoint = options.sourceAssetCommitCheckpoint;
  }

  async activateArtifactRevision(
    command: ActivateArtifactRevisionCommand,
  ): Promise<ArtifactRecord> {
    validateSelector(command.changeSelector);
    return this.#withStore(store =>
      store.activateArtifactRevision(
        command.revisionId,
        command.changeSelector,
      ),
    );
  }

  cancelTask(taskId: string): Promise<TaskRecord> {
    return this.#withStore(store => store.cancelTask(taskId));
  }

  async commitSourceAsset(
    command: SourceAssetCommitCommand,
  ): Promise<SourceAssetRecord> {
    const parsedCommand = parseSourceAssetCommitCommand(command);
    if (this.#context.accessMode !== 'read-write') {
      throw new ProjectStateError(
        'PROJECT_STATE_READ_ONLY',
        'Source assets cannot be committed from a read-only project session.',
      );
    }
    await assertActiveProjectWriteSession(this.#context);

    const existing = await this.#withActiveSourceAssetStore(store =>
      store.getSourceAssetCommit(parsedCommand.idempotencyKey),
    );
    let mapping: SourceAssetCommitMapping;

    if (existing) {
      const classification = classifySourceAssetCommitAttempt(
        existing.idempotencyKey,
        sourceAssetCommitIntentFromMapping(existing),
        parsedCommand,
      );
      if (classification !== 'idempotent') {
        throw new SourceAssetCommitError(
          'SOURCE_ASSET_COMMIT_CONFLICT',
          'The source asset idempotency key is already bound to another intent.',
        );
      }
      mapping = existing;
    } else {
      const temporaryPath = sourceAssetTemporaryAbsolutePath(
        this.#context.projectDirectory,
        parsedCommand,
      );
      const temporaryObservation = await observePhysicalFileWithin(
        join(this.#context.projectDirectory, 'tmp'),
        temporaryPath,
        parsedCommand.expectedByteLength,
      );
      assertInitialSourceAssetTemporaryEvidence(
        temporaryObservation,
        parsedCommand,
      );

      const reservation = await this.#withActiveSourceAssetStore(store =>
        store.reserveSourceAssetCommit(parsedCommand),
      );
      if (reservation.classification === 'duplicate') {
        throw new SourceAssetCommitError(
          'SOURCE_ASSET_COMMIT_DUPLICATE',
          'Another idempotency key already owns this source asset identity.',
        );
      }
      if (reservation.classification === 'conflict') {
        throw new SourceAssetCommitError(
          'SOURCE_ASSET_COMMIT_CONFLICT',
          'The source asset idempotency key is already bound to another intent.',
        );
      }
      mapping = reservation.mapping;
    }

    let paths: SourceAssetCommitPaths;
    try {
      paths = sourceAssetCommitPaths(
        this.#context.projectDirectory,
        mapping,
      );
    } catch (error) {
      return this.#failSourceAssetCommitRecovery(
        mapping,
        'target_mapping_invalid',
        error,
      );
    }
    try {
      if (mapping.status === 'committed')
        return this.#completeCommittedSourceAssetRetry(mapping, paths);

      return await this.#continueSourceAssetCommit(
        parsedCommand,
        mapping,
        paths,
      );
    } catch (error) {
      if (error instanceof SourceAssetCommitSupersededByCommitted) {
        return this.#completeCommittedSourceAssetRetry(
          error.mapping,
          paths,
        );
      }
      throw error;
    }
  }

  async commitArtifactRevision(
    command: CommitArtifactRevisionCommand,
  ): Promise<ArtifactRecord> {
    assertSha256(command.inputFingerprint, 'input fingerprint');
    validateNonEmpty(command.artifactType, 'artifact type');
    validateNonEmpty(command.createdBy, 'artifact creator');
    validateNonEmpty(command.processorId, 'processor ID');
    validateNonEmpty(command.processorVersion, 'processor version');
    validateScope(command.scope);
    validateSelector(command.changeSelector);

    const outputDirectory = await resolvePhysicalPathWithin(
      this.#context.projectDirectory,
      command.outputDirectory,
      'tmp',
      true,
    );
    const artifactId = command.artifactId ?? this.#generateId();
    const lineageId = command.lineageId ?? artifactId;
    const revisionId = command.revisionId ?? this.#generateId();
    const relativeContentPath = posix.join(
      'artifacts',
      command.storageKind,
      revisionId,
      'content',
    );
    const revisionDirectory = join(
      this.#context.projectDirectory,
      'artifacts',
      command.storageKind,
      revisionId,
    );
    const finalContentDirectory = join(revisionDirectory, 'content');
    const contentHash = await hashPhysicalTree(outputDirectory);
    let parametersHash: string;
    try {
      parametersHash = sha256CanonicalJson(command.parameters);
    } catch (error) {
      throw new ProjectWorkflowError(
        'PROJECT_WORKFLOW_CONTENT_INVALID',
        'Artifact parameters must be finite, acyclic JSON.',
        error,
      );
    }
    const record: ArtifactRecord = {
      artifactId,
      artifactType: command.artifactType,
      lineageId,
      revisionId,
      scope: command.scope,
      storageKind: command.storageKind,
      contentPath: relativeContentPath,
      contentHash,
      inputFingerprint: command.inputFingerprint,
      processorId: command.processorId,
      processorVersion: command.processorVersion,
      parametersHash,
      executionStatus: 'succeeded',
      validityStatus: 'current',
      reviewStatus: command.reviewRequired ? 'pending' : 'not_required',
      createdAt: this.#now().toISOString(),
      createdBy: command.createdBy,
    };
    let revisionDocument: ArtifactRevisionDocument;
    try {
      parseArtifactRecord(record);
      revisionDocument = parseArtifactRevisionDocument({
        schemaVersion: ARTIFACT_REVISION_DOCUMENT_SCHEMA_VERSION,
        record,
        dependencies: command.dependencies ?? [],
      });
    } catch (error) {
      throw new ProjectWorkflowError(
        'PROJECT_WORKFLOW_CONTENT_INVALID',
        'Artifact provenance does not satisfy the workflow contract.',
        error,
      );
    }

    if (command.taskId) {
      const task = await this.getTask(command.taskId);
      if (
        !task
        || task.inputFingerprint !== command.inputFingerprint
        || !isPathWithin(
          join(
            this.#context.projectDirectory,
            task.temporaryPath,
            'output',
          ),
          outputDirectory,
        )
      ) {
        throw new ProjectWorkflowError(
          'PROJECT_WORKFLOW_TASK_MISMATCH',
          'The artifact output does not belong to the declared task.',
        );
      }
    }

    let reserved = false;
    try {
      await mkdir(revisionDirectory);
      reserved = true;
      await rename(outputDirectory, finalContentDirectory);
      const committedHash = await hashPhysicalTree(finalContentDirectory);
      if (committedHash !== contentHash) {
        throw new ProjectWorkflowError(
          'PROJECT_WORKFLOW_CONTENT_INVALID',
          'Artifact content changed while it was being committed.',
        );
      }
      await syncPhysicalTree(finalContentDirectory);
      await writeFile(
        join(revisionDirectory, 'revision.json'),
        `${JSON.stringify(revisionDocument, undefined, 2)}\n`,
        { encoding: 'utf8', flag: 'wx', flush: true },
      );

      return await this.#withStore(store => store.commitArtifact({
        activate: command.activate ?? true,
        ...(command.changeSelector
          ? { changeSelector: command.changeSelector }
          : {}),
        dependencies: command.dependencies ?? [],
        record,
        ...(command.taskId ? { taskId: command.taskId } : {}),
      }));
    } catch (error) {
      if (reserved) {
        try {
          await rmdir(revisionDirectory);
        } catch {
          // Non-empty formal content is retained for recovery, never deleted.
        }
      }
      if (isFileSystemError(error, 'EEXIST')) {
        throw new ProjectWorkflowError(
          'PROJECT_WORKFLOW_OUTPUT_CONFLICT',
          'The target artifact revision already exists.',
          error,
        );
      }
      throw error;
    }
  }

  createBackup(): Promise<string> {
    return this.#withStore(store => store.createBackup());
  }

  async createStageRun(command: CreateStageRunCommand): Promise<StageRunRecord> {
    assertSha256(command.inputFingerprint, 'input fingerprint');
    validateNonEmpty(command.stageId, 'stage ID');
    return this.#withStore(store =>
      store.createStageRun(command, this.#generateId()),
    );
  }

  async createExportSnapshot(
    command: CreateExportSnapshotCommand,
  ): Promise<ExportSnapshotRecord> {
    validateNonEmpty(command.createdBy, 'export snapshot creator');
    if (command.staleWaiverReason !== undefined)
      validateNonEmpty(command.staleWaiverReason, 'stale export waiver');
    return this.#withStore(store => store.createExportSnapshot(command));
  }

  async enqueueTask(command: EnqueueTaskCommand): Promise<EnqueueTaskResult> {
    assertSha256(command.inputFingerprint, 'input fingerprint');
    validateNonEmpty(command.processorId, 'processor ID');
    validateScope(command.outputScope);

    const taskId = this.#generateId();
    const temporaryPath = posix.join('tmp', taskId);
    const result = await this.#withStore(store =>
      store.enqueueTask(command, taskId, temporaryPath),
    );
    if (result.reused)
      return result;

    const temporaryDirectory = join(
      this.#context.projectDirectory,
      temporaryPath,
    );
    try {
      await mkdir(temporaryDirectory);
      await mkdir(join(temporaryDirectory, 'output'));
      await writeFile(
        join(temporaryDirectory, 'task-input.json'),
        `${JSON.stringify({ command, taskId }, undefined, 2)}\n`,
        { encoding: 'utf8', flag: 'wx', flush: true },
      );
      return result;
    } catch (error) {
      await this.failTask({
        taskId,
        errorCode: 'TASK_TEMPORARY_DIRECTORY_FAILED',
        errorMessage: 'Unable to prepare the task temporary directory.',
      });
      throw new ProjectWorkflowError(
        'PROJECT_WORKFLOW_PATH_INVALID',
        'Unable to prepare the task temporary directory.',
        error,
      );
    }
  }

  async failTask(command: FailTaskCommand): Promise<TaskRecord> {
    validateNonEmpty(command.errorCode, 'task error code');
    validateNonEmpty(command.errorMessage, 'task error message');
    return this.#withStore(store => store.failTask(command));
  }

  findReusableRevision(
    inputFingerprint: string,
    processorId: string,
    scope: ArtifactScope,
  ): Promise<ArtifactRecord | undefined> {
    return this.#withStore(store =>
      store.findReusableRevision(inputFingerprint, processorId, scope),
    );
  }

  getArtifactRevision(
    revisionId: string,
  ): Promise<ArtifactRecord | undefined> {
    return this.#withStore(store => store.getArtifactRevision(revisionId));
  }

  getTask(taskId: string): Promise<TaskRecord | undefined> {
    return this.#withStore(store => store.getTask(taskId));
  }

  getStageRun(stageRunId: string): Promise<StageRunRecord | undefined> {
    return this.#withStore(store => store.getStageRun(stageRunId));
  }

  listArtifactDependencies(
    revisionId: string,
  ): Promise<readonly ArtifactDependency[]> {
    return this.#withStore(store => store.listArtifactDependencies(revisionId));
  }

  listStaleCauses(revisionId: string): Promise<readonly StaleCause[]> {
    return this.#withStore(store => store.listStaleCauses(revisionId));
  }

  async previewArtifactImpact(
    command: PreviewArtifactImpactCommand,
  ): Promise<ArtifactImpactPreview> {
    validateSelector(command.changeSelector);
    return this.#withStore(store => store.previewArtifactImpact(command));
  }

  async recover(): Promise<WorkflowRecoveryReport> {
    const interruptedStageRunIds = await this.#withStore(store =>
      store.recoverInterruptedStageRuns(),
    );
    const interruptedTaskIds = await this.#withStore(store =>
      store.recoverInterruptedTasks(),
    );
    const { revisionPaths, taskPaths } = await this.#withStore(store => ({
      revisionPaths: store.listRevisionPaths(),
      taskPaths: store.listTaskPaths(),
    }));
    const missingRevisionIds: string[] = [];
    const restoredRevisionIds: string[] = [];
    const knownRevisionDirectories = new Set<string>();
    const artifactRoot = await realpath(
      join(this.#context.projectDirectory, 'artifacts'),
    );
    for (const revision of revisionPaths) {
      const absolutePath = resolve(
        this.#context.projectDirectory,
        revision.contentPath,
      );
      let contentMatches = false;
      if (
        isPathWithin(artifactRoot, absolutePath)
        && await isPhysicalDirectory(absolutePath)
      ) {
        knownRevisionDirectories.add(dirname(absolutePath));
        try {
          const document = parseArtifactRevisionDocument(JSON.parse(
            await readFile(join(dirname(absolutePath), 'revision.json'), 'utf8'),
          ));
          contentMatches = await hashPhysicalTree(absolutePath)
            === revision.contentHash
            && revisionDocumentMatches(document, revision);
        } catch {
          contentMatches = false;
        }
      }
      if (!contentMatches) {
        missingRevisionIds.push(revision.revisionId);
        await this.#withStore(store =>
          store.markRevisionMissing(revision.revisionId),
        );
      } else if (revision.record.validityStatus === 'missing') {
        restoredRevisionIds.push(revision.revisionId);
        await this.#withStore(store =>
          store.restoreRevision(revision.revisionId),
        );
      }
    }

    const orphanArtifactPaths: string[] = [];
    for (const storageKind of await readdir(
      join(this.#context.projectDirectory, 'artifacts'),
    )) {
      const storageDirectory = join(
        this.#context.projectDirectory,
        'artifacts',
        storageKind,
      );
      if (!await isPhysicalDirectory(storageDirectory))
        continue;
      for (const revisionDirectoryName of await readdir(storageDirectory)) {
        const revisionDirectory = join(storageDirectory, revisionDirectoryName);
        if (
          await isPhysicalDirectory(revisionDirectory)
          && !knownRevisionDirectories.has(revisionDirectory)
        ) {
          orphanArtifactPaths.push(
            toPortableRelativePath(
              this.#context.projectDirectory,
              revisionDirectory,
            ),
          );
        }
      }
    }

    const temporaryRoot = await realpath(
      join(this.#context.projectDirectory, 'tmp'),
    );
    const existingTaskPaths = new Set(
      [...taskPaths.values()]
        .map(path => resolve(this.#context.projectDirectory, path))
        .filter(path => isPathWithin(temporaryRoot, path)),
    );
    const orphanTemporaryPaths: string[] = [];
    for (const entry of await readdir(temporaryRoot)) {
      const entryPath = join(temporaryRoot, entry);
      if (
        await isPhysicalDirectory(entryPath)
        && !existingTaskPaths.has(entryPath)
      ) {
        orphanTemporaryPaths.push(toPortableRelativePath(
          this.#context.projectDirectory,
          entryPath,
        ));
      }
    }
    const resumableTaskIds: string[] = [];
    const retryableTaskIds: string[] = [];
    for (const [taskId, taskPath] of taskPaths) {
      const task = await this.getTask(taskId);
      if (!task)
        continue;
      const absoluteTaskPath = resolve(this.#context.projectDirectory, taskPath);
      const hasTemporaryDirectory = isPathWithin(temporaryRoot, absoluteTaskPath)
        && await isPhysicalDirectory(absoluteTaskPath);
      if (task.executionStatus === 'pending') {
        if (hasTemporaryDirectory) {
          resumableTaskIds.push(taskId);
        } else {
          retryableTaskIds.push(taskId);
          await this.#withStore(store => store.markTaskRetryable(taskId));
        }
      } else if (task.recoveryStatus === 'retryable') {
        retryableTaskIds.push(taskId);
      }
    }

    return {
      interruptedStageRunIds,
      interruptedTaskIds,
      missingRevisionIds,
      orphanArtifactPaths,
      orphanTemporaryPaths,
      resumableTaskIds,
      restoredRevisionIds,
      retryableTaskIds,
    };
  }

  async registerSourceAsset(
    command: RegisterSourceAssetCommand,
  ): Promise<SourceAssetRecord> {
    validateNonEmpty(command.sourceType, 'source type');
    validateNonEmpty(command.originalName, 'original name');
    validateNonEmpty(command.createdBy, 'source creator');
    const absolutePath = await resolvePhysicalPathWithin(
      this.#context.projectDirectory,
      command.relativePath,
      'inputs',
      false,
    );
    const record: SourceAssetRecord = {
      sourceAssetId: command.sourceAssetId ?? this.#generateId(),
      sourceType: command.sourceType,
      originalName: command.originalName,
      contentHash: await hashPhysicalTree(absolutePath),
      relativePath: toPortableRelativePath(
        this.#context.projectDirectory,
        absolutePath,
      ),
      createdAt: this.#now().toISOString(),
      createdBy: command.createdBy,
    };
    try {
      parseSourceAssetRecord(record);
    } catch (error) {
      throw new ProjectWorkflowError(
        'PROJECT_WORKFLOW_CONTENT_INVALID',
        'Source asset metadata does not satisfy the workflow contract.',
        error,
      );
    }
    return this.#withStore(store => store.registerSourceAsset(record));
  }

  async recordReviewDecision(
    command: RecordReviewDecisionCommand,
  ): Promise<ReviewDecisionRecord> {
    validateNonEmpty(command.decidedBy, 'reviewer');
    if (!['approved', 'rejected'].includes(command.decision)) {
      throw new ProjectWorkflowError(
        'PROJECT_WORKFLOW_CONTENT_INVALID',
        'The review decision must be approved or rejected.',
      );
    }
    if (command.note !== undefined)
      validateNonEmpty(command.note, 'review note');
    return this.#withStore(store => store.recordReviewDecision(command));
  }

  resolveStaleCause(staleCauseId: string): Promise<StaleCause> {
    return this.#withStore(store => store.resolveStaleCause(staleCauseId));
  }

  startTask(taskId: string): Promise<TaskRecord> {
    return this.#withStore(store => store.startTask(taskId));
  }

  startStageRun(stageRunId: string): Promise<StageRunRecord> {
    return this.#withStore(store => store.startStageRun(stageRunId));
  }

  async finishStageRun(
    stageRunId: string,
    status: 'canceled' | 'failed' | 'succeeded',
  ): Promise<StageRunRecord> {
    if (!['canceled', 'failed', 'succeeded'].includes(status)) {
      throw new ProjectWorkflowError(
        'PROJECT_WORKFLOW_CONTENT_INVALID',
        'The stage run completion status is invalid.',
      );
    }
    return this.#withStore(store => store.finishStageRun(stageRunId, status));
  }

  async #completeCommittedSourceAssetRetry(
    mapping: SourceAssetCommitMapping,
    paths: SourceAssetCommitPaths,
  ): Promise<SourceAssetRecord> {
    const targetEvidence = await this.#proveFinalSourceAssetTarget(
      mapping,
      paths,
    );
    if (
      !mapping.sourceAsset
      || !sourceAssetRecordMatchesMapping(mapping.sourceAsset, mapping)
    ) {
      return this.#failSourceAssetCommitRecovery(
        mapping,
        'committed_target_unproven',
      );
    }

    if (targetEvidence.linkCount === 2) {
      await unlinkMatchingFileBestEffort(
        paths.publishingTemporaryPath,
        targetEvidence.identity,
      );
    }
    return mapping.sourceAsset;
  }

  async #continueSourceAssetCommit(
    command: SourceAssetCommitCommand,
    mapping: SourceAssetCommitMapping,
    paths: SourceAssetCommitPaths,
  ): Promise<SourceAssetRecord> {
    const inputsRoot = join(this.#context.projectDirectory, 'inputs');
    const target = await observePhysicalFileWithin(
      inputsRoot,
      paths.targetPath,
      mapping.expectedByteLength,
    );
    if (target.kind === 'invalid') {
      return this.#failSourceAssetCommitRecovery(
        mapping,
        'target_path_invalid',
        target.cause,
      );
    }
    if (target.kind === 'size-mismatch') {
      return this.#failSourceAssetCommitRecovery(
        mapping,
        'target_content_conflict',
      );
    }
    if (target.kind === 'file') {
      if (!sourceAssetEvidenceMatches(target.evidence, mapping)) {
        return this.#failSourceAssetCommitRecovery(
          mapping,
          'target_content_conflict',
        );
      }
      return this.#finalizeSourceAssetCommit(command, mapping, paths);
    }

    const publishingTemporary = await observePhysicalFileWithin(
      inputsRoot,
      paths.publishingTemporaryPath,
      mapping.expectedByteLength,
    );
    if (publishingTemporary.kind === 'invalid') {
      return this.#failSourceAssetCommitRecovery(
        mapping,
        'publishing_temporary_path_invalid',
        publishingTemporary.cause,
      );
    }
    if (publishingTemporary.kind === 'size-mismatch') {
      return this.#failConcurrentSourceAssetCommit(
        command,
        mapping,
        paths,
        'publishing_temporary_content_conflict',
      );
    }
    if (publishingTemporary.kind === 'file') {
      if (!sourceAssetEvidenceMatches(publishingTemporary.evidence, mapping)) {
        return this.#failConcurrentSourceAssetCommit(
          command,
          mapping,
          paths,
          'publishing_temporary_content_conflict',
        );
      }
      return this.#publishAndFinalizeSourceAsset(
        command,
        mapping,
        paths,
        publishingTemporary.evidence,
      );
    }

    const sourcePath = sourceAssetTemporaryAbsolutePath(
      this.#context.projectDirectory,
      command,
    );
    const source = await observePhysicalFileWithin(
      join(this.#context.projectDirectory, 'tmp'),
      sourcePath,
      mapping.expectedByteLength,
    );
    if (
      source.kind !== 'file'
      || !sourceAssetEvidenceMatches(source.evidence, mapping)
    ) {
      return this.#failSourceAssetCommitRecovery(
        mapping,
        source.kind === 'invalid'
          ? 'temporary_source_path_invalid'
          : source.kind === 'missing'
            ? 'commit_evidence_missing'
            : 'temporary_source_content_conflict',
        source.kind === 'invalid' ? source.cause : undefined,
      );
    }

    await this.#checkpointSourceAssetCommit(
      'before-inputs-write',
      mapping,
      paths,
    );
    await assertActiveProjectWriteSession(this.#context);
    try {
      await ensureSourceAssetPublishingDirectory(
        this.#context.projectDirectory,
        mapping,
        paths,
      );
    } catch (error) {
      return this.#failSourceAssetCommitRecovery(
        mapping,
        'publishing_directory_invalid',
        error,
      );
    }

    const concurrentTarget = await observePhysicalFileWithin(
      inputsRoot,
      paths.targetPath,
      mapping.expectedByteLength,
    );
    if (concurrentTarget.kind === 'file') {
      if (!sourceAssetEvidenceMatches(concurrentTarget.evidence, mapping)) {
        return this.#failSourceAssetCommitRecovery(
          mapping,
          'target_content_conflict',
        );
      }
      return this.#finalizeSourceAssetCommit(command, mapping, paths);
    }
    if (concurrentTarget.kind === 'invalid') {
      return this.#failSourceAssetCommitRecovery(
        mapping,
        'target_path_invalid',
        concurrentTarget.cause,
      );
    }
    if (concurrentTarget.kind === 'size-mismatch') {
      return this.#failSourceAssetCommitRecovery(
        mapping,
        'target_content_conflict',
      );
    }

    const concurrentTemporary = await observePhysicalFileWithin(
      inputsRoot,
      paths.publishingTemporaryPath,
      mapping.expectedByteLength,
    );
    if (concurrentTemporary.kind === 'file') {
      if (!sourceAssetEvidenceMatches(concurrentTemporary.evidence, mapping)) {
        return this.#failConcurrentSourceAssetCommit(
          command,
          mapping,
          paths,
          'publishing_temporary_content_conflict',
        );
      }
      return this.#publishAndFinalizeSourceAsset(
        command,
        mapping,
        paths,
        concurrentTemporary.evidence,
      );
    }
    if (concurrentTemporary.kind === 'invalid') {
      return this.#failSourceAssetCommitRecovery(
        mapping,
        'publishing_temporary_path_invalid',
        concurrentTemporary.cause,
      );
    }
    if (concurrentTemporary.kind === 'size-mismatch') {
      return this.#failConcurrentSourceAssetCommit(
        command,
        mapping,
        paths,
        'publishing_temporary_content_conflict',
      );
    }

    let copyResult: SourceAssetCopyResult;
    await assertActiveProjectWriteSession(this.#context);
    try {
      copyResult = await copyPhysicalFileExclusive(
        join(this.#context.projectDirectory, 'tmp'),
        sourcePath,
        inputsRoot,
        paths.publishingTemporaryPath,
        mapping.expectedByteLength,
      );
    } catch (error) {
      if (
        isFileSystemError(error, 'EEXIST')
        || isFileSystemError(error, 'ENOENT')
      ) {
        return this.#failConcurrentSourceAssetCommit(
          command,
          mapping,
          paths,
          'source_copy_raced',
          error,
        );
      }
      return this.#failSourceAssetCommitRecovery(
        mapping,
        'source_copy_failed',
        error,
      );
    }
    if (!sourceAssetEvidenceMatches(copyResult.publishingEvidence, mapping)) {
      await unlinkMatchingFileBestEffort(
        paths.publishingTemporaryPath,
        copyResult.publishingEvidence.identity,
      );
      return this.#failSourceAssetCommitRecovery(
        mapping,
        'temporary_source_changed_after_reservation',
      );
    }

    await this.#checkpointSourceAssetCommit(
      'publishing-temporary-ready',
      mapping,
      paths,
    );
    return this.#publishAndFinalizeSourceAsset(
      command,
      mapping,
      paths,
      copyResult.publishingEvidence,
      copyResult.sourceIdentity,
    );
  }

  async #failConcurrentSourceAssetCommit(
    command: SourceAssetCommitCommand,
    mapping: SourceAssetCommitMapping,
    paths: SourceAssetCommitPaths,
    detail: string,
    cause?: unknown,
  ): Promise<SourceAssetRecord> {
    const recovery = await this.#markSourceAssetCommitRecovery(mapping);
    const inputsRoot = join(this.#context.projectDirectory, 'inputs');
    const target = await observePhysicalFileWithin(
      inputsRoot,
      paths.targetPath,
      mapping.expectedByteLength,
    );
    if (
      target.kind === 'file'
      && sourceAssetEvidenceMatches(target.evidence, recovery)
    ) {
      return this.#finalizeSourceAssetCommit(command, recovery, paths);
    }
    const publishingTemporary = await observePhysicalFileWithin(
      inputsRoot,
      paths.publishingTemporaryPath,
      mapping.expectedByteLength,
    );
    if (
      publishingTemporary.kind === 'file'
      && publishingTemporary.evidence.linkCount === 1
      && sourceAssetEvidenceMatches(publishingTemporary.evidence, recovery)
    ) {
      return this.#publishAndFinalizeSourceAsset(
        command,
        recovery,
        paths,
        publishingTemporary.evidence,
      );
    }
    throw sourceAssetCommitRecoveryError(
      recovery,
      detail,
      cause,
    );
  }

  async #publishAndFinalizeSourceAsset(
    command: SourceAssetCommitCommand,
    mapping: SourceAssetCommitMapping,
    paths: SourceAssetCommitPaths,
    publishingTemporaryEvidence: PhysicalFileEvidence,
    temporarySourceIdentity?: PhysicalFileIdentity,
  ): Promise<SourceAssetRecord> {
    await assertActiveProjectWriteSession(this.#context);
    try {
      const inputsRoot = join(this.#context.projectDirectory, 'inputs');
      await assertPhysicalDirectoryWithin(
        inputsRoot,
        paths.publishingDirectory,
      );
      await assertPhysicalDirectoryWithin(inputsRoot, paths.targetDirectory);
    } catch (error) {
      return this.#failSourceAssetCommitRecovery(
        mapping,
        'publishing_directory_invalid',
        error,
      );
    }
    const currentPublishingTemporary = await observePhysicalFileWithin(
      join(this.#context.projectDirectory, 'inputs'),
      paths.publishingTemporaryPath,
      mapping.expectedByteLength,
    );
    if (
      currentPublishingTemporary.kind !== 'file'
    ) {
      if (currentPublishingTemporary.kind === 'missing') {
        return this.#failConcurrentSourceAssetCommit(
          command,
          mapping,
          paths,
          'publishing_temporary_disappeared_before_publish',
        );
      }
      return this.#failSourceAssetCommitRecovery(
        mapping,
        'publishing_temporary_changed_before_publish',
        currentPublishingTemporary.kind === 'invalid'
          ? currentPublishingTemporary.cause
          : undefined,
      );
    }
    if (
      !sourceAssetEvidenceMatches(currentPublishingTemporary.evidence, mapping)
      || !physicalFileIdentitiesEqual(
        currentPublishingTemporary.evidence.identity,
        publishingTemporaryEvidence.identity,
      )
    ) {
      return this.#failSourceAssetCommitRecovery(
        mapping,
        'publishing_temporary_identity_conflict',
      );
    }
    if (currentPublishingTemporary.evidence.linkCount === 2) {
      const linkedTarget = await observePhysicalFileWithin(
        join(this.#context.projectDirectory, 'inputs'),
        paths.targetPath,
        mapping.expectedByteLength,
      );
      if (
        linkedTarget.kind === 'file'
        && linkedTarget.evidence.linkCount === 2
        && sourceAssetEvidenceMatches(linkedTarget.evidence, mapping)
        && physicalFileIdentitiesEqual(
          linkedTarget.evidence.identity,
          currentPublishingTemporary.evidence.identity,
        )
      ) {
        return this.#finalizeSourceAssetCommit(
          command,
          mapping,
          paths,
          temporarySourceIdentity,
        );
      }
      return this.#failSourceAssetCommitRecovery(
        mapping,
        'publishing_temporary_link_identity_conflict',
      );
    }
    if (currentPublishingTemporary.evidence.linkCount !== 1) {
      return this.#failSourceAssetCommitRecovery(
        mapping,
        'publishing_temporary_link_count_invalid',
      );
    }
    try {
      await syncPhysicalFileIdentity(
        paths.publishingTemporaryPath,
        publishingTemporaryEvidence.identity,
      );
    } catch (error) {
      return this.#failSourceAssetCommitRecovery(
        mapping,
        'publishing_temporary_sync_failed',
        error,
      );
    }

    let published = false;
    await assertActiveProjectWriteSession(this.#context);
    try {
      await link(paths.publishingTemporaryPath, paths.targetPath);
      published = true;
    } catch (error) {
      const target = await observePhysicalFileWithin(
        join(this.#context.projectDirectory, 'inputs'),
        paths.targetPath,
        mapping.expectedByteLength,
      );
      if (
        target.kind === 'file'
        && sourceAssetEvidenceMatches(target.evidence, mapping)
      ) {
        return this.#finalizeSourceAssetCommit(
          command,
          mapping,
          paths,
          temporarySourceIdentity,
        );
      }
      if (isFileSystemError(error, 'EEXIST')) {
        return this.#failSourceAssetCommitRecovery(
          mapping,
          'target_content_conflict',
          target.kind === 'invalid' ? target.cause : error,
        );
      }
      if (isFileSystemError(error, 'ENOENT')) {
        return this.#failConcurrentSourceAssetCommit(
          command,
          mapping,
          paths,
          'source_publish_raced',
          error,
        );
      }
      return this.#failSourceAssetCommitRecovery(
        mapping,
        'source_publish_failed',
        error,
      );
    }

    if (published) {
      const publishedTarget = await observePhysicalFileWithin(
        join(this.#context.projectDirectory, 'inputs'),
        paths.targetPath,
        mapping.expectedByteLength,
      );
      if (
        publishedTarget.kind !== 'file'
        || !sourceAssetEvidenceMatches(publishedTarget.evidence, mapping)
        || !physicalFileIdentitiesEqual(
          publishedTarget.evidence.identity,
          publishingTemporaryEvidence.identity,
        )
        || ![1, 2].includes(publishedTarget.evidence.linkCount)
      ) {
        return this.#failSourceAssetCommitRecovery(
          mapping,
          'published_target_identity_unproven',
          publishedTarget.kind === 'invalid'
            ? publishedTarget.cause
            : undefined,
        );
      }
    }

    if (published) {
      await this.#checkpointSourceAssetCommit(
        'published',
        mapping,
        paths,
      );
    }
    return this.#finalizeSourceAssetCommit(
      command,
      mapping,
      paths,
      temporarySourceIdentity,
    );
  }

  async #finalizeSourceAssetCommit(
    command: SourceAssetCommitCommand,
    mapping: SourceAssetCommitMapping,
    paths: SourceAssetCommitPaths,
    temporarySourceIdentity?: PhysicalFileIdentity,
  ): Promise<SourceAssetRecord> {
    let targetEvidence = await this.#proveFinalSourceAssetTarget(
      mapping,
      paths,
    );

    const record = parseSourceAssetRecord({
      sourceAssetId: mapping.sourceAssetId,
      sourceType: mapping.sourceType,
      originalName: mapping.originalName,
      contentHash: mapping.expectedContentHash,
      relativePath: mapping.targetRelativePath,
      createdAt: mapping.createdAt,
      createdBy: mapping.createdBy,
    });
    let finalized: SourceAssetRecord;
    try {
      finalized = await this.#withActiveSourceAssetStore(store =>
        store.finalizeSourceAssetCommit(
          mapping.idempotencyKey,
          mapping.expectedByteLength,
          record,
        ),
      );
      await this.#checkpointSourceAssetCommit(
        'finalize-result-unknown',
        mapping,
        paths,
      );
    } catch (error) {
      const observed = await this.#withActiveSourceAssetStore(store =>
        store.getSourceAssetCommit(mapping.idempotencyKey),
      );
      if (
        observed?.status === 'committed'
        && observed.sourceAsset
        && sourceAssetRecordMatchesMapping(observed.sourceAsset, observed)
      ) {
        await this.#proveFinalSourceAssetTarget(observed, paths);
        finalized = observed.sourceAsset;
      } else {
        return this.#failSourceAssetCommitRecovery(
          observed ?? mapping,
          'source_asset_finalize_failed',
          error,
        );
      }
    }
    await this.#checkpointSourceAssetCommit(
      'finalized',
      mapping,
      paths,
    );
    targetEvidence = await this.#proveFinalSourceAssetTarget(mapping, paths);
    if (temporarySourceIdentity) {
      await cleanupCommandTemporarySourceBestEffort(
        this.#context.projectDirectory,
        command,
        temporarySourceIdentity,
      );
    }
    if (targetEvidence.linkCount === 2) {
      await unlinkMatchingFileBestEffort(
        paths.publishingTemporaryPath,
        targetEvidence.identity,
      );
    }
    return finalized;
  }

  async #proveFinalSourceAssetTarget(
    mapping: SourceAssetCommitMapping,
    paths: SourceAssetCommitPaths,
  ): Promise<PhysicalFileEvidence> {
    const inputsRoot = join(this.#context.projectDirectory, 'inputs');
    const target = await observePhysicalFileWithin(
      inputsRoot,
      paths.targetPath,
      mapping.expectedByteLength,
    );
    if (
      target.kind !== 'file'
      || !sourceAssetEvidenceMatches(target.evidence, mapping)
    ) {
      return this.#failSourceAssetCommitRecovery(
        mapping,
        'target_unproven_before_finalize',
        target.kind === 'invalid' ? target.cause : undefined,
      );
    }
    if (target.evidence.linkCount === 1)
      return target.evidence;

    const publishingTemporary = await observePhysicalFileWithin(
      inputsRoot,
      paths.publishingTemporaryPath,
      mapping.expectedByteLength,
    );
    if (
      target.evidence.linkCount === 2
      && publishingTemporary.kind === 'file'
      && publishingTemporary.evidence.linkCount === 2
      && sourceAssetEvidenceMatches(publishingTemporary.evidence, mapping)
      && physicalFileIdentitiesEqual(
        publishingTemporary.evidence.identity,
        target.evidence.identity,
      )
    ) {
      return target.evidence;
    }

    const refreshedTarget = await observePhysicalFileWithin(
      inputsRoot,
      paths.targetPath,
      mapping.expectedByteLength,
    );
    if (
      target.evidence.linkCount === 2
      && refreshedTarget.kind === 'file'
      && refreshedTarget.evidence.linkCount === 1
      && sourceAssetEvidenceMatches(refreshedTarget.evidence, mapping)
      && physicalFileIdentitiesEqual(
        refreshedTarget.evidence.identity,
        target.evidence.identity,
      )
    ) {
      return refreshedTarget.evidence;
    }

    return this.#failSourceAssetCommitRecovery(
      mapping,
      'target_link_identity_unproven',
      publishingTemporary.kind === 'invalid'
        ? publishingTemporary.cause
        : undefined,
    );
  }

  async #failSourceAssetCommitRecovery(
    mapping: SourceAssetCommitMapping,
    detail: string,
    cause?: unknown,
  ): Promise<never> {
    const recovery = await this.#markSourceAssetCommitRecovery(mapping);
    throw sourceAssetCommitRecoveryError(recovery, detail, cause);
  }

  async #markSourceAssetCommitRecovery(
    mapping: SourceAssetCommitMapping,
  ): Promise<SourceAssetCommitMapping> {
    let recovery: SourceAssetCommitMapping;
    try {
      recovery = await this.#withActiveSourceAssetStore((store) => {
        const current = store.getSourceAssetCommit(mapping.idempotencyKey);
        if (!current) {
          throw new ProjectStateError(
            'PROJECT_STATE_NOT_FOUND',
            'The source asset commit reservation no longer exists.',
          );
        }
        if (current.status === 'committed' && mapping.status !== 'committed')
          return current;
        return store.markSourceAssetCommitRecoveryRequired(
          mapping.idempotencyKey,
          current.recoveryReason ?? SOURCE_ASSET_COMMIT_RECOVERY_REASON,
        );
      });
      if (recovery.status === 'committed' && mapping.status !== 'committed')
        throw new SourceAssetCommitSupersededByCommitted(recovery);
    } catch (error) {
      if (error instanceof SourceAssetCommitSupersededByCommitted)
        throw error;
      const observed = await this.#withActiveSourceAssetStore(store =>
        store.getSourceAssetCommit(mapping.idempotencyKey),
      );
      if (observed?.status === 'committed' && mapping.status !== 'committed')
        throw new SourceAssetCommitSupersededByCommitted(observed);
      if (observed?.status !== 'recovery_required')
        throw error;
      recovery = observed;
    }
    return recovery;
  }

  async #checkpointSourceAssetCommit(
    checkpoint: SourceAssetCommitCheckpoint,
    mapping: SourceAssetCommitMapping,
    paths: SourceAssetCommitPaths,
  ): Promise<void> {
    await this.#sourceAssetCommitCheckpoint?.(checkpoint, {
      idempotencyKey: mapping.idempotencyKey,
      publishingTemporaryRelativePath:
        paths.publishingTemporaryRelativePath,
      sourceAssetId: mapping.sourceAssetId,
      targetRelativePath: mapping.targetRelativePath,
    });
  }

  async #withStore<T>(
    operation: (store: NodeProjectStateStore) => Promise<T> | T,
  ): Promise<T> {
    const store = await NodeProjectStateStore.open({
      accessMode: this.#context.accessMode,
      projectDirectory: this.#context.projectDirectory,
      projectId: this.#context.manifest.projectId,
      generateId: this.#generateId,
      now: this.#now,
    });
    try {
      return await operation(store);
    } finally {
      store.close();
    }
  }

  async #withActiveSourceAssetStore<T>(
    operation: (store: NodeProjectStateStore) => Promise<T> | T,
  ): Promise<T> {
    await assertActiveProjectWriteSession(this.#context);
    return this.#withStore(operation);
  }
}

async function assertActiveProjectWriteSession(
  context: ProjectContext,
): Promise<void> {
  try {
    await assertCanonicalPhysicalDirectory(context.projectDirectory);
    const lockDirectory = join(context.projectDirectory, 'state/locks');
    await assertPhysicalDirectoryWithin(
      context.projectDirectory,
      lockDirectory,
    );
    const lockPath = join(
      context.projectDirectory,
      PROJECT_WRITE_LOCK_RELATIVE_PATH,
    );
    await assertNoSymbolicPath(lockDirectory, lockPath);
    const pathEntry = await lstat(lockPath);
    if (
      pathEntry.isSymbolicLink()
      || !pathEntry.isFile()
      || pathEntry.size > PROJECT_WRITE_LOCK_MAX_BYTES
    ) {
      throw new Error('The project write lock is not a supported physical file.');
    }
    const handle = await open(
      lockPath,
      fileSystemConstants.O_RDONLY | fileSystemConstants.O_NOFOLLOW,
    );
    let contents: string;
    try {
      const openedEntry = await handle.stat();
      if (
        !openedEntry.isFile()
        || openedEntry.dev !== pathEntry.dev
        || openedEntry.ino !== pathEntry.ino
        || openedEntry.size > PROJECT_WRITE_LOCK_MAX_BYTES
      ) {
        throw new Error('The project write lock changed while opening.');
      }
      contents = await handle.readFile({ encoding: 'utf8' });
      const finalEntry = await handle.stat();
      if (
        finalEntry.dev !== openedEntry.dev
        || finalEntry.ino !== openedEntry.ino
        || finalEntry.size !== openedEntry.size
      ) {
        throw new Error('The project write lock changed while reading.');
      }
    } finally {
      await handle.close();
    }
    const lock = parseProjectWriteLock(JSON.parse(contents));
    if (
      lock.projectId !== context.manifest.projectId
      || lock.projectSessionId !== context.projectSessionId
    ) {
      throw new Error('The project write session is no longer active.');
    }
  } catch (error) {
    throw new ProjectStateError(
      'PROJECT_STATE_CONFLICT',
      'The source asset commit requires the active project write session.',
      error,
    );
  }
}

function sourceAssetCommitIntentFromMapping(
  mapping: SourceAssetCommitMapping,
): SourceAssetCommitIntent {
  return {
    expectedContentHash: mapping.expectedContentHash,
    expectedByteLength: mapping.expectedByteLength,
    originalName: mapping.originalName,
    sourceType: mapping.sourceType,
    createdBy: mapping.createdBy,
  };
}

function sourceAssetCommitRecoveryError(
  mapping: SourceAssetCommitMapping,
  detail: string,
  cause?: unknown,
): SourceAssetCommitError {
  return new SourceAssetCommitError(
    'SOURCE_ASSET_COMMIT_RECOVERY_REQUIRED',
    `Source asset commit requires recovery: ${mapping.recoveryReason} (${detail}).`,
    cause,
  );
}

function sourceAssetTemporaryAbsolutePath(
  projectDirectory: string,
  command: SourceAssetCommitCommand,
): string {
  const temporaryRoot = resolve(projectDirectory, 'tmp');
  const temporaryPath = resolve(
    projectDirectory,
    command.temporarySource.relativePath,
  );
  if (
    !isPathWithin(temporaryRoot, temporaryPath)
    || temporaryPath === temporaryRoot
  ) {
    throw new SourceAssetCommitError(
      'SOURCE_ASSET_COMMIT_COMMAND_INVALID',
      'The source asset temporary file must remain below project tmp/.',
    );
  }
  return temporaryPath;
}

function sourceAssetCommitPaths(
  projectDirectory: string,
  mapping: SourceAssetCommitMapping,
): SourceAssetCommitPaths {
  const expectedTargetRelativePath = posix.join(
    'inputs',
    'source-assets',
    mapping.sourceAssetId,
    mapping.originalName,
  );
  if (mapping.targetRelativePath !== expectedTargetRelativePath) {
    throw new Error(
      'The source asset target does not match its deterministic reservation.',
    );
  }
  const publishingTemporaryRelativePath = posix.join(
    SOURCE_ASSET_PUBLISHING_DIRECTORY_RELATIVE_PATH,
    `${mapping.sourceAssetId}.tmp`,
  );
  const inputsRoot = resolve(projectDirectory, 'inputs');
  const publishingDirectory = resolve(
    projectDirectory,
    SOURCE_ASSET_PUBLISHING_DIRECTORY_RELATIVE_PATH,
  );
  const publishingTemporaryPath = resolve(
    projectDirectory,
    publishingTemporaryRelativePath,
  );
  const targetDirectory = resolve(
    projectDirectory,
    posix.dirname(expectedTargetRelativePath),
  );
  const targetPath = resolve(projectDirectory, expectedTargetRelativePath);
  if (
    !isPathWithin(inputsRoot, publishingDirectory)
    || !isPathWithin(inputsRoot, publishingTemporaryPath)
    || !isPathWithin(inputsRoot, targetDirectory)
    || !isPathWithin(inputsRoot, targetPath)
  ) {
    throw new Error('The source asset target escapes project inputs/.');
  }
  return {
    publishingDirectory,
    publishingTemporaryPath,
    publishingTemporaryRelativePath,
    targetDirectory,
    targetPath,
  };
}

function assertInitialSourceAssetTemporaryEvidence(
  observation: PhysicalFileObservation,
  command: SourceAssetCommitCommand,
): asserts observation is Extract<PhysicalFileObservation, { kind: 'file' }> {
  if (observation.kind === 'size-mismatch') {
    throw new SourceAssetCommitError(
      'SOURCE_ASSET_COMMIT_CONTENT_MISMATCH',
      'The source asset temporary size does not match the expected byte length.',
    );
  }
  if (observation.kind !== 'file') {
    throw new SourceAssetCommitError(
      'SOURCE_ASSET_COMMIT_COMMAND_INVALID',
      'The source asset temporary source must be a physical file below project tmp/.',
      observation.kind === 'invalid' ? observation.cause : undefined,
    );
  }
  if (!sourceAssetEvidenceMatches(observation.evidence, command)) {
    throw new SourceAssetCommitError(
      'SOURCE_ASSET_COMMIT_CONTENT_MISMATCH',
      'The source asset temporary bytes do not match the expected hash and size.',
    );
  }
}

function sourceAssetEvidenceMatches(
  evidence: PhysicalFileEvidence,
  expected: {
    readonly expectedByteLength: number;
    readonly expectedContentHash: string;
  },
): boolean {
  return evidence.byteLength === expected.expectedByteLength
    && evidence.contentHash === expected.expectedContentHash;
}

function sourceAssetRecordMatchesMapping(
  record: SourceAssetRecord,
  mapping: SourceAssetCommitMapping,
): boolean {
  return record.sourceAssetId === mapping.sourceAssetId
    && record.sourceType === mapping.sourceType
    && record.originalName === mapping.originalName
    && record.contentHash === mapping.expectedContentHash
    && record.relativePath === mapping.targetRelativePath
    && record.createdAt === mapping.createdAt
    && record.createdBy === mapping.createdBy;
}

async function observePhysicalFileWithin(
  root: string,
  path: string,
  expectedByteLength?: number,
): Promise<PhysicalFileObservation> {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(path);
  if (!isPathWithin(resolvedRoot, resolvedPath) || resolvedRoot === resolvedPath) {
    return {
      kind: 'invalid',
      cause: new Error('The observed file escapes its required root.'),
    };
  }

  try {
    await assertCanonicalPhysicalDirectory(resolvedRoot);
    await assertNoSymbolicPath(resolvedRoot, resolvedPath);
    const canonicalRoot = await realpath(root);
    const canonicalPath = await realpath(path);
    if (canonicalRoot !== resolvedRoot)
      throw new Error('The observed root must be a physical directory.');
    if (!isPathWithin(canonicalRoot, canonicalPath) || canonicalRoot === canonicalPath) {
      throw new Error('The observed file escapes its physical root.');
    }

    const pathEntry = await lstat(path);
    if (pathEntry.isSymbolicLink() || !pathEntry.isFile())
      throw new Error('The observed path is not a physical regular file.');

    const handle = await open(
      path,
      fileSystemConstants.O_RDONLY | fileSystemConstants.O_NOFOLLOW,
    );
    try {
      const openedEntry = await handle.stat();
      if (
        !openedEntry.isFile()
        || openedEntry.dev !== pathEntry.dev
        || openedEntry.ino !== pathEntry.ino
      ) {
        throw new Error('The observed file changed while it was opened.');
      }
      if (
        expectedByteLength !== undefined
        && openedEntry.size !== expectedByteLength
      ) {
        return {
          kind: 'size-mismatch',
          byteLength: openedEntry.size,
        };
      }
      return {
        kind: 'file',
        evidence: await readPhysicalFileEvidence(handle, openedEntry),
      };
    } finally {
      await handle.close();
    }
  } catch (error) {
    return isFileSystemError(error, 'ENOENT')
      ? { kind: 'missing' }
      : { kind: 'invalid', cause: error };
  }
}

async function readPhysicalFileEvidence(
  handle: Awaited<ReturnType<typeof open>>,
  openedEntry: Stats,
): Promise<PhysicalFileEvidence> {
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(SOURCE_ASSET_COPY_BUFFER_BYTES);
  let byteLength = 0;
  while (true) {
    const remaining = openedEntry.size - byteLength;
    if (remaining === 0)
      break;
    const { bytesRead } = await handle.read(
      buffer,
      0,
      Math.min(buffer.length, remaining),
      byteLength,
    );
    if (bytesRead === 0)
      throw new Error('The physical file ended before its measured size.');
    hash.update(buffer.subarray(0, bytesRead));
    byteLength += bytesRead;
  }
  const finalEntry = await handle.stat();
  if (
    finalEntry.dev !== openedEntry.dev
    || finalEntry.ino !== openedEntry.ino
    || finalEntry.size !== byteLength
  ) {
    throw new Error('The physical file changed while it was measured.');
  }
  return {
    byteLength,
    contentHash: hash.digest('hex'),
    identity: {
      device: finalEntry.dev,
      inode: finalEntry.ino,
    },
    linkCount: finalEntry.nlink,
  };
}

async function copyPhysicalFileExclusive(
  sourceRoot: string,
  sourcePath: string,
  targetRoot: string,
  targetPath: string,
  expectedByteLength: number,
): Promise<SourceAssetCopyResult> {
  await assertPhysicalDirectoryWithin(sourceRoot, dirname(sourcePath));
  await assertNoSymbolicPath(resolve(sourceRoot), resolve(sourcePath));
  const canonicalSourceRoot = await realpath(sourceRoot);
  const canonicalSourcePath = await realpath(sourcePath);
  if (
    canonicalSourceRoot !== resolve(sourceRoot)
    || !isPathWithin(canonicalSourceRoot, canonicalSourcePath)
  ) {
    throw new Error('The source asset temporary source escapes project tmp/.');
  }
  await assertPhysicalDirectoryWithin(targetRoot, dirname(targetPath));

  const sourcePathEntry = await lstat(sourcePath);
  if (sourcePathEntry.isSymbolicLink() || !sourcePathEntry.isFile())
    throw new Error('The source asset temporary source is not a regular file.');

  const source = await open(
    sourcePath,
    fileSystemConstants.O_RDONLY | fileSystemConstants.O_NOFOLLOW,
  );
  let target: Awaited<ReturnType<typeof open>> | undefined;
  let targetIdentity: PhysicalFileIdentity | undefined;
  try {
    const sourceEntry = await source.stat();
    if (
      !sourceEntry.isFile()
      || sourceEntry.dev !== sourcePathEntry.dev
      || sourceEntry.ino !== sourcePathEntry.ino
    ) {
      throw new Error('The source asset temporary source changed before copy.');
    }
    if (sourceEntry.size !== expectedByteLength)
      throw new Error('The source asset temporary source size changed before copy.');

    target = await open(targetPath, 'wx', 0o600);
    const targetEntry = await target.stat();
    targetIdentity = {
      device: targetEntry.dev,
      inode: targetEntry.ino,
    };
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(SOURCE_ASSET_COPY_BUFFER_BYTES);
    let byteLength = 0;
    while (byteLength < sourceEntry.size) {
      const remaining = sourceEntry.size - byteLength;
      const { bytesRead } = await source.read(
        buffer,
        0,
        Math.min(buffer.length, remaining),
        byteLength,
      );
      if (bytesRead === 0)
        throw new Error('The source asset ended before its measured size.');
      hash.update(buffer.subarray(0, bytesRead));
      let written = 0;
      while (written < bytesRead) {
        const result = await target.write(
          buffer,
          written,
          bytesRead - written,
          byteLength + written,
        );
        if (result.bytesWritten === 0)
          throw new Error('The source asset copy made no forward progress.');
        written += result.bytesWritten;
      }
      byteLength += bytesRead;
    }
    const finalSourceEntry = await source.stat();
    if (
      finalSourceEntry.dev !== sourceEntry.dev
      || finalSourceEntry.ino !== sourceEntry.ino
      || finalSourceEntry.size !== byteLength
    ) {
      throw new Error('The source asset temporary source changed during copy.');
    }
    await target.sync();
    const finalTargetEntry = await target.stat();
    if (
      finalTargetEntry.dev !== targetEntry.dev
      || finalTargetEntry.ino !== targetEntry.ino
      || finalTargetEntry.size !== byteLength
    ) {
      throw new Error('The source asset publishing temporary changed during copy.');
    }
    await target.close();
    target = undefined;
    return {
      publishingEvidence: {
        byteLength,
        contentHash: hash.digest('hex'),
        identity: targetIdentity,
        linkCount: finalTargetEntry.nlink,
      },
      sourceIdentity: {
        device: finalSourceEntry.dev,
        inode: finalSourceEntry.ino,
      },
    };
  } catch (error) {
    await target?.close().catch(() => {});
    target = undefined;
    if (targetIdentity)
      await unlinkMatchingFileBestEffort(targetPath, targetIdentity);
    throw error;
  } finally {
    await target?.close().catch(() => {});
    await source.close().catch(() => {});
  }
}

async function ensureSourceAssetPublishingDirectory(
  projectDirectory: string,
  mapping: SourceAssetCommitMapping,
  paths: SourceAssetCommitPaths,
): Promise<void> {
  const inputsRoot = join(projectDirectory, 'inputs');
  const sourceAssetsRoot = join(inputsRoot, 'source-assets');
  const targetDirectory = join(sourceAssetsRoot, mapping.sourceAssetId);
  const publishingDirectory = join(
    projectDirectory,
    SOURCE_ASSET_PUBLISHING_DIRECTORY_RELATIVE_PATH,
  );
  if (
    targetDirectory !== paths.targetDirectory
    || publishingDirectory !== paths.publishingDirectory
  ) {
    throw new Error('The source asset publishing paths are not deterministic.');
  }

  await assertCanonicalPhysicalDirectory(projectDirectory);
  await assertPhysicalDirectoryWithin(projectDirectory, inputsRoot);
  await ensurePhysicalChildDirectory(inputsRoot, sourceAssetsRoot);
  await ensurePhysicalChildDirectory(sourceAssetsRoot, targetDirectory);
  await ensurePhysicalChildDirectory(inputsRoot, publishingDirectory);
}

async function ensurePhysicalChildDirectory(
  root: string,
  path: string,
): Promise<void> {
  if (!isPathWithin(root, path) || root === path)
    throw new Error('The source asset directory escapes its physical root.');
  await assertCanonicalPhysicalDirectory(root);
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if (!isFileSystemError(error, 'EEXIST'))
      throw error;
  }
  await assertPhysicalDirectory(path);
  const canonicalRoot = await realpath(root);
  const canonicalPath = await realpath(path);
  if (!isPathWithin(canonicalRoot, canonicalPath) || canonicalRoot === canonicalPath)
    throw new Error('The source asset directory escapes its physical root.');
}

async function assertPhysicalDirectory(path: string): Promise<void> {
  const entry = await lstat(path);
  if (entry.isSymbolicLink() || !entry.isDirectory())
    throw new Error('The source asset directory must be a physical directory.');
}

async function assertCanonicalPhysicalDirectory(path: string): Promise<void> {
  const resolvedPath = resolve(path);
  await assertPhysicalDirectory(resolvedPath);
  if (await realpath(resolvedPath) !== resolvedPath)
    throw new Error('The source asset directory must have physical ancestors.');
}

async function assertPhysicalDirectoryWithin(
  root: string,
  path: string,
): Promise<void> {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(path);
  if (!isPathWithin(resolvedRoot, resolvedPath))
    throw new Error('The source asset directory escapes its required root.');
  await assertNoSymbolicPath(resolvedRoot, resolvedPath);
  const canonicalRoot = await realpath(resolvedRoot);
  const canonicalPath = await realpath(resolvedPath);
  if (
    canonicalRoot !== resolvedRoot
    || !isPathWithin(canonicalRoot, canonicalPath)
  ) {
    throw new Error('The source asset directory escapes its physical root.');
  }
  await assertPhysicalDirectory(resolvedPath);
}

async function cleanupCommandTemporarySourceBestEffort(
  projectDirectory: string,
  command: SourceAssetCommitCommand,
  expectedIdentity: PhysicalFileIdentity,
): Promise<void> {
  try {
    const root = join(projectDirectory, 'tmp');
    const path = sourceAssetTemporaryAbsolutePath(projectDirectory, command);
    const observation = await observePhysicalFileWithin(
      root,
      path,
      command.expectedByteLength,
    );
    if (
      observation.kind === 'file'
      && sourceAssetEvidenceMatches(observation.evidence, command)
      && physicalFileIdentitiesEqual(
        observation.evidence.identity,
        expectedIdentity,
      )
    ) {
      await unlinkMatchingFileBestEffort(path, observation.evidence.identity);
    }
  } catch {
    // A committed source asset does not depend on cleanup of its temporary input.
  }
}

async function syncPhysicalFileIdentity(
  path: string,
  expectedIdentity: PhysicalFileIdentity,
): Promise<void> {
  const pathEntry = await lstat(path);
  if (
    pathEntry.isSymbolicLink()
    || !pathEntry.isFile()
    || pathEntry.nlink !== 1
    || !physicalFileIdentitiesEqual(
      { device: pathEntry.dev, inode: pathEntry.ino },
      expectedIdentity,
    )
  ) {
    throw new Error('The publishing temporary identity changed before sync.');
  }
  const handle = await open(
    path,
    fileSystemConstants.O_RDONLY | fileSystemConstants.O_NOFOLLOW,
  );
  try {
    const openedEntry = await handle.stat();
    if (
      !openedEntry.isFile()
      || openedEntry.nlink !== 1
      || !physicalFileIdentitiesEqual(
        { device: openedEntry.dev, inode: openedEntry.ino },
        expectedIdentity,
      )
    ) {
      throw new Error('The publishing temporary changed while opening for sync.');
    }
    await handle.sync();
    const finalEntry = await handle.stat();
    if (
      finalEntry.nlink !== 1
      || !physicalFileIdentitiesEqual(
        { device: finalEntry.dev, inode: finalEntry.ino },
        expectedIdentity,
      )
    ) {
      throw new Error('The publishing temporary changed while syncing.');
    }
  } finally {
    await handle.close();
  }
}

async function unlinkMatchingFileBestEffort(
  path: string,
  identity: PhysicalFileIdentity,
): Promise<void> {
  try {
    const entry = await lstat(path);
    if (
      !entry.isSymbolicLink()
      && entry.isFile()
      && entry.dev === identity.device
      && entry.ino === identity.inode
    ) {
      await unlink(path);
    }
  } catch {
    // Cleanup cannot change the already-proven commit result.
  }
}

function physicalFileIdentitiesEqual(
  left: PhysicalFileIdentity,
  right: PhysicalFileIdentity,
): boolean {
  return left.device === right.device && left.inode === right.inode;
}

function revisionDocumentMatches(
  document: ArtifactRevisionDocument,
  stored: {
    readonly dependencies: readonly ArtifactDependency[];
    readonly record: ArtifactRecord;
  },
): boolean {
  if (
    sha256CanonicalJson(immutableArtifactRecord(document.record))
    !== sha256CanonicalJson(immutableArtifactRecord(stored.record))
  ) {
    return false;
  }
  const documentDependencies = document.dependencies
    .map(dependency => sha256CanonicalJson(
      dependency as unknown as JsonValue,
    ))
    .sort();
  const storedDependencies = stored.dependencies
    .map(dependency => sha256CanonicalJson({
      dependencyType: dependency.dependencyType,
      producerArtifactId: dependency.producerArtifactId,
      producerRevisionId: dependency.producerRevisionId,
      ...(dependency.selector ? { selector: dependency.selector } : {}),
    } as unknown as JsonValue))
    .sort();
  return documentDependencies.length === storedDependencies.length
    && documentDependencies.every((value, index) =>
      value === storedDependencies[index],
    );
}

function immutableArtifactRecord(record: ArtifactRecord): JsonValue {
  return {
    artifactId: record.artifactId,
    artifactType: record.artifactType,
    lineageId: record.lineageId,
    revisionId: record.revisionId,
    scope: record.scope,
    storageKind: record.storageKind,
    contentPath: record.contentPath,
    contentHash: record.contentHash,
    inputFingerprint: record.inputFingerprint,
    processorId: record.processorId,
    processorVersion: record.processorVersion,
    parametersHash: record.parametersHash,
    createdAt: record.createdAt,
    createdBy: record.createdBy,
  } as unknown as JsonValue;
}

async function resolvePhysicalPathWithin(
  projectDirectory: string,
  requestedPath: string,
  requiredRoot: 'inputs' | 'tmp',
  requireDirectory: boolean,
): Promise<string> {
  if (typeof requestedPath !== 'string' || requestedPath.length === 0) {
    throw new ProjectWorkflowError(
      'PROJECT_WORKFLOW_PATH_INVALID',
      'The workflow path is required.',
    );
  }
  const absolutePath = isAbsolute(requestedPath)
    ? resolve(requestedPath)
    : resolve(projectDirectory, requestedPath);
  const lexicalRoot = resolve(projectDirectory, requiredRoot);
  if (!isPathWithin(lexicalRoot, absolutePath)) {
    throw new ProjectWorkflowError(
      'PROJECT_WORKFLOW_PATH_INVALID',
      `The workflow path must remain inside project ${requiredRoot}/.`,
    );
  }
  const root = await realpath(lexicalRoot);
  let canonicalPath: string;
  try {
    await assertNoSymbolicPath(lexicalRoot, absolutePath);
    canonicalPath = await realpath(absolutePath);
    const entry = await lstat(canonicalPath);
    if (entry.isSymbolicLink() || (requireDirectory && !entry.isDirectory()))
      throw new Error('Workflow path type is invalid.');
    if (!requireDirectory && !entry.isFile() && !entry.isDirectory())
      throw new Error('Workflow source path type is invalid.');
  } catch (error) {
    throw new ProjectWorkflowError(
      'PROJECT_WORKFLOW_PATH_INVALID',
      'The workflow path does not reference supported physical content.',
      error,
    );
  }
  if (!isPathWithin(root, canonicalPath)) {
    throw new ProjectWorkflowError(
      'PROJECT_WORKFLOW_PATH_INVALID',
      `The workflow path must remain inside project ${requiredRoot}/.`,
    );
  }
  if (canonicalPath === root) {
    throw new ProjectWorkflowError(
      'PROJECT_WORKFLOW_PATH_INVALID',
      `The workflow path must identify content below project ${requiredRoot}/.`,
    );
  }
  return canonicalPath;
}

async function assertNoSymbolicPath(
  root: string,
  path: string,
): Promise<void> {
  const rootEntry = await lstat(root);
  if (rootEntry.isSymbolicLink() || !rootEntry.isDirectory())
    throw new Error('Workflow path roots must be physical directories.');
  let current = root;
  const child = relative(root, path);
  for (const component of child.split(sep).filter(Boolean)) {
    current = join(current, component);
    if ((await lstat(current)).isSymbolicLink())
      throw new Error('Workflow paths must not contain symbolic links.');
  }
}

function isPathWithin(root: string, path: string): boolean {
  const child = relative(root, path);
  return child === '' || (!child.startsWith('..') && !isAbsolute(child));
}

function toPortableRelativePath(root: string, path: string): string {
  return relative(root, path).split(sep).join('/');
}

async function hashPhysicalTree(path: string): Promise<string> {
  const hash = createHash('sha256');
  const rootEntry = await lstat(path);
  if (rootEntry.isSymbolicLink()) {
    throw new ProjectWorkflowError(
      'PROJECT_WORKFLOW_CONTENT_INVALID',
      'Workflow content must not contain symbolic links.',
    );
  }
  if (rootEntry.isFile()) {
    await updateHashFromFile(hash, path, basename(path));
    return hash.digest('hex');
  }
  if (!rootEntry.isDirectory()) {
    throw new ProjectWorkflowError(
      'PROJECT_WORKFLOW_CONTENT_INVALID',
      'Workflow content must be a physical file or directory.',
    );
  }
  await updateHashFromDirectory(hash, path, path);
  return hash.digest('hex');
}

async function syncPhysicalTree(path: string): Promise<void> {
  const entry = await lstat(path);
  if (entry.isSymbolicLink()) {
    throw new ProjectWorkflowError(
      'PROJECT_WORKFLOW_CONTENT_INVALID',
      'Workflow content must not contain symbolic links.',
    );
  }
  if (entry.isDirectory()) {
    for (const child of await readdir(path))
      await syncPhysicalTree(join(path, child));
    return;
  }
  if (!entry.isFile()) {
    throw new ProjectWorkflowError(
      'PROJECT_WORKFLOW_CONTENT_INVALID',
      'Workflow content contains an unsupported filesystem entry.',
    );
  }
  const handle = await open(path, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function updateHashFromDirectory(
  hash: ReturnType<typeof createHash>,
  root: string,
  directory: string,
): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    const entryStat = await lstat(entryPath);
    if (entryStat.isSymbolicLink()) {
      throw new ProjectWorkflowError(
        'PROJECT_WORKFLOW_CONTENT_INVALID',
        'Workflow content must not contain symbolic links.',
      );
    }
    const relativePath = relative(root, entryPath);
    if (entryStat.isDirectory()) {
      hash.update(`directory\0${relativePath}\0`);
      await updateHashFromDirectory(hash, root, entryPath);
    } else if (entryStat.isFile()) {
      await updateHashFromFile(hash, entryPath, relativePath);
    } else {
      throw new ProjectWorkflowError(
        'PROJECT_WORKFLOW_CONTENT_INVALID',
        'Workflow content contains an unsupported filesystem entry.',
      );
    }
  }
}

async function updateHashFromFile(
  hash: ReturnType<typeof createHash>,
  path: string,
  relativePath: string,
): Promise<void> {
  const size = (await stat(path)).size;
  hash.update(`file\0${relativePath}\0${size}\0`);
  for await (const chunk of createReadStream(path))
    hash.update(chunk);
  hash.update('\0');
}

async function isPhysicalDirectory(path: string): Promise<boolean> {
  try {
    const entry = await lstat(path);
    return entry.isDirectory() && !entry.isSymbolicLink();
  } catch {
    return false;
  }
}

function validateScope(scope: ArtifactScope): void {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) {
    throw new ProjectWorkflowError(
      'PROJECT_WORKFLOW_CONTENT_INVALID',
      'Artifact scope must be an object.',
    );
  }
  validateNonEmpty(scope.kind, 'scope kind');
  if (
    !Array.isArray(scope.identifiers)
    || scope.identifiers.some(identifier =>
      typeof identifier !== 'string' || identifier.length === 0)
    || new Set(scope.identifiers).size !== scope.identifiers.length
  ) {
    throw new ProjectWorkflowError(
      'PROJECT_WORKFLOW_CONTENT_INVALID',
      'Artifact scope identifiers must be non-empty strings.',
    );
  }
}

function validateSelector(selector: ArtifactSelector | undefined): void {
  if (selector === undefined)
    return;
  if (!selector || typeof selector !== 'object' || Array.isArray(selector)) {
    throw new ProjectWorkflowError(
      'PROJECT_WORKFLOW_CONTENT_INVALID',
      'Artifact selector must be an object.',
    );
  }
  const allowedKeys = new Set([
    'blockIds',
    'chapterIds',
    'dictionaryEntryIds',
    'scriptUnitIds',
    'voiceProfileIds',
  ]);
  const entries = Object.entries(selector);
  if (
    entries.length === 0
    || entries.some(([key, values]) =>
      !allowedKeys.has(key)
      || !Array.isArray(values)
      || values.length === 0
      || values.some(value =>
        typeof value !== 'string' || value.length === 0,
      )
      || new Set(values).size !== values.length)
  ) {
    throw new ProjectWorkflowError(
      'PROJECT_WORKFLOW_CONTENT_INVALID',
      'Artifact selectors must contain unique, non-empty stable identifiers.',
    );
  }
}

function validateNonEmpty(value: string, name: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ProjectWorkflowError(
      'PROJECT_WORKFLOW_CONTENT_INVALID',
      `The ${name} must be a non-empty string.`,
    );
  }
}

function assertSha256(value: string, name: string): void {
  if (!SHA256_PATTERN.test(value)) {
    throw new ProjectWorkflowError(
      'PROJECT_WORKFLOW_CONTENT_INVALID',
      `The ${name} must be a lowercase SHA-256 digest.`,
    );
  }
}

function isFileSystemError(
  error: unknown,
  code: string,
): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === code;
}
