import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildNovelImportImpactSelectorsV1,
  selectNovelImportAffectedConsumersV1,
} from '../dist/index.js';

test('projects current reimport IDs into deterministic non-empty selectors', () => {
  const plan = fullReimportPlan({
    content: affected({
      currentBlockIds: ['block-2', 'block-1', 'block-2'],
      currentChapterIds: ['chapter-2', 'chapter-1'],
      previousBlockIds: ['old-block'],
      previousChapterIds: ['old-chapter'],
    }),
    structure: affected({
      currentChapterIds: ['chapter-3'],
    }),
    display: affected({
      currentChapterIds: ['chapter-4'],
    }),
  });
  const before = structuredClone(plan);

  const selectors = buildNovelImportImpactSelectorsV1(plan);

  assert.deepEqual(selectors, [
    {
      changeScope: 'content',
      selector: {
        chapterIds: ['chapter-1', 'chapter-2'],
        blockIds: ['block-1', 'block-2'],
      },
    },
    {
      changeScope: 'structure',
      selector: { chapterIds: ['chapter-3'] },
    },
    {
      changeScope: 'display',
      selector: { chapterIds: ['chapter-4'] },
    },
  ]);
  assert.deepEqual(plan, before);
  assert.equal(Object.isFrozen(selectors), true);
  assert.equal(Object.isFrozen(selectors[0].selector.chapterIds), true);
});

test('selects intersecting consumers and excludes unrelated consumers', () => {
  const selectors = buildNovelImportImpactSelectorsV1(fullReimportPlan({
    content: affected({
      currentBlockIds: ['block-1'],
      currentChapterIds: ['chapter-1'],
    }),
  }));
  const consumers = [
    consumer('consumer-match', [
      subscription('content', {
        chapterIds: ['chapter-1'],
        blockIds: ['block-1'],
      }),
    ]),
    consumer('consumer-other-block', [
      subscription('content', { blockIds: ['block-2'] }),
    ]),
    consumer('consumer-other-chapter', [
      subscription('content', { chapterIds: ['chapter-2'] }),
    ]),
  ];

  assert.deepEqual(selectNovelImportAffectedConsumersV1(selectors, consumers), [
    {
      consumerArtifactId: 'consumer-match',
      consumerRevisionId: 'consumer-match-revision',
      matchedChangeScopes: ['content'],
    },
  ]);
});

test('requires an explicit display subscription for title-only changes', () => {
  const selectors = buildNovelImportImpactSelectorsV1(fullReimportPlan({
    display: affected({ currentChapterIds: ['chapter-title'] }),
  }));
  const consumers = [
    consumer('audio-content', [
      subscription('content', { chapterIds: ['chapter-title'] }),
    ]),
    consumer('title-export', [
      subscription('display', { chapterIds: ['chapter-title'] }),
    ]),
  ];

  assert.deepEqual(selectNovelImportAffectedConsumersV1(selectors, consumers), [
    {
      consumerArtifactId: 'title-export',
      consumerRevisionId: 'title-export-revision',
      matchedChangeScopes: ['display'],
    },
  ]);
});

test('treats multiple consumer selectors as OR and shared dimensions as AND', () => {
  const selectors = buildNovelImportImpactSelectorsV1(fullReimportPlan({
    content: affected({
      currentBlockIds: ['block-hit'],
      currentChapterIds: ['chapter-hit'],
    }),
    structure: affected({ currentChapterIds: ['chapter-structure'] }),
  }));
  const consumers = [
    consumer('consumer-or', [
      subscription('content', {
        chapterIds: ['chapter-miss'],
        blockIds: ['block-hit'],
      }),
      subscription('content', { chapterIds: ['chapter-hit'] }),
    ]),
    consumer('a-structure-consumer', [
      subscription('structure', { chapterIds: ['chapter-structure'] }),
    ]),
    consumer('consumer-or', [
      subscription('structure', { chapterIds: ['chapter-structure'] }),
    ]),
    consumer('consumer-and-miss', [
      subscription('content', {
        chapterIds: ['chapter-miss'],
        blockIds: ['block-hit'],
      }),
    ]),
  ];

  assert.deepEqual(selectNovelImportAffectedConsumersV1(selectors, consumers), [
    {
      consumerArtifactId: 'a-structure-consumer',
      consumerRevisionId: 'a-structure-consumer-revision',
      matchedChangeScopes: ['structure'],
    },
    {
      consumerArtifactId: 'consumer-or',
      consumerRevisionId: 'consumer-or-revision',
      matchedChangeScopes: ['content', 'structure'],
    },
  ]);
});

test('omits empty impact without changing consumer or stale-like input state', () => {
  const plan = deepFreeze(fullReimportPlan());
  const consumers = deepFreeze([
    {
      ...consumer('consumer-current', [subscription('content')]),
      validityStatus: 'current',
      staleCauses: [],
    },
  ]);
  const before = structuredClone(consumers);

  const selectors = buildNovelImportImpactSelectorsV1(plan);
  const affectedConsumers = selectNovelImportAffectedConsumersV1(
    selectors,
    consumers,
  );

  assert.deepEqual(selectors, []);
  assert.deepEqual(affectedConsumers, []);
  assert.deepEqual(consumers, before);
  assert.equal(consumers[0].validityStatus, 'current');
  assert.deepEqual(consumers[0].staleCauses, []);
});

function fullReimportPlan(changes = {}) {
  return {
    documentType: 'novel-reimport-plan',
    schemaVersion: 1,
    previousTextRevisionId: 'previous-text',
    currentTextRevisionId: 'current-text',
    preservedBlockIds: [],
    preservedChapters: [],
    ambiguities: [],
    changes: {
      content: affected(changes.content),
      structure: affected(changes.structure),
      display: affected(changes.display),
    },
    reviewStatus: 'not_required',
  };
}

function affected(overrides = {}) {
  return {
    previousBlockIds: [],
    currentBlockIds: [],
    previousChapterIds: [],
    currentChapterIds: [],
    ...overrides,
  };
}

function consumer(consumerArtifactId, subscriptions) {
  return {
    consumerArtifactId,
    consumerRevisionId: `${consumerArtifactId}-revision`,
    subscriptions,
  };
}

function subscription(changeScope, selector) {
  return {
    changeScope,
    ...(selector === undefined ? {} : { selector }),
  };
}

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const nested of Object.values(value))
      deepFreeze(nested);
  }
  return value;
}
