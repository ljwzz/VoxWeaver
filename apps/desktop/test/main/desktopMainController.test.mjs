/* eslint-disable test/no-import-node-test */

import assert from 'node:assert/strict';
import test from 'node:test';

import { loadDesktopMainModule } from './loadDesktopMainModules.mjs';

const {
  DesktopMainController,
  desktopIpcChannel,
} = await loadDesktopMainModule('controller');

const PROJECT_SUMMARY = {
  accessMode: 'read-write',
  displayName: 'Sample project',
  layoutVersion: 2,
  projectId: '9451cf18-18c8-4ddd-98b2-28ab65fb85b5',
  projectSessionId: '348d6518-f31d-405a-bf8f-12e7c1b893c7',
};

test('keeps a selected path private and consumes its token after success', async () => {
  const calls = [];
  const controller = createController({
    core: async (request, trustedContext) => {
      calls.push({ request, trustedContext });
      return successResponse(request, PROJECT_SUMMARY);
    },
    selectedDirectory: {
      displayName: 'Projects',
      projectDirectory: '/private/voxweaver/projects',
    },
  });

  const selection = await controller.dispatch(7, request('dialog.selectDirectory', {
    purpose: 'create-project-parent',
  }));
  assert.equal(selection.ok, true);
  assert.equal(selection.result.canceled, false);
  assert.equal(JSON.stringify(selection).includes('/private/voxweaver/projects'), false);

  const created = await controller.dispatch(7, request('project.create', {
    displayName: 'Sample project',
    selectionToken: selection.result.selectionToken,
  }));
  assert.equal(created.ok, true);
  assert.deepEqual(calls, [{
    request: request('project.create', {
      displayName: 'Sample project',
      selectionToken: selection.result.selectionToken,
    }),
    trustedContext: {
      projectDirectory: '/private/voxweaver/projects',
      selectionPurpose: 'create-project-parent',
      selectionToken: selection.result.selectionToken,
    },
  }]);
  assert.equal(JSON.stringify(calls[0].request).includes('/private/voxweaver/projects'), false);

  const reused = await controller.dispatch(7, request('project.create', {
    displayName: 'Sample project',
    selectionToken: selection.result.selectionToken,
  }));
  assertFailure(reused, 'DESKTOP_SELECTION_INVALID');
});

test('returns cancellation without issuing a token', async () => {
  const controller = createController({
    selectedDirectory: undefined,
  });

  const response = await controller.dispatch(7, request('dialog.selectDirectory', {
    purpose: 'open-project',
  }));
  assert.deepEqual(response, {
    ok: true,
    protocolVersion: '1',
    requestId: 'request-1',
    result: { canceled: true },
  });
});

for (const confirmationCode of [
  'PROJECT_MIGRATION_CONFIRMATION_REQUIRED',
  'PROJECT_WRITE_LOCK_RECOVERY_REQUIRED',
]) {
  test(`allows exactly one same-token retry after ${confirmationCode}`, async () => {
    let attempt = 0;
    const coreCalls = [];
    const controller = createController({
      core: async (coreRequest, trustedContext) => {
        coreCalls.push({ coreRequest, trustedContext });
        attempt += 1;
        return attempt === 1
          ? failureResponse(coreRequest, confirmationCode, true, '/private/leak')
          : successResponse(coreRequest, PROJECT_SUMMARY);
      },
      selectedDirectory: {
        displayName: 'Project',
        projectDirectory: '/private/voxweaver/retry-project',
      },
    });
    const selection = await select(controller, 'open-project');
    const initial = await controller.dispatch(7, request('project.open', {
      selectionToken: selection,
    }));
    assertFailure(initial, confirmationCode);
    assert.equal(JSON.stringify(initial).includes('/private/leak'), false);

    const confirmed = await controller.dispatch(7, request('project.open', {
      confirmMigration: confirmationCode === 'PROJECT_MIGRATION_CONFIRMATION_REQUIRED',
      recoverStaleWriteLock: confirmationCode === 'PROJECT_WRITE_LOCK_RECOVERY_REQUIRED',
      selectionToken: selection,
    }));
    assert.equal(confirmed.ok, true);
    assert.equal(coreCalls.length, 2);
    assert.equal(coreCalls[0].trustedContext.projectDirectory, '/private/voxweaver/retry-project');
    assert.equal(coreCalls[1].trustedContext.projectDirectory, '/private/voxweaver/retry-project');

    const reused = await controller.dispatch(7, request('project.open', {
      selectionToken: selection,
    }));
    assertFailure(reused, 'DESKTOP_SELECTION_INVALID');
  });
}

test('invalidates a selection after every non-confirmation failure', async () => {
  const controller = createController({
    core: async coreRequest => failureResponse(
      coreRequest,
      'PROJECT_WRITE_LOCKED',
      true,
      '/private/lock-path',
    ),
    selectedDirectory: {
      displayName: 'Project',
      projectDirectory: '/private/voxweaver/locked-project',
    },
  });
  const selection = await select(controller, 'open-project');

  const locked = await controller.dispatch(
    7,
    request('project.open', { selectionToken: selection }),
  );
  assertFailure(locked, 'PROJECT_WRITE_LOCKED');
  assert.equal(locked.error.retryable, false);
  assertFailure(
    await controller.dispatch(7, request('project.open', { selectionToken: selection })),
    'DESKTOP_SELECTION_INVALID',
  );
});

test('rejects cross-purpose and closed-window tokens, but recent projects bypass tokens', async () => {
  const calls = [];
  const controller = createController({
    core: async (coreRequest, trustedContext) => {
      calls.push({ coreRequest, trustedContext });
      return successResponse(coreRequest, PROJECT_SUMMARY);
    },
    selectedDirectory: {
      displayName: 'Project',
      projectDirectory: '/private/voxweaver/project',
    },
  });
  const selection = await select(controller, 'open-project');

  assertFailure(
    await controller.dispatch(7, request('project.switch', { selectionToken: selection })),
    'DESKTOP_SELECTION_INVALID',
  );
  assertFailure(
    await controller.dispatch(7, request('project.open', { selectionToken: selection })),
    'DESKTOP_SELECTION_INVALID',
  );

  const closedSelection = await select(controller, 'open-project');
  controller.handleWindowClosed(7);
  assertFailure(
    await controller.dispatch(7, request('project.open', { selectionToken: closedSelection })),
    'DESKTOP_SELECTION_INVALID',
  );

  const recent = await controller.dispatch(7, request('project.open', {
    recentProjectId: PROJECT_SUMMARY.projectId,
  }));
  assert.equal(recent.ok, true);
  assert.equal(calls.at(-1).trustedContext, undefined);
});

test('rejects renderer paths and Core result paths without forwarding either', async () => {
  let coreCalls = 0;
  const controller = createController({
    core: async (coreRequest) => {
      coreCalls += 1;
      return successResponse(coreRequest, {
        ...PROJECT_SUMMARY,
        futureField: '/private/core-result',
      });
    },
  });

  const inputPath = await controller.dispatch(7, request('app.getHealth', {
    futurePath: '/private/renderer-path',
  }));
  assertFailure(inputPath, 'DESKTOP_PAYLOAD_INVALID');
  assert.equal(coreCalls, 0);

  const leakedResult = await controller.dispatch(7, request('project.getSummary', {}));
  assertFailure(leakedResult, 'DESKTOP_CORE_UNAVAILABLE');
  assert.equal(JSON.stringify(leakedResult).includes('/private/core-result'), false);
});

test('registers narrow method channels and validates the sender/channel pair', async () => {
  const handlers = new Map();
  const controller = createController();
  controller.registerIpcHandlers({
    handle(channel, handler) {
      handlers.set(channel, handler);
    },
  });

  assert.equal(handlers.size, 9);
  assert.equal(handlers.has(desktopIpcChannel('project.open')), true);
  const healthHandler = handlers.get(desktopIpcChannel('app.getHealth'));
  const health = await healthHandler({ sender: { id: 7 } }, request('app.getHealth', {}));
  assert.equal(health.ok, true);

  const mismatched = await healthHandler(
    { sender: { id: 7 } },
    request('project.getSummary', {}),
  );
  assertFailure(mismatched, 'DESKTOP_PAYLOAD_INVALID');

  const invalidSender = await healthHandler({}, request('app.getHealth', {}));
  assertFailure(invalidSender, 'DESKTOP_PAYLOAD_INVALID');
});

test('preserves a Core timeout without exposing its internal error', async () => {
  const controller = createController({
    core: async () => {
      throw Object.assign(new Error('/private/timeout'), {
        code: 'DESKTOP_CORE_TIMEOUT',
      });
    },
  });

  const response = await controller.dispatch(7, request('app.getHealth', {}));
  assertFailure(response, 'DESKTOP_CORE_TIMEOUT');
  assert.equal(response.error.retryable, true);
  assert.equal(JSON.stringify(response).includes('/private/timeout'), false);
});

function createController(options = {}) {
  return new DesktopMainController({
    coreClient: {
      dispatch: options.core ?? (async (coreRequest) => {
        if (coreRequest.method === 'app.getHealth')
          return successResponse(coreRequest, { healthy: true });
        if (coreRequest.method === 'project.getSummary')
          return successResponse(coreRequest, PROJECT_SUMMARY);
        return successResponse(coreRequest, PROJECT_SUMMARY);
      }),
    },
    directoryPicker: {
      async selectDirectory() {
        return options.selectedDirectory;
      },
    },
  });
}

async function select(controller, purpose) {
  const response = await controller.dispatch(7, request('dialog.selectDirectory', { purpose }));
  assert.equal(response.ok, true);
  assert.equal(response.result.canceled, false);
  return response.result.selectionToken;
}

function request(method, payload) {
  return {
    method,
    payload,
    protocolVersion: '1',
    requestId: 'request-1',
  };
}

function successResponse(coreRequest, result) {
  return {
    ok: true,
    protocolVersion: '1',
    requestId: coreRequest.requestId,
    result,
  };
}

function failureResponse(coreRequest, code, retryable, privatePath) {
  return {
    error: {
      code,
      details: { privatePath },
      message: `Failure at ${privatePath}`,
      retryable,
    },
    ok: false,
    protocolVersion: '1',
    requestId: coreRequest.requestId,
  };
}

function assertFailure(response, code) {
  assert.equal(response.ok, false);
  assert.equal(response.error.code, code);
}
