/* eslint-disable test/no-import-node-test */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';
import { pathToFileURL } from 'node:url';

const moduleDirectory = await mkdtemp(join(tmpdir(), 'voxweaver-m1-15d-'));
const bridgeModulePath = join(moduleDirectory, 'desktopBridgeError.mts');
const controllerModulePath = join(moduleDirectory, 'novelImportController.mts');
const [bridgeSource, controllerSource] = await Promise.all([
  readFile(new URL('../../shared/desktopBridgeError.ts', import.meta.url), 'utf8'),
  readFile(new URL(
    '../../renderer/features/novelImport/novelImportController.ts',
    import.meta.url,
  ), 'utf8'),
]);
await Promise.all([
  writeFile(bridgeModulePath, bridgeSource),
  writeFile(
    controllerModulePath,
    controllerSource.replace(
      '../../../shared/desktopBridgeError.js',
      './desktopBridgeError.mts',
    ),
  ),
]);
const { encodeDesktopBridgeError } = await import(pathToFileURL(bridgeModulePath).href);
const {
  NovelImportController,
  resolveNovelImportKeyboardCommand,
} = await import(pathToFileURL(controllerModulePath).href);

after(async () => rm(moduleDirectory, { force: true, recursive: true }));

const PROJECT_A = {
  accessMode: 'read-write',
  projectId: '00000000-0000-4000-8000-000000000101',
  projectSessionId: '00000000-0000-4000-8000-000000000102',
};
const PROJECT_B = {
  accessMode: 'read-write',
  projectId: '00000000-0000-4000-8000-000000000201',
  projectSessionId: '00000000-0000-4000-8000-000000000202',
};
const TASK_ID = '00000000-0000-4000-8000-000000000301';
const OTHER_TASK_ID = '00000000-0000-4000-8000-000000000302';
const ARTIFACT_ID = '00000000-0000-4000-8000-000000000401';
const OTHER_ARTIFACT_ID = '00000000-0000-4000-8000-000000000406';
const REVISION_ID = '00000000-0000-4000-8000-000000000402';
const OTHER_REVISION_ID = '00000000-0000-4000-8000-000000000405';
const TEXT_REVISION_ID = '00000000-0000-4000-8000-000000000403';
const CHAPTER_ID = '00000000-0000-4000-8000-000000000501';
const OTHER_CHAPTER_ID = '00000000-0000-4000-8000-000000000503';
const PROPOSAL_ID = '00000000-0000-4000-8000-000000000601';

test('runs the normal source-to-review flow and stores only the session-bound task id', async () => {
  const storage = createStorage();
  const calls = [];
  const api = createApi({
    inspect: async (payload) => {
      calls.push(['inspect', payload]);
      return withSession({ snapshot: createSnapshot() });
    },
    selectSource: async (payload) => {
      calls.push(['select', payload]);
      return withSession({
        canceled: false,
        displayName: 'synthetic.txt',
        expiresAt: '2026-08-10T01:05:00.000Z',
        selectionToken: 'selection_token_123456',
      });
    },
    start: async (payload) => {
      calls.push(['start', payload]);
      return withSession({
        baselineRevision: createBaseline(),
        task: createTask('succeeded'),
      });
    },
  });
  const controller = createController(api, storage);

  await controller.activate(PROJECT_A);
  await controller.selectSource();
  await controller.start();

  assert.equal(controller.state.phase, 'completed');
  assert.equal(controller.state.snapshot?.source.format, 'txt');
  assert.equal(controller.state.selectedSource?.displayName, 'synthetic.txt');
  assert.deepEqual(calls.map(([name]) => name), ['select', 'start', 'inspect']);

  const startPayload = calls.find(([name]) => name === 'start')[1];
  assert.equal(startPayload.selectionToken, 'selection_token_123456');
  assert.equal(startPayload.idempotencyKey, 'idempotency-key');
  assert.equal(startPayload.sourceEncoding, undefined);

  const stored = JSON.parse(storage.values()[0]);
  assert.deepEqual(stored, {
    projectId: PROJECT_A.projectId,
    projectSessionId: PROJECT_A.projectSessionId,
    taskId: TASK_ID,
  });
  assert.doesNotMatch(storage.values()[0], /selection_token|synthetic|before|after/);
});

test('reuses one selection token and idempotency key after encoding is required', async () => {
  const startPayloads = [];
  let startAttempt = 0;
  let retryCalls = 0;
  const api = createApi({
    retryTask: async () => {
      retryCalls += 1;
      return withSession({ task: createTask('running') });
    },
    selectSource: async () => withSession({
      canceled: false,
      displayName: 'encoding.txt',
      expiresAt: '2026-08-10T01:05:00.000Z',
      selectionToken: 'encoding_token_12345',
    }),
    start: async (payload) => {
      startPayloads.push(payload);
      startAttempt += 1;
      if (startAttempt === 1) {
        throw isolatedBridgeError('NOVEL_IMPORT_ENCODING_REQUIRED', false);
      }
      return withSession({ task: createTask('running') });
    },
  });
  const controller = createController(api);

  await controller.activate(PROJECT_A);
  await controller.selectSource();
  await controller.start();
  assert.equal(controller.state.phase, 'encoding-required');

  controller.setEncoding('gbk');
  await controller.start();

  assert.equal(startPayloads.length, 2);
  assert.equal(startPayloads[0].selectionToken, startPayloads[1].selectionToken);
  assert.equal(startPayloads[0].idempotencyKey, startPayloads[1].idempotencyKey);
  assert.equal(startPayloads[1].sourceEncoding, 'gbk');
  assert.equal(retryCalls, 0);
});

test('cancels a running task without treating it as completed', async () => {
  let canceledTaskId;
  const api = createApi({
    cancelTask: async (payload) => {
      canceledTaskId = payload.taskId;
      return withSession({ task: createTask('canceled') });
    },
    selectSource: async () => withSession({
      canceled: false,
      displayName: 'cancel.txt',
      expiresAt: '2026-08-10T01:05:00.000Z',
      selectionToken: 'cancel_token_123456',
    }),
    start: async () => withSession({ task: createTask('running') }),
  });
  const controller = createController(api);

  await controller.activate(PROJECT_A);
  await controller.selectSource();
  await controller.start();
  await controller.cancelTask();

  assert.equal(canceledTaskId, TASK_ID);
  assert.equal(controller.state.phase, 'canceled');
  assert.equal(controller.state.snapshot, null);
  assert.match(controller.state.statusMessage, /未把中间结果标记为完成/);
});

test('shows a stable no-adapter error without inventing a review snapshot', async () => {
  const api = createApi({
    selectSource: async () => withSession({
      canceled: false,
      displayName: 'unsupported.bin',
      expiresAt: '2026-08-10T01:05:00.000Z',
      selectionToken: 'unsupported_token_1',
    }),
    start: async () => {
      throw bridgeError('NOVEL_IMPORT_UNSUPPORTED_FORMAT', false);
    },
  });
  const controller = createController(api);

  await controller.activate(PROJECT_A);
  await controller.selectSource();
  await controller.start();

  assert.equal(controller.state.error?.code, 'NOVEL_IMPORT_UNSUPPORTED_FORMAT');
  assert.match(controller.state.error?.message ?? '', /没有可处理/);
  assert.equal(controller.state.snapshot, null);
  assert.equal(controller.state.phase, 'failed');
});

test('does not misreport a succeeded task as failed when review inspection is unavailable', async () => {
  const api = createApi({
    inspect: async () => {
      throw bridgeError('DESKTOP_METHOD_NOT_FOUND', false);
    },
    selectSource: async () => withSession({
      canceled: false,
      displayName: 'completed.txt',
      expiresAt: '2026-08-10T01:05:00.000Z',
      selectionToken: 'completed_token_123',
    }),
    start: async () => withSession({
      baselineRevision: createBaseline(),
      task: createTask('succeeded'),
    }),
  });
  const controller = createController(api);

  await controller.activate(PROJECT_A);
  await controller.selectSource();
  await controller.start();

  assert.equal(controller.state.task?.executionStatus, 'succeeded');
  assert.equal(controller.state.phase, 'completed');
  assert.equal(controller.state.error?.code, 'DESKTOP_METHOD_NOT_FOUND');
  assert.equal(controller.state.snapshot, null);
});

test('uses a validated error taskId to recover when start failed before returning a task result', async () => {
  let retriedTaskId;
  const api = createApi({
    retryTask: async (payload) => {
      retriedTaskId = payload.taskId;
      return withSession({ task: createTask('running', 2) });
    },
    selectSource: async () => withSession({
      canceled: false,
      displayName: 'recoverable.txt',
      expiresAt: '2026-08-10T01:05:00.000Z',
      selectionToken: 'recoverable_token_1',
    }),
    start: async () => {
      throw isolatedBridgeError('NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE', true, {
        currentArtifactRevisionId: REVISION_ID,
        taskId: TASK_ID,
      });
    },
  });
  const controller = createController(api);

  await controller.activate(PROJECT_A);
  await controller.selectSource();
  await controller.start();
  assert.equal(controller.state.error?.taskId, TASK_ID);
  assert.equal(controller.state.error?.currentArtifactRevisionId, REVISION_ID);
  await controller.retryTask();

  assert.equal(retriedTaskId, TASK_ID);
  assert.equal(controller.state.task?.attempt, 2);
});

test('preserves failed-event recovery metadata and rejects out-of-order events', async () => {
  let listener;
  let retryCalls = 0;
  const api = createApi({
    onEvent: (nextListener) => {
      listener = nextListener;
      return () => {
        listener = undefined;
      };
    },
    retryTask: async () => {
      retryCalls += 1;
      return withSession({ task: createTask('running', 2) });
    },
    selectSource: async () => withSession({
      canceled: false,
      displayName: 'event.txt',
      expiresAt: '2026-08-10T01:05:00.000Z',
      selectionToken: 'event_token_123456',
    }),
    start: async () => withSession({ task: createTask('running') }),
  });
  const controller = createController(api);

  await controller.activate(PROJECT_A);
  await controller.selectSource();
  await controller.start();
  listener(createEvent('novelImport.taskFailed', 4, createTask('failed'), {
    error: {
      ...bridgeError('NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE', true),
      contractVersion: '1',
      currentArtifactRevisionId: REVISION_ID,
      message: 'The novel import request could not be completed.',
      projectId: PROJECT_A.projectId,
      projectSessionId: PROJECT_A.projectSessionId,
      taskId: TASK_ID,
    },
  }));

  assert.deepEqual(controller.state.error, {
    code: 'NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE',
    currentArtifactRevisionId: REVISION_ID,
    message: '所需导入适配器或处理能力当前不可用。',
    retryable: true,
    taskId: TASK_ID,
  });
  assert.equal(controller.state.lastEventSequence, 4);

  listener(createEvent('novelImport.taskProgress', 3, createTask('running')));
  assert.equal(controller.state.task?.executionStatus, 'failed');
  assert.equal(controller.state.lastEventSequence, 4);

  await controller.retryTask();
  assert.equal(retryCalls, 1);
  assert.equal(controller.state.task?.attempt, 2);
});

test('clears a previous-attempt failure on retry-scheduled and completed events', async () => {
  let listener;
  const api = createApi({
    inspect: async () => withSession({ snapshot: createSnapshot() }),
    onEvent: (nextListener) => {
      listener = nextListener;
      return () => {};
    },
    selectSource: async () => withSession({
      canceled: false,
      displayName: 'event-retry.txt',
      expiresAt: '2026-08-10T01:05:00.000Z',
      selectionToken: 'event_retry_token_1',
    }),
    start: async () => withSession({ task: createTask('running') }),
  });
  const controller = createController(api);
  await controller.activate(PROJECT_A);
  await controller.selectSource();
  await controller.start();

  listener(createFailedEvent(1, createTask('failed')));
  assert.equal(controller.state.error?.code, 'NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE');

  listener(createEvent(
    'novelImport.taskRetryScheduled',
    2,
    createTask('pending', 2),
    { previousAttempt: 1 },
  ));
  assert.equal(controller.state.task?.attempt, 2);
  assert.equal(controller.state.task?.executionStatus, 'pending');
  assert.equal(controller.state.error, null);

  listener(createFailedEvent(3, createTask('failed', 2)));
  assert.equal(controller.state.error?.code, 'NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE');

  listener(createEvent(
    'novelImport.taskCompleted',
    4,
    createTask('succeeded', 3),
    { baselineRevision: createBaseline() },
  ));
  await flushAsync();

  assert.equal(controller.state.task?.attempt, 3);
  assert.equal(controller.state.task?.executionStatus, 'succeeded');
  assert.equal(controller.state.error, null);
  assert.equal(controller.state.snapshot?.baselineRevision.artifactId, ARTIFACT_ID);
});

test('keeps the first accepted event sequence while refresh recovery is still pending', async () => {
  const pendingTask = deferred();
  const storage = createStorage({
    projectId: PROJECT_A.projectId,
    projectSessionId: PROJECT_A.projectSessionId,
    taskId: TASK_ID,
  });
  let listener;
  const api = createApi({
    getTask: async () => pendingTask.promise,
    onEvent: (nextListener) => {
      listener = nextListener;
      return () => {};
    },
  });
  const controller = createController(api, storage);

  const activation = controller.activate(PROJECT_A);
  listener(createEvent('novelImport.taskProgress', 4, createTask('running')));
  listener(createEvent('novelImport.taskProgress', 3, createTask('failed')));

  assert.equal(controller.state.lastEventSequence, 4);
  assert.equal(controller.state.task?.executionStatus, 'running');

  pendingTask.resolve(withSession({ task: createTask('running') }));
  await activation;
});

test('allows read-only inspection recovery but rejects every write before API invocation', async () => {
  const storage = createStorage({
    projectId: PROJECT_A.projectId,
    projectSessionId: PROJECT_A.projectSessionId,
    taskId: TASK_ID,
  });
  let selectCalls = 0;
  let inspectCalls = 0;
  const api = createApi({
    getTask: async () => withSession({
      baselineRevision: createBaseline(),
      task: createTask('succeeded'),
    }),
    inspect: async () => {
      inspectCalls += 1;
      return withSession({ snapshot: createSnapshot(true) });
    },
    selectSource: async () => {
      selectCalls += 1;
      return withSession({ canceled: true });
    },
  });
  const controller = createController(api, storage);

  await controller.activate({ ...PROJECT_A, accessMode: 'read-only' });
  assert.equal(controller.state.snapshot?.readOnly, true);
  assert.equal(inspectCalls, 1);

  await controller.selectSource();
  await controller.prepareBoundaryAdjustment({
    chapterId: CHAPTER_ID,
    contentEndByte: 10,
    contentStartByte: 2,
    headingEndByte: 2,
    headingStartByte: 0,
  });
  assert.equal(selectCalls, 0);
  assert.equal(controller.state.error?.code, 'PROJECT_READ_ONLY');
});

test('discards old async responses and old events after a project-session switch', async () => {
  const pendingSelection = deferred();
  const listeners = [];
  let unsubscribeCount = 0;
  const api = createApi({
    onEvent: (listener) => {
      listeners.push(listener);
      return () => {
        unsubscribeCount += 1;
      };
    },
    selectSource: async () => pendingSelection.promise,
  });
  const controller = createController(api);

  await controller.activate(PROJECT_A);
  const selectionPromise = controller.selectSource();
  await controller.activate(PROJECT_B);
  pendingSelection.resolve(withSession({
    canceled: false,
    displayName: 'old-session.txt',
    expiresAt: '2026-08-10T01:05:00.000Z',
    selectionToken: 'old_session_token',
  }));
  await selectionPromise;

  listeners[0](createEvent('novelImport.taskProgress', 99, createTask('running')));
  assert.equal(controller.state.project?.projectId, PROJECT_B.projectId);
  assert.equal(controller.state.selectedSource, null);
  assert.equal(controller.state.task, null);
  assert.equal(unsubscribeCount, 1);
});

test('restores the matching refresh task and ignores another session stored task', async () => {
  const storage = createStorage({
    projectId: PROJECT_A.projectId,
    projectSessionId: PROJECT_A.projectSessionId,
    taskId: TASK_ID,
  });
  let taskQueries = 0;
  const api = createApi({
    getTask: async () => {
      taskQueries += 1;
      return withSession({
        baselineRevision: createBaseline(),
        task: createTask('succeeded'),
      });
    },
    inspect: async () => withSession({ snapshot: createSnapshot() }),
  });
  const controller = createController(api, storage);

  await controller.activate(PROJECT_A);
  assert.equal(taskQueries, 1);
  assert.equal(controller.state.snapshot?.baselineRevision.artifactRevisionId, REVISION_ID);

  await controller.activate(PROJECT_B);
  assert.equal(taskQueries, 1);
  assert.equal(controller.state.task, null);
  assert.equal(controller.state.snapshot, null);
});

test('previews stale impact and waits for explicit confirmation before a review write', async () => {
  let previewCalls = 0;
  let executeCalls = 0;
  const api = createApi({
    executeReviewCommand: async (_payload) => {
      executeCalls += 1;
      return withSession({
        artifact: {
          artifactId: ARTIFACT_ID,
          artifactRevisionId: REVISION_ID,
          executionStatus: 'succeeded',
          reviewStatus: 'pending',
          validityStatus: 'current',
        },
        outcome: 'committed',
        snapshot: createSnapshot(),
      });
    },
    getTask: async () => withSession({
      baselineRevision: createBaseline(),
      task: createTask('succeeded'),
    }),
    inspect: async () => withSession({ snapshot: createSnapshot() }),
    previewStaleImpact: async (payload) => {
      previewCalls += 1;
      assert.deepEqual(payload.query.changeSelector, { chapterIds: [CHAPTER_ID] });
      return withSession({ preview: createPreview(true) });
    },
  });
  const storage = createStorage({
    projectId: PROJECT_A.projectId,
    projectSessionId: PROJECT_A.projectSessionId,
    taskId: TASK_ID,
  });
  const controller = createController(api, storage);
  await controller.activate(PROJECT_A);

  await controller.prepareBoundaryAdjustment({
    chapterId: CHAPTER_ID,
    contentEndByte: 10,
    contentStartByte: 3,
    headingEndByte: 3,
    headingStartByte: 0,
  });
  assert.equal(previewCalls, 1);
  assert.equal(executeCalls, 0);
  assert.equal(controller.state.pendingReview?.preview.canApply, true);

  await controller.confirmPendingReview();
  assert.equal(executeCalls, 1);
  assert.equal(controller.state.pendingReview, null);
});

test('rejects a review result for another artifact without landing its snapshot', async () => {
  const mismatchedSnapshot = {
    ...createSnapshot(),
    baselineRevision: {
      ...createBaseline(),
      artifactId: OTHER_ARTIFACT_ID,
    },
  };
  const api = createApi({
    executeReviewCommand: async () => withSession({
      artifact: {
        artifactId: OTHER_ARTIFACT_ID,
        artifactRevisionId: REVISION_ID,
        executionStatus: 'succeeded',
        reviewStatus: 'pending',
        validityStatus: 'current',
      },
      outcome: 'committed',
      snapshot: mismatchedSnapshot,
    }),
    getTask: async () => withSession({
      baselineRevision: createBaseline(),
      task: createTask('succeeded'),
    }),
    inspect: async () => withSession({ snapshot: createSnapshot() }),
    previewStaleImpact: async () => withSession({ preview: createPreview(true) }),
  });
  const controller = createController(api, storedTask());
  await controller.activate(PROJECT_A);
  const originalSnapshot = controller.state.snapshot;

  await controller.prepareBoundaryAdjustment({
    chapterId: CHAPTER_ID,
    contentEndByte: 10,
    contentStartByte: 3,
    headingEndByte: 3,
    headingStartByte: 0,
  });
  const originalPendingReview = controller.state.pendingReview;
  await controller.confirmPendingReview();

  assert.equal(controller.state.error?.code, 'DESKTOP_CORE_UNAVAILABLE');
  assert.equal(controller.state.snapshot, originalSnapshot);
  assert.equal(controller.state.pendingReview, originalPendingReview);
});

test('uses a conservative chapter selector for uncovered and normalization review previews', async () => {
  const seen = [];
  const api = createApi({
    getTask: async () => withSession({
      baselineRevision: createBaseline(),
      task: createTask('succeeded'),
    }),
    inspect: async () => withSession({ snapshot: createSnapshot() }),
    previewStaleImpact: async (payload) => {
      seen.push(payload.query);
      return withSession({ preview: createPreview(true) });
    },
  });
  const storage = createStorage({
    projectId: PROJECT_A.projectId,
    projectSessionId: PROJECT_A.projectSessionId,
    taskId: TASK_ID,
  });
  const controller = createController(api, storage);
  await controller.activate(PROJECT_A);

  await controller.prepareRangeClassification(0, 'front_matter');
  controller.cancelPendingReview();
  await controller.prepareNormalizationDecision(PROPOSAL_ID, 'approved');

  assert.deepEqual(seen.map(query => query.changeSelector), [
    { chapterIds: [CHAPTER_ID] },
    { chapterIds: [CHAPTER_ID] },
  ]);
  assert.equal(seen[0].changeKind, 'range-classification');
  assert.equal(seen[1].changeKind, 'normalization-decision');
});

test('accepts an empty content range but rejects heading gaps, overlaps, and empty headings before preview', async () => {
  let previewCalls = 0;
  const api = createApi({
    getTask: async () => withSession({
      baselineRevision: createBaseline(),
      task: createTask('succeeded'),
    }),
    inspect: async () => withSession({ snapshot: createSnapshot() }),
    previewStaleImpact: async () => {
      previewCalls += 1;
      return withSession({ preview: createPreview(true) });
    },
  });
  const controller = createController(api, storedTask());
  await controller.activate(PROJECT_A);

  await controller.prepareBoundaryAdjustment({
    chapterId: CHAPTER_ID,
    contentEndByte: 3,
    contentStartByte: 3,
    headingEndByte: 3,
    headingStartByte: 0,
  });
  assert.equal(previewCalls, 1);
  assert.equal(
    controller.state.pendingReview?.command.commandType,
    'adjust-chapter-boundary',
  );
  assert.equal(controller.state.pendingReview?.command.contentRange.startByte, 3);
  assert.equal(controller.state.pendingReview?.command.contentRange.endByte, 3);
  controller.cancelPendingReview();

  for (const invalidDraft of [
    {
      chapterId: CHAPTER_ID,
      contentEndByte: 10,
      contentStartByte: 4,
      headingEndByte: 3,
      headingStartByte: 0,
    },
    {
      chapterId: CHAPTER_ID,
      contentEndByte: 10,
      contentStartByte: 3,
      headingEndByte: 4,
      headingStartByte: 0,
    },
    {
      chapterId: CHAPTER_ID,
      contentEndByte: 10,
      contentStartByte: 2,
      headingEndByte: 2,
      headingStartByte: 2,
    },
  ]) {
    await controller.prepareBoundaryAdjustment(invalidDraft);
    assert.equal(controller.state.error?.code, 'DESKTOP_PAYLOAD_INVALID');
    assert.equal(controller.state.pendingReview, null);
  }
  assert.equal(previewCalls, 1);
});

test('rejects an inspect snapshot whose baseline does not match the requested baseline', async () => {
  const mismatchedSnapshot = {
    ...createSnapshot(),
    baselineRevision: {
      ...createBaseline(),
      artifactRevisionId: OTHER_REVISION_ID,
    },
  };
  const api = createApi({
    getTask: async () => withSession({
      baselineRevision: createBaseline(),
      task: createTask('succeeded'),
    }),
    inspect: async () => withSession({ snapshot: mismatchedSnapshot }),
  });
  const controller = createController(api, storedTask());

  await controller.activate(PROJECT_A);

  assert.equal(controller.state.task?.taskId, TASK_ID);
  assert.equal(controller.state.snapshot, null);
  assert.equal(controller.state.error?.code, 'DESKTOP_CORE_UNAVAILABLE');
});

test('rejects stale-impact previews with a mismatched baseline or selector', async () => {
  for (const preview of [
    {
      ...createPreview(true),
      baselineRevision: {
        ...createBaseline(),
        artifactRevisionId: OTHER_REVISION_ID,
      },
    },
    {
      ...createPreview(true),
      changeSelector: { chapterIds: [OTHER_CHAPTER_ID] },
    },
  ]) {
    const api = createApi({
      getTask: async () => withSession({
        baselineRevision: createBaseline(),
        task: createTask('succeeded'),
      }),
      inspect: async () => withSession({ snapshot: createSnapshot() }),
      previewStaleImpact: async () => withSession({ preview }),
    });
    const controller = createController(api, storedTask());
    await controller.activate(PROJECT_A);

    await controller.prepareBoundaryAdjustment({
      chapterId: CHAPTER_ID,
      contentEndByte: 10,
      contentStartByte: 3,
      headingEndByte: 3,
      headingStartByte: 0,
    });

    assert.equal(controller.state.pendingReview, null);
    assert.equal(controller.state.error?.code, 'DESKTOP_CORE_UNAVAILABLE');
  }
});

test('rejects getTask responses for another task without landing task state', async () => {
  const api = createApi({
    getTask: async () => withSession({
      task: { ...createTask('running'), taskId: OTHER_TASK_ID },
    }),
  });
  const controller = createController(api, storedTask());

  await controller.activate(PROJECT_A);

  assert.equal(controller.state.task, null);
  assert.equal(controller.state.snapshot, null);
  assert.equal(controller.state.error?.code, 'DESKTOP_CORE_UNAVAILABLE');
});

test('rejects cancel and retry responses for another task without replacing the requested task', async () => {
  for (const scenario of [
    { action: 'cancelTask', initialStatus: 'running' },
    { action: 'retryTask', initialStatus: 'failed' },
  ]) {
    const api = createApi({
      cancelTask: async () => withSession({
        task: { ...createTask('canceled'), taskId: OTHER_TASK_ID },
      }),
      retryTask: async () => withSession({
        task: { ...createTask('running', 2), taskId: OTHER_TASK_ID },
      }),
      selectSource: async () => withSession({
        canceled: false,
        displayName: 'correlation.txt',
        expiresAt: '2026-08-10T01:05:00.000Z',
        selectionToken: 'correlation_token',
      }),
      start: async () => withSession({
        task: createTask(scenario.initialStatus),
      }),
    });
    const controller = createController(api);
    await controller.activate(PROJECT_A);
    await controller.selectSource();
    await controller.start();

    await controller[scenario.action]();

    assert.equal(controller.state.task?.taskId, TASK_ID);
    assert.equal(controller.state.task?.executionStatus, scenario.initialStatus);
    assert.equal(controller.state.error?.code, 'DESKTOP_CORE_UNAVAILABLE');
  }
});

test('keeps completed and failed events when an older running getTask response arrives later', async () => {
  for (const terminalStatus of ['succeeded', 'failed']) {
    const pendingTask = deferred();
    let listener;
    const api = createApi({
      getTask: async () => pendingTask.promise,
      inspect: async () => withSession({ snapshot: createSnapshot() }),
      onEvent: (nextListener) => {
        listener = nextListener;
        return () => {};
      },
    });
    const controller = createController(api, storedTask());
    const activation = controller.activate(PROJECT_A);
    const terminalTask = {
      ...createTask(terminalStatus),
      updatedAt: '2026-08-10T01:00:10.000Z',
    };
    listener(createEvent(
      terminalStatus === 'succeeded'
        ? 'novelImport.taskCompleted'
        : 'novelImport.taskFailed',
      8,
      terminalTask,
      terminalStatus === 'succeeded'
        ? { baselineRevision: createBaseline() }
        : {
            error: {
              ...bridgeError('NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE', true),
              contractVersion: '1',
              message: 'The novel import request could not be completed.',
              projectId: PROJECT_A.projectId,
              projectSessionId: PROJECT_A.projectSessionId,
              taskId: TASK_ID,
            },
          },
    ));
    pendingTask.resolve(withSession({
      task: {
        ...createTask('running'),
        updatedAt: '2026-08-10T01:00:05.000Z',
      },
    }));
    await activation;
    await flushAsync();

    assert.equal(controller.state.task?.executionStatus, terminalStatus);
    assert.equal(controller.state.lastEventSequence, 8);
    if (terminalStatus === 'succeeded')
      assert.equal(controller.state.snapshot?.baselineRevision.artifactRevisionId, REVISION_ID);
    else
      assert.equal(controller.state.error?.code, 'NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE');
  }
});

test('drops a completed-event inspect response after a different task becomes active', async () => {
  const pendingInspect = deferred();
  let listener;
  let selectAttempt = 0;
  let startAttempt = 0;
  const api = createApi({
    inspect: async () => pendingInspect.promise,
    onEvent: (nextListener) => {
      listener = nextListener;
      return () => {};
    },
    selectSource: async () => {
      selectAttempt += 1;
      return withSession({
        canceled: false,
        displayName: `task-${selectAttempt}.txt`,
        expiresAt: '2026-08-10T01:05:00.000Z',
        selectionToken: `task_token_${selectAttempt}_123456`,
      });
    },
    start: async () => {
      startAttempt += 1;
      return withSession({
        task: {
          ...createTask('running'),
          taskId: startAttempt === 1 ? TASK_ID : OTHER_TASK_ID,
        },
      });
    },
  });
  const controller = createController(api);
  await controller.activate(PROJECT_A);
  await controller.selectSource();
  await controller.start();

  listener(createEvent(
    'novelImport.taskCompleted',
    9,
    createTask('succeeded'),
    { baselineRevision: createBaseline() },
  ));
  await controller.selectSource();
  await controller.start();
  pendingInspect.resolve(withSession({ snapshot: createSnapshot() }));
  await flushAsync();

  assert.equal(controller.state.task?.taskId, OTHER_TASK_ID);
  assert.equal(controller.state.task?.executionStatus, 'running');
  assert.equal(controller.state.snapshot, null);
});

test('blocks pending and running tasks from selecting or starting a second import, including shortcuts', async () => {
  for (const executionStatus of ['pending', 'running']) {
    let selectCalls = 0;
    let startCalls = 0;
    let retryCalls = 0;
    const api = createApi({
      retryTask: async () => {
        retryCalls += 1;
        return withSession({ task: createTask('running', 2) });
      },
      selectSource: async () => {
        selectCalls += 1;
        return withSession({
          canceled: false,
          displayName: 'guard.txt',
          expiresAt: '2026-08-10T01:05:00.000Z',
          selectionToken: 'guard_token_123456',
        });
      },
      start: async () => {
        startCalls += 1;
        return withSession({ task: createTask(executionStatus) });
      },
    });
    const controller = createController(api);
    await controller.activate(PROJECT_A);
    await controller.selectSource();
    await controller.start();

    const selectShortcut = resolveNovelImportKeyboardCommand({
      key: 'o',
      metaKey: true,
    });
    const startShortcut = resolveNovelImportKeyboardCommand({
      ctrlKey: true,
      key: 'Enter',
    });
    assert.equal(selectShortcut, 'select-source');
    assert.equal(startShortcut, 'start-task');
    await controller.selectSource();
    await controller.start();
    await controller.retryTask();

    assert.equal(selectCalls, 1);
    assert.equal(startCalls, 1);
    assert.equal(retryCalls, 0);
    assert.equal(controller.state.task?.executionStatus, executionStatus);
    assert.equal(controller.state.error?.code, 'NOVEL_IMPORT_TASK_NOT_RETRYABLE');
  }
});

test('rejects cancel for every non-active task before API invocation', async () => {
  for (const executionStatus of [null, 'canceled', 'failed', 'succeeded']) {
    let cancelCalls = 0;
    const api = createApi({
      cancelTask: async () => {
        cancelCalls += 1;
        return withSession({ task: createTask('canceled') });
      },
      selectSource: async () => withSession({
        canceled: false,
        displayName: 'cancel-guard.txt',
        expiresAt: '2026-08-10T01:05:00.000Z',
        selectionToken: 'cancel_guard_token',
      }),
      start: async () => withSession({ task: createTask(executionStatus) }),
    });
    const controller = createController(api);
    await controller.activate(PROJECT_A);
    if (executionStatus !== null) {
      await controller.selectSource();
      await controller.start();
    }

    await controller.cancelTask();

    assert.equal(cancelCalls, 0);
    assert.equal(controller.state.error?.code, 'NOVEL_IMPORT_TASK_NOT_CANCELABLE');
  }
});

test('clears the old task, review, sequence, and stored reference after selecting a new source', async () => {
  let listener;
  const storage = storedTask();
  const api = createApi({
    getTask: async () => withSession({
      baselineRevision: createBaseline(),
      task: createTask('succeeded'),
    }),
    inspect: async () => withSession({ snapshot: createSnapshot() }),
    onEvent: (nextListener) => {
      listener = nextListener;
      return () => {};
    },
    previewStaleImpact: async () => withSession({ preview: createPreview(true) }),
    selectSource: async () => withSession({
      canceled: false,
      displayName: 'replacement.txt',
      expiresAt: '2026-08-10T01:05:00.000Z',
      selectionToken: 'replacement_token_1',
    }),
  });
  const controller = createController(api, storage);
  await controller.activate(PROJECT_A);
  listener(createEvent(
    'novelImport.taskCompleted',
    7,
    createTask('succeeded'),
    { baselineRevision: createBaseline() },
  ));
  await flushAsync();
  await controller.prepareBoundaryAdjustment({
    chapterId: CHAPTER_ID,
    contentEndByte: 10,
    contentStartByte: 3,
    headingEndByte: 3,
    headingStartByte: 0,
  });
  assert.equal(controller.state.lastEventSequence, 7);
  assert.notEqual(controller.state.pendingReview, null);

  await controller.selectSource();

  assert.equal(controller.state.phase, 'ready');
  assert.equal(controller.state.task, null);
  assert.equal(controller.state.snapshot, null);
  assert.equal(controller.state.pendingReview, null);
  assert.equal(controller.state.lastEventSequence, 0);
  assert.deepEqual(storage.values(), []);
});

test('maps keyboard shortcuts without intercepting text editing', () => {
  assert.equal(resolveNovelImportKeyboardCommand({ key: 'o', metaKey: true }), 'select-source');
  assert.equal(resolveNovelImportKeyboardCommand({ ctrlKey: true, key: 'Enter' }), 'start-task');
  assert.equal(resolveNovelImportKeyboardCommand({ altKey: true, key: 'r' }), 'refresh-task');
  assert.equal(resolveNovelImportKeyboardCommand({ altKey: true, key: 'ArrowDown' }), 'move-chapter-next');
  assert.equal(resolveNovelImportKeyboardCommand({ altKey: true, key: 'ArrowUp' }), 'move-chapter-previous');
  assert.equal(resolveNovelImportKeyboardCommand({ editable: true, key: 'o', metaKey: true }), null);
  assert.equal(resolveNovelImportKeyboardCommand({ editable: true, key: 'Escape' }), 'cancel-dialog');
});

function createController(api, storage) {
  return new NovelImportController({
    api,
    createId: () => 'idempotency-key',
    storage,
  });
}

function createApi(overrides = {}) {
  return {
    cancelTask: async () => withSession({ task: createTask('canceled') }),
    executeReviewCommand: async () => {
      throw new Error('Unexpected executeReviewCommand call');
    },
    getTask: async () => withSession({ task: null }),
    inspect: async () => {
      throw new Error('Unexpected inspect call');
    },
    onEvent: () => () => {},
    previewStaleImpact: async () => {
      throw new Error('Unexpected previewStaleImpact call');
    },
    retryTask: async () => withSession({ task: createTask('running', 2) }),
    selectSource: async () => withSession({ canceled: true }),
    start: async () => withSession({ task: createTask('running') }),
    ...overrides,
  };
}

function withSession(value) {
  return {
    contractVersion: '1',
    projectId: PROJECT_A.projectId,
    projectSessionId: PROJECT_A.projectSessionId,
    ...value,
  };
}

function createTask(executionStatus, attempt = 1) {
  return {
    attempt,
    createdAt: '2026-08-10T01:00:00.000Z',
    errorCode: executionStatus === 'failed'
      ? 'NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE'
      : undefined,
    executionStatus,
    finishedAt: ['canceled', 'failed', 'succeeded'].includes(executionStatus)
      ? '2026-08-10T01:00:10.000Z'
      : undefined,
    recoveryStatus: executionStatus === 'failed' ? 'retryable' : 'none',
    resultArtifactRevisionId: executionStatus === 'succeeded' ? REVISION_ID : undefined,
    startedAt: executionStatus === 'pending' ? undefined : '2026-08-10T01:00:01.000Z',
    taskId: TASK_ID,
    updatedAt: '2026-08-10T01:00:10.000Z',
  };
}

function createBaseline() {
  return {
    artifactId: ARTIFACT_ID,
    artifactRevisionId: REVISION_ID,
    canonicalTextRevision: {
      byteLength: 20,
      contentHash: 'a'.repeat(64),
      textLayer: 'canonical',
      textRevisionId: TEXT_REVISION_ID,
    },
  };
}

function createRange(startByte, endByte, textLayer = 'canonical') {
  return {
    endByte,
    offsetUnit: 'utf8-byte',
    startByte,
    textLayer,
    textRevisionId: TEXT_REVISION_ID,
  };
}

function createSnapshot(readOnly = false) {
  const baselineRevision = createBaseline();
  return {
    adapter: {
      adapterId: 'txt-source-adapter',
      adapterVersion: '1.0.0',
      selectionMethod: 'probe',
    },
    baselineRevision,
    chapterCandidates: [{
      chapterCandidateId: '00000000-0000-4000-8000-000000000502',
      confidenceSource: 'deterministic-rule',
      contextAfter: [],
      contextBefore: [],
      evidence: ['synthetic-evidence'],
      headingRange: createRange(0, 2),
      lineRange: { endLineExclusive: 2, lineBase: 1, startLine: 1 },
      normalizedTitle: 'Synthetic Chapter',
      rawTitle: 'Synthetic Chapter',
      reviewStatus: 'pending',
      ruleConfidence: 1,
      ruleId: 'synthetic-rule',
      ruleVersion: '1.0.0',
    }],
    chapters: [{
      chapterId: CHAPTER_ID,
      confidence: 1,
      contentRange: createRange(2, 10),
      detectedBy: 'synthetic-rule',
      headingRange: createRange(0, 2),
      order: 0,
      rawHeading: 'Synthetic Chapter',
      reviewStatus: 'approved',
      sourceLineRange: { endLineExclusive: 4, lineBase: 1, startLine: 1 },
      title: 'Synthetic Chapter',
    }],
    coverage: {
      classifiedByteLength: 10,
      complete: false,
      segments: [{
        chapterId: CHAPTER_ID,
        classification: 'chapter',
        range: createRange(0, 10),
      }],
      textLayer: 'canonical',
      textRevisionId: TEXT_REVISION_ID,
      totalByteLength: 20,
      unclassifiedByteLength: 10,
      unclassifiedRanges: [createRange(10, 20)],
    },
    documentType: 'novel-import-review-snapshot',
    issues: [{
      code: 'synthetic_issue',
      issueId: '00000000-0000-4000-8000-000000000701',
      message: 'Synthetic review item.',
      reviewStatus: 'pending',
      severity: 'warning',
    }],
    layerDiffs: [{
      fromRevision: {
        byteLength: 20,
        contentHash: 'b'.repeat(64),
        textLayer: 'raw',
        textRevisionId: '00000000-0000-4000-8000-000000000404',
      },
      hunks: [{
        afterText: 'after',
        beforeText: 'before',
        fromRange: createRange(0, 1, 'raw'),
        operation: 'replace',
        toRange: createRange(0, 1),
      }],
      toRevision: baselineRevision.canonicalTextRevision,
    }],
    normalizationProposals: [{
      afterText: '',
      beforeText: 'before',
      canonicalRange: createRange(2, 3),
      confidence: 1,
      confidenceSource: 'synthetic-rule',
      conflictProposalIds: [],
      contextAfter: [],
      contextBefore: [],
      evidence: ['synthetic-evidence'],
      operation: 'delete',
      proposalId: PROPOSAL_ID,
      proposedBy: 'synthetic-rule',
      reason: 'Synthetic layout candidate.',
      reviewStatus: 'pending',
      risk: 'low',
      ruleId: 'synthetic-rule',
      ruleVersion: '1.0.0',
    }],
    readOnly,
    revisionHistory: [],
    schemaVersion: 1,
    source: {
      byteLength: 20,
      contentHash: 'c'.repeat(64),
      encoding: 'utf-8',
      format: 'txt',
      sourceAssetId: '00000000-0000-4000-8000-000000000801',
    },
    tableOfContentsEvidence: [],
    textRevisions: [baselineRevision.canonicalTextRevision],
    uncoveredRanges: [{
      range: createRange(10, 20),
      reviewStatus: 'pending',
      suggestedClassification: 'front_matter',
    }],
  };
}

function createPreview(canApply) {
  return {
    baselineRevision: createBaseline(),
    baselineStatus: canApply ? 'current' : 'stale',
    canApply,
    changeSelector: { chapterIds: [CHAPTER_ID] },
    currentArtifactRevisionId: REVISION_ID,
    documentType: 'novel-import-stale-preview',
    impacts: [],
    schemaVersion: 1,
  };
}

function createEvent(eventType, sequence, task, extra = {}) {
  return {
    contractVersion: '1',
    eventId: `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
    eventType,
    occurredAt: '2026-08-10T01:00:10.000Z',
    projectId: PROJECT_A.projectId,
    projectSessionId: PROJECT_A.projectSessionId,
    sequence,
    task,
    ...extra,
  };
}

function createFailedEvent(sequence, task) {
  return createEvent('novelImport.taskFailed', sequence, task, {
    error: {
      ...bridgeError('NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE', true),
      contractVersion: '1',
      message: 'The novel import request could not be completed.',
      projectId: PROJECT_A.projectId,
      projectSessionId: PROJECT_A.projectSessionId,
      taskId: TASK_ID,
    },
  });
}

function bridgeError(code, retryable) {
  return {
    code,
    retryable,
  };
}

function isolatedBridgeError(code, retryable, metadata = {}) {
  return new Error(encodeDesktopBridgeError({
    code,
    message: 'The novel import request could not be completed.',
    retryable,
    ...metadata,
  }));
}

function createStorage(initial) {
  const values = new Map();
  if (initial) {
    values.set(
      'voxweaver:novel-import:active-task-v1',
      JSON.stringify(initial),
    );
  }
  return {
    getItem: key => values.get(key) ?? null,
    removeItem: key => values.delete(key),
    setItem: (key, value) => values.set(key, value),
    values: () => [...values.values()],
  };
}

function storedTask() {
  return createStorage({
    projectId: PROJECT_A.projectId,
    projectSessionId: PROJECT_A.projectSessionId,
    taskId: TASK_ID,
  });
}

async function flushAsync() {
  await new Promise(resolve => setImmediate(resolve));
}

function deferred() {
  let resolve;
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}
