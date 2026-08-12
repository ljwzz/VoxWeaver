import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isSupportedProjectSourceFileName,
  PROJECT_SOURCE_FILE_CONFIG,
} from './projectSourceConfig.ts';

test('项目源文件配置只声明 txt 扩展名', () => {
  assert.equal(PROJECT_SOURCE_FILE_CONFIG.displayName, 'TXT 文本文件');
  assert.deepEqual(PROJECT_SOURCE_FILE_CONFIG.extensions, ['txt']);
});

test('项目源文件扩展名匹配不区分大小写', () => {
  assert.equal(isSupportedProjectSourceFileName('novel.txt'), true);
  assert.equal(isSupportedProjectSourceFileName('novel.TXT'), true);
});

test('项目源文件扩展名拒绝非 txt 和伪装文件名', () => {
  for (const fileName of ['novel.md', 'novel', 'novel.txt.exe'])
    assert.equal(isSupportedProjectSourceFileName(fileName), false);
});
