import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function readDesktopFile(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

async function verifySecurityBaseline() {
  const mainSource = await readDesktopFile('main/index.ts');
  assert.match(mainSource, /contextIsolation:\s*true/);
  assert.match(mainSource, /nodeIntegration:\s*false/);
  assert.match(mainSource, /sandbox:\s*true/);
  assert.match(mainSource, /setWindowOpenHandler\(\(\)\s*=>\s*\(\{ action: 'deny' \}\)\)/);
  assert.match(mainSource, /setPermissionRequestHandler/);
  assert.match(mainSource, /will-attach-webview/);
  assert.match(mainSource, /will-navigate/);

  const rendererSource = await readDesktopFile('renderer/index.ts');
  const preloadSource = await readDesktopFile('preload/index.ts');
  assert.doesNotMatch(rendererSource, /from\s+['"](?:electron|node:)/);
  assert.doesNotMatch(preloadSource, /from\s+['"]node:/);
  assert.doesNotMatch(preloadSource, /\brequire\s*\(/);
  assert.doesNotMatch(preloadSource, /ipcRenderer\.(?:send|sendSync|postMessage)\s*\(/);
  assert.match(preloadSource, /contextBridge\.exposeInMainWorld\('voxweaver', desktopApi\)/);
  assert.match(preloadSource, /ipcRenderer\.invoke\(/);

  const html = await readDesktopFile('renderer/index.html');
  assert.match(html, /default-src 'self'/);
  assert.match(html, /script-src 'self'/);
  assert.match(html, /connect-src 'self'/);
  assert.doesNotMatch(html, /unsafe-eval/);
  assert.doesNotMatch(html, /(?:localhost|127\.0\.0\.1)/);

  const manifest = JSON.parse(await readDesktopFile('package.json'));
  assert.equal(manifest.devDependencies['@electron-forge/cli'], '7.11.2');
  assert.equal(manifest.devDependencies['@electron-forge/plugin-webpack'], '7.11.2');
  assert.equal(manifest.devDependencies['@playwright/test'], '1.62.1');
  assert.equal(manifest.devDependencies.electron, '43.2.0');
  assert.equal(manifest.devDependencies['vue-loader'], '17.4.2');
  assert.equal(manifest.dependencies.vue, '3.5.41');
  assert.equal(manifest.makers, undefined);
}

void verifySecurityBaseline();
