import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '@playwright/test';

const desktopExecutable = fileURLToPath(new URL(
  '../../out/VoxWeaver-darwin-arm64/VoxWeaver.app/Contents/MacOS/VoxWeaver',
  import.meta.url,
));

test('runs the stage 00 project flow through the packaged desktop app', {
  timeout: 60_000,
}, async () => {
  const testRoot = await mkdtemp(join(tmpdir(), 'voxweaver-desktop-e2e-'));
  const parentDirectory = join(testRoot, 'projects');
  const userDataDirectory = join(testRoot, 'user-data');
  let desktop;

  try {
    await mkdir(parentDirectory, { recursive: true });
    desktop = await electron.launch({
      args: [`--user-data-dir=${userDataDirectory}`],
      executablePath: desktopExecutable,
    });
    const runtimeNode = await desktop.evaluate(() => process.versions.node);
    assert.match(runtimeNode, /^24\.18\./);

    const page = await desktop.firstWindow();
    await waitForCoreReady(page);
    assert.deepEqual(
      await page.evaluate(() => window.voxweaver.app.getHealth()),
      { healthy: true },
    );

    // Dialog behavior is substituted only from the Main process test seam.
    await stubDirectoryDialog(desktop, parentDirectory);

    await page.locator('#new-project-name').fill('E2E sample');
    await page.getByRole('button', { name: '创建项目' }).click();
    await waitForActiveProject(page, 'E2E sample');

    const summary = await page.evaluate(() => window.voxweaver.project.getSummary());
    assert.deepEqual(Object.keys(summary ?? {}).sort(), [
      'accessMode',
      'displayName',
      'layoutVersion',
      'projectId',
      'projectSessionId',
    ]);
    assert.equal(JSON.stringify(summary).includes(parentDirectory), false);

    await page.getByRole('button', { name: '关闭项目' }).click();
    await page.getByText('尚未打开项目').waitFor();

    const recentProjects = await page.evaluate(() => window.voxweaver.project.listRecent());
    assert.equal(recentProjects.length, 1);
    assert.equal(recentProjects[0].displayName, 'E2E sample');
    assert.equal(JSON.stringify(recentProjects).includes(parentDirectory), false);

    const projectDirectoryNames = await readdir(parentDirectory);
    assert.equal(projectDirectoryNames.length, 1);
    const projectDirectory = join(parentDirectory, projectDirectoryNames[0]);

    await stubDirectoryDialog(desktop, projectDirectory);
    await page.getByRole('button', { name: '只读打开项目' }).click();
    await waitForActiveProject(page, 'E2E sample');
    assert.equal(
      (await page.evaluate(() => window.voxweaver.project.getSummary()))?.accessMode,
      'read-only',
    );
    await closeProjectFromRenderer(page);

    const manifestPath = join(projectDirectory, 'project.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    await writeFile(
      manifestPath,
      `${JSON.stringify({ ...manifest, layoutVersion: 1 }, undefined, 2)}\n`,
      'utf8',
    );

    await stubDirectoryDialog(desktop, projectDirectory);
    await page.getByRole('button', { name: '打开项目', exact: true }).click();
    await waitForHeading(page, '确认迁移项目');
    await page.getByRole('button', { name: '确认继续' }).click();
    await waitForActiveProject(page, 'E2E sample');
    assert.equal(
      (await page.evaluate(() => window.voxweaver.project.getSummary()))?.layoutVersion,
      2,
    );
    await closeProjectFromRenderer(page);

    const staleLockPath = join(
      projectDirectory,
      'state/locks/project-write.lock',
    );
    await writeFile(staleLockPath, `${JSON.stringify({
      acquiredAt: new Date().toISOString(),
      hostname: hostname(),
      processId: 2_147_483_647,
      projectId: summary.projectId,
      projectSessionId: '11111111-1111-4111-8111-111111111111',
      schemaVersion: 1,
    }, undefined, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });

    await stubDirectoryDialog(desktop, projectDirectory);
    await page.getByRole('button', { name: '打开项目', exact: true }).click();
    await waitForHeading(page, '确认恢复失效写锁');
    await page.getByRole('button', { name: '确认继续' }).click();
    await waitForActiveProject(page, 'E2E sample');
    await closeProjectFromRenderer(page);

    await stubDirectoryDialog(desktop, parentDirectory);
    await page.locator('#new-project-name').fill('Second project');
    await page.getByRole('button', { name: '创建项目' }).click();
    await waitForActiveProject(page, 'Second project');

    const firstRecentProject = page
      .locator('.recent-list li')
      .filter({ hasText: 'E2E sample' });
    await firstRecentProject.getByRole('button', { name: '切换' }).click();
    await waitForActiveProject(page, 'E2E sample');
  } finally {
    await desktop?.close();
    await rm(testRoot, { force: true, recursive: true });
  }
});

async function stubDirectoryDialog(desktop, selectedDirectory) {
  await desktop.evaluate(({ dialog }, directory) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [directory],
    });
  }, selectedDirectory);
}

async function waitForActiveProject(page, displayName) {
  try {
    await page.locator('.active-project-panel h2').getByText(displayName, {
      exact: true,
    }).waitFor({ timeout: 15_000 });
  } catch (error) {
    const screen = await page.locator('main').textContent().catch(
      () => '<renderer unavailable>',
    );
    throw new Error(
      `Project ${JSON.stringify(displayName)} did not become active. Screen: ${screen}`,
      { cause: error },
    );
  }
}

async function waitForHeading(page, name) {
  try {
    await page.getByRole('heading', { name }).waitFor({ timeout: 15_000 });
  } catch (error) {
    const screen = await page.locator('main').textContent().catch(
      () => '<renderer unavailable>',
    );
    throw new Error(
      `Heading ${JSON.stringify(name)} did not appear. Screen: ${screen}`,
      { cause: error },
    );
  }
}

async function closeProjectFromRenderer(page) {
  await page.getByRole('button', { name: '关闭项目' }).click();
  await page.getByText('尚未打开项目').waitFor();
}

async function waitForCoreReady(page) {
  try {
    await page.locator('.core-status[data-status="ready"]').waitFor({ timeout: 15_000 });
  } catch (error) {
    const [screen, health] = await Promise.all([
      page.locator('main').textContent().catch(() => '<renderer unavailable>'),
      page.evaluate(async () => {
        try {
          return await window.voxweaver.app.getHealth();
        } catch (failure) {
          return {
            code: failure instanceof Error && 'code' in failure
              ? failure.code
              : 'unknown',
          };
        }
      }).catch(() => ({ code: 'bridge unavailable' })),
    ]);
    throw new Error(
      `Application Core did not become ready. Screen: ${screen}; health: ${JSON.stringify(health)}`,
      { cause: error },
    );
  }
}
