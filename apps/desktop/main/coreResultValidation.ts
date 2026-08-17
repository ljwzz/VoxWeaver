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
  NOVEL_IMPORT_SOURCE_PREVIEW_MAX_BYTES,
  NOVEL_IMPORT_SOURCE_PREVIEW_MAX_LINES,
  NOVEL_IMPORT_TEXT_SLICE_MAX_BYTES,
  TXT_SOURCE_ENCODINGS,
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
    case CORE_METHODS.novelImportGetSourcePreview:
      return isSourcePreview(value);
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
    || (value.activeTask !== undefined && !isTask(value.activeTask))
    || (value.latestReviewRevisionId !== undefined
      && !isNonEmptyString(value.latestReviewRevisionId))) {
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
      && encoding.allowedEncodings.every(item => [
        'utf-8',
        'gb2312',
        'gbk',
        'gb18030',
        'big5',
        'utf-16le',
        'utf-16be',
      ].includes(String(item)))
      && (encoding.recommendedEncoding === undefined
        || encoding.allowedEncodings.includes(encoding.recommendedEncoding))
      && isNonEmptyString(encoding.message);
  }
  return encoding.status === 'rejected'
    && isNonEmptyString(encoding.message)
    && ['empty', 'binary-nul', 'utf-32', 'decode-failed'].includes(String(encoding.reason));
}

function isSourcePreview(value: unknown): boolean {
  return isRecord(value)
    && isSha256(value.sourceHash)
    && (TXT_SOURCE_ENCODINGS as readonly string[]).includes(String(value.sourceEncoding))
    && Number.isSafeInteger(value.startByte)
    && Number.isSafeInteger(value.endByte)
    && (value.startByte as number) >= 0
    && (value.endByte as number) >= (value.startByte as number)
    && (value.endByte as number) - (value.startByte as number) <= NOVEL_IMPORT_SOURCE_PREVIEW_MAX_BYTES
    && typeof value.text === 'string'
    && Number.isSafeInteger(value.completeLineCount)
    && (value.completeLineCount as number) >= 0
    && (value.completeLineCount as number) <= NOVEL_IMPORT_SOURCE_PREVIEW_MAX_LINES
    && typeof value.done === 'boolean';
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
  if (!isRecord(value)
    || !isNonEmptyString(value.revisionId)
    || !Number.isSafeInteger(value.baselineRevision)
    || (value.baselineRevision as number) < 1
    || !isSourceProbe(value.source)
    || !(TXT_SOURCE_ENCODINGS as readonly string[]).includes(String(value.encoding))
    || !['bom', 'strict-utf8', 'user'].includes(String(value.encodingMethod))
    || !Number.isSafeInteger(value.textByteLength)
    || (value.textByteLength as number) < 0
    || !Array.isArray(value.chapters)
    || !Array.isArray(value.revisionHistory)
    || (value.reviewStatus !== 'pending' && value.reviewStatus !== 'approved')
    || !isDateTime(value.createdAt)) {
    return false;
  }

  const textByteLength = value.textByteLength as number;
  const chapterIds = new Set<string>();
  let previousChapterEnd = 0;
  for (const [index, chapter] of value.chapters.entries()) {
    if (!isChapter(chapter, textByteLength, index + 1)
      || chapterIds.has(chapter.chapterId)) {
      return false;
    }
    const chapterStart = chapter.headingRange?.startByte ?? chapter.contentRange.startByte;
    if (chapterStart < previousChapterEnd)
      return false;
    previousChapterEnd = chapter.contentRange.endByte;
    chapterIds.add(chapter.chapterId);
  }
  return isCoverage(value.coverage, textByteLength, chapterIds)
    && value.revisionHistory.every(isRevisionHistoryItem)
    && value.revisionHistory.filter(item => isRecord(item) && item.active === true).length === 1
    && value.revisionHistory.some(item => isRecord(item)
      && item.active === true
      && item.revisionId === value.revisionId
      && item.baselineRevision === value.baselineRevision
      && item.reviewStatus === value.reviewStatus);
}

function isTextSlice(value: unknown): boolean {
  if (!isRecord(value)
    || !isNonEmptyString(value.revisionId)
    || !isUtf8Range(value.range)
    || typeof value.text !== 'string'
    || typeof value.done !== 'boolean') {
    return false;
  }
  const rangeByteLength = value.range.endByte - value.range.startByte;
  return rangeByteLength <= NOVEL_IMPORT_TEXT_SLICE_MAX_BYTES
    && new TextEncoder().encode(value.text).byteLength === rangeByteLength;
}

function isStalePreview(value: unknown): boolean {
  return isRecord(value)
    && Number.isSafeInteger(value.baselineRevision)
    && (value.baselineRevision as number) >= 1
    && ['adjust-chapter-boundaries', 'update-chapter-structure', 'confirm-review'].includes(String(value.commandType))
    && Array.isArray(value.affected)
    && value.affected.every(item => isRecord(item)
      && isNonEmptyString(item.artifactType)
      && isNonEmptyString(item.artifactId)
      && isNonEmptyString(item.reason))
    && typeof value.requiresConfirmation === 'boolean'
    && value.requiresConfirmation === (value.affected.length > 0);
}

function isChapter(
  value: unknown,
  textByteLength: number,
  expectedOrder: number,
): value is {
  chapterId: string;
  order: number;
  title: string;
  headingKind: 'source' | 'missing';
  headingRange?: { offsetUnit: 'utf8-byte'; startByte: number; endByte: number };
  contentRange: { offsetUnit: 'utf8-byte'; startByte: number; endByte: number };
  reviewStatus: 'pending' | 'approved' | 'rejected';
  lengthAnomalyAccepted: boolean;
} {
  if (!isRecord(value)
    || !isNonEmptyString(value.chapterId)
    || value.order !== expectedOrder
    || !isNonEmptyString(value.title)
    || !isUtf8RangeWithin(value.contentRange, textByteLength, true)
    || !['pending', 'approved', 'rejected'].includes(String(value.reviewStatus))
    || typeof value.lengthAnomalyAccepted !== 'boolean') {
    return false;
  }
  if (value.headingKind === 'missing')
    return value.headingRange === undefined && value.title === '未命名章节';
  return value.headingKind === 'source'
    && isUtf8RangeWithin(value.headingRange, textByteLength, false)
    && value.headingRange.endByte <= value.contentRange.startByte;
}

function isCoverage(
  value: unknown,
  textByteLength: number,
  chapterIds: ReadonlySet<string>,
): boolean {
  if (!isRecord(value)
    || value.totalByteLength !== textByteLength
    || !Number.isSafeInteger(value.classifiedByteLength)
    || !Number.isSafeInteger(value.unclassifiedByteLength)
    || (value.classifiedByteLength as number) < 0
    || (value.unclassifiedByteLength as number) < 0
    || typeof value.complete !== 'boolean'
    || !Array.isArray(value.segments)
    || !Array.isArray(value.uncoveredRanges)) {
    return false;
  }

  let cursor = 0;
  let classifiedByteLength = 0;
  let unclassifiedByteLength = 0;
  const unknownRanges: Array<{ startByte: number; endByte: number }> = [];
  const classifications = ['front-matter', 'chapter', 'appendix', 'noise', 'unknown'];
  for (const segment of value.segments) {
    if (!isRecord(segment)
      || !isUtf8RangeWithin(segment.range, textByteLength, false)
      || segment.range.startByte !== cursor
      || !classifications.includes(String(segment.classification))
      || (segment.chapterId !== undefined && !isNonEmptyString(segment.chapterId))
      || (segment.reason !== undefined
        && segment.reason !== 'uncovered-to-last'
        && segment.reason !== 'uncovered-to-next')
      || (segment.classification === 'chapter'
        ? !isNonEmptyString(segment.chapterId) || !chapterIds.has(segment.chapterId)
        : segment.chapterId !== undefined || segment.reason !== undefined)) {
      return false;
    }
    const byteLength = segment.range.endByte - segment.range.startByte;
    if (segment.classification === 'unknown') {
      unclassifiedByteLength += byteLength;
      unknownRanges.push(segment.range);
    } else {
      classifiedByteLength += byteLength;
    }
    cursor = segment.range.endByte;
  }
  if (cursor !== textByteLength
    || classifiedByteLength !== value.classifiedByteLength
    || unclassifiedByteLength !== value.unclassifiedByteLength
    || classifiedByteLength + unclassifiedByteLength !== textByteLength
    || value.uncoveredRanges.length !== unknownRanges.length) {
    return false;
  }
  for (const [index, range] of value.uncoveredRanges.entries()) {
    const unknown = unknownRanges[index];
    if (!isUtf8RangeWithin(range, textByteLength, false)
      || !unknown
      || range.startByte !== unknown.startByte
      || range.endByte !== unknown.endByte) {
      return false;
    }
  }
  const complete = unclassifiedByteLength === 0 && classifiedByteLength === textByteLength;
  return value.complete === complete;
}

function isRevisionHistoryItem(value: unknown): boolean {
  return isRecord(value)
    && isNonEmptyString(value.revisionId)
    && Number.isSafeInteger(value.baselineRevision)
    && (value.baselineRevision as number) >= 1
    && isSha256(value.sourceHash)
    && (TXT_SOURCE_ENCODINGS as readonly string[]).includes(String(value.encoding))
    && isNonEmptyString(value.processorVersion)
    && (value.reviewStatus === 'pending' || value.reviewStatus === 'approved')
    && typeof value.active === 'boolean'
    && isDateTime(value.createdAt);
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
    && (value.byteLength as number) >= 0
    && isSha256(value.sha256);
}

function isSourceProbe(value: unknown): boolean {
  return isRecord(value)
    && isNonEmptyString(value.sourceAssetId)
    && isNonEmptyString(value.originalName)
    && Number.isSafeInteger(value.byteLength)
    && (value.byteLength as number) >= 0
    && isSha256(value.sha256);
}

function isCoreHealth(value: unknown): boolean {
  return isRecord(value)
    && ['healthy', 'starting', 'unavailable'].includes(String(value.status))
    && typeof value.canRestart === 'boolean'
    && value.protocolVersion === 1;
}

function isUtf8Range(value: unknown): value is {
  readonly offsetUnit: 'utf8-byte';
  readonly startByte: number;
  readonly endByte: number;
} {
  return isRecord(value)
    && value.offsetUnit === 'utf8-byte'
    && Number.isSafeInteger(value.startByte)
    && Number.isSafeInteger(value.endByte)
    && (value.startByte as number) >= 0
    && (value.endByte as number) >= (value.startByte as number);
}

function isUtf8RangeWithin(
  value: unknown,
  maximum: number,
  allowEmpty: boolean,
): value is {
  readonly offsetUnit: 'utf8-byte';
  readonly startByte: number;
  readonly endByte: number;
} {
  return isUtf8Range(value)
    && value.endByte <= maximum
    && (allowEmpty ? value.endByte >= value.startByte : value.endByte > value.startByte);
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
