/// <reference types="node" />

import type {
  ChapterIndexEntryV1,
  ChapterIndexV1,
  SceneBoundaryCandidateV1,
  SceneBoundaryReasonV1,
  SceneIndexV1,
  SceneIssueV1,
  SceneV1,
  TextRangeV1,
} from '@voxweaver/contracts';
import type {
  CanonicalDocumentBlockV1,
  DocumentBlockIndexV1,
} from '@voxweaver/novel-domain';

import { randomUUID } from 'node:crypto';

import {
  NOVEL_IMPORT_SCHEMA_VERSION,
  parseSceneIndexV1,
} from '@voxweaver/contracts';
import {
  validateChapterIndexDomainV1,
  validateDocumentBlockIndexV1,
  validateSceneIndexDomainV1,
} from '@voxweaver/novel-domain';

const UUID_V4_PATTERN
  = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const EXPLICIT_SEPARATOR_PATTERN
  = /^(?:\*{3,}|-{3,}|—{2,}|_{3,}|={3,}|~{3,}|·{3,}|※{1,3}|[◆◇●○★☆]{1,3})$/u;

const SEMANTIC_CUES: readonly {
  readonly reason: Exclude<SceneBoundaryReasonV1, 'explicit_separator'>;
  readonly pattern: RegExp;
  readonly evidence: string;
}[] = [
  {
    reason: 'dream_transition',
    pattern: /^(?:梦中|在梦里|他梦见|她梦见|我梦见|仿佛置身梦境)(?:[，,。：:\s]|$)/u,
    evidence: 'block-start dream transition cue',
  },
  {
    reason: 'memory_transition',
    pattern: /^(?:[他她我]?(?:忽然|不禁)?(?:想起|忆起|回忆起)|记忆回到|往事浮现)(?:[，,。：:\s]|$)/u,
    evidence: 'block-start memory transition cue',
  },
  {
    reason: 'time_change',
    pattern: /^(?:翌日|次日|第二天|当晚|翌晨|数日后|多年后|片刻后)(?:[，,。：:\s]|$)/u,
    evidence: 'block-start time transition cue',
  },
  {
    reason: 'location_change',
    pattern: /^(?:地点转到|场景转至|来到|回到|城外|宫中|山下|屋内|门外)(?:[，,。：:\s]|$)/u,
    evidence: 'block-start location transition cue',
  },
  {
    reason: 'viewpoint_change',
    pattern: /^(?:另一边|与此同时|视角转向)(?:[，,。：:\s]|$)/u,
    evidence: 'block-start viewpoint transition cue',
  },
  {
    reason: 'event_change',
    pattern: /^(?:话分两头|镜头一转|局势突变|事件转折)(?:[，,。：:\s]|$)/u,
    evidence: 'block-start event transition cue',
  },
];

export const SCENE_DETECTOR_PROCESSOR_ID
  = 'voxweaver.text-pipeline.scene-detector' as const;
export const SCENE_DETECTOR_PROCESSOR_VERSION = '1.0.0' as const;
export const SCENE_BOUNDARY_RULE_VERSION = 'm2-scene-boundary-rules-v1' as const;

export interface SceneBoundaryReviewV1 {
  readonly sceneBoundaryCandidateId: string;
  readonly decision: 'approved' | 'rejected';
  readonly adjustedBoundaryByte?: number;
}

export interface DetectScenesOptionsV1 {
  readonly candidateIdFactory?: () => string;
  readonly sceneIdFactory?: () => string;
  readonly issueIdFactory?: () => string;
  readonly boundaryReviews?: readonly SceneBoundaryReviewV1[];
}

export interface DetectScenesInputV1 {
  readonly chapterIndex: ChapterIndexV1;
  readonly blockIndex: DocumentBlockIndexV1;
  readonly previousSceneIndex?: SceneIndexV1;
  readonly options?: DetectScenesOptionsV1;
}

interface IdContext {
  readonly unavailableFreshIds: Set<string>;
  readonly claimedOutputIds: Set<string>;
  readonly candidateIdFactory: () => string;
  readonly sceneIdFactory: () => string;
  readonly issueIdFactory: () => string;
  readonly previousCandidates: ReadonlyMap<string, SceneBoundaryCandidateV1>;
  readonly previousCandidatesById: ReadonlyMap<string, SceneBoundaryCandidateV1>;
  readonly previousSceneIds: ReadonlyMap<string, string>;
  readonly previousIssueIds: ReadonlyMap<string, string>;
}

export class SceneDetectionError extends Error {
  readonly code = 'NOVEL_IMPORT_STRUCTURE_INVALID';

  constructor(
    readonly detailReason: string,
    message: string,
  ) {
    super(message);
    this.name = 'SceneDetectionError';
  }
}

export function detectScenesV1(input: DetectScenesInputV1): SceneIndexV1 {
  assertUnresolvedReviewStatus(
    input?.chapterIndex,
    'scene_chapter_review_required',
    'Scene detection requires a resolved ChapterIndex',
  );
  assertUnresolvedReviewStatus(
    input?.blockIndex,
    'scene_block_review_required',
    'Scene detection requires a resolved canonical block index',
  );
  const chapterIndex = validateChapterInput(input?.chapterIndex);
  const blockIndex = validateBlockInput(input?.blockIndex);
  assertReadyInput(chapterIndex, blockIndex);
  const previousSceneIndex = validatePreviousInput(
    input?.previousSceneIndex,
    chapterIndex,
    blockIndex,
  );
  const options = validateOptions(input?.options);
  const ids = createIdContext(chapterIndex, blockIndex, previousSceneIndex, options);
  const candidates = detectCandidates(chapterIndex, blockIndex, ids);
  const reviewedCandidates = applyReviews(
    candidates,
    options.boundaryReviews ?? [],
    chapterIndex,
    blockIndex,
    ids,
  );
  const issues = buildIssues(reviewedCandidates, ids);
  const scenes = buildScenes(chapterIndex, blockIndex, reviewedCandidates, ids);
  const value: SceneIndexV1 = {
    documentType: 'scene-index',
    schemaVersion: NOVEL_IMPORT_SCHEMA_VERSION,
    sourceAssetId: blockIndex.sourceAssetId,
    sourceHash: blockIndex.sourceContentHash,
    processorId: SCENE_DETECTOR_PROCESSOR_ID,
    processorVersion: SCENE_DETECTOR_PROCESSOR_VERSION,
    textRevision: blockIndex.canonicalTextRevision,
    candidates: reviewedCandidates,
    scenes,
    issues,
    reviewStatus: issues.length > 0 ? 'pending' : 'not_required',
  };
  try {
    parseSceneIndexV1(value);
    return validateSceneIndexDomainV1(value, chapterIndex, blockIndex);
  } catch (error) {
    invalid(
      'scene_output_invalid',
      `Generated SceneIndexV1 is invalid: ${errorMessage(error)}`,
    );
  }
}

function validateChapterInput(value: ChapterIndexV1): ChapterIndexV1 {
  try {
    return validateChapterIndexDomainV1(value);
  } catch (error) {
    invalid(
      'scene_chapter_index_invalid',
      `Scene detection ChapterIndex is invalid: ${errorMessage(error)}`,
    );
  }
}

function validateBlockInput(value: DocumentBlockIndexV1): DocumentBlockIndexV1 {
  try {
    return validateDocumentBlockIndexV1(value);
  } catch (error) {
    invalid(
      'scene_block_index_invalid',
      `Scene detection block index is invalid: ${errorMessage(error)}`,
    );
  }
}

function assertReadyInput(
  chapterIndex: ChapterIndexV1,
  blockIndex: DocumentBlockIndexV1,
): void {
  if (
    chapterIndex.sourceAssetId !== blockIndex.sourceAssetId
    || chapterIndex.sourceHash !== blockIndex.sourceContentHash
    || !sameRevision(chapterIndex.textRevision, blockIndex.canonicalTextRevision)
  ) {
    invalid(
      'scene_input_provenance_mismatch',
      'Scene detection inputs must reference one source and canonical revision',
    );
  }
  if (
    chapterIndex.reviewStatus !== 'not_required'
    && chapterIndex.reviewStatus !== 'approved'
  ) {
    invalid(
      'scene_chapter_review_required',
      'Scene detection requires a resolved ChapterIndex',
    );
  }
  const blockReviewStatus: unknown = blockIndex.reviewStatus;
  if (blockReviewStatus !== 'not_required' && blockReviewStatus !== 'approved') {
    invalid(
      'scene_block_review_required',
      'Scene detection requires a resolved canonical block index',
    );
  }
}

function assertUnresolvedReviewStatus(
  value: unknown,
  detailReason: string,
  message: string,
): void {
  if (typeof value !== 'object' || value === null)
    return;
  const reviewStatus = (value as { readonly reviewStatus?: unknown }).reviewStatus;
  if (reviewStatus === 'pending' || reviewStatus === 'rejected')
    invalid(detailReason, message);
}

function validatePreviousInput(
  value: SceneIndexV1 | undefined,
  chapterIndex: ChapterIndexV1,
  blockIndex: DocumentBlockIndexV1,
): SceneIndexV1 | undefined {
  if (value === undefined)
    return undefined;
  let previous: SceneIndexV1;
  try {
    previous = parseSceneIndexV1(value);
  } catch (error) {
    invalid(
      'scene_previous_index_invalid',
      `Previous SceneIndex is invalid: ${errorMessage(error)}`,
    );
  }
  if (
    previous.sourceAssetId !== chapterIndex.sourceAssetId
    || previous.sourceAssetId !== blockIndex.sourceAssetId
    || previous.sourceHash !== chapterIndex.sourceHash
    || previous.sourceHash !== blockIndex.sourceContentHash
    || !sameRevision(previous.textRevision, chapterIndex.textRevision)
    || !sameRevision(previous.textRevision, blockIndex.canonicalTextRevision)
  ) {
    invalid(
      'scene_previous_input_mismatch',
      'Previous SceneIndex must reference the same source and canonical revision',
    );
  }
  return previous;
}

function createIdContext(
  chapterIndex: ChapterIndexV1,
  blockIndex: DocumentBlockIndexV1,
  previous: SceneIndexV1 | undefined,
  options: DetectScenesOptionsV1,
): IdContext {
  const upstreamIds = collectUpstreamIds(chapterIndex, blockIndex);
  const previousOutputIds = new Set<string>();
  if (previous !== undefined) {
    for (const id of previous.candidates.map(candidate => candidate.sceneBoundaryCandidateId))
      reservePreviousId(id, upstreamIds, previousOutputIds);
    for (const id of previous.scenes.map(scene => scene.sceneId))
      reservePreviousId(id, upstreamIds, previousOutputIds);
    for (const id of previous.issues.map(issue => issue.issueId))
      reservePreviousId(id, upstreamIds, previousOutputIds);
  }
  const reusablePrevious = previous?.processorId === SCENE_DETECTOR_PROCESSOR_ID
    && previous.processorVersion === SCENE_DETECTOR_PROCESSOR_VERSION
    ? previous
    : undefined;
  return {
    unavailableFreshIds: new Set([...upstreamIds, ...previousOutputIds]),
    claimedOutputIds: new Set<string>(),
    candidateIdFactory: validateFactory(options.candidateIdFactory, 'candidate'),
    sceneIdFactory: validateFactory(options.sceneIdFactory, 'scene'),
    issueIdFactory: validateFactory(options.issueIdFactory, 'issue'),
    previousCandidates: uniquePreviousValueMap(
      reusablePrevious?.candidates.map(candidate => [
        candidateStableKey(candidate),
        candidate,
      ]) ?? [],
    ),
    previousCandidatesById: new Map(
      reusablePrevious?.candidates.map(candidate => [
        candidate.sceneBoundaryCandidateId,
        candidate,
      ]) ?? [],
    ),
    previousSceneIds: uniquePreviousIdMap(
      reusablePrevious?.scenes.map(scene => [sceneStableKey(scene), scene.sceneId]) ?? [],
    ),
    previousIssueIds: uniquePreviousIdMap(
      reusablePrevious?.issues
        .filter(issue =>
          issue.code === 'scene_boundary_review_required'
          && issue.reviewStatus === 'pending'
          && issue.sceneBoundaryCandidateId !== undefined)
        .map(issue => [issue.sceneBoundaryCandidateId!, issue.issueId]) ?? [],
    ),
  };
}

function collectUpstreamIds(
  chapterIndex: ChapterIndexV1,
  blockIndex: DocumentBlockIndexV1,
): Set<string> {
  const ids = new Set<string>([
    chapterIndex.sourceAssetId,
    chapterIndex.textRevision.textRevisionId,
    blockIndex.rawTextRevision.textRevisionId,
    blockIndex.canonicalTextRevision.textRevisionId,
  ]);
  for (const candidate of chapterIndex.candidates)
    ids.add(candidate.chapterCandidateId);
  for (const chapter of chapterIndex.entries) {
    ids.add(chapter.chapterId);
    if (chapter.volumeId !== undefined)
      ids.add(chapter.volumeId);
  }
  for (const issue of chapterIndex.issues)
    ids.add(issue.issueId);
  for (const block of blockIndex.blocks)
    ids.add(block.blockId);
  return ids;
}

function reservePreviousId(
  id: string,
  upstreamIds: ReadonlySet<string>,
  previousOutputIds: Set<string>,
): void {
  if (upstreamIds.has(id) || previousOutputIds.has(id)) {
    invalid(
      'scene_previous_id_collision',
      'Previous Scene output IDs must be unique and disjoint from upstream IDs',
    );
  }
  previousOutputIds.add(id);
}

function uniquePreviousIdMap(
  entries: readonly (readonly [string, string])[],
): ReadonlyMap<string, string> {
  const ids = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const [key, id] of entries) {
    if (ids.has(key)) {
      ids.delete(key);
      ambiguous.add(key);
    } else if (!ambiguous.has(key)) {
      ids.set(key, id);
    }
  }
  return ids;
}

function uniquePreviousValueMap<T>(
  entries: readonly (readonly [string, T])[],
): ReadonlyMap<string, T> {
  const values = new Map<string, T>();
  const ambiguous = new Set<string>();
  for (const [key, value] of entries) {
    if (values.has(key)) {
      values.delete(key);
      ambiguous.add(key);
    } else if (!ambiguous.has(key)) {
      values.set(key, value);
    }
  }
  return values;
}

function validateOptions(value: DetectScenesOptionsV1 | undefined): DetectScenesOptionsV1 {
  if (value === undefined)
    return {};
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    invalid('scene_options_invalid', 'Scene detection options must be an object');
  if (value.boundaryReviews !== undefined && !Array.isArray(value.boundaryReviews)) {
    invalid('scene_reviews_invalid', 'Scene boundary reviews must be an array');
  }
  return value;
}

function detectCandidates(
  chapterIndex: ChapterIndexV1,
  blockIndex: DocumentBlockIndexV1,
  ids: IdContext,
): readonly SceneBoundaryCandidateV1[] {
  const candidates: SceneBoundaryCandidateV1[] = [];
  for (const chapter of chapterIndex.entries) {
    const blocks = blocksWithinChapter(blockIndex.blocks, chapter);
    for (const [position, block] of blocks.entries()) {
      const visible = block.canonicalText.trim();
      if (isExplicitSeparator(visible)) {
        if (
          block.canonicalRange.endByte > chapter.contentRange.startByte
          && block.canonicalRange.endByte < chapter.contentRange.endByte
          && hasAdjacentNarrative(blocks, position, -1)
          && hasAdjacentNarrative(blocks, position, 1)
        ) {
          candidates.push(createCandidate(
            chapter,
            block,
            ['explicit_separator'],
            block.canonicalRange.endByte,
            ['full-block explicit separator'],
            ids,
          ));
        }
        continue;
      }
      if (
        block.kind !== 'paragraph'
        || block.canonicalRange.startByte <= chapter.contentRange.startByte
        || block.canonicalRange.startByte >= chapter.contentRange.endByte
      ) {
        continue;
      }
      const matchedCues = SEMANTIC_CUES.filter(cue => cue.pattern.test(visible));
      if (matchedCues.length === 0)
        continue;
      candidates.push(createCandidate(
        chapter,
        block,
        matchedCues.map(cue => cue.reason),
        block.canonicalRange.startByte,
        matchedCues.map(cue => cue.evidence),
        ids,
      ));
    }
  }
  return candidates;
}

function createCandidate(
  chapter: ChapterIndexEntryV1,
  block: CanonicalDocumentBlockV1,
  reasons: readonly SceneBoundaryReasonV1[],
  boundaryByte: number,
  evidence: readonly string[],
  ids: IdContext,
): SceneBoundaryCandidateV1 {
  const deterministic = reasons.length === 1 && reasons[0] === 'explicit_separator';
  const boundary = cursor(block.canonicalRange, boundaryByte);
  const candidate: Omit<SceneBoundaryCandidateV1, 'sceneBoundaryCandidateId'> = {
    chapterId: chapter.chapterId,
    blockId: block.blockId,
    reasons,
    evidenceRange: block.canonicalRange,
    proposedBoundary: boundary,
    ...(deterministic ? { appliedBoundary: boundary } : {}),
    sourceLocator: block.sourceLocator,
    ruleId: deterministic
      ? 'm2.scene-boundary.explicit-separator'
      : 'm2.scene-boundary.semantic-cue',
    ruleVersion: SCENE_BOUNDARY_RULE_VERSION,
    evidence,
    reviewStatus: deterministic ? 'not_required' : 'pending',
  };
  const previousCandidate = ids.previousCandidates.get(candidateStableKey(candidate));
  return {
    sceneBoundaryCandidateId: stableOutputId(
      previousCandidate?.sceneBoundaryCandidateId,
      ids.candidateIdFactory,
      ids,
      'candidate',
    ),
    ...candidate,
  };
}

function applyReviews(
  candidates: readonly SceneBoundaryCandidateV1[],
  reviews: readonly SceneBoundaryReviewV1[],
  chapterIndex: ChapterIndexV1,
  blockIndex: DocumentBlockIndexV1,
  ids: IdContext,
): readonly SceneBoundaryCandidateV1[] {
  const reviewByCandidate = new Map<string, SceneBoundaryReviewV1>();
  for (const review of reviews) {
    validateReview(review);
    if (reviewByCandidate.has(review.sceneBoundaryCandidateId)) {
      invalid('scene_review_duplicate', 'A Scene boundary candidate may be reviewed only once');
    }
    reviewByCandidate.set(review.sceneBoundaryCandidateId, review);
  }
  const candidatesById = new Map(candidates.map(candidate => [
    candidate.sceneBoundaryCandidateId,
    candidate,
  ]));
  for (const candidateId of reviewByCandidate.keys()) {
    if (!candidatesById.has(candidateId)) {
      invalid(
        'scene_review_candidate_missing',
        'Scene boundary review references an unknown or stale candidate',
      );
    }
  }

  const reviewed = candidates.map((candidate) => {
    const review = reviewByCandidate.get(candidate.sceneBoundaryCandidateId);
    if (review === undefined)
      return inheritPreviousDecision(candidate, chapterIndex, blockIndex, ids);
    if (review.decision === 'rejected') {
      return {
        ...candidate,
        appliedBoundary: undefined,
        reviewStatus: 'rejected' as const,
      };
    }
    const chapter = chapterIndex.entries.find(entry => entry.chapterId === candidate.chapterId);
    if (chapter === undefined)
      invalid('scene_review_chapter_missing', 'Reviewed Scene candidate Chapter is missing');
    const boundaryByte = review.adjustedBoundaryByte
      ?? candidate.proposedBoundary.startByte;
    assertReviewBoundary(boundaryByte, chapter, blockIndex);
    return {
      ...candidate,
      appliedBoundary: cursor(candidate.proposedBoundary, boundaryByte),
      reviewStatus: 'approved' as const,
    };
  });

  const usedBoundaries = new Set<string>();
  for (const candidate of reviewed) {
    if (candidate.appliedBoundary === undefined)
      continue;
    const key = `${candidate.chapterId}:${candidate.appliedBoundary.startByte}`;
    if (usedBoundaries.has(key)) {
      invalid(
        'scene_boundary_conflict',
        'Applied Scene boundary candidates must resolve to distinct Chapter offsets',
      );
    }
    usedBoundaries.add(key);
  }
  return reviewed;
}

function inheritPreviousDecision(
  candidate: SceneBoundaryCandidateV1,
  chapterIndex: ChapterIndexV1,
  blockIndex: DocumentBlockIndexV1,
  ids: IdContext,
): SceneBoundaryCandidateV1 {
  const previous = ids.previousCandidatesById.get(candidate.sceneBoundaryCandidateId);
  if (previous?.reviewStatus === 'rejected') {
    return {
      ...candidate,
      appliedBoundary: undefined,
      reviewStatus: 'rejected',
    };
  }
  if (previous?.reviewStatus !== 'approved')
    return candidate;
  if (previous.appliedBoundary === undefined) {
    invalid(
      'scene_previous_decision_invalid',
      'An approved previous Scene boundary must preserve its applied boundary',
    );
  }
  const chapter = chapterIndex.entries.find(entry => entry.chapterId === candidate.chapterId);
  if (chapter === undefined)
    invalid('scene_previous_chapter_missing', 'Previous Scene decision Chapter is missing');
  assertReviewBoundary(previous.appliedBoundary.startByte, chapter, blockIndex);
  return {
    ...candidate,
    appliedBoundary: previous.appliedBoundary,
    reviewStatus: 'approved',
  };
}

function validateReview(value: SceneBoundaryReviewV1): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    invalid('scene_review_invalid', 'Scene boundary review must be an object');
  if (!UUID_V4_PATTERN.test(value.sceneBoundaryCandidateId))
    invalid('scene_review_candidate_id_invalid', 'Scene review candidate ID must be UUID v4');
  if (value.decision !== 'approved' && value.decision !== 'rejected')
    invalid('scene_review_decision_invalid', 'Scene review decision is invalid');
  if (
    value.adjustedBoundaryByte !== undefined
    && (!Number.isSafeInteger(value.adjustedBoundaryByte) || value.adjustedBoundaryByte < 0)
  ) {
    invalid('scene_review_boundary_invalid', 'Adjusted Scene boundary must be a safe byte offset');
  }
  if (value.decision === 'rejected' && value.adjustedBoundaryByte !== undefined) {
    invalid(
      'scene_review_boundary_invalid',
      'A rejected Scene boundary must not carry an adjusted offset',
    );
  }
}

function assertReviewBoundary(
  boundaryByte: number,
  chapter: ChapterIndexEntryV1,
  blockIndex: DocumentBlockIndexV1,
): void {
  if (
    boundaryByte <= chapter.contentRange.startByte
    || boundaryByte >= chapter.contentRange.endByte
  ) {
    invalid(
      'scene_review_boundary_outside_chapter',
      'Adjusted Scene boundary must remain strictly inside its Chapter content',
    );
  }
  if (!blockIndex.blocks.some(block =>
    boundaryByte === block.canonicalRange.startByte
    || boundaryByte === block.canonicalRange.endByte)) {
    invalid(
      'scene_review_boundary_not_block_boundary',
      'Adjusted Scene boundary must use a canonical block boundary',
    );
  }
}

function buildIssues(
  candidates: readonly SceneBoundaryCandidateV1[],
  ids: IdContext,
): readonly SceneIssueV1[] {
  return candidates
    .filter(candidate => candidate.reviewStatus === 'pending')
    .map(candidate => ({
      issueId: stableOutputId(
        ids.previousIssueIds.get(candidate.sceneBoundaryCandidateId),
        ids.issueIdFactory,
        ids,
        'issue',
      ),
      code: 'scene_boundary_review_required',
      severity: 'warning' as const,
      reviewStatus: 'pending' as const,
      message: `Potential Scene boundary requires review: ${candidate.reasons.join(', ')}`,
      errorCode: 'NOVEL_IMPORT_REVIEW_REQUIRED' as const,
      detailReason: 'scene_boundary_semantic_uncertain',
      textRange: candidate.evidenceRange,
      sourceLocator: candidate.sourceLocator,
      sourceEncoding: candidate.sourceLocator.sourceEncoding,
      sourceByteRange: candidate.sourceLocator.sourceByteRange,
      chapterId: candidate.chapterId,
      blockId: candidate.blockId,
      sceneBoundaryCandidateId: candidate.sceneBoundaryCandidateId,
    }));
}

function buildScenes(
  chapterIndex: ChapterIndexV1,
  blockIndex: DocumentBlockIndexV1,
  candidates: readonly SceneBoundaryCandidateV1[],
  ids: IdContext,
): readonly SceneV1[] {
  const scenes: SceneV1[] = [];
  for (const chapter of chapterIndex.entries) {
    if (chapter.contentRange.startByte === chapter.contentRange.endByte)
      continue;
    const applied = candidates
      .filter(candidate =>
        candidate.chapterId === chapter.chapterId
        && candidate.appliedBoundary !== undefined)
      .sort((left, right) =>
        left.appliedBoundary!.startByte - right.appliedBoundary!.startByte);
    const starts = [chapter.contentRange.startByte, ...applied.map(candidate =>
      candidate.appliedBoundary!.startByte)];
    const ends = [
      ...applied.map(candidate => candidate.appliedBoundary!.startByte),
      chapter.contentRange.endByte,
    ];
    for (let order = 0; order < starts.length; order++) {
      const startByte = starts[order];
      const endByte = ends[order];
      const sceneRange = range(chapter.contentRange, startByte, endByte);
      const scene: Omit<SceneV1, 'sceneId'> = {
        chapterId: chapter.chapterId,
        order,
        range: sceneRange,
        ...(order === 0
          ? {}
          : { startBoundaryCandidateId: applied[order - 1].sceneBoundaryCandidateId }),
        blockReferences: blockReferences(blockIndex.blocks, sceneRange),
      };
      scenes.push({
        sceneId: stableOutputId(
          ids.previousSceneIds.get(sceneStableKey(scene)),
          ids.sceneIdFactory,
          ids,
          'scene',
        ),
        ...scene,
      });
    }
  }
  return scenes;
}

function blockReferences(
  blocks: readonly CanonicalDocumentBlockV1[],
  sceneRange: TextRangeV1,
): SceneV1['blockReferences'] {
  return blocks
    .filter(block =>
      block.canonicalRange.startByte < sceneRange.endByte
      && sceneRange.startByte < block.canonicalRange.endByte)
    .map(block => ({
      blockId: block.blockId,
      range: range(
        sceneRange,
        Math.max(sceneRange.startByte, block.canonicalRange.startByte),
        Math.min(sceneRange.endByte, block.canonicalRange.endByte),
      ),
      sourceLocator: block.sourceLocator,
    }));
}

function blocksWithinChapter(
  blocks: readonly CanonicalDocumentBlockV1[],
  chapter: ChapterIndexEntryV1,
): readonly CanonicalDocumentBlockV1[] {
  return blocks.filter(block =>
    block.canonicalRange.startByte >= chapter.contentRange.startByte
    && block.canonicalRange.endByte <= chapter.contentRange.endByte);
}

function hasAdjacentNarrative(
  blocks: readonly CanonicalDocumentBlockV1[],
  start: number,
  direction: -1 | 1,
): boolean {
  for (let position = start + direction; blocks[position] !== undefined; position += direction) {
    const visible = blocks[position].canonicalText.trim();
    if (visible.length === 0)
      continue;
    return !isExplicitSeparator(visible);
  }
  return false;
}

function isExplicitSeparator(visible: string): boolean {
  return EXPLICIT_SEPARATOR_PATTERN.test(visible);
}

function cursor(reference: TextRangeV1, byte: number): TextRangeV1 {
  return range(reference, byte, byte);
}

function range(
  reference: TextRangeV1,
  startByte: number,
  endByte: number,
): TextRangeV1 {
  return {
    textRevisionId: reference.textRevisionId,
    textLayer: reference.textLayer,
    offsetUnit: 'utf8-byte',
    startByte,
    endByte,
  };
}

function validateFactory(
  value: (() => string) | undefined,
  factoryName: string,
): () => string {
  if (value === undefined)
    return randomUUID;
  if (typeof value !== 'function')
    invalid(`scene_${factoryName}_id_factory_invalid`, `${factoryName} ID factory must be a function`);
  return value;
}

function stableOutputId(
  previousId: string | undefined,
  factory: () => string,
  ids: IdContext,
  idName: string,
): string {
  if (previousId !== undefined) {
    if (
      !ids.unavailableFreshIds.has(previousId)
      || ids.claimedOutputIds.has(previousId)
    ) {
      invalid(
        'scene_stable_id_collision',
        'A previous Scene output ID may be reused only once',
      );
    }
    ids.claimedOutputIds.add(previousId);
    return previousId;
  }

  let id: unknown;
  try {
    id = factory();
  } catch (error) {
    invalid(`scene_${idName}_id_factory_failed`, `${idName} ID factory failed: ${errorMessage(error)}`);
  }
  if (typeof id !== 'string' || !UUID_V4_PATTERN.test(id))
    invalid(`scene_${idName}_id_invalid`, `${idName} ID factory must return UUID v4`);
  if (
    ids.unavailableFreshIds.has(id)
    || ids.claimedOutputIds.has(id)
  ) {
    invalid(
      'scene_id_duplicate',
      'Fresh Scene output IDs must not collide with upstream or previous IDs',
    );
  }
  ids.unavailableFreshIds.add(id);
  ids.claimedOutputIds.add(id);
  return id;
}

function candidateStableKey(
  candidate: Omit<SceneBoundaryCandidateV1, 'sceneBoundaryCandidateId'>
    | SceneBoundaryCandidateV1,
): string {
  return JSON.stringify([
    candidate.chapterId,
    candidate.blockId,
    candidate.reasons,
    candidate.ruleId,
    candidate.ruleVersion,
    rangeStableKey(candidate.evidenceRange),
    rangeStableKey(candidate.proposedBoundary),
    locatorStableKey(candidate.sourceLocator),
  ]);
}

function sceneStableKey(scene: Omit<SceneV1, 'sceneId'> | SceneV1): string {
  return JSON.stringify([
    scene.chapterId,
    rangeStableKey(scene.range),
    scene.startBoundaryCandidateId ?? null,
    scene.blockReferences.map(reference => [
      reference.blockId,
      rangeStableKey(reference.range),
      locatorStableKey(reference.sourceLocator),
    ]),
  ]);
}

function rangeStableKey(value: TextRangeV1): readonly unknown[] {
  return [
    value.textRevisionId,
    value.textLayer,
    value.offsetUnit,
    value.startByte,
    value.endByte,
  ];
}

function locatorStableKey(
  value: CanonicalDocumentBlockV1['sourceLocator'],
): readonly unknown[] {
  return [
    value.sourceAssetId,
    value.sourceContentHash,
    value.sourceEncoding,
    value.sourceByteRange.offsetUnit,
    value.sourceByteRange.startByte,
    value.sourceByteRange.endByte,
    rangeStableKey(value.rawTextRange),
    value.lineRange.lineBase,
    value.lineRange.startLine,
    value.lineRange.endLineExclusive,
  ];
}

function sameRevision(
  left: ChapterIndexV1['textRevision'],
  right: DocumentBlockIndexV1['canonicalTextRevision'],
): boolean {
  return left.textRevisionId === right.textRevisionId
    && left.textLayer === right.textLayer
    && left.contentHash === right.contentHash
    && left.byteLength === right.byteLength;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

function invalid(detailReason: string, message: string): never {
  throw new SceneDetectionError(detailReason, message);
}
