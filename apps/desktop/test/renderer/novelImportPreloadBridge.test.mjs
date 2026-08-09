/* eslint-disable test/no-import-node-test */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  DESKTOP_NOVEL_IMPORT_ERROR_RETRYABILITY,
  DESKTOP_NOVEL_IMPORT_EVENT_TYPES,
  DESKTOP_NOVEL_IMPORT_METHOD_NAMES,
  NOVEL_IMPORT_REVIEW_SCHEMA_VERSION,
} from '@voxweaver/contracts';
import TypeScript from 'typescript';

const PROJECT_ID = uuid(1);
const PROJECT_SESSION_ID = uuid(2);
const OTHER_PROJECT_ID = uuid(3);
const OTHER_PROJECT_SESSION_ID = uuid(4);
const TASK_ID = uuid(5);
const ARTIFACT_ID = uuid(6);
const ARTIFACT_REVISION_ID = uuid(7);
const CANONICAL_REVISION_ID = uuid(8);
const CHAPTER_ID = uuid(9);
const PUBLIC_ERROR_MESSAGE = 'The novel import request could not be completed.';

const PROJECT_SUMMARY = {
  accessMode: 'read-write',
  displayName: 'Synthetic project',
  layoutVersion: 2,
  projectId: PROJECT_ID,
  projectSessionId: PROJECT_SESSION_ID,
};

const OTHER_PROJECT_SUMMARY = {
  ...PROJECT_SUMMARY,
  displayName: 'Other synthetic project',
  projectId: OTHER_PROJECT_ID,
  projectSessionId: OTHER_PROJECT_SESSION_ID,
};

test('exposes only the eight M1-15A methods and routes validated payloads to narrow channels', async () => {
  const harness = await loadPreloadHarness();
  await activateProject(harness);

  assert.deepEqual(Object.keys(harness.api.novelImport).sort(), [
    'cancelTask',
    'executeReviewCommand',
    'getTask',
    'inspect',
    'onEvent',
    'previewStaleImpact',
    'retryTask',
    'selectSource',
    'start',
  ]);
  assert.equal('invoke' in harness.api.novelImport, false);
  assert.equal('ipcRenderer' in harness.api, false);
  assert.equal('readFile' in harness.api, false);

  const cases = novelImportMethodCases(harness.api.novelImport);
  for (const { invoke, payload } of cases) {
    await assert.rejects(
      invoke(payload),
      error => error?.code === 'NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE'
        && error.retryable === true,
    );
  }

  const calls = harness.invokeCalls.filter(call => (
    call.input?.messageKind === 'payload'
  ));
  assert.equal(calls.length, cases.length);
  for (const [index, current] of cases.entries()) {
    assert.equal(calls[index].channel, `voxweaver:${current.method}`);
    assert.deepEqual(calls[index].input, {
      messageKind: 'payload',
      method: current.method,
      payload: current.payload,
    });
  }
});

test('rejects invalid payloads and inactive project sessions before IPC invocation', async () => {
  const harness = await loadPreloadHarness();
  await activateProject(harness);
  const before = harness.invokeCalls.length;

  await assert.rejects(
    harness.api.novelImport.start({
      ...startPayload(),
      selectionToken: 'short',
    }),
    error => error?.code === 'DESKTOP_PAYLOAD_INVALID'
      && error.retryable === false,
  );
  await assert.rejects(
    harness.api.novelImport.selectSource({
      ...session(),
      contractVersion: '2',
    }),
    error => error?.code === 'DESKTOP_PROTOCOL_UNSUPPORTED'
      && error.retryable === false,
  );
  await assert.rejects(
    harness.api.novelImport.selectSource(session(OTHER_PROJECT_SESSION_ID)),
    error => error?.code === 'PROJECT_SESSION_STALE'
      && error.retryable === false,
  );
  assert.equal(harness.invokeCalls.length, before);
});

test('rejects result envelopes for another method or project session', async (t) => {
  await t.test('method mismatch', async () => {
    const harness = await loadPreloadHarness({
      async invoke(channel, input) {
        if (channel === 'voxweaver:project.getSummary')
          return desktopSuccess(input, PROJECT_SUMMARY);
        return novelImportResult(
          DESKTOP_NOVEL_IMPORT_METHOD_NAMES.GET_TASK,
          runningTaskResult(),
        );
      },
    });
    await activateProject(harness);
    await assert.rejects(
      harness.api.novelImport.start(startPayload()),
      error => error?.code === 'DESKTOP_CORE_UNAVAILABLE',
    );
  });

  await t.test('session mismatch', async () => {
    const harness = await loadPreloadHarness({
      async invoke(channel, input) {
        if (channel === 'voxweaver:project.getSummary')
          return desktopSuccess(input, PROJECT_SUMMARY);
        return novelImportResult(
          DESKTOP_NOVEL_IMPORT_METHOD_NAMES.START,
          {
            ...runningTaskResult(),
            ...session(OTHER_PROJECT_SESSION_ID),
          },
        );
      },
    });
    await activateProject(harness);
    await assert.rejects(
      harness.api.novelImport.start(startPayload()),
      error => error?.code === 'DESKTOP_CORE_UNAVAILABLE',
    );
  });
});

test('preserves only parsed novel-import recovery metadata in bridge errors', async () => {
  const recovery = {
    currentArtifactRevisionId: ARTIFACT_REVISION_ID,
    operationId: 'operation-preload-test',
    taskId: TASK_ID,
  };
  const harness = await loadPreloadHarness({
    async invoke(channel, input) {
      if (channel === 'voxweaver:project.getSummary')
        return desktopSuccess(input, PROJECT_SUMMARY);
      return novelImportError(
        'NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE',
        input.method,
        input.payload,
        recovery,
      );
    },
  });
  await activateProject(harness);

  let bridgeError;
  try {
    await harness.api.novelImport.start(startPayload());
  } catch (error) {
    bridgeError = error;
  }
  assert.equal(bridgeError?.name, 'DesktopBridgeError');
  assert.equal(bridgeError.operationId, recovery.operationId);
  assert.equal(bridgeError.taskId, recovery.taskId);
  assert.equal(
    bridgeError.currentArtifactRevisionId,
    recovery.currentArtifactRevisionId,
  );
  assert.equal('details' in bridgeError, false);
  assert.deepEqual(harness.decodeDesktopBridgeError(bridgeError), {
    code: 'NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE',
    message: PUBLIC_ERROR_MESSAGE,
    retryable: true,
    ...recovery,
  });
});

test('rejects an in-flight response after the active project session changes', async () => {
  let resolveImport;
  const harness = await loadPreloadHarness({
    async invoke(channel, input) {
      if (channel === 'voxweaver:project.getSummary')
        return desktopSuccess(input, PROJECT_SUMMARY);
      if (channel === 'voxweaver:project.switch')
        return desktopSuccess(input, OTHER_PROJECT_SUMMARY);
      if (channel === `voxweaver:${DESKTOP_NOVEL_IMPORT_METHOD_NAMES.START}`) {
        return new Promise((resolve) => {
          resolveImport = resolve;
        });
      }
      throw new Error('Unexpected Preload test channel.');
    },
  });
  await activateProject(harness);

  const pending = harness.api.novelImport.start(startPayload());
  assert.equal(typeof resolveImport, 'function');
  await harness.api.project.switch({ recentProjectId: OTHER_PROJECT_ID });
  resolveImport(novelImportResult(
    DESKTOP_NOVEL_IMPORT_METHOD_NAMES.START,
    runningTaskResult(),
  ));

  await assert.rejects(
    pending,
    error => error?.code === 'PROJECT_SESSION_STALE'
      && error.retryable === false,
  );
});

test('prefers stale-session rejection when an in-flight IPC invoke rejects after a switch', async () => {
  let rejectImport;
  const harness = await loadPreloadHarness({
    async invoke(channel, input) {
      if (channel === 'voxweaver:project.getSummary')
        return desktopSuccess(input, PROJECT_SUMMARY);
      if (channel === 'voxweaver:project.switch')
        return desktopSuccess(input, OTHER_PROJECT_SUMMARY);
      if (channel === `voxweaver:${DESKTOP_NOVEL_IMPORT_METHOD_NAMES.START}`) {
        return new Promise((_resolve, reject) => {
          rejectImport = reject;
        });
      }
      throw new Error('Unexpected Preload test channel.');
    },
  });
  await activateProject(harness);

  const pending = harness.api.novelImport.start(startPayload());
  assert.equal(typeof rejectImport, 'function');
  await harness.api.project.switch({ recentProjectId: OTHER_PROJECT_ID });
  rejectImport(new Error('Synthetic transport failure.'));

  await assert.rejects(
    pending,
    error => error?.code === 'PROJECT_SESSION_STALE'
      && error.retryable === false,
  );
});

test('drops invalid or stale events and removes every exact wrapped listener', async () => {
  const harness = await loadPreloadHarness();
  await activateProject(harness);
  const received = [];
  const unsubscribe = harness.api.novelImport.onEvent(event => received.push(event));
  const eventTypes = Object.values(DESKTOP_NOVEL_IMPORT_EVENT_TYPES);

  assert.deepEqual(
    harness.listenerAdds.map(entry => entry.channel).sort(),
    eventTypes.map(eventType => `voxweaver:${eventType}`).sort(),
  );

  const progressType = DESKTOP_NOVEL_IMPORT_EVENT_TYPES.TASK_PROGRESS;
  harness.emit(
    `voxweaver:${progressType}`,
    novelImportEvent(progressEvent(session(OTHER_PROJECT_SESSION_ID))),
  );
  harness.emit(
    `voxweaver:${progressType}`,
    { ...novelImportEvent(progressEvent()), unexpected: true },
  );
  harness.emit(
    `voxweaver:${DESKTOP_NOVEL_IMPORT_EVENT_TYPES.TASK_COMPLETED}`,
    novelImportEvent(progressEvent()),
  );
  harness.emit(
    `voxweaver:${progressType}`,
    novelImportEvent(progressEvent()),
  );
  assert.deepEqual(received, [progressEvent()]);

  unsubscribe();
  assert.equal(harness.listenerRemovals.length, eventTypes.length);
  for (const removed of harness.listenerRemovals) {
    const added = harness.listenerAdds.find(entry => entry.channel === removed.channel);
    assert.equal(removed.listener, added?.listener);
  }
  harness.emit(
    `voxweaver:${progressType}`,
    novelImportEvent({ ...progressEvent(), sequence: 2 }),
  );
  assert.equal(received.length, 1);
});

function novelImportMethodCases(api) {
  return [
    {
      invoke: api.cancelTask,
      method: DESKTOP_NOVEL_IMPORT_METHOD_NAMES.CANCEL_TASK,
      payload: taskPayload(),
    },
    {
      invoke: api.executeReviewCommand,
      method: DESKTOP_NOVEL_IMPORT_METHOD_NAMES.EXECUTE_REVIEW_COMMAND,
      payload: reviewCommandPayload(),
    },
    {
      invoke: api.getTask,
      method: DESKTOP_NOVEL_IMPORT_METHOD_NAMES.GET_TASK,
      payload: taskPayload(),
    },
    {
      invoke: api.inspect,
      method: DESKTOP_NOVEL_IMPORT_METHOD_NAMES.INSPECT,
      payload: inspectPayload(),
    },
    {
      invoke: api.previewStaleImpact,
      method: DESKTOP_NOVEL_IMPORT_METHOD_NAMES.PREVIEW_STALE_IMPACT,
      payload: stalePreviewPayload(),
    },
    {
      invoke: api.retryTask,
      method: DESKTOP_NOVEL_IMPORT_METHOD_NAMES.RETRY_TASK,
      payload: taskPayload(),
    },
    {
      invoke: api.selectSource,
      method: DESKTOP_NOVEL_IMPORT_METHOD_NAMES.SELECT_SOURCE,
      payload: session(),
    },
    {
      invoke: api.start,
      method: DESKTOP_NOVEL_IMPORT_METHOD_NAMES.START,
      payload: startPayload(),
    },
  ];
}

async function activateProject(harness) {
  assert.deepEqual(await harness.api.project.getSummary(), PROJECT_SUMMARY);
}

async function loadPreloadHarness(options = {}) {
  const exposed = new Map();
  const invokeCalls = [];
  const listenerAdds = [];
  const listenerRemovals = [];
  const listeners = new Map();
  const invoke = options.invoke ?? (async (channel, input) => {
    if (channel === 'voxweaver:project.getSummary')
      return desktopSuccess(input, PROJECT_SUMMARY);
    if (input?.messageKind === 'payload') {
      return novelImportError(
        'NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE',
        input.method,
        input.payload,
      );
    }
    throw new Error('Unexpected Preload test channel.');
  });
  const runtime = {
    contextBridge: {
      exposeInMainWorld(name, value) {
        exposed.set(name, value);
      },
    },
    ipcRenderer: {
      async invoke(channel, input) {
        invokeCalls.push({ channel, input });
        return invoke(channel, input);
      },
      on(channel, listener) {
        listenerAdds.push({ channel, listener });
        const channelListeners = listeners.get(channel) ?? new Set();
        channelListeners.add(listener);
        listeners.set(channel, channelListeners);
      },
      removeListener(channel, listener) {
        listenerRemovals.push({ channel, listener });
        listeners.get(channel)?.delete(listener);
      },
    },
  };

  const runtimeKey = `__VOXWEAVER_PRELOAD_TEST_${crypto.randomUUID()}__`;
  Reflect.set(globalThis, runtimeKey, runtime);
  const outputDirectory = await mkdtemp(join(tmpdir(), 'voxweaver-preload-test-'));
  let bridgeErrorModule;
  try {
    const preloadSource = await readFile(
      new URL('../../preload/index.ts', import.meta.url),
      'utf8',
    );
    const bridgeErrorSource = await readFile(
      new URL('../../shared/desktopBridgeError.ts', import.meta.url),
      'utf8',
    );
    const contractsUrl = pathToFileURL(fileURLToPath(
      new URL('../../../../packages/contracts/dist/index.js', import.meta.url),
    )).href;
    const electronFile = join(outputDirectory, 'electron.mjs');
    const bridgeErrorFile = join(outputDirectory, 'desktopBridgeError.js');
    const preloadFile = join(outputDirectory, 'preload.js');

    await writeFile(
      electronFile,
      `const runtime = globalThis[${JSON.stringify(runtimeKey)}];\n`
      + 'export const contextBridge = runtime.contextBridge;\n'
      + 'export const ipcRenderer = runtime.ipcRenderer;\n',
    );
    await writeFile(bridgeErrorFile, transpile(bridgeErrorSource, 'desktopBridgeError.ts'));
    bridgeErrorModule = await import(pathToFileURL(bridgeErrorFile).href);
    const rewrittenPreload = preloadSource
      .replaceAll('\'@voxweaver/contracts\'', `'${contractsUrl}'`)
      .replaceAll('\'electron\'', `'${pathToFileURL(electronFile).href}'`)
      .replaceAll(
        '\'../shared/desktopBridgeError.js\'',
        `'${pathToFileURL(bridgeErrorFile).href}'`,
      );
    await writeFile(preloadFile, transpile(rewrittenPreload, 'preload.ts'));
    await import(pathToFileURL(preloadFile).href);
  } finally {
    Reflect.deleteProperty(globalThis, runtimeKey);
    await rm(outputDirectory, { force: true, recursive: true });
  }

  return {
    api: exposed.get('voxweaver'),
    decodeDesktopBridgeError: bridgeErrorModule.decodeDesktopBridgeError,
    emit(channel, value) {
      for (const listener of [...(listeners.get(channel) ?? [])])
        listener({}, value);
    },
    invokeCalls,
    listenerAdds,
    listenerRemovals,
  };
}

function transpile(source, fileName) {
  return TypeScript.transpileModule(source, {
    compilerOptions: {
      module: TypeScript.ModuleKind.ESNext,
      target: TypeScript.ScriptTarget.ES2021,
      verbatimModuleSyntax: true,
    },
    fileName: basename(fileName),
  }).outputText;
}

function desktopSuccess(request, result) {
  return {
    ok: true,
    protocolVersion: '1',
    requestId: request.requestId,
    result,
  };
}

function novelImportResult(method, result) {
  return { messageKind: 'result', method, result };
}

function novelImportError(code, method, selectedSession, recovery = {}) {
  return {
    messageKind: 'error',
    error: {
      code,
      contractVersion: '1',
      message: PUBLIC_ERROR_MESSAGE,
      method,
      projectId: selectedSession.projectId,
      projectSessionId: selectedSession.projectSessionId,
      retryable: DESKTOP_NOVEL_IMPORT_ERROR_RETRYABILITY[code],
      ...recovery,
    },
  };
}

function novelImportEvent(event) {
  return { messageKind: 'event', event };
}

function session(projectSessionId = PROJECT_SESSION_ID) {
  return {
    contractVersion: '1',
    projectId: projectSessionId === PROJECT_SESSION_ID
      ? PROJECT_ID
      : OTHER_PROJECT_ID,
    projectSessionId,
  };
}

function startPayload() {
  return {
    ...session(),
    idempotencyKey: 'preload-import-request',
    requestedBy: 'operator:preload-test',
    selectionToken: 'selection_token_0001',
  };
}

function taskPayload() {
  return { ...session(), taskId: TASK_ID };
}

function inspectPayload() {
  return {
    ...session(),
    query: {
      documentType: 'novel-import-review-query',
      schemaVersion: NOVEL_IMPORT_REVIEW_SCHEMA_VERSION,
      readOnly: true,
      baselineRevision: baselineRevision(),
    },
  };
}

function stalePreviewPayload() {
  return {
    ...session(),
    query: {
      documentType: 'novel-import-stale-preview-query',
      schemaVersion: NOVEL_IMPORT_REVIEW_SCHEMA_VERSION,
      readOnly: true,
      baselineRevision: baselineRevision(),
      changeKind: 'boundary-adjustment',
      changeSelector: { chapterIds: [CHAPTER_ID] },
    },
  };
}

function reviewCommandPayload() {
  return {
    ...session(),
    command: {
      documentType: 'novel-import-review-command',
      schemaVersion: NOVEL_IMPORT_REVIEW_SCHEMA_VERSION,
      commandType: 'adjust-chapter-boundary',
      baselineRevision: baselineRevision(),
      requestedBy: 'operator:preload-test',
      chapterId: CHAPTER_ID,
      headingRange: textRange(0, 5),
      contentRange: textRange(5, 10),
    },
  };
}

function baselineRevision() {
  return {
    artifactId: ARTIFACT_ID,
    artifactRevisionId: ARTIFACT_REVISION_ID,
    canonicalTextRevision: {
      textRevisionId: CANONICAL_REVISION_ID,
      textLayer: 'canonical',
      contentHash: '0'.repeat(64),
      byteLength: 10,
    },
  };
}

function textRange(startByte, endByte) {
  return {
    textRevisionId: CANONICAL_REVISION_ID,
    textLayer: 'canonical',
    offsetUnit: 'utf8-byte',
    startByte,
    endByte,
  };
}

function runningTaskResult() {
  return {
    ...session(),
    task: {
      attempt: 1,
      createdAt: '2026-08-10T00:00:00.000Z',
      executionStatus: 'running',
      recoveryStatus: 'none',
      startedAt: '2026-08-10T00:00:01.000Z',
      taskId: TASK_ID,
      updatedAt: '2026-08-10T00:00:01.000Z',
    },
  };
}

function progressEvent(selectedSession = session()) {
  return {
    ...selectedSession,
    eventId: uuid(20),
    eventType: DESKTOP_NOVEL_IMPORT_EVENT_TYPES.TASK_PROGRESS,
    occurredAt: '2026-08-10T00:00:01.000Z',
    sequence: 1,
    task: runningTaskResult().task,
  };
}

function uuid(value) {
  return `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
}
