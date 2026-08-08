import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canonicalizeJson,
  computeInputFingerprint,
  selectorsIntersect,
  sha256CanonicalJson,
} from '../dist/index.js';

test('canonicalizes JSON independent of object key insertion order', () => {
  const left = { z: [3, { b: true, a: 'x' }], a: 1 };
  const right = { a: 1, z: [3, { a: 'x', b: true }] };

  assert.equal(canonicalizeJson(left), canonicalizeJson(right));
  assert.equal(sha256CanonicalJson(left), sha256CanonicalJson(right));
  assert.notEqual(sha256CanonicalJson(left), sha256CanonicalJson({ ...right, a: 2 }));
});

test('rejects non-finite values and cyclic canonical JSON', () => {
  assert.throws(() => canonicalizeJson({ value: Number.NaN }), TypeError);
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => canonicalizeJson(cyclic), TypeError);
});

test('computes stable input fingerprints from direct provenance', () => {
  const descriptor = {
    compatibilityVersion: '1',
    dependencies: [{
      artifactId: 'artifact-a',
      revisionId: 'revision-a',
      contentHash: 'a'.repeat(64),
      selector: { chapterIds: ['chapter-1'] },
    }],
    parameters: { temperature: 0 },
    processorId: 'processor',
    processorVersion: '1',
    ruleVersions: { dictionary: '3' },
  };

  assert.match(computeInputFingerprint(descriptor), /^[0-9a-f]{64}$/u);
  assert.equal(
    computeInputFingerprint(descriptor),
    computeInputFingerprint({ ...descriptor }),
  );
  const secondDependency = {
    artifactId: 'artifact-b',
    revisionId: 'revision-b',
    contentHash: 'b'.repeat(64),
    selector: { chapterIds: ['chapter-2', 'chapter-1'] },
  };
  assert.equal(
    computeInputFingerprint({
      ...descriptor,
      dependencies: [...descriptor.dependencies, secondDependency],
    }),
    computeInputFingerprint({
      ...descriptor,
      dependencies: [
        { ...secondDependency, selector: { chapterIds: ['chapter-1', 'chapter-2'] } },
        ...descriptor.dependencies,
      ],
    }),
  );
});

test('intersects stable selectors conservatively by shared dimensions', () => {
  assert.equal(selectorsIntersect(undefined, { chapterIds: ['c1'] }), true);
  assert.equal(
    selectorsIntersect(
      { chapterIds: ['c1'], blockIds: ['b1'] },
      { chapterIds: ['c1'] },
    ),
    true,
  );
  assert.equal(
    selectorsIntersect({ chapterIds: ['c1'] }, { chapterIds: ['c2'] }),
    false,
  );
  assert.equal(
    selectorsIntersect({ blockIds: ['b1'] }, { chapterIds: ['c1'] }),
    true,
  );
});
