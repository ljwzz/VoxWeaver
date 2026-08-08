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
  WorkflowRecoveryReport,
} from '@voxweaver/workflow-core';
import type { ProjectStateLifecycleOptions } from './nodeProjectStateStore.js';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rmdir,
  stat,
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
  parseSourceAssetRecord,
} from '@voxweaver/contracts';
import { sha256CanonicalJson } from '@voxweaver/workflow-core';

import { NodeProjectStateStore } from './nodeProjectStateStore.js';
import { ProjectWorkflowError } from './projectWorkflowError.js';

export interface NodeProjectWorkflowOptions extends ProjectStateLifecycleOptions {}

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export class NodeProjectWorkflow implements ProjectWorkflowPort {
  readonly #context: ProjectContext;
  readonly #generateId: () => string;
  readonly #now: () => Date;

  constructor(
    context: ProjectContext,
    options: NodeProjectWorkflowOptions = {},
  ) {
    this.#context = context;
    this.#generateId = options.generateId ?? randomUUID;
    this.#now = options.now ?? (() => new Date());
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
