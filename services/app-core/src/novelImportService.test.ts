import type {
  CoreEventEnvelope,
  CoreTrustedContext,
  NovelImportReviewCommandInput,
  Utf8TextRangeDto,
} from '@voxweaver/contracts';

import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { analyzeNovelStructure } from '@voxweaver/novel-import';
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
  const sourceText = '第一章 雨夜\r\n雨\u00A0落在旧车站。\r第二章 清晨\n天色渐亮。\n';
  const fixture = await createFixture(sourceText);
  try {
    const probe = await fixture.service.probe(fixture.context);
    assert.equal(probe.source.originalName, 'novel.txt');
    assert.deepEqual(probe.encoding, {
      status: 'confirmed',
      encoding: 'utf-8',
      method: 'strict-utf8',
      sourceHash: probe.source.sha256,
    });

    const preview = await fixture.service.getSourcePreview(fixture.context, {
      sourceHash: probe.source.sha256,
      sourceEncoding: 'utf-8',
      startByte: 0,
      targetLineCount: 2,
    });
    assert.equal(preview.text, '第一章 雨夜\n雨 落在旧车站。\n');
    assert.equal(preview.completeLineCount, 2);
    assert.deepEqual(await readdir(path.join(fixture.rootPath, 'artifacts/imported')), []);

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
    const compatibilityDatabase = new DatabaseSync(path.join(fixture.rootPath, 'state/project.sqlite'));
    try {
      compatibilityDatabase.prepare(`
        UPDATE novel_import_revision SET review_snapshot_json = ? WHERE revision_id = ?
      `).run(JSON.stringify({
        ...snapshot,
        chapters: snapshot.chapters.map(chapter => ({
          chapterId: chapter.chapterId,
          order: chapter.order,
          title: chapter.title,
          headingRange: chapter.headingRange,
          contentRange: chapter.contentRange,
          reviewStatus: chapter.reviewStatus,
        })),
        candidates: [{ legacy: true }],
        normalizationProposals: [{ legacy: true }],
        diff: [{ legacy: true }],
      }), snapshot.revisionId);
    } finally {
      compatibilityDatabase.close();
    }
    const compatibleSnapshot = fixture.service.getReviewSnapshot(fixture.context);
    assert.equal('candidates' in compatibleSnapshot, false);
    assert.equal('normalizationProposals' in compatibleSnapshot, false);
    assert.equal('diff' in compatibleSnapshot, false);
    assert.equal(compatibleSnapshot.chapters[0]?.headingKind, 'source');
    assert.equal(compatibleSnapshot.chapters[0]?.lengthAnomalyAccepted, false);
    const persistedText = await readFile(path.join(
      fixture.rootPath,
      'artifacts/imported',
      snapshot.revisionId,
      'text.utf8.txt',
    ));
    assert.equal(persistedText.subarray(0, 3).equals(Buffer.from([0xEF, 0xBB, 0xBF])), false);
    assert.equal(persistedText.toString('utf8'), '第一章 雨夜\n雨 落在旧车站。\n第二章 清晨\n天色渐亮。\n');
    const persistedSource = await readFile(path.join(
      fixture.rootPath,
      ...fixture.session.manifest.sourceAsset.relativePath.split('/'),
    ), 'utf8');
    assert.equal(persistedSource, sourceText);
    const first = snapshot.chapters[0]!;
    const slice = await fixture.service.getTextSlice(fixture.context, {
      revisionId: snapshot.revisionId,
      startByte: first.contentRange.startByte,
      endByte: first.contentRange.endByte,
    });
    assert.match(slice.text, /雨 落在旧车站/u);
    assert.equal(slice.done, true);

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

test('严格解码失败不替换最后有效 revision', async () => {
  const fixture = await createFixture();
  try {
    const firstTask = await fixture.service.start(fixture.context, {});
    await fixture.service.waitForIdle();
    assert.equal(fixture.service.getTask(fixture.context, firstTask.taskId).status, 'succeeded');
    const validRevision = fixture.service.getReviewSnapshot(fixture.context).revisionId;

    const failingTask = await fixture.service.start(fixture.context, { sourceEncoding: 'gb2312' });
    await fixture.service.waitForIdle();
    const failed = fixture.service.getTask(fixture.context, failingTask.taskId);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.canRetry, true);
    assert.equal(fixture.service.getReviewSnapshot(fixture.context).revisionId, validRevision);
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

test('批量边界调整原子保存一个 revision，并持久化下游 stale cause', async () => {
  const fixture = await createFixture();
  try {
    const task = await fixture.service.start(fixture.context, {});
    await fixture.service.waitForIdle();
    assert.equal(fixture.service.getTask(fixture.context, task.taskId).status, 'succeeded');
    const before = fixture.service.getReviewSnapshot(fixture.context);
    const firstChapter = before.chapters[0]!;
    const secondChapter = before.chapters[1]!;
    assert.ok(firstChapter.headingRange);
    assert.ok(secondChapter.headingRange);
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

    const invalidCommand = {
      commandType: 'adjust-chapter-boundaries',
      baselineRevision: before.baselineRevision,
      adjustments: [{
        chapterId: firstChapter.chapterId,
        headingRange: firstChapter.headingRange,
        contentRange: {
          ...firstChapter.contentRange,
          endByte: secondChapter.headingRange.endByte,
        },
      }],
    } as const;
    await assert.rejects(
      fixture.service.previewReview(fixture.context, invalidCommand),
      (error: unknown) => isErrorCode(error, 'IPC_PAYLOAD_INVALID'),
    );
    assert.equal(fixture.service.getReviewSnapshot(fixture.context).revisionId, before.revisionId);

    const command = {
      commandType: 'adjust-chapter-boundaries',
      baselineRevision: before.baselineRevision,
      adjustments: [
        {
          chapterId: firstChapter.chapterId,
          headingRange: {
            ...firstChapter.headingRange,
            endByte: firstChapter.contentRange.startByte,
          },
          contentRange: firstChapter.contentRange,
        },
        {
          chapterId: secondChapter.chapterId,
          headingRange: secondChapter.headingRange,
          contentRange: {
            ...secondChapter.contentRange,
            endByte: secondChapter.contentRange.endByte - 1,
          },
        },
      ],
    } as const;
    const preview = await fixture.service.previewReview(fixture.context, command);
    assert.equal(preview.requiresConfirmation, true);
    assert.equal(preview.affected[0]?.artifactId, 'structure:1');
    const after = await fixture.service.applyReview(fixture.context, command);

    assert.notEqual(after.revisionId, before.revisionId);
    assert.equal(after.baselineRevision, before.baselineRevision + 1);
    assert.equal(after.revisionHistory.length, before.revisionHistory.length + 1);
    assert.equal(after.chapters[0]?.headingRange?.endByte, firstChapter.contentRange.startByte);
    assert.equal(after.chapters[1]?.contentRange.endByte, secondChapter.contentRange.endByte - 1);
    assert.equal(after.reviewStatus, 'pending');
    assert.deepEqual(after.coverage.segments.at(-1), {
      classification: 'chapter',
      range: {
        offsetUnit: 'utf8-byte',
        startByte: secondChapter.contentRange.endByte - 1,
        endByte: before.textByteLength,
      },
      chapterId: secondChapter.chapterId,
      reason: 'uncovered-to-last',
    });
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
      const revisionCount = persisted.prepare(`
        SELECT COUNT(*) AS value FROM novel_import_revision
      `).get() as { value: number };
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
      assert.equal(revisionCount.value, 2);
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

test('结构命令以同一哈希预览和应用，换行发布新规范化文本，纯结构 revision 复用文本', async () => {
  const sourceText = '第一章 雨夜\n甲乙\n第二章 清晨\n丙丁\n';
  const fixture = await createFixture(sourceText);
  try {
    await fixture.service.start(fixture.context, {});
    await fixture.service.waitForIdle();
    const before = fixture.service.getReviewSnapshot(fixture.context);
    const sourceAssetBefore = await readFile(path.join(
      fixture.rootPath,
      ...fixture.session.manifest.sourceAsset.relativePath.split('/'),
    ));
    const consumerRevisionId = 'update-consumer-revision';
    addConsumerDependency(fixture.rootPath, before.revisionId, consumerRevisionId);
    const baselineText = await readRevisionText(fixture.rootPath, before.revisionId);
    const insertionCharacterOffset = baselineText.indexOf('甲') + 1;
    const insertionPoint = byteOffset(baselineText, insertionCharacterOffset);
    const editedText = `${baselineText.slice(0, insertionCharacterOffset)}\n${baselineText.slice(insertionCharacterOffset)}`;
    const firstHeadingStart = editedText.indexOf('第一章');
    const firstHeadingEnd = firstHeadingStart + '第一章 雨夜'.length;
    const firstContentStart = editedText.indexOf('\n', firstHeadingEnd) + 1;
    const secondHeadingStart = editedText.indexOf('第二章');
    const secondHeadingEnd = secondHeadingStart + '第二章 清晨'.length;
    const secondContentStart = editedText.indexOf('\n', secondHeadingEnd) + 1;
    const command = {
      commandType: 'update-chapter-structure',
      baselineRevision: before.baselineRevision,
      insertionPoints: [insertionPoint],
      chapters: [
        {
          existingChapterId: before.chapters[0]!.chapterId,
          title: '第一章 雨夜',
          headingKind: 'source',
          headingRange: byteRange(editedText, firstHeadingStart, firstHeadingEnd),
          contentRange: byteRange(editedText, firstContentStart, secondHeadingStart),
          lengthAnomalyAccepted: true,
        },
        {
          existingChapterId: before.chapters[1]!.chapterId,
          title: '第二章 清晨',
          headingKind: 'source',
          headingRange: byteRange(editedText, secondHeadingStart, secondHeadingEnd),
          contentRange: byteRange(editedText, secondContentStart, editedText.length),
          lengthAnomalyAccepted: false,
        },
      ],
      unassignedRanges: [],
    } as const;

    const preview = await fixture.service.previewReview(fixture.context, command);
    assert.equal(preview.requiresConfirmation, true);
    await assert.rejects(
      fixture.service.applyReview(fixture.context, {
        ...command,
        chapters: command.chapters.map(chapter => ({
          ...chapter,
          lengthAnomalyAccepted: false,
        })),
      }),
      (error: unknown) => isErrorCode(error, 'NOVEL_IMPORT_REVIEW_REQUIRED'),
    );
    const afterInsertion = await fixture.service.applyReview(fixture.context, command);
    assert.equal(afterInsertion.textByteLength, Buffer.byteLength(editedText));
    assert.equal(afterInsertion.chapters[0]?.lengthAnomalyAccepted, true);
    assert.deepEqual(readStaleState(fixture.rootPath, consumerRevisionId), {
      revisionCount: 2,
      validityStatus: 'stale',
      previousProducerRevisionId: before.revisionId,
      currentProducerRevisionId: afterInsertion.revisionId,
    });
    assert.equal(await readRevisionText(fixture.rootPath, afterInsertion.revisionId), editedText);
    assert.equal(await readRevisionText(fixture.rootPath, before.revisionId), baselineText);
    assert.deepEqual(
      (await readdir(path.join(fixture.rootPath, 'artifacts/imported', afterInsertion.revisionId))).sort(),
      ['review.json', 'text.utf8.txt'],
    );

    const pathsAfterInsertion = readRevisionPaths(fixture.rootPath, afterInsertion.revisionId);
    const pathsBefore = readRevisionPaths(fixture.rootPath, before.revisionId);
    assert.equal(pathsAfterInsertion.rawTextPath, pathsBefore.rawTextPath);
    assert.notEqual(pathsAfterInsertion.canonicalTextPath, pathsBefore.canonicalTextPath);
    const pureStructureCommand = {
      commandType: 'update-chapter-structure',
      baselineRevision: afterInsertion.baselineRevision,
      insertionPoints: [],
      chapters: afterInsertion.chapters.map(chapter => ({
        existingChapterId: chapter.chapterId,
        title: chapter.title,
        headingKind: chapter.headingKind,
        ...(chapter.headingRange ? { headingRange: chapter.headingRange } : {}),
        contentRange: chapter.contentRange,
        lengthAnomalyAccepted: true,
      })),
      unassignedRanges: [],
    } as const;
    await fixture.service.previewReview(fixture.context, pureStructureCommand);
    const afterStructure = await fixture.service.applyReview(fixture.context, pureStructureCommand);
    assert.equal(afterStructure.chapters.every(chapter => chapter.lengthAnomalyAccepted), true);
    assert.deepEqual(
      await readdir(path.join(fixture.rootPath, 'artifacts/imported', afterStructure.revisionId)),
      ['review.json'],
    );
    assert.equal(
      readRevisionPaths(fixture.rootPath, afterStructure.revisionId).canonicalTextPath,
      pathsAfterInsertion.canonicalTextPath,
    );
    const revokeAcceptedCommand = structureCommandFromSnapshot(afterStructure);
    await assert.rejects(
      fixture.service.previewReview(fixture.context, {
        ...revokeAcceptedCommand,
        chapters: revokeAcceptedCommand.chapters.map((chapter, index) => index === 0
          ? { ...chapter, lengthAnomalyAccepted: false }
          : chapter),
      }),
      (error: unknown) => isErrorCode(error, 'IPC_PAYLOAD_INVALID'),
    );
    assert.deepEqual(await readFile(path.join(
      fixture.rootPath,
      ...fixture.session.manifest.sourceAsset.relativePath.split('/'),
    )), sourceAssetBefore);
  } finally {
    await fixture.service.waitForIdle();
    await fixture.registry.closeAll();
    fixture.catalog.close();
  }
});

test('结构命令严格拒绝额外字段、重复或非 UTF-8 插入点、未知 ID 和未归属重叠', async () => {
  const fixture = await createFixture();
  try {
    await fixture.service.start(fixture.context, {});
    await fixture.service.waitForIdle();
    const snapshot = fixture.service.getReviewSnapshot(fixture.context);
    const command = structureCommandFromSnapshot(snapshot);
    const baselineText = await readRevisionText(fixture.rootPath, snapshot.revisionId);
    const firstLineFeed = byteOffset(baselineText, baselineText.indexOf('\n'));
    const invalidCommands: NovelImportReviewCommandInput[] = [
      { ...command, unexpected: true } as unknown as NovelImportReviewCommandInput,
      {
        ...command,
        chapters: [{ ...command.chapters[0]!, unexpected: true }, ...command.chapters.slice(1)],
      } as unknown as NovelImportReviewCommandInput,
      { ...command, insertionPoints: [0, 0] },
      { ...command, insertionPoints: [1] },
      { ...command, insertionPoints: [firstLineFeed] },
      { ...command, insertionPoints: [firstLineFeed + 1] },
      {
        ...command,
        chapters: [{ ...command.chapters[0]!, existingChapterId: 'unknown-chapter' }, ...command.chapters.slice(1)],
      },
      {
        ...command,
        unassignedRanges: [snapshot.chapters[0]!.headingRange!],
      },
    ];
    for (const invalidCommand of invalidCommands) {
      await assert.rejects(
        fixture.service.previewReview(fixture.context, invalidCommand),
        (error: unknown) => isErrorCode(error, 'IPC_PAYLOAD_INVALID'),
      );
    }
  } finally {
    await fixture.service.waitForIdle();
    await fixture.registry.closeAll();
    fixture.catalog.close();
  }
});

test('旧 CRLF 和 CR revision 禁止在既有换行边界插入 LF', async () => {
  const legacyText = '第一章 雨夜\r\n甲乙\r第二章 清晨\r\n丙丁\r';
  const fixture = await createFixture(legacyText);
  try {
    await fixture.service.start(fixture.context, {});
    await fixture.service.waitForIdle();
    const current = fixture.service.getReviewSnapshot(fixture.context);
    const legacyStructure = analyzeNovelStructure(legacyText, current.source.sha256);
    const legacySnapshot = {
      ...current,
      textByteLength: Buffer.byteLength(legacyText),
      chapters: legacyStructure.chapters,
      coverage: legacyStructure.coverage,
    };
    const paths = readRevisionPaths(fixture.rootPath, current.revisionId);
    await writeFile(
      path.join(fixture.rootPath, ...paths.canonicalTextPath.split('/')),
      legacyText,
      'utf8',
    );
    const database = new DatabaseSync(path.join(fixture.rootPath, 'state/project.sqlite'));
    try {
      database.prepare(`
        UPDATE novel_import_revision SET review_snapshot_json = ? WHERE revision_id = ?
      `).run(JSON.stringify(legacySnapshot), current.revisionId);
    } finally {
      database.close();
    }

    const snapshot = fixture.service.getReviewSnapshot(fixture.context);
    const command = structureCommandFromSnapshot(snapshot);
    const firstCr = legacyText.indexOf('\r');
    const standaloneCr = legacyText.indexOf('\r', firstCr + 2);
    const newlineBoundaryPoints = [
      byteOffset(legacyText, firstCr),
      byteOffset(legacyText, firstCr + 1),
      byteOffset(legacyText, firstCr + 2),
      byteOffset(legacyText, standaloneCr),
      byteOffset(legacyText, standaloneCr + 1),
    ];
    for (const insertionPoint of newlineBoundaryPoints) {
      await assert.rejects(
        fixture.service.previewReview(fixture.context, {
          ...command,
          insertionPoints: [insertionPoint],
        }),
        (error: unknown) => isErrorCode(error, 'IPC_PAYLOAD_INVALID'),
      );
    }
  } finally {
    await fixture.service.waitForIdle();
    await fixture.registry.closeAll();
    fixture.catalog.close();
  }
});

test('结构命令允许零正文无标题章并由 Core 生成新 ID', async () => {
  const fixture = await createFixture();
  try {
    await fixture.service.start(fixture.context, {});
    await fixture.service.waitForIdle();
    const snapshot = fixture.service.getReviewSnapshot(fixture.context);
    const command = structureCommandFromSnapshot(snapshot);
    const insertionIndex = command.chapters[0]!.contentRange.endByte;
    const withEmptyChapter = {
      ...command,
      chapters: [
        command.chapters[0]!,
        {
          title: '未命名章节',
          headingKind: 'missing',
          contentRange: {
            offsetUnit: 'utf8-byte',
            startByte: insertionIndex,
            endByte: insertionIndex,
          },
          lengthAnomalyAccepted: false,
        },
        ...command.chapters.slice(1),
      ],
    } as const;
    await fixture.service.previewReview(fixture.context, withEmptyChapter);
    const updated = await fixture.service.applyReview(fixture.context, withEmptyChapter);
    const created = updated.chapters[1]!;
    assert.match(created.chapterId, /^chapter-[0-9a-f-]{36}$/u);
    assert.equal(created.headingKind, 'missing');
    assert.equal(created.headingRange, undefined);
    assert.equal(created.contentRange.startByte, created.contentRange.endByte);
  } finally {
    await fixture.service.waitForIdle();
    await fixture.registry.closeAll();
    fixture.catalog.close();
  }
});

test('删除章节识别后正文保持不变并持久化显式未归属范围', async () => {
  const fixture = await createFixture();
  try {
    await fixture.service.start(fixture.context, {});
    await fixture.service.waitForIdle();
    const snapshot = fixture.service.getReviewSnapshot(fixture.context);
    const baselineText = await readRevisionText(fixture.rootPath, snapshot.revisionId);
    const command = structureCommandFromSnapshot(snapshot);
    const remainingChapter = command.chapters[1]!;
    assert.ok(remainingChapter.headingRange);
    const unassignedRange = {
      offsetUnit: 'utf8-byte' as const,
      startByte: 0,
      endByte: remainingChapter.headingRange.startByte,
    };
    const deleteCommand = {
      ...command,
      chapters: [remainingChapter],
      unassignedRanges: [unassignedRange],
    } as const;
    await fixture.service.previewReview(fixture.context, deleteCommand);
    const updated = await fixture.service.applyReview(fixture.context, deleteCommand);

    assert.equal(await readRevisionText(fixture.rootPath, updated.revisionId), baselineText);
    assert.deepEqual(updated.coverage.uncoveredRanges, [unassignedRange]);
    assert.equal(updated.coverage.complete, false);
    const remaining = updated.chapters[0]!;
    assert.ok(remaining.headingRange);
    await assert.rejects(
      fixture.service.previewReview(fixture.context, {
        commandType: 'adjust-chapter-boundaries',
        baselineRevision: updated.baselineRevision,
        adjustments: [{
          chapterId: remaining.chapterId,
          headingRange: unassignedRange,
          contentRange: remaining.contentRange,
        }],
      }),
      (error: unknown) => isErrorCode(error, 'IPC_PAYLOAD_INVALID'),
    );
    const legacyAdjustment = {
      commandType: 'adjust-chapter-boundaries',
      baselineRevision: updated.baselineRevision,
      adjustments: [{
        chapterId: remaining.chapterId,
        headingRange: remaining.headingRange,
        contentRange: remaining.contentRange,
      }],
    } as const;
    await fixture.service.previewReview(fixture.context, legacyAdjustment);
    const afterLegacyAdjustment = await fixture.service.applyReview(
      fixture.context,
      legacyAdjustment,
    );
    assert.deepEqual(afterLegacyAdjustment.coverage.uncoveredRanges, [unassignedRange]);
    assert.equal(afterLegacyAdjustment.coverage.complete, false);
    const confirm = {
      commandType: 'confirm-review',
      baselineRevision: afterLegacyAdjustment.baselineRevision,
    } as const;
    await fixture.service.previewReview(fixture.context, confirm);
    const approved = await fixture.service.applyReview(fixture.context, confirm);
    assert.equal(approved.reviewStatus, 'approved');
    assert.equal(approved.coverage.complete, false);
    assert.deepEqual(approved.coverage.uncoveredRanges, [unassignedRange]);
    const bootstrap = await fixture.registry.getBootstrap(fixture.context);
    assert.equal(bootstrap.stages[0]?.status, 'completed');
    assert.equal(bootstrap.capabilities.proofreading.reason, 'not-implemented');
  } finally {
    await fixture.service.waitForIdle();
    await fixture.registry.closeAll();
    fixture.catalog.close();
  }
});

test('旧快照仅对缺失兼容字段补默认，显式 null 视为损坏', async () => {
  const fixture = await createFixture();
  try {
    await fixture.service.start(fixture.context, {});
    await fixture.service.waitForIdle();
    const snapshot = fixture.service.getReviewSnapshot(fixture.context);
    const database = new DatabaseSync(path.join(fixture.rootPath, 'state/project.sqlite'));
    try {
      database.prepare(`
        UPDATE novel_import_revision SET review_snapshot_json = ? WHERE revision_id = ?
      `).run(JSON.stringify({
        ...snapshot,
        chapters: snapshot.chapters.map((chapter, index) => index === 0
          ? { ...chapter, headingKind: null }
          : chapter),
      }), snapshot.revisionId);
    } finally {
      database.close();
    }
    assert.throws(
      () => fixture.service.getReviewSnapshot(fixture.context),
      (error: unknown) => isErrorCode(error, 'PROJECT_DATABASE_INVALID'),
    );
  } finally {
    await fixture.service.waitForIdle();
    await fixture.registry.closeAll();
    fixture.catalog.close();
  }
});

test('无章节时保持未覆盖并禁止确认', async () => {
  const fixture = await createFixture('这是一段没有章节标题的正文。\n');
  try {
    const task = await fixture.service.start(fixture.context, {});
    await fixture.service.waitForIdle();
    assert.equal(fixture.service.getTask(fixture.context, task.taskId).status, 'succeeded');
    const before = fixture.service.getReviewSnapshot(fixture.context);
    assert.equal(before.chapters.length, 0);
    assert.equal(before.coverage.complete, false);
    assert.deepEqual(before.coverage.uncoveredRanges, [{
      offsetUnit: 'utf8-byte',
      startByte: 0,
      endByte: before.textByteLength,
    }]);

    const command = {
      commandType: 'confirm-review',
      baselineRevision: before.baselineRevision,
    } as const;
    await fixture.service.previewReview(fixture.context, command);
    await assert.rejects(
      fixture.service.applyReview(fixture.context, command),
      (error: unknown) => isErrorCode(error, 'NOVEL_IMPORT_REVIEW_REQUIRED'),
    );
    assert.equal(fixture.service.getReviewSnapshot(fixture.context).revisionId, before.revisionId);
  } finally {
    await fixture.service.waitForIdle();
    await fixture.registry.closeAll();
    fixture.catalog.close();
  }
});

function structureCommandFromSnapshot(
  snapshot: ReturnType<NovelImportService['getReviewSnapshot']>,
) {
  return {
    commandType: 'update-chapter-structure' as const,
    baselineRevision: snapshot.baselineRevision,
    insertionPoints: [] as readonly number[],
    chapters: snapshot.chapters.map(chapter => ({
      existingChapterId: chapter.chapterId,
      title: chapter.title,
      headingKind: chapter.headingKind,
      ...(chapter.headingRange ? { headingRange: chapter.headingRange } : {}),
      contentRange: chapter.contentRange,
      lengthAnomalyAccepted: chapter.lengthAnomalyAccepted,
    })),
    unassignedRanges: [] as readonly Utf8TextRangeDto[],
  };
}

function byteOffset(text: string, characterOffset: number): number {
  return Buffer.byteLength(text.slice(0, characterOffset), 'utf8');
}

function byteRange(
  text: string,
  startCharacterOffset: number,
  endCharacterOffset: number,
): Utf8TextRangeDto {
  return {
    offsetUnit: 'utf8-byte',
    startByte: byteOffset(text, startCharacterOffset),
    endByte: byteOffset(text, endCharacterOffset),
  };
}

function readRevisionPaths(rootPath: string, revisionId: string) {
  const database = new DatabaseSync(path.join(rootPath, 'state/project.sqlite'), { readOnly: true });
  try {
    const row = database.prepare(`
      SELECT raw_text_path, canonical_text_path
      FROM novel_import_revision WHERE revision_id = ?
    `).get(revisionId) as {
      raw_text_path: string;
      canonical_text_path: string;
    };
    return {
      rawTextPath: row.raw_text_path,
      canonicalTextPath: row.canonical_text_path,
    };
  } finally {
    database.close();
  }
}

function addConsumerDependency(
  rootPath: string,
  producerRevisionId: string,
  consumerRevisionId: string,
): void {
  const database = new DatabaseSync(path.join(rootPath, 'state/project.sqlite'));
  try {
    database.prepare(`
      INSERT INTO artifact_revision (
        revision_id, artifact_id, artifact_type, lineage_id, storage_kind,
        content_path, content_hash, input_fingerprint, processor_id,
        processor_version, parameters_hash, execution_status, validity_status,
        review_status, created_at, created_by, metadata_json
      ) VALUES (?, 'proofreading:1', 'proofreading', 'proofreading:1', 'derived',
        'artifacts/proofreading/consumer.json', ?, ?, 'test-processor', '1', ?,
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
      ) VALUES ('update-dependency', ?, ?, 'chapter-selection', NULL)
    `).run(consumerRevisionId, producerRevisionId);
  } finally {
    database.close();
  }
}

function readStaleState(rootPath: string, consumerRevisionId: string) {
  const database = new DatabaseSync(path.join(rootPath, 'state/project.sqlite'), { readOnly: true });
  try {
    const consumer = database.prepare(`
      SELECT validity_status FROM artifact_revision WHERE revision_id = ?
    `).get(consumerRevisionId) as { validity_status: string };
    const revisionCount = database.prepare(`
      SELECT COUNT(*) AS value FROM novel_import_revision
    `).get() as { value: number };
    const cause = database.prepare(`
      SELECT previous_producer_revision_id, current_producer_revision_id
      FROM stale_cause WHERE consumer_revision_id = ?
    `).get(consumerRevisionId) as {
      previous_producer_revision_id: string;
      current_producer_revision_id: string;
    };
    return {
      revisionCount: revisionCount.value,
      validityStatus: consumer.validity_status,
      previousProducerRevisionId: cause.previous_producer_revision_id,
      currentProducerRevisionId: cause.current_producer_revision_id,
    };
  } finally {
    database.close();
  }
}

async function readRevisionText(rootPath: string, revisionId: string): Promise<string> {
  const { canonicalTextPath } = readRevisionPaths(rootPath, revisionId);
  return readFile(path.join(rootPath, ...canonicalTextPath.split('/')), 'utf8');
}

function isErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error
    && 'code' in error
    && error.code === code;
}
