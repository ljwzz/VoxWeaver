import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isWorkspacePageKey,
  NOVEL_IMPORT_TEXT_SLICE_MAX_BYTES,
  WORKSPACE_PAGE_KEYS,
} from './index.ts';

test('正式工作台页面键固定且唯一', () => {
  assert.equal(WORKSPACE_PAGE_KEYS.length, 22);
  assert.equal(new Set(WORKSPACE_PAGE_KEYS).size, WORKSPACE_PAGE_KEYS.length);
  assert.equal(isWorkspacePageKey('text-extraction'), true);
  assert.equal(isWorkspacePageKey('overall-text'), false);
});

test('小说正文分片上限固定为 256 KiB', () => {
  assert.equal(NOVEL_IMPORT_TEXT_SLICE_MAX_BYTES, 262_144);
});
