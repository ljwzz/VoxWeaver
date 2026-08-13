import type { ProjectMigrationPhase } from './nodeProjectWorkspace.ts';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import {
  PROJECT_LAYOUT_VERSION,
  PROJECT_SCHEMA_VERSION,
  PROJECT_STATE_DATABASE_PATH,
  VoxWeaverError,
} from '@voxweaver/contracts';
import {
  NodeProjectWorkspace,
  PROJECT_DATABASE_VERSION,
  PROJECT_LAYOUT_DIRECTORIES,

} from './nodeProjectWorkspace.ts';

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
  assert.equal(created.manifest.layoutVersion, 2);
  assert.equal(created.manifest.updatedAt, created.manifest.createdAt);
  assert.deepEqual(
    (await readdir(fixture.projectPath)).sort(),
    ['artifacts', 'cache', 'exports', 'inputs', 'logs', 'project.json', 'state', 'tmp'],
  );

  const copiedSource = path.join(fixture.projectPath, ...created.manifest.sourceAsset.relativePath.split('/'));
  assert.equal(await readFile(copiedSource, 'utf8'), await readFile(fixture.sourcePath, 'utf8'));

  const reopened = await workspace.openProject(fixture.projectPath);
  assert.equal(reopened.manifest.projectId, created.manifest.projectId);
  for (const relativeDirectory of PROJECT_LAYOUT_DIRECTORIES)
    assert.equal((await readdir(path.dirname(path.join(fixture.projectPath, relativeDirectory)))).length >= 0, true);

  const database = new DatabaseSync(path.join(fixture.projectPath, PROJECT_STATE_DATABASE_PATH), { readOnly: true });
  try {
    const version = database.prepare('PRAGMA user_version').get() as { user_version: number };
    assert.equal(version.user_version, PROJECT_DATABASE_VERSION);
    const tables = new Set((database.prepare(`
      SELECT name FROM sqlite_schema WHERE type = 'table'
    `).all() as unknown as Array<{ name: string }>).map(row => row.name));
    for (const table of [
      'artifact_revision',
      'artifact_dependency',
      'stale_cause',
      'task',
      'stage_run',
      'review_decision',
      'workspace_state',
      'novel_import_revision',
    ]) {
      assert.equal(tables.has(table), true, `missing ${table}`);
    }
  } finally {
    database.close();
  }
});

async function downgradeProjectToLayoutV1(projectPath: string): Promise<void> {
  const manifestPath = path.join(projectPath, 'project.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
  manifest.layoutVersion = 1;
  delete manifest.updatedAt;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const database = new DatabaseSync(path.join(projectPath, PROJECT_STATE_DATABASE_PATH));
  try {
    const project = database.prepare('SELECT id, display_name, created_at FROM project LIMIT 1').get() as {
      id: string;
      display_name: string;
      created_at: string;
    };
    database.exec(`
      DROP TABLE IF EXISTS novel_import_review_preview;
      DROP TABLE IF EXISTS novel_import_revision;
      DROP TABLE IF EXISTS workspace_state;
      DROP TABLE IF EXISTS review_decision;
      DROP TABLE IF EXISTS stage_run;
      DROP TABLE IF EXISTS task;
      DROP TABLE IF EXISTS stale_cause;
      DROP TABLE IF EXISTS artifact_dependency;
      DROP TABLE IF EXISTS artifact_revision;
      PRAGMA foreign_keys = OFF;
      DROP TABLE project;
      CREATE TABLE project (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      PRAGMA user_version = 1;
    `);
    database.prepare('INSERT INTO project (id, display_name, created_at) VALUES (?, ?, ?)')
      .run(project.id, project.display_name, project.created_at);
    database.prepare('UPDATE schema_info SET value = ? WHERE key = ?').run('1', 'layout_version');
  } finally {
    database.close();
  }
}

test('layout v1 必须显式迁移并保留备份', async () => {
  const fixture = await createFixture();
  const workspace = new NodeProjectWorkspace();
  const created = await workspace.createProject({
    displayName: '雨夜来信',
    rootPath: fixture.projectPath,
    sourcePath: fixture.sourcePath,
  });
  await downgradeProjectToLayoutV1(fixture.projectPath);

  const inspection = await workspace.inspectOpenProject(fixture.projectPath);
  assert.equal(inspection.status, 'migration-required');
  await assert.rejects(
    workspace.openProject(fixture.projectPath),
    (error: unknown) => error instanceof VoxWeaverError && error.code === 'PROJECT_MIGRATION_REQUIRED',
  );

  const migrated = await workspace.migrateProject(fixture.projectPath, inspection);
  assert.equal(migrated.manifest.layoutVersion, PROJECT_LAYOUT_VERSION);
  assert.equal(migrated.manifest.schemaVersion, PROJECT_SCHEMA_VERSION);
  assert.equal(migrated.manifest.projectId, created.manifest.projectId);
  const backups = await readdir(path.join(fixture.projectPath, 'state', 'backups'));
  assert.equal(backups.length, 1);
  assert.deepEqual(
    (await readdir(path.join(fixture.projectPath, 'state', 'backups', backups[0]!))).sort(),
    ['project.v1.json', 'project.v1.sqlite'],
  );
});

test('迁移确认后的文件身份变化会被拒绝', async () => {
  const fixture = await createFixture();
  const workspace = new NodeProjectWorkspace();
  await workspace.createProject({
    displayName: '雨夜来信',
    rootPath: fixture.projectPath,
    sourcePath: fixture.sourcePath,
  });
  await downgradeProjectToLayoutV1(fixture.projectPath);
  const inspection = await workspace.inspectOpenProject(fixture.projectPath);
  await writeFile(path.join(fixture.projectPath, 'project.json'), `${await readFile(path.join(fixture.projectPath, 'project.json'), 'utf8')} `, 'utf8');

  await assert.rejects(
    workspace.migrateProject(fixture.projectPath, inspection),
    (error: unknown) => error instanceof VoxWeaverError && error.code === 'CONFIRMATION_STATE_CHANGED',
  );
});

for (const failurePhase of [
  'backup-created',
  'temporary-database-ready',
  'temporary-manifest-ready',
  'database-replaced',
  'manifest-replaced',
] as const satisfies readonly ProjectMigrationPhase[]) {
  test(`迁移在 ${failurePhase} 失败后恢复 v1 manifest 和数据库`, async () => {
    const fixture = await createFixture();
    const setupWorkspace = new NodeProjectWorkspace();
    const created = await setupWorkspace.createProject({
      displayName: '雨夜来信',
      rootPath: fixture.projectPath,
      sourcePath: fixture.sourcePath,
    });
    await downgradeProjectToLayoutV1(fixture.projectPath);
    const beforeManifest = await readFile(path.join(fixture.projectPath, 'project.json'));
    const inspection = await setupWorkspace.inspectOpenProject(fixture.projectPath);
    const failingWorkspace = new NodeProjectWorkspace({
      onMigrationPhase: (phase) => {
        if (phase === failurePhase)
          throw new Error(`injected migration failure: ${phase}`);
      },
    });

    await assert.rejects(
      failingWorkspace.migrateProject(fixture.projectPath, inspection),
      (error: unknown) => error instanceof VoxWeaverError && error.code === 'PROJECT_MIGRATION_FAILED',
    );

    assert.deepEqual(await readFile(path.join(fixture.projectPath, 'project.json')), beforeManifest);
    const recovered = await setupWorkspace.inspectOpenProject(fixture.projectPath);
    assert.equal(recovered.status, 'migration-required');
    assert.equal(recovered.manifest.projectId, created.manifest.projectId);
    const database = new DatabaseSync(path.join(fixture.projectPath, PROJECT_STATE_DATABASE_PATH), { readOnly: true });
    try {
      assert.equal((database.prepare('PRAGMA user_version').get() as { user_version: number }).user_version, 1);
    } finally {
      database.close();
    }
  });
}

test('活跃写锁期间不回滚其他会话的迁移 journal', async () => {
  const fixture = await createFixture();
  const setupWorkspace = new NodeProjectWorkspace();
  const created = await setupWorkspace.createProject({
    displayName: '雨夜来信',
    rootPath: fixture.projectPath,
    sourcePath: fixture.sourcePath,
  });
  await downgradeProjectToLayoutV1(fixture.projectPath);
  const inspection = await setupWorkspace.inspectOpenProject(fixture.projectPath);
  const lock = await setupWorkspace.acquireWriteLock({
    rootPath: fixture.projectPath,
    projectId: created.manifest.projectId,
    appInstanceId: 'migration-app',
    projectSessionId: 'migration-session',
  });

  let signalBackupCreated: (() => void) | undefined;
  let resumeMigration: (() => void) | undefined;
  const backupCreated = new Promise<void>((resolve) => {
    signalBackupCreated = resolve;
  });
  const migrationResume = new Promise<void>((resolve) => {
    resumeMigration = resolve;
  });
  const migratingWorkspace = new NodeProjectWorkspace({
    onMigrationPhase: async (phase) => {
      if (phase === 'backup-created') {
        signalBackupCreated?.();
        await migrationResume;
      }
    },
  });
  const migration = migratingWorkspace.migrateProject(fixture.projectPath, inspection, lock);
  await backupCreated;

  try {
    await assert.rejects(
      new NodeProjectWorkspace().inspectOpenProject(fixture.projectPath),
      (error: unknown) => error instanceof VoxWeaverError && error.code === 'PROJECT_WRITE_LOCK_ACTIVE',
    );
    const journal = JSON.parse(await readFile(
      path.join(fixture.projectPath, 'state', 'migration-journal.json'),
      'utf8',
    )) as { phase?: unknown };
    assert.equal(journal.phase, 'backup-created');
  } finally {
    resumeMigration?.();
  }

  const migrated = await migration;
  assert.equal(migrated.manifest.layoutVersion, PROJECT_LAYOUT_VERSION);
  await setupWorkspace.releaseWriteLock(fixture.projectPath, lock);
});

test('同项目写锁互斥并按完整会话身份释放', async () => {
  const fixture = await createFixture();
  const workspace = new NodeProjectWorkspace();
  const created = await workspace.createProject({
    displayName: '雨夜来信',
    rootPath: fixture.projectPath,
    sourcePath: fixture.sourcePath,
  });
  const lock = await workspace.acquireWriteLock({
    rootPath: fixture.projectPath,
    projectId: created.manifest.projectId,
    appInstanceId: 'app-1',
    projectSessionId: 'session-1',
  });
  await assert.rejects(
    workspace.acquireWriteLock({
      rootPath: fixture.projectPath,
      projectId: created.manifest.projectId,
      appInstanceId: 'app-1',
      projectSessionId: 'session-2',
    }),
    (error: unknown) => error instanceof VoxWeaverError && error.code === 'PROJECT_WRITE_LOCK_ACTIVE',
  );
  await assert.rejects(
    workspace.releaseWriteLock(fixture.projectPath, { ...lock, projectSessionId: 'session-other' }),
    (error: unknown) => error instanceof VoxWeaverError && error.code === 'PROJECT_SESSION_STALE',
  );
  await workspace.releaseWriteLock(fixture.projectPath, lock);
  assert.equal((await workspace.inspectWriteLock(fixture.projectPath, created.manifest.projectId)).status, 'available');
});

test('最后生产页面只接受冻结页面键', async () => {
  const fixture = await createFixture();
  const workspace = new NodeProjectWorkspace();
  await workspace.createProject({
    displayName: '雨夜来信',
    rootPath: fixture.projectPath,
    sourcePath: fixture.sourcePath,
  });
  assert.equal(await workspace.readLastPage(fixture.projectPath), undefined);
  await workspace.recordLastPage(fixture.projectPath, 'chapter-splitting');
  assert.equal(await workspace.readLastPage(fixture.projectPath), 'chapter-splitting');
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
