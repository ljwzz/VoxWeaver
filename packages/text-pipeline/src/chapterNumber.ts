const ASCII_DECIMAL_PATTERN = /^\d+$/u;
const FULLWIDTH_DECIMAL_PATTERN = /^[０１２３４５６７８９]+$/u;
const CHINESE_DIGIT_SEQUENCE_PATTERN = /^[零〇一二三四五六七八九]+$/u;
const CHINESE_NUMBER_PATTERN = /^[零〇一二三四五六七八九两十百千万亿]+$/u;

const CHINESE_DIGITS: Readonly<Record<string, number>> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  两: 2,
};

const SMALL_UNITS: Readonly<Record<string, bigint>> = {
  十: 10n,
  百: 100n,
  千: 1_000n,
};

const TEN_THOUSAND = 10_000n;
const HUNDRED_MILLION = 100_000_000n;
const MAX_SAFE_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);
const CHAPTER_NUMBER_TOKEN_CODE_UNIT_LIMIT = 64;

export type ChapterNumberSourceKindV1
  = | 'ascii-arabic'
    | 'fullwidth-arabic'
    | 'chinese-digits'
    | 'chinese-multiplicative';

export interface ParsedChapterNumberV1 {
  readonly raw: string;
  readonly normalizedDecimal: string;
  readonly numericValue: number;
  readonly sourceKind: ChapterNumberSourceKindV1;
}

/**
 * Parses only the explicitly supported chapter-number grammars. It never
 * performs Unicode compatibility normalization, so mixed numeral systems stay
 * invalid rather than being silently folded together.
 */
export function parseChapterNumberV1(raw: string): ParsedChapterNumberV1 | null {
  if (
    typeof raw !== 'string'
    || raw.length === 0
    || raw.length > CHAPTER_NUMBER_TOKEN_CODE_UNIT_LIMIT
  ) {
    return null;
  }

  if (ASCII_DECIMAL_PATTERN.test(raw))
    return result(raw, BigInt(raw), 'ascii-arabic');

  if (FULLWIDTH_DECIMAL_PATTERN.test(raw)) {
    let decimal = '';
    for (const character of raw)
      decimal += String(character.codePointAt(0)! - 0xFF10);
    return result(raw, BigInt(decimal), 'fullwidth-arabic');
  }

  if (CHINESE_DIGIT_SEQUENCE_PATTERN.test(raw)) {
    let value = 0n;
    for (const character of raw)
      value = value * 10n + BigInt(CHINESE_DIGITS[character]);
    return result(raw, value, 'chinese-digits');
  }

  if (raw === '两')
    return result(raw, 2n, 'chinese-multiplicative');

  if (!CHINESE_NUMBER_PATTERN.test(raw) || raw.includes('〇'))
    return null;

  const value = parseChineseMultiplicative(raw);
  return value === null
    ? null
    : result(raw, value, 'chinese-multiplicative');
}

function result(
  raw: string,
  value: bigint,
  sourceKind: ChapterNumberSourceKindV1,
): ParsedChapterNumberV1 | null {
  if (value < 0n || value > MAX_SAFE_INTEGER)
    return null;
  return {
    raw,
    normalizedDecimal: value.toString(10),
    numericValue: Number(value),
    sourceKind,
  };
}

function parseChineseMultiplicative(raw: string): bigint | null {
  const parts = raw.split('亿');
  if (parts.length > 2)
    return null;
  if (parts.length === 1)
    return parseBelowHundredMillion(raw);

  const [highRaw, lowRaw] = parts;
  if (highRaw.length === 0)
    return null;
  const high = parseBelowTenThousand(highRaw);
  if (high === null || high === 0n)
    return null;
  if (lowRaw.length === 0)
    return high * HUNDRED_MILLION;

  const bridged = lowRaw.startsWith('零');
  const lowBody = bridged ? lowRaw.slice(1) : lowRaw;
  if (lowBody.length === 0 || lowBody.startsWith('零'))
    return null;
  const low = parseBelowHundredMillion(lowBody);
  if (low === null || low === 0n)
    return null;
  if (bridged !== (low < 10_000_000n))
    return null;
  return high * HUNDRED_MILLION + low;
}

function parseBelowHundredMillion(raw: string): bigint | null {
  const parts = raw.split('万');
  if (parts.length > 2)
    return null;
  if (parts.length === 1)
    return parseBelowTenThousand(raw);

  const [highRaw, lowRaw] = parts;
  if (highRaw.length === 0)
    return null;
  const high = parseBelowTenThousand(highRaw);
  if (high === null || high === 0n)
    return null;
  if (lowRaw.length === 0)
    return high * TEN_THOUSAND;

  const bridged = lowRaw.startsWith('零');
  const lowBody = bridged ? lowRaw.slice(1) : lowRaw;
  if (lowBody.length === 0 || lowBody.startsWith('零'))
    return null;
  const low = parseBelowTenThousand(lowBody);
  if (low === null || low === 0n)
    return null;
  if (bridged !== (low < 1_000n))
    return null;
  return high * TEN_THOUSAND + low;
}

function parseBelowTenThousand(raw: string): bigint | null {
  if (raw.length === 0 || raw.includes('万') || raw.includes('亿'))
    return null;

  let total = 0n;
  let pendingDigit: number | null = null;
  let pendingCharacter = '';
  let previousUnit: bigint | null = null;
  let zeroBridge = false;
  let sawComponent = false;

  for (const character of raw) {
    const digit = CHINESE_DIGITS[character];
    if (digit !== undefined) {
      if (digit === 0) {
        if (!sawComponent || pendingDigit !== null || zeroBridge)
          return null;
        zeroBridge = true;
        continue;
      }
      if (pendingDigit !== null)
        return null;
      pendingDigit = digit;
      pendingCharacter = character;
      continue;
    }

    const unit = SMALL_UNITS[character];
    if (unit === undefined || (previousUnit !== null && unit >= previousUnit))
      return null;

    let coefficient: number;
    if (pendingDigit === null) {
      if (unit !== 10n || sawComponent || zeroBridge)
        return null;
      coefficient = 1;
    } else {
      if (pendingCharacter === '两' && unit < 100n)
        return null;
      coefficient = pendingDigit;
    }

    if (previousUnit !== null) {
      const skippedPosition = previousUnit / unit > 10n;
      if (zeroBridge !== skippedPosition)
        return null;
    }

    total += BigInt(coefficient) * unit;
    pendingDigit = null;
    pendingCharacter = '';
    previousUnit = unit;
    zeroBridge = false;
    sawComponent = true;
  }

  if (pendingDigit !== null) {
    if (previousUnit !== null) {
      const skippedPosition = previousUnit > 10n;
      if (zeroBridge !== skippedPosition)
        return null;
    } else if (zeroBridge) {
      return null;
    }
    total += BigInt(pendingDigit);
    sawComponent = true;
  } else if (zeroBridge) {
    return null;
  }

  return sawComponent && total > 0n ? total : null;
}
