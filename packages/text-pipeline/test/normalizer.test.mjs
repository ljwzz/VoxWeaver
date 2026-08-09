import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  buildChapterIndexV1,
  detectChapterCandidatesV1,
  discoverNormalizationProposalsV1,
  NORMALIZATION_RULE_IDS,
  NormalizationExecutionError,
  NormalizationProposalValidationError,
  normalizeTextV1,
  restoreCanonicalTextFromNormalizationV1,
  validateNormalizationProposalsV1,
} from '../dist/index.js';

test('discovers only regularly spaced exact full-line repetitions as high-risk pending proposals', () => {
  const text = [
    '固定页眉',
    '甲',
    '乙',
    '丙',
    '固定页眉',
    '丁',
    '戊',
    '己',
    '固定页眉',
    '“合理重复对白。”',
    '庚',
    '辛',
    '“合理重复对白。”',
    '壬',
    '癸',
    '子',
    '“合理重复对白。”',
  ].join('\n');
  const discovered = discover(text);
  const repeated = discovered.filter(proposal =>
    proposal.ruleId === NORMALIZATION_RULE_IDS.repeatedStructuralLine);

  assert.equal(repeated.length, 3);
  assert.ok(repeated.every(proposal => proposal.beforeText.trim() === '固定页眉'));
  assert.ok(repeated.every(proposal => proposal.risk === 'high'));
  assert.ok(repeated.every(proposal => proposal.reviewStatus === 'pending'));
  assert.ok(repeated.every(proposal =>
    proposal.evidence.includes('exact-occurrence-count:3')));
  assert.ok(!discovered.some(proposal => proposal.beforeText.includes('合理重复对白')));
});

test('discovers only explicitly anchored full-line advertisements', () => {
  const text = [
    '正文内提到【广告】两个字，不应删除。',
    '【广告】关注公开测试频道',
    '另一个正文广告提及。',
  ].join('\n');
  const proposals = discover(text);
  const advertisements = proposals.filter(proposal =>
    proposal.ruleId === NORMALIZATION_RULE_IDS.advertisementLine);

  assert.equal(advertisements.length, 1);
  assert.equal(advertisements[0].beforeText, '【广告】关注公开测试频道\n');
  assert.equal(advertisements[0].operation, 'delete');
  assert.equal(advertisements[0].risk, 'high');
});

test('uses a validated ChapterIndex only at content start for repeated title proposals', () => {
  const index = createIndex([
    ['第一章 起点\n', 'heading'],
    ['第一章 起点\n', 'paragraph'],
    ['正文普通提及第一章 起点，不删除。\n', 'paragraph'],
  ]);
  const chapterIndex = buildChapterIndexV1({
    blockIndex: index,
    candidates: detectChapterCandidatesV1(index, {
      candidateIdFactory: sequentialIdFactory(1_000),
    }).slice(0, 1),
    options: factories(2_000),
  });
  const proposals = discoverNormalizationProposalsV1({
    canonicalTextRevision: index.canonicalTextRevision,
    canonicalText: index.blocks.map(block => block.canonicalText).join(''),
    chapterIndex,
    options: { proposalIdFactory: sequentialIdFactory(3_000) },
  });
  const repeatedTitle = proposals.filter(proposal =>
    proposal.ruleId === NORMALIZATION_RULE_IDS.repeatedChapterHeading);

  assert.equal(repeatedTitle.length, 1);
  assert.equal(repeatedTitle[0].beforeText, '第一章 起点\n');
  assert.ok(repeatedTitle[0].evidence.includes('first-non-empty-content-line'));
  assert.ok(!proposals.some(proposal => proposal.beforeText.includes('正文普通提及')));
});

test('proposes deterministic excess blank-line replacement without changing canonical input', () => {
  const text = '甲😀\n\n \n\t\n\n乙\n';
  const revisionValue = revision(uuid(4_000), 'canonical', text);
  const proposals = discoverNormalizationProposalsV1({
    canonicalTextRevision: revisionValue,
    canonicalText: text,
    options: { proposalIdFactory: sequentialIdFactory(4_100) },
  });
  const blank = proposals.find(proposal =>
    proposal.ruleId === NORMALIZATION_RULE_IDS.excessBlankLines);

  assert.ok(blank);
  assert.equal(blank.operation, 'replace');
  assert.equal(blank.afterText, '\n\n');
  assert.equal(blank.risk, 'low');
  const dryRun = normalizeTextV1({
    canonicalTextRevision: revisionValue,
    canonicalText: text,
    proposals,
  });
  assert.equal(dryRun.mode, 'dry-run');
  assert.equal(dryRun.applied, false);
  assert.equal(dryRun.prospectiveNormalizedText, '甲😀\n\n\n乙\n');
  assert.equal(text, '甲😀\n\n \n\t\n\n乙\n');
  assert.equal('normalizedTextRevision' in dryRun, false);
  assert.equal('rangeMap' in dryRun, false);
});

test('links overlapping discoveries and dry run applies a stable single preview edit', () => {
  const text = [
    '【广告】',
    '甲',
    '乙',
    '丙',
    '【广告】',
    '丁',
    '戊',
    '己',
    '【广告】',
  ].join('\n');
  const proposals = discover(text);
  const conflicts = proposals.filter(proposal => proposal.conflictProposalIds.length > 0);

  assert.equal(conflicts.length, 6);
  for (const proposal of conflicts) {
    for (const conflictId of proposal.conflictProposalIds) {
      const other = proposals.find(item => item.proposalId === conflictId);
      assert.ok(other?.conflictProposalIds.includes(proposal.proposalId));
      assert.equal(proposal.reviewStatus, 'pending');
    }
  }
  const result = normalizeTextV1(normalizeInput(text, proposals));
  assert.equal(result.mode, 'dry-run');
  assert.equal(result.previewChanges.length, 3);
  assert.equal(result.skippedProposals.filter(item => item.reason === 'overlap').length, 3);
  const improperlyApproved = conflicts.map(proposal => ({
    ...proposal,
    reviewStatus: 'approved',
    reviewedBy: 'reviewer:test',
    operator: 'operator:test',
  }));
  assert.throws(
    () => normalizeTextV1({
      ...normalizeInput(text, improperlyApproved),
      mode: 'apply',
      normalizedTextRevisionId: uuid(4_500),
    }),
    error => isProposalError(error, 'normalization_proposal_conflict_review_invalid'),
  );

  const resolved = proposals.map(proposal => proposal.ruleId === NORMALIZATION_RULE_IDS.advertisementLine
    ? {
        ...proposal,
        reviewStatus: 'approved',
        reviewedBy: 'reviewer:test',
        operator: 'operator:test',
      }
    : {
        ...proposal,
        reviewStatus: 'rejected',
        reviewedBy: 'reviewer:test',
      });
  const applied = normalizeTextV1({
    ...normalizeInput(text, resolved),
    mode: 'apply',
    normalizedTextRevisionId: uuid(4_600),
  });
  assert.equal(applied.normalizedText, '甲\n乙\n丙\n丁\n戊\n己\n');
  assert.equal(applied.changes.length, 3);
});

test('rejected proposals leave preview unchanged and explicit pending apply is rejected', () => {
  const text = '【广告】测试\n正文。\n';
  const [pending] = discover(text);
  const rejected = {
    ...pending,
    reviewStatus: 'rejected',
    reviewedBy: 'reviewer:test',
  };
  const dryRun = normalizeTextV1(normalizeInput(text, [rejected]));

  assert.equal(dryRun.prospectiveNormalizedText, text);
  assert.equal(dryRun.previewChanges.length, 0);
  assert.deepEqual(dryRun.skippedProposals, [{
    proposalId: rejected.proposalId,
    reason: 'rejected',
    conflictWithProposalIds: [],
  }]);
  const ignoredPending = normalizeTextV1({
    ...normalizeInput(text, [pending]),
    mode: 'apply',
    normalizedTextRevisionId: uuid(4_900),
  });
  assert.equal(ignoredPending.normalizedText, text);
  assert.deepEqual(ignoredPending.changes, []);
  assert.throws(
    () => normalizeTextV1({
      ...normalizeInput(text, [pending]),
      mode: 'apply',
      selectedProposalIds: [pending.proposalId],
      normalizedTextRevisionId: uuid(5_000),
    }),
    error => isExecutionError(error, 'normalization_proposal_not_approved'),
  );
  assert.throws(
    () => normalizeTextV1({
      ...normalizeInput(text, [pending]),
      mode: 'apply',
      normalizedTextRevisionId: 'not-a-uuid',
    }),
    error => isExecutionError(error, 'normalized_revision_id_invalid'),
  );
});

test('applies only approved proposals to a distinct normalized revision and reverses exact diff', () => {
  const text = '甲😀\n\n\n\n乙\n【广告】测试\n尾声。\n';
  const revisionValue = revision(uuid(6_000), 'canonical', text);
  const proposals = discoverNormalizationProposalsV1({
    canonicalTextRevision: revisionValue,
    canonicalText: text,
    options: { proposalIdFactory: sequentialIdFactory(6_100) },
  });
  const approved = proposals.map(proposal => ({
    ...proposal,
    reviewStatus: 'approved',
    reviewedBy: 'reviewer:test',
    operator: 'operator:test',
  }));
  const result = normalizeTextV1({
    canonicalTextRevision: revisionValue,
    canonicalText: text,
    proposals: approved,
    mode: 'apply',
    normalizedTextRevisionId: uuid(6_500),
  });

  assert.equal(result.mode, 'apply');
  assert.equal(result.applied, true);
  assert.equal(result.normalizedText, '甲😀\n\n\n乙\n尾声。\n');
  assert.equal(result.normalizedTextRevision.textLayer, 'normalized');
  assert.notEqual(result.normalizedTextRevision.textRevisionId, revisionValue.textRevisionId);
  assert.ok(result.changes.every(change => change.operator === 'operator:test'));
  assert.equal(result.rangeMap.inputRevision.contentHash, revisionValue.contentHash);
  assert.equal(result.rangeMap.outputRevision.contentHash, sha256(result.normalizedText));
  assert.equal(
    restoreCanonicalTextFromNormalizationV1({
      normalizedTextRevision: result.normalizedTextRevision,
      normalizedText: result.normalizedText,
      canonicalTextRevision: revisionValue,
      changes: result.changes,
    }),
    text,
  );
});

test('rejects stale normalized text, tampered diff, and wrong revision during reversal', () => {
  const { result, revisionValue, text } = appliedBlankRun();
  assert.throws(
    () => restoreCanonicalTextFromNormalizationV1({
      normalizedTextRevision: result.normalizedTextRevision,
      normalizedText: `${result.normalizedText}篡改`,
      canonicalTextRevision: revisionValue,
      changes: result.changes,
    }),
    error => isExecutionError(error, 'normalized_revision_mismatch'),
  );
  assert.throws(
    () => restoreCanonicalTextFromNormalizationV1({
      normalizedTextRevision: result.normalizedTextRevision,
      normalizedText: result.normalizedText,
      canonicalTextRevision: revisionValue,
      changes: [{ ...result.changes[0], afterText: '篡改' }],
    }),
    error => isExecutionError(error, 'normalization_change_after_text_mismatch'),
  );
  assert.throws(
    () => restoreCanonicalTextFromNormalizationV1({
      normalizedTextRevision: result.normalizedTextRevision,
      normalizedText: result.normalizedText,
      canonicalTextRevision: revisionValue,
      changes: [{
        ...result.changes[0],
        normalizedRange: { ...result.changes[0].normalizedRange, startByte: 1 },
      }],
    }),
    error => isExecutionError(error, 'normalization_change_range_invalid'),
  );
  assert.throws(
    () => restoreCanonicalTextFromNormalizationV1({
      normalizedTextRevision: result.normalizedTextRevision,
      normalizedText: result.normalizedText,
      canonicalTextRevision: revision(uuid(7_999), 'canonical', text),
      changes: result.changes,
    }),
    error => isExecutionError(error, 'normalization_change_range_invalid'),
  );
  assert.throws(
    () => restoreCanonicalTextFromNormalizationV1({
      normalizedTextRevision: result.normalizedTextRevision,
      normalizedText: result.normalizedText,
      canonicalTextRevision: revisionValue,
      changes: [null],
    }),
    error => isExecutionError(error, 'normalization_change_invalid'),
  );
  assert.throws(
    () => restoreCanonicalTextFromNormalizationV1({
      normalizedTextRevision: result.normalizedTextRevision,
      normalizedText: result.normalizedText,
      canonicalTextRevision: revisionValue,
      changes: [{
        ...result.changes[0],
        canonicalRange: {
          ...result.changes[0].canonicalRange,
          endByte: result.changes[0].canonicalRange.startByte,
        },
        beforeText: '',
      }],
    }),
    error => isExecutionError(error, 'normalization_change_operation_invalid'),
  );
});

test('validates revision, UUID, UTF-8 boundary, exact text, review fields, and overlap references', () => {
  const text = '😀\n【广告】测试\n正文。\n';
  const revisionValue = revision(uuid(8_000), 'canonical', text);
  const [proposal] = discoverNormalizationProposalsV1({
    canonicalTextRevision: revisionValue,
    canonicalText: text,
    options: { proposalIdFactory: sequentialIdFactory(8_100) },
  });
  const cases = [
    {
      reason: 'normalization_proposal_id_invalid',
      value: { ...proposal, proposalId: 'not-a-uuid' },
    },
    {
      reason: 'normalization_proposal_range_invalid',
      value: {
        ...proposal,
        canonicalRange: { ...proposal.canonicalRange, startByte: 1 },
      },
    },
    {
      reason: 'normalization_proposal_before_text_mismatch',
      value: { ...proposal, beforeText: '篡改\n' },
    },
    {
      reason: 'normalization_proposal_text_invalid',
      value: { ...proposal, beforeText: null },
    },
    {
      reason: 'normalization_proposal_approval_invalid',
      value: { ...proposal, reviewStatus: 'approved' },
    },
  ];
  for (const item of cases) {
    assert.throws(
      () => validateNormalizationProposalsV1({
        canonicalTextRevision: revisionValue,
        canonicalText: text,
        proposals: [item.value],
      }),
      error => isProposalError(error, item.reason),
    );
  }
  assert.throws(
    () => validateNormalizationProposalsV1({
      canonicalTextRevision: revisionValue,
      canonicalText: text,
      proposals: [proposal, { ...proposal, proposalId: uuid(8_200) }],
    }),
    error => isProposalError(error, 'normalization_proposal_overlap_untracked'),
  );
  assert.throws(
    () => discoverNormalizationProposalsV1({
      canonicalTextRevision: { ...revisionValue, contentHash: '0'.repeat(64) },
      canonicalText: text,
    }),
    error => isProposalError(error, 'canonical_revision_mismatch'),
  );
});

test('validates throwing, invalid, and duplicate proposal ID factories', () => {
  const text = '【广告】一\n【广告】二\n';
  const revisionValue = revision(uuid(9_000), 'canonical', text);
  const run = proposalIdFactory => discoverNormalizationProposalsV1({
    canonicalTextRevision: revisionValue,
    canonicalText: text,
    options: { proposalIdFactory },
  });
  assert.throws(
    () => run(() => { throw new Error('synthetic'); }),
    error => isProposalError(error, 'normalization_proposal_id_factory_failed'),
  );
  assert.throws(
    () => run(() => 'invalid'),
    error => isProposalError(error, 'normalization_proposal_id_invalid'),
  );
  assert.throws(
    () => run(() => uuid(9_100)),
    error => isProposalError(error, 'normalization_proposal_id_duplicate'),
  );
});

test('does not mutate proposal input order and is idempotent after applying deterministic blank-line edit', () => {
  const { result } = appliedBlankRun();
  const proposals = discover(result.normalizedText);
  const reversed = [...proposals].reverse();
  const idsBefore = reversed.map(proposal => proposal.proposalId);
  normalizeTextV1(normalizeInput(result.normalizedText, reversed));
  assert.deepEqual(reversed.map(proposal => proposal.proposalId), idsBefore);
  assert.equal(proposals.length, 0);
});

test('handles empty canonical text as an unchanged dry run', () => {
  const text = '';
  const revisionValue = revision(uuid(11_000), 'canonical', text);
  const proposals = discoverNormalizationProposalsV1({
    canonicalTextRevision: revisionValue,
    canonicalText: text,
  });
  const result = normalizeTextV1({
    canonicalTextRevision: revisionValue,
    canonicalText: text,
    proposals,
  });

  assert.deepEqual(proposals, []);
  assert.equal(result.prospectiveNormalizedText, '');
  assert.deepEqual(result.previewChanges, []);
});

function appliedBlankRun() {
  const text = '甲\n\n\n\n乙\n';
  const revisionValue = revision(uuid(7_000), 'canonical', text);
  const [proposal] = discoverNormalizationProposalsV1({
    canonicalTextRevision: revisionValue,
    canonicalText: text,
    options: { proposalIdFactory: sequentialIdFactory(7_100) },
  });
  const approved = {
    ...proposal,
    reviewStatus: 'approved',
    reviewedBy: 'reviewer:test',
    operator: 'operator:test',
  };
  const result = normalizeTextV1({
    canonicalTextRevision: revisionValue,
    canonicalText: text,
    proposals: [approved],
    mode: 'apply',
    normalizedTextRevisionId: uuid(7_200),
  });
  return { result, revisionValue, text };
}

function discover(text) {
  const revisionValue = revision(uuid(100), 'canonical', text);
  return discoverNormalizationProposalsV1({
    canonicalTextRevision: revisionValue,
    canonicalText: text,
    options: { proposalIdFactory: sequentialIdFactory(200) },
  });
}

function normalizeInput(text, proposals) {
  return {
    canonicalTextRevision: revision(uuid(100), 'canonical', text),
    canonicalText: text,
    proposals,
  };
}

function createIndex(blockSpecs) {
  const sourceAssetId = uuid(20_000);
  const rawRevisionId = uuid(20_001);
  const canonicalRevisionId = uuid(20_002);
  const text = blockSpecs.map(([value]) => value).join('');
  const hash = sha256(text);
  let byteCursor = 0;
  let lineCursor = 1;
  const blocks = blockSpecs.map(([canonicalText, kind], index) => {
    const startByte = byteCursor;
    byteCursor += Buffer.byteLength(canonicalText, 'utf8');
    const startLine = lineCursor;
    lineCursor += Math.max(1, [...canonicalText].filter(character => character === '\n').length);
    return {
      blockId: uuid(20_100 + index),
      kind,
      canonicalText,
      canonicalRange: textRange(canonicalRevisionId, 'canonical', startByte, byteCursor),
      contentHash: sha256(canonicalText),
      sourceLocator: {
        sourceAssetId,
        sourceContentHash: hash,
        sourceEncoding: 'utf-8',
        sourceByteRange: { offsetUnit: 'source-byte', startByte, endByte: byteCursor },
        rawTextRange: textRange(rawRevisionId, 'raw', startByte, byteCursor),
        lineRange: { lineBase: 1, startLine, endLineExclusive: lineCursor },
      },
    };
  });
  return {
    documentType: 'document-block-index',
    schemaVersion: 1,
    alignmentPolicyVersion: 'm1-block-alignment-v1',
    sourceAssetId,
    sourceContentHash: hash,
    sourceByteLength: Buffer.byteLength(text, 'utf8'),
    sourceEncoding: 'utf-8',
    rawTextRevision: revision(rawRevisionId, 'raw', text),
    canonicalTextRevision: revision(canonicalRevisionId, 'canonical', text),
    blocks,
    issues: [],
    reviewStatus: 'not_required',
  };
}

function factories(start) {
  return {
    chapterIdFactory: sequentialIdFactory(start),
    volumeIdFactory: sequentialIdFactory(start + 100),
    issueIdFactory: sequentialIdFactory(start + 200),
  };
}

function revision(textRevisionId, textLayer, text) {
  return {
    textRevisionId,
    textLayer,
    contentHash: sha256(text),
    byteLength: Buffer.byteLength(text, 'utf8'),
  };
}

function textRange(textRevisionId, textLayer, startByte, endByte) {
  return { textRevisionId, textLayer, offsetUnit: 'utf8-byte', startByte, endByte };
}

function sequentialIdFactory(start) {
  let value = start;
  return () => uuid(value++);
}

function uuid(value) {
  return `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function isProposalError(error, detailReason) {
  return error instanceof NormalizationProposalValidationError
    && error.code === 'NOVEL_IMPORT_STRUCTURE_INVALID'
    && error.detailReason === detailReason;
}

function isExecutionError(error, detailReason) {
  return error instanceof NormalizationExecutionError
    && error.code === 'NOVEL_IMPORT_STRUCTURE_INVALID'
    && error.detailReason === detailReason;
}
