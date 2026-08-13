import type { ProjectManifest } from '@voxweaver/contracts';
import type { ProjectCatalogPort, ProjectCatalogRecord, ProjectWorkspacePort } from './projectApplicationService.ts';

import assert from 'node:assert/strict';
import test from 'node:test';
import { ProjectApplicationService } from './projectApplicationService.ts';

const manifest: ProjectManifest = {
  schemaVersion: 1,
  layoutVersion: 2,
  projectId: '43f7ced7-98dd-44c1-9b3b-204510d9910d',
  displayName: '雨夜来信',
  createdAt: '2026-08-12T08:00:00.000Z',
  updatedAt: '2026-08-12T08:00:00.000Z',
  stateDatabase: 'state/project.sqlite',
  sourceAsset: {
    id: '8a5b03d2-a442-45d5-993a-b61998c00cb8',
    originalName: 'download.txt',
    relativePath: 'inputs/source-assets/8a5b03d2-a442-45d5-993a-b61998c00cb8/download.txt',
    byteLength: 1,
    sha256: 'a'.repeat(64),
  },
};

class MemoryWorkspace implements ProjectWorkspacePort {
  async createProject(): Promise<{ rootPath: string; manifest: ProjectManifest }> {
    return { rootPath: '/projects/rain', manifest };
  }

  async inspectProject(): Promise<{ availability: 'available' }> {
    return { availability: 'available' };
  }

  async openProject(): Promise<{ rootPath: string; manifest: ProjectManifest }> {
    return { rootPath: '/projects/rain', manifest };
  }
}

class MemoryCatalog implements ProjectCatalogPort {
  records: ProjectCatalogRecord[] = [];
  failWrites = false;
  upsertCalls = 0;

  async get(projectId: string): Promise<ProjectCatalogRecord | undefined> {
    return this.records.find(record => record.projectId === projectId);
  }

  async list(): Promise<ProjectCatalogRecord[]> {
    return [...this.records].sort((left, right) =>
      right.lastOpenedAt.localeCompare(left.lastOpenedAt)
      || left.projectId.localeCompare(right.projectId));
  }

  async remove(projectId: string): Promise<void> {
    this.records = this.records.filter(record => record.projectId !== projectId);
  }

  async upsert(record: ProjectCatalogRecord): Promise<void> {
    this.upsertCalls += 1;
    if (this.failWrites)
      throw new Error('catalog failed');
    this.records = [
      ...this.records.filter(existing =>
        existing.projectId !== record.projectId
        && existing.directoryPath !== record.directoryPath),
      record,
    ];
  }
}

function catalogRecord(
  projectId: string,
  lastOpenedAt: string,
  directoryPath = `/projects/${projectId}`,
): ProjectCatalogRecord {
  return {
    projectId,
    displayName: `项目 ${projectId}`,
    directoryPath,
    sourceFileName: `${projectId}.txt`,
    createdAt: manifest.createdAt,
    updatedAt: manifest.updatedAt,
    layoutVersion: manifest.layoutVersion,
    lastOpenedAt,
  };
}

test('项目成功不因 catalog 写入失败而回滚', async () => {
  const catalog = new MemoryCatalog();
  catalog.failWrites = true;
  const service = new ProjectApplicationService(
    new MemoryWorkspace(),
    catalog,
    () => new Date('2026-08-12T09:00:00.000Z'),
  );

  const outcome = await service.createProject({ displayName: '雨夜来信', rootPath: '/projects/rain', sourcePath: '/source.txt' });
  assert.equal(outcome.project.manifest.projectId, manifest.projectId);
  assert.deepEqual(outcome.warnings, ['项目已成功打开，但最近项目记录更新失败。']);
});

test('最近项目返回目录和可用状态', async () => {
  const catalog = new MemoryCatalog();
  catalog.records = [{
    projectId: manifest.projectId,
    displayName: manifest.displayName,
    directoryPath: '/projects/rain',
    sourceFileName: manifest.sourceAsset.originalName,
    createdAt: manifest.createdAt,
    updatedAt: manifest.updatedAt,
    layoutVersion: manifest.layoutVersion,
    lastOpenedAt: '2026-08-12T09:00:00.000Z',
  }];
  const service = new ProjectApplicationService(new MemoryWorkspace(), catalog);

  const recent = await service.listRecentProjects();
  assert.equal(recent[0]?.directoryPath, '/projects/rain');
  assert.equal(recent[0]?.availability, 'available');
});

test('打开最近项目后更新打开时间并排到首位', async () => {
  const catalog = new MemoryCatalog();
  catalog.records = [
    catalogRecord(manifest.projectId, '2026-08-12T08:30:00.000Z', '/projects/rain'),
    catalogRecord('another-project', '2026-08-12T09:30:00.000Z'),
  ];
  const service = new ProjectApplicationService(
    new MemoryWorkspace(),
    catalog,
    () => new Date('2026-08-12T10:00:00.000Z'),
  );

  await service.openRecentProject(manifest.projectId);

  const recent = await service.listRecentProjects();
  assert.equal(recent[0]?.projectId, manifest.projectId);
  assert.equal(recent[0]?.lastOpenedAt, '2026-08-12T10:00:00.000Z');
});

test('打开最近项目失败时不更新打开时间', async () => {
  const catalog = new MemoryCatalog();
  const originalLastOpenedAt = '2026-08-12T08:30:00.000Z';
  catalog.records = [catalogRecord(manifest.projectId, originalLastOpenedAt, '/projects/rain')];
  const workspace = new MemoryWorkspace();
  workspace.openProject = async () => {
    throw new Error('open failed');
  };
  const service = new ProjectApplicationService(
    workspace,
    catalog,
    () => new Date('2026-08-12T10:00:00.000Z'),
  );

  await assert.rejects(service.openRecentProject(manifest.projectId), /open failed/u);

  assert.equal(catalog.upsertCalls, 0);
  assert.equal((await catalog.get(manifest.projectId))?.lastOpenedAt, originalLastOpenedAt);
});

test('最近项目状态检查使用 8 路并发且保持 catalog 顺序', async () => {
  const catalog = new MemoryCatalog();
  catalog.records = Array.from({ length: 25 }, (_, index) =>
    catalogRecord(`project-${index.toString().padStart(2, '0')}`, new Date(Date.UTC(2026, 7, 12, 9, 0, index)).toISOString()));
  let activeInspections = 0;
  let maximumActiveInspections = 0;
  const workspace = new MemoryWorkspace();
  workspace.inspectProject = async () => {
    activeInspections += 1;
    maximumActiveInspections = Math.max(maximumActiveInspections, activeInspections);
    await new Promise<void>(resolve => setImmediate(resolve));
    activeInspections -= 1;
    return { availability: 'available' };
  };
  const service = new ProjectApplicationService(workspace, catalog);
  const expectedOrder = (await catalog.list()).map(record => record.projectId);

  const recent = await service.listRecentProjects();

  assert.equal(maximumActiveInspections, 8);
  assert.deepEqual(recent.map(project => project.projectId), expectedOrder);
});
