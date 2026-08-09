/* eslint-disable test/no-import-node-test */

import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';

import { loadDesktopMainModule } from './loadDesktopMainModules.mjs';

const {
  DesktopMainController,
  desktopNovelImportIpcChannel,
} = await loadDesktopMainModule('controller');
const {
  NOVEL_SOURCE_SELECTION_TOKEN_TTL_MS,
  NovelSourceSelectionTokenRegistry,
} = await loadDesktopMainModule('novelSourceRegistry');

const PROJECT_ID = uuid(1);
const PROJECT_SESSION_ID = uuid(2);
const OTHER_PROJECT_SESSION_ID = uuid(3);
const TASK_ID = uuid(4);
const SOURCE_FILE_PATH = join(tmpdir(), 'voxweaver-main-source.txt');
const SOURCE_DISPLAY_NAME = basename(SOURCE_FILE_PATH);

test('returns a path-free cancellation without issuing a source token', async () => {
  let coreCalls = 0;
  const controller = createController({
    core: async () => {
      coreCalls += 1;
    },
    selectedSource: undefined,
  });

  const response = await controller.dispatchNovelImport(
    7,
    'novelImport.selectSource',
    payloadEnvelope('novelImport.selectSource', session()),
  );

  assert.deepEqual(response, {
    messageKind: 'result',
    method: 'novelImport.selectSource',
    result: {
      ...session(),
      canceled: true,
    },
  });
  assert.equal(coreCalls, 0);
});

test('keeps the source path in private Core context and consumes the token', async () => {
  const coreCalls = [];
  const controller = createController({
    core: async (request, trustedContext) => {
      coreCalls.push({ request, trustedContext });
      return resultEnvelope(request.method, taskResult(request.payload));
    },
    selectedSource: selectedSource(),
  });
  const selection = await selectSource(controller);
  assert.equal(JSON.stringify(selection).includes(SOURCE_FILE_PATH), false);

  const input = payloadEnvelope(
    'novelImport.start',
    startPayload(selection.result.selectionToken),
  );
  const response = await controller.dispatchNovelImport(
    7,
    'novelImport.start',
    input,
  );

  assert.equal(response.messageKind, 'result');
  assert.equal(response.result.task.taskId, TASK_ID);
  assert.equal(JSON.stringify(response).includes(SOURCE_FILE_PATH), false);
  assert.deepEqual(coreCalls, [{
    request: input,
    trustedContext: {
      originalName: SOURCE_DISPLAY_NAME,
      selectionToken: selection.result.selectionToken,
      sourceFilePath: SOURCE_FILE_PATH,
    },
  }]);
  assert.equal(JSON.stringify(coreCalls[0].request).includes(SOURCE_FILE_PATH), false);

  assertNovelImportError(
    await controller.dispatchNovelImport(7, 'novelImport.start', input),
    'DESKTOP_SELECTION_INVALID',
  );
  assert.equal(coreCalls.length, 1);
});

test('retains a source token only for an explicit encoding decision retry', async () => {
  let attempts = 0;
  const controller = createController({
    core: async (request) => {
      attempts += 1;
      return attempts === 1
        ? errorEnvelope(
            'NOVEL_IMPORT_ENCODING_REQUIRED',
            request.payload,
            request.method,
          )
        : resultEnvelope(request.method, taskResult(request.payload));
    },
    selectedSource: selectedSource(),
  });
  const selection = await selectSource(controller);
  const selectionToken = selection.result.selectionToken;

  assertNovelImportError(
    await startImport(controller, 7, selectionToken),
    'NOVEL_IMPORT_ENCODING_REQUIRED',
  );
  const retried = await controller.dispatchNovelImport(
    7,
    'novelImport.start',
    payloadEnvelope('novelImport.start', {
      ...startPayload(selectionToken),
      sourceEncoding: 'gb18030',
    }),
  );
  assert.equal(retried.messageKind, 'result');
  assert.equal(attempts, 2);
  assertNovelImportError(
    await startImport(controller, 7, selectionToken),
    'DESKTOP_SELECTION_INVALID',
  );
});

test('rejects malformed payload envelopes before file selection or Core routing', async () => {
  let pickerCalls = 0;
  let coreCalls = 0;
  const controller = createController({
    core: async () => {
      coreCalls += 1;
    },
    selectSourceFile: async () => {
      pickerCalls += 1;
      return selectedSource();
    },
  });

  const invalid = payloadEnvelope('novelImport.selectSource', {
    ...session(),
    sourcePath: 'renderer-supplied-source',
  });
  assertNovelImportError(
    await controller.dispatchNovelImport(7, 'novelImport.selectSource', invalid),
    'DESKTOP_PAYLOAD_INVALID',
  );
  assertNovelImportError(
    await controller.dispatchNovelImport(
      7,
      'novelImport.selectSource',
      payloadEnvelope('novelImport.selectSource', {
        ...session(),
        contractVersion: '2',
      }),
    ),
    'DESKTOP_PROTOCOL_UNSUPPORTED',
  );
  assert.equal(pickerCalls, 0);
  assert.equal(coreCalls, 0);
});

test('rejects expired and closed-window source capabilities', async () => {
  let now = Date.parse('2026-08-10T00:00:00.000Z');
  const registry = new NovelSourceSelectionTokenRegistry({ now: () => now });
  const controller = createController({
    novelSourceSelections: registry,
    selectedSource: selectedSource(),
  });

  const expiredSelection = await selectSource(controller);
  now += NOVEL_SOURCE_SELECTION_TOKEN_TTL_MS;
  assertNovelImportError(
    await startImport(controller, 7, expiredSelection.result.selectionToken),
    'DESKTOP_SELECTION_INVALID',
  );

  const closedSelection = await selectSource(controller);
  controller.handleWindowClosed(7);
  assertNovelImportError(
    await startImport(controller, 7, closedSelection.result.selectionToken),
    'DESKTOP_SELECTION_INVALID',
  );
});

test('invalidates cross-window and cross-session source capabilities', async () => {
  const crossWindowController = createController({
    selectedSource: selectedSource(),
  });
  const crossWindow = await selectSource(crossWindowController);
  assertNovelImportError(
    await startImport(crossWindowController, 8, crossWindow.result.selectionToken),
    'DESKTOP_SELECTION_INVALID',
  );
  assertNovelImportError(
    await startImport(crossWindowController, 7, crossWindow.result.selectionToken),
    'DESKTOP_SELECTION_INVALID',
  );

  const crossSessionController = createController({
    selectedSource: selectedSource(),
  });
  const crossSession = await selectSource(crossSessionController);
  assertNovelImportError(
    await startImport(
      crossSessionController,
      7,
      crossSession.result.selectionToken,
      session(OTHER_PROJECT_SESSION_ID),
    ),
    'DESKTOP_SELECTION_INVALID',
  );
  assertNovelImportError(
    await startImport(crossSessionController, 7, crossSession.result.selectionToken),
    'DESKTOP_SELECTION_INVALID',
  );
});

test('sanitizes Core failures and preserves a validated stale-session error', async () => {
  const unavailableController = createController({
    core: async () => {
      throw new Error(`Core failed while reading ${SOURCE_FILE_PATH}`);
    },
    selectedSource: selectedSource(),
  });
  const unavailableSelection = await selectSource(unavailableController);
  const unavailable = await startImport(
    unavailableController,
    7,
    unavailableSelection.result.selectionToken,
  );
  assertNovelImportError(unavailable, 'DESKTOP_CORE_UNAVAILABLE');
  assert.equal(JSON.stringify(unavailable).includes(SOURCE_FILE_PATH), false);

  const staleController = createController({
    core: async request => errorEnvelope(
      'PROJECT_SESSION_STALE',
      request.payload,
      request.method,
    ),
    selectedSource: selectedSource(),
  });
  const staleSelection = await selectSource(staleController);
  const stale = await startImport(
    staleController,
    7,
    staleSelection.result.selectionToken,
  );
  assertNovelImportError(stale, 'PROJECT_SESSION_STALE');
  assert.equal(stale.error.retryable, false);
});

test('registers eight narrow channels and rejects the wrong window identity', async () => {
  const handlers = new Map();
  const controller = createController({
    selectedSource: selectedSource(),
    windowIdFromIpcEvent: event => event?.trusted === true ? 7 : undefined,
  });
  controller.registerNovelImportIpcHandlers({
    handle(channel, handler) {
      handlers.set(channel, handler);
    },
  });

  assert.equal(handlers.size, 8);
  const channel = desktopNovelImportIpcChannel('novelImport.selectSource');
  const handler = handlers.get(channel);
  assert.equal(typeof handler, 'function');

  assertNovelImportError(
    await handler({}, payloadEnvelope('novelImport.selectSource', session())),
    'DESKTOP_PAYLOAD_INVALID',
  );
  assertNovelImportError(
    await handler(
      { trusted: true },
      payloadEnvelope('novelImport.getTask', taskPayload()),
    ),
    'DESKTOP_PAYLOAD_INVALID',
  );
  const selected = await handler(
    { trusted: true },
    payloadEnvelope('novelImport.selectSource', session()),
  );
  assert.equal(selected.messageKind, 'result');
  assert.equal(selected.result.canceled, false);
});

test('rejects picker output that is not an absolute basename-matched file', async () => {
  const controller = createController({
    selectedSource: {
      displayName: 'source.txt',
      sourceFilePath: join('relative', 'source.txt'),
    },
  });
  assertNovelImportError(
    await selectSource(controller),
    'DESKTOP_SELECTION_INVALID',
  );
});

function createController(options = {}) {
  return new DesktopMainController({
    coreClient: {
      async dispatch(request) {
        return {
          ok: true,
          protocolVersion: '1',
          requestId: request.requestId,
          result: { healthy: true },
        };
      },
      dispatchNovelImport: options.core ?? (async request => (
        resultEnvelope(request.method, taskResult(request.payload))
      )),
    },
    directoryPicker: {
      async selectDirectory() {
        return undefined;
      },
    },
    novelSourceFilePicker: {
      selectSourceFile: options.selectSourceFile ?? (async () => options.selectedSource),
    },
    novelSourceSelections: options.novelSourceSelections,
    windowIdFromIpcEvent: options.windowIdFromIpcEvent,
  });
}

function selectedSource() {
  return {
    displayName: SOURCE_DISPLAY_NAME,
    sourceFilePath: SOURCE_FILE_PATH,
  };
}

async function selectSource(controller, selectedSession = session()) {
  return controller.dispatchNovelImport(
    7,
    'novelImport.selectSource',
    payloadEnvelope('novelImport.selectSource', selectedSession),
  );
}

async function startImport(
  controller,
  windowId,
  selectionToken,
  selectedSession = session(),
) {
  return controller.dispatchNovelImport(
    windowId,
    'novelImport.start',
    payloadEnvelope(
      'novelImport.start',
      startPayload(selectionToken, selectedSession),
    ),
  );
}

function payloadEnvelope(method, payload) {
  return {
    messageKind: 'payload',
    method,
    payload,
  };
}

function resultEnvelope(method, result) {
  return {
    messageKind: 'result',
    method,
    result,
  };
}

function errorEnvelope(code, selectedSession, method) {
  return {
    messageKind: 'error',
    error: {
      code,
      contractVersion: '1',
      message: 'The novel import request could not be completed.',
      method,
      projectId: selectedSession.projectId,
      projectSessionId: selectedSession.projectSessionId,
      retryable: false,
    },
  };
}

function session(projectSessionId = PROJECT_SESSION_ID) {
  return {
    contractVersion: '1',
    projectId: PROJECT_ID,
    projectSessionId,
  };
}

function startPayload(selectionToken, selectedSession = session()) {
  return {
    ...selectedSession,
    idempotencyKey: 'novel-import-main-test',
    requestedBy: 'operator-main-test',
    selectionToken,
  };
}

function taskPayload() {
  return {
    ...session(),
    taskId: TASK_ID,
  };
}

function taskResult(selectedSession) {
  return {
    contractVersion: '1',
    projectId: selectedSession.projectId,
    projectSessionId: selectedSession.projectSessionId,
    task: {
      attempt: 1,
      createdAt: '2026-08-10T00:00:00.000Z',
      executionStatus: 'running',
      recoveryStatus: 'none',
      taskId: TASK_ID,
      updatedAt: '2026-08-10T00:00:01.000Z',
    },
  };
}

function assertNovelImportError(response, code) {
  assert.equal(response.messageKind, 'error');
  assert.equal(response.error.code, code);
  assert.equal(
    response.error.message,
    'The novel import request could not be completed.',
  );
}

function uuid(value) {
  return `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
}
