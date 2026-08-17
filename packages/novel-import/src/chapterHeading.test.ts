import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CHAPTER_HEADING_MAX_CODE_POINTS,
  detectChapterHeadingLine,
} from './chapterHeading.ts';

test('single-line chapter detection returns normalized title and UTF-16 character offsets', () => {
  const line = '\t　第一章　启程  ';

  assert.deepEqual(detectChapterHeadingLine(line), {
    title: '第一章 启程',
    startCharacter: 2,
    endCharacter: 8,
  });
});

test('single-line chapter detection shares Chinese, special, and English heading rules', () => {
  assert.equal(detectChapterHeadingLine('第一章 山边小村')?.title, '第一章 山边小村');
  assert.equal(detectChapterHeadingLine('序章')?.title, '序章');
  assert.equal(detectChapterHeadingLine('番外 三：归途')?.title, '番外 三：归途');
  assert.equal(detectChapterHeadingLine('Chapter XIV - Return')?.title, 'Chapter XIV - Return');
  assert.equal(detectChapterHeadingLine('这不是章节标题'), undefined);
  assert.equal(detectChapterHeadingLine('第一章这是无分隔正文'), undefined);
  assert.equal(
    detectChapterHeadingLine(`第一章 ${'甲'.repeat(CHAPTER_HEADING_MAX_CODE_POINTS)}`),
    undefined,
  );
});
