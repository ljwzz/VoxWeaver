import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifySourceAssetCommitAttempt,
  getSourceAssetCommitIdentity,
  getSourceAssetCommitIntent,
  isSourceAssetCommitErrorCode,
  parseSourceAssetCommitCommand,
  SOURCE_ASSET_COMMIT_ERROR_CODES,
  SourceAssetCommitError,
} from '../dist/index.js';

const SOURCE_ASSET_ID = '11111111-1111-4111-8111-111111111111';
const CONTENT_HASH = 'a'.repeat(64);

function command(overrides = {}) {
  return {
    temporarySource: { relativePath: 'tmp/import-1/source.txt' },
    expectedContentHash: CONTENT_HASH,
    expectedByteLength: 12,
    originalName: '小说.txt',
    sourceType: 'txt',
    createdBy: 'operator-1',
    idempotencyKey: 'import-request-1',
    ...overrides,
  };
}

function sourceAssetRecord() {
  return {
    sourceAssetId: SOURCE_ASSET_ID,
    sourceType: 'txt',
    originalName: '小说.txt',
    contentHash: CONTENT_HASH,
    relativePath: `inputs/${SOURCE_ASSET_ID}/source.txt`,
    createdAt: '2026-08-09T00:00:00.000Z',
    createdBy: 'operator-1',
  };
}

test('accepts a complete immutable SourceAsset commit command', () => {
  const value = command();

  assert.equal(parseSourceAssetCommitCommand(value), value);
  assert.equal(value.temporarySource.relativePath.startsWith('tmp/'), true);
  assert.equal('projectDirectory' in value, false);
});

test('returns the registered SourceAsset record from a port implementation', async () => {
  const record = sourceAssetRecord();
  const port = {
    async commitSourceAsset(value) {
      parseSourceAssetCommitCommand(value);
      return record;
    },
  };

  assert.equal(await port.commitSourceAsset(command()), record);
});

test('rejects missing or malformed expected content identity', () => {
  const withoutHash = command();
  delete withoutHash.expectedContentHash;
  const invalid = [
    withoutHash,
    command({ expectedContentHash: CONTENT_HASH.toUpperCase() }),
    command({ expectedContentHash: 'not-a-hash' }),
    command({ expectedByteLength: -1 }),
    command({ expectedByteLength: Number.MAX_SAFE_INTEGER + 1 }),
  ];

  for (const value of invalid) {
    assert.throws(
      () => parseSourceAssetCommitCommand(value),
      error => (
        error instanceof SourceAssetCommitError
        && error.code === 'SOURCE_ASSET_COMMIT_COMMAND_INVALID'
      ),
    );
  }
});

test('rejects unsafe temporary paths and non-relative original names', () => {
  const nonEnumerableExtra = command();
  Object.defineProperty(nonEnumerableExtra, 'absolutePath', {
    value: '/project/root/tmp/import-1/source.txt',
  });
  const symbolExtra = command();
  Object.defineProperty(symbolExtra, Symbol('absolutePath'), {
    value: '/project/root/tmp/import-1/source.txt',
  });
  const unusualPrototype = Object.assign(
    Object.create({ projectDirectory: '/project/root' }),
    command(),
  );
  const invalid = [
    command({ temporarySource: { relativePath: '../source.txt' } }),
    command({ temporarySource: { relativePath: '/tmp/source.txt' } }),
    command({ temporarySource: { relativePath: 'inputs/source.txt' } }),
    command({ temporarySource: { relativePath: 'tmp/../source.txt' } }),
    command({ temporarySource: { relativePath: 'tmp\\source.txt' } }),
    command({ temporarySource: { relativePath: 'tmp/chapter?.txt' } }),
    command({ temporarySource: { relativePath: 'tmp/trailing.' } }),
    command({ temporarySource: { relativePath: 'tmp/trailing ' } }),
    command({ temporarySource: { relativePath: 'tmp/CON' } }),
    command({ temporarySource: { relativePath: 'tmp/aux.txt' } }),
    command({ temporarySource: { relativePath: 'tmp/COM9.log' } }),
    command({ temporarySource: { relativePath: 'tmp/LPT1' } }),
    ...Array.from('<>:"|?*', character => command({
      temporarySource: { relativePath: `tmp/novel${character}.txt` },
    })),
    command({ originalName: '../novel.txt' }),
    command({ originalName: 'folder/novel.txt' }),
    command({ originalName: 'C:novel.txt' }),
    command({ originalName: 'novel*.txt' }),
    command({ originalName: 'novel.txt.' }),
    command({ originalName: 'NUL.txt' }),
    command({ originalName: 'prn.DAT' }),
    ...Array.from('<>:"|?*', character => command({
      originalName: `novel${character}.txt`,
    })),
    command({ projectDirectory: '/project/root' }),
    command({
      temporarySource: {
        relativePath: 'tmp/import-1/source.txt',
        absolutePath: '/project/root/tmp/import-1/source.txt',
      },
    }),
    nonEnumerableExtra,
    symbolExtra,
    unusualPrototype,
  ];

  for (const value of invalid) {
    assert.throws(
      () => parseSourceAssetCommitCommand(value),
      SourceAssetCommitError,
    );
  }
});

test('requires provenance and an opaque idempotency key', () => {
  const invalid = [
    command({ sourceType: '' }),
    command({ createdBy: '   ' }),
    command({ idempotencyKey: '' }),
  ];

  for (const value of invalid) {
    assert.throws(
      () => parseSourceAssetCommitCommand(value),
      SourceAssetCommitError,
    );
  }

  assert.equal(
    parseSourceAssetCommitCommand(command()).idempotencyKey,
    'import-request-1',
  );

  const intent = getSourceAssetCommitIntent(command());
  const identity = getSourceAssetCommitIdentity(command());
  assert.deepEqual(
    getSourceAssetCommitIdentity(command({
      temporarySource: { relativePath: 'tmp/retry/source.txt' },
      createdBy: 'operator-2',
      idempotencyKey: 'import-request-2',
    })),
    identity,
  );
  assert.deepEqual(
    getSourceAssetCommitIntent(command({
      temporarySource: { relativePath: 'tmp/retry/source.txt' },
    })),
    intent,
    'ephemeral retry paths must not change the bound intent',
  );
  assert.notDeepEqual(
    getSourceAssetCommitIntent(command({ expectedByteLength: 13 })),
    intent,
  );
});

test('classifies idempotent, conflicting, duplicate, and new attempts', () => {
  const existing = command();
  const existingIntent = getSourceAssetCommitIntent(existing);

  assert.equal(
    classifySourceAssetCommitAttempt(
      existing.idempotencyKey,
      existingIntent,
      command({ temporarySource: { relativePath: 'tmp/retry/source.txt' } }),
    ),
    'idempotent',
  );
  assert.equal(
    classifySourceAssetCommitAttempt(
      existing.idempotencyKey,
      existingIntent,
      command({ createdBy: 'operator-2' }),
    ),
    'conflict',
  );
  assert.equal(
    classifySourceAssetCommitAttempt(
      existing.idempotencyKey,
      existingIntent,
      command({ expectedContentHash: 'b'.repeat(64) }),
    ),
    'conflict',
  );
  assert.equal(
    classifySourceAssetCommitAttempt(
      existing.idempotencyKey,
      existingIntent,
      command({
        createdBy: 'operator-2',
        idempotencyKey: 'import-request-2',
      }),
    ),
    'duplicate',
  );

  const changedIdentityCommands = [
    command({
      expectedContentHash: 'b'.repeat(64),
      idempotencyKey: 'import-request-2',
    }),
    command({ expectedByteLength: 13, idempotencyKey: 'import-request-2' }),
    command({ originalName: 'other.txt', idempotencyKey: 'import-request-2' }),
    command({ sourceType: 'markdown', idempotencyKey: 'import-request-2' }),
  ];
  for (const nextCommand of changedIdentityCommands) {
    assert.equal(
      classifySourceAssetCommitAttempt(
        existing.idempotencyKey,
        existingIntent,
        nextCommand,
      ),
      'new',
    );
  }
});

test('exposes stable duplicate, conflict, mismatch, and recovery errors', () => {
  assert.deepEqual(SOURCE_ASSET_COMMIT_ERROR_CODES, [
    'SOURCE_ASSET_COMMIT_COMMAND_INVALID',
    'SOURCE_ASSET_COMMIT_CONTENT_MISMATCH',
    'SOURCE_ASSET_COMMIT_DUPLICATE',
    'SOURCE_ASSET_COMMIT_CONFLICT',
    'SOURCE_ASSET_COMMIT_RECOVERY_REQUIRED',
  ]);

  for (const code of SOURCE_ASSET_COMMIT_ERROR_CODES) {
    const cause = new Error('low-level failure');
    const error = new SourceAssetCommitError(code, 'commit failed', cause);
    assert.equal(error.name, 'SourceAssetCommitError');
    assert.equal(error.code, code);
    assert.equal(error.cause, cause);
    assert.equal(isSourceAssetCommitErrorCode(error.code), true);
  }

  assert.equal(isSourceAssetCommitErrorCode('PROJECT_WORKFLOW_PATH_INVALID'), false);
  assert.equal(isSourceAssetCommitErrorCode(undefined), false);
});
