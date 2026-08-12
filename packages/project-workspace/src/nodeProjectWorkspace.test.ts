import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { VoxWeaverError } from '@voxweaver/contracts';
import { NodeProjectWorkspace } from './nodeProjectWorkspace.ts';

const temporaryDirectories: string[] = [];

async function createFixture(): Promise<{ basePath: string; projectPath: string; sourcePath: string }> {
  const basePath = await mkdtemp(path.join(os.tmpdir(), 'voxweaver-workspace-'));
  temporaryDirectories.push(basePath);
  const projectPath = path.join(basePath, 'project');
  const sourcePath = path.join(basePath, 'download-18472.txt');
  await mkdir(projectPath);
  await writeFile(sourcePath, '第一章\n雨落在旧车站。\n', 'utf8');
  return { basePath, projectPath, sourcePath };
}

test.afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directoryPath => rm(directoryPath, { force: true, recursive: true })));
});

test('在选定的空目录中创建可重新打开的项目', async () => {
  const fixture = await createFixture();
  const workspace = new NodeProjectWorkspace();
  const created = await workspace.createProject({
    displayName: '雨夜来信',
    rootPath: fixture.projectPath,
    sourcePath: fixture.sourcePath,
  });

  assert.equal(created.rootPath, fixture.projectPath);
  assert.equal(created.manifest.displayName, '雨夜来信');
  assert.equal(created.manifest.sourceAsset.originalName, 'download-18472.txt');
  assert.deepEqual(
    (await readdir(fixture.projectPath)).sort(),
    ['artifacts', 'exports', 'inputs', 'project.json', 'state', 'tmp'],
  );

  const copiedSource = path.join(fixture.projectPath, ...created.manifest.sourceAsset.relativePath.split('/'));
  assert.equal(await readFile(copiedSource, 'utf8'), await readFile(fixture.sourcePath, 'utf8'));

  const reopened = await workspace.openProject(fixture.projectPath);
  assert.equal(reopened.manifest.projectId, created.manifest.projectId);
});

test('非空目录不会被覆盖', async () => {
  const fixture = await createFixture();
  await writeFile(path.join(fixture.projectPath, 'keep.txt'), 'keep', 'utf8');
  const workspace = new NodeProjectWorkspace();

  await assert.rejects(
    workspace.createProject({ displayName: '项目', rootPath: fixture.projectPath, sourcePath: fixture.sourcePath }),
    (error: unknown) => error instanceof VoxWeaverError && error.code === 'PROJECT_DIRECTORY_NOT_EMPTY',
  );
  assert.equal(await readFile(path.join(fixture.projectPath, 'keep.txt'), 'utf8'), 'keep');
});

test('项目根目录符号链接被拒绝', async () => {
  const fixture = await createFixture();
  const linkedPath = path.join(fixture.basePath, 'linked-project');
  await symlink(fixture.projectPath, linkedPath);
  const workspace = new NodeProjectWorkspace();

  await assert.rejects(
    workspace.createProject({ displayName: '项目', rootPath: linkedPath, sourcePath: fixture.sourcePath }),
    (error: unknown) => error instanceof VoxWeaverError && error.code === 'PROJECT_DIRECTORY_INVALID',
  );
});

test('源文件副本被篡改后项目无法打开', async () => {
  const fixture = await createFixture();
  const workspace = new NodeProjectWorkspace();
  const created = await workspace.createProject({
    displayName: '雨夜来信',
    rootPath: fixture.projectPath,
    sourcePath: fixture.sourcePath,
  });
  const copiedSource = path.join(fixture.projectPath, ...created.manifest.sourceAsset.relativePath.split('/'));
  await writeFile(copiedSource, '已篡改', 'utf8');

  await assert.rejects(
    workspace.openProject(fixture.projectPath),
    (error: unknown) => error instanceof VoxWeaverError && error.code === 'PROJECT_SOURCE_MISMATCH',
  );
});

test('源文件副本缺失时返回稳定错误码', async () => {
  const fixture = await createFixture();
  const workspace = new NodeProjectWorkspace();
  const created = await workspace.createProject({
    displayName: '雨夜来信',
    rootPath: fixture.projectPath,
    sourcePath: fixture.sourcePath,
  });
  const copiedSource = path.join(fixture.projectPath, ...created.manifest.sourceAsset.relativePath.split('/'));
  await rm(copiedSource);

  await assert.rejects(
    workspace.openProject(fixture.projectPath),
    (error: unknown) => error instanceof VoxWeaverError && error.code === 'PROJECT_SOURCE_MISSING',
  );
});

test('状态库记录与 manifest 不一致时拒绝打开', async () => {
  const fixture = await createFixture();
  const workspace = new NodeProjectWorkspace();
  await workspace.createProject({
    displayName: '雨夜来信',
    rootPath: fixture.projectPath,
    sourcePath: fixture.sourcePath,
  });

  const database = new DatabaseSync(path.join(fixture.projectPath, 'state', 'project.sqlite'));
  try {
    database.prepare('UPDATE project SET display_name = ?').run('已篡改');
  } finally {
    database.close();
  }

  await assert.rejects(
    workspace.openProject(fixture.projectPath),
    (error: unknown) => error instanceof VoxWeaverError && error.code === 'PROJECT_DATABASE_INVALID',
  );
});

test('无效源文件失败后保持项目目录为空', async () => {
  const fixture = await createFixture();
  const workspace = new NodeProjectWorkspace();

  await assert.rejects(
    workspace.createProject({
      displayName: '雨夜来信',
      rootPath: fixture.projectPath,
      sourcePath: path.join(fixture.basePath, 'missing.txt'),
    }),
    (error: unknown) => error instanceof VoxWeaverError && error.code === 'SOURCE_FILE_INVALID',
  );
  assert.deepEqual(await readdir(fixture.projectPath), []);
});

test('非 TXT 源文件被拒绝且项目目录保持为空', async () => {
  const fixture = await createFixture();
  const unsupportedSourcePath = path.join(fixture.basePath, 'novel.md');
  await writeFile(unsupportedSourcePath, '# 第一章', 'utf8');
  const workspace = new NodeProjectWorkspace();

  await assert.rejects(
    workspace.createProject({
      displayName: '雨夜来信',
      rootPath: fixture.projectPath,
      sourcePath: unsupportedSourcePath,
    }),
    (error: unknown) => error instanceof VoxWeaverError
      && error.code === 'SOURCE_FILE_INVALID'
      && error.message === '当前仅支持 TXT（.txt）源文件。',
  );
  assert.deepEqual(await readdir(fixture.projectPath), []);
});
