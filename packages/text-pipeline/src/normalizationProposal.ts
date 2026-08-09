/// <reference types="node" />

import type {
  ChapterIndexV1,
  ReviewStatus,
  TextRangeV1,
  TextRevisionRefV1,
} from '@voxweaver/contracts';

import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';

import {
  parseChapterIndexV1,
  parseTextRangeV1,
  parseTextRevisionRefV1,
} from '@voxweaver/contracts';
import { validateChapterIndexDomainV1 } from '@voxweaver/novel-domain';

const UUID_V4_PATTERN
  = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ADVERTISEMENT_LINE_PATTERNS = [
  /^===\s*广告\s*===$/u,
  /^【广告】[^\n]{0,120}$/u,
  /^\[ADVERTISEMENT\][^\n]{0,120}$/iu,
] as const;
const DIALOGUE_OR_PROSE_PATTERN = /^[“"「『‘'—-]|[。！？!?；;，,]$/u;

export const NORMALIZATION_PROPOSER_ID
  = 'voxweaver.text-pipeline.normalization-proposal' as const;
export const NORMALIZATION_RULE_VERSION = '1.0.0' as const;
export const NORMALIZATION_RULE_IDS = {
  advertisementLine: 'normalized.advertisement-line',
  excessBlankLines: 'normalized.excess-blank-lines',
  repeatedChapterHeading: 'normalized.repeated-chapter-heading',
  repeatedStructuralLine: 'normalized.repeated-structural-line',
} as const;

export type NormalizationProposalOperationV1 = 'delete' | 'replace';
export type NormalizationProposalRiskV1 = 'low' | 'medium' | 'high';

export interface NormalizationProposalV1 {
  readonly proposalId: string;
  readonly canonicalRange: TextRangeV1 & { readonly textLayer: 'canonical' };
  readonly operation: NormalizationProposalOperationV1;
  readonly beforeText: string;
  readonly afterText: string;
  readonly contextBefore: readonly string[];
  readonly contextAfter: readonly string[];
  readonly ruleId: string;
  readonly ruleVersion: string;
  readonly reason: string;
  readonly evidence: readonly string[];
  readonly confidence: number;
  readonly confidenceSource: string;
  readonly risk: NormalizationProposalRiskV1;
  readonly proposedBy: string;
  readonly operator?: string;
  readonly reviewStatus: ReviewStatus;
  readonly reviewedBy?: string;
  readonly conflictProposalIds: readonly string[];
}

export interface DiscoverNormalizationProposalOptionsV1 {
  readonly proposalIdFactory?: () => string;
  readonly proposedBy?: string;
  readonly maxPreservedBlankLines?: number;
  readonly repeatedLineMinimumOccurrences?: number;
  readonly repeatedLineMinimumGapLines?: number;
  readonly contextLineLimit?: number;
}

export interface DiscoverNormalizationProposalsInputV1 {
  readonly canonicalTextRevision: TextRevisionRefV1 & {
    readonly textLayer: 'canonical';
  };
  readonly canonicalText: string;
  readonly chapterIndex?: ChapterIndexV1;
  readonly options?: DiscoverNormalizationProposalOptionsV1;
}

export interface ValidateNormalizationProposalsInputV1 {
  readonly canonicalTextRevision: TextRevisionRefV1 & {
    readonly textLayer: 'canonical';
  };
  readonly canonicalText: string;
  readonly proposals: readonly NormalizationProposalV1[];
}

interface LineRecord {
  readonly index: number;
  readonly startByte: number;
  readonly contentEndByte: number;
  readonly endByte: number;
  readonly contentText: string;
}

interface ProposalSeed extends Omit<NormalizationProposalV1, 'canonicalRange' | 'conflictProposalIds' | 'proposalId'> {
  readonly startByte: number;
  readonly endByte: number;
}

interface ResolvedOptions {
  readonly proposalIdFactory: () => string;
  readonly proposedBy: string;
  readonly maxPreservedBlankLines: number;
  readonly repeatedLineMinimumOccurrences: number;
  readonly repeatedLineMinimumGapLines: number;
  readonly contextLineLimit: number;
}

export class NormalizationProposalValidationError extends Error {
  readonly code = 'NOVEL_IMPORT_STRUCTURE_INVALID';

  constructor(
    readonly detailReason: string,
    message: string,
  ) {
    super(message);
    this.name = 'NormalizationProposalValidationError';
  }
}

export function discoverNormalizationProposalsV1(
  input: DiscoverNormalizationProposalsInputV1,
): readonly NormalizationProposalV1[] {
  const { bytes, revision } = validateCanonicalText(
    input?.canonicalTextRevision,
    input?.canonicalText,
  );
  const options = resolveOptions(input.options);
  const lines = scanLines(bytes);
  const seeds: ProposalSeed[] = [];

  appendAdvertisementSeeds(lines, seeds, options);
  appendRepeatedLineSeeds(lines, seeds, options);
  appendRepeatedChapterHeadingSeeds(
    lines,
    seeds,
    options,
    validateChapterIndex(input.chapterIndex, revision),
  );
  appendBlankLineSeeds(lines, seeds, options);

  seeds.sort(compareSeeds);
  const usedIds = new Set<string>();
  const proposals = seeds.map((seed) => {
    const proposalId = nextProposalId(options.proposalIdFactory, usedIds);
    const { endByte, startByte, ...fields } = seed;
    return {
      proposalId,
      canonicalRange: canonicalRange(revision, startByte, endByte),
      ...fields,
      conflictProposalIds: [] as string[],
    } satisfies NormalizationProposalV1;
  });
  linkConflicts(proposals);
  return validateNormalizationProposalsV1({
    canonicalTextRevision: revision,
    canonicalText: input.canonicalText,
    proposals,
  });
}

export function validateNormalizationProposalsV1(
  input: ValidateNormalizationProposalsInputV1,
): readonly NormalizationProposalV1[] {
  const { bytes, revision } = validateCanonicalText(
    input?.canonicalTextRevision,
    input?.canonicalText,
  );
  if (!Array.isArray(input?.proposals))
    invalid('normalization_proposals_invalid', 'Normalization proposals must be an array');

  const proposals = [...input.proposals];
  const byId = new Map<string, NormalizationProposalV1>();
  for (const proposal of proposals) {
    validateProposal(proposal, revision, bytes);
    if (byId.has(proposal.proposalId))
      invalid('normalization_proposal_id_duplicate', 'Normalization proposal IDs must be unique');
    byId.set(proposal.proposalId, proposal);
  }
  for (const proposal of proposals)
    validateConflicts(proposal, byId);
  const sourceOrdered = [...proposals].sort(compareProposals);
  for (let left = 0; left < sourceOrdered.length; left += 1) {
    for (let right = left + 1; right < sourceOrdered.length; right += 1) {
      if (
        sourceOrdered[right].canonicalRange.startByte
        >= sourceOrdered[left].canonicalRange.endByte
      ) {
        break;
      }
      if (!proposalHasConflict(sourceOrdered[left], sourceOrdered[right].proposalId)) {
        invalid(
          'normalization_proposal_overlap_untracked',
          'Overlapping normalization proposals must record reciprocal conflicts',
        );
      }
    }
  }
  return proposals;
}

function appendAdvertisementSeeds(
  lines: readonly LineRecord[],
  seeds: ProposalSeed[],
  options: ResolvedOptions,
): void {
  for (const line of lines) {
    const anchorIndex = ADVERTISEMENT_LINE_PATTERNS.findIndex(pattern =>
      pattern.test(line.contentText));
    if (anchorIndex < 0)
      continue;
    seeds.push(lineSeed(line, lines, options, {
      operation: 'delete',
      afterText: '',
      ruleId: NORMALIZATION_RULE_IDS.advertisementLine,
      reason: 'An explicitly anchored full-line advertisement requires review',
      evidence: [`full-line-advertisement-anchor:${anchorIndex + 1}`],
      confidence: 0.98,
      confidenceSource: 'anchored-full-line-pattern-v1',
      risk: 'high',
    }));
  }
}

function appendRepeatedLineSeeds(
  lines: readonly LineRecord[],
  seeds: ProposalSeed[],
  options: ResolvedOptions,
): void {
  const groups = new Map<string, LineRecord[]>();
  for (const line of lines) {
    const text = line.contentText;
    const trimmed = text.trim();
    const byteLength = Buffer.byteLength(text, 'utf8');
    if (
      trimmed.length === 0
      || byteLength > 64
      || DIALOGUE_OR_PROSE_PATTERN.test(trimmed)
    ) {
      continue;
    }
    const group = groups.get(text) ?? [];
    group.push(line);
    groups.set(text, group);
  }

  for (const occurrences of groups.values()) {
    if (occurrences.length < options.repeatedLineMinimumOccurrences)
      continue;
    const gaps = occurrences.slice(1).map((line, index) =>
      line.index - occurrences[index].index - 1);
    if (gaps.some(gap => gap < options.repeatedLineMinimumGapLines))
      continue;
    const minimumGap = Math.min(...gaps);
    const maximumGap = Math.max(...gaps);
    if (maximumGap - minimumGap > 1)
      continue;
    const confidence = Math.min(0.97, 0.9 + (occurrences.length - 3) * 0.02);
    for (const line of occurrences) {
      seeds.push(lineSeed(line, lines, options, {
        operation: 'delete',
        afterText: '',
        ruleId: NORMALIZATION_RULE_IDS.repeatedStructuralLine,
        reason: 'A regularly spaced exact full-line repetition requires review',
        evidence: [
          `exact-occurrence-count:${occurrences.length}`,
          `line-gap-range:${minimumGap}-${maximumGap}`,
        ],
        confidence,
        confidenceSource: 'exact-repeat-count-and-spacing-v1',
        risk: 'high',
      }));
    }
  }
}

function appendRepeatedChapterHeadingSeeds(
  lines: readonly LineRecord[],
  seeds: ProposalSeed[],
  options: ResolvedOptions,
  chapterIndex: ChapterIndexV1 | undefined,
): void {
  if (chapterIndex === undefined)
    return;
  for (const entry of chapterIndex.entries) {
    let line: LineRecord | undefined;
    let lineIndex = firstLineEndingAfter(lines, entry.contentRange.startByte);
    while (lineIndex < lines.length) {
      const current = lines[lineIndex];
      if (current.startByte >= entry.contentRange.endByte)
        break;
      if (
        current.startByte >= entry.contentRange.startByte
        && current.endByte <= entry.contentRange.endByte
        && current.contentText.trim().length > 0
      ) {
        line = current;
        break;
      }
      lineIndex++;
    }
    if (line === undefined)
      continue;
    const title = line.contentText;
    if (title !== entry.rawHeading && title !== entry.title)
      continue;
    seeds.push(lineSeed(line, lines, options, {
      operation: 'delete',
      afterText: '',
      ruleId: NORMALIZATION_RULE_IDS.repeatedChapterHeading,
      reason: 'The first non-empty body line exactly repeats its indexed chapter heading',
      evidence: [
        `chapter-id:${entry.chapterId}`,
        title === entry.rawHeading ? 'exact-raw-heading' : 'exact-normalized-title',
        'first-non-empty-content-line',
      ],
      confidence: 0.97,
      confidenceSource: 'validated-chapter-index-content-start-v1',
      risk: 'high',
    }));
  }
}

function appendBlankLineSeeds(
  lines: readonly LineRecord[],
  seeds: ProposalSeed[],
  options: ResolvedOptions,
): void {
  let cursor = 0;
  while (cursor < lines.length) {
    if (!isBlankLine(lines[cursor])) {
      cursor += 1;
      continue;
    }
    const start = cursor;
    while (cursor < lines.length && isBlankLine(lines[cursor]))
      cursor += 1;
    const run = lines.slice(start, cursor);
    if (run.length <= options.maxPreservedBlankLines)
      continue;
    const first = run[0];
    const last = run[run.length - 1];
    if (first === undefined || last === undefined)
      continue;
    const beforeText = run.map(lineFullText).join('');
    const afterText = '\n'.repeat(options.maxPreservedBlankLines);
    if (beforeText === afterText)
      continue;
    seeds.push({
      startByte: first.startByte,
      endByte: last.endByte,
      operation: 'replace',
      beforeText,
      afterText,
      contextBefore: contextBefore(lines, start, options.contextLineLimit),
      contextAfter: contextAfter(lines, cursor - 1, options.contextLineLimit),
      ruleId: NORMALIZATION_RULE_IDS.excessBlankLines,
      ruleVersion: NORMALIZATION_RULE_VERSION,
      reason: 'A consecutive blank-line run exceeds the deterministic preservation limit',
      evidence: [
        `blank-line-count:${run.length}`,
        `preserved-blank-line-limit:${options.maxPreservedBlankLines}`,
      ],
      confidence: 0.99,
      confidenceSource: 'blank-line-count-policy-v1',
      risk: 'low',
      proposedBy: options.proposedBy,
      reviewStatus: 'pending',
    });
  }
}

function lineSeed(
  line: LineRecord,
  lines: readonly LineRecord[],
  options: ResolvedOptions,
  fields: Pick<ProposalSeed, 'afterText' | 'confidence' | 'confidenceSource' | 'evidence'
  | 'operation' | 'reason' | 'risk' | 'ruleId'>,
): ProposalSeed {
  return {
    startByte: line.startByte,
    endByte: line.endByte,
    beforeText: lineFullText(line),
    contextBefore: contextBefore(lines, line.index, options.contextLineLimit),
    contextAfter: contextAfter(lines, line.index, options.contextLineLimit),
    ruleVersion: NORMALIZATION_RULE_VERSION,
    proposedBy: options.proposedBy,
    reviewStatus: 'pending',
    ...fields,
  };
}

function validateProposal(
  proposal: NormalizationProposalV1,
  revision: TextRevisionRefV1,
  bytes: Buffer,
): void {
  if (typeof proposal !== 'object' || proposal === null)
    invalid('normalization_proposal_invalid', 'Normalization proposal must be an object');
  if (!UUID_V4_PATTERN.test(proposal.proposalId))
    invalid('normalization_proposal_id_invalid', 'Normalization proposal ID must be UUID v4');
  try {
    parseTextRangeV1(proposal.canonicalRange, { revision, utf8Bytes: bytes });
  } catch (error) {
    invalid('normalization_proposal_range_invalid', `Normalization proposal range is invalid: ${errorMessage(error)}`);
  }
  if (proposal.canonicalRange.startByte === proposal.canonicalRange.endByte)
    invalid('normalization_proposal_range_empty', 'Normalization proposal range must be non-empty');
  if (typeof proposal.beforeText !== 'string' || typeof proposal.afterText !== 'string') {
    invalid(
      'normalization_proposal_text_invalid',
      'Normalization proposal beforeText and afterText must be strings',
    );
  }
  const exact = bytes.subarray(
    proposal.canonicalRange.startByte,
    proposal.canonicalRange.endByte,
  ).toString('utf8');
  if (exact !== proposal.beforeText)
    invalid('normalization_proposal_before_text_mismatch', 'Proposal beforeText must match canonical bytes exactly');
  if (proposal.beforeText === proposal.afterText)
    invalid('normalization_proposal_noop', 'Normalization proposal must change text');
  if (Buffer.from(proposal.afterText, 'utf8').toString('utf8') !== proposal.afterText)
    invalid('normalization_proposal_after_text_utf8_invalid', 'Proposal afterText must contain only UTF-8 scalars');
  if (proposal.operation === 'delete') {
    if (proposal.afterText !== '')
      invalid('normalization_proposal_operation_invalid', 'Delete proposal afterText must be empty');
  } else if (proposal.operation === 'replace') {
    if (proposal.afterText.length === 0)
      invalid('normalization_proposal_operation_invalid', 'Replace proposal afterText must be non-empty');
  } else {
    invalid('normalization_proposal_operation_invalid', 'Normalization proposal operation is invalid');
  }
  assertNonEmpty(proposal.ruleId, 'ruleId');
  assertNonEmpty(proposal.ruleVersion, 'ruleVersion');
  assertNonEmpty(proposal.reason, 'reason');
  assertNonEmpty(proposal.confidenceSource, 'confidenceSource');
  assertNonEmpty(proposal.proposedBy, 'proposedBy');
  assertStringArray(proposal.evidence, 'evidence', true);
  assertStringArray(proposal.contextBefore, 'contextBefore', false);
  assertStringArray(proposal.contextAfter, 'contextAfter', false);
  assertStringArray(proposal.conflictProposalIds, 'conflictProposalIds', true);
  if (!Number.isFinite(proposal.confidence) || proposal.confidence < 0 || proposal.confidence > 1)
    invalid('normalization_proposal_confidence_invalid', 'Proposal confidence must be finite and within 0..1');
  if (!['low', 'medium', 'high'].includes(proposal.risk))
    invalid('normalization_proposal_risk_invalid', 'Proposal risk is invalid');
  if (!['not_required', 'pending', 'approved', 'rejected'].includes(proposal.reviewStatus))
    invalid('normalization_proposal_review_status_invalid', 'Proposal reviewStatus is invalid');
  validateReviewFields(proposal);
}

function validateReviewFields(proposal: NormalizationProposalV1): void {
  const hasReviewer = isNonEmpty(proposal.reviewedBy);
  const hasOperator = isNonEmpty(proposal.operator);
  if (proposal.reviewStatus === 'approved') {
    if (!hasReviewer || !hasOperator)
      invalid('normalization_proposal_approval_invalid', 'Approved proposal requires reviewedBy and operator');
    return;
  }
  if (proposal.reviewStatus === 'rejected') {
    if (!hasReviewer || proposal.operator !== undefined)
      invalid('normalization_proposal_rejection_invalid', 'Rejected proposal requires reviewedBy and no operator');
    return;
  }
  if (proposal.reviewedBy !== undefined || proposal.operator !== undefined)
    invalid('normalization_proposal_review_fields_invalid', 'Unreviewed proposal cannot record reviewer or operator');
}

function validateConflicts(
  proposal: NormalizationProposalV1,
  byId: ReadonlyMap<string, NormalizationProposalV1>,
): void {
  const seen = new Set<string>();
  for (const conflictId of proposal.conflictProposalIds) {
    if (conflictId === proposal.proposalId || seen.has(conflictId))
      invalid('normalization_proposal_conflict_id_invalid', 'Proposal conflict IDs must be unique and cannot reference self');
    seen.add(conflictId);
    const other = byId.get(conflictId);
    if (other === undefined)
      invalid('normalization_proposal_conflict_missing', 'Proposal conflict reference must exist');
    if (!proposalHasConflict(other, proposal.proposalId))
      invalid('normalization_proposal_conflict_asymmetric', 'Proposal conflicts must be reciprocal');
    if (!rangesOverlap(proposal.canonicalRange, other.canonicalRange))
      invalid('normalization_proposal_conflict_range_invalid', 'Proposal conflict references must overlap');
    if (proposal.reviewStatus === 'not_required' || other.reviewStatus === 'not_required') {
      invalid(
        'normalization_proposal_conflict_review_invalid',
        'Conflicting proposals cannot bypass explicit review',
      );
    }
    const proposalApproved = proposal.reviewStatus === 'approved';
    const otherApproved = other.reviewStatus === 'approved';
    if (
      (proposalApproved && other.reviewStatus !== 'rejected')
      || (otherApproved && proposal.reviewStatus !== 'rejected')
    ) {
      invalid(
        'normalization_proposal_conflict_review_invalid',
        'An approved conflicting proposal requires every counterpart to be rejected',
      );
    }
  }
}

function validateCanonicalText(
  value: TextRevisionRefV1,
  text: string,
): { bytes: Buffer; revision: TextRevisionRefV1 & { textLayer: 'canonical' } } {
  let revision: TextRevisionRefV1;
  try {
    revision = parseTextRevisionRefV1(value);
  } catch (error) {
    invalid('canonical_revision_invalid', `Canonical revision is invalid: ${errorMessage(error)}`);
  }
  if (revision.textLayer !== 'canonical')
    invalid('canonical_revision_layer_invalid', 'Normalization input must use the canonical text layer');
  if (typeof text !== 'string')
    invalid('canonical_text_invalid', 'Canonical text must be a string');
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.toString('utf8') !== text)
    invalid('canonical_text_utf8_invalid', 'Canonical text must contain only UTF-8 scalars');
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (bytes.byteLength !== revision.byteLength || hash !== revision.contentHash)
    invalid('canonical_revision_mismatch', 'Canonical text does not match its immutable revision');
  return {
    bytes,
    revision: revision as TextRevisionRefV1 & { textLayer: 'canonical' },
  };
}

function validateChapterIndex(
  value: ChapterIndexV1 | undefined,
  revision: TextRevisionRefV1,
): ChapterIndexV1 | undefined {
  if (value === undefined)
    return undefined;
  let chapterIndex: ChapterIndexV1;
  try {
    chapterIndex = parseChapterIndexV1(value);
    validateChapterIndexDomainV1(chapterIndex);
  } catch (error) {
    invalid('normalization_chapter_index_invalid', `ChapterIndex is invalid: ${errorMessage(error)}`);
  }
  if (
    chapterIndex.textRevision.textRevisionId !== revision.textRevisionId
    || chapterIndex.textRevision.contentHash !== revision.contentHash
    || chapterIndex.textRevision.byteLength !== revision.byteLength
  ) {
    invalid('normalization_chapter_index_revision_mismatch', 'ChapterIndex must reference the exact canonical revision');
  }
  return chapterIndex;
}

function resolveOptions(
  value: DiscoverNormalizationProposalOptionsV1 | undefined,
): ResolvedOptions {
  const options = value ?? {};
  if (typeof options !== 'object' || options === null || Array.isArray(options))
    invalid('normalization_options_invalid', 'Normalization proposal options must be an object');
  const proposalIdFactory = options.proposalIdFactory ?? randomUUID;
  if (typeof proposalIdFactory !== 'function')
    invalid('normalization_proposal_id_factory_invalid', 'Proposal ID factory must be a function');
  const proposedBy = options.proposedBy ?? NORMALIZATION_PROPOSER_ID;
  assertNonEmpty(proposedBy, 'proposedBy');
  return {
    proposalIdFactory,
    proposedBy,
    maxPreservedBlankLines: positiveInteger(options.maxPreservedBlankLines, 2, 'maxPreservedBlankLines'),
    repeatedLineMinimumOccurrences: minimumInteger(options.repeatedLineMinimumOccurrences, 3, 3, 'repeatedLineMinimumOccurrences'),
    repeatedLineMinimumGapLines: minimumInteger(options.repeatedLineMinimumGapLines, 3, 1, 'repeatedLineMinimumGapLines'),
    contextLineLimit: minimumInteger(options.contextLineLimit, 2, 0, 'contextLineLimit'),
  };
}

function scanLines(bytes: Buffer): readonly LineRecord[] {
  const lines: LineRecord[] = [];
  let startByte = 0;
  while (startByte < bytes.byteLength) {
    const newline = bytes.indexOf(0x0A, startByte);
    const contentEndByte = newline < 0 ? bytes.byteLength : newline;
    const endByte = newline < 0 ? bytes.byteLength : newline + 1;
    lines.push({
      index: lines.length,
      startByte,
      contentEndByte,
      endByte,
      contentText: bytes.subarray(startByte, contentEndByte).toString('utf8'),
    });
    startByte = endByte;
  }
  return lines;
}

function linkConflicts(proposals: readonly NormalizationProposalV1[]): void {
  for (let left = 0; left < proposals.length; left += 1) {
    for (let right = left + 1; right < proposals.length; right += 1) {
      if (proposals[right].canonicalRange.startByte >= proposals[left].canonicalRange.endByte)
        break;
      (proposals[left].conflictProposalIds as string[]).push(proposals[right].proposalId);
      (proposals[right].conflictProposalIds as string[]).push(proposals[left].proposalId);
    }
  }
}

function canonicalRange(
  revision: TextRevisionRefV1,
  startByte: number,
  endByte: number,
): TextRangeV1 & { textLayer: 'canonical' } {
  return {
    textRevisionId: revision.textRevisionId,
    textLayer: 'canonical',
    offsetUnit: 'utf8-byte',
    startByte,
    endByte,
  };
}

function nextProposalId(factory: () => string, used: Set<string>): string {
  let id: unknown;
  try {
    id = factory();
  } catch (error) {
    invalid('normalization_proposal_id_factory_failed', `Proposal ID factory failed: ${errorMessage(error)}`);
  }
  if (typeof id !== 'string' || !UUID_V4_PATTERN.test(id))
    invalid('normalization_proposal_id_invalid', 'Proposal ID factory must return UUID v4');
  if (used.has(id))
    invalid('normalization_proposal_id_duplicate', 'Proposal ID factory returned a duplicate ID');
  used.add(id);
  return id;
}

function contextBefore(
  lines: readonly LineRecord[],
  index: number,
  limit: number,
): readonly string[] {
  return lines.slice(Math.max(0, index - limit), index).map(line => line.contentText);
}

function contextAfter(
  lines: readonly LineRecord[],
  index: number,
  limit: number,
): readonly string[] {
  return lines.slice(index + 1, index + 1 + limit).map(line => line.contentText);
}

function isBlankLine(line: LineRecord | undefined): boolean {
  return line !== undefined && /^[\t \u00A0\u3000]*$/u.test(line.contentText);
}

function lineFullText(line: LineRecord): string {
  return line.contentText + (line.endByte > line.contentEndByte ? '\n' : '');
}

function firstLineEndingAfter(
  lines: readonly LineRecord[],
  cursor: number,
): number {
  let low = 0;
  let high = lines.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (lines[middle].endByte > cursor)
      high = middle;
    else
      low = middle + 1;
  }
  return low;
}

function compareSeeds(left: ProposalSeed, right: ProposalSeed): number {
  return left.startByte - right.startByte
    || left.endByte - right.endByte
    || compareCodeUnits(left.ruleId, right.ruleId);
}

function compareProposals(
  left: NormalizationProposalV1,
  right: NormalizationProposalV1,
): number {
  return left.canonicalRange.startByte - right.canonicalRange.startByte
    || left.canonicalRange.endByte - right.canonicalRange.endByte
    || compareCodeUnits(left.proposalId, right.proposalId);
}

function rangesOverlap(left: TextRangeV1, right: TextRangeV1): boolean {
  return left.startByte < right.endByte && right.startByte < left.endByte;
}

function proposalHasConflict(
  proposal: NormalizationProposalV1,
  proposalId: string,
): boolean {
  return proposal.conflictProposalIds.includes(proposalId);
}

function assertStringArray(value: readonly string[], name: string, nonEmpty: boolean): void {
  if (
    !Array.isArray(value)
    || (nonEmpty && value.length === 0 && name === 'evidence')
    || value.some(item => typeof item !== 'string' || (nonEmpty && item.trim().length === 0))
  ) {
    invalid('normalization_proposal_field_invalid', `Proposal ${name} must contain non-empty strings`);
  }
}

function assertNonEmpty(value: unknown, name: string): asserts value is string {
  if (!isNonEmpty(value))
    invalid('normalization_proposal_field_invalid', `Normalization ${name} must be a non-empty string`);
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  return minimumInteger(value, fallback, 1, name);
}

function minimumInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  name: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < minimum)
    invalid('normalization_options_invalid', `${name} must be a safe integer >= ${minimum}`);
  return resolved;
}

function compareCodeUnits(left: string, right: string): number {
  if (left < right)
    return -1;
  if (left > right)
    return 1;
  return 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

function invalid(detailReason: string, message: string): never {
  throw new NormalizationProposalValidationError(detailReason, message);
}
