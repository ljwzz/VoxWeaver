import type {
  ChapterIndexV1,
  SceneBoundaryCandidateV1,
  SceneIndexV1,
  SceneV1,
  TextRangeV1,
  TxtSourceLocatorV1,
} from '@voxweaver/contracts';
import type {
  CanonicalDocumentBlockV1,
  DocumentBlockIndexV1,
} from './documentBlock.js';

import { parseSceneIndexV1 } from '@voxweaver/contracts';

import { validateDocumentBlockIndexV1 } from './blockAlignment.js';
import { validateChapterIndexDomainV1 } from './chapter.js';

export class SceneIndexDomainValidationError extends Error {
  readonly code = 'NOVEL_IMPORT_STRUCTURE_INVALID';

  constructor(
    readonly detailReason: string,
    message: string,
  ) {
    super(message);
    this.name = 'SceneIndexDomainValidationError';
  }
}

/**
 * Validates a SceneIndex against the exact ChapterIndex and canonical block
 * projection from which it was produced.
 */
export function validateSceneIndexDomainV1(
  value: SceneIndexV1,
  chapterIndexValue: ChapterIndexV1,
  blockIndexValue: DocumentBlockIndexV1,
): SceneIndexV1 {
  const sceneIndex = parseContract(value);
  const chapterIndex = validateChapterInput(chapterIndexValue);
  const blockIndex = validateBlockInput(blockIndexValue);
  assertSharedInput(sceneIndex, chapterIndex, blockIndex);

  const chapters = new Map(chapterIndex.entries.map(entry => [entry.chapterId, entry]));
  const blocks = new Map(blockIndex.blocks.map(block => [block.blockId, block]));
  const scenesByChapter = groupScenes(sceneIndex.scenes, chapters);
  assertSceneCoverage(chapterIndex, scenesByChapter);
  assertSceneBlockReferences(sceneIndex.scenes, blockIndex.blocks);
  assertCandidates(sceneIndex.candidates, chapters, blocks, blockIndex);
  assertIssueReferences(sceneIndex, chapters, blocks);
  return sceneIndex;
}

function parseContract(value: SceneIndexV1): SceneIndexV1 {
  try {
    return parseSceneIndexV1(value);
  } catch (error) {
    invalid(
      'scene_index_contract_invalid',
      `SceneIndexV1 violates its public contract: ${errorMessage(error)}`,
    );
  }
}

function validateChapterInput(value: ChapterIndexV1): ChapterIndexV1 {
  try {
    return validateChapterIndexDomainV1(value);
  } catch (error) {
    invalid(
      'scene_chapter_index_invalid',
      `Scene ChapterIndex input is invalid: ${errorMessage(error)}`,
    );
  }
}

function validateBlockInput(value: DocumentBlockIndexV1): DocumentBlockIndexV1 {
  try {
    return validateDocumentBlockIndexV1(value);
  } catch (error) {
    invalid(
      'scene_block_index_invalid',
      `Scene block index input is invalid: ${errorMessage(error)}`,
    );
  }
}

function assertSharedInput(
  sceneIndex: SceneIndexV1,
  chapterIndex: ChapterIndexV1,
  blockIndex: DocumentBlockIndexV1,
): void {
  if (
    sceneIndex.sourceAssetId !== chapterIndex.sourceAssetId
    || sceneIndex.sourceAssetId !== blockIndex.sourceAssetId
    || sceneIndex.sourceHash !== chapterIndex.sourceHash
    || sceneIndex.sourceHash !== blockIndex.sourceContentHash
  ) {
    invalid(
      'scene_source_provenance_mismatch',
      'Scene, Chapter, and block indexes must reference one immutable source',
    );
  }
  if (
    !sameRevision(sceneIndex.textRevision, chapterIndex.textRevision)
    || !sameRevision(sceneIndex.textRevision, blockIndex.canonicalTextRevision)
  ) {
    invalid(
      'scene_text_revision_mismatch',
      'Scene, Chapter, and block indexes must reference one canonical revision',
    );
  }
}

function groupScenes(
  scenes: readonly SceneV1[],
  chapters: ReadonlyMap<string, ChapterIndexV1['entries'][number]>,
): ReadonlyMap<string, readonly SceneV1[]> {
  const grouped = new Map<string, SceneV1[]>();
  let previousChapterOrder = -1;
  let previousChapterId: string | undefined;
  for (const scene of scenes) {
    const chapter = chapters.get(scene.chapterId);
    if (chapter === undefined)
      invalid('scene_chapter_missing', 'Every Scene must reference an existing Chapter');
    if (scene.chapterId !== previousChapterId) {
      if (chapter.order <= previousChapterOrder) {
        invalid(
          'scene_chapter_order_invalid',
          'Scene chapter groups must follow ChapterIndex source order',
        );
      }
      previousChapterOrder = chapter.order;
      previousChapterId = scene.chapterId;
    }
    const chapterScenes = grouped.get(scene.chapterId) ?? [];
    chapterScenes.push(scene);
    grouped.set(scene.chapterId, chapterScenes);
  }
  return grouped;
}

function assertSceneCoverage(
  chapterIndex: ChapterIndexV1,
  scenesByChapter: ReadonlyMap<string, readonly SceneV1[]>,
): void {
  for (const chapter of chapterIndex.entries) {
    const scenes = scenesByChapter.get(chapter.chapterId) ?? [];
    const contentLength = chapter.contentRange.endByte - chapter.contentRange.startByte;
    if (contentLength === 0) {
      if (scenes.length !== 0) {
        invalid(
          'scene_empty_chapter_invalid',
          'A Chapter with empty content must not contain a non-empty Scene',
        );
      }
      continue;
    }
    if (scenes.length === 0)
      invalid('scene_chapter_uncovered', 'Every non-empty Chapter must contain a Scene');

    let cursor = chapter.contentRange.startByte;
    for (const scene of scenes) {
      if (
        scene.range.startByte !== cursor
        || scene.range.endByte > chapter.contentRange.endByte
      ) {
        invalid(
          'scene_chapter_coverage_invalid',
          'Scenes must contiguously cover only their Chapter content range',
        );
      }
      cursor = scene.range.endByte;
    }
    if (cursor !== chapter.contentRange.endByte) {
      invalid(
        'scene_chapter_coverage_invalid',
        'Scenes must reach the end of their Chapter content range',
      );
    }
  }
}

function assertSceneBlockReferences(
  scenes: readonly SceneV1[],
  blocks: readonly CanonicalDocumentBlockV1[],
): void {
  for (const scene of scenes) {
    const expected = blocks
      .filter(block => rangesOverlap(block.canonicalRange, scene.range))
      .map(block => ({
        block,
        range: intersection(block.canonicalRange, scene.range),
      }));
    if (expected.length !== scene.blockReferences.length) {
      invalid(
        'scene_block_projection_invalid',
        'Scene block references must include every intersecting canonical block exactly once',
      );
    }
    for (const [position, reference] of scene.blockReferences.entries()) {
      const projection = expected[position];
      if (
        projection === undefined
        || reference.blockId !== projection.block.blockId
        || !sameRange(reference.range, projection.range)
        || !sameLocator(reference.sourceLocator, projection.block.sourceLocator)
      ) {
        invalid(
          'scene_block_projection_invalid',
          'Scene block references must preserve canonical ranges and source locators',
        );
      }
    }
  }
}

function assertCandidates(
  candidates: readonly SceneBoundaryCandidateV1[],
  chapters: ReadonlyMap<string, ChapterIndexV1['entries'][number]>,
  blocks: ReadonlyMap<string, CanonicalDocumentBlockV1>,
  blockIndex: DocumentBlockIndexV1,
): void {
  let previousEvidenceStart = -1;
  for (const candidate of candidates) {
    const chapter = chapters.get(candidate.chapterId);
    const block = blocks.get(candidate.blockId);
    if (chapter === undefined || block === undefined) {
      invalid(
        'scene_candidate_reference_invalid',
        'Scene boundary candidates must reference existing Chapters and blocks',
      );
    }
    if (
      !sameRange(candidate.evidenceRange, block.canonicalRange)
      || !sameLocator(candidate.sourceLocator, block.sourceLocator)
      || block.canonicalRange.startByte < chapter.contentRange.startByte
      || block.canonicalRange.endByte > chapter.contentRange.endByte
    ) {
      invalid(
        'scene_candidate_projection_invalid',
        'Scene boundary evidence must preserve its complete canonical block and source locator',
      );
    }
    if (candidate.evidenceRange.startByte < previousEvidenceStart) {
      invalid(
        'scene_candidates_not_in_source_order',
        'Scene boundary candidates must remain in canonical source order',
      );
    }
    previousEvidenceStart = candidate.evidenceRange.startByte;
    assertBoundaryInsideChapter(candidate.proposedBoundary, chapter.contentRange);
    assertCanonicalBlockBoundary(blockIndex, candidate.proposedBoundary.startByte);
    if (candidate.appliedBoundary !== undefined) {
      assertBoundaryInsideChapter(candidate.appliedBoundary, chapter.contentRange);
      assertCanonicalBlockBoundary(blockIndex, candidate.appliedBoundary.startByte);
    }
  }
}

function assertIssueReferences(
  sceneIndex: SceneIndexV1,
  chapters: ReadonlyMap<string, ChapterIndexV1['entries'][number]>,
  blocks: ReadonlyMap<string, CanonicalDocumentBlockV1>,
): void {
  for (const issue of sceneIndex.issues) {
    if (!chapters.has(issue.chapterId))
      invalid('scene_issue_chapter_invalid', 'Scene issue Chapter reference is invalid');
    if (issue.blockId !== undefined) {
      const block = blocks.get(issue.blockId);
      if (block === undefined)
        invalid('scene_issue_block_invalid', 'Scene issue block reference is invalid');
      if (
        issue.sourceLocator !== undefined
        && !sameLocator(issue.sourceLocator, block.sourceLocator)
      ) {
        invalid(
          'scene_issue_locator_invalid',
          'Scene issue source locator must preserve its referenced block locator',
        );
      }
      if (
        issue.textRange !== undefined
        && !rangeContains(block.canonicalRange, issue.textRange)
      ) {
        invalid(
          'scene_issue_range_invalid',
          'Scene issue text range must remain inside its referenced canonical block',
        );
      }
    }
  }
}

function assertBoundaryInsideChapter(
  boundary: TextRangeV1,
  contentRange: TextRangeV1,
): void {
  if (
    boundary.startByte <= contentRange.startByte
    || boundary.startByte >= contentRange.endByte
  ) {
    invalid(
      'scene_boundary_outside_chapter',
      'Scene boundaries must lie strictly inside a non-empty Chapter content range',
    );
  }
}

function assertCanonicalBlockBoundary(
  blockIndex: DocumentBlockIndexV1,
  offset: number,
): void {
  if (blockIndex.blocks.some(block =>
    offset === block.canonicalRange.startByte
    || offset === block.canonicalRange.endByte)) {
    return;
  }
  invalid(
    'scene_boundary_block_boundary_invalid',
    'Scene boundaries must use a canonical block boundary',
  );
}

function rangesOverlap(left: TextRangeV1, right: TextRangeV1): boolean {
  return left.startByte < right.endByte && right.startByte < left.endByte;
}

function rangeContains(container: TextRangeV1, contained: TextRangeV1): boolean {
  return container.textRevisionId === contained.textRevisionId
    && container.textLayer === contained.textLayer
    && container.offsetUnit === contained.offsetUnit
    && container.startByte <= contained.startByte
    && container.endByte >= contained.endByte;
}

function intersection(left: TextRangeV1, right: TextRangeV1): TextRangeV1 {
  return {
    ...left,
    startByte: Math.max(left.startByte, right.startByte),
    endByte: Math.min(left.endByte, right.endByte),
  };
}

function sameRevision(
  left: SceneIndexV1['textRevision'],
  right: SceneIndexV1['textRevision'],
): boolean {
  return left.textRevisionId === right.textRevisionId
    && left.textLayer === right.textLayer
    && left.contentHash === right.contentHash
    && left.byteLength === right.byteLength;
}

function sameRange(left: TextRangeV1, right: TextRangeV1): boolean {
  return left.textRevisionId === right.textRevisionId
    && left.textLayer === right.textLayer
    && left.offsetUnit === right.offsetUnit
    && left.startByte === right.startByte
    && left.endByte === right.endByte;
}

function sameLocator(left: TxtSourceLocatorV1, right: TxtSourceLocatorV1): boolean {
  return left.sourceAssetId === right.sourceAssetId
    && left.sourceContentHash === right.sourceContentHash
    && left.sourceEncoding === right.sourceEncoding
    && left.sourceByteRange.offsetUnit === right.sourceByteRange.offsetUnit
    && left.sourceByteRange.startByte === right.sourceByteRange.startByte
    && left.sourceByteRange.endByte === right.sourceByteRange.endByte
    && sameRange(left.rawTextRange, right.rawTextRange)
    && left.lineRange.lineBase === right.lineRange.lineBase
    && left.lineRange.startLine === right.lineRange.startLine
    && left.lineRange.endLineExclusive === right.lineRange.endLineExclusive;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

function invalid(detailReason: string, message: string): never {
  throw new SceneIndexDomainValidationError(detailReason, message);
}
