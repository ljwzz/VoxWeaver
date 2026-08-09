import type {
  ChapterIndexEntryV1,
  ChapterIndexV1,
  CoverageReportV1,
  TextRangeV1,
} from '@voxweaver/contracts';

import { parseChapterIndexV1 } from '@voxweaver/contracts';

export class ChapterIndexDomainValidationError extends Error {
  readonly code = 'NOVEL_IMPORT_STRUCTURE_INVALID';

  constructor(
    readonly detailReason: string,
    message: string,
  ) {
    super(message);
    this.name = 'ChapterIndexDomainValidationError';
  }
}

/**
 * Applies the M1 domain invariants that are intentionally stricter than the
 * wire contract. This function has no dependency on the text pipeline.
 */
export function validateChapterIndexDomainV1(
  value: ChapterIndexV1,
): ChapterIndexV1 {
  const index = parseContract(value);

  for (const [position, entry] of index.entries.entries()) {
    if (entry.order !== position) {
      invalid(
        'chapter_order_invalid',
        'Chapter entry order must be contiguous and equal to source position',
      );
    }
    if (entry.headingRange.endByte !== entry.contentRange.startByte) {
      invalid(
        'chapter_boundary_gap',
        'Chapter content must start exactly where its heading ends',
      );
    }
    if ((entry.volumeId === undefined) !== (entry.volumeNumber === undefined)) {
      invalid(
        'chapter_volume_reference_incomplete',
        'Chapter volumeId and volumeNumber must either both be present or both be absent',
      );
    }
  }

  assertCandidateSourceOrder(index);
  assertEntryCandidateBindings(index);
  assertVolumeReferences(index.entries);
  assertReviewStatus(index);
  assertCompleteCoverage(index.coverageReport);
  assertChapterCoverageOrder(index.entries, index.coverageReport);
  return index;
}

export function getChapterCoverageRatioV1(report: CoverageReportV1): number {
  if (report.totalByteLength === 0)
    return 1;
  return report.classifiedByteLength / report.totalByteLength;
}

function parseContract(value: ChapterIndexV1): ChapterIndexV1 {
  try {
    return parseChapterIndexV1(value);
  } catch (error) {
    invalid(
      'chapter_index_contract_invalid',
      `Chapter index violates ChapterIndexV1: ${errorMessage(error)}`,
    );
  }
}

function assertCandidateSourceOrder(index: ChapterIndexV1): void {
  let previous: TextRangeV1 | undefined;
  for (const candidate of index.candidates) {
    if (
      previous !== undefined
      && (candidate.headingRange.startByte < previous.startByte
        || (candidate.headingRange.startByte === previous.startByte
          && candidate.headingRange.endByte < previous.endByte))
    ) {
      invalid(
        'chapter_candidates_not_in_source_order',
        'Chapter candidates must be ordered by canonical source range',
      );
    }
    previous = candidate.headingRange;
  }
}

function assertEntryCandidateBindings(index: ChapterIndexV1): void {
  const candidatesByRange = new Map<string, ChapterIndexV1['candidates'][number][]>();
  for (const candidate of index.candidates) {
    if (candidate.reviewStatus === 'pending' || candidate.reviewStatus === 'rejected')
      continue;
    const key = rangeKey(candidate.headingRange);
    const matching = candidatesByRange.get(key);
    if (matching === undefined)
      candidatesByRange.set(key, [candidate]);
    else
      matching.push(candidate);
  }
  for (const entry of index.entries) {
    const candidates = candidatesByRange.get(rangeKey(entry.headingRange)) ?? [];
    if (candidates.length !== 1) {
      invalid(
        'chapter_entry_candidate_binding_invalid',
        'Every chapter entry must bind to exactly one accepted heading candidate',
      );
    }
    const [candidate] = candidates;
    if (
      candidate.evidence.includes('structural-role:volume-marker')
      || candidate.evidence.includes(
        'directory-context:after-marker-before-explicit-boundary',
      )
      || entry.title !== candidate.normalizedTitle
      || entry.rawHeading !== candidate.rawTitle
      || entry.confidence !== candidate.ruleConfidence
      || entry.detectedBy !== `rule:${candidate.ruleId}@${candidate.ruleVersion}`
      || entry.reviewStatus !== candidate.reviewStatus
      || entry.sourceLineRange.startLine !== candidate.lineRange.startLine
      || entry.sourceLineRange.endLineExclusive
      < candidate.lineRange.endLineExclusive
    ) {
      invalid(
        'chapter_entry_candidate_projection_invalid',
        'Chapter entry fields must be an exact projection of its accepted candidate',
      );
    }
  }
}

function assertVolumeReferences(entries: readonly ChapterIndexEntryV1[]): void {
  const numbersById = new Map<string, string>();
  for (const entry of entries) {
    if (entry.volumeId === undefined || entry.volumeNumber === undefined)
      continue;
    const existingNumber = numbersById.get(entry.volumeId);
    if (existingNumber !== undefined && existingNumber !== entry.volumeNumber) {
      invalid(
        'chapter_volume_reference_inconsistent',
        'A volumeId must resolve to exactly one volumeNumber',
      );
    }
    numbersById.set(entry.volumeId, entry.volumeNumber);
  }
}

function assertReviewStatus(index: ChapterIndexV1): void {
  const hasPending = index.candidates.some(item => item.reviewStatus === 'pending')
    || index.entries.some(item => item.reviewStatus === 'pending')
    || index.issues.some(item => item.reviewStatus === 'pending');
  if (
    (hasPending && index.reviewStatus !== 'pending')
    || (!hasPending && index.reviewStatus === 'pending')
  ) {
    invalid(
      'chapter_review_status_inconsistent',
      'ChapterIndex reviewStatus must agree with pending candidates, entries, and issues',
    );
  }
}

function assertCompleteCoverage(report: CoverageReportV1): void {
  if (
    !report.complete
    || report.unclassifiedByteLength !== 0
    || report.unclassifiedRanges.length !== 0
    || report.classifiedByteLength !== report.totalByteLength
  ) {
    invalid(
      'chapter_coverage_incomplete',
      'M1 ChapterIndex coverage must classify every canonical input byte',
    );
  }

  let cursor = 0;
  for (const segment of report.segments) {
    if (segment.range.startByte !== cursor) {
      invalid(
        'chapter_coverage_not_contiguous',
        'Chapter coverage segments must form one contiguous source-order partition',
      );
    }
    cursor = segment.range.endByte;
  }
  if (cursor !== report.totalByteLength) {
    invalid(
      'chapter_coverage_not_contiguous',
      'Chapter coverage segments must reach the canonical revision end',
    );
  }
}

function assertChapterCoverageOrder(
  entries: readonly ChapterIndexEntryV1[],
  report: CoverageReportV1,
): void {
  const chapterSegments = report.segments.filter(segment =>
    segment.classification === 'chapter');
  if (chapterSegments.length !== entries.length) {
    invalid(
      'chapter_coverage_entry_count_mismatch',
      'Chapter coverage order must contain exactly one segment per entry',
    );
  }
  for (const [position, entry] of entries.entries()) {
    if (chapterSegments[position]?.chapterId !== entry.chapterId) {
      invalid(
        'chapter_coverage_entry_order_mismatch',
        'Chapter coverage segments must follow ChapterIndex entry source order',
      );
    }
  }
}

function rangeKey(range: TextRangeV1): string {
  return JSON.stringify([
    range.textRevisionId,
    range.textLayer,
    range.offsetUnit,
    range.startByte,
    range.endByte,
  ]);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

function invalid(detailReason: string, message: string): never {
  throw new ChapterIndexDomainValidationError(detailReason, message);
}
