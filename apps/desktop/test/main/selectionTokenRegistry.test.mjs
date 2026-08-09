/* eslint-disable test/no-import-node-test */

import assert from 'node:assert/strict';
import test from 'node:test';

import { loadDesktopMainModule } from './loadDesktopMainModules.mjs';

const {
  DIRECTORY_SELECTION_TOKEN_TTL_MS,
  SelectionTokenRegistry,
} = await loadDesktopMainModule('registry');

test('issues a five-minute, window-and-purpose-bound opaque selection token', () => {
  let now = Date.UTC(2026, 7, 9, 0, 0, 0);
  const registry = new SelectionTokenRegistry({ now: () => now });

  const issued = registry.issue({
    projectDirectory: '/private/voxweaver/projects',
    purpose: 'create-project-parent',
    windowId: 17,
  });

  assert.match(issued.selectionToken, /^[\w-]{40,}$/);
  assert.deepEqual(Object.keys(issued).sort(), ['expiresAt', 'selectionToken']);
  assert.equal(
    issued.expiresAt,
    new Date(now + DIRECTORY_SELECTION_TOKEN_TTL_MS).toISOString(),
  );

  const lease = registry.reserve({
    purpose: 'create-project-parent',
    selectionToken: issued.selectionToken,
    windowId: 17,
  });
  assert.ok(lease);
  assert.deepEqual(lease.selection, {
    projectDirectory: '/private/voxweaver/projects',
    selectionPurpose: 'create-project-parent',
    selectionToken: issued.selectionToken,
  });
  registry.settle(lease, 'completed');
  assert.equal(registry.reserve({
    purpose: 'create-project-parent',
    selectionToken: issued.selectionToken,
    windowId: 17,
  }), undefined);

  now += 1;
});

test('invalidates expired, cross-window, cross-purpose and closed-window selections', () => {
  let now = Date.UTC(2026, 7, 9, 0, 0, 0);
  const registry = new SelectionTokenRegistry({ now: () => now });

  const expired = registry.issue({
    projectDirectory: '/private/expired',
    purpose: 'open-project',
    windowId: 20,
  });
  now += DIRECTORY_SELECTION_TOKEN_TTL_MS;
  assert.equal(registry.reserve({
    purpose: 'open-project',
    selectionToken: expired.selectionToken,
    windowId: 20,
  }), undefined);

  const crossWindow = registry.issue({
    projectDirectory: '/private/cross-window',
    purpose: 'open-project',
    windowId: 20,
  });
  assert.equal(registry.reserve({
    purpose: 'open-project',
    selectionToken: crossWindow.selectionToken,
    windowId: 21,
  }), undefined);
  assert.equal(registry.reserve({
    purpose: 'open-project',
    selectionToken: crossWindow.selectionToken,
    windowId: 20,
  }), undefined);

  const crossPurpose = registry.issue({
    projectDirectory: '/private/cross-purpose',
    purpose: 'open-project',
    windowId: 20,
  });
  assert.equal(registry.reserve({
    purpose: 'switch-project',
    selectionToken: crossPurpose.selectionToken,
    windowId: 20,
  }), undefined);

  const closedWindow = registry.issue({
    projectDirectory: '/private/closed-window',
    purpose: 'switch-project',
    windowId: 20,
  });
  registry.invalidateWindow(20);
  assert.equal(registry.reserve({
    purpose: 'switch-project',
    selectionToken: closedWindow.selectionToken,
    windowId: 20,
  }), undefined);
});

test('retains a token only for an explicit confirmation-required response', () => {
  const registry = new SelectionTokenRegistry({
    now: () => Date.UTC(2026, 7, 9, 0, 0, 0),
  });
  const issued = registry.issue({
    projectDirectory: '/private/retryable',
    purpose: 'open-project',
    windowId: 25,
  });

  const firstLease = registry.reserve({
    purpose: 'open-project',
    selectionToken: issued.selectionToken,
    windowId: 25,
  });
  assert.ok(firstLease);
  registry.settle(firstLease, 'confirmation-required');

  const retryLease = registry.reserve({
    purpose: 'open-project',
    selectionToken: issued.selectionToken,
    windowId: 25,
  });
  assert.ok(retryLease);
  registry.settle(retryLease, 'failed');

  assert.equal(registry.reserve({
    purpose: 'open-project',
    selectionToken: issued.selectionToken,
    windowId: 25,
  }), undefined);
});
