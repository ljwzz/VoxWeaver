import type { CoreEventEnvelope, CoreTrustedContext } from '@voxweaver/contracts';

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { NovelImportService } from './novelImportService.ts';
import { ProjectSessionRegistry } from './projectSessionRegistry.ts';
import { SqliteProjectCatalog } from './sqliteProjectCatalog.ts';

const temporaryDirectories: string[] = [];

test.afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directoryPath =>
    rm(directoryPath, { recursive: true, force: true })));
});

async function createFixture(sourceText = '第一章 雨夜\n雨落在旧车站。\n第二章 清晨\n天色渐亮。\n') {
  const basePath = await mkdtemp(path.join(os.tmpdir(), 'voxweaver-novel-import-service-'));
  temporaryDirectories.push(basePath);
  const sourcePath = path.join(basePath, 'novel.txt');
  const rootPath = path.join(basePath, 'project');
  await Promise.all([writeFile(sourcePath, sourceText, 'utf8'), mkdir(rootPath)]);
  const catalog = new SqliteProjectCatalog(path.join(basePath, 'catalog.sqlite'));
  const registry = new ProjectSessionRegistry({ appInstanceId: 'app-instance', catalog });
  const session = await registry.createProject({
    displayName: '测试小说',
    rootPath,
    sourcePath,
  });
  const context: CoreTrustedContext = {
    appInstanceId: session.appInstanceId,
    webContentsId: 101,
    windowKind: 'project',
    projectId: session.projectId,
    projectSessionId: session.projectSessionId,
  };
  const events: CoreEventEnvelope[] = [];
  const service = new NovelImportService(registry, { emitEvent: event => events.push(event) });
  return { catalog, context, events, registry, rootPath, service, session };
}

test('probe、幂等任务、复核和 UTF-8 byte slice 使用项目内 SourceAsset', async () => {
  const fixture = await createFixture();
  try {
    const probe = await fixture.service.probe(fixture.context);
    assert.equal(probe.source.originalName, 'novel.txt');
    assert.deepEqual(probe.encoding, {
      status: 'confirmed',
      encoding: 'utf-8',
      method: 'strict-utf8',
      sourceHash: probe.source.sha256,
    });

    const pending = await fixture.service.start(fixture.context, {});
    const reused = await fixture.service.start(fixture.context, {});
    assert.equal(reused.taskId, pending.taskId);
    await fixture.service.waitForIdle();

    const completed = fixture.service.getTask(fixture.context, pending.taskId);
    assert.equal(completed.status, 'succeeded');
    assert.equal(completed.progress.percent, 100);
    assert.equal(fixture.events.at(-1)?.eventType, 'task-completed');
    assert.equal(fixture.events.at(-1)?.projectSessionId, fixture.session.projectSessionId);

    const snapshot = fixture.service.getReviewSnapshot(fixture.context);
    assert.equal(snapshot.reviewStatus, 'pending');
    assert.equal(snapshot.chapters.length, 2);
    const first = snapshot.chapters[0]!;
    const slice = await fixture.service.getTextSlice(fixture.context, {
      revisionId: snapshot.revisionId,
      startByte: first.contentRange.startByte,
      endByte: first.contentRange.endByte,
    });
    assert.match(slice.text, /雨落在旧车站/u);

    const command = { commandType: 'confirm-review', baselineRevision: snapshot.baselineRevision } as const;
    await assert.rejects(
      fixture.service.applyReview(fixture.context, command),
      (error: unknown) => isErrorCode(error, 'NOVEL_IMPORT_REVIEW_REQUIRED'),
    );
    assert.deepEqual(await fixture.service.previewReview(fixture.context, command), {
      baselineRevision: snapshot.baselineRevision,
      commandType: 'confirm-review',
      affected: [],
      requiresConfirmation: false,
    });
    const resumedReviewService = new NovelImportService(fixture.registry);
    const approved = await resumedReviewService.applyReview(fixture.context, command);
    assert.equal(approved.reviewStatus, 'approved');

    const bootstrap = await fixture.registry.getBootstrap(fixture.context);
    assert.equal(bootstrap.stages[0]?.status, 'completed');
    assert.equal(bootstrap.capabilities.proofreading.reason, 'not-implemented');
  } finally {
    await fixture.service.waitForIdle();
    await fixture.registry.closeAll();
    fixture.catalog.close();
  }
});

test('task ID 受项目会话数据库隔离', async () => {
  const fixture = await createFixture();
  const secondRoot = path.join(path.dirname(fixture.rootPath), 'second-project');
  await mkdir(secondRoot);
  try {
    const pending = await fixture.service.start(fixture.context, {});
    await fixture.service.waitForIdle();
    const second = await fixture.registry.createProject({
      displayName: '另一个项目',
      rootPath: secondRoot,
      sourcePath: path.join(path.dirname(fixture.rootPath), 'novel.txt'),
    });
    const secondContext: CoreTrustedContext = {
      appInstanceId: second.appInstanceId,
      webContentsId: 102,
      windowKind: 'project',
      projectId: second.projectId,
      projectSessionId: second.projectSessionId,
    };
    assert.throws(
      () => fixture.service.getTask(secondContext, pending.taskId),
      (error: unknown) => isErrorCode(error, 'NOVEL_IMPORT_TASK_NOT_FOUND'),
    );
  } finally {
    await fixture.service.waitForIdle();
    await fixture.registry.closeAll();
    fixture.catalog.close();
  }
});

test('pending 任务可取消，canceled 任务可按原编码参数重试', async () => {
  const fixture = await createFixture();
  try {
    const pending = await fixture.service.start(fixture.context, {});
    const cancelRequested = fixture.service.cancelTask(fixture.context, pending.taskId);
    assert.equal(cancelRequested.canCancel, true);
    await fixture.service.waitForIdle();
    const canceled = fixture.service.getTask(fixture.context, pending.taskId);
    assert.equal(canceled.status, 'canceled');
    assert.equal(canceled.canRetry, true);

    const retry = fixture.service.retryTask(fixture.context, pending.taskId);
    assert.equal(retry.status, 'pending');
    assert.equal(retry.attempt, 2);
    await fixture.service.waitForIdle();
    assert.equal(fixture.service.getTask(fixture.context, pending.taskId).status, 'succeeded');
    assert.equal(fixture.events.some(event => event.eventType === 'task-canceled'), true);
    assert.equal(fixture.events.some(event => event.eventType === 'task-retry-scheduled'), true);
  } finally {
    await fixture.service.waitForIdle();
    await fixture.registry.closeAll();
    fixture.catalog.close();
  }
});

test('局部重跑生成新 baseline，并持久化精确下游 stale cause', async () => {
  const fixture = await createFixture();
  try {
    const task = await fixture.service.start(fixture.context, {});
    await fixture.service.waitForIdle();
    assert.equal(fixture.service.getTask(fixture.context, task.taskId).status, 'succeeded');
    const before = fixture.service.getReviewSnapshot(fixture.context);
    const selectedChapter = before.chapters[0]!;
    const consumerRevisionId = 'consumer-revision-1';
    const database = new DatabaseSync(path.join(fixture.rootPath, 'state/project.sqlite'));
    try {
      database.prepare(`
        INSERT INTO artifact_revision (
          revision_id, artifact_id, artifact_type, lineage_id, storage_kind,
          content_path, content_hash, input_fingerprint, processor_id,
          processor_version, parameters_hash, execution_status, validity_status,
          review_status, created_at, created_by, metadata_json
        ) VALUES (?, 'structure:1', 'structure', 'structure:1', 'derived',
          'artifacts/structure/consumer.json', ?, ?, 'test-processor', '1', ?,
          'succeeded', 'current', 'approved', ?, 'test', '{}')
      `).run(
        consumerRevisionId,
        'b'.repeat(64),
        'c'.repeat(64),
        'd'.repeat(64),
        '2026-08-13T00:00:00.000Z',
      );
      database.prepare(`
        INSERT INTO artifact_dependency (
          dependency_id, consumer_revision_id, producer_revision_id,
          dependency_type, selector_json
        ) VALUES ('dependency-1', ?, ?, 'chapter-selection', '{"chapter":1}')
      `).run(consumerRevisionId, before.revisionId);
    } finally {
      database.close();
    }

    const command = {
      commandType: 'rerun-selection',
      baselineRevision: before.baselineRevision,
      chapterIds: [selectedChapter.chapterId],
    } as const;
    const preview = await fixture.service.previewReview(fixture.context, command);
    assert.equal(preview.requiresConfirmation, true);
    assert.equal(preview.affected[0]?.artifactId, 'structure:1');
    const after = await fixture.service.applyReview(fixture.context, command);

    assert.notEqual(after.revisionId, before.revisionId);
    assert.equal(after.baselineRevision, before.baselineRevision + 1);
    assert.equal(after.revisionHistory.length, before.revisionHistory.length + 1);
    assert.notEqual(after.chapters[0]?.chapterId, selectedChapter.chapterId);
    await assert.rejects(
      fixture.service.previewReview(fixture.context, command),
      (error: unknown) => isErrorCode(error, 'NOVEL_IMPORT_CONFLICT'),
    );

    const persisted = new DatabaseSync(path.join(fixture.rootPath, 'state/project.sqlite'), {
      readOnly: true,
    });
    try {
      const consumer = persisted.prepare(`
        SELECT validity_status FROM artifact_revision WHERE revision_id = ?
      `).get(consumerRevisionId) as { validity_status: string };
      const cause = persisted.prepare(`
        SELECT previous_producer_revision_id, current_producer_revision_id,
          dependency_type, status
        FROM stale_cause WHERE consumer_revision_id = ?
      `).get(consumerRevisionId) as {
        previous_producer_revision_id: string;
        current_producer_revision_id: string;
        dependency_type: string;
        status: string;
      };
      assert.equal(consumer.validity_status, 'stale');
      assert.deepEqual({ ...cause }, {
        previous_producer_revision_id: before.revisionId,
        current_producer_revision_id: after.revisionId,
        dependency_type: 'chapter-selection',
        status: 'active',
      });
    } finally {
      persisted.close();
    }
  } finally {
    await fixture.service.waitForIdle();
    await fixture.registry.closeAll();
    fixture.catalog.close();
  }
});

function isErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error
    && 'code' in error
    && error.code === code;
}
