import type {
  SourceAssetManifest,
  SourceAssetProbeDto,
} from '@voxweaver/contracts';
import type { Stats } from 'node:fs';

import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import { invalidSource, NovelImportError } from './errors.ts';

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface ProjectSourceAsset {
  readonly source: SourceAssetProbeDto;
  readonly bytes: Uint8Array;
}

export interface ProjectSourceAssetWindow {
  readonly source: SourceAssetProbeDto;
  readonly bytes: Uint8Array;
  readonly startByte: number;
  readonly totalByteLength: number;
}

export function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function verifyProjectSourceAsset(asset: ProjectSourceAsset): void {
  if (!(asset.bytes instanceof Uint8Array)
    || !UUID_V4_PATTERN.test(asset.source.sourceAssetId)
    || !isSafeFileName(asset.source.originalName)
    || !asset.source.originalName.toLowerCase().endsWith('.txt')
    || !Number.isSafeInteger(asset.source.byteLength)
    || asset.source.byteLength < 0
    || !SHA256_PATTERN.test(asset.source.sha256)) {
    throw invalidSource(
      'invalid_source_asset',
      '项目源资产描述无效。',
    );
  }

  if (asset.bytes.byteLength !== asset.source.byteLength) {
    throw invalidSource(
      'source_asset_length_mismatch',
      '项目源资产字节长度与 manifest 不一致。',
      {
        expectedByteLength: asset.source.byteLength,
        actualByteLength: asset.bytes.byteLength,
      },
    );
  }

  const actualHash = sha256Bytes(asset.bytes);
  if (actualHash !== asset.source.sha256) {
    throw invalidSource(
      'source_asset_hash_mismatch',
      '项目源资产 SHA-256 与 manifest 不一致。',
      {
        expectedSha256: asset.source.sha256,
        actualSha256: actualHash,
      },
    );
  }
}

export async function readProjectSourceAsset(
  rootPath: string,
  manifest: SourceAssetManifest,
): Promise<ProjectSourceAsset> {
  try {
    const resolvedSource = await resolveProjectSourceAssetPath(rootPath, manifest);
    const noFollowFlag = typeof constants.O_NOFOLLOW === 'number'
      ? constants.O_NOFOLLOW
      : 0;
    const handle = await open(resolvedSource, constants.O_RDONLY | noFollowFlag);
    try {
      const before = await handle.stat();
      if (!before.isFile()) {
        throw invalidSource(
          'source_asset_not_regular_file',
          '项目源资产必须是普通文件。',
        );
      }
      const bytes = Uint8Array.from(await handle.readFile());
      const after = await handle.stat();
      if (before.dev !== after.dev
        || before.ino !== after.ino
        || before.size !== after.size
        || before.mtimeMs !== after.mtimeMs) {
        throw invalidSource(
          'source_asset_read_failed',
          '读取期间项目源资产发生变化。',
        );
      }

      const asset: ProjectSourceAsset = {
        source: {
          sourceAssetId: manifest.id,
          originalName: manifest.originalName,
          byteLength: manifest.byteLength,
          sha256: manifest.sha256,
        },
        bytes,
      };
      verifyProjectSourceAsset(asset);
      return asset;
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error instanceof NovelImportError)
      throw error;
    throw invalidSource(
      'source_asset_read_failed',
      '无法读取项目内源资产。',
      { systemError: error instanceof Error ? error.message : String(error) },
    );
  }
}

export async function readProjectSourceAssetWindow(
  rootPath: string,
  manifest: SourceAssetManifest,
  startByte: number,
  maximumByteLength: number,
  lookBehindByteLength = 0,
): Promise<ProjectSourceAssetWindow> {
  if (!Number.isSafeInteger(startByte)
    || startByte < 0
    || startByte > manifest.byteLength
    || !Number.isSafeInteger(maximumByteLength)
    || maximumByteLength < 1
    || !Number.isSafeInteger(lookBehindByteLength)
    || lookBehindByteLength < 0) {
    throw invalidSource(
      'source_asset_read_failed',
      '项目源资产预览范围无效。',
    );
  }

  try {
    const resolvedSource = await resolveProjectSourceAssetPath(rootPath, manifest);
    const noFollowFlag = typeof constants.O_NOFOLLOW === 'number'
      ? constants.O_NOFOLLOW
      : 0;
    const handle = await open(resolvedSource, constants.O_RDONLY | noFollowFlag);
    try {
      const before = await handle.stat();
      if (!before.isFile()) {
        throw invalidSource(
          'source_asset_not_regular_file',
          '项目源资产必须是普通文件。',
        );
      }
      if (before.size !== manifest.byteLength) {
        throw invalidSource(
          'source_asset_length_mismatch',
          '项目源资产字节长度与 manifest 不一致。',
          { expectedByteLength: manifest.byteLength, actualByteLength: before.size },
        );
      }

      const retainedStart = Math.max(0, startByte - lookBehindByteLength);
      const retainedEnd = Math.min(
        manifest.byteLength,
        startByte + maximumByteLength,
      );
      const retainedChunks: Buffer[] = [];
      const hash = createHash('sha256');
      const readBuffer = Buffer.allocUnsafe(64 * 1024);
      let position = 0;
      while (position < manifest.byteLength) {
        const requestedLength = Math.min(readBuffer.byteLength, manifest.byteLength - position);
        const result = await handle.read(readBuffer, 0, requestedLength, position);
        if (result.bytesRead === 0)
          break;
        const chunk = readBuffer.subarray(0, result.bytesRead);
        hash.update(chunk);
        const chunkEnd = position + result.bytesRead;
        const intersectionStart = Math.max(position, retainedStart);
        const intersectionEnd = Math.min(chunkEnd, retainedEnd);
        if (intersectionStart < intersectionEnd) {
          retainedChunks.push(Buffer.from(chunk.subarray(
            intersectionStart - position,
            intersectionEnd - position,
          )));
        }
        position = chunkEnd;
      }

      const after = await handle.stat();
      assertStableSourceRead(before, after);
      if (position !== manifest.byteLength) {
        throw invalidSource(
          'source_asset_length_mismatch',
          '项目源资产字节长度与 manifest 不一致。',
          { expectedByteLength: manifest.byteLength, actualByteLength: position },
        );
      }
      const actualHash = hash.digest('hex');
      if (actualHash !== manifest.sha256) {
        throw invalidSource(
          'source_asset_hash_mismatch',
          '项目源资产 SHA-256 与 manifest 不一致。',
          { expectedSha256: manifest.sha256, actualSha256: actualHash },
        );
      }

      return {
        source: sourceProbeFromManifest(manifest),
        bytes: Uint8Array.from(Buffer.concat(retainedChunks)),
        startByte: retainedStart,
        totalByteLength: manifest.byteLength,
      };
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error instanceof NovelImportError)
      throw error;
    throw invalidSource(
      'source_asset_read_failed',
      '无法读取项目内源资产预览。',
      { systemError: error instanceof Error ? error.message : String(error) },
    );
  }
}

async function resolveProjectSourceAssetPath(
  rootPath: string,
  manifest: SourceAssetManifest,
): Promise<string> {
  validateManifest(manifest);
  if (typeof rootPath !== 'string' || !isAbsolute(rootPath)) {
    throw invalidSource(
      'source_asset_path_invalid',
      '项目根目录必须是绝对路径。',
    );
  }

  const resolvedRoot = resolve(rootPath);
  const pathSegments = manifest.relativePath.split('/');
  const resolvedSource = resolve(resolvedRoot, ...pathSegments);
  if (!isContainedPath(resolvedRoot, resolvedSource)) {
    throw invalidSource(
      'source_asset_outside_project',
      '项目源资产路径越出项目根目录。',
    );
  }

  await assertDirectoryWithoutSymlink(resolvedRoot);
  let currentPath = resolvedRoot;
  for (const [index, segment] of pathSegments.entries()) {
    currentPath = resolve(currentPath, segment);
    const stat = await lstat(currentPath);
    if (stat.isSymbolicLink()) {
      throw invalidSource(
        'source_asset_symlink',
        '项目源资产路径不得包含符号链接。',
        { relativePath: pathSegments.slice(0, index + 1).join('/') },
      );
    }
    const isLast = index === pathSegments.length - 1;
    if ((!isLast && !stat.isDirectory()) || (isLast && !stat.isFile())) {
      throw invalidSource(
        'source_asset_not_regular_file',
        '项目源资产必须是普通文件，且父级必须是目录。',
        { relativePath: pathSegments.slice(0, index + 1).join('/') },
      );
    }
  }

  const canonicalRoot = await realpath(resolvedRoot);
  const canonicalSource = await realpath(resolvedSource);
  if (!isContainedPath(canonicalRoot, canonicalSource)) {
    throw invalidSource(
      'source_asset_outside_project',
      '项目源资产真实路径越出项目根目录。',
    );
  }
  return resolvedSource;
}

function sourceProbeFromManifest(manifest: SourceAssetManifest): SourceAssetProbeDto {
  return {
    sourceAssetId: manifest.id,
    originalName: manifest.originalName,
    byteLength: manifest.byteLength,
    sha256: manifest.sha256,
  };
}

function assertStableSourceRead(
  before: Stats,
  after: Stats,
): void {
  if (before.dev !== after.dev
    || before.ino !== after.ino
    || before.size !== after.size
    || before.mtimeMs !== after.mtimeMs) {
    throw invalidSource(
      'source_asset_read_failed',
      '读取期间项目源资产发生变化。',
    );
  }
}

async function assertDirectoryWithoutSymlink(directoryPath: string): Promise<void> {
  const stat = await lstat(directoryPath);
  if (stat.isSymbolicLink()) {
    throw invalidSource(
      'source_asset_symlink',
      '项目根目录不得是符号链接。',
    );
  }
  if (!stat.isDirectory()) {
    throw invalidSource(
      'source_asset_path_invalid',
      '项目根路径不是目录。',
    );
  }
}

function validateManifest(manifest: SourceAssetManifest): void {
  if (!UUID_V4_PATTERN.test(manifest.id)
    || !isSafeFileName(manifest.originalName)
    || !manifest.originalName.toLowerCase().endsWith('.txt')
    || !Number.isSafeInteger(manifest.byteLength)
    || manifest.byteLength < 0
    || !SHA256_PATTERN.test(manifest.sha256)) {
    throw invalidSource(
      manifest.originalName?.toLowerCase().endsWith('.txt')
        ? 'invalid_source_asset'
        : 'source_asset_not_txt',
      'SourceAsset manifest 无效或不是 TXT 文件。',
    );
  }

  const expectedRelativePath = `inputs/source-assets/${manifest.id}/${manifest.originalName}`;
  if (manifest.relativePath !== expectedRelativePath) {
    throw invalidSource(
      'source_asset_path_invalid',
      'SourceAsset relativePath 不符合项目布局。',
      { expectedRelativePath },
    );
  }
}

function isSafeFileName(value: string): boolean {
  return typeof value === 'string'
    && value.length > 0
    && value !== '.'
    && value !== '..'
    && !value.includes('/')
    && !value.includes('\\')
    && !value.includes('\0');
}

function isContainedPath(rootPath: string, candidatePath: string): boolean {
  const pathFromRoot = relative(rootPath, candidatePath);
  return pathFromRoot.length > 0
    && pathFromRoot !== '..'
    && !pathFromRoot.startsWith(`..${sep}`)
    && !isAbsolute(pathFromRoot);
}
