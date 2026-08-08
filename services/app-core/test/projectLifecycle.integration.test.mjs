import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { NodeProjectWorkspace } from '@voxweaver/project-workspace';

import { AppCoreService } from '../dist/index.js';

const PROJECT_ID = '9451cf18-18c8-4ddd-98b2-28ab65fb85b5';
const PROJECT_SESSION_IDS = [
  '348d6518-f31d-405a-bf8f-12e7c1b893c7',
  '6a4ab824-dcab-4682-aea3-9c8958642c1a',
  'ae181966-0313-465c-b378-fea05512de3f',
];
const INPUT_FINGERPRINT = 'a'.repeat(64);
const OUTPUT_SCOPE = { kind: 'book', identifiers: ['book-1'] };

test('creates, closes, and reopens an empty project through app core', async () => {
  const parentDirectory = await mkdtemp(join(tmpdir(), 'voxweaver-app-core-'));

  try {
    let projectSessionIndex = 0;
    const projectWorkspace = new NodeProjectWorkspace({
      generateProjectId: () => PROJECT_ID,
      generateProjectSessionId: () => PROJECT_SESSION_IDS[projectSessionIndex++],
      now: () => new Date('2026-08-08T00:00:00.000Z'),
    });
    const appCore = new AppCoreService({ projectWorkspace });

    const created = await appCore.createProject({
      displayName: 'MVP Sample',
      parentDirectory,
    });
    assert.equal(created.accessMode, 'read-write');
    assert.equal(created.projectSessionId, PROJECT_SESSION_IDS[0]);
    assert.equal(appCore.getActiveProject(), created);
    assert.equal(
      appCore.assertActiveProjectSession({
        projectId: PROJECT_ID,
        projectSessionId: PROJECT_SESSION_IDS[0],
        requiredAccess: 'write',
      }),
      created,
    );

    const enqueued = await appCore.workflow.enqueueTask({
      inputFingerprint: INPUT_FINGERPRINT,
      outputScope: OUTPUT_SCOPE,
      processorId: 'processor.integration',
      projectId: PROJECT_ID,
      projectSessionId: PROJECT_SESSION_IDS[0],
    });
    await writeFile(
      join(
        created.projectDirectory,
        enqueued.task.temporaryPath,
        'output',
        'content.txt',
      ),
      'app-core artifact',
    );
    await appCore.workflow.startTask({
      projectId: PROJECT_ID,
      projectSessionId: PROJECT_SESSION_IDS[0],
      taskId: enqueued.task.taskId,
    });
    const artifact = await appCore.workflow.commitArtifactRevision({
      artifactType: 'integration-artifact',
      createdBy: 'integration-test',
      inputFingerprint: INPUT_FINGERPRINT,
      outputDirectory: join(enqueued.task.temporaryPath, 'output'),
      parameters: {},
      processorId: 'processor.integration',
      processorVersion: '1.0.0',
      projectId: PROJECT_ID,
      projectSessionId: PROJECT_SESSION_IDS[0],
      scope: OUTPUT_SCOPE,
      storageKind: 'canonical',
      taskId: enqueued.task.taskId,
    });
    assert.equal(artifact.validityStatus, 'current');

    await appCore.closeProject();
    assert.equal(appCore.getActiveProject(), undefined);
    assertProjectApplicationError(
      () => appCore.assertActiveProjectSession({
        projectId: PROJECT_ID,
        projectSessionId: PROJECT_SESSION_IDS[0],
        requiredAccess: 'read',
      }),
      'PROJECT_SESSION_STALE',
    );

    const reopened = await appCore.openProject({
      projectDirectory: created.projectDirectory,
    });
    assert.equal(reopened.accessMode, 'read-write');
    assert.equal(reopened.projectSessionId, PROJECT_SESSION_IDS[1]);
    assert.equal(reopened.projectDirectory, created.projectDirectory);
    assert.deepEqual(reopened.manifest, created.manifest);
    assert.equal(appCore.getActiveProject(), reopened);

    const readOnly = await appCore.switchProject({
      accessMode: 'read-only',
      projectDirectory: created.projectDirectory,
    });
    assert.equal(readOnly.accessMode, 'read-only');
    assert.equal(readOnly.projectSessionId, PROJECT_SESSION_IDS[2]);
    assert.equal(appCore.getActiveProject(), readOnly);
    assert.equal(
      (await appCore.workflow.getArtifactRevision({
        projectId: PROJECT_ID,
        projectSessionId: PROJECT_SESSION_IDS[2],
        revisionId: artifact.revisionId,
      })).contentHash,
      artifact.contentHash,
    );
    await assert.rejects(
      appCore.workflow.getArtifactRevision({
        projectId: PROJECT_ID,
        projectSessionId: PROJECT_SESSION_IDS[1],
        revisionId: artifact.revisionId,
      }),
      error => error?.code === 'PROJECT_SESSION_STALE',
    );
    assertProjectApplicationError(
      () => appCore.assertActiveProjectSession({
        projectId: PROJECT_ID,
        projectSessionId: PROJECT_SESSION_IDS[1],
        requiredAccess: 'read',
      }),
      'PROJECT_SESSION_STALE',
    );
    assert.equal(
      appCore.assertActiveProjectSession({
        projectId: PROJECT_ID,
        projectSessionId: PROJECT_SESSION_IDS[2],
        requiredAccess: 'read',
      }),
      readOnly,
    );
    assertProjectApplicationError(
      () => appCore.assertActiveProjectSession({
        projectId: PROJECT_ID,
        projectSessionId: PROJECT_SESSION_IDS[2],
        requiredAccess: 'write',
      }),
      'PROJECT_READ_ONLY',
    );

    await appCore.closeProject();
  } finally {
    await rm(parentDirectory, { force: true, recursive: true });
  }
});

function assertProjectApplicationError(callback, code) {
  assert.throws(callback, error => error?.code === code);
}
