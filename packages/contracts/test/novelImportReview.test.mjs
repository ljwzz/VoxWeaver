import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import Ajv2020 from 'ajv/dist/2020.js';

import {
  NOVEL_IMPORT_REVIEW_SCHEMA,
  NOVEL_IMPORT_REVIEW_SCHEMA_VERSION,
  NovelImportReviewValidationError,
  parseNovelImportReviewCommandV1,
  parseNovelImportReviewDocumentV1,
  parseNovelImportReviewQueryV1,
  parseNovelImportReviewSnapshotV1,
  parseNovelImportStalePreviewQueryV1,
  parseNovelImportStalePreviewV1,
} from '../dist/index.js';

const ARTIFACT_ID = uuid(1);
const ARTIFACT_REVISION_ID = uuid(2);
const NEXT_ARTIFACT_REVISION_ID = uuid(3);
const SOURCE_ASSET_ID = uuid(4);
const RAW_REVISION_ID = uuid(5);
const CANONICAL_REVISION_ID = uuid(6);
const NORMALIZED_REVISION_ID = uuid(7);
const BLOCK_ID = uuid(8);
const CANDIDATE_ID = uuid(9);
const CHAPTER_ID = uuid(10);
const EVIDENCE_ID = uuid(11);
const ISSUE_ID = uuid(12);
const PROPOSAL_ID = uuid(13);
const SECOND_PROPOSAL_ID = uuid(16);
const CONSUMER_ARTIFACT_ID = uuid(14);
const CONSUMER_REVISION_ID = uuid(15);

const RAW_TEXT = 'Title\r\nBody';
const CANONICAL_TEXT = 'Title\nBody';

const documentedTextSchema = JSON.parse(
  await readFile(
    new URL('../../../docs/schemas/text-reference.schema.json', import.meta.url),
    'utf8',
  ),
);
const documentedNovelImportSchema = JSON.parse(
  await readFile(
    new URL('../../../docs/schemas/novel-import.schema.json', import.meta.url),
    'utf8',
  ),
);
const documentedReviewSchema = JSON.parse(
  await readFile(
    new URL(
      '../../../docs/schemas/novel-import-review.schema.json',
      import.meta.url,
    ),
    'utf8',
  ),
);

test('keeps the documented review schema equal to the runtime schema', () => {
  assert.deepEqual(documentedReviewSchema, NOVEL_IMPORT_REVIEW_SCHEMA);
});

test('validates every documented review DTO variant with shared schemas', () => {
  const ajv = new Ajv2020({ allErrors: true });
  ajv.addSchema(documentedTextSchema);
  ajv.addSchema(documentedNovelImportSchema);
  const validate = ajv.compile(documentedReviewSchema);

  for (const value of [
    reviewQuery(),
    boundaryCommand(),
    snapshot(),
    stalePreviewQuery(),
    stalePreview(),
  ]) {
    assert.equal(validate(value), true, ajv.errorsText(validate.errors));
  }
});

test('accepts a baseline-bound query and enforces its read-only marker', () => {
  const value = reviewQuery();
  assert.equal(parseNovelImportReviewQueryV1(value), value);
  assert.equal(parseNovelImportReviewDocumentV1(value), value);

  for (const invalid of [
    { ...value, readOnly: false },
    { ...value, unknown: true },
    {
      ...value,
      baselineRevision: {
        ...value.baselineRevision,
        canonicalTextRevision: revision(RAW_REVISION_ID, 'raw', RAW_TEXT),
      },
    },
  ]) {
    assert.throws(
      () => parseNovelImportReviewQueryV1(invalid),
      NovelImportReviewValidationError,
    );
  }
});

test('accepts all adjustment commands with the same explicit baseline', () => {
  const commands = [
    classifyCommand(),
    boundaryCommand(),
    normalizationCommand(),
    rerunCommand(),
  ];
  for (const command of commands) {
    assert.equal(parseNovelImportReviewCommandV1(command), command);
    assert.equal(parseNovelImportReviewDocumentV1(command), command);
  }
});

test('rejects invalid commands, stale ranges, and ranges outside the baseline', () => {
  const baseBoundary = boundaryCommand();
  const baseClassification = classifyCommand();
  const invalid = [
    { ...baseBoundary, schemaVersion: 2 },
    { ...baseBoundary, commandType: 'merge-chapters' },
    { ...baseBoundary, unknown: true },
    {
      ...baseBoundary,
      headingRange: range(CANONICAL_REVISION_ID, 'canonical', 0, 11),
    },
    {
      ...baseBoundary,
      headingRange: range(RAW_REVISION_ID, 'raw', 0, 5),
    },
    {
      ...baseBoundary,
      headingRange: range(CANONICAL_REVISION_ID, 'canonical', 0, 7),
      contentRange: range(CANONICAL_REVISION_ID, 'canonical', 6, 8),
    },
    {
      ...baseBoundary,
      headingRange: range(CANONICAL_REVISION_ID, 'canonical', 0, 5),
      contentRange: range(CANONICAL_REVISION_ID, 'canonical', 6, 8),
    },
    {
      ...baseClassification,
      targetRange: range(CANONICAL_REVISION_ID, 'canonical', 8, 8),
    },
    { ...baseClassification, classification: 'chapter' },
    { ...rerunCommand(), selector: {} },
    { ...normalizationCommand(), decision: 'ignored' },
  ];

  for (const value of invalid) {
    assert.throws(
      () => parseNovelImportReviewCommandV1(value),
      NovelImportReviewValidationError,
    );
  }
});

test('accepts a complete inspection projection for all M1 review data', () => {
  const value = snapshot();
  assert.equal(parseNovelImportReviewSnapshotV1(value), value);
  assert.equal(parseNovelImportReviewDocumentV1(value), value);
  assert.equal(value.source.format, 'txt');
  assert.equal(value.layerDiffs.length, 2);
  assert.equal(value.tableOfContentsEvidence[0].candidateIds[0], CANDIDATE_ID);
  assert.deepEqual(
    value.uncoveredRanges.map(item => item.range),
    value.coverage.unclassifiedRanges,
  );
  assert.equal(value.revisionHistory[0].active, true);
  assert.equal(value.normalizationProposals[0].reviewStatus, 'pending');
});

test('projects every M1 normalization review state and its context', () => {
  const proposals = [
    normalizationProposal(),
    normalizationProposal({ reviewStatus: 'not_required' }),
    normalizationProposal({
      reviewStatus: 'approved',
      reviewedBy: 'test-reviewer',
      operator: 'operator:test',
    }),
    normalizationProposal({
      reviewStatus: 'rejected',
      reviewedBy: 'test-reviewer',
    }),
  ];

  for (const proposal of proposals) {
    const value = snapshot({ normalizationProposals: [proposal] });
    assert.equal(parseNovelImportReviewSnapshotV1(value), value);
    assert.deepEqual(proposal.contextBefore, ['Body']);
    assert.deepEqual(proposal.contextAfter, []);
  }

  const resolvedConflicts = [
    normalizationProposal({
      reviewStatus: 'approved',
      reviewedBy: 'test-reviewer',
      operator: 'operator:test',
      conflictProposalIds: [SECOND_PROPOSAL_ID],
    }),
    normalizationProposal({
      proposalId: SECOND_PROPOSAL_ID,
      reviewStatus: 'rejected',
      reviewedBy: 'second-reviewer',
      conflictProposalIds: [PROPOSAL_ID],
    }),
  ];
  const value = snapshot({ normalizationProposals: resolvedConflicts });
  assert.equal(parseNovelImportReviewSnapshotV1(value), value);
});

test('rejects inconsistent snapshot projections and semantic range errors', () => {
  const value = snapshot();
  const missingContext = normalizationProposal();
  delete missingContext.contextBefore;
  const invalid = [
    { ...value, schemaVersion: 2 },
    { ...value, unknown: true },
    { ...value, textRevisions: value.textRevisions.slice(0, 2) },
    {
      ...value,
      baselineRevision: {
        ...value.baselineRevision,
        canonicalTextRevision: {
          ...value.baselineRevision.canonicalTextRevision,
          contentHash: 'f'.repeat(64),
        },
      },
    },
    {
      ...value,
      layerDiffs: [
        {
          ...value.layerDiffs[0],
          hunks: [{ ...value.layerDiffs[0].hunks[0], beforeText: 'xx' }],
        },
        value.layerDiffs[1],
      ],
    },
    { ...value, uncoveredRanges: [] },
    {
      ...value,
      tableOfContentsEvidence: [{
        ...value.tableOfContentsEvidence[0],
        candidateIds: [uuid(99)],
      }],
    },
    {
      ...value,
      revisionHistory: [{ ...value.revisionHistory[0], active: false }],
    },
    {
      ...value,
      normalizationProposals: [missingContext],
    },
    {
      ...value,
      normalizationProposals: [normalizationProposal({
        reviewStatus: 'approved',
        reviewedBy: 'test-reviewer',
      })],
    },
    {
      ...value,
      normalizationProposals: [normalizationProposal({
        reviewStatus: 'approved',
        operator: 'operator:test',
      })],
    },
    {
      ...value,
      normalizationProposals: [normalizationProposal({
        reviewStatus: 'rejected',
      })],
    },
    {
      ...value,
      normalizationProposals: [normalizationProposal({
        reviewStatus: 'rejected',
        reviewedBy: 'test-reviewer',
        operator: 'operator:test',
      })],
    },
    {
      ...value,
      normalizationProposals: [normalizationProposal({
        reviewStatus: 'pending',
        reviewedBy: 'test-reviewer',
      })],
    },
    {
      ...value,
      normalizationProposals: [normalizationProposal({
        reviewStatus: 'not_required',
        operator: 'operator:test',
      })],
    },
    {
      ...value,
      normalizationProposals: [normalizationProposal({
        conflictProposalIds: [PROPOSAL_ID],
      })],
    },
    {
      ...value,
      normalizationProposals: [
        normalizationProposal({ conflictProposalIds: [SECOND_PROPOSAL_ID] }),
        normalizationProposal({ proposalId: SECOND_PROPOSAL_ID }),
      ],
    },
    {
      ...value,
      normalizationProposals: [
        normalizationProposal({
          reviewStatus: 'approved',
          reviewedBy: 'test-reviewer',
          operator: 'operator:test',
          conflictProposalIds: [SECOND_PROPOSAL_ID],
        }),
        normalizationProposal({
          proposalId: SECOND_PROPOSAL_ID,
          conflictProposalIds: [PROPOSAL_ID],
        }),
      ],
    },
    {
      ...value,
      normalizationProposals: [
        normalizationProposal({
          reviewStatus: 'approved',
          reviewedBy: 'test-reviewer',
          operator: 'operator:test',
          conflictProposalIds: [SECOND_PROPOSAL_ID],
        }),
        normalizationProposal({
          proposalId: SECOND_PROPOSAL_ID,
          reviewStatus: 'approved',
          reviewedBy: 'second-reviewer',
          operator: 'operator:test',
          conflictProposalIds: [PROPOSAL_ID],
        }),
      ],
    },
  ];

  for (const candidate of invalid) {
    assert.throws(
      () => parseNovelImportReviewSnapshotV1(candidate),
      NovelImportReviewValidationError,
    );
  }
});

test('validates read-only stale queries and baseline-sensitive impact previews', () => {
  const query = stalePreviewQuery();
  const current = stalePreview();
  const direct = impact();
  const transitive = impact({
    consumerArtifactId: uuid(97),
    consumerRevisionId: uuid(96),
    producerArtifactId: direct.consumerArtifactId,
    producerRevisionId: direct.consumerRevisionId,
    depth: 2,
  });
  const stale = stalePreview({
    currentArtifactRevisionId: NEXT_ARTIFACT_REVISION_ID,
    baselineStatus: 'stale',
    canApply: false,
    impacts: [impact({ producerRevisionId: NEXT_ARTIFACT_REVISION_ID })],
  });

  assert.equal(parseNovelImportStalePreviewQueryV1(query), query);
  assert.equal(parseNovelImportStalePreviewV1(current), current);
  assert.equal(
    parseNovelImportStalePreviewV1(stalePreview({
      impacts: [transitive, direct],
    })).impacts[0],
    transitive,
  );
  assert.equal(parseNovelImportStalePreviewV1(stale), stale);
  assert.equal(parseNovelImportReviewDocumentV1(query), query);
  assert.equal(parseNovelImportReviewDocumentV1(stale), stale);

  for (const invalid of [
    { ...query, readOnly: false },
    { ...query, changeSelector: {} },
    { ...current, baselineStatus: 'stale', canApply: false },
    { ...current, canApply: false },
    {
      ...current,
      impacts: [impact({ producerArtifactId: uuid(98) })],
    },
    {
      ...current,
      impacts: [direct, impact({
        producerArtifactId: uuid(95),
        producerRevisionId: uuid(94),
        depth: 2,
      })],
    },
    { ...current, schemaVersion: 2 },
  ]) {
    const parser = invalid.documentType === 'novel-import-stale-preview-query'
      ? parseNovelImportStalePreviewQueryV1
      : parseNovelImportStalePreviewV1;
    assert.throws(() => parser(invalid), NovelImportReviewValidationError);
  }
});

test('rejects an unknown major version through the aggregate parser', () => {
  for (const value of [
    reviewQuery(),
    classifyCommand(),
    snapshot(),
    stalePreviewQuery(),
    stalePreview(),
  ]) {
    assert.throws(
      () => parseNovelImportReviewDocumentV1({ ...value, schemaVersion: 2 }),
      NovelImportReviewValidationError,
    );
  }
});

function baselineRevision() {
  return {
    artifactId: ARTIFACT_ID,
    artifactRevisionId: ARTIFACT_REVISION_ID,
    canonicalTextRevision: revision(
      CANONICAL_REVISION_ID,
      'canonical',
      CANONICAL_TEXT,
    ),
  };
}

function reviewQuery() {
  return {
    documentType: 'novel-import-review-query',
    schemaVersion: NOVEL_IMPORT_REVIEW_SCHEMA_VERSION,
    readOnly: true,
    baselineRevision: baselineRevision(),
  };
}

function commandBase(commandType) {
  return {
    documentType: 'novel-import-review-command',
    schemaVersion: NOVEL_IMPORT_REVIEW_SCHEMA_VERSION,
    commandType,
    baselineRevision: baselineRevision(),
    requestedBy: 'test-operator',
  };
}

function classifyCommand() {
  return {
    ...commandBase('classify-uncovered-range'),
    targetRange: range(CANONICAL_REVISION_ID, 'canonical', 8, 10),
    classification: 'noise',
  };
}

function boundaryCommand() {
  return {
    ...commandBase('adjust-chapter-boundary'),
    chapterId: CHAPTER_ID,
    headingRange: range(CANONICAL_REVISION_ID, 'canonical', 0, 5),
    contentRange: range(CANONICAL_REVISION_ID, 'canonical', 5, 8),
  };
}

function normalizationCommand() {
  return {
    ...commandBase('decide-normalization-proposal'),
    proposalId: PROPOSAL_ID,
    decision: 'approved',
    note: 'synthetic fixture decision',
  };
}

function rerunCommand() {
  return {
    ...commandBase('rerun-selection'),
    selector: { blockIds: [BLOCK_ID], chapterIds: [CHAPTER_ID] },
  };
}

function snapshot(overrides = {}) {
  const rawRevision = revision(RAW_REVISION_ID, 'raw', RAW_TEXT);
  const canonicalRevision = revision(
    CANONICAL_REVISION_ID,
    'canonical',
    CANONICAL_TEXT,
  );
  const normalizedRevision = revision(
    NORMALIZED_REVISION_ID,
    'normalized',
    CANONICAL_TEXT,
  );
  return {
    documentType: 'novel-import-review-snapshot',
    schemaVersion: NOVEL_IMPORT_REVIEW_SCHEMA_VERSION,
    readOnly: false,
    baselineRevision: baselineRevision(),
    source: {
      sourceAssetId: SOURCE_ASSET_ID,
      format: 'txt',
      byteLength: Buffer.byteLength(RAW_TEXT, 'utf8'),
      contentHash: sha256(RAW_TEXT),
      encoding: 'utf-8',
    },
    adapter: {
      adapterId: 'voxweaver.novel-import.txt',
      adapterVersion: '1.0.0',
      selectionMethod: 'probe',
    },
    textRevisions: [rawRevision, canonicalRevision, normalizedRevision],
    layerDiffs: [
      {
        fromRevision: rawRevision,
        toRevision: canonicalRevision,
        hunks: [{
          operation: 'delete',
          fromRange: range(RAW_REVISION_ID, 'raw', 5, 6),
          toRange: range(CANONICAL_REVISION_ID, 'canonical', 5, 5),
          beforeText: '\r',
          afterText: '',
        }],
      },
      {
        fromRevision: canonicalRevision,
        toRevision: normalizedRevision,
        hunks: [],
      },
    ],
    chapterCandidates: [chapterCandidate()],
    chapters: [chapterEntry()],
    tableOfContentsEvidence: [{
      evidenceId: EVIDENCE_ID,
      kind: 'candidate-sequence',
      range: range(CANONICAL_REVISION_ID, 'canonical', 0, 5),
      rawText: 'Title',
      candidateIds: [CANDIDATE_ID],
      confidence: 1,
      reviewStatus: 'not_required',
    }],
    coverage: {
      textRevisionId: CANONICAL_REVISION_ID,
      textLayer: 'canonical',
      totalByteLength: Buffer.byteLength(CANONICAL_TEXT, 'utf8'),
      classifiedByteLength: 8,
      unclassifiedByteLength: 2,
      complete: false,
      segments: [{
        classification: 'chapter',
        range: range(CANONICAL_REVISION_ID, 'canonical', 0, 8),
        chapterId: CHAPTER_ID,
      }],
      unclassifiedRanges: [
        range(CANONICAL_REVISION_ID, 'canonical', 8, 10),
      ],
    },
    issues: [{
      issueId: ISSUE_ID,
      code: 'unclassified-tail',
      severity: 'warning',
      reviewStatus: 'pending',
      message: 'Synthetic fixture leaves a short tail for review.',
      textRange: range(CANONICAL_REVISION_ID, 'canonical', 8, 10),
    }],
    uncoveredRanges: [{
      range: range(CANONICAL_REVISION_ID, 'canonical', 8, 10),
      suggestedClassification: 'noise',
      reviewStatus: 'pending',
    }],
    revisionHistory: [{
      artifactId: ARTIFACT_ID,
      artifactRevisionId: ARTIFACT_REVISION_ID,
      sourceAssetId: SOURCE_ASSET_ID,
      sourceHash: sha256(RAW_TEXT),
      processorId: 'voxweaver.application.novel-import',
      processorVersion: '1.0.0',
      rawTextRevision: rawRevision,
      canonicalTextRevision: canonicalRevision,
      normalizedTextRevision: normalizedRevision,
      active: true,
    }],
    normalizationProposals: [normalizationProposal()],
    ...overrides,
  };
}

function chapterCandidate() {
  return {
    chapterCandidateId: CANDIDATE_ID,
    headingRange: range(CANONICAL_REVISION_ID, 'canonical', 0, 5),
    lineRange: { lineBase: 1, startLine: 1, endLineExclusive: 2 },
    rawTitle: 'Title',
    normalizedTitle: 'Title',
    ruleId: 'synthetic-heading',
    ruleVersion: '1.0.0',
    ruleConfidence: 1,
    confidenceSource: 'deterministic-test-rule',
    evidence: ['synthetic-test-fixture'],
    contextBefore: [],
    contextAfter: ['Body'],
    reviewStatus: 'not_required',
  };
}

function chapterEntry() {
  return {
    chapterId: CHAPTER_ID,
    order: 0,
    title: 'Title',
    rawHeading: 'Title',
    headingRange: range(CANONICAL_REVISION_ID, 'canonical', 0, 5),
    contentRange: range(CANONICAL_REVISION_ID, 'canonical', 5, 8),
    sourceLineRange: { lineBase: 1, startLine: 1, endLineExclusive: 3 },
    confidence: 1,
    detectedBy: 'rule:synthetic-heading@1.0.0',
    reviewStatus: 'not_required',
  };
}

function normalizationProposal(overrides = {}) {
  return {
    proposalId: PROPOSAL_ID,
    canonicalRange: range(CANONICAL_REVISION_ID, 'canonical', 8, 10),
    operation: 'delete',
    beforeText: 'dy',
    afterText: '',
    contextBefore: ['Body'],
    contextAfter: [],
    ruleId: 'synthetic.trailing-noise',
    ruleVersion: '1.0.0',
    reason: 'Synthetic fixture exercises review decisions.',
    evidence: ['synthetic-test-fixture'],
    confidence: 0.75,
    confidenceSource: 'deterministic-test-rule',
    risk: 'medium',
    proposedBy: 'test-suite',
    reviewStatus: 'pending',
    conflictProposalIds: [],
    ...overrides,
  };
}

function stalePreviewQuery() {
  return {
    documentType: 'novel-import-stale-preview-query',
    schemaVersion: NOVEL_IMPORT_REVIEW_SCHEMA_VERSION,
    readOnly: true,
    baselineRevision: baselineRevision(),
    changeKind: 'boundary-adjustment',
    changeSelector: { chapterIds: [CHAPTER_ID] },
  };
}

function impact(overrides = {}) {
  return {
    consumerArtifactId: CONSUMER_ARTIFACT_ID,
    consumerRevisionId: CONSUMER_REVISION_ID,
    producerArtifactId: ARTIFACT_ID,
    producerRevisionId: ARTIFACT_REVISION_ID,
    dependencyType: 'structure',
    depth: 1,
    selector: { chapterIds: [CHAPTER_ID] },
    ...overrides,
  };
}

function stalePreview(overrides = {}) {
  return {
    documentType: 'novel-import-stale-preview',
    schemaVersion: NOVEL_IMPORT_REVIEW_SCHEMA_VERSION,
    baselineRevision: baselineRevision(),
    currentArtifactRevisionId: ARTIFACT_REVISION_ID,
    baselineStatus: 'current',
    canApply: true,
    changeSelector: { chapterIds: [CHAPTER_ID] },
    impacts: [impact()],
    ...overrides,
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

function range(textRevisionId, textLayer, startByte, endByte) {
  return {
    textRevisionId,
    textLayer,
    offsetUnit: 'utf8-byte',
    startByte,
    endByte,
  };
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function uuid(value) {
  return `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
}
