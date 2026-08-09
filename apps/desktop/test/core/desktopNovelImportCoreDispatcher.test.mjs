/* eslint-disable test/no-import-node-test */

import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { utimesSync, writeFileSync } from 'node:fs';
import { mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { AppCoreService } from '@voxweaver/app-core';
import { parseDesktopNovelImportError } from '@voxweaver/contracts';

import { DesktopNovelImportCoreDispatcher } from '../.generated/core/desktopNovelImportCoreDispatcher.js';

const SYNTHETIC_TXT = [
  '第一章 起点',
  '',
  '这是桌面 Core 路由使用的合成正文。',
  '',
  '第二章 延续',
  '',
  '第二段合成正文只用于可再分发测试。',
  '',
].join('\n');
const TASK_ID = uuid(50);

test('stages a regular source privately and projects a persisted completed task', async () => {
  const parentDirectory = await mkdtemp(join(tmpdir(), 'voxweaver-desktop-core-import-'));
  const sourceFilePath = join(parentDirectory, 'synthetic-source.txt');
  const core = new AppCoreService();

  try {
    await writeFile(sourceFilePath, SYNTHETIC_TXT, { flag: 'wx' });
    const project = await core.createProject({
      displayName: 'Desktop Core Import',
      parentDirectory,
    });
    const fallbackCalls = [];
    const dispatcher = new DesktopNovelImportCoreDispatcher({
      core,
      fallback: {
        async dispatch(...args) {
          fallbackCalls.push(args);
          return { fallback: true };
        },
      },
      now: () => new Date('2026-08-10T01:00:00.000Z'),
    });
    const events = [];
    dispatcher.subscribe(() => {
      throw new Error('isolated event observer');
    });
    const unsubscribe = dispatcher.subscribe(event => events.push(event));
    const session = projectSession(project);

    const response = await dispatcher.dispatch(
      payloadEnvelope('novelImport.start', {
        ...session,
        idempotencyKey: 'desktop-core-synthetic-import',
        requestedBy: 'operator:desktop-core-test',
        selectionToken: 'private_selection_token',
      }),
      {
        originalName: 'synthetic-source.txt',
        selectionToken: 'private_selection_token',
        sourceFilePath,
      },
    );

    assert.equal(response.messageKind, 'result');
    assert.equal(response.method, 'novelImport.start');
    assert.equal(response.result.task.executionStatus, 'succeeded');
    assert.equal(
      response.result.task.resultArtifactRevisionId,
      response.result.baselineRevision.artifactRevisionId,
    );
    assert.equal(events.length, 1);
    assert.equal(events[0].eventType, 'novelImport.taskCompleted');
    assert.equal(events[0].sequence, 1);
    assert.deepEqual(events[0].baselineRevision, response.result.baselineRevision);
    assert.equal(JSON.stringify(response).includes(sourceFilePath), false);
    assert.equal(JSON.stringify(events).includes(sourceFilePath), false);
    assert.deepEqual(fallbackCalls, []);

    const tmpEntries = await readdir(join(project.projectDirectory, 'tmp'));
    assert.equal(tmpEntries.includes('desktop-novel-import'), false);

    const queried = await dispatcher.dispatch(payloadEnvelope(
      'novelImport.getTask',
      { ...session, taskId: response.result.task.taskId },
    ));
    assert.equal(queried.messageKind, 'result');
    assert.deepEqual(queried.result, response.result);

    const inspected = await dispatcher.dispatch(payloadEnvelope(
      'novelImport.inspect',
      {
        ...session,
        query: {
          documentType: 'novel-import-review-query',
          schemaVersion: 1,
          baselineRevision: response.result.baselineRevision,
          readOnly: true,
        },
      },
    ));
    assert.equal(inspected.messageKind, 'result');
    assert.deepEqual(
      inspected.result.snapshot.baselineRevision,
      response.result.baselineRevision,
    );

    const retry = await dispatcher.dispatch(payloadEnvelope(
      'novelImport.retryTask',
      { ...session, taskId: response.result.task.taskId },
    ));
    assertNovelImportError(retry, 'NOVEL_IMPORT_TASK_NOT_RETRYABLE');

    unsubscribe();
    const generic = await dispatcher.dispatch({ method: 'app.getHealth' });
    assert.deepEqual(generic, { fallback: true });
    assert.equal(fallbackCalls.length, 1);
  } finally {
    await closeIgnoringErrors(core);
    await rm(parentDirectory, { force: true, recursive: true });
  }
});

test('rejects symlink sources without leaking the private path or emitting a fake failure event', async () => {
  const parentDirectory = await mkdtemp(join(tmpdir(), 'voxweaver-desktop-core-import-'));
  const actualSourcePath = join(parentDirectory, 'actual.txt');
  const linkedSourcePath = join(parentDirectory, 'linked.txt');
  const core = new AppCoreService();

  try {
    await writeFile(actualSourcePath, SYNTHETIC_TXT, { flag: 'wx' });
    await symlink(actualSourcePath, linkedSourcePath);
    const project = await core.createProject({
      displayName: 'Desktop Symlink Rejection',
      parentDirectory,
    });
    const dispatcher = new DesktopNovelImportCoreDispatcher({
      core,
      fallback: { async dispatch() { return undefined; } },
    });
    const events = [];
    dispatcher.subscribe(event => events.push(event));
    const response = await dispatcher.dispatch(
      payloadEnvelope('novelImport.start', {
        ...projectSession(project),
        idempotencyKey: 'desktop-core-symlink-import',
        requestedBy: 'operator:desktop-core-test',
        selectionToken: 'private_selection_token',
      }),
      {
        originalName: 'linked.txt',
        selectionToken: 'private_selection_token',
        sourceFilePath: linkedSourcePath,
      },
    );

    assertNovelImportError(response, 'NOVEL_IMPORT_INVALID_SOURCE');
    assert.equal(JSON.stringify(response).includes(linkedSourcePath), false);
    assert.deepEqual(events, []);
  } finally {
    await closeIgnoringErrors(core);
    await rm(parentDirectory, { force: true, recursive: true });
  }
});

test('maps a source removed after selection to a path-free invalid-source error', async () => {
  const parentDirectory = await mkdtemp(join(tmpdir(), 'voxweaver-desktop-core-import-'));
  const sourceFilePath = join(parentDirectory, 'removed-after-selection.txt');
  const core = new AppCoreService();

  try {
    await writeFile(sourceFilePath, SYNTHETIC_TXT, { flag: 'wx' });
    const project = await core.createProject({
      displayName: 'Desktop Removed Source',
      parentDirectory,
    });
    const selectedSource = trustedSource(
      sourceFilePath,
      'removed-after-selection.txt',
    );
    await rm(sourceFilePath);
    const dispatcher = new DesktopNovelImportCoreDispatcher({
      core,
      fallback: { async dispatch() { return undefined; } },
    });
    const events = [];
    dispatcher.subscribe(event => events.push(event));

    const response = await dispatcher.dispatch(
      payloadEnvelope(
        'novelImport.start',
        startPayload(projectSession(project), 'removed-source'),
      ),
      selectedSource,
    );

    assertNovelImportError(response, 'NOVEL_IMPORT_INVALID_SOURCE');
    assert.equal(response.error.retryable, false);
    assert.equal(JSON.stringify(response).includes(sourceFilePath), false);
    assert.deepEqual(events, []);
    const tmpEntries = await readdir(join(project.projectDirectory, 'tmp'));
    assert.equal(tmpEntries.includes('desktop-novel-import'), false);
  } finally {
    await closeIgnoringErrors(core);
    await rm(parentDirectory, { force: true, recursive: true });
  }
});

test('binds the private source to the exact Main selection token and returns a valid sentinel error', async () => {
  const parentDirectory = await mkdtemp(join(tmpdir(), 'voxweaver-desktop-core-import-'));
  const sourceFilePath = join(parentDirectory, 'token-bound.txt');
  const core = new AppCoreService();

  try {
    await writeFile(sourceFilePath, SYNTHETIC_TXT, { flag: 'wx' });
    const project = await core.createProject({
      displayName: 'Desktop Token Binding',
      parentDirectory,
    });
    const dispatcher = new DesktopNovelImportCoreDispatcher({
      core,
      fallback: { async dispatch() { return undefined; } },
    });
    const response = await dispatcher.dispatch(
      payloadEnvelope('novelImport.start', {
        ...projectSession(project),
        idempotencyKey: 'desktop-core-token-mismatch',
        requestedBy: 'operator:desktop-core-test',
        selectionToken: 'expected_selection_token',
      }),
      {
        originalName: 'token-bound.txt',
        selectionToken: 'different_selection_token',
        sourceFilePath,
      },
    );
    assertNovelImportError(response, 'DESKTOP_SELECTION_INVALID');
    assert.equal(JSON.stringify(response).includes(sourceFilePath), false);

    const malformed = await dispatcher.dispatch(payloadEnvelope(
      'novelImport.getTask',
      {
        contractVersion: '1',
        projectId: '/private/not-a-project-id',
        projectSessionId: 'not-a-session',
        taskId: TASK_ID,
      },
    ));
    assert.equal(malformed.messageKind, 'error');
    assert.doesNotThrow(() => parseDesktopNovelImportError(malformed.error));
    assert.equal(malformed.error.projectId, uuid(0));
    assert.equal(malformed.error.projectSessionId, uuid(1));
  } finally {
    await closeIgnoringErrors(core);
    await rm(parentDirectory, { force: true, recursive: true });
  }
});

test('rejects unsafe staging IDs and does not let an auxiliary event failure erase a committed result', async () => {
  const parentDirectory = await mkdtemp(join(tmpdir(), 'voxweaver-desktop-core-import-'));
  const sourceFilePath = join(parentDirectory, 'id-guarded.txt');
  const core = new AppCoreService();

  try {
    await writeFile(sourceFilePath, SYNTHETIC_TXT, { flag: 'wx' });
    const project = await core.createProject({
      displayName: 'Desktop ID Guard',
      parentDirectory,
    });
    const session = projectSession(project);
    const unsafe = new DesktopNovelImportCoreDispatcher({
      core,
      createId: () => '../escape',
      fallback: { async dispatch() { return undefined; } },
    });
    const rejected = await unsafe.dispatch(
      payloadEnvelope('novelImport.start', startPayload(session, 'unsafe-id')),
      trustedSource(sourceFilePath, 'id-guarded.txt'),
    );
    assertNovelImportError(rejected, 'NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE');
    assert.equal(JSON.stringify(rejected).includes('../escape'), false);

    const ids = [uuid(900), '../invalid-event-id'];
    const eventFailure = new DesktopNovelImportCoreDispatcher({
      core,
      createId: () => ids.shift(),
      fallback: { async dispatch() { return undefined; } },
    });
    const events = [];
    eventFailure.subscribe(event => events.push(event));
    const committed = await eventFailure.dispatch(
      payloadEnvelope('novelImport.start', startPayload(session, 'event-id-failure')),
      trustedSource(sourceFilePath, 'id-guarded.txt'),
    );
    assert.equal(committed.messageKind, 'result');
    assert.equal(committed.result.task.executionStatus, 'succeeded');
    assert.deepEqual(events, []);
  } finally {
    await closeIgnoringErrors(core);
    await rm(parentDirectory, { force: true, recursive: true });
  }
});

test('rejects a same-size source rewrite between identity checks', async () => {
  const parentDirectory = await mkdtemp(join(tmpdir(), 'voxweaver-desktop-core-import-'));
  const sourceFilePath = join(parentDirectory, 'rewritten-source.txt');
  const core = new AppCoreService();

  try {
    await writeFile(sourceFilePath, SYNTHETIC_TXT, { flag: 'wx' });
    const project = await core.createProject({
      displayName: 'Desktop Source Stability',
      parentDirectory,
    });
    const rewritten = SYNTHETIC_TXT.replace('起点', '改写');
    assert.equal(Buffer.byteLength(rewritten), Buffer.byteLength(SYNTHETIC_TXT));
    const dispatcher = new DesktopNovelImportCoreDispatcher({
      core,
      createId() {
        writeFileSync(sourceFilePath, rewritten);
        const changedAt = new Date('2030-01-01T00:00:00.000Z');
        utimesSync(sourceFilePath, changedAt, changedAt);
        return uuid(901);
      },
      fallback: { async dispatch() { return undefined; } },
    });
    const events = [];
    dispatcher.subscribe(event => events.push(event));

    const response = await dispatcher.dispatch(
      payloadEnvelope(
        'novelImport.start',
        startPayload(projectSession(project), 'same-size-rewrite'),
      ),
      trustedSource(sourceFilePath, 'rewritten-source.txt'),
    );

    assertNovelImportError(response, 'NOVEL_IMPORT_INVALID_SOURCE');
    assert.deepEqual(events, []);
    assert.equal(JSON.stringify(response).includes(sourceFilePath), false);
    const tmpEntries = await readdir(join(project.projectDirectory, 'tmp'));
    assert.equal(tmpEntries.includes('desktop-novel-import'), false);
  } finally {
    await closeIgnoringErrors(core);
    await rm(parentDirectory, { force: true, recursive: true });
  }
});

function payloadEnvelope(method, payload) {
  return { messageKind: 'payload', method, payload };
}

function projectSession(project) {
  return {
    contractVersion: '1',
    projectId: project.manifest.projectId,
    projectSessionId: project.projectSessionId,
  };
}

function startPayload(session, suffix) {
  return {
    ...session,
    idempotencyKey: `desktop-core-${suffix}`,
    requestedBy: 'operator:desktop-core-test',
    selectionToken: 'private_selection_token',
  };
}

function trustedSource(sourceFilePath, originalName) {
  return {
    originalName,
    selectionToken: 'private_selection_token',
    sourceFilePath,
  };
}

function assertNovelImportError(response, code) {
  assert.equal(response.messageKind, 'error');
  assert.equal(response.error.code, code);
  assert.equal(response.error.message, 'The novel import request could not be completed.');
}

async function closeIgnoringErrors(core) {
  try {
    await core.closeProject();
  } catch {
    // Test cleanup must not hide the assertion failure.
  }
}

function uuid(value) {
  return `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
}
