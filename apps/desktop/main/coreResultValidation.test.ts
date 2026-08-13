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
    expect(() => validateCoreMethodResult(CORE_METHODS.novelImportGetTextSlice, {
      revisionId: 'revision-1',
      text: '正文',
      totalByteLength: 6,
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
});
