// @vitest-environment node

import { CORE_METHODS } from '@voxweaver/contracts';
import { describe, expect, it } from 'vitest';
import {
  validateCoreMethodResult,
  validateNovelImportEvent,
} from './coreResultValidation.ts';

const project = {
  projectId: 'project-1',
  displayName: '项目',
  sourceFileName: 'novel.txt',
  createdAt: '2026-08-13T00:00:00.000Z',
  updatedAt: '2026-08-13T00:00:00.000Z',
  layoutVersion: 2,
} as const;

describe('core method result validation', () => {
  it('接受完整项目会话并拒绝缺失可信身份的结果', () => {
    const valid = {
      project,
      projectSessionId: 'session-1',
      canonicalRootPath: '/projects/one',
    };
    expect(validateCoreMethodResult(CORE_METHODS.createProject, valid)).toBe(valid);
    expect(() => validateCoreMethodResult(CORE_METHODS.createProject, {
      project,
      projectSessionId: 'session-1',
    })).toThrowError(/无效结果/u);
  });

  it('按方法拒绝错误的 null、task 和 text slice 结果', () => {
    expect(validateCoreMethodResult(CORE_METHODS.closeProject, null)).toBeNull();
    expect(() => validateCoreMethodResult(CORE_METHODS.closeProject, {})).toThrowError(/无效结果/u);
    expect(() => validateCoreMethodResult(CORE_METHODS.novelImportGetTask, {
      taskId: 'task-1',
      status: 'running',
    })).toThrowError(/无效结果/u);
    const slice = {
      revisionId: 'revision-1',
      range: { offsetUnit: 'utf8-byte', startByte: 0, endByte: 6 },
      text: '正文',
      done: true,
    } as const;
    expect(validateCoreMethodResult(CORE_METHODS.novelImportGetTextSlice, slice)).toBe(slice);
    expect(() => validateCoreMethodResult(CORE_METHODS.novelImportGetTextSlice, {
      revisionId: slice.revisionId,
      range: slice.range,
      text: slice.text,
    })).toThrowError(/无效结果/u);
    expect(() => validateCoreMethodResult(CORE_METHODS.novelImportGetTextSlice, {
      ...slice,
      range: { ...slice.range, endByte: 5 },
    })).toThrowError(/无效结果/u);
  });

  it('验证源文本预览的编码、游标和行数', () => {
    const valid = {
      sourceHash: 'a'.repeat(64),
      sourceEncoding: 'gb2312',
      startByte: 0,
      endByte: 12,
      text: '第一行\n',
      completeLineCount: 1,
      done: false,
    } as const;
    expect(validateCoreMethodResult(CORE_METHODS.novelImportGetSourcePreview, valid)).toBe(valid);
    expect(() => validateCoreMethodResult(CORE_METHODS.novelImportGetSourcePreview, {
      ...valid,
      sourceEncoding: 'utf-32',
    })).toThrowError(/无效结果/u);
    expect(() => validateCoreMethodResult(CORE_METHODS.novelImportGetSourcePreview, {
      ...valid,
      endByte: -1,
    })).toThrowError(/无效结果/u);
  });

  it('小说导入事件必须同时匹配 envelope、序号、时间和 task schema', () => {
    const occurredAt = '2026-08-13T00:00:01.000Z';
    const payload = {
      eventType: 'task-completed',
      sequence: 1,
      occurredAt,
      task: {
        taskId: 'task-1',
        taskType: 'novel-import',
        status: 'succeeded',
        recoveryStatus: 'none',
        attempt: 1,
        progress: { completed: 100, total: 100, percent: 100, message: '导入完成' },
        canCancel: false,
        canRetry: false,
        createdAt: '2026-08-13T00:00:00.000Z',
        updatedAt: occurredAt,
      },
    } as const;
    const event = {
      protocolVersion: 1,
      eventId: 'event-1',
      eventType: payload.eventType,
      occurredAt,
      projectId: 'project-1',
      projectSessionId: 'session-1',
      payload,
    } as const;
    expect(validateNovelImportEvent(event)).toBe(payload);
    expect(() => validateNovelImportEvent({
      ...event,
      payload: { ...payload, eventType: 'task-failed' },
    })).toThrowError(/无效小说导入事件/u);
    expect(() => validateNovelImportEvent({
      ...event,
      payload: { ...payload, sequence: 0 },
    })).toThrowError(/无效小说导入事件/u);
  });

  it('深层验证章节快照的标题类型、范围、coverage 和 revision history', () => {
    const snapshot = validReviewSnapshot();
    expect(validateCoreMethodResult(CORE_METHODS.novelImportGetReviewSnapshot, snapshot))
      .toBe(snapshot);
    expect(() => validateCoreMethodResult(CORE_METHODS.novelImportGetReviewSnapshot, {
      ...snapshot,
      chapters: [{ ...snapshot.chapters[0], headingKind: 'missing' }],
    })).toThrowError(/无效结果/u);
    expect(() => validateCoreMethodResult(CORE_METHODS.novelImportGetReviewSnapshot, {
      ...snapshot,
      chapters: [{
        ...snapshot.chapters[0],
        contentRange: { ...snapshot.chapters[0].contentRange, endByte: 13 },
      }],
    })).toThrowError(/无效结果/u);
    expect(() => validateCoreMethodResult(CORE_METHODS.novelImportGetReviewSnapshot, {
      ...snapshot,
      coverage: {
        ...snapshot.coverage,
        segments: [{
          ...snapshot.coverage.segments[0],
          range: { offsetUnit: 'utf8-byte', startByte: 0, endByte: 11 },
        }],
      },
    })).toThrowError(/无效结果/u);
    expect(() => validateCoreMethodResult(CORE_METHODS.novelImportGetReviewSnapshot, {
      ...snapshot,
      revisionHistory: [{ ...snapshot.revisionHistory[0], sourceHash: 'invalid' }],
    })).toThrowError(/无效结果/u);
  });

  it('stale preview 仅接受已知章节复核命令类型和完整影响项', () => {
    const preview = {
      baselineRevision: 1,
      commandType: 'update-chapter-structure',
      affected: [{ artifactType: 'proofreading', artifactId: 'artifact-1', reason: '结构变化' }],
      requiresConfirmation: true,
    } as const;
    expect(validateCoreMethodResult(CORE_METHODS.novelImportPreviewReview, preview)).toBe(preview);
    expect(() => validateCoreMethodResult(CORE_METHODS.novelImportPreviewReview, {
      ...preview,
      commandType: 'unknown-command',
    })).toThrowError(/无效结果/u);
    expect(() => validateCoreMethodResult(CORE_METHODS.novelImportPreviewReview, {
      ...preview,
      affected: [{ artifactType: 'proofreading', artifactId: 'artifact-1' }],
    })).toThrowError(/无效结果/u);
  });
});

function validReviewSnapshot() {
  const revisionId = 'revision-1';
  const createdAt = '2026-08-13T00:00:00.000Z';
  return {
    revisionId,
    baselineRevision: 1,
    source: {
      sourceAssetId: 'source-1',
      originalName: 'novel.txt',
      byteLength: 12,
      sha256: 'a'.repeat(64),
    },
    encoding: 'utf-8',
    encodingMethod: 'strict-utf8',
    textByteLength: 12,
    chapters: [{
      chapterId: 'chapter-1',
      order: 1,
      title: '第一章',
      headingKind: 'source',
      headingRange: { offsetUnit: 'utf8-byte', startByte: 0, endByte: 3 },
      contentRange: { offsetUnit: 'utf8-byte', startByte: 4, endByte: 12 },
      reviewStatus: 'pending',
      lengthAnomalyAccepted: false,
    }],
    coverage: {
      totalByteLength: 12,
      classifiedByteLength: 12,
      unclassifiedByteLength: 0,
      complete: true,
      segments: [{
        classification: 'chapter',
        range: { offsetUnit: 'utf8-byte', startByte: 0, endByte: 12 },
        chapterId: 'chapter-1',
      }],
      uncoveredRanges: [],
    },
    revisionHistory: [{
      revisionId,
      baselineRevision: 1,
      sourceHash: 'a'.repeat(64),
      encoding: 'utf-8',
      processorVersion: '2',
      reviewStatus: 'pending',
      active: true,
      createdAt,
    }],
    reviewStatus: 'pending',
    createdAt,
  } as const;
}
