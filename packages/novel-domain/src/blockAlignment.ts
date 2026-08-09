/// <reference types="node" />

import type {
  DocumentBlockKindV1,
  TextRevisionRefV1,
  TxtSourceEncoding,
} from '@voxweaver/contracts';
import type {
  BlockAlignmentEvidenceLevelV1,
  CanonicalDocumentBlockV1,
  DocumentBlockIndexIssueV1,
  DocumentBlockIndexV1,
} from './documentBlock.js';

import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import {
  BLOCK_ALIGNMENT_POLICY_VERSION,
  parseTextRevisionRefV1,
  TXT_SOURCE_ENCODINGS,
} from '@voxweaver/contracts';

import {
  DOCUMENT_BLOCK_INDEX_SCHEMA_VERSION,
  DocumentBlockIndexValidationError,
} from './documentBlock.js';

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const UUID_V4_PATTERN
  = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const BLOCK_KINDS: ReadonlySet<DocumentBlockKindV1> = new Set([
  'heading',
  'paragraph',
  'quote',
  'list',
  'separator',
  'unknown',
]);
const SOURCE_ENCODINGS: ReadonlySet<TxtSourceEncoding>
  = new Set(TXT_SOURCE_ENCODINGS);
const EVIDENCE_LEVELS: ReadonlySet<BlockAlignmentEvidenceLevelV1> = new Set([
  'same-source-exact-locator',
  'changed-source-exact-locator',
  'two-sided-content-anchors',
  'one-sided-matched-anchor',
  'globally-unique-content',
]);

export interface BlockAlignmentResultV1 {
  readonly blocks: readonly CanonicalDocumentBlockV1[];
  readonly issues: readonly DocumentBlockIndexIssueV1[];
  readonly reviewStatus: 'not_required' | 'pending';
}

interface AlignmentState {
  readonly current: DocumentBlockIndexV1;
  readonly previous: DocumentBlockIndexV1;
  readonly matchedCurrentToOld: Map<number, number>;
  readonly usedOldIndexes: Set<number>;
  readonly unresolvedCurrentIndexes: Set<number>;
  readonly issues: DocumentBlockIndexIssueV1[];
}

type CandidateSelector = (
  currentIndex: number,
  state: AlignmentState,
) => readonly number[];

interface SnapshotResolution {
  readonly accepted: ReadonlyMap<number, number>;
  readonly ambiguous: ReadonlyMap<number, readonly number[]>;
}

export function alignDocumentBlockIndexV1(
  current: DocumentBlockIndexV1,
  previous?: DocumentBlockIndexV1,
): BlockAlignmentResultV1 {
  validateDocumentBlockIndexV1(current);
  if (previous === undefined) {
    return {
      blocks: current.blocks,
      issues: current.issues,
      reviewStatus: current.reviewStatus,
    };
  }

  validateDocumentBlockIndexV1(previous);
  const state: AlignmentState = {
    current,
    previous,
    matchedCurrentToOld: new Map(),
    usedOldIndexes: new Set(),
    unresolvedCurrentIndexes: new Set(current.blocks.map((_, index) => index)),
    issues: [...current.issues],
  };

  resolveStaticLevel(
    state,
    'same-source-exact-locator',
    sameSourceExactLocatorCandidates,
  );
  resolveStaticLevel(
    state,
    'changed-source-exact-locator',
    changedSourceExactLocatorCandidates,
  );
  resolveStaticLevel(
    state,
    'two-sided-content-anchors',
    twoSidedAnchorCandidates,
  );
  resolveOneSidedLevel(state);
  resolveStaticLevel(
    state,
    'globally-unique-content',
    globallyUniqueContentCandidates,
  );

  const blocks = current.blocks.map((block, currentIndex) => {
    const oldIndex = state.matchedCurrentToOld.get(currentIndex);
    if (oldIndex === undefined)
      return block;
    return {
      ...block,
      blockId: previous.blocks[oldIndex].blockId,
    };
  });
  const reviewStatus = state.issues.length > 0 ? 'pending' : 'not_required';
  validateDocumentBlockIndexV1({
    ...current,
    blocks,
    issues: state.issues,
    reviewStatus,
  });
  return { blocks, issues: state.issues, reviewStatus };
}

export function validateDocumentBlockIndexV1(
  index: DocumentBlockIndexV1,
): DocumentBlockIndexV1 {
  assertIndexHeader(index);

  let revision: TextRevisionRefV1;
  let rawRevision: TextRevisionRefV1;
  try {
    revision = parseTextRevisionRefV1(index.canonicalTextRevision);
    rawRevision = parseTextRevisionRefV1(index.rawTextRevision);
  } catch (error) {
    invalid(
      'canonical_revision_invalid',
      error instanceof Error ? error.message : 'Canonical revision is invalid',
    );
  }
  if (revision.textLayer !== 'canonical') {
    invalid(
      'canonical_revision_layer_invalid',
      'Document block index revision must use the canonical layer',
    );
  }
  if (rawRevision.textLayer !== 'raw') {
    invalid(
      'raw_revision_layer_invalid',
      'Document block index raw revision must use the raw layer',
    );
  }

  const blockIds = new Set<string>();
  const exactLocators = new Set<string>();
  const canonicalHash = createHash('sha256');
  let canonicalCursor = 0;
  let sourceCursor = 0;
  let rawCursor = 0;

  for (const block of index.blocks) {
    assertBlockIdentity(block, blockIds);
    assertCanonicalBlock(block, index, canonicalCursor);
    assertLocator(
      block,
      index,
      exactLocators,
      sourceCursor,
      rawCursor,
      rawRevision,
    );

    blockIds.add(block.blockId);
    exactLocators.add(exactLocatorKey(block));
    canonicalHash.update(block.canonicalText, 'utf8');
    canonicalCursor = block.canonicalRange.endByte;
    sourceCursor = block.sourceLocator.sourceByteRange.endByte;
    rawCursor = block.sourceLocator.rawTextRange.endByte;
  }

  if (canonicalCursor !== revision.byteLength) {
    invalid(
      'canonical_coverage_invalid',
      'Document blocks must cover the complete canonical revision',
    );
  }
  if (sourceCursor !== index.sourceByteLength) {
    invalid(
      'source_coverage_invalid',
      'Document block locators must cover the complete source byte range',
    );
  }
  if (rawCursor !== rawRevision.byteLength) {
    invalid(
      'raw_coverage_invalid',
      'Document block locators must cover the complete raw text revision',
    );
  }
  if (canonicalHash.digest('hex') !== revision.contentHash) {
    invalid(
      'canonical_hash_mismatch',
      'Document block text concatenation must match the canonical revision hash',
    );
  }

  assertIssues(index, blockIds);
  return index;
}

function resolveStaticLevel(
  state: AlignmentState,
  evidenceLevel: BlockAlignmentEvidenceLevelV1,
  selectCandidates: CandidateSelector,
): void {
  const resolution = resolveSnapshot(state, selectCandidates);
  applySnapshot(state, evidenceLevel, resolution);
}

function resolveOneSidedLevel(state: AlignmentState): void {
  const evidenceLevel = 'one-sided-matched-anchor' as const;
  while (state.unresolvedCurrentIndexes.size > 0) {
    const resolution = resolveSnapshot(
      state,
      oneSidedMatchedAnchorCandidates,
    );
    applySnapshot(state, evidenceLevel, resolution);
    if (resolution.accepted.size > 0)
      continue;

    break;
  }
}

function resolveSnapshot(
  state: AlignmentState,
  selectCandidates: CandidateSelector,
): SnapshotResolution {
  const candidatesByCurrent = new Map<number, readonly number[]>();
  const currentIndexesByOld = new Map<number, number[]>();

  for (const currentIndex of state.unresolvedCurrentIndexes) {
    const candidates = selectCandidates(currentIndex, state);
    candidatesByCurrent.set(currentIndex, candidates);
    for (const oldIndex of candidates) {
      const currentIndexes = currentIndexesByOld.get(oldIndex) ?? [];
      currentIndexes.push(currentIndex);
      currentIndexesByOld.set(oldIndex, currentIndexes);
    }
  }

  const ambiguous = new Map<number, readonly number[]>();
  for (const [oldIndex, currentIndexes] of currentIndexesByOld) {
    if (currentIndexes.length <= 1)
      continue;
    for (const currentIndex of currentIndexes) {
      ambiguous.set(
        currentIndex,
        candidatesByCurrent.get(currentIndex) ?? [oldIndex],
      );
    }
  }

  const proposed = new Map<number, number>();
  for (const [currentIndex, candidates] of candidatesByCurrent) {
    if (ambiguous.has(currentIndex) || candidates.length === 0)
      continue;
    if (candidates.length > 1) {
      ambiguous.set(currentIndex, candidates);
      continue;
    }

    const oldIndex = candidates[0];
    if (
      !isMonotonicWithMatches(currentIndex, oldIndex, state.matchedCurrentToOld)
      || createsBlockIdCollision(currentIndex, oldIndex, state)
    ) {
      ambiguous.set(currentIndex, candidates);
      continue;
    }
    proposed.set(currentIndex, oldIndex);
  }

  for (const currentIndex of findBatchOrderConflicts(proposed)) {
    const oldIndex = proposed.get(currentIndex);
    if (oldIndex !== undefined)
      ambiguous.set(currentIndex, [oldIndex]);
    proposed.delete(currentIndex);
  }

  return { accepted: proposed, ambiguous };
}

function applySnapshot(
  state: AlignmentState,
  evidenceLevel: BlockAlignmentEvidenceLevelV1,
  resolution: SnapshotResolution,
): void {
  for (const [currentIndex, oldIndex] of resolution.accepted) {
    state.matchedCurrentToOld.set(currentIndex, oldIndex);
    state.usedOldIndexes.add(oldIndex);
    state.unresolvedCurrentIndexes.delete(currentIndex);
  }
  for (const [currentIndex, candidates] of resolution.ambiguous)
    addAmbiguousIssue(state, currentIndex, candidates, evidenceLevel);
}

function addAmbiguousIssue(
  state: AlignmentState,
  currentIndex: number,
  candidateOldIndexes: readonly number[],
  evidenceLevel: BlockAlignmentEvidenceLevelV1,
): void {
  if (!state.unresolvedCurrentIndexes.delete(currentIndex))
    return;
  const currentBlock = state.current.blocks[currentIndex];
  const candidateOldBlockIds = candidateOldIndexes.map(
    oldIndex => state.previous.blocks[oldIndex].blockId,
  );
  state.issues.push({
    code: 'ambiguous_reimport_alignment',
    severity: 'warning',
    reviewStatus: 'pending',
    message: `Block alignment is ambiguous at evidence level ${evidenceLevel}`,
    currentBlockId: currentBlock.blockId,
    candidateOldBlockIds,
    evidenceLevel,
  });
}

function sameSourceExactLocatorCandidates(
  currentIndex: number,
  state: AlignmentState,
): readonly number[] {
  const currentBlock = state.current.blocks[currentIndex];
  return eligibleOldIndexes(currentBlock, state).filter((oldIndex) => {
    const oldBlock = state.previous.blocks[oldIndex];
    return oldBlock.sourceLocator.sourceContentHash
      === currentBlock.sourceLocator.sourceContentHash
      && exactLocatorKey(oldBlock) === exactLocatorKey(currentBlock);
  });
}

function changedSourceExactLocatorCandidates(
  currentIndex: number,
  state: AlignmentState,
): readonly number[] {
  const currentBlock = state.current.blocks[currentIndex];
  return eligibleOldIndexes(currentBlock, state).filter((oldIndex) => {
    const oldBlock = state.previous.blocks[oldIndex];
    return oldBlock.sourceLocator.sourceContentHash
      !== currentBlock.sourceLocator.sourceContentHash
      && exactLocatorKey(oldBlock) === exactLocatorKey(currentBlock);
  });
}

function twoSidedAnchorCandidates(
  currentIndex: number,
  state: AlignmentState,
): readonly number[] {
  const currentBlock = state.current.blocks[currentIndex];
  const currentLeft = nearestSubstantiveIndex(
    state.current.blocks,
    currentIndex,
    -1,
  );
  const currentRight = nearestSubstantiveIndex(
    state.current.blocks,
    currentIndex,
    1,
  );
  if (currentLeft === undefined || currentRight === undefined)
    return [];

  return eligibleOldIndexes(currentBlock, state).filter((oldIndex) => {
    const oldLeft = nearestSubstantiveIndex(state.previous.blocks, oldIndex, -1);
    const oldRight = nearestSubstantiveIndex(state.previous.blocks, oldIndex, 1);
    return oldLeft !== undefined
      && oldRight !== undefined
      && sameContentHash(
        state.current.blocks[currentLeft],
        state.previous.blocks[oldLeft],
      )
      && sameContentHash(
        state.current.blocks[currentRight],
        state.previous.blocks[oldRight],
      );
  });
}

function oneSidedMatchedAnchorCandidates(
  currentIndex: number,
  state: AlignmentState,
): readonly number[] {
  const currentBlock = state.current.blocks[currentIndex];
  return eligibleOldIndexes(currentBlock, state).filter((oldIndex) => {
    if (!isMonotonicWithMatches(
      currentIndex,
      oldIndex,
      state.matchedCurrentToOld,
    )) {
      return false;
    }
    return sideHasMatchedNearestAnchor(currentIndex, oldIndex, -1, state)
      || sideHasMatchedNearestAnchor(currentIndex, oldIndex, 1, state);
  });
}

function globallyUniqueContentCandidates(
  currentIndex: number,
  state: AlignmentState,
): readonly number[] {
  const currentBlock = state.current.blocks[currentIndex];
  const currentHashCount = state.current.blocks.filter(
    block => block.contentHash === currentBlock.contentHash,
  ).length;
  const previousHashCount = state.previous.blocks.filter(
    block => block.contentHash === currentBlock.contentHash,
  ).length;
  const eligibleOld = state.previous.blocks
    .map((block, index) => ({ block, index }))
    .filter(({ block }) => sameKindAndHash(block, currentBlock))
    .map(({ index }) => index);
  if (
    currentHashCount !== 1
    || previousHashCount !== 1
    || eligibleOld.length !== 1
  ) {
    return [];
  }
  const oldIndex = eligibleOld[0];
  if (
    state.usedOldIndexes.has(oldIndex)
    || !isMonotonicWithMatches(
      currentIndex,
      oldIndex,
      state.matchedCurrentToOld,
    )
  ) {
    return [];
  }
  return [oldIndex];
}

function eligibleOldIndexes(
  currentBlock: CanonicalDocumentBlockV1,
  state: AlignmentState,
): number[] {
  return state.previous.blocks
    .map((block, index) => ({ block, index }))
    .filter(({ block, index }) => !state.usedOldIndexes.has(index)
      && sameKindAndHash(block, currentBlock))
    .map(({ index }) => index);
}

function sideHasMatchedNearestAnchor(
  currentIndex: number,
  oldIndex: number,
  direction: -1 | 1,
  state: AlignmentState,
): boolean {
  const currentAnchor = nearestSubstantiveIndex(
    state.current.blocks,
    currentIndex,
    direction,
  );
  const oldAnchor = nearestSubstantiveIndex(
    state.previous.blocks,
    oldIndex,
    direction,
  );
  return currentAnchor !== undefined
    && oldAnchor !== undefined
    && state.matchedCurrentToOld.get(currentAnchor) === oldAnchor;
}

function nearestSubstantiveIndex(
  blocks: readonly CanonicalDocumentBlockV1[],
  startIndex: number,
  direction: -1 | 1,
): number | undefined {
  for (
    let index = startIndex + direction;
    index >= 0 && index < blocks.length;
    index += direction
  ) {
    if (blocks[index].canonicalText.trim().length > 0)
      return index;
  }
  return undefined;
}

function isMonotonicWithMatches(
  currentIndex: number,
  oldIndex: number,
  matchedCurrentToOld: ReadonlyMap<number, number>,
): boolean {
  for (const [matchedCurrentIndex, matchedOldIndex] of matchedCurrentToOld) {
    if (
      (matchedCurrentIndex < currentIndex && matchedOldIndex >= oldIndex)
      || (matchedCurrentIndex > currentIndex && matchedOldIndex <= oldIndex)
    ) {
      return false;
    }
  }
  return true;
}

function findBatchOrderConflicts(
  proposed: ReadonlyMap<number, number>,
): ReadonlySet<number> {
  const entries = [...proposed.entries()].sort(
    ([leftCurrent], [rightCurrent]) => leftCurrent - rightCurrent,
  );
  const conflicts = new Set<number>();
  let maximumOldIndex = Number.NEGATIVE_INFINITY;
  let maximumEntryIndex = -1;
  for (let index = 0; index < entries.length; index += 1) {
    const [, oldIndex] = entries[index];
    if (oldIndex <= maximumOldIndex) {
      conflicts.add(entries[index][0]);
      conflicts.add(entries[maximumEntryIndex][0]);
    }
    if (oldIndex > maximumOldIndex) {
      maximumOldIndex = oldIndex;
      maximumEntryIndex = index;
    }
  }

  let minimumOldIndex = Number.POSITIVE_INFINITY;
  let minimumEntryIndex = -1;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const [, oldIndex] = entries[index];
    if (oldIndex >= minimumOldIndex) {
      conflicts.add(entries[index][0]);
      conflicts.add(entries[minimumEntryIndex][0]);
    }
    if (oldIndex < minimumOldIndex) {
      minimumOldIndex = oldIndex;
      minimumEntryIndex = index;
    }
  }
  return conflicts;
}

function createsBlockIdCollision(
  currentIndex: number,
  oldIndex: number,
  state: AlignmentState,
): boolean {
  const reusedId = state.previous.blocks[oldIndex].blockId;
  return state.current.blocks.some(
    (block, otherCurrentIndex) => otherCurrentIndex !== currentIndex
      && block.blockId === reusedId,
  );
}

function assertIndexHeader(index: DocumentBlockIndexV1): void {
  if (
    index.documentType !== 'document-block-index'
    || index.schemaVersion !== DOCUMENT_BLOCK_INDEX_SCHEMA_VERSION
  ) {
    invalid(
      'document_block_index_header_invalid',
      'Document block index type or schema version is invalid',
    );
  }
  if (index.alignmentPolicyVersion !== BLOCK_ALIGNMENT_POLICY_VERSION) {
    invalid(
      'alignment_policy_invalid',
      'Document block index alignment policy version is invalid',
    );
  }
  if (!UUID_V4_PATTERN.test(index.sourceAssetId)) {
    invalid(
      'source_asset_id_invalid',
      'Document block index sourceAssetId must be an opaque UUID v4',
    );
  }
  if (!SHA256_PATTERN.test(index.sourceContentHash)) {
    invalid(
      'source_content_hash_invalid',
      'Document block index source hash must be lowercase SHA-256 hex',
    );
  }
  if (
    !Number.isSafeInteger(index.sourceByteLength)
    || index.sourceByteLength < 0
  ) {
    invalid(
      'source_byte_length_invalid',
      'Document block index source byte length must be non-negative and safe',
    );
  }
  if (!SOURCE_ENCODINGS.has(index.sourceEncoding)) {
    invalid(
      'source_encoding_invalid',
      'Document block index source encoding is not supported',
    );
  }
  if (index.reviewStatus !== 'not_required' && index.reviewStatus !== 'pending') {
    invalid(
      'review_status_invalid',
      'Document block index review status is invalid',
    );
  }
  if (
    (index.issues.length === 0 && index.reviewStatus !== 'not_required')
    || (index.issues.length > 0 && index.reviewStatus !== 'pending')
  ) {
    invalid(
      'review_status_inconsistent',
      'Document block index review status must agree with pending issues',
    );
  }
}

function assertBlockIdentity(
  block: CanonicalDocumentBlockV1,
  blockIds: ReadonlySet<string>,
): void {
  if (!UUID_V4_PATTERN.test(block.blockId)) {
    invalid(
      'block_id_invalid',
      'Document block IDs must be opaque UUID v4 values',
    );
  }
  if (blockIds.has(block.blockId)) {
    invalid(
      'block_id_duplicate',
      'Document block index contains a duplicate block ID',
    );
  }
  if (!BLOCK_KINDS.has(block.kind)) {
    invalid('block_kind_invalid', 'Document block kind is invalid');
  }
}

function assertCanonicalBlock(
  block: CanonicalDocumentBlockV1,
  index: DocumentBlockIndexV1,
  expectedStartByte: number,
): void {
  const range = block.canonicalRange;
  if (
    range.textRevisionId !== index.canonicalTextRevision.textRevisionId
    || range.textLayer !== 'canonical'
    || range.offsetUnit !== 'utf8-byte'
  ) {
    invalid(
      'canonical_range_revision_invalid',
      'Canonical block range must reference the indexed canonical revision',
    );
  }
  if (
    !Number.isSafeInteger(range.startByte)
    || !Number.isSafeInteger(range.endByte)
    || range.startByte !== expectedStartByte
    || range.endByte < range.startByte
    || range.endByte > index.canonicalTextRevision.byteLength
  ) {
    invalid(
      'canonical_range_invalid',
      'Canonical block ranges must be safe, contiguous, and in bounds',
    );
  }
  const byteLength = Buffer.byteLength(block.canonicalText, 'utf8');
  if (byteLength !== range.endByte - range.startByte) {
    invalid(
      'canonical_block_length_mismatch',
      'Canonical block UTF-8 byte length must equal its range length',
    );
  }
  if (!SHA256_PATTERN.test(block.contentHash)
    || sha256Utf8(block.canonicalText) !== block.contentHash) {
    invalid(
      'canonical_block_hash_mismatch',
      'Canonical block hash must match its exact UTF-8 bytes',
    );
  }
}

function assertLocator(
  block: CanonicalDocumentBlockV1,
  index: DocumentBlockIndexV1,
  exactLocators: ReadonlySet<string>,
  expectedSourceStart: number,
  expectedRawStart: number,
  rawRevision: TextRevisionRefV1,
): void {
  const locator = block.sourceLocator;
  if (
    locator.sourceAssetId !== index.sourceAssetId
    || locator.sourceContentHash !== index.sourceContentHash
    || locator.sourceEncoding !== index.sourceEncoding
  ) {
    invalid(
      'source_locator_provenance_invalid',
      'Block source locator provenance must match the document block index',
    );
  }
  const sourceRange = locator.sourceByteRange;
  const key = exactLocatorKey(block);
  if (exactLocators.has(key)) {
    invalid(
      'source_locator_duplicate',
      'Document block index contains duplicate exact-locator projections',
    );
  }
  if (
    sourceRange.offsetUnit !== 'source-byte'
    || !Number.isSafeInteger(sourceRange.startByte)
    || !Number.isSafeInteger(sourceRange.endByte)
    || sourceRange.startByte !== expectedSourceStart
    || sourceRange.endByte <= sourceRange.startByte
    || sourceRange.endByte > index.sourceByteLength
  ) {
    invalid(
      'source_locator_range_invalid',
      'Block source byte ranges must be non-empty, contiguous, and in bounds',
    );
  }

  const rawRange = locator.rawTextRange;
  if (
    rawRange.textLayer !== 'raw'
    || rawRange.offsetUnit !== 'utf8-byte'
    || rawRange.textRevisionId !== rawRevision.textRevisionId
    || !Number.isSafeInteger(rawRange.startByte)
    || !Number.isSafeInteger(rawRange.endByte)
    || rawRange.startByte !== expectedRawStart
    || rawRange.endByte <= rawRange.startByte
    || rawRange.endByte > rawRevision.byteLength
  ) {
    invalid(
      'raw_locator_range_invalid',
      'Block raw text ranges must be non-empty, contiguous, and revision-aware',
    );
  }
  if (
    locator.lineRange.lineBase !== 1
    || !Number.isSafeInteger(locator.lineRange.startLine)
    || !Number.isSafeInteger(locator.lineRange.endLineExclusive)
    || locator.lineRange.startLine < 1
    || locator.lineRange.startLine >= locator.lineRange.endLineExclusive
  ) {
    invalid(
      'source_line_range_invalid',
      'Block source line ranges must be non-empty one-based ranges',
    );
  }
}

function assertIssues(
  index: DocumentBlockIndexV1,
  currentBlockIds: ReadonlySet<string>,
): void {
  const issueBlocks = new Set<string>();
  for (const issue of index.issues) {
    if (
      issue.code !== 'ambiguous_reimport_alignment'
      || issue.severity !== 'warning'
      || issue.reviewStatus !== 'pending'
      || issue.message.length === 0
      || !currentBlockIds.has(issue.currentBlockId)
      || issue.candidateOldBlockIds.length === 0
      || issue.candidateOldBlockIds.some(id => !UUID_V4_PATTERN.test(id))
      || new Set(issue.candidateOldBlockIds).size
      !== issue.candidateOldBlockIds.length
      || !EVIDENCE_LEVELS.has(issue.evidenceLevel)
      || issueBlocks.has(issue.currentBlockId)
    ) {
      invalid(
        'alignment_issue_invalid',
        'Document block index contains an invalid alignment review issue',
      );
    }
    issueBlocks.add(issue.currentBlockId);
  }
}

function exactLocatorKey(block: CanonicalDocumentBlockV1): string {
  const locator = block.sourceLocator;
  return JSON.stringify([
    locator.sourceEncoding,
    locator.sourceByteRange.startByte,
    locator.sourceByteRange.endByte,
  ]);
}

function sameKindAndHash(
  left: CanonicalDocumentBlockV1,
  right: CanonicalDocumentBlockV1,
): boolean {
  return left.kind === right.kind && sameContentHash(left, right);
}

function sameContentHash(
  left: CanonicalDocumentBlockV1,
  right: CanonicalDocumentBlockV1,
): boolean {
  return left.contentHash === right.contentHash;
}

function sha256Utf8(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function invalid(detailReason: string, message: string): never {
  throw new DocumentBlockIndexValidationError(detailReason, message);
}
