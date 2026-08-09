import type {
  ChapterIndexEntryV1,
  ChapterIndexV1,
  CoverageClassificationV1,
} from '@voxweaver/contracts';
import type {
  BlockAlignmentEvidenceLevelV1,
  CanonicalDocumentBlockV1,
  DocumentBlockIndexV1,
} from './documentBlock.js';

import { validateDocumentBlockIndexV1 } from './blockAlignment.js';
import { validateChapterIndexDomainV1 } from './chapter.js';

export const NOVEL_REIMPORT_PLAN_SCHEMA_VERSION = 1 as const;

export type ChapterIdPreservationEvidenceV1
  = | 'stable-heading-block'
    | 'reciprocal-stable-block-anchors';

export interface PreservedChapterIdV1 {
  readonly previousChapterId: string;
  readonly currentChapterId: string;
  readonly preservedChapterId: string;
  readonly evidence: ChapterIdPreservationEvidenceV1;
  readonly evidenceBlockIds: readonly string[];
}

export interface BlockReimportAmbiguityV1 {
  readonly entityType: 'block';
  readonly code: 'block_alignment_ambiguous';
  readonly currentBlockId: string;
  readonly candidatePreviousBlockIds: readonly string[];
  readonly evidenceLevel: BlockAlignmentEvidenceLevelV1;
  readonly reviewStatus: 'pending';
}

export interface ChapterReimportAmbiguityV1 {
  readonly entityType: 'chapter';
  readonly code: 'chapter_alignment_ambiguous';
  readonly currentChapterId: string;
  readonly candidatePreviousChapterIds: readonly string[];
  readonly evidenceBlockIds: readonly string[];
  readonly reviewStatus: 'pending';
}

export type NovelReimportAmbiguityV1
  = BlockReimportAmbiguityV1 | ChapterReimportAmbiguityV1;

export interface NovelReimportAffectedIdsV1 {
  readonly previousBlockIds: readonly string[];
  readonly currentBlockIds: readonly string[];
  readonly previousChapterIds: readonly string[];
  readonly currentChapterIds: readonly string[];
}

export interface NovelReimportChangeScopesV1 {
  /** Canonical heading or body bytes changed. */
  readonly content: NovelReimportAffectedIdsV1;
  /** Chapter membership, heading identity, numbering, or review projection changed. */
  readonly structure: NovelReimportAffectedIdsV1;
  /** Only the projected chapter display title changed. */
  readonly display: NovelReimportAffectedIdsV1;
}

export interface NovelReimportPlanV1 {
  readonly documentType: 'novel-reimport-plan';
  readonly schemaVersion: typeof NOVEL_REIMPORT_PLAN_SCHEMA_VERSION;
  readonly previousTextRevisionId: string;
  readonly currentTextRevisionId: string;
  readonly preservedBlockIds: readonly string[];
  readonly preservedChapters: readonly PreservedChapterIdV1[];
  readonly ambiguities: readonly NovelReimportAmbiguityV1[];
  readonly changes: NovelReimportChangeScopesV1;
  readonly reviewStatus: 'not_required' | 'pending';
}

export interface BuildNovelReimportPlanInputV1 {
  readonly previousBlockIndex: DocumentBlockIndexV1;
  readonly currentBlockIndex: DocumentBlockIndexV1;
  readonly previousChapterIndex: ChapterIndexV1;
  readonly currentChapterIndex: ChapterIndexV1;
}

export class NovelReimportPlanValidationError extends Error {
  readonly code = 'NOVEL_IMPORT_STRUCTURE_INVALID';

  constructor(
    readonly detailReason: string,
    message: string,
  ) {
    super(message);
    this.name = 'NovelReimportPlanValidationError';
  }
}

interface ChapterContext {
  readonly entry: ChapterIndexEntryV1;
  readonly headingBlock: CanonicalDocumentBlockV1;
  readonly stableSubstantiveBlockIds: readonly string[];
}

interface ChapterPair {
  readonly previousIndex: number;
  readonly currentIndex: number;
  readonly evidence: ChapterIdPreservationEvidenceV1;
  readonly evidenceBlockIds: readonly string[];
}

interface ChapterAlignment {
  readonly pairs: readonly ChapterPair[];
  readonly ambiguities: readonly ChapterReimportAmbiguityV1[];
}

interface MutableAffectedIds {
  readonly previousBlockIds: Set<string>;
  readonly currentBlockIds: Set<string>;
  readonly previousChapterIds: Set<string>;
  readonly currentChapterIds: Set<string>;
}

interface DisplayChangeCandidate {
  readonly previousChapterId: string;
  readonly currentChapterId: string;
}

interface MembershipOwner {
  readonly kind: 'chapter' | 'classification';
  readonly value: string;
}

export function buildNovelReimportPlanV1(
  input: BuildNovelReimportPlanInputV1,
): NovelReimportPlanV1 {
  const previousBlockIndex = validateBlockIndex(
    input?.previousBlockIndex,
    'previous',
  );
  const currentBlockIndex = validateBlockIndex(
    input?.currentBlockIndex,
    'current',
  );
  const previousChapterIndex = validateChapterIndex(
    input?.previousChapterIndex,
    'previous',
  );
  const currentChapterIndex = validateChapterIndex(
    input?.currentChapterIndex,
    'current',
  );

  assertIndexRelationship(previousBlockIndex, previousChapterIndex, 'previous');
  assertIndexRelationship(currentBlockIndex, currentChapterIndex, 'current');

  const previousBlocksById = new Map(
    previousBlockIndex.blocks.map((block, index) => [block.blockId, { block, index }]),
  );
  const currentBlocksById = new Map(
    currentBlockIndex.blocks.map((block, index) => [block.blockId, { block, index }]),
  );
  const preservedBlockIds = currentBlockIndex.blocks
    .filter(block => previousBlocksById.has(block.blockId))
    .map(block => block.blockId);
  assertPreservedBlockEvidence(
    previousBlocksById,
    currentBlocksById,
    preservedBlockIds,
  );
  assertBlockAmbiguityEvidence(currentBlockIndex, previousBlocksById);

  const preservedBlockIdSet = new Set(preservedBlockIds);
  const previousChapters = createChapterContexts(
    previousBlockIndex,
    previousChapterIndex,
    preservedBlockIdSet,
  );
  const currentChapters = createChapterContexts(
    currentBlockIndex,
    currentChapterIndex,
    preservedBlockIdSet,
  );
  const chapterAlignment = alignChapters(previousChapters, currentChapters);
  assertNoChapterIdCollision(
    previousChapterIndex,
    currentChapterIndex,
    chapterAlignment.pairs,
  );

  const preservedChapters = chapterAlignment.pairs
    .slice()
    .sort((left, right) => left.currentIndex - right.currentIndex)
    .map((pair): PreservedChapterIdV1 => {
      const previousChapterId = previousChapters[pair.previousIndex].entry.chapterId;
      return {
        previousChapterId,
        currentChapterId: currentChapters[pair.currentIndex].entry.chapterId,
        preservedChapterId: previousChapterId,
        evidence: pair.evidence,
        evidenceBlockIds: pair.evidenceBlockIds,
      };
    });
  const ambiguities: NovelReimportAmbiguityV1[] = [
    ...currentBlockIndex.issues.map((issue): BlockReimportAmbiguityV1 => ({
      entityType: 'block',
      code: 'block_alignment_ambiguous',
      currentBlockId: issue.currentBlockId,
      candidatePreviousBlockIds: issue.candidateOldBlockIds,
      evidenceLevel: issue.evidenceLevel,
      reviewStatus: 'pending',
    })),
    ...chapterAlignment.ambiguities,
  ];

  return {
    documentType: 'novel-reimport-plan',
    schemaVersion: NOVEL_REIMPORT_PLAN_SCHEMA_VERSION,
    previousTextRevisionId:
      previousBlockIndex.canonicalTextRevision.textRevisionId,
    currentTextRevisionId: currentBlockIndex.canonicalTextRevision.textRevisionId,
    preservedBlockIds,
    preservedChapters,
    ambiguities,
    changes: buildChangeScopes(
      previousBlockIndex,
      currentBlockIndex,
      previousChapterIndex,
      currentChapterIndex,
      previousChapters,
      currentChapters,
      chapterAlignment.pairs,
      preservedBlockIdSet,
    ),
    reviewStatus: ambiguities.length === 0 ? 'not_required' : 'pending',
  };
}

function validateBlockIndex(
  value: DocumentBlockIndexV1,
  side: 'previous' | 'current',
): DocumentBlockIndexV1 {
  try {
    return validateDocumentBlockIndexV1(value);
  } catch (error) {
    invalid(
      `${side}_block_index_invalid`,
      `${capitalize(side)} block index is invalid: ${errorMessage(error)}`,
    );
  }
}

function validateChapterIndex(
  value: ChapterIndexV1,
  side: 'previous' | 'current',
): ChapterIndexV1 {
  try {
    return validateChapterIndexDomainV1(value);
  } catch (error) {
    invalid(
      `${side}_chapter_index_invalid`,
      `${capitalize(side)} chapter index is invalid: ${errorMessage(error)}`,
    );
  }
}

function assertIndexRelationship(
  blockIndex: DocumentBlockIndexV1,
  chapterIndex: ChapterIndexV1,
  side: 'previous' | 'current',
): void {
  const blockRevision = blockIndex.canonicalTextRevision;
  const chapterRevision = chapterIndex.textRevision;
  if (
    chapterIndex.sourceAssetId !== blockIndex.sourceAssetId
    || chapterIndex.sourceHash !== blockIndex.sourceContentHash
    || chapterRevision.textRevisionId !== blockRevision.textRevisionId
    || chapterRevision.textLayer !== blockRevision.textLayer
    || chapterRevision.contentHash !== blockRevision.contentHash
    || chapterRevision.byteLength !== blockRevision.byteLength
  ) {
    invalid(
      `${side}_chapter_block_revision_mismatch`,
      `${capitalize(side)} ChapterIndex must reference its DocumentBlockIndex exactly`,
    );
  }

  for (const entry of chapterIndex.entries) {
    const heading = exactHeadingBlock(blockIndex, entry);
    if (
      heading.canonicalText.trim() !== entry.rawHeading
    ) {
      invalid(
        `${side}_chapter_block_membership_invalid`,
        `${capitalize(side)} chapter headings must align to canonical blocks`,
      );
    }
  }
}

function assertPreservedBlockEvidence(
  previousBlocksById: ReadonlyMap<
    string,
    { readonly block: CanonicalDocumentBlockV1; readonly index: number }
  >,
  currentBlocksById: ReadonlyMap<
    string,
    { readonly block: CanonicalDocumentBlockV1; readonly index: number }
  >,
  preservedBlockIds: readonly string[],
): void {
  let previousIndex = -1;
  for (const blockId of preservedBlockIds) {
    const previous = previousBlocksById.get(blockId)!;
    const current = currentBlocksById.get(blockId)!;
    if (
      previous.block.kind !== current.block.kind
      || previous.block.contentHash !== current.block.contentHash
      || previous.block.canonicalText !== current.block.canonicalText
    ) {
      invalid(
        'preserved_block_identity_invalid',
        'A preserved block ID must retain exact kind and canonical content',
      );
    }
    if (previous.index <= previousIndex) {
      invalid(
        'preserved_block_order_invalid',
        'Preserved block IDs must retain monotonic source order',
      );
    }
    previousIndex = previous.index;
  }
}

function assertBlockAmbiguityEvidence(
  currentBlockIndex: DocumentBlockIndexV1,
  previousBlocksById: ReadonlyMap<string, unknown>,
): void {
  for (const issue of currentBlockIndex.issues) {
    if (issue.candidateOldBlockIds.some(id => !previousBlocksById.has(id))) {
      invalid(
        'block_ambiguity_evidence_invalid',
        'Current block ambiguity candidates must exist in the previous index',
      );
    }
  }
}

function createChapterContexts(
  blockIndex: DocumentBlockIndexV1,
  chapterIndex: ChapterIndexV1,
  preservedBlockIds: ReadonlySet<string>,
): readonly ChapterContext[] {
  return chapterIndex.entries.map(entry => ({
    entry,
    headingBlock: exactHeadingBlock(blockIndex, entry),
    stableSubstantiveBlockIds: blocksInChapter(blockIndex, entry)
      .filter(block => preservedBlockIds.has(block.blockId))
      .filter(block => block.canonicalText.trim().length > 0)
      .map(block => block.blockId),
  }));
}

function alignChapters(
  previous: readonly ChapterContext[],
  current: readonly ChapterContext[],
): ChapterAlignment {
  const pairs: ChapterPair[] = [];
  const usedPrevious = new Set<number>();
  const usedCurrent = new Set<number>();
  const previousByHeadingBlockId = new Map(
    previous.map((chapter, index) => [chapter.headingBlock.blockId, index]),
  );

  for (const [currentIndex, chapter] of current.entries()) {
    const previousIndex = previousByHeadingBlockId.get(chapter.headingBlock.blockId);
    if (previousIndex === undefined)
      continue;
    pairs.push({
      previousIndex,
      currentIndex,
      evidence: 'stable-heading-block',
      evidenceBlockIds: [chapter.headingBlock.blockId],
    });
    usedPrevious.add(previousIndex);
    usedCurrent.add(currentIndex);
  }

  const previousCandidates = previous
    .map((_, index) => index)
    .filter(index => !usedPrevious.has(index));
  const currentCandidates = current
    .map((_, index) => index)
    .filter(index => !usedCurrent.has(index));
  const scores = new Map<string, readonly string[]>();
  for (const currentIndex of currentCandidates) {
    for (const previousIndex of previousCandidates) {
      const shared = intersectInOrder(
        current[currentIndex].stableSubstantiveBlockIds,
        new Set(previous[previousIndex].stableSubstantiveBlockIds),
      );
      if (shared.length > 0)
        scores.set(pairKey(currentIndex, previousIndex), shared);
    }
  }

  const bestPreviousByCurrent = new Map<number, readonly number[]>();
  for (const currentIndex of currentCandidates) {
    bestPreviousByCurrent.set(
      currentIndex,
      bestMatches(currentIndex, previousCandidates, scores, 'current'),
    );
  }
  const bestCurrentByPrevious = new Map<number, readonly number[]>();
  for (const previousIndex of previousCandidates) {
    bestCurrentByPrevious.set(
      previousIndex,
      bestMatches(previousIndex, currentCandidates, scores, 'previous'),
    );
  }

  const ambiguities: ChapterReimportAmbiguityV1[] = [];
  for (const currentIndex of currentCandidates) {
    const candidates = bestPreviousByCurrent.get(currentIndex) ?? [];
    if (candidates.length === 0)
      continue;
    const [candidate] = candidates;
    const reciprocal = candidates.length === 1
      && bestCurrentByPrevious.get(candidate)?.length === 1
      && bestCurrentByPrevious.get(candidate)?.[0] === currentIndex;
    if (reciprocal) {
      pairs.push({
        previousIndex: candidate,
        currentIndex,
        evidence: 'reciprocal-stable-block-anchors',
        evidenceBlockIds: scores.get(pairKey(currentIndex, candidate)) ?? [],
      });
      continue;
    }

    ambiguities.push({
      entityType: 'chapter',
      code: 'chapter_alignment_ambiguous',
      currentChapterId: current[currentIndex].entry.chapterId,
      candidatePreviousChapterIds: candidates.map(
        index => previous[index].entry.chapterId,
      ),
      evidenceBlockIds: uniqueInOrder(candidates.flatMap(
        index => scores.get(pairKey(currentIndex, index)) ?? [],
      )),
      reviewStatus: 'pending',
    });
  }

  return { pairs, ambiguities };
}

function bestMatches(
  fixedIndex: number,
  candidates: readonly number[],
  scores: ReadonlyMap<string, readonly string[]>,
  fixedSide: 'current' | 'previous',
): readonly number[] {
  let maximum = 0;
  const best: number[] = [];
  for (const candidate of candidates) {
    const currentIndex = fixedSide === 'current' ? fixedIndex : candidate;
    const previousIndex = fixedSide === 'current' ? candidate : fixedIndex;
    const score = scores.get(pairKey(currentIndex, previousIndex))?.length ?? 0;
    if (score === 0 || score < maximum)
      continue;
    if (score > maximum) {
      maximum = score;
      best.length = 0;
    }
    best.push(candidate);
  }
  return best;
}

function assertNoChapterIdCollision(
  previous: ChapterIndexV1,
  current: ChapterIndexV1,
  pairs: readonly ChapterPair[],
): void {
  const pairByCurrent = new Map(pairs.map(pair => [pair.currentIndex, pair.previousIndex]));
  const previousById = new Map(
    previous.entries.map((entry, index) => [entry.chapterId, index]),
  );
  for (const [currentIndex, entry] of current.entries.entries()) {
    const sameIdPreviousIndex = previousById.get(entry.chapterId);
    if (
      sameIdPreviousIndex !== undefined
      && pairByCurrent.get(currentIndex) !== sameIdPreviousIndex
    ) {
      invalid(
        'chapter_id_collision',
        'A current chapter ID collides with an unrelated previous chapter',
      );
    }
  }
}

function buildChangeScopes(
  previousBlockIndex: DocumentBlockIndexV1,
  currentBlockIndex: DocumentBlockIndexV1,
  previousChapterIndex: ChapterIndexV1,
  currentChapterIndex: ChapterIndexV1,
  previousChapters: readonly ChapterContext[],
  currentChapters: readonly ChapterContext[],
  pairs: readonly ChapterPair[],
  preservedBlockIds: ReadonlySet<string>,
): NovelReimportChangeScopesV1 {
  const content = mutableAffectedIds();
  const structure = mutableAffectedIds();
  const display = mutableAffectedIds();
  const displayCandidates: DisplayChangeCandidate[] = [];

  for (const block of previousBlockIndex.blocks) {
    if (preservedBlockIds.has(block.blockId))
      continue;
    content.previousBlockIds.add(block.blockId);
    for (const chapterId of chapterIdsOverlappingBlock(previousChapterIndex, block))
      content.previousChapterIds.add(chapterId);
  }
  for (const block of currentBlockIndex.blocks) {
    if (preservedBlockIds.has(block.blockId))
      continue;
    content.currentBlockIds.add(block.blockId);
    for (const chapterId of chapterIdsOverlappingBlock(currentChapterIndex, block))
      content.currentChapterIds.add(chapterId);
  }

  const previousMatched = new Set(pairs.map(pair => pair.previousIndex));
  const currentMatched = new Set(pairs.map(pair => pair.currentIndex));
  for (const [index, chapter] of previousChapters.entries()) {
    if (previousMatched.has(index))
      continue;
    structure.previousChapterIds.add(chapter.entry.chapterId);
    structure.previousBlockIds.add(chapter.headingBlock.blockId);
  }
  for (const [index, chapter] of currentChapters.entries()) {
    if (currentMatched.has(index))
      continue;
    structure.currentChapterIds.add(chapter.entry.chapterId);
    structure.currentBlockIds.add(chapter.headingBlock.blockId);
  }

  const previousIdByCurrentId = new Map<string, string>();
  const currentIdByPreviousId = new Map<string, string>();
  for (const pair of pairs) {
    const previous = previousChapters[pair.previousIndex];
    const current = currentChapters[pair.currentIndex];
    previousIdByCurrentId.set(current.entry.chapterId, previous.entry.chapterId);
    currentIdByPreviousId.set(previous.entry.chapterId, current.entry.chapterId);

    if (current.entry.title !== previous.entry.title) {
      displayCandidates.push({
        previousChapterId: previous.entry.chapterId,
        currentChapterId: current.entry.chapterId,
      });
    }
    if (
      current.headingBlock.blockId !== previous.headingBlock.blockId
      || current.entry.rawHeading !== previous.entry.rawHeading
      || current.entry.chapterNumber !== previous.entry.chapterNumber
      || current.entry.volumeNumber !== previous.entry.volumeNumber
      || current.entry.detectedBy !== previous.entry.detectedBy
      || current.entry.confidence !== previous.entry.confidence
      || current.entry.reviewStatus !== previous.entry.reviewStatus
    ) {
      structure.previousChapterIds.add(previous.entry.chapterId);
      structure.currentChapterIds.add(current.entry.chapterId);
      structure.previousBlockIds.add(previous.headingBlock.blockId);
      structure.currentBlockIds.add(current.headingBlock.blockId);
    }

    const previousInteriorBoundary = interiorBoundaryBlock(
      previousBlockIndex,
      previous.entry.contentRange.endByte,
    );
    const currentInteriorBoundary = interiorBoundaryBlock(
      currentBlockIndex,
      current.entry.contentRange.endByte,
    );
    if (!sameInteriorBoundary(previousInteriorBoundary, currentInteriorBoundary)) {
      structure.previousChapterIds.add(previous.entry.chapterId);
      structure.currentChapterIds.add(current.entry.chapterId);
      if (previousInteriorBoundary !== undefined) {
        structure.previousBlockIds.add(previousInteriorBoundary.block.blockId);
      }
      if (currentInteriorBoundary !== undefined)
        structure.currentBlockIds.add(currentInteriorBoundary.block.blockId);
    }
  }

  const previousBlocksById = new Map(
    previousBlockIndex.blocks.map(block => [block.blockId, block]),
  );
  const currentBlocksById = new Map(
    currentBlockIndex.blocks.map(block => [block.blockId, block]),
  );
  for (const blockId of preservedBlockIds) {
    const previousOwner = membershipOwner(
      previousBlocksById.get(blockId)!,
      previousChapterIndex,
    );
    const currentOwner = membershipOwner(
      currentBlocksById.get(blockId)!,
      currentChapterIndex,
    );
    const normalizedCurrentOwner = currentOwner?.kind === 'chapter'
      ? {
          ...currentOwner,
          value: previousIdByCurrentId.get(currentOwner.value)
            ?? `current:${currentOwner.value}`,
        }
      : currentOwner;
    if (sameOwner(previousOwner, normalizedCurrentOwner))
      continue;

    structure.previousBlockIds.add(blockId);
    structure.currentBlockIds.add(blockId);
    if (previousOwner?.kind === 'chapter')
      structure.previousChapterIds.add(previousOwner.value);
    if (previousOwner?.kind === 'chapter') {
      addDefined(
        structure.currentChapterIds,
        currentIdByPreviousId.get(previousOwner.value),
      );
    }
    if (currentOwner?.kind === 'chapter') {
      structure.currentChapterIds.add(currentOwner.value);
      addDefined(
        structure.previousChapterIds,
        previousIdByCurrentId.get(currentOwner.value),
      );
    }
  }

  for (const candidate of displayCandidates) {
    if (
      content.previousChapterIds.has(candidate.previousChapterId)
      || content.currentChapterIds.has(candidate.currentChapterId)
      || structure.previousChapterIds.has(candidate.previousChapterId)
      || structure.currentChapterIds.has(candidate.currentChapterId)
    ) {
      continue;
    }
    display.previousChapterIds.add(candidate.previousChapterId);
    display.currentChapterIds.add(candidate.currentChapterId);
  }

  return {
    content: finalizeAffectedIds(
      content,
      previousBlockIndex,
      currentBlockIndex,
      previousChapterIndex,
      currentChapterIndex,
    ),
    structure: finalizeAffectedIds(
      structure,
      previousBlockIndex,
      currentBlockIndex,
      previousChapterIndex,
      currentChapterIndex,
    ),
    display: finalizeAffectedIds(
      display,
      previousBlockIndex,
      currentBlockIndex,
      previousChapterIndex,
      currentChapterIndex,
    ),
  };
}

function chapterIdsOverlappingBlock(
  chapterIndex: ChapterIndexV1,
  block: CanonicalDocumentBlockV1,
): readonly string[] {
  return chapterIndex.entries
    .filter((entry) => {
      const chapterStart = entry.headingRange.startByte;
      const chapterEnd = entry.contentRange.endByte;
      if (block.canonicalRange.startByte === block.canonicalRange.endByte) {
        return block.canonicalRange.startByte >= chapterStart
          && block.canonicalRange.startByte < chapterEnd;
      }
      return block.canonicalRange.startByte < chapterEnd
        && block.canonicalRange.endByte > chapterStart;
    })
    .map(entry => entry.chapterId);
}

function membershipOwner(
  block: CanonicalDocumentBlockV1,
  chapterIndex: ChapterIndexV1,
): MembershipOwner | undefined {
  const chapter = chapterIndex.entries.find(entry => blockIsInChapter(block, entry));
  if (chapter !== undefined)
    return { kind: 'chapter', value: chapter.chapterId };

  const segment = chapterIndex.coverageReport.segments.find(({ range }) =>
    cursorIsInRange(block.canonicalRange.startByte, range.startByte, range.endByte));
  if (segment === undefined)
    return undefined;
  return {
    kind: 'classification',
    value: segment.classification satisfies CoverageClassificationV1,
  };
}

function exactHeadingBlock(
  index: DocumentBlockIndexV1,
  entry: ChapterIndexEntryV1,
): CanonicalDocumentBlockV1 {
  const block = index.blocks.find(candidate =>
    candidate.canonicalRange.startByte === entry.headingRange.startByte
    && candidate.canonicalRange.endByte === entry.headingRange.endByte);
  if (block === undefined) {
    invalid(
      'chapter_heading_block_missing',
      'Every chapter heading must match one complete canonical block',
    );
  }
  return block;
}

function interiorBoundaryBlock(
  index: DocumentBlockIndexV1,
  cursor: number,
): { readonly block: CanonicalDocumentBlockV1; readonly offset: number } | undefined {
  const block = index.blocks.find(candidate =>
    candidate.canonicalRange.startByte < cursor
    && cursor < candidate.canonicalRange.endByte);
  if (block === undefined)
    return undefined;
  return {
    block,
    offset: cursor - block.canonicalRange.startByte,
  };
}

function sameInteriorBoundary(
  previous: ReturnType<typeof interiorBoundaryBlock>,
  current: ReturnType<typeof interiorBoundaryBlock>,
): boolean {
  if (previous === undefined || current === undefined)
    return previous === current;
  return previous.block.blockId === current.block.blockId
    && previous.offset === current.offset;
}

function blocksInChapter(
  index: DocumentBlockIndexV1,
  entry: ChapterIndexEntryV1,
): readonly CanonicalDocumentBlockV1[] {
  return index.blocks.filter(block => blockIsInChapter(block, entry));
}

function blockIsInChapter(
  block: CanonicalDocumentBlockV1,
  entry: ChapterIndexEntryV1,
): boolean {
  const start = entry.headingRange.startByte;
  const end = entry.contentRange.endByte;
  if (block.canonicalRange.startByte !== block.canonicalRange.endByte) {
    return block.canonicalRange.startByte >= start
      && block.canonicalRange.endByte <= end;
  }
  return block.canonicalRange.startByte >= start
    && block.canonicalRange.startByte < end;
}

function mutableAffectedIds(): MutableAffectedIds {
  return {
    previousBlockIds: new Set(),
    currentBlockIds: new Set(),
    previousChapterIds: new Set(),
    currentChapterIds: new Set(),
  };
}

function finalizeAffectedIds(
  ids: MutableAffectedIds,
  previousBlockIndex: DocumentBlockIndexV1,
  currentBlockIndex: DocumentBlockIndexV1,
  previousChapterIndex: ChapterIndexV1,
  currentChapterIndex: ChapterIndexV1,
): NovelReimportAffectedIdsV1 {
  return {
    previousBlockIds: sourceOrderedBlockIds(previousBlockIndex, ids.previousBlockIds),
    currentBlockIds: sourceOrderedBlockIds(currentBlockIndex, ids.currentBlockIds),
    previousChapterIds: sourceOrderedChapterIds(
      previousChapterIndex,
      ids.previousChapterIds,
    ),
    currentChapterIds: sourceOrderedChapterIds(
      currentChapterIndex,
      ids.currentChapterIds,
    ),
  };
}

function sourceOrderedBlockIds(
  index: DocumentBlockIndexV1,
  selected: ReadonlySet<string>,
): readonly string[] {
  return index.blocks.filter(block => selected.has(block.blockId)).map(block => block.blockId);
}

function sourceOrderedChapterIds(
  index: ChapterIndexV1,
  selected: ReadonlySet<string>,
): readonly string[] {
  return index.entries.filter(entry => selected.has(entry.chapterId)).map(entry => entry.chapterId);
}

function intersectInOrder(
  values: readonly string[],
  selected: ReadonlySet<string>,
): readonly string[] {
  return values.filter(value => selected.has(value));
}

function uniqueInOrder(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function pairKey(currentIndex: number, previousIndex: number): string {
  return `${currentIndex}:${previousIndex}`;
}

function sameOwner(
  left: MembershipOwner | undefined,
  right: MembershipOwner | undefined,
): boolean {
  return left?.kind === right?.kind && left?.value === right?.value;
}

function cursorIsInRange(cursor: number, start: number, end: number): boolean {
  return cursor >= start && cursor < end;
}

function addDefined(target: Set<string>, value: string | undefined): void {
  if (value !== undefined)
    target.add(value);
}

function capitalize(value: string): string {
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown validation failure';
}

function invalid(detailReason: string, message: string): never {
  throw new NovelReimportPlanValidationError(detailReason, message);
}
