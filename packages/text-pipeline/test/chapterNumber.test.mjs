import assert from 'node:assert/strict';
import test from 'node:test';

import { parseChapterNumberV1 } from '../dist/index.js';

test('parses ASCII and fullwidth Arabic numerals without compatibility folding', () => {
  assert.deepEqual(parseChapterNumberV1('000'), {
    raw: '000',
    normalizedDecimal: '0',
    numericValue: 0,
    sourceKind: 'ascii-arabic',
  });
  assert.deepEqual(parseChapterNumberV1('００１２'), {
    raw: '００１２',
    normalizedDecimal: '12',
    numericValue: 12,
    sourceKind: 'fullwidth-arabic',
  });
  assert.equal(parseChapterNumberV1('１２3'), null);
  assert.equal(parseChapterNumberV1('1二'), null);
});

test('parses common Chinese unit forms deterministically', () => {
  const cases = [
    ['十', 10],
    ['十一', 11],
    ['二十', 20],
    ['一百零二', 102],
    ['两千', 2_000],
    ['一万零三', 10_003],
    ['一亿零三万零五', 100_030_005],
  ];

  for (const [raw, numericValue] of cases) {
    assert.deepEqual(parseChapterNumberV1(raw), {
      raw,
      normalizedDecimal: String(numericValue),
      numericValue,
      sourceKind: 'chinese-multiplicative',
    });
  }
});

test('parses pure Chinese positional digits including 〇', () => {
  assert.deepEqual(parseChapterNumberV1('二〇二四'), {
    raw: '二〇二四',
    normalizedDecimal: '2024',
    numericValue: 2024,
    sourceKind: 'chinese-digits',
  });
  assert.deepEqual(parseChapterNumberV1('零零七'), {
    raw: '零零七',
    normalizedDecimal: '7',
    numericValue: 7,
    sourceKind: 'chinese-digits',
  });
});

test('rejects empty, signed, fractional, malformed, and ambiguous forms', () => {
  const invalid = [
    '',
    ' ',
    '-1',
    '1.5',
    '第十',
    '两十',
    '两〇',
    '十百',
    '一百百',
    '一百零二十',
    '一千二十',
    '一万三',
    '一万零三千',
    '一亿三万',
    '一亿零三千万',
    '零十',
    '一万零',
  ];

  for (const raw of invalid)
    assert.equal(parseChapterNumberV1(raw), null, raw);
});

test('rejects numerals outside the non-negative safe-integer range', () => {
  assert.equal(parseChapterNumberV1('9007199254740992'), null);
  assert.equal(parseChapterNumberV1('９００７１９９２５４７４０９９２'), null);
  assert.equal(parseChapterNumberV1('九〇〇七一九九二五四七四〇九九二'), null);
});

test('rejects excessively long numeral tokens before numeric conversion', () => {
  assert.equal(parseChapterNumberV1('0'.repeat(65)), null);
  assert.equal(parseChapterNumberV1('零'.repeat(65)), null);
});
