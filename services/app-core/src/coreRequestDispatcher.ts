import type {
  CoreRequestEnvelope,
  CoreResponseEnvelope,
  JsonValue,
  NovelImportReviewCommandInput,
} from '@voxweaver/contracts';
import type { AppCoreService } from './appCoreService.ts';

import {
  CORE_METHODS,
  CORE_PROTOCOL_VERSION,
  failure,
  isNonEmptyString,
  isRecord,
  isWorkspacePageKey,
  parseCoreRequestEnvelope,
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

function parseNovelImportStart(value: unknown) {
  const payload = requireRecord(value);
  const sourceEncoding = payload.sourceEncoding;
  const allowed = ['gbk', 'gb18030', 'big5', 'utf-16le', 'utf-16be'];
  if (Object.keys(payload).some(key => key !== 'sourceEncoding')
    || (sourceEncoding !== undefined
      && (typeof sourceEncoding !== 'string' || !allowed.includes(sourceEncoding)))) {
    throw invalidPayload('sourceEncoding');
  }
  return sourceEncoding === undefined
    ? {}
    : { sourceEncoding: sourceEncoding as 'gbk' | 'gb18030' | 'big5' | 'utf-16le' | 'utf-16be' };
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
  if (!Number.isSafeInteger(baselineRevision) || !isNonEmptyString(commandType))
    throw invalidPayload('review command');

  switch (commandType) {
    case 'adjust-chapter-boundary':
      requireOnlyKeys(payload, ['baselineRevision', 'commandType', 'chapterId', 'headingRange', 'contentRange']);
      return {
        commandType,
        baselineRevision: baselineRevision as number,
        chapterId: requireString(payload, 'chapterId'),
        headingRange: parseUtf8Range(payload.headingRange),
        contentRange: parseUtf8Range(payload.contentRange),
      };
    case 'classify-uncovered-range': {
      requireOnlyKeys(payload, ['baselineRevision', 'commandType', 'range', 'classification']);
      const classification = payload.classification;
      if (!['front-matter', 'appendix', 'noise', 'unknown'].includes(String(classification)))
        throw invalidPayload('classification');
      return {
        commandType,
        baselineRevision: baselineRevision as number,
        range: parseUtf8Range(payload.range),
        classification: classification as 'front-matter' | 'appendix' | 'noise' | 'unknown',
      };
    }
    case 'decide-normalization-proposal': {
      requireOnlyKeys(payload, ['baselineRevision', 'commandType', 'proposalId', 'decision']);
      const decision = payload.decision;
      if (decision !== 'approved' && decision !== 'rejected')
        throw invalidPayload('decision');
      return {
        commandType,
        baselineRevision: baselineRevision as number,
        proposalId: requireString(payload, 'proposalId'),
        decision,
      };
    }
    case 'rerun-selection':
      requireOnlyKeys(payload, ['baselineRevision', 'commandType', 'chapterIds']);
      if (!Array.isArray(payload.chapterIds)
        || payload.chapterIds.length === 0
        || payload.chapterIds.some(value => !isNonEmptyString(value))) {
        throw invalidPayload('chapterIds');
      }
      return {
        commandType,
        baselineRevision: baselineRevision as number,
        chapterIds: payload.chapterIds as string[],
      };
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
