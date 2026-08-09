import type {
  AppCoreService,
  DesktopTrustedRequestContext,
} from '@voxweaver/app-core';
import type {
  ArtifactRecord,
  DesktopNovelImportErrorCode,
  DesktopNovelImportErrorV1,
  DesktopNovelImportEventV1,
  DesktopNovelImportMethodName,
  DesktopNovelImportMethodPayload,
  DesktopNovelImportTaskV1,
  NovelImportErrorCode,
  NovelImportReviewBaselineV1,
  ProjectContext,
  TaskRecord,
  TextRevisionRefV1,
} from '@voxweaver/contracts';
import type { CoreTrustedRequestContext } from '../shared/coreTransport.js';

import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import {
  constants,
  lstat,
  mkdir,
  open,
  realpath,
  rm,
  rmdir,
} from 'node:fs/promises';
import {
  basename,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';

import {
  DESKTOP_NOVEL_IMPORT_CONTRACT_VERSION,
  DESKTOP_NOVEL_IMPORT_ERROR_RETRYABILITY,
  DESKTOP_NOVEL_IMPORT_EVENT_TYPES,
  DESKTOP_NOVEL_IMPORT_METHOD_NAMES,
  isDesktopNovelImportMethodName,
  NOVEL_IMPORT_ERROR_CODES,
  NOVEL_IMPORT_REVIEW_SCHEMA_VERSION,
  parseDesktopNovelImportError,
  parseDesktopNovelImportEvent,
  parseDesktopNovelImportMethodPayload,
  parseDesktopNovelImportMethodResult,
  parseTextRevisionRefV1,
} from '@voxweaver/contracts';

const INVALID_PROJECT_ID = '00000000-0000-4000-8000-000000000000';
const INVALID_PROJECT_SESSION_ID = '00000000-0000-4000-8000-000000000001';
const NOVEL_IMPORT_PROCESSOR_ID = 'voxweaver.application.novel-import';
const NOVEL_IMPORT_ARTIFACT_TYPE = 'novel-import-bundle.v1';
const STAGING_DIRECTORY_NAME = 'desktop-novel-import';
const STREAM_CHUNK_BYTES = 64 * 1024;
const INVALID_SOURCE_FILE_SYSTEM_CODES = new Set([
  'EACCES',
  'EISDIR',
  'ELOOP',
  'ENAMETOOLONG',
  'ENOENT',
  'ENOTDIR',
  'EPERM',
  'ESTALE',
]);
const UUID_V4_PATTERN
  = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

interface GeneralDesktopDispatcher {
  readonly dispatch: (
    request: unknown,
    trustedContext?: DesktopTrustedRequestContext,
  ) => Promise<unknown>;
}

interface NovelImportPayloadEnvelope {
  readonly messageKind: 'payload';
  readonly method: DesktopNovelImportMethodName;
  readonly payload: DesktopNovelImportMethodPayload;
}

interface NovelImportResultEnvelope {
  readonly messageKind: 'result';
  readonly method: DesktopNovelImportMethodName;
  readonly result: unknown;
}

interface NovelImportErrorEnvelope {
  readonly messageKind: 'error';
  readonly error: DesktopNovelImportErrorV1;
}

interface StagedNovelSource {
  readonly byteLength: number;
  readonly cleanup: () => Promise<void>;
  readonly contentHash: string;
  readonly temporaryRelativePath: string;
}

interface ImportedBundleProjection {
  readonly canonical?: {
    readonly revision?: unknown;
  };
}

export interface DesktopNovelImportCoreDispatcherOptions {
  readonly core: AppCoreService;
  readonly createId?: () => string;
  readonly fallback: GeneralDesktopDispatcher;
  readonly now?: () => Date;
}

/**
 * Routes the independent M1 envelope without weakening the established desktop
 * request dispatcher. Source paths remain private Core capabilities and are
 * copied into the active project's tmp/ directory before Application use.
 */
export class DesktopNovelImportCoreDispatcher {
  readonly #core: AppCoreService;
  readonly #createId: () => string;
  readonly #fallback: GeneralDesktopDispatcher;
  readonly #listeners = new Set<(event: DesktopNovelImportEventV1) => void>();
  readonly #now: () => Date;
  readonly #sequences = new Map<string, number>();

  constructor(options: DesktopNovelImportCoreDispatcherOptions) {
    this.#core = options.core;
    this.#createId = options.createId ?? randomUUID;
    this.#fallback = options.fallback;
    this.#now = options.now ?? (() => new Date());
  }

  subscribe(listener: (event: DesktopNovelImportEventV1) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async dispatch(
    input: unknown,
    trustedContext: CoreTrustedRequestContext = {},
  ): Promise<unknown> {
    if (!isNovelImportEnvelopeCandidate(input)) {
      return this.#fallback.dispatch(
        input,
        trustedContext as DesktopTrustedRequestContext,
      );
    }

    let request: NovelImportPayloadEnvelope;
    try {
      request = parseEnvelope(input);
    } catch (error) {
      return errorEnvelope(
        readMethod(input),
        readSession(input),
        validationErrorCode(error),
      );
    }

    try {
      const result = await this.#dispatchMethod(request, trustedContext);
      return resultEnvelope(request.method, result);
    } catch (error) {
      return errorEnvelope(
        request.method,
        request.payload,
        methodErrorCode(request.method, error),
      );
    }
  }

  async #dispatchMethod(
    request: NovelImportPayloadEnvelope,
    trustedContext: CoreTrustedRequestContext,
  ): Promise<unknown> {
    const session = sessionIdentity(request.payload);
    switch (request.method) {
      case DESKTOP_NOVEL_IMPORT_METHOD_NAMES.START:
        return this.#start(request.payload, trustedContext);
      case DESKTOP_NOVEL_IMPORT_METHOD_NAMES.GET_TASK:
        return this.#getTaskResult(session, readTaskId(request.payload));
      case DESKTOP_NOVEL_IMPORT_METHOD_NAMES.CANCEL_TASK:
        return this.#cancelTask(session, readTaskId(request.payload));
      case DESKTOP_NOVEL_IMPORT_METHOD_NAMES.RETRY_TASK:
        return this.#rejectUnsupportedRetry(session, readTaskId(request.payload));
      case DESKTOP_NOVEL_IMPORT_METHOD_NAMES.INSPECT: {
        const snapshot = await this.#core.novelImportReview.inspect({
          ...session,
          query: Reflect.get(request.payload, 'query'),
        });
        return withSession(session, { snapshot });
      }
      case DESKTOP_NOVEL_IMPORT_METHOD_NAMES.PREVIEW_STALE_IMPACT: {
        const preview = await this.#core.novelImportReview.previewStaleImpact({
          ...session,
          query: Reflect.get(request.payload, 'query'),
        });
        return withSession(session, { preview });
      }
      case DESKTOP_NOVEL_IMPORT_METHOD_NAMES.EXECUTE_REVIEW_COMMAND: {
        const result = await this.#core.novelImportReview.execute({
          ...session,
          command: Reflect.get(request.payload, 'command'),
        });
        return withSession(session, {
          outcome: result.outcome,
          artifact: toArtifactSummary(result.artifact),
          snapshot: result.snapshot,
        });
      }
      case DESKTOP_NOVEL_IMPORT_METHOD_NAMES.SELECT_SOURCE:
        throw new NovelImportCoreRouteError('DESKTOP_METHOD_NOT_FOUND');
    }
  }

  async #start(
    payload: DesktopNovelImportMethodPayload,
    trustedContext: CoreTrustedRequestContext,
  ): Promise<unknown> {
    const session = sessionIdentity(payload);
    const source = readTrustedSource(
      trustedContext,
      readRequiredString(payload, 'selectionToken'),
    );
    const project = this.#core.assertActiveProjectSession({
      ...session,
      requiredAccess: 'write',
    });
    const staged = await stageNovelSource(project, source, this.#createId);

    try {
      const imported = await this.#core.novelImport.importTxt({
        ...session,
        createdBy: readRequiredString(payload, 'requestedBy'),
        source: {
          byteLength: staged.byteLength,
          contentHash: staged.contentHash,
          idempotencyKey: readRequiredString(payload, 'idempotencyKey'),
          originalName: source.originalName,
          temporaryRelativePath: staged.temporaryRelativePath,
        },
        ...(Reflect.get(payload, 'sourceEncoding') === undefined
          ? {}
          : { sourceEncoding: Reflect.get(payload, 'sourceEncoding') }),
      });
      const task = imported.reused
        ? imported.task
        : await this.#core.workflow.getTask({
            ...session,
            taskId: imported.taskId,
          });
      if (!task || !isNovelImportTask(task))
        throw new NovelImportCoreRouteError('NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE');

      const result = await this.#projectTaskResult(session, task);
      this.#publishTaskOutcome(session, result.task, result.baselineRevision);
      return result;
    } finally {
      try {
        await staged.cleanup();
      } catch {
        // A committed source may already have moved out of tmp/. Cleanup is
        // best-effort and must not turn a durable import into a false failure.
      }
    }
  }

  async #getTaskResult(
    session: NovelImportSession,
    taskId: string,
  ): Promise<unknown> {
    const task = await this.#core.workflow.getTask({ ...session, taskId });
    if (!task || !isNovelImportTask(task))
      return withSession(session, { task: null });
    return this.#projectTaskResult(session, task);
  }

  async #cancelTask(
    session: NovelImportSession,
    taskId: string,
  ): Promise<unknown> {
    const current = await this.#core.workflow.getTask({ ...session, taskId });
    if (!current || !isNovelImportTask(current))
      throw new NovelImportCoreRouteError('NOVEL_IMPORT_TASK_NOT_FOUND');
    if (current.executionStatus !== 'pending' && current.executionStatus !== 'running')
      throw new NovelImportCoreRouteError('NOVEL_IMPORT_TASK_NOT_CANCELABLE');

    const canceled = await this.#core.workflow.cancelTask({ ...session, taskId });
    if (!isNovelImportTask(canceled) || canceled.executionStatus !== 'canceled')
      throw new NovelImportCoreRouteError('NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE');
    const result = await this.#projectTaskResult(session, canceled);
    this.#publishTaskOutcome(session, result.task, result.baselineRevision);
    return result;
  }

  async #rejectUnsupportedRetry(
    session: NovelImportSession,
    taskId: string,
  ): Promise<never> {
    const current = await this.#core.workflow.getTask({ ...session, taskId });
    if (!current || !isNovelImportTask(current))
      throw new NovelImportCoreRouteError('NOVEL_IMPORT_TASK_NOT_FOUND');

    // The Application API does not persist a reconstructible source command.
    // Retrying here from Core memory would make process restarts nondeterministic.
    throw new NovelImportCoreRouteError('NOVEL_IMPORT_TASK_NOT_RETRYABLE');
  }

  async #projectTaskResult(
    session: NovelImportSession,
    task: TaskRecord,
  ): Promise<{
    readonly baselineRevision?: NovelImportReviewBaselineV1;
    readonly contractVersion: typeof DESKTOP_NOVEL_IMPORT_CONTRACT_VERSION;
    readonly projectId: string;
    readonly projectSessionId: string;
    readonly task: DesktopNovelImportTaskV1;
  }> {
    const projected = toDesktopTask(task);
    const baselineRevision = task.executionStatus === 'succeeded'
      ? await this.#loadTaskBaseline(session, task)
      : undefined;
    return withSession(session, {
      task: projected,
      ...(baselineRevision === undefined ? {} : { baselineRevision }),
    });
  }

  async #loadTaskBaseline(
    session: NovelImportSession,
    task: TaskRecord,
  ): Promise<NovelImportReviewBaselineV1> {
    if (!task.resultRevisionId)
      throw new NovelImportCoreRouteError('NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE');
    const artifact = await this.#core.workflow.getArtifactRevision({
      ...session,
      revisionId: task.resultRevisionId,
    });
    if (
      !artifact
      || artifact.artifactType !== NOVEL_IMPORT_ARTIFACT_TYPE
      || artifact.revisionId !== task.resultRevisionId
    ) {
      throw new NovelImportCoreRouteError('NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE');
    }

    const project = this.#core.assertActiveProjectSession({
      ...session,
      requiredAccess: 'read',
    });
    const canonicalTextRevision = await readCanonicalRevision(project, artifact);
    const baselineRevision = {
      artifactId: artifact.artifactId,
      artifactRevisionId: artifact.revisionId,
      canonicalTextRevision,
    } as NovelImportReviewBaselineV1;
    const snapshot = await this.#core.novelImportReview.inspect({
      ...session,
      query: {
        documentType: 'novel-import-review-query',
        schemaVersion: NOVEL_IMPORT_REVIEW_SCHEMA_VERSION,
        baselineRevision,
        readOnly: true,
      },
    });
    return snapshot.baselineRevision;
  }

  #publishTaskOutcome(
    session: NovelImportSession,
    task: DesktopNovelImportTaskV1,
    baselineRevision?: NovelImportReviewBaselineV1,
  ): void {
    let event: DesktopNovelImportEventV1;
    try {
      let candidate: unknown;
      const sequence = this.#peekNextSequence(session);
      const base = {
        ...withSession(session, {}),
        eventId: nextUuid(this.#createId),
        occurredAt: this.#now().toISOString(),
        sequence,
        task,
      };
      if (task.executionStatus === 'pending' || task.executionStatus === 'running') {
        candidate = {
          ...base,
          eventType: DESKTOP_NOVEL_IMPORT_EVENT_TYPES.TASK_PROGRESS,
        };
      } else if (task.executionStatus === 'succeeded' && baselineRevision) {
        candidate = {
          ...base,
          baselineRevision,
          eventType: DESKTOP_NOVEL_IMPORT_EVENT_TYPES.TASK_COMPLETED,
        };
      } else if (task.executionStatus === 'canceled') {
        candidate = {
          ...base,
          eventType: DESKTOP_NOVEL_IMPORT_EVENT_TYPES.TASK_CANCELED,
        };
      } else if (task.executionStatus === 'failed' && task.errorCode) {
        const code = isNovelImportErrorCode(task.errorCode)
          ? task.errorCode
          : 'NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE';
        candidate = {
          ...base,
          error: createPublicError(undefined, session, code, task.taskId),
          eventType: DESKTOP_NOVEL_IMPORT_EVENT_TYPES.TASK_FAILED,
        };
      } else {
        return;
      }

      event = parseDesktopNovelImportEvent(candidate);
      this.#commitSequence(session, sequence);
    } catch {
      // Event projection is auxiliary to the already persisted task result.
      return;
    }
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch {
        // One local listener cannot prevent delivery to the remaining listeners.
      }
    }
  }

  #peekNextSequence(session: NovelImportSession): number {
    const key = `${session.projectId}:${session.projectSessionId}`;
    return (this.#sequences.get(key) ?? 0) + 1;
  }

  #commitSequence(session: NovelImportSession, sequence: number): void {
    const key = `${session.projectId}:${session.projectSessionId}`;
    this.#sequences.set(key, sequence);
  }
}

interface NovelImportSession {
  readonly projectId: string;
  readonly projectSessionId: string;
}

class NovelImportCoreRouteError extends Error {
  constructor(readonly code: DesktopNovelImportErrorCode) {
    super(code);
    this.name = 'NovelImportCoreRouteError';
  }
}

async function stageNovelSource(
  project: ProjectContext,
  source: { readonly originalName: string; readonly sourceFilePath: string },
  createId: () => string,
): Promise<StagedNovelSource> {
  if (
    !isAbsolute(source.sourceFilePath)
    || basename(source.sourceFilePath) !== source.originalName
  ) {
    throw new NovelImportCoreRouteError('NOVEL_IMPORT_INVALID_SOURCE');
  }

  const sourceEntry = await lstatNovelSource(source.sourceFilePath);
  if (!sourceEntry.isFile() || sourceEntry.isSymbolicLink())
    throw new NovelImportCoreRouteError('NOVEL_IMPORT_INVALID_SOURCE');
  if (!Number.isSafeInteger(sourceEntry.size) || sourceEntry.size < 0)
    throw new NovelImportCoreRouteError('NOVEL_IMPORT_RESOURCE_LIMIT_EXCEEDED');

  // Resolve and validate the single path component before creating anything
  // under the project. This also leaves the source identity snapshot in place
  // so a same-size replacement before open is rejected below.
  const fileName = `${nextUuid(createId)}.txt`;

  const projectRoot = await realpath(project.projectDirectory);
  const tmpRoot = await realpath(join(projectRoot, 'tmp'));
  if (relative(projectRoot, tmpRoot) !== 'tmp')
    throw new NovelImportCoreRouteError('NOVEL_IMPORT_INVALID_SOURCE');

  const stagingRoot = join(tmpRoot, STAGING_DIRECTORY_NAME);
  try {
    await mkdir(stagingRoot, { mode: 0o700 });
  } catch (error) {
    if (!isErrorCode(error, 'EEXIST'))
      throw error;
  }
  const stagingEntry = await lstat(stagingRoot);
  if (!stagingEntry.isDirectory() || stagingEntry.isSymbolicLink())
    throw new NovelImportCoreRouteError('NOVEL_IMPORT_INVALID_SOURCE');
  if (await realpath(stagingRoot) !== stagingRoot)
    throw new NovelImportCoreRouteError('NOVEL_IMPORT_INVALID_SOURCE');

  const targetPath = join(stagingRoot, fileName);
  const temporaryRelativePath = `tmp/${STAGING_DIRECTORY_NAME}/${fileName}`;
  let sourceHandle;
  try {
    sourceHandle = await openNovelSource(source.sourceFilePath);
  } catch (error) {
    try {
      await removeEmptyDirectory(stagingRoot);
    } catch {
      // Preserve the source validation result; project-tmp cleanup is auxiliary.
    }
    throw error;
  }
  let targetHandle;
  let completed = false;
  try {
    const openedSource = await sourceHandle.stat();
    if (
      !openedSource.isFile()
      || openedSource.dev !== sourceEntry.dev
      || openedSource.ino !== sourceEntry.ino
      || openedSource.size !== sourceEntry.size
      || openedSource.mtimeMs !== sourceEntry.mtimeMs
      || openedSource.ctimeMs !== sourceEntry.ctimeMs
    ) {
      throw new NovelImportCoreRouteError('NOVEL_IMPORT_INVALID_SOURCE');
    }
    targetHandle = await open(
      targetPath,
      constants.O_WRONLY
      | constants.O_CREAT
      | constants.O_EXCL
      | constants.O_NOFOLLOW,
      0o600,
    );
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(STREAM_CHUNK_BYTES);
    let byteLength = 0;
    while (true) {
      const { bytesRead } = await sourceHandle.read(
        buffer,
        0,
        buffer.byteLength,
        byteLength,
      );
      if (bytesRead === 0)
        break;
      const chunk = buffer.subarray(0, bytesRead);
      await writeAll(targetHandle, chunk);
      hash.update(chunk);
      byteLength += bytesRead;
      if (!Number.isSafeInteger(byteLength))
        throw new NovelImportCoreRouteError('NOVEL_IMPORT_RESOURCE_LIMIT_EXCEEDED');
    }
    const finalSource = await sourceHandle.stat();
    if (
      finalSource.dev !== openedSource.dev
      || finalSource.ino !== openedSource.ino
      || finalSource.size !== openedSource.size
      || finalSource.mtimeMs !== openedSource.mtimeMs
      || finalSource.ctimeMs !== openedSource.ctimeMs
      || byteLength !== openedSource.size
    ) {
      throw new NovelImportCoreRouteError('NOVEL_IMPORT_INVALID_SOURCE');
    }
    await targetHandle.sync();
    completed = true;
    return {
      byteLength,
      contentHash: hash.digest('hex'),
      temporaryRelativePath,
      cleanup: async () => {
        await rm(targetPath, { force: true });
        await removeEmptyDirectory(stagingRoot);
      },
    };
  } finally {
    await targetHandle?.close();
    await sourceHandle.close();
    if (!completed) {
      try {
        await rm(targetPath, { force: true });
        await removeEmptyDirectory(stagingRoot);
      } catch {
        // A 0600 file under the verified project tmp/ root is a recoverable
        // residue; cleanup must not obscure the primary validation failure.
      }
    }
  }
}

async function lstatNovelSource(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    throwNovelSourceFileSystemError(error);
  }
}

async function openNovelSource(path: string) {
  try {
    return await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    throwNovelSourceFileSystemError(error);
  }
}

function throwNovelSourceFileSystemError(error: unknown): never {
  const code = isRecord(error) ? error.code : undefined;
  if (typeof code === 'string' && INVALID_SOURCE_FILE_SYSTEM_CODES.has(code))
    throw new NovelImportCoreRouteError('NOVEL_IMPORT_INVALID_SOURCE');
  throw error;
}

async function writeAll(
  handle: Awaited<ReturnType<typeof open>>,
  bytes: Uint8Array,
): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await handle.write(
      bytes,
      offset,
      bytes.byteLength - offset,
    );
    if (bytesWritten <= 0)
      throw new NovelImportCoreRouteError('NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE');
    offset += bytesWritten;
  }
}

async function removeEmptyDirectory(path: string): Promise<void> {
  try {
    await rmdir(path);
  } catch (error) {
    if (!isErrorCode(error, 'ENOENT') && !isErrorCode(error, 'ENOTEMPTY'))
      throw error;
  }
}

async function readCanonicalRevision(
  project: ProjectContext,
  artifact: ArtifactRecord,
): Promise<TextRevisionRefV1> {
  const projectRoot = await realpath(project.projectDirectory);
  const contentPath = resolvePortableProjectPath(projectRoot, artifact.contentPath);
  const physicalContentPath = await realpath(contentPath);
  if (!isPathWithin(projectRoot, physicalContentPath))
    throw new NovelImportCoreRouteError('NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE');

  const bundlePath = join(physicalContentPath, 'bundle.json');
  const entry = await lstat(bundlePath);
  if (!entry.isFile() || entry.isSymbolicLink())
    throw new NovelImportCoreRouteError('NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE');
  const handle = await open(bundlePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (
      !opened.isFile()
      || opened.dev !== entry.dev
      || opened.ino !== entry.ino
      || opened.size !== entry.size
    ) {
      throw new NovelImportCoreRouteError('NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE');
    }
    const bundle = JSON.parse(
      await handle.readFile({ encoding: 'utf8' }),
    ) as ImportedBundleProjection;
    return parseTextRevisionRefV1(bundle.canonical?.revision);
  } catch {
    throw new NovelImportCoreRouteError('NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE');
  } finally {
    await handle.close();
  }
}

function resolvePortableProjectPath(projectRoot: string, path: string): string {
  if (
    typeof path !== 'string'
    || path.length === 0
    || isAbsolute(path)
    || path.includes('\\')
  ) {
    throw new NovelImportCoreRouteError('NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE');
  }
  const parts = path.split('/');
  if (parts.some(part => part.length === 0 || part === '.' || part === '..'))
    throw new NovelImportCoreRouteError('NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE');
  const resolved = resolve(projectRoot, ...parts);
  if (!isPathWithin(projectRoot, resolved))
    throw new NovelImportCoreRouteError('NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE');
  return resolved;
}

function isPathWithin(root: string, candidate: string): boolean {
  const relation = relative(root, candidate);
  return relation.length > 0
    && relation !== '..'
    && !relation.startsWith(`..${sep}`)
    && !isAbsolute(relation);
}

function parseEnvelope(input: unknown): NovelImportPayloadEnvelope {
  if (
    !isRecord(input)
    || !hasExactKeys(input, ['messageKind', 'method', 'payload'])
    || input.messageKind !== 'payload'
    || typeof input.method !== 'string'
    || !isDesktopNovelImportMethodName(input.method)
  ) {
    throw new TypeError('The Core novel import payload envelope is invalid.');
  }
  return {
    messageKind: 'payload',
    method: input.method,
    payload: parseDesktopNovelImportMethodPayload(input.method, input.payload),
  };
}

function resultEnvelope(
  method: DesktopNovelImportMethodName,
  result: unknown,
): NovelImportResultEnvelope {
  return {
    messageKind: 'result',
    method,
    result: parseDesktopNovelImportMethodResult(method, result),
  };
}

function errorEnvelope(
  method: DesktopNovelImportMethodName | undefined,
  session: NovelImportSession,
  code: DesktopNovelImportErrorCode,
): NovelImportErrorEnvelope {
  return {
    messageKind: 'error',
    error: createPublicError(method, session, code),
  };
}

function createPublicError(
  method: DesktopNovelImportMethodName | undefined,
  session: NovelImportSession,
  code: DesktopNovelImportErrorCode,
  taskId?: string,
): DesktopNovelImportErrorV1 {
  return parseDesktopNovelImportError({
    code,
    contractVersion: DESKTOP_NOVEL_IMPORT_CONTRACT_VERSION,
    message: 'The novel import request could not be completed.',
    projectId: session.projectId,
    projectSessionId: session.projectSessionId,
    retryable: DESKTOP_NOVEL_IMPORT_ERROR_RETRYABILITY[code],
    ...(method === undefined ? {} : { method }),
    ...(taskId === undefined ? {} : { taskId }),
  });
}

function toDesktopTask(task: TaskRecord): DesktopNovelImportTaskV1 {
  const errorCode = isNovelImportErrorCode(task.errorCode)
    ? task.errorCode
    : undefined;
  return {
    attempt: task.attempt,
    createdAt: task.createdAt,
    executionStatus: task.executionStatus,
    recoveryStatus: task.recoveryStatus,
    taskId: task.taskId,
    updatedAt: task.updatedAt,
    ...(task.resultRevisionId === undefined
      ? {}
      : { resultArtifactRevisionId: task.resultRevisionId }),
    ...(errorCode === undefined ? {} : { errorCode }),
    ...(task.startedAt === undefined ? {} : { startedAt: task.startedAt }),
    ...(task.finishedAt === undefined ? {} : { finishedAt: task.finishedAt }),
  };
}

function toArtifactSummary(artifact: ArtifactRecord) {
  return {
    artifactId: artifact.artifactId,
    artifactRevisionId: artifact.revisionId,
    executionStatus: artifact.executionStatus,
    reviewStatus: artifact.reviewStatus,
    validityStatus: artifact.validityStatus,
  };
}

function isNovelImportTask(task: TaskRecord): boolean {
  return task.processorId === NOVEL_IMPORT_PROCESSOR_ID
    && task.outputScope.kind === 'novel-import';
}

function isNovelImportErrorCode(value: unknown): value is NovelImportErrorCode {
  return typeof value === 'string'
    && (NOVEL_IMPORT_ERROR_CODES as readonly string[]).includes(value);
}

function readTrustedSource(
  context: CoreTrustedRequestContext,
  expectedSelectionToken: string,
): {
  readonly originalName: string;
  readonly sourceFilePath: string;
} {
  if (
    typeof context.originalName !== 'string'
    || context.originalName.length === 0
    || typeof context.sourceFilePath !== 'string'
    || context.sourceFilePath.length === 0
    || context.selectionToken !== expectedSelectionToken
  ) {
    throw new NovelImportCoreRouteError('DESKTOP_SELECTION_INVALID');
  }
  return {
    originalName: context.originalName,
    sourceFilePath: context.sourceFilePath,
  };
}

function sessionIdentity(payload: object): NovelImportSession {
  return {
    projectId: readRequiredString(payload, 'projectId'),
    projectSessionId: readRequiredString(payload, 'projectSessionId'),
  };
}

function readTaskId(payload: object): string {
  return readRequiredString(payload, 'taskId');
}

function readRequiredString(value: object, key: string): string {
  const field = Reflect.get(value, key);
  if (typeof field !== 'string' || field.length === 0)
    throw new NovelImportCoreRouteError('DESKTOP_PAYLOAD_INVALID');
  return field;
}

function readSession(input: unknown): NovelImportSession {
  if (!isRecord(input) || !isRecord(input.payload)) {
    return {
      projectId: INVALID_PROJECT_ID,
      projectSessionId: INVALID_PROJECT_SESSION_ID,
    };
  }
  return {
    projectId: isUuid(input.payload.projectId)
      ? input.payload.projectId
      : INVALID_PROJECT_ID,
    projectSessionId: isUuid(input.payload.projectSessionId)
      ? input.payload.projectSessionId
      : INVALID_PROJECT_SESSION_ID,
  };
}

function readMethod(input: unknown): DesktopNovelImportMethodName | undefined {
  if (!isRecord(input) || typeof input.method !== 'string')
    return undefined;
  return isDesktopNovelImportMethodName(input.method) ? input.method : undefined;
}

function validationErrorCode(error: unknown): DesktopNovelImportErrorCode {
  const code = isRecord(error) ? error.code : undefined;
  if (code === 'DESKTOP_NOVEL_IMPORT_VERSION_UNSUPPORTED')
    return 'DESKTOP_PROTOCOL_UNSUPPORTED';
  if (code === 'DESKTOP_NOVEL_IMPORT_METHOD_NOT_FOUND')
    return 'DESKTOP_METHOD_NOT_FOUND';
  return 'DESKTOP_PAYLOAD_INVALID';
}

function methodErrorCode(
  method: DesktopNovelImportMethodName,
  error: unknown,
): DesktopNovelImportErrorCode {
  if (error instanceof NovelImportCoreRouteError)
    return error.code;
  const code = isRecord(error) ? error.code : undefined;
  if (
    typeof code === 'string'
    && Object.hasOwn(DESKTOP_NOVEL_IMPORT_ERROR_RETRYABILITY, code)
  ) {
    return code as DesktopNovelImportErrorCode;
  }
  if (code === 'PROJECT_STATE_NOT_FOUND')
    return 'NOVEL_IMPORT_TASK_NOT_FOUND';
  if (code === 'PROJECT_STATE_READ_ONLY')
    return 'PROJECT_READ_ONLY';
  if (code === 'PROJECT_STATE_CONFLICT') {
    return method === DESKTOP_NOVEL_IMPORT_METHOD_NAMES.CANCEL_TASK
      ? 'NOVEL_IMPORT_TASK_NOT_CANCELABLE'
      : 'NOVEL_IMPORT_CONFLICT';
  }
  return 'NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE';
}

function withSession<T extends object>(
  session: NovelImportSession,
  value: T,
): T & NovelImportSession & {
  readonly contractVersion: typeof DESKTOP_NOVEL_IMPORT_CONTRACT_VERSION;
} {
  return {
    contractVersion: DESKTOP_NOVEL_IMPORT_CONTRACT_VERSION,
    projectId: session.projectId,
    projectSessionId: session.projectSessionId,
    ...value,
  };
}

function isNovelImportEnvelopeCandidate(value: unknown): boolean {
  return isRecord(value) && value.messageKind === 'payload';
}

function isErrorCode(error: unknown, code: string): boolean {
  return isRecord(error) && error.code === code;
}

function nextUuid(createId: () => string): string {
  const value = createId();
  if (!UUID_V4_PATTERN.test(value))
    throw new NovelImportCoreRouteError('NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE');
  return value;
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_V4_PATTERN.test(value);
}

function hasExactKeys(value: object, expected: readonly string[]): boolean {
  const keys = Reflect.ownKeys(value);
  return keys.length === expected.length
    && keys.every(key => typeof key === 'string' && expected.includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
