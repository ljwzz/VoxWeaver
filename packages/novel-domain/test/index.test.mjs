import assert from 'node:assert/strict';
import test from 'node:test';

import * as packageEntry from '../dist/index.js';

test('exposes the completed M1-16A novel domain runtime API', () => {
  assert.deepEqual(Object.keys(packageEntry), [
    'ChapterIndexDomainValidationError',
    'DOCUMENT_BLOCK_INDEX_SCHEMA_VERSION',
    'DocumentBlockIndexValidationError',
    'NOVEL_REIMPORT_PLAN_SCHEMA_VERSION',
    'NovelReimportPlanValidationError',
    'SceneIndexDomainValidationError',
    'alignDocumentBlockIndexV1',
    'buildNovelReimportPlanV1',
    'getChapterCoverageRatioV1',
    'validateChapterIndexDomainV1',
    'validateDocumentBlockIndexV1',
    'validateSceneIndexDomainV1',
  ]);
});
