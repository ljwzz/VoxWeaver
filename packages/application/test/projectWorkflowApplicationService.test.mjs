import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ProjectApplicationService,
  ProjectWorkflowApplicationService,
} from '../dist/index.js';

const PROJECT_ID = '9451cf18-18c8-4ddd-98b2-28ab65fb85b5';
const PROJECT_SESSION_ID = '348d6518-f31d-405a-bf8f-12e7c1b893c7';
const STALE_SESSION_ID = '6a4ab824-dcab-4682-aea3-9c8958642c1a';
const FINGERPRINT = 'a'.repeat(64);
const SCOPE = { kind: 'book', identifiers: ['book-1'] };

const project = {
  accessMode: 'read-write',
  projectDirectory: '/projects/demo',
  projectSessionId: PROJECT_SESSION_ID,
  manifest: {
    schemaVersion: 1,
    layoutVersion: 2,
    projectId: PROJECT_ID,
    displayName: 'Demo',
    directoryName: `demo--${PROJECT_ID}`,
    createdAt: '2026-08-08T00:00:00.000Z',
    updatedAt: '2026-08-08T00:00:00.000Z',
  },
};

test('strips session fields and fences lifecycle changes during workflow writes', async () => {
  const closed = [];
  const projects = new ProjectApplicationService({
    async closeProject(context) {
      closed.push(context);
    },
    async createProject() {
      return project;
    },
    async openProject() {
      return project;
    },
  });
  await projects.openProject({ projectDirectory: project.projectDirectory });

  let capturedCommand;
  let finishTask;
  const pendingTask = new Promise((resolve) => {
    finishTask = resolve;
  });
  const workflow = new ProjectWorkflowApplicationService(
    projects,
    context => ({
      async enqueueTask(command) {
        assert.equal(context.manifest.projectId, PROJECT_ID);
        capturedCommand = command;
        return pendingTask;
      },
    }),
  );

  const operation = workflow.enqueueTask({
    inputFingerprint: FINGERPRINT,
    outputScope: SCOPE,
    processorId: 'processor.test',
    projectId: PROJECT_ID,
    projectSessionId: PROJECT_SESSION_ID,
  });
  assert.deepEqual(capturedCommand, {
    inputFingerprint: FINGERPRINT,
    outputScope: SCOPE,
    processorId: 'processor.test',
  });
  await assert.rejects(
    projects.closeProject(),
    error => error?.code === 'PROJECT_OPERATION_IN_PROGRESS',
  );
  assert.deepEqual(closed, []);

  finishTask({ reused: false, task: { taskId: 'task-1' } });
  assert.equal((await operation).task.taskId, 'task-1');
  await projects.closeProject();
  assert.deepEqual(closed, [project]);
});

test('allows read queries but rejects writes for read-only and stale sessions', async () => {
  const readOnlyProject = { ...project, accessMode: 'read-only' };
  const projects = new ProjectApplicationService({
    async closeProject() {},
    async createProject() {
      return readOnlyProject;
    },
    async openProject() {
      return readOnlyProject;
    },
  });
  await projects.openProject({ projectDirectory: project.projectDirectory });
  let factoryCalls = 0;
  const workflow = new ProjectWorkflowApplicationService(
    projects,
    () => {
      factoryCalls += 1;
      return {
        async getTask(taskId) {
          return { taskId };
        },
      };
    },
  );

  assert.equal(
    (await workflow.getTask({
      projectId: PROJECT_ID,
      projectSessionId: PROJECT_SESSION_ID,
      taskId: 'task-1',
    })).taskId,
    'task-1',
  );
  await assert.rejects(
    workflow.enqueueTask({
      inputFingerprint: FINGERPRINT,
      outputScope: SCOPE,
      processorId: 'processor.test',
      projectId: PROJECT_ID,
      projectSessionId: PROJECT_SESSION_ID,
    }),
    error => error?.code === 'PROJECT_READ_ONLY',
  );
  await assert.rejects(
    workflow.getTask({
      projectId: PROJECT_ID,
      projectSessionId: STALE_SESSION_ID,
      taskId: 'task-1',
    }),
    error => error?.code === 'PROJECT_SESSION_STALE',
  );
  assert.equal(factoryCalls, 1);
});
