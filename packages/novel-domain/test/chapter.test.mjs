import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ChapterIndexDomainValidationError,
  getChapterCoverageRatioV1,
  validateChapterIndexDomainV1,
} from '../dist/index.js';

test('accepts a source-ordered index with complete classified coverage', () => {
  const index = fixture();
  assert.equal(validateChapterIndexDomainV1(index), index);
  assert.equal(getChapterCoverageRatioV1(index.coverageReport), 1);
  assert.equal(getChapterCoverageRatioV1({
    ...index.coverageReport,
    totalByteLength: 0,
    classifiedByteLength: 0,
    segments: [],
  }), 1);
});

test('requires contiguous entry order and adjacent heading/content ranges', () => {
  const index = fixture();
  assert.throws(
    () => validateChapterIndexDomainV1({
      ...index,
      entries: [{ ...index.entries[0], order: 1 }],
    }),
    error => isDomainError(error, 'chapter_order_invalid'),
  );
  assert.throws(
    () => validateChapterIndexDomainV1({
      ...index,
      entries: [{
        ...index.entries[0],
        contentRange: { ...index.entries[0].contentRange, startByte: 4 },
      }],
    }),
    error => isDomainError(error, 'chapter_boundary_gap'),
  );
});

test('requires complete volume references and source-ordered candidates', () => {
  const index = fixture();
  assert.throws(
    () => validateChapterIndexDomainV1({
      ...index,
      entries: [{ ...index.entries[0], volumeId: uuid(8) }],
    }),
    error => isDomainError(error, 'chapter_volume_reference_incomplete'),
  );
  assert.throws(
    () => validateChapterIndexDomainV1({
      ...index,
      candidates: [...index.candidates].reverse(),
    }),
    error => isDomainError(error, 'chapter_candidates_not_in_source_order'),
  );
});

test('requires exact accepted-candidate projections and consistent review status', () => {
  const index = fixture();
  assert.throws(
    () => validateChapterIndexDomainV1({
      ...index,
      entries: [{ ...index.entries[0], title: '不匹配' }],
    }),
    error => isDomainError(error, 'chapter_entry_candidate_projection_invalid'),
  );
  assert.throws(
    () => validateChapterIndexDomainV1({ ...index, candidates: [] }),
    error => isDomainError(error, 'chapter_entry_candidate_binding_invalid'),
  );
  assert.throws(
    () => validateChapterIndexDomainV1({
      ...index,
      candidates: [{
        ...index.candidates[0],
        evidence: [...index.candidates[0].evidence, 'structural-role:volume-marker'],
      }, index.candidates[1]],
    }),
    error => isDomainError(error, 'chapter_entry_candidate_projection_invalid'),
  );
  assert.throws(
    () => validateChapterIndexDomainV1({ ...index, reviewStatus: 'pending' }),
    error => isDomainError(error, 'chapter_review_status_inconsistent'),
  );
});

test('does not allow one volume ID to resolve to different volume numbers', () => {
  const index = twoEntryFixture();
  assert.throws(
    () => validateChapterIndexDomainV1(index),
    error => isDomainError(error, 'chapter_volume_reference_inconsistent'),
  );
});

test('rejects incomplete or non-contiguous classified coverage', () => {
  const index = fixture();
  assert.throws(
    () => validateChapterIndexDomainV1({
      ...index,
      entries: [],
      coverageReport: {
        ...index.coverageReport,
        classifiedByteLength: 8,
        unclassifiedByteLength: 1,
        complete: false,
        segments: [{
          classification: 'unknown',
          range: range(0, 8),
        }],
        unclassifiedRanges: [range(8, 9)],
      },
    }),
    error => isDomainError(error, 'chapter_coverage_incomplete'),
  );
});

test('wraps frozen contract failures as typed domain failures', () => {
  const index = fixture();
  assert.throws(
    () => validateChapterIndexDomainV1({
      ...index,
      textRevision: { ...index.textRevision, textLayer: 'raw' },
    }),
    error => isDomainError(error, 'chapter_index_contract_invalid'),
  );
});

function fixture() {
  const candidateOne = candidate(uuid(10), 0, 3, '前言');
  const candidateTwo = candidate(uuid(11), 5, 9, '第一章');
  const chapterId = uuid(20);
  return {
    documentType: 'chapter-index',
    schemaVersion: 1,
    sourceAssetId: uuid(1),
    sourceHash: 'a'.repeat(64),
    processorId: 'test',
    processorVersion: '1',
    textRevision: revision(),
    candidates: [candidateOne, candidateTwo],
    entries: [{
      chapterId,
      order: 0,
      title: '前言',
      rawHeading: '前言',
      headingRange: range(0, 3),
      contentRange: range(3, 9),
      sourceLineRange: { lineBase: 1, startLine: 1, endLineExclusive: 3 },
      confidence: 1,
      detectedBy: 'rule:test@1',
      reviewStatus: 'not_required',
    }],
    coverageReport: {
      textRevisionId: revision().textRevisionId,
      textLayer: 'canonical',
      totalByteLength: 9,
      classifiedByteLength: 9,
      unclassifiedByteLength: 0,
      complete: true,
      segments: [{ classification: 'chapter', range: range(0, 9), chapterId }],
      unclassifiedRanges: [],
    },
    issues: [],
    reviewStatus: 'not_required',
  };
}

function twoEntryFixture() {
  const base = fixture();
  const volumeId = uuid(8);
  const firstChapterId = uuid(20);
  const secondChapterId = uuid(21);
  const firstCandidate = candidate(uuid(10), 0, 3, '前言');
  const secondCandidate = candidate(uuid(11), 5, 9, '第一章');
  return {
    ...base,
    candidates: [firstCandidate, secondCandidate],
    entries: [
      {
        ...base.entries[0],
        chapterId: firstChapterId,
        volumeId,
        volumeNumber: '1',
        contentRange: range(3, 5),
      },
      {
        ...base.entries[0],
        chapterId: secondChapterId,
        order: 1,
        volumeId,
        volumeNumber: '2',
        title: secondCandidate.normalizedTitle,
        rawHeading: secondCandidate.rawTitle,
        headingRange: secondCandidate.headingRange,
        contentRange: range(9, 9),
      },
    ],
    coverageReport: {
      ...base.coverageReport,
      segments: [
        { classification: 'chapter', range: range(0, 5), chapterId: firstChapterId },
        { classification: 'chapter', range: range(5, 9), chapterId: secondChapterId },
      ],
    },
  };
}

function candidate(chapterCandidateId, startByte, endByte, rawTitle) {
  return {
    chapterCandidateId,
    headingRange: range(startByte, endByte),
    lineRange: { lineBase: 1, startLine: 1, endLineExclusive: 2 },
    rawTitle,
    normalizedTitle: rawTitle,
    ruleId: 'test',
    ruleVersion: '1',
    ruleConfidence: 1,
    confidenceSource: 'test evidence',
    evidence: ['test'],
    contextBefore: [],
    contextAfter: [],
    reviewStatus: 'not_required',
  };
}

function revision() {
  return {
    textRevisionId: uuid(2),
    textLayer: 'canonical',
    contentHash: 'b'.repeat(64),
    byteLength: 9,
  };
}

function range(startByte, endByte) {
  return {
    textRevisionId: revision().textRevisionId,
    textLayer: 'canonical',
    offsetUnit: 'utf8-byte',
    startByte,
    endByte,
  };
}

function uuid(value) {
  return `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
}

function isDomainError(error, detailReason) {
  return error instanceof ChapterIndexDomainValidationError
    && error.code === 'NOVEL_IMPORT_STRUCTURE_INVALID'
    && error.detailReason === detailReason;
}
