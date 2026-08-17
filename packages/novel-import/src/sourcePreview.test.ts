import type { SourceAssetManifest, TxtSourceEncoding } from '@voxweaver/contracts';

import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import {
  NOVEL_IMPORT_SOURCE_PREVIEW_MAX_BYTES,
  NOVEL_IMPORT_SOURCE_PREVIEW_MAX_LINES,
} from '@voxweaver/contracts';
import iconvLite from 'iconv-lite';
import {
  NovelImportError,
  readProjectSourcePreview,
  sha256Bytes,
} from './index.ts';

const SOURCE_ASSET_ID = '33333333-3333-4333-8333-333333333333';

test('source preview reads sequential line chunks for every supported encoding', async (context) => {
  const cases: Array<{ encoding: TxtSourceEncoding; bytes: Buffer; firstText?: string }> = [
    { encoding: 'utf-8', bytes: Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from('第一行\r\n第二\u00A0行\n第三行', 'utf8')]), firstText: '第一行\n第二 行\n' },
    { encoding: 'gb2312', bytes: iconvLite.encode('第一行\r\n第二行\n第三行', 'gb2312') },
    { encoding: 'gbk', bytes: iconvLite.encode('第一行\r\n第二行\n第三行', 'gbk') },
    { encoding: 'gb18030', bytes: iconvLite.encode('第一行\r\n第二行𠀀\n第三行', 'gb18030'), firstText: '第一行\n第二行𠀀\n' },
    { encoding: 'big5', bytes: iconvLite.encode('第一行\r\n第二行\n第三行', 'big5') },
    { encoding: 'utf-16le', bytes: Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from('第一行\r\n第二行\n第三行', 'utf16le')]) },
    { encoding: 'utf-16be', bytes: Buffer.concat([Buffer.from([0xFE, 0xFF]), encodeUtf16Be('第一行\r\n第二行\n第三行')]) },
  ];

  for (const item of cases) {
    const fixture = await createSourceFixture(context, item.bytes);
    const first = await readProjectSourcePreview(fixture.rootPath, fixture.manifest, {
      sourceHash: fixture.manifest.sha256,
      sourceEncoding: item.encoding,
      startByte: 0,
      targetLineCount: 2,
    });
    assert.equal(first.text, item.firstText ?? '第一行\n第二行\n');
    assert.equal(first.completeLineCount, 2);
    assert.equal(first.done, false);

    const second = await readProjectSourcePreview(fixture.rootPath, fixture.manifest, {
      sourceHash: fixture.manifest.sha256,
      sourceEncoding: item.encoding,
      startByte: first.endByte,
      targetLineCount: 2,
    });
    assert.equal(second.text, '第三行');
    assert.equal(second.done, true);
  }
});

test('source preview preserves multibyte boundaries and caps a long line', async (context) => {
  const bytes = Buffer.from('中'.repeat(100_000), 'utf8');
  const fixture = await createSourceFixture(context, bytes);
  const preview = await readProjectSourcePreview(fixture.rootPath, fixture.manifest, {
    sourceHash: fixture.manifest.sha256,
    sourceEncoding: 'utf-8',
    startByte: 0,
    targetLineCount: 100,
  });

  assert.equal(preview.completeLineCount, 0);
  assert.equal(preview.done, false);
  assert.ok(preview.endByte <= NOVEL_IMPORT_SOURCE_PREVIEW_MAX_BYTES);
  assert.equal(preview.endByte % 3, 0);
  assert.equal(Buffer.byteLength(preview.text, 'utf8'), preview.endByte);
  assert.doesNotMatch(preview.text, /�/u);
});

test('source preview normalizes CR cursors and enforces the line limit', async (context) => {
  const bytes = Buffer.from('第一行\r第二行\r第三行', 'utf8');
  const fixture = await createSourceFixture(context, bytes);
  const first = await readProjectSourcePreview(fixture.rootPath, fixture.manifest, {
    sourceHash: fixture.manifest.sha256,
    sourceEncoding: 'utf-8',
    startByte: 0,
    targetLineCount: 1,
  });
  assert.equal(first.text, '第一行\n');
  const second = await readProjectSourcePreview(fixture.rootPath, fixture.manifest, {
    sourceHash: fixture.manifest.sha256,
    sourceEncoding: 'utf-8',
    startByte: first.endByte,
    targetLineCount: 1,
  });
  assert.equal(second.text, '第二行\n');

  await assert.rejects(
    readProjectSourcePreview(fixture.rootPath, fixture.manifest, {
      sourceHash: fixture.manifest.sha256,
      sourceEncoding: 'utf-8',
      startByte: 0,
      targetLineCount: NOVEL_IMPORT_SOURCE_PREVIEW_MAX_LINES + 1,
    }),
    hasReason('source_preview_too_large'),
  );
});

test('source preview rejects stale hashes and modified project sources', async (context) => {
  const bytes = Buffer.from('第一行\n第二行', 'utf8');
  const fixture = await createSourceFixture(context, bytes);
  await assert.rejects(
    readProjectSourcePreview(fixture.rootPath, fixture.manifest, {
      sourceHash: '0'.repeat(64),
      sourceEncoding: 'utf-8',
      startByte: 0,
      targetLineCount: 1,
    }),
    hasReason('encoding_selection_source_mismatch'),
  );

  await writeFile(fixture.sourcePath, Buffer.from('第壹行\n第二行', 'utf8'));
  await assert.rejects(
    readProjectSourcePreview(fixture.rootPath, fixture.manifest, {
      sourceHash: fixture.manifest.sha256,
      sourceEncoding: 'utf-8',
      startByte: 0,
      targetLineCount: 1,
    }),
    hasReason('source_asset_hash_mismatch'),
  );

  await writeFile(fixture.sourcePath, Buffer.concat([bytes, Buffer.from('\n追加', 'utf8')]));
  await assert.rejects(
    readProjectSourcePreview(fixture.rootPath, fixture.manifest, {
      sourceHash: fixture.manifest.sha256,
      sourceEncoding: 'utf-8',
      startByte: 0,
      targetLineCount: 1,
    }),
    hasReason('source_asset_length_mismatch'),
  );
});

async function createSourceFixture(
  context: { after: (callback: () => Promise<void>) => void },
  bytes: Buffer,
): Promise<{ rootPath: string; sourcePath: string; manifest: SourceAssetManifest }> {
  const rootPath = await mkdtemp(join(tmpdir(), 'voxweaver-source-preview-'));
  context.after(async () => rm(rootPath, { recursive: true, force: true }));
  const manifest: SourceAssetManifest = {
    id: SOURCE_ASSET_ID,
    originalName: 'novel.txt',
    relativePath: `inputs/source-assets/${SOURCE_ASSET_ID}/novel.txt`,
    byteLength: bytes.byteLength,
    sha256: sha256Bytes(bytes),
  };
  const sourcePath = join(rootPath, ...manifest.relativePath.split('/'));
  await mkdir(dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, bytes);
  return { rootPath, sourcePath, manifest };
}

function encodeUtf16Be(text: string): Buffer {
  const bytes = Buffer.from(text, 'utf16le');
  for (let index = 0; index < bytes.length; index += 2) {
    const first = bytes[index]!;
    bytes[index] = bytes[index + 1]!;
    bytes[index + 1] = first;
  }
  return bytes;
}

function hasReason(reason: NovelImportError['reason']): (error: unknown) => boolean {
  return error => error instanceof NovelImportError && error.reason === reason;
}
