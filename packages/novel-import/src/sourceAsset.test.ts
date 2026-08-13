import type { SourceAssetManifest } from '@voxweaver/contracts';

import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import {
  NovelImportError,
  readProjectSourceAsset,
  sha256Bytes,
} from './index.ts';

const SOURCE_ASSET_ID = '22222222-2222-4222-8222-222222222222';

test('readProjectSourceAsset reads only the manifest-bound project file', async (context) => {
  const rootPath = await createTemporaryRoot(context);
  const bytes = Buffer.from('第一章 开始\n正文', 'utf8');
  const manifest = createManifest(bytes);
  const sourcePath = join(rootPath, ...manifest.relativePath.split('/'));
  await mkdir(dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, bytes);

  const source = await readProjectSourceAsset(rootPath, manifest);

  assert.deepEqual(source.source, {
    sourceAssetId: manifest.id,
    originalName: manifest.originalName,
    byteLength: manifest.byteLength,
    sha256: manifest.sha256,
  });
  assert.deepEqual(Buffer.from(source.bytes), bytes);
});

test('readProjectSourceAsset rejects non-canonical and escaping relative paths', async (context) => {
  const rootPath = await createTemporaryRoot(context);
  const bytes = Buffer.from('正文', 'utf8');
  const manifest = createManifest(bytes);

  await assert.rejects(
    readProjectSourceAsset(rootPath, {
      ...manifest,
      relativePath: '../outside.txt',
    }),
    hasReason('source_asset_path_invalid'),
  );
  await assert.rejects(
    readProjectSourceAsset(rootPath, {
      ...manifest,
      relativePath: `inputs/source-assets/${manifest.id}/other.txt`,
    }),
    hasReason('source_asset_path_invalid'),
  );
});

test('readProjectSourceAsset rejects a symlink at every project-relative path level', async (context) => {
  const rootPath = await createTemporaryRoot(context);
  const bytes = Buffer.from('正文', 'utf8');
  const manifest = createManifest(bytes);
  const realInputs = join(rootPath, 'real-inputs');
  const realAssetDirectory = join(realInputs, 'source-assets', manifest.id);
  await mkdir(realAssetDirectory, { recursive: true });
  await writeFile(join(realAssetDirectory, manifest.originalName), bytes);
  await symlink(realInputs, join(rootPath, 'inputs'));

  await assert.rejects(
    readProjectSourceAsset(rootPath, manifest),
    hasReason('source_asset_symlink'),
  );
});

test('readProjectSourceAsset rejects a final symlink and non-regular source', async (context) => {
  const symlinkRoot = await createTemporaryRoot(context);
  const bytes = Buffer.from('正文', 'utf8');
  const manifest = createManifest(bytes);
  const sourcePath = join(symlinkRoot, ...manifest.relativePath.split('/'));
  const targetPath = join(symlinkRoot, 'target.txt');
  await mkdir(dirname(sourcePath), { recursive: true });
  await writeFile(targetPath, bytes);
  await symlink(targetPath, sourcePath);
  await assert.rejects(
    readProjectSourceAsset(symlinkRoot, manifest),
    hasReason('source_asset_symlink'),
  );

  const directoryRoot = await createTemporaryRoot(context);
  const directorySourcePath = join(directoryRoot, ...manifest.relativePath.split('/'));
  await mkdir(directorySourcePath, { recursive: true });
  await assert.rejects(
    readProjectSourceAsset(directoryRoot, manifest),
    hasReason('source_asset_not_regular_file'),
  );
});

test('readProjectSourceAsset enforces manifest byte length and SHA-256', async (context) => {
  const rootPath = await createTemporaryRoot(context);
  const bytes = Buffer.from('正文', 'utf8');
  const manifest = createManifest(bytes);
  const sourcePath = join(rootPath, ...manifest.relativePath.split('/'));
  await mkdir(dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, bytes);

  await assert.rejects(
    readProjectSourceAsset(rootPath, {
      ...manifest,
      byteLength: manifest.byteLength + 1,
    }),
    hasReason('source_asset_length_mismatch'),
  );
  await assert.rejects(
    readProjectSourceAsset(rootPath, {
      ...manifest,
      sha256: '0'.repeat(64),
    }),
    hasReason('source_asset_hash_mismatch'),
  );
});

test('readProjectSourceAsset rejects a symlink project root and non-TXT manifests', async (context) => {
  const parentPath = await createTemporaryRoot(context);
  const actualRoot = join(parentPath, 'actual');
  const linkedRoot = join(parentPath, 'linked');
  await mkdir(actualRoot);
  await symlink(actualRoot, linkedRoot);
  const bytes = Buffer.from('正文', 'utf8');
  const manifest = createManifest(bytes);
  await assert.rejects(
    readProjectSourceAsset(linkedRoot, manifest),
    hasReason('source_asset_symlink'),
  );

  await assert.rejects(
    readProjectSourceAsset(actualRoot, {
      ...manifest,
      originalName: 'novel.epub',
      relativePath: `inputs/source-assets/${manifest.id}/novel.epub`,
    }),
    hasReason('source_asset_not_txt'),
  );
});

function createManifest(bytes: Uint8Array): SourceAssetManifest {
  return {
    id: SOURCE_ASSET_ID,
    originalName: 'novel.txt',
    relativePath: `inputs/source-assets/${SOURCE_ASSET_ID}/novel.txt`,
    byteLength: bytes.byteLength,
    sha256: sha256Bytes(bytes),
  };
}

async function createTemporaryRoot(context: { after: (callback: () => Promise<void>) => void }): Promise<string> {
  const rootPath = await mkdtemp(join(tmpdir(), 'voxweaver-novel-import-'));
  context.after(async () => rm(rootPath, { recursive: true, force: true }));
  return rootPath;
}

function hasReason(reason: NovelImportError['reason']): (error: unknown) => boolean {
  return error => error instanceof NovelImportError && error.reason === reason;
}
