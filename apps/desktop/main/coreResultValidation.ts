import type {
  CoreEventEnvelope,
  CoreMethodName,
  JsonValue,
  NovelImportEventDto,
} from '@voxweaver/contracts';

import {
  CORE_METHODS,
  isRecord,
  isWorkspacePageKey,
  VoxWeaverError,
  WORKSPACE_PAGE_KEYS,
} from '@voxweaver/contracts';

export function validateCoreMethodResult(
  method: CoreMethodName,
  value: JsonValue,
): JsonValue {
  const valid = isValidResult(method, value);
  if (!valid) {
    throw new VoxWeaverError(
      'CORE_PROTOCOL_MISMATCH',
      `Core 方法 ${method} 返回了无效结果。`,
      false,
    );
  }
  return value;
}

export function validateNovelImportEvent(
  event: CoreEventEnvelope,
): NovelImportEventDto {
  const payload = event.payload;
  const eventTypes: readonly NovelImportEventDto['eventType'][] = [
    'task-progress',
    'task-completed',
    'task-failed',
    'task-canceled',
    'task-retry-scheduled',
  ];
  if (!eventTypes.includes(event.eventType as NovelImportEventDto['eventType'])
    || !isRecord(payload)
    || payload.eventType !== event.eventType
    || !Number.isSafeInteger(payload.sequence)
    || (payload.sequence as number) <= 0
    || !isDateTime(payload.occurredAt)
    || payload.occurredAt !== event.occurredAt
    || !isTask(payload.task)) {
    throw new VoxWeaverError(
      'CORE_PROTOCOL_MISMATCH',
      'Core 返回了无效小说导入事件。',
      false,
    );
  }
  return payload as unknown as NovelImportEventDto;
}

function isValidResult(method: CoreMethodName, value: JsonValue): boolean {
  switch (method) {
    case CORE_METHODS.getHealth:
      return isCoreHealth(value);
    case CORE_METHODS.createProject:
    case CORE_METHODS.recoverProjectSession:
      return isCoreSessionResult(value);
    case CORE_METHODS.inspectProject:
    case CORE_METHODS.openProject:
    case CORE_METHODS.confirmProjectOpen:
      return isCoreOpenResult(value);
    case CORE_METHODS.listRecentProjects:
      return Array.isArray(value) && value.every(isRecentProject);
    case CORE_METHODS.removeRecentProject:
    case CORE_METHODS.recordLastPage:
    case CORE_METHODS.closeProject:
    case CORE_METHODS.shutdown:
      return value === null;
    case CORE_METHODS.getBootstrap:
      return isWorkspaceBootstrap(value);
    case CORE_METHODS.novelImportProbe:
      return isNovelImportProbe(value);
    case CORE_METHODS.novelImportStart:
    case CORE_METHODS.novelImportGetTask:
    case CORE_METHODS.novelImportCancelTask:
    case CORE_METHODS.novelImportRetryTask:
      return isTask(value);
    case CORE_METHODS.novelImportGetReviewSnapshot:
    case CORE_METHODS.novelImportApplyReview:
      return isReviewSnapshot(value);
    case CORE_METHODS.novelImportGetTextSlice:
      return isTextSlice(value);
    case CORE_METHODS.novelImportPreviewReview:
      return isStalePreview(value);
  }
}

function isCoreSessionResult(value: unknown): boolean {
  return isRecord(value)
    && isProjectSummary(value.project)
    && isNonEmptyString(value.projectSessionId)
    && isNonEmptyString(value.canonicalRootPath);
}

function isCoreOpenResult(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.outcome))
    return false;
  const outcome = value.outcome;
  if (outcome.kind === 'cancelled')
    return true;
  if (outcome.kind === 'confirmation-required') {
    return isProjectSummary(outcome.project)
      && isNonEmptyString(outcome.confirmationToken)
      && isDateTime(outcome.expiresAt)
      && Array.isArray(outcome.operations)
      && outcome.operations.every(operation => operation === 'migrate-v1' || operation === 'recover-stale-lock')
      && Array.isArray(outcome.riskSummary)
      && outcome.riskSummary.every(isNonEmptyString);
  }
  if (outcome.kind !== 'opened' && outcome.kind !== 'focused')
    return false;
  return isProjectSummary(outcome.project)
    && isNonEmptyString(value.projectSessionId)
    && isNonEmptyString(value.canonicalRootPath);
}

function isWorkspaceBootstrap(value: unknown): boolean {
  if (!isRecord(value)
    || !isProjectSummary(value.project)
    || !isSourceAsset(value.sourceAsset)
    || !Array.isArray(value.stages)
    || !isRecord(value.capabilities)
    || !Array.isArray(value.recoverableTasks)
    || !value.recoverableTasks.every(isTask)
    || (value.currentTask !== undefined && !isTask(value.currentTask))
    || (value.lastPage !== undefined && !isWorkspacePageKey(value.lastPage))
    || !isWorkspacePageKey(value.recommendedPage)
    || !isCoreHealth(value.coreHealth)) {
    return false;
  }
  const capabilities = value.capabilities as Record<string, unknown>;
  return WORKSPACE_PAGE_KEYS.every((pageKey) => {
    const capability = capabilities[pageKey];
    return isRecord(capability)
      && typeof capability.available === 'boolean'
      && ['available', 'prerequisite', 'not-implemented', 'core-unavailable'].includes(String(capability.reason))
      && isNonEmptyString(capability.message);
  });
}

function isNovelImportProbe(value: unknown): boolean {
  if (!isRecord(value)
    || !isSourceProbe(value.source)
    || value.format !== 'txt'
    || !isRecord(value.encoding)
    || (value.activeTask !== undefined && !isTask(value.activeTask))) {
    return false;
  }
  const encoding = value.encoding;
  if (!isNonEmptyString(encoding.sourceHash))
    return false;
  if (encoding.status === 'confirmed') {
    return ['utf-8', 'utf-16le', 'utf-16be'].includes(String(encoding.encoding))
      && (encoding.method === 'bom' || encoding.method === 'strict-utf8');
  }
  if (encoding.status === 'selection-required') {
    return Array.isArray(encoding.allowedEncodings)
      && encoding.allowedEncodings.every(item => ['gbk', 'gb18030', 'big5', 'utf-16le', 'utf-16be'].includes(String(item)))
      && isNonEmptyString(encoding.message);
  }
  return encoding.status === 'rejected'
    && isNonEmptyString(encoding.message)
    && ['empty', 'binary-nul', 'utf-32', 'decode-failed'].includes(String(encoding.reason));
}

function isTask(value: unknown): boolean {
  return isRecord(value)
    && isNonEmptyString(value.taskId)
    && value.taskType === 'novel-import'
    && ['pending', 'running', 'succeeded', 'failed', 'canceled'].includes(String(value.status))
    && ['none', 'resumable', 'retryable', 'manual'].includes(String(value.recoveryStatus))
    && Number.isSafeInteger(value.attempt)
    && isRecord(value.progress)
    && Number.isFinite(value.progress.completed)
    && Number.isFinite(value.progress.total)
    && Number.isFinite(value.progress.percent)
    && isNonEmptyString(value.progress.message)
    && typeof value.canCancel === 'boolean'
    && typeof value.canRetry === 'boolean'
    && isDateTime(value.createdAt)
    && isDateTime(value.updatedAt);
}

function isReviewSnapshot(value: unknown): boolean {
  return isRecord(value)
    && isNonEmptyString(value.revisionId)
    && Number.isSafeInteger(value.baselineRevision)
    && isSourceProbe(value.source)
    && isNonEmptyString(value.encoding)
    && isNonEmptyString(value.encodingMethod)
    && Number.isSafeInteger(value.textByteLength)
    && Array.isArray(value.candidates)
    && Array.isArray(value.chapters)
    && isRecord(value.coverage)
    && Array.isArray(value.coverage.segments)
    && Array.isArray(value.coverage.uncoveredRanges)
    && Array.isArray(value.normalizationProposals)
    && Array.isArray(value.diff)
    && Array.isArray(value.revisionHistory)
    && (value.reviewStatus === 'pending' || value.reviewStatus === 'approved')
    && isDateTime(value.createdAt);
}

function isTextSlice(value: unknown): boolean {
  return isRecord(value)
    && isNonEmptyString(value.revisionId)
    && isUtf8Range(value.range)
    && typeof value.text === 'string'
    && Number.isSafeInteger(value.totalByteLength);
}

function isStalePreview(value: unknown): boolean {
  return isRecord(value)
    && Number.isSafeInteger(value.baselineRevision)
    && isNonEmptyString(value.commandType)
    && Array.isArray(value.affected)
    && value.affected.every(item => isRecord(item)
      && isNonEmptyString(item.artifactType)
      && isNonEmptyString(item.artifactId)
      && isNonEmptyString(item.reason))
    && typeof value.requiresConfirmation === 'boolean';
}

function isProjectSummary(value: unknown): boolean {
  return isRecord(value)
    && isNonEmptyString(value.projectId)
    && isNonEmptyString(value.displayName)
    && isNonEmptyString(value.sourceFileName)
    && isDateTime(value.createdAt)
    && isDateTime(value.updatedAt)
    && value.layoutVersion === 2;
}

function isRecentProject(value: unknown): boolean {
  return isProjectSummary(value)
    && isRecord(value)
    && isNonEmptyString(value.directoryPath)
    && isDateTime(value.lastOpenedAt)
    && ['available', 'invalid', 'missing'].includes(String(value.availability));
}

function isSourceAsset(value: unknown): boolean {
  return isRecord(value)
    && isNonEmptyString(value.id)
    && isNonEmptyString(value.originalName)
    && isNonEmptyString(value.relativePath)
    && Number.isSafeInteger(value.byteLength)
    && isSha256(value.sha256);
}

function isSourceProbe(value: unknown): boolean {
  return isRecord(value)
    && isNonEmptyString(value.sourceAssetId)
    && isNonEmptyString(value.originalName)
    && Number.isSafeInteger(value.byteLength)
    && isSha256(value.sha256);
}

function isCoreHealth(value: unknown): boolean {
  return isRecord(value)
    && ['healthy', 'starting', 'unavailable'].includes(String(value.status))
    && typeof value.canRestart === 'boolean'
    && value.protocolVersion === 1;
}

function isUtf8Range(value: unknown): boolean {
  return isRecord(value)
    && value.offsetUnit === 'utf8-byte'
    && Number.isSafeInteger(value.startByte)
    && Number.isSafeInteger(value.endByte);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isDateTime(value: unknown): boolean {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function isSha256(value: unknown): boolean {
  return typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);
}
