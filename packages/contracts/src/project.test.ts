import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeProjectDisplayName,
  parseProjectManifest,
  PROJECT_LAYOUT_VERSION,
  PROJECT_SCHEMA_VERSION,
  PROJECT_STATE_DATABASE_PATH,
  VoxWeaverError,
} from './project.ts';

const validManifest = {
  schemaVersion: PROJECT_SCHEMA_VERSION,
  layoutVersion: PROJECT_LAYOUT_VERSION,
  projectId: '43f7ced7-98dd-44c1-9b3b-204510d9910d',
  displayName: '雨夜来信',
  createdAt: '2026-08-12T08:00:00.000Z',
  stateDatabase: PROJECT_STATE_DATABASE_PATH,
  sourceAsset: {
    id: '8a5b03d2-a442-45d5-993a-b61998c00cb8',
    originalName: 'download-18472.txt',
    relativePath: 'inputs/source-assets/8a5b03d2-a442-45d5-993a-b61998c00cb8/download-18472.txt',
    byteLength: 12,
    sha256: 'a'.repeat(64),
  },
};

test('项目名称使用用户输入并去除首尾空白', () => {
  assert.equal(normalizeProjectDisplayName('  雨夜来信  '), '雨夜来信');
});

test('项目名称拒绝空值和控制字符', () => {
  for (const value of ['', '   ', '标题\n第二行']) {
    assert.throws(
      () => normalizeProjectDisplayName(value),
      (error: unknown) => error instanceof VoxWeaverError && error.code === 'PROJECT_NAME_INVALID',
    );
  }
});

test('manifest v1 可以解析且不从文件名推断项目名称', () => {
  const parsed = parseProjectManifest(validManifest);
  assert.equal(parsed.displayName, '雨夜来信');
  assert.equal(parsed.sourceAsset.originalName, 'download-18472.txt');
});

test('未知 manifest 版本被拒绝', () => {
  assert.throws(
    () => parseProjectManifest({ ...validManifest, schemaVersion: 2 }),
    (error: unknown) => error instanceof VoxWeaverError && error.code === 'PROJECT_VERSION_UNSUPPORTED',
  );
});
