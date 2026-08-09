import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const FIXTURE_ROOT = fileURLToPath(new URL('./fixtures/', import.meta.url));
const MANIFEST_PATH = path.join(FIXTURE_ROOT, 'manifest.json');
const GOLDEN_DATASET_EVIDENCE_PATH = fileURLToPath(
  new URL('../../../docs/validation/m1-golden-dataset.md', import.meta.url),
);
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const UUID_V4_PATTERN
  = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const REQUIRED_PURPOSES = new Set([
  'utf8-bom',
  'crlf',
  'lf',
  'chinese-numeral-chapters',
  'volume-local-renumbering',
  'preface-epilogue',
  'duplicate-title',
  'empty-chapter',
  'inline-chapter-false-positive',
  'duplicate-paragraph',
  'invalid-bytes',
  'unsupported-epub',
  'reimport-unchanged',
  'reimport-head-insert',
  'reimport-single-block-modified',
  'reimport-content-restored',
]);
const IMPORT_ERROR_CODES = new Set([
  'NOVEL_IMPORT_UNSUPPORTED_FORMAT',
  'NOVEL_IMPORT_INVALID_SOURCE',
  'NOVEL_IMPORT_ENCODING_REQUIRED',
  'NOVEL_IMPORT_STRUCTURE_INVALID',
  'NOVEL_IMPORT_REVIEW_REQUIRED',
  'NOVEL_IMPORT_STALE_SESSION',
  'NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE',
  'NOVEL_IMPORT_RESOURCE_LIMIT_EXCEEDED',
  'NOVEL_IMPORT_BUDGET_INVALID',
]);

test('validates the M1-D08 manifest, hashes, paths, and registration closure', async () => {
  const dataset = await loadDataset();
  assertManifestSchema(dataset.manifest);

  const fixtureIds = new Set();
  const inputPaths = new Set();
  const expectedPaths = new Set();
  const registeredPaths = new Set(['README.md', 'manifest.json']);
  const purposes = new Set();

  for (const fixture of dataset.manifest.fixtures) {
    assert.equal(fixtureIds.has(fixture.fixtureId), false);
    fixtureIds.add(fixture.fixtureId);
    assert.equal(inputPaths.has(fixture.input.relativePath), false);
    inputPaths.add(fixture.input.relativePath);
    assert.equal(expectedPaths.has(fixture.expected.relativePath), false);
    expectedPaths.add(fixture.expected.relativePath);
    for (const purpose of fixture.purpose)
      purposes.add(purpose);

    for (const relativePath of [
      fixture.input.relativePath,
      fixture.expected.relativePath,
      fixture.licenseEvidence.relativePath,
    ]) {
      assertSafeRelativePath(relativePath);
      registeredPaths.add(relativePath);
    }

    const inputBytes = await readFixtureBytes(fixture.input.relativePath);
    assert.equal(inputBytes.byteLength, fixture.input.byteLength);
    assert.equal(sha256(inputBytes), fixture.input.sha256);

    const expectedBytes = await readFixtureBytes(fixture.expected.relativePath);
    assert.equal(sha256(expectedBytes), fixture.expected.sha256);
    const expected = JSON.parse(expectedBytes.toString('utf8'));
    assert.equal(expected.fixtureExpectedSchemaVersion, 1);
    assert.equal(expected.fixtureId, fixture.fixtureId);
    assertNoLeakedPaths(expected);

    const evidenceBytes = await readFixtureBytes(
      fixture.licenseEvidence.relativePath,
    );
    assert.equal(sha256(evidenceBytes), fixture.licenseEvidence.sha256);
    const licenseEvidence = evidenceBytes.toString('utf8');
    assert.match(licenseEvidence, /created specifically for automated testing/u);
    assertNoLeakedPaths(licenseEvidence);
  }

  for (const purpose of REQUIRED_PURPOSES)
    assert.equal(purposes.has(purpose), true, `Missing fixture purpose ${purpose}`);

  assert.equal(
    computeDatasetHash(dataset.manifest.fixtures),
    dataset.manifest.datasetContentHash,
  );
  assertNoLeakedPaths(dataset.manifest);

  const [fixtureReadme, goldenDatasetEvidence] = await Promise.all([
    readFile(path.join(FIXTURE_ROOT, 'README.md'), 'utf8'),
    readFile(GOLDEN_DATASET_EVIDENCE_PATH, 'utf8'),
  ]);
  assertNoLeakedPaths(fixtureReadme);
  assertNoLeakedPaths(goldenDatasetEvidence);

  const actualPaths = new Set(await listFixtureFiles(FIXTURE_ROOT));
  assert.deepEqual([...actualPaths].sort(), [...registeredPaths].sort());
});

test('keeps successful expected data aligned with bytes and M1-02 invariants', async () => {
  const dataset = await loadDataset();
  for (const item of dataset.items.filter(item => item.expected.result.status === 'success')) {
    const { fixture, inputBytes, expected } = item;
    assertSuccessExpectedShape(expected);
    const { importedNovel, chapterIndex } = expected;

    assert.equal(importedNovel.sourceHash, fixture.input.sha256);
    assert.equal(importedNovel.sourceByteLength, fixture.input.byteLength);
    assert.equal(importedNovel.rawTextRevision.contentHash, fixture.input.sha256);
    assert.equal(importedNovel.rawTextRevision.byteLength, fixture.input.byteLength);
    assert.deepEqual(
      expected.blockOrder,
      importedNovel.orderedBlocks.map(block => block.blockId),
    );
    assert.equal(new Set(expected.blockOrder).size, expected.blockOrder.length);

    let sourceCursor = 0;
    const aggregateHash = createHash('sha256');
    for (const [index, block] of importedNovel.orderedBlocks.entries()) {
      assert.match(block.blockId, UUID_V4_PATTERN);
      assert.match(block.contentHash, SHA256_PATTERN);
      const locator = block.sourceLocator;
      assert.equal(locator.sourceAssetId, importedNovel.sourceAssetId);
      assert.equal(locator.sourceContentHash, importedNovel.sourceHash);
      assert.equal(locator.sourceEncoding, 'utf-8');
      assert.equal(locator.sourceByteRange.startByte, sourceCursor);
      assert.equal(locator.rawTextRange.startByte, sourceCursor);
      assert.equal(locator.sourceByteRange.endByte, locator.rawTextRange.endByte);
      const blockBytes = Buffer.from(block.rawText, 'utf8');
      assert.equal(
        blockBytes.byteLength,
        locator.rawTextRange.endByte - locator.rawTextRange.startByte,
      );
      assert.deepEqual(
        inputBytes.subarray(
          locator.sourceByteRange.startByte,
          locator.sourceByteRange.endByte,
        ),
        blockBytes,
      );
      assert.equal(sha256(blockBytes), block.contentHash);
      aggregateHash.update(blockBytes);
      sourceCursor = locator.sourceByteRange.endByte;
      assert.deepEqual(expected.utf8ByteRanges[index], {
        blockId: block.blockId,
        range: locator.rawTextRange,
      });
    }
    assert.equal(sourceCursor, inputBytes.byteLength);
    assert.equal(aggregateHash.digest('hex'), importedNovel.rawTextRevision.contentHash);

    const rawText = importedNovel.orderedBlocks.map(block => block.rawText).join('');
    const canonicalText = canonicalize(rawText);
    const canonicalBytes = Buffer.from(canonicalText, 'utf8');
    assert.equal(chapterIndex.textRevision.byteLength, canonicalBytes.byteLength);
    assert.equal(chapterIndex.textRevision.contentHash, sha256(canonicalBytes));
    assert.equal(chapterIndex.sourceHash, importedNovel.sourceHash);
    assert.equal(chapterIndex.sourceAssetId, importedNovel.sourceAssetId);

    assert.deepEqual(
      expected.chapterRanges,
      chapterIndex.entries.map(entry => ({
        chapterId: entry.chapterId,
        headingRange: entry.headingRange,
        contentRange: entry.contentRange,
      })),
    );
    assert.deepEqual(expected.issues, chapterIndex.issues);
    assertCoverage(chapterIndex);
    assert.equal(expected.classification.coveragePercent, 100);
    assert.equal(
      expected.classification.classifiedByteLength,
      expected.classification.totalByteLength,
    );
    assert.deepEqual(
      expected.classification.segments,
      chapterIndex.coverageReport.segments,
    );
  }
});

test('freezes structural edge cases and opaque error fixtures', async () => {
  const dataset = await loadDataset();
  const comprehensive = dataset.byId.get('synthetic-comprehensive-bom-crlf');
  assert.ok(comprehensive);
  assert.deepEqual(
    [...comprehensive.inputBytes.subarray(0, 3)],
    [0xEF, 0xBB, 0xBF],
  );
  assert.equal(comprehensive.inputBytes.includes(Buffer.from('\r\n')), true);
  const comprehensiveIndex = comprehensive.expected.chapterIndex;
  assert.equal(
    comprehensiveIndex.entries.some(entry => entry.title === '前言'),
    true,
  );
  assert.equal(
    comprehensiveIndex.entries.some(entry => entry.title === '尾声'),
    true,
  );
  assert.equal(
    comprehensiveIndex.entries.some(entry => entry.contentRange.startByte
      === entry.contentRange.endByte),
    true,
  );
  assert.equal(
    comprehensiveIndex.entries.some(entry => entry.volumeNumber === '1'
      && entry.chapterNumber === '1'),
    true,
  );
  assert.equal(
    comprehensiveIndex.entries.some(entry => entry.volumeNumber === '2'
      && entry.chapterNumber === '1'),
    true,
  );
  assert.deepEqual(
    new Set(comprehensive.expected.issues.map(issue => issue.code)),
    new Set([
      'duplicate_chapter_title',
      'empty_chapter',
      'probable_duplicate_content',
      'chapter_heading_false_positive',
    ]),
  );
  assert.equal(
    comprehensiveIndex.candidates.some(candidate => candidate.reviewStatus === 'rejected'
      && candidate.ruleId === 'm1-synthetic-inline-heading-rejection'),
    true,
  );

  const lf = dataset.byId.get('reimport-base-lf');
  assert.ok(lf);
  assert.equal(lf.inputBytes.includes(Buffer.from('\n')), true);
  assert.equal(lf.inputBytes.includes(Buffer.from('\r')), false);

  const invalid = dataset.byId.get('invalid-utf8-byte-sequence');
  assert.ok(invalid);
  assert.throws(
    () => new TextDecoder('utf-8', { fatal: true }).decode(invalid.inputBytes),
    TypeError,
  );
  assertErrorExpected(
    invalid,
    'NOVEL_IMPORT_ENCODING_REQUIRED',
    'opaque-hash-and-encoding-probe-only',
  );

  const epub = dataset.byId.get('unsupported-epub-opaque');
  assert.ok(epub);
  assert.equal(epub.inputBytes.subarray(0, 2).equals(Buffer.from('PK')), false);
  assertErrorExpected(
    epub,
    'NOVEL_IMPORT_UNSUPPORTED_FORMAT',
    'opaque-hash-only-no-container-open',
  );
});

test('freezes unchanged, head insert, local modification, and restoration mappings', async () => {
  const dataset = await loadDataset();
  const base = dataset.byId.get('reimport-base-lf');
  const unchanged = dataset.byId.get('reimport-unchanged');
  const headInsert = dataset.byId.get('reimport-head-insert');
  const modified = dataset.byId.get('reimport-single-block-modified');
  const restored = dataset.byId.get('reimport-content-restored');
  assert.ok(base && unchanged && headInsert && modified && restored);

  assert.equal(unchanged.fixture.input.sha256, base.fixture.input.sha256);
  assert.equal(restored.fixture.input.sha256, base.fixture.input.sha256);
  assert.notEqual(headInsert.fixture.input.sha256, base.fixture.input.sha256);
  assert.notEqual(modified.fixture.input.sha256, base.fixture.input.sha256);
  assert.deepEqual(unchanged.expected.blockOrder, base.expected.blockOrder);
  assert.deepEqual(restored.expected.blockOrder, base.expected.blockOrder);

  const headRelationship = headInsert.expected.reimportExpectation;
  assert.deepEqual(headRelationship.stableBlockIds, base.expected.blockOrder);
  assert.equal(headRelationship.insertedBlockIds.length, 1);
  assert.deepEqual(
    headInsert.expected.blockOrder.filter(
      blockId => base.expected.blockOrder.includes(blockId),
    ),
    base.expected.blockOrder,
  );

  const modifiedRelationship = modified.expected.reimportExpectation;
  assert.equal(modifiedRelationship.changedBlocks.length, 1);
  assert.equal(
    modifiedRelationship.stableBlockIds.length,
    base.expected.blockOrder.length - 1,
  );
  assert.equal(
    modifiedRelationship.changedBlocks[0].beforeBlockId
    === modifiedRelationship.changedBlocks[0].afterBlockId,
    false,
  );
  assert.equal(
    restored.expected.reimportExpectation.restoredFromFixtureId,
    modified.fixture.fixtureId,
  );

  const sourceAssetIds = new Set([
    base,
    unchanged,
    headInsert,
    modified,
    restored,
  ].map(item => item.expected.importedNovel.sourceAssetId));
  assert.equal(sourceAssetIds.size, 1);
});

async function loadDataset() {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
  const items = [];
  const byId = new Map();
  for (const fixture of manifest.fixtures) {
    const inputBytes = await readFixtureBytes(fixture.input.relativePath);
    const expected = JSON.parse(
      await readFile(path.join(FIXTURE_ROOT, fixture.expected.relativePath), 'utf8'),
    );
    const item = { fixture, inputBytes, expected };
    items.push(item);
    byId.set(fixture.fixtureId, item);
  }
  return { manifest, items, byId };
}

function assertManifestSchema(manifest) {
  assertObjectKeys(manifest, [
    'datasetContentHash',
    'datasetContentHashAlgorithm',
    'datasetVersion',
    'fixtures',
    'hashAlgorithm',
    'schemaVersion',
  ]);
  assert.equal(manifest.schemaVersion, 1);
  assert.match(manifest.datasetVersion, /^\d+\.\d+\.\d+$/u);
  assert.equal(manifest.hashAlgorithm, 'sha256');
  assert.equal(
    manifest.datasetContentHashAlgorithm,
    'sha256-nul-delimited-fixture-records-v1',
  );
  assert.match(manifest.datasetContentHash, SHA256_PATTERN);
  assert.equal(Array.isArray(manifest.fixtures), true);
  assert.ok(manifest.fixtures.length > 0);

  for (const fixture of manifest.fixtures) {
    assertObjectKeys(fixture, [
      'applicableSchemaVersions',
      'expected',
      'fixtureId',
      'generator',
      'input',
      'licenseEvidence',
      'licenseExpression',
      'provenanceKind',
      'purpose',
    ]);
    assert.match(fixture.fixtureId, /^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
    assert.ok(Array.isArray(fixture.purpose) && fixture.purpose.length > 0);
    assert.equal(new Set(fixture.purpose).size, fixture.purpose.length);
    assertObjectKeys(fixture.input, [
      'byteLength',
      'mediaType',
      'relativePath',
      'sha256',
    ]);
    assert.ok(Number.isSafeInteger(fixture.input.byteLength));
    assert.ok(fixture.input.byteLength > 0);
    assert.match(fixture.input.sha256, SHA256_PATTERN);
    assert.ok(typeof fixture.input.mediaType === 'string');
    assert.equal(fixture.provenanceKind, 'synthetic');
    assertObjectKeys(fixture.generator, ['id', 'seed', 'version']);
    assert.ok(fixture.generator.id.length > 0);
    assert.ok(fixture.generator.version.length > 0);
    assert.ok(fixture.generator.seed.length > 0);
    assert.equal(fixture.licenseExpression, 'CC0-1.0');
    assertObjectKeys(fixture.licenseEvidence, ['relativePath', 'sha256']);
    assert.match(fixture.licenseEvidence.sha256, SHA256_PATTERN);
    assertObjectKeys(fixture.expected, ['relativePath', 'sha256']);
    assert.match(fixture.expected.sha256, SHA256_PATTERN);
    assert.deepEqual(fixture.applicableSchemaVersions, {
      fixtureExpected: 1,
      novelImport: 1,
      textReference: 1,
    });
  }
}

function assertSuccessExpectedShape(expected) {
  assert.equal(expected.fixtureExpectedSchemaVersion, 1);
  assert.deepEqual(expected.result, { status: 'success' });
  assert.equal(expected.inputHandling, 'decode-and-structure');
  assert.equal(Array.isArray(expected.blockOrder), true);
  assert.equal(Array.isArray(expected.utf8ByteRanges), true);
  assert.equal(Array.isArray(expected.chapterRanges), true);
  assert.equal(Array.isArray(expected.issues), true);
  assert.ok(expected.importedNovel && expected.chapterIndex);
}

function assertCoverage(chapterIndex) {
  const { coverageReport, entries, textRevision } = chapterIndex;
  assert.equal(coverageReport.complete, true);
  assert.equal(coverageReport.totalByteLength, textRevision.byteLength);
  assert.equal(coverageReport.classifiedByteLength, textRevision.byteLength);
  assert.equal(coverageReport.unclassifiedByteLength, 0);
  assert.deepEqual(coverageReport.unclassifiedRanges, []);

  let cursor = 0;
  const coveredChapterIds = new Set();
  const entriesById = new Map(entries.map(entry => [entry.chapterId, entry]));
  for (const segment of coverageReport.segments) {
    assert.equal(segment.range.startByte, cursor);
    assert.ok(segment.range.endByte > segment.range.startByte);
    assert.equal(segment.range.textRevisionId, textRevision.textRevisionId);
    assert.equal(segment.range.textLayer, 'canonical');
    if (segment.classification === 'chapter') {
      const entry = entriesById.get(segment.chapterId);
      assert.ok(entry);
      assert.deepEqual(segment.range, {
        ...entry.headingRange,
        endByte: entry.contentRange.endByte,
      });
      assert.equal(coveredChapterIds.has(segment.chapterId), false);
      coveredChapterIds.add(segment.chapterId);
    }
    cursor = segment.range.endByte;
  }
  assert.equal(cursor, textRevision.byteLength);
  assert.equal(coveredChapterIds.size, entries.length);
}

function assertErrorExpected(item, errorCode, inputHandling) {
  const { fixture, inputBytes, expected } = item;
  assert.deepEqual(expected.result, {
    status: 'error',
    errorCode,
    detailReason: expected.result.detailReason,
  });
  assert.equal(IMPORT_ERROR_CODES.has(errorCode), true);
  assert.equal(expected.inputHandling, inputHandling);
  assert.deepEqual(expected.blockOrder, []);
  assert.deepEqual(expected.utf8ByteRanges, []);
  assert.deepEqual(expected.chapterRanges, []);
  assert.equal(expected.importedNovel, undefined);
  assert.equal(expected.chapterIndex, undefined);
  assert.equal(expected.classification.unit, 'source-byte');
  assert.equal(expected.classification.totalByteLength, inputBytes.byteLength);
  assert.equal(expected.classification.classifiedByteLength, inputBytes.byteLength);
  assert.equal(expected.classification.coveragePercent, 100);
  assert.deepEqual(expected.classification.segments, [{
    classification: 'unknown',
    startByte: 0,
    endByte: fixture.input.byteLength,
  }]);
  assert.equal(expected.issues.length, 1);
  assert.equal(expected.issues[0].errorCode, errorCode);
}

function assertObjectKeys(value, expectedKeys) {
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), [...expectedKeys].sort());
}

function assertSafeRelativePath(relativePath) {
  assert.ok(typeof relativePath === 'string' && relativePath.length > 0);
  assert.equal(path.posix.isAbsolute(relativePath), false);
  assert.equal(path.win32.isAbsolute(relativePath), false);
  assert.equal(relativePath.includes('\\'), false);
  assert.equal(relativePath.split('/').includes('..'), false);
  assert.equal(path.posix.normalize(relativePath), relativePath);
}

function assertNoLeakedPaths(value) {
  if (typeof value === 'string') {
    const unixAbsolutePath
      = /(?:^|[\s"'`([{])\/(?!\/)[^\s"'`\])}]*/u;
    const windowsAbsolutePath
      = /(?:^|[\s"'`([{])(?:[A-Za-z]:[\\/]|\\\\)[^\s"'`\])}]*/u;
    const fileUri = /file:\/\//iu;
    const temporaryPath = /(?:^|[\s"'`([{])(?:~\/|\.\.\/|(?:tmp|temp)\/|(?:private\/)?var\/folders\/)[^\s"'`\])}]*/iu;
    assert.equal(unixAbsolutePath.test(value), false);
    assert.equal(windowsAbsolutePath.test(value), false);
    assert.equal(fileUri.test(value), false);
    assert.equal(temporaryPath.test(value), false);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value)
      assertNoLeakedPaths(item);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const nested of Object.values(value))
      assertNoLeakedPaths(nested);
  }
}

async function listFixtureFiles(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = prefix.length === 0
      ? entry.name
      : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...await listFixtureFiles(
        path.join(directory, entry.name),
        relativePath,
      ));
    } else {
      files.push(relativePath);
    }
  }
  return files;
}

async function readFixtureBytes(relativePath) {
  return readFile(path.join(FIXTURE_ROOT, relativePath));
}

function computeDatasetHash(fixtures) {
  const hash = createHash('sha256');
  for (const fixture of fixtures) {
    hash.update(fixture.fixtureId, 'utf8');
    hash.update('\0', 'utf8');
    hash.update(fixture.input.sha256, 'utf8');
    hash.update('\0', 'utf8');
    hash.update(fixture.expected.sha256, 'utf8');
    hash.update('\0', 'utf8');
    hash.update(fixture.licenseEvidence.sha256, 'utf8');
    hash.update('\n', 'utf8');
  }
  return hash.digest('hex');
}

function canonicalize(rawText) {
  const withoutBom = rawText.startsWith('\uFEFF') ? rawText.slice(1) : rawText;
  return withoutBom.replace(/\r\n|\r/g, '\n');
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
