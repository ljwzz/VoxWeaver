/* eslint-disable test/no-import-node-test */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function readDesktopSource(relativePath) {
  return readFile(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

test('exposes only the typed window.voxweaver method surface', async () => {
  const [preload, rendererTypes] = await Promise.all([
    readDesktopSource('preload/index.ts'),
    readDesktopSource('renderer/env.d.ts'),
  ]);

  assert.match(preload, /contextBridge\.exposeInMainWorld\('voxweaver', desktopApi\)/);
  assert.match(rendererTypes, /readonly voxweaver: VoxWeaverDesktopApi/);

  for (const method of [
    'app.getHealth',
    'dialog.selectDirectory',
    'project.create',
    'project.open',
    'project.switch',
    'project.close',
    'project.getSummary',
    'project.listRecent',
    'project.removeRecent',
  ]) {
    assert.match(preload, new RegExp(`['\"]${method}['\"]`));
  }

  assert.match(preload, /readonly onCoreState:/);
  assert.match(preload, /ipcRenderer\.removeListener\(CORE_STATE_CHANNEL, wrappedListener\)/);
  assert.doesNotMatch(preload, /\bipcRenderer:\s*ipcRenderer\b/);
  assert.doesNotMatch(preload, /\bcontextBridge:\s*contextBridge\b/);
  assert.doesNotMatch(preload, /ipcRenderer\.send\(/);
});

test('renderer consumes window.voxweaver and never receives transport envelopes or paths', async () => {
  const renderer = await readDesktopSource('renderer/App.vue');

  assert.match(renderer, /window\.voxweaver\.app\.getHealth\(\)/);
  assert.match(renderer, /window\.voxweaver\.onCoreState\(handleCoreState\)/);
  assert.match(renderer, /window\.voxweaver\.project\.getSummary\(\)/);
  assert.match(renderer, /window\.voxweaver\.project\.listRecent\(\)/);
  assert.match(renderer, /window\.voxweaver\.project\.create\(/);
  assert.match(renderer, /window\.voxweaver\.project\.open\(/);
  assert.match(renderer, /window\.voxweaver\.project\.switch\(/);
  assert.match(renderer, /window\.voxweaver\.project\.close\(\)/);
  assert.match(renderer, /window\.voxweaver\.project\.removeRecent\(/);
  assert.match(renderer, /canRestart: coreState\.value\.canRestart/);
  assert.match(renderer, /:disabled="isBusy \|\| !coreState\.canRestart"/);
  assert.doesNotMatch(renderer, /DesktopResponse|ipcRenderer|projectDirectory|parentDirectory|absolutePath/);
});
