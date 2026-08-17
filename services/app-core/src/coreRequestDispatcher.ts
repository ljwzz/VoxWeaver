import type {
  ChapterStructureProjectionDto,
  CoreRequestEnvelope,
  CoreResponseEnvelope,
  JsonValue,
  NovelImportReviewCommandInput,
  SourceTextPreviewRequest,
  StartNovelImportInput,
  TxtSourceEncoding,
} from '@voxweaver/contracts';
import type { AppCoreService } from './appCoreService.ts';

import {
  CORE_METHODS,
  CORE_PROTOCOL_VERSION,
  failure,
  isNonEmptyString,
  isRecord,
  isWorkspacePageKey,
  NOVEL_IMPORT_SOURCE_PREVIEW_MAX_LINES,
  parseCoreRequestEnvelope,
  TXT_SOURCE_ENCODINGS,
  VoxWeaverError,
} from '@voxweaver/contracts';
import { NovelImportError } from '@voxweaver/novel-import';

const INVALID_REQUEST_ID = 'invalid-request';

export class CoreRequestDispatcher {
  readonly #core: AppCoreService;

  constructor(core: AppCoreService) {
    this.#core = core;
  }

  async dispatch(value: unknown): Promise<CoreResponseEnvelope> {
    let request: CoreRequestEnvelope;
    try {
      request = parseCoreRequestEnvelope(value);
    } catch (error) {
      return this.#failure(readRequestId(value), toAppError(error));
    }

    try {
      const result = await this.#dispatchMethod(request);
      return {
        protocolVersion: CORE_PROTOCOL_VERSION,
        requestId: request.requestId,
        ok: true,
        result: result as JsonValue,
      };
    } catch (error) {
      return this.#failure(request.requestId, toAppError(error));
    }
  }

  async #dispatchMethod(request: CoreRequestEnvelope): Promise<unknown> {
    switch (request.method) {
      case CORE_METHODS.getHealth:
        return {
          status: 'healthy',
          canRestart: false,
          protocolVersion: CORE_PROTOCOL_VERSION,
        };
      case CORE_METHODS.createProject: {
        assertStartupContext(this.#core, request);
        const payload = requireRecord(request.payload);
        const session = await this.#core.sessions.createProject({
          displayName: requireString(payload, 'displayName'),
          rootPath: requireString(payload, 'rootPath'),
          sourcePath: requireString(payload, 'sourcePath'),
        });
        return toCoreSessionResult(session);
      }
      case CORE_METHODS.inspectProject:
      case CORE_METHODS.openProject: {
        assertStartupContext(this.#core, request);
        const payload = requireRecord(request.payload);
        const outcome = typeof payload.recentProjectId === 'string'
          ? await this.#core.sessions.openRecentProject(payload.recentProjectId, request.trustedContext)
          : await this.#core.sessions.openProject(
              requireString(payload, 'rootPath'),
              request.trustedContext,
            );
        return toCoreOpenResult(this.#core, outcome);
      }
      case CORE_METHODS.confirmProjectOpen: {
        assertStartupContext(this.#core, request);
        const payload = requireRecord(request.payload);
        const outcome = await this.#core.sessions.confirmProjectOpen(
          requireString(payload, 'confirmationToken'),
          request.trustedContext,
        );
        return toCoreOpenResult(this.#core, outcome);
      }
      case CORE_METHODS.listRecentProjects:
        assertStartupContext(this.#core, request);
        return this.#core.sessions.listRecentProjects();
      case CORE_METHODS.removeRecentProject: {
        assertStartupContext(this.#core, request);
        const payload = requireRecord(request.payload);
        await this.#core.sessions.removeRecentProject(requireString(payload, 'projectId'));
        return null;
      }
      case CORE_METHODS.getBootstrap:
        requireEmptyPayload(request.payload);
        return this.#core.sessions.getBootstrap(request.trustedContext);
      case CORE_METHODS.recordLastPage: {
        const payload = requireRecord(request.payload);
        const pageKey = payload.pageKey;
        if (!isWorkspacePageKey(pageKey))
          throw invalidPayload('pageKey');
        await this.#core.sessions.recordLastPage(request.trustedContext, pageKey);
        return null;
      }
      case CORE_METHODS.closeProject:
        requireEmptyPayload(request.payload);
        await this.#core.sessions.closeProject(request.trustedContext);
        return null;
      case CORE_METHODS.recoverProjectSession: {
        assertStartupContext(this.#core, request);
        const payload = requireRecord(request.payload);
        const session = await this.#core.sessions.recoverProjectSession({
          rootPath: requireString(payload, 'rootPath'),
          projectId: requireString(payload, 'projectId'),
          projectSessionId: requireString(payload, 'projectSessionId'),
        }, request.trustedContext);
        return toCoreSessionResult(session);
      }
      case CORE_METHODS.novelImportProbe:
        requireEmptyPayload(request.payload);
        return this.#core.novelImport.probe(request.trustedContext);
      case CORE_METHODS.novelImportStart:
        return this.#core.novelImport.start(
          request.trustedContext,
          parseNovelImportStart(request.payload),
        );
      case CORE_METHODS.novelImportGetTask: {
        const payload = requireRecord(request.payload);
        return this.#core.novelImport.getTask(
          request.trustedContext,
          requireString(payload, 'taskId'),
        );
      }
      case CORE_METHODS.novelImportCancelTask: {
        const payload = requireRecord(request.payload);
        return this.#core.novelImport.cancelTask(
          request.trustedContext,
          requireString(payload, 'taskId'),
        );
      }
      case CORE_METHODS.novelImportRetryTask: {
        const payload = requireRecord(request.payload);
        return this.#core.novelImport.retryTask(
          request.trustedContext,
          requireString(payload, 'taskId'),
        );
      }
      case CORE_METHODS.novelImportGetReviewSnapshot:
        requireEmptyPayload(request.payload);
        return this.#core.novelImport.getReviewSnapshot(request.trustedContext);
      case CORE_METHODS.novelImportGetSourcePreview:
        return this.#core.novelImport.getSourcePreview(
          request.trustedContext,
          parseSourcePreviewRequest(request.payload),
        );
      case CORE_METHODS.novelImportGetTextSlice:
        return this.#core.novelImport.getTextSlice(
          request.trustedContext,
          parseTextSliceRequest(request.payload),
        );
      case CORE_METHODS.novelImportPreviewReview:
        return this.#core.novelImport.previewReview(
          request.trustedContext,
          parseReviewCommand(request.payload),
        );
      case CORE_METHODS.novelImportApplyReview:
        return this.#core.novelImport.applyReview(
          request.trustedContext,
          parseReviewCommand(request.payload),
        );
      case CORE_METHODS.shutdown:
        assertStartupContext(this.#core, request);
        requireEmptyPayload(request.payload);
        await this.#core.close();
        return null;
    }
  }

  #failure(requestId: string, error: ReturnType<typeof toAppError>): CoreResponseEnvelope {
    return {
      protocolVersion: CORE_PROTOCOL_VERSION,
      requestId,
      ...failure(error),
    } as CoreResponseEnvelope;
  }
}

function assertStartupContext(core: AppCoreService, request: CoreRequestEnvelope): void {
  if (request.trustedContext.windowKind !== 'startup')
    throw new VoxWeaverError('FORBIDDEN', '只有启动窗口可以执行该操作。', false);
  core.sessions.assertStartupContext(request.trustedContext);
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value))
    throw invalidPayload('payload');
  return value;
}

function requireString(value: Record<string, unknown>, key: string): string {
  const candidate = value[key];
  if (!isNonEmptyString(candidate))
    throw invalidPayload(key);
  return candidate;
}

function requireEmptyPayload(value: unknown): void {
  const payload = requireRecord(value);
  if (Object.keys(payload).length > 0)
    throw invalidPayload('payload');
}

function invalidPayload(field: string): VoxWeaverError {
  return new VoxWeaverError('IPC_PAYLOAD_INVALID', `Core 请求字段无效：${field}。`, false);
}

function parseNovelImportStart(value: unknown): StartNovelImportInput {
  const payload = requireRecord(value);
  const sourceEncoding = payload.sourceEncoding;
  if (Object.keys(payload).some(key => key !== 'sourceEncoding')
    || (sourceEncoding !== undefined
      && (typeof sourceEncoding !== 'string'
        || !(TXT_SOURCE_ENCODINGS as readonly string[]).includes(sourceEncoding)))) {
    throw invalidPayload('sourceEncoding');
  }
  return sourceEncoding === undefined
    ? {}
    : { sourceEncoding: sourceEncoding as TxtSourceEncoding };
}

function parseSourcePreviewRequest(value: unknown): SourceTextPreviewRequest {
  const payload = requireRecord(value);
  const hasUnexpectedField = Object.keys(payload).some(key => ![
    'sourceHash',
    'sourceEncoding',
    'startByte',
    'targetLineCount',
  ].includes(key));
  if (hasUnexpectedField
    || typeof payload.sourceHash !== 'string'
    || !/^[0-9a-f]{64}$/u.test(payload.sourceHash)
    || typeof payload.sourceEncoding !== 'string'
    || !(TXT_SOURCE_ENCODINGS as readonly string[]).includes(payload.sourceEncoding)
    || !Number.isSafeInteger(payload.startByte)
    || (payload.startByte as number) < 0
    || !Number.isSafeInteger(payload.targetLineCount)
    || (payload.targetLineCount as number) < 1
    || (payload.targetLineCount as number) > NOVEL_IMPORT_SOURCE_PREVIEW_MAX_LINES) {
    throw invalidPayload('source preview');
  }
  return {
    sourceHash: payload.sourceHash,
    sourceEncoding: payload.sourceEncoding as TxtSourceEncoding,
    startByte: payload.startByte as number,
    targetLineCount: payload.targetLineCount as number,
  };
}

function parseTextSliceRequest(value: unknown) {
  const payload = requireRecord(value);
  if (Object.keys(payload).some(key => !['revisionId', 'startByte', 'endByte'].includes(key))
    || !isNonEmptyString(payload.revisionId)
    || !Number.isSafeInteger(payload.startByte)
    || !Number.isSafeInteger(payload.endByte)) {
    throw invalidPayload('text slice');
  }
  return {
    revisionId: payload.revisionId,
    startByte: payload.startByte as number,
    endByte: payload.endByte as number,
  };
}

function parseReviewCommand(value: unknown): NovelImportReviewCommandInput {
  const payload = requireRecord(value);
  const baselineRevision = payload.baselineRevision;
  const commandType = payload.commandType;
  if (!Number.isSafeInteger(baselineRevision)
    || (baselineRevision as number) < 1
    || !isNonEmptyString(commandType)) {
    throw invalidPayload('review command');
  }

  switch (commandType) {
    case 'adjust-chapter-boundaries': {
      requireOnlyKeys(payload, ['baselineRevision', 'commandType', 'adjustments']);
      if (!Array.isArray(payload.adjustments) || payload.adjustments.length === 0)
        throw invalidPayload('chapter adjustments');
      const adjustments = payload.adjustments.map((value) => {
        const adjustment = requireRecord(value);
        requireOnlyKeys(adjustment, ['chapterId', 'headingRange', 'contentRange']);
        return {
          chapterId: requireString(adjustment, 'chapterId'),
          headingRange: parseUtf8Range(adjustment.headingRange),
          contentRange: parseUtf8Range(adjustment.contentRange),
        };
      });
      return {
        commandType,
        baselineRevision: baselineRevision as number,
        adjustments,
      };
    }
    case 'update-chapter-structure': {
      requireOnlyKeys(payload, [
        'baselineRevision',
        'commandType',
        'insertionPoints',
        'chapters',
        'unassignedRanges',
      ]);
      if (!Array.isArray(payload.insertionPoints)
        || !payload.insertionPoints.every(Number.isSafeInteger)
        || !Array.isArray(payload.chapters)
        || !Array.isArray(payload.unassignedRanges)) {
        throw invalidPayload('chapter structure');
      }
      const insertionPoints = payload.insertionPoints as number[];
      if (new Set(insertionPoints).size !== insertionPoints.length)
        throw invalidPayload('chapter structure insertion points');
      const chapters = payload.chapters.map((value): ChapterStructureProjectionDto => {
        const chapter = requireRecord(value);
        requireOnlyKeys(chapter, [
          'existingChapterId',
          'title',
          'headingKind',
          'headingRange',
          'contentRange',
          'lengthAnomalyAccepted',
        ]);
        const existingChapterId = chapter.existingChapterId;
        const headingKind = chapter.headingKind;
        if ((existingChapterId !== undefined && !isNonEmptyString(existingChapterId))
          || (headingKind !== 'source' && headingKind !== 'missing')
          || typeof chapter.lengthAnomalyAccepted !== 'boolean'
          || (headingKind === 'source' && chapter.headingRange === undefined)
          || (headingKind === 'missing' && chapter.headingRange !== undefined)) {
          throw invalidPayload('chapter projection');
        }
        return {
          ...(existingChapterId === undefined ? {} : { existingChapterId }),
          title: requireString(chapter, 'title'),
          headingKind,
          ...(headingKind === 'source'
            ? { headingRange: parseUtf8Range(chapter.headingRange) }
            : {}),
          contentRange: parseUtf8Range(chapter.contentRange),
          lengthAnomalyAccepted: chapter.lengthAnomalyAccepted,
        };
      });
      return {
        commandType,
        baselineRevision: baselineRevision as number,
        insertionPoints,
        chapters,
        unassignedRanges: payload.unassignedRanges.map(parseUtf8Range),
      };
    }
    case 'confirm-review':
      requireOnlyKeys(payload, ['baselineRevision', 'commandType']);
      return { commandType, baselineRevision: baselineRevision as number };
    default:
      throw invalidPayload('commandType');
  }
}

function parseUtf8Range(value: unknown) {
  const range = requireRecord(value);
  requireOnlyKeys(range, ['offsetUnit', 'startByte', 'endByte']);
  if (range.offsetUnit !== 'utf8-byte'
    || !Number.isSafeInteger(range.startByte)
    || !Number.isSafeInteger(range.endByte)) {
    throw invalidPayload('utf8 byte range');
  }
  return {
    offsetUnit: 'utf8-byte' as const,
    startByte: range.startByte as number,
    endByte: range.endByte as number,
  };
}

function requireOnlyKeys(value: Record<string, unknown>, allowedKeys: readonly string[]): void {
  if (Object.keys(value).some(key => !allowedKeys.includes(key)))
    throw invalidPayload('unexpected field');
}

function readRequestId(value: unknown): string {
  return isRecord(value) && isNonEmptyString(value.requestId)
    ? value.requestId
    : INVALID_REQUEST_ID;
}

function toAppError(error: unknown) {
  if (error instanceof VoxWeaverError || error instanceof NovelImportError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      ...(error.details ? { details: error.details } : {}),
    };
  }
  return {
    code: 'CORE_UNAVAILABLE' as const,
    message: '应用核心无法完成请求。',
    retryable: true,
  };
}

function toCoreSessionResult(session: ReturnType<AppCoreService['sessions']['getSessionByProjectId']> & {}) {
  return {
    project: session.project,
    projectSessionId: session.projectSessionId,
    canonicalRootPath: session.canonicalRootPath,
  };
}

function toCoreOpenResult(
  core: AppCoreService,
  outcome: Awaited<ReturnType<AppCoreService['sessions']['openProject']>>,
) {
  if (outcome.kind === 'cancelled' || outcome.kind === 'confirmation-required')
    return { outcome };
  const session = core.sessions.getSessionByProjectId(outcome.project.projectId);
  if (!session)
    throw new VoxWeaverError('PROJECT_SESSION_STALE', 'Core 项目会话不存在。', false);
  return {
    outcome,
    projectSessionId: session.projectSessionId,
    canonicalRootPath: session.canonicalRootPath,
  };
}
