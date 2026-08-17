import type { NovelImportReviewCommandInput } from '@voxweaver/contracts';
import type { AppCoreService } from './appCoreService.ts';

import assert from 'node:assert/strict';
import test from 'node:test';
import { CORE_METHODS, CORE_PROTOCOL_VERSION } from '@voxweaver/contracts';
import { CoreRequestDispatcher } from './coreRequestDispatcher.ts';

const trustedContext = {
  appInstanceId: 'app-instance',
  webContentsId: 101,
  windowKind: 'project',
  projectId: 'project-1',
  projectSessionId: 'session-1',
} as const;

test('update-chapter-structure IPC 解析保留白名单字段并调用 Core', async () => {
  let captured: NovelImportReviewCommandInput | undefined;
  const dispatcher = createDispatcher((command) => {
    captured = command;
  });
  const command = {
    commandType: 'update-chapter-structure',
    baselineRevision: 1,
    insertionPoints: [3],
    chapters: [{
      title: '未命名章节',
      headingKind: 'missing',
      contentRange: { offsetUnit: 'utf8-byte', startByte: 0, endByte: 4 },
      lengthAnomalyAccepted: false,
    }],
    unassignedRanges: [],
  } as const;
  const response = await dispatcher.dispatch(request(command));

  assert.equal(response.ok, true);
  assert.deepEqual(captured, command);
});

test('update-chapter-structure IPC 拒绝嵌套额外字段和重复插入点', async () => {
  const dispatcher = createDispatcher(() => {
    assert.fail('invalid command must not reach the service');
  });
  const base = {
    commandType: 'update-chapter-structure',
    baselineRevision: 1,
    insertionPoints: [3],
    chapters: [{
      title: '未命名章节',
      headingKind: 'missing',
      contentRange: { offsetUnit: 'utf8-byte', startByte: 0, endByte: 4 },
      lengthAnomalyAccepted: false,
    }],
    unassignedRanges: [],
  };
  const responses = await Promise.all([
    dispatcher.dispatch(request({
      ...base,
      chapters: [{ ...base.chapters[0], unexpected: true }],
    })),
    dispatcher.dispatch(request({ ...base, insertionPoints: [3, 3] })),
    dispatcher.dispatch(request({ ...base, unexpected: true })),
  ]);

  for (const response of responses) {
    assert.equal(response.ok, false);
    if (!response.ok)
      assert.equal(response.error.code, 'IPC_PAYLOAD_INVALID');
  }
});

function createDispatcher(onPreview: (command: NovelImportReviewCommandInput) => void) {
  const core = {
    novelImport: {
      previewReview: async (_context: unknown, command: NovelImportReviewCommandInput) => {
        onPreview(command);
        return {
          baselineRevision: command.baselineRevision,
          commandType: command.commandType,
          affected: [],
          requiresConfirmation: false,
        };
      },
    },
  } as unknown as AppCoreService;
  return new CoreRequestDispatcher(core);
}

function request(payload: unknown) {
  return {
    protocolVersion: CORE_PROTOCOL_VERSION,
    requestId: 'request-1',
    method: CORE_METHODS.novelImportPreviewReview,
    trustedContext,
    payload,
  };
}
