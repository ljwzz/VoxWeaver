import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SqliteProjectCatalog } from './sqliteProjectCatalog.ts';

const temporaryDirectories: string[] = [];

test.afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directoryPath => rm(directoryPath, { force: true, recursive: true })));
});

test('catalog 返回全部项目并按打开时间倒序、项目 ID 稳定排序', async () => {
  const basePath = await mkdtemp(path.join(os.tmpdir(), 'voxweaver-catalog-'));
  temporaryDirectories.push(basePath);
  const catalog = new SqliteProjectCatalog(path.join(basePath, 'app-data', 'catalog.sqlite'));

  try {
    const baseTime = Date.UTC(2026, 7, 12, 9);
    for (let index = 0; index < 101; index += 1) {
      await catalog.upsert({
        projectId: `project-${index.toString().padStart(3, '0')}`,
        displayName: `项目 ${index}`,
        directoryPath: path.join(basePath, `project-${index}`),
        sourceFileName: `source-${index}.txt`,
        createdAt: new Date(baseTime - 3_600_000).toISOString(),
        lastOpenedAt: new Date(baseTime + index * 1_000).toISOString(),
      });
    }
    const tiedLastOpenedAt = new Date(baseTime + 101_000).toISOString();
    for (const projectId of ['project-tie-b', 'project-tie-a']) {
      await catalog.upsert({
        projectId,
        displayName: projectId,
        directoryPath: path.join(basePath, projectId),
        sourceFileName: `${projectId}.txt`,
        createdAt: new Date(baseTime - 3_600_000).toISOString(),
        lastOpenedAt: tiedLastOpenedAt,
      });
    }

    const recent = await catalog.list();
    assert.equal(recent.length, 103);
    assert.deepEqual(recent.slice(0, 2).map(project => project.projectId), ['project-tie-a', 'project-tie-b']);
    assert.equal(recent[2]?.projectId, 'project-100');
    assert.equal(recent.at(-1)?.projectId, 'project-000');
  } finally {
    catalog.close();
  }
});

test('移除最近记录不会删除项目目录', async () => {
  const basePath = await mkdtemp(path.join(os.tmpdir(), 'voxweaver-catalog-'));
  temporaryDirectories.push(basePath);
  const projectPath = path.join(basePath, 'project');
  await mkdir(projectPath);
  await writeFile(path.join(projectPath, 'keep.txt'), 'keep', 'utf8');
  const catalog = new SqliteProjectCatalog(path.join(basePath, 'app-data', 'catalog.sqlite'));

  try {
    await catalog.upsert({
      projectId: 'project-1',
      displayName: '项目',
      directoryPath: projectPath,
      sourceFileName: 'source.txt',
      createdAt: '2026-08-12T08:00:00.000Z',
      lastOpenedAt: '2026-08-12T09:00:00.000Z',
    });
    await catalog.remove('project-1');
    assert.equal(await catalog.get('project-1'), undefined);
    assert.equal(await readFile(path.join(projectPath, 'keep.txt'), 'utf8'), 'keep');
  } finally {
    catalog.close();
  }
});

test('同一项目移动后按项目 ID 更新目录', async () => {
  const basePath = await mkdtemp(path.join(os.tmpdir(), 'voxweaver-catalog-'));
  temporaryDirectories.push(basePath);
  const catalog = new SqliteProjectCatalog(path.join(basePath, 'app-data', 'catalog.sqlite'));

  try {
    const record = {
      projectId: 'project-1',
      displayName: '项目',
      directoryPath: path.join(basePath, 'before'),
      sourceFileName: 'source.txt',
      createdAt: '2026-08-12T08:00:00.000Z',
      lastOpenedAt: '2026-08-12T09:00:00.000Z',
    };
    await catalog.upsert(record);
    await catalog.upsert({
      ...record,
      directoryPath: path.join(basePath, 'after'),
      lastOpenedAt: '2026-08-12T10:00:00.000Z',
    });

    const updated = await catalog.get('project-1');
    assert.equal(updated?.directoryPath, path.join(basePath, 'after'));
    assert.equal((await catalog.list()).length, 1);
  } finally {
    catalog.close();
  }
});

test('不同目录允许使用相同项目名称', async () => {
  const basePath = await mkdtemp(path.join(os.tmpdir(), 'voxweaver-catalog-'));
  temporaryDirectories.push(basePath);
  const catalog = new SqliteProjectCatalog(path.join(basePath, 'app-data', 'catalog.sqlite'));

  try {
    const common = {
      displayName: '同名项目',
      sourceFileName: 'source.txt',
      createdAt: '2026-08-12T08:00:00.000Z',
    };
    await catalog.upsert({
      ...common,
      projectId: 'project-1',
      directoryPath: path.join(basePath, 'project-1'),
      lastOpenedAt: '2026-08-12T09:00:00.000Z',
    });
    await catalog.upsert({
      ...common,
      projectId: 'project-2',
      directoryPath: path.join(basePath, 'project-2'),
      lastOpenedAt: '2026-08-12T10:00:00.000Z',
    });

    const projects = await catalog.list();
    assert.deepEqual(projects.map(project => project.displayName), ['同名项目', '同名项目']);
  } finally {
    catalog.close();
  }
});
