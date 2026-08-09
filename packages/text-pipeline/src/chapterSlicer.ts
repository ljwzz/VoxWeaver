/// <reference types="node" />

import type {
  ChapterIndexEntryV1,
  ChapterIndexV1,
  CoverageClassificationV1,
  TextRangeV1,
} from '@voxweaver/contracts';

import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import { parseChapterIndexV1 } from '@voxweaver/contracts';
import { validateChapterIndexDomainV1 } from '@voxweaver/novel-domain';

export interface SliceChapterIndexInputV1 {
  readonly chapterIndex: ChapterIndexV1;
  readonly canonicalText: string;
}

export interface ChapterSliceV1 {
  readonly chapterId: string;
  readonly headingText: string;
  readonly contentText: string;
  readonly completeText: string;
}

export interface CoverageSliceV1 {
  readonly classification: CoverageClassificationV1;
  readonly chapterId?: string;
  readonly range: TextRangeV1;
  readonly text: string;
}

export class ChapterSlicingError extends Error {
  readonly code = 'NOVEL_IMPORT_STRUCTURE_INVALID';

  constructor(
    readonly detailReason: string,
    message: string,
  ) {
    super(message);
    this.name = 'ChapterSlicingError';
  }
}

export function sliceChapterIndexV1(
  input: SliceChapterIndexInputV1,
): readonly ChapterSliceV1[] {
  const validated = validateInput(input);
  return validated.chapterIndex.entries.map(entry => sliceEntry(entry, validated.bytes));
}

export function sliceChapterCoverageV1(
  input: SliceChapterIndexInputV1,
): readonly CoverageSliceV1[] {
  const validated = validateInput(input);
  return validated.chapterIndex.coverageReport.segments.map(segment => ({
    classification: segment.classification,
    ...(segment.classification === 'chapter'
      ? { chapterId: segment.chapterId }
      : {}),
    range: segment.range,
    text: sliceRange(validated.bytes, segment.range),
  }));
}

export function restoreCanonicalTextFromCoverageV1(
  input: SliceChapterIndexInputV1,
): string {
  const validated = validateInput(input);
  const restored = validated.chapterIndex.coverageReport.segments
    .map(segment => sliceRange(validated.bytes, segment.range))
    .join('');
  if (restored !== input.canonicalText) {
    invalid(
      'coverage_restore_mismatch',
      'Coverage slices did not restore the complete canonical text exactly',
    );
  }
  return restored;
}

interface ValidatedSliceInput {
  readonly chapterIndex: ChapterIndexV1;
  readonly bytes: Buffer;
}

function validateInput(input: SliceChapterIndexInputV1): ValidatedSliceInput {
  if (typeof input?.canonicalText !== 'string')
    invalid('canonical_text_invalid', 'Canonical text must be a string');

  let chapterIndex: ChapterIndexV1;
  try {
    chapterIndex = parseChapterIndexV1(input.chapterIndex);
    validateChapterIndexDomainV1(chapterIndex);
  } catch (error) {
    invalid(
      'chapter_slice_index_invalid',
      `Chapter slicing index is invalid: ${errorMessage(error)}`,
    );
  }
  const bytes = Buffer.from(input.canonicalText, 'utf8');
  if (bytes.toString('utf8') !== input.canonicalText) {
    invalid(
      'canonical_text_utf8_invalid',
      'Canonical text must be exactly representable as UTF-8',
    );
  }
  if (bytes.byteLength !== chapterIndex.textRevision.byteLength) {
    invalid(
      'canonical_text_length_mismatch',
      'Canonical text byteLength does not match ChapterIndex textRevision',
    );
  }
  const contentHash = createHash('sha256').update(bytes).digest('hex');
  if (contentHash !== chapterIndex.textRevision.contentHash) {
    invalid(
      'canonical_text_hash_mismatch',
      'Canonical text hash does not match ChapterIndex textRevision',
    );
  }
  return { chapterIndex, bytes };
}

function sliceEntry(entry: ChapterIndexEntryV1, bytes: Buffer): ChapterSliceV1 {
  const headingText = sliceRange(bytes, entry.headingRange);
  const contentText = sliceRange(bytes, entry.contentRange);
  return {
    chapterId: entry.chapterId,
    headingText,
    contentText,
    completeText: headingText + contentText,
  };
}

function sliceRange(bytes: Buffer, range: TextRangeV1): string {
  if (
    !isUtf8ScalarBoundary(bytes, range.startByte)
    || !isUtf8ScalarBoundary(bytes, range.endByte)
  ) {
    invalid(
      'chapter_slice_utf8_boundary_invalid',
      'Chapter slice range must use UTF-8 scalar boundaries',
    );
  }
  const slice = bytes.subarray(range.startByte, range.endByte);
  const text = slice.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(slice)) {
    invalid(
      'chapter_slice_utf8_invalid',
      'Chapter slice must contain exact valid UTF-8 bytes',
    );
  }
  return text;
}

function isUtf8ScalarBoundary(bytes: Uint8Array, offset: number): boolean {
  if (offset === 0 || offset === bytes.byteLength)
    return true;
  const byte = bytes[offset];
  return byte !== undefined && (byte & 0b1100_0000) !== 0b1000_0000;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

function invalid(detailReason: string, message: string): never {
  throw new ChapterSlicingError(detailReason, message);
}
