import type { CoreTrustedContext } from '@voxweaver/contracts';

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { PROJECT_STATE_DATABASE_PATH, VoxWeaverError } from '@voxweaver/contracts';
import { PROJECT_WRITE_LOCK_RELATIVE_PATH } from '@voxweaver/project-workspace';
import { ProjectSessionRegistry } from './projectSessionRegistry.ts';
import { SqliteProjectCatalog } from './sqliteProjectCatalog.ts';

const temporaryDirectories: string[] = [];
const startupContext: CoreTrustedContext = {
  appInstanceId: 'app-instance-1',
  webContentsId: 7,
  windowKind: 'startup',
};

test.afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directoryPath =>
    rm(directoryPath, { recursive: true, force: true })));
});

async function createFixture() {
  const basePath = await mkdtemp(path.join(os.tmpdir(), 'voxweaver-registry-'));
  temporaryDirectories.push(basePath);
  const sourcePath = path.join(basePath, 'novel.txt');
  await writeFile(sourcePath, '第一章 雨夜\n雨落在旧车站。\n', 'utf8');
  const catalog = new SqliteProjectCatalog(path.join(basePath, 'catalog.sqlite'));
  const registry = new ProjectSessionRegistry({
    appInstanceId: startupContext.appInstanceId,
    catalog,
  });
  return { basePath, catalog, registry, sourcePath };
}

function projectContext(session: Awaited<ReturnType<ProjectSessionRegistry['createProject']>>): CoreTrustedContext {
  return {
    appInstanceId: session.appInstanceId,
    webContentsId: 100,
    windowKind: 'project',
    projectId: session.projectId,
    projectSessionId: session.projectSessionId,
  };
}

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

test('不同项目同时持有独立会话，同项目重复打开只返回 focused', async () => {
  const fixture = await createFixture();
  const firstRoot = path.join(fixture.basePath, 'first');
  const secondRoot = path.join(fixture.basePath, 'second');
  await Promise.all([mkdir(firstRoot), mkdir(secondRoot)]);
  try {
    const first = await fixture.registry.createProject({
      displayName: '项目一',
      rootPath: firstRoot,
      sourcePath: fixture.sourcePath,
    });
    const second = await fixture.registry.createProject({
      displayName: '项目二',
      rootPath: secondRoot,
      sourcePath: fixture.sourcePath,
    });
    assert.equal(fixture.registry.sessions.length, 2);
    assert.notEqual(first.projectSessionId, second.projectSessionId);

    const focused = await fixture.registry.openProject(firstRoot, startupContext);
    assert.equal(focused.kind, 'focused');
    if (focused.kind === 'focused')
      assert.equal(focused.project.projectId, first.projectId);

    const bootstrap = await fixture.registry.getBootstrap(projectContext(first));
    assert.equal(bootstrap.project.projectId, first.projectId);
    assert.equal(bootstrap.recommendedPage, 'text-extraction');
    assert.equal(bootstrap.capabilities['chapter-splitting'].reason, 'prerequisite');
  } finally {
    await fixture.registry.closeAll();
    fixture.catalog.close();
  }
});

test('伪造项目会话被 session fencing 拒绝', async () => {
  const fixture = await createFixture();
  const rootPath = path.join(fixture.basePath, 'project');
  await mkdir(rootPath);
  try {
    const session = await fixture.registry.createProject({
      displayName: '项目',
      rootPath,
      sourcePath: fixture.sourcePath,
    });
    await assert.rejects(
      fixture.registry.getBootstrap({
        ...projectContext(session),
        projectSessionId: 'forged-session',
      }),
      (error: unknown) => error instanceof VoxWeaverError && error.code === 'PROJECT_SESSION_STALE',
    );
  } finally {
    await fixture.registry.closeAll();
    fixture.catalog.close();
  }
});

test('v1 打开返回绑定启动窗口的五分钟一次性确认令牌', async () => {
  const fixture = await createFixture();
  const rootPath = path.join(fixture.basePath, 'legacy');
  await mkdir(rootPath);
  try {
    const session = await fixture.registry.createProject({
      displayName: '旧项目',
      rootPath,
      sourcePath: fixture.sourcePath,
    });
    await fixture.registry.closeProject(projectContext(session));
    await downgradeProjectToLayoutV1(rootPath);

    const pending = await fixture.registry.openProject(rootPath, startupContext);
    assert.equal(pending.kind, 'confirmation-required');
    if (pending.kind !== 'confirmation-required')
      throw new Error('expected confirmation');
    assert.deepEqual(pending.operations, ['migrate-v1']);

    await assert.rejects(
      fixture.registry.confirmProjectOpen(pending.confirmationToken, {
        ...startupContext,
        webContentsId: 8,
      }),
      (error: unknown) => error instanceof VoxWeaverError && error.code === 'CONFIRMATION_INVALID',
    );

    const retry = await fixture.registry.openProject(rootPath, startupContext);
    if (retry.kind !== 'confirmation-required')
      throw new Error('expected confirmation');
    const opened = await fixture.registry.confirmProjectOpen(retry.confirmationToken, startupContext);
    assert.equal(opened.kind, 'opened');
    assert.equal((JSON.parse(await readFile(path.join(rootPath, 'project.json'), 'utf8')) as { layoutVersion: number }).layoutVersion, 2);

    await assert.rejects(
      fixture.registry.confirmProjectOpen(retry.confirmationToken, startupContext),
      (error: unknown) => error instanceof VoxWeaverError && error.code === 'CONFIRMATION_INVALID',
    );
  } finally {
    await fixture.registry.closeAll();
    fixture.catalog.close();
  }
});

test('活跃外部写锁直接拒绝，不返回确认令牌', async () => {
  const fixture = await createFixture();
  const rootPath = path.join(fixture.basePath, 'locked');
  await mkdir(rootPath);
  try {
    const session = await fixture.registry.createProject({
      displayName: '锁定项目',
      rootPath,
      sourcePath: fixture.sourcePath,
    });
    const anotherRegistry = new ProjectSessionRegistry({
      appInstanceId: 'app-instance-2',
      catalog: fixture.catalog,
    });
    await assert.rejects(
      anotherRegistry.openProject(rootPath, {
        appInstanceId: 'app-instance-2',
        webContentsId: 9,
        windowKind: 'startup',
      }),
      (error: unknown) => error instanceof VoxWeaverError && error.code === 'PROJECT_WRITE_LOCK_ACTIVE',
    );
    await fixture.registry.closeProject(projectContext(session));
  } finally {
    await fixture.registry.closeAll();
    fixture.catalog.close();
  }
});

test('Core 崩溃后仅按相同 app/session 身份接管已知失效锁', async () => {
  const fixture = await createFixture();
  const rootPath = path.join(fixture.basePath, 'recover-core');
  await mkdir(rootPath);
  let recoveredRegistry: ProjectSessionRegistry | undefined;
  try {
    const session = await fixture.registry.createProject({
      displayName: '恢复项目',
      rootPath,
      sourcePath: fixture.sourcePath,
    });
    const lockPath = path.join(rootPath, ...PROJECT_WRITE_LOCK_RELATIVE_PATH.split('/'));
    const database = new DatabaseSync(path.join(rootPath, PROJECT_STATE_DATABASE_PATH));
    try {
      const now = new Date().toISOString();
      database.prepare(`
        INSERT INTO task (
          task_id, project_id, task_type, input_fingerprint, command_json,
          execution_status, recovery_status, attempt, stage,
          progress_completed, progress_total, progress_message,
          temporary_path, created_at, updated_at
        ) VALUES ('interrupted-task', ?, 'novel-import', 'fingerprint', '{}',
          'running', 'resumable', 1, 'importing', 5, 100, '处理中',
          'tmp/novel-import/interrupted-task', ?, ?)
      `).run(session.projectId, now, now);
    } finally {
      database.close();
    }
    const lock = JSON.parse(await readFile(lockPath, 'utf8')) as Record<string, unknown>;
    lock.coreProcessId = 2_147_483_647;
    await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');

    recoveredRegistry = new ProjectSessionRegistry({
      appInstanceId: startupContext.appInstanceId,
      catalog: fixture.catalog,
    });
    await assert.rejects(
      recoveredRegistry.recoverProjectSession({
        rootPath,
        projectId: session.projectId,
        projectSessionId: 'forged-session',
      }, startupContext),
      (error: unknown) => error instanceof VoxWeaverError && error.code === 'PROJECT_SESSION_STALE',
    );

    const recovered = await recoveredRegistry.recoverProjectSession({
      rootPath,
      projectId: session.projectId,
      projectSessionId: session.projectSessionId,
    }, startupContext);
    assert.equal(recovered.projectId, session.projectId);
    assert.equal(recovered.projectSessionId, session.projectSessionId);
    assert.equal(recovered.canonicalRootPath, session.canonicalRootPath);
    const bootstrap = await recoveredRegistry.getBootstrap(projectContext(recovered));
    assert.equal(bootstrap.recoverableTasks[0]?.taskId, 'interrupted-task');
    assert.equal(bootstrap.recoverableTasks[0]?.status, 'failed');
    assert.equal(bootstrap.recoverableTasks[0]?.recoveryStatus, 'retryable');
  } finally {
    await recoveredRegistry?.closeAll();
    fixture.catalog.close();
  }
});
