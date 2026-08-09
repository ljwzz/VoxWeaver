/// <reference types="node" />

import type {
  TextRangeMapV1,
  TextRangeV1,
  TextRevisionRefV1,
} from '@voxweaver/contracts';
import type { NormalizationProposalV1 } from './normalizationProposal.js';

import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import { parseTextRangeV1, parseTextRevisionRefV1 } from '@voxweaver/contracts';

import { validateNormalizationProposalsV1 } from './normalizationProposal.js';
import { TextTransformRecorder } from './textTransform.js';

const UUID_V4_PATTERN
  = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export const NORMALIZER_PROCESSOR_ID
  = 'voxweaver.text-pipeline.normalizer' as const;
export const NORMALIZER_PROCESSOR_VERSION = '1.0.0' as const;
export const NORMALIZER_IDENTITY_RULE_ID = 'normalized.identity' as const;

export type NormalizationModeV1 = 'dry-run' | 'apply';

export interface NormalizeTextInputV1 {
  readonly canonicalTextRevision: TextRevisionRefV1 & {
    readonly textLayer: 'canonical';
  };
  readonly canonicalText: string;
  readonly proposals: readonly NormalizationProposalV1[];
  readonly mode?: NormalizationModeV1;
  readonly selectedProposalIds?: readonly string[];
  readonly normalizedTextRevisionId?: string;
}

export interface NormalizationPreviewChangeV1 {
  readonly proposalId: string;
  readonly operation: 'delete' | 'replace';
  readonly canonicalRange: TextRangeV1 & { readonly textLayer: 'canonical' };
  readonly prospectiveNormalizedStartByte: number;
  readonly prospectiveNormalizedEndByte: number;
  readonly beforeText: string;
  readonly afterText: string;
  readonly ruleId: string;
  readonly ruleVersion: string;
  readonly reason: string;
  readonly risk: 'low' | 'medium' | 'high';
}

export interface NormalizationSkippedProposalV1 {
  readonly proposalId: string;
  readonly reason: 'rejected' | 'overlap';
  readonly conflictWithProposalIds: readonly string[];
}

export interface NormalizationAppliedChangeV1 {
  readonly proposalId: string;
  readonly operator: string;
  readonly operation: 'delete' | 'replace';
  readonly canonicalRange: TextRangeV1 & { readonly textLayer: 'canonical' };
  readonly normalizedRange: TextRangeV1 & { readonly textLayer: 'normalized' };
  readonly beforeText: string;
  readonly afterText: string;
  readonly ruleId: string;
  readonly ruleVersion: string;
  readonly reason: string;
}

export interface NormalizationDryRunResultV1 {
  readonly mode: 'dry-run';
  readonly applied: false;
  readonly canonicalTextRevision: TextRevisionRefV1 & {
    readonly textLayer: 'canonical';
  };
  readonly prospectiveNormalizedText: string;
  readonly previewChanges: readonly NormalizationPreviewChangeV1[];
  readonly skippedProposals: readonly NormalizationSkippedProposalV1[];
}

export interface NormalizationApplyResultV1 {
  readonly mode: 'apply';
  readonly applied: true;
  readonly canonicalTextRevision: TextRevisionRefV1 & {
    readonly textLayer: 'canonical';
  };
  readonly normalizedText: string;
  readonly normalizedTextRevision: TextRevisionRefV1 & {
    readonly textLayer: 'normalized';
  };
  readonly rangeMap: TextRangeMapV1;
  readonly changes: readonly NormalizationAppliedChangeV1[];
}

export type NormalizeTextResultV1
  = | NormalizationApplyResultV1
    | NormalizationDryRunResultV1;

export interface RestoreCanonicalTextInputV1 {
  readonly normalizedTextRevision: TextRevisionRefV1 & {
    readonly textLayer: 'normalized';
  };
  readonly normalizedText: string;
  readonly canonicalTextRevision: TextRevisionRefV1 & {
    readonly textLayer: 'canonical';
  };
  readonly changes: readonly NormalizationAppliedChangeV1[];
}

export class NormalizationExecutionError extends Error {
  readonly code = 'NOVEL_IMPORT_STRUCTURE_INVALID';

  constructor(
    readonly detailReason: string,
    message: string,
  ) {
    super(message);
    this.name = 'NormalizationExecutionError';
  }
}

export function normalizeTextV1(input: NormalizeTextInputV1): NormalizeTextResultV1 {
  const proposals = validateNormalizationProposalsV1({
    canonicalTextRevision: input?.canonicalTextRevision,
    canonicalText: input?.canonicalText,
    proposals: input?.proposals,
  });
  const revision = parseCanonicalRevision(input.canonicalTextRevision);
  const mode = input.mode ?? 'dry-run';
  if (mode !== 'dry-run' && mode !== 'apply')
    invalid('normalization_mode_invalid', 'Normalization mode must be dry-run or apply');
  const selected = selectProposals(proposals, input.selectedProposalIds, mode);

  if (mode === 'dry-run')
    return previewNormalization(revision, input.canonicalText, selected.proposals, selected.skipped);
  return applyNormalization(
    revision,
    input.canonicalText,
    selected.proposals,
    input.normalizedTextRevisionId,
  );
}

export function restoreCanonicalTextFromNormalizationV1(
  input: RestoreCanonicalTextInputV1,
): string {
  const normalizedRevision = parseLayerRevision(
    input?.normalizedTextRevision,
    'normalized',
    'normalized_revision_invalid',
  );
  const canonicalRevision = parseLayerRevision(
    input?.canonicalTextRevision,
    'canonical',
    'canonical_revision_invalid',
  );
  const normalizedBytes = exactRevisionBytes(
    input?.normalizedText,
    normalizedRevision,
    'normalized_revision_mismatch',
  );
  if (normalizedRevision.textRevisionId === canonicalRevision.textRevisionId)
    invalid('normalization_revision_id_reused', 'Canonical and normalized revision IDs must differ');
  if (!Array.isArray(input?.changes))
    invalid('normalization_changes_invalid', 'Normalization changes must be an array');
  const changes = [...input.changes];
  for (const change of changes) {
    validateAppliedChange(
      change,
      normalizedRevision,
      canonicalRevision,
      normalizedBytes,
    );
  }
  changes.sort(compareChanges);
  const proposalIds = new Set<string>();
  const restoredParts: Buffer[] = [];
  let normalizedCursor = 0;
  let canonicalCursor = 0;

  for (const change of changes) {
    if (proposalIds.has(change.proposalId))
      invalid('normalization_change_proposal_duplicate', 'Applied change proposal IDs must be unique');
    proposalIds.add(change.proposalId);
    if (
      change.normalizedRange.startByte < normalizedCursor
      || change.canonicalRange.startByte < canonicalCursor
    ) {
      invalid('normalization_change_overlap', 'Applied changes must be monotonic and non-overlapping');
    }
    const unchangedLength = change.normalizedRange.startByte - normalizedCursor;
    if (canonicalCursor + unchangedLength !== change.canonicalRange.startByte)
      invalid('normalization_change_cursor_invalid', 'Applied change byte cursors do not preserve identity gaps');
    restoredParts.push(normalizedBytes.subarray(
      normalizedCursor,
      change.normalizedRange.startByte,
    ));
    restoredParts.push(Buffer.from(change.beforeText, 'utf8'));
    normalizedCursor = change.normalizedRange.endByte;
    canonicalCursor = change.canonicalRange.endByte;
  }

  const tail = normalizedBytes.subarray(normalizedCursor);
  if (canonicalCursor + tail.byteLength !== canonicalRevision.byteLength)
    invalid('normalization_change_cursor_invalid', 'Applied change byte cursors do not cover the revisions');
  restoredParts.push(tail);
  const restoredBytes = Buffer.concat(restoredParts);
  if (
    restoredBytes.byteLength !== canonicalRevision.byteLength
    || sha256(restoredBytes) !== canonicalRevision.contentHash
  ) {
    invalid('normalization_restore_hash_mismatch', 'Reversed normalization does not restore the canonical revision');
  }
  return restoredBytes.toString('utf8');
}

function previewNormalization(
  revision: TextRevisionRefV1 & { textLayer: 'canonical' },
  canonicalText: string,
  proposals: readonly NormalizationProposalV1[],
  initialSkipped: readonly NormalizationSkippedProposalV1[],
): NormalizationDryRunResultV1 {
  const sorted = [...proposals].sort(compareProposals);
  const accepted: NormalizationProposalV1[] = [];
  const skipped = [...initialSkipped];
  for (const proposal of sorted) {
    const previous = accepted[accepted.length - 1];
    if (
      previous !== undefined
      && rangesOverlap(previous.canonicalRange, proposal.canonicalRange)
    ) {
      skipped.push({
        proposalId: proposal.proposalId,
        reason: 'overlap',
        conflictWithProposalIds: [previous.proposalId],
      });
      continue;
    }
    accepted.push(proposal);
  }

  const bytes = Buffer.from(canonicalText, 'utf8');
  const outputParts: Buffer[] = [];
  const previewChanges: NormalizationPreviewChangeV1[] = [];
  let inputCursor = 0;
  let outputCursor = 0;
  for (const proposal of accepted) {
    const identity = bytes.subarray(inputCursor, proposal.canonicalRange.startByte);
    outputParts.push(identity);
    outputCursor += identity.byteLength;
    const startByte = outputCursor;
    const after = Buffer.from(proposal.afterText, 'utf8');
    outputParts.push(after);
    outputCursor += after.byteLength;
    previewChanges.push({
      proposalId: proposal.proposalId,
      operation: proposal.operation,
      canonicalRange: proposal.canonicalRange,
      prospectiveNormalizedStartByte: startByte,
      prospectiveNormalizedEndByte: outputCursor,
      beforeText: proposal.beforeText,
      afterText: proposal.afterText,
      ruleId: proposal.ruleId,
      ruleVersion: proposal.ruleVersion,
      reason: proposal.reason,
      risk: proposal.risk,
    });
    inputCursor = proposal.canonicalRange.endByte;
  }
  outputParts.push(bytes.subarray(inputCursor));
  return {
    mode: 'dry-run',
    applied: false,
    canonicalTextRevision: revision,
    prospectiveNormalizedText: Buffer.concat(outputParts).toString('utf8'),
    previewChanges,
    skippedProposals: skipped,
  };
}

function applyNormalization(
  revision: TextRevisionRefV1 & { textLayer: 'canonical' },
  canonicalText: string,
  proposals: readonly NormalizationProposalV1[],
  normalizedTextRevisionId: string | undefined,
): NormalizationApplyResultV1 {
  if (typeof normalizedTextRevisionId !== 'string')
    invalid('normalized_revision_id_required', 'Apply mode requires normalizedTextRevisionId');
  if (!UUID_V4_PATTERN.test(normalizedTextRevisionId))
    invalid('normalized_revision_id_invalid', 'Normalized revision ID must be UUID v4');
  if (normalizedTextRevisionId === revision.textRevisionId)
    invalid('normalized_revision_id_reused', 'Normalized revision ID must differ from canonical revision ID');
  for (const proposal of proposals) {
    if (proposal.reviewStatus !== 'approved')
      invalid('normalization_proposal_not_approved', 'Apply mode only accepts approved proposals');
  }
  const sorted = [...proposals].sort(compareProposals);
  for (let index = 1; index < sorted.length; index += 1) {
    if (rangesOverlap(sorted[index - 1].canonicalRange, sorted[index].canonicalRange))
      invalid('normalization_proposal_overlap', 'Overlapping proposals cannot be applied');
  }

  const bytes = Buffer.from(canonicalText, 'utf8');
  const recorder = new TextTransformRecorder({
    inputRevision: revision,
    outputRevisionId: normalizedTextRevisionId,
    outputLayer: 'normalized',
    processorId: NORMALIZER_PROCESSOR_ID,
    processorVersion: NORMALIZER_PROCESSOR_VERSION,
  });
  const changes: NormalizationAppliedChangeV1[] = [];
  let inputCursor = 0;
  let outputCursor = 0;
  for (const proposal of sorted) {
    const identity = exactSlice(bytes, inputCursor, proposal.canonicalRange.startByte);
    if (identity.length > 0) {
      recorder.append({
        operation: 'identity',
        beforeText: identity,
        afterText: identity,
        ruleId: NORMALIZER_IDENTITY_RULE_ID,
        ruleVersion: NORMALIZER_PROCESSOR_VERSION,
      });
      outputCursor += Buffer.byteLength(identity, 'utf8');
    }
    const startByte = outputCursor;
    recorder.append({
      operation: proposal.operation,
      beforeText: proposal.beforeText,
      afterText: proposal.afterText,
      ruleId: proposal.ruleId,
      ruleVersion: proposal.ruleVersion,
    });
    outputCursor += Buffer.byteLength(proposal.afterText, 'utf8');
    changes.push({
      proposalId: proposal.proposalId,
      operator: proposal.operator as string,
      operation: proposal.operation,
      canonicalRange: proposal.canonicalRange,
      normalizedRange: {
        textRevisionId: normalizedTextRevisionId,
        textLayer: 'normalized',
        offsetUnit: 'utf8-byte',
        startByte,
        endByte: outputCursor,
      },
      beforeText: proposal.beforeText,
      afterText: proposal.afterText,
      ruleId: proposal.ruleId,
      ruleVersion: proposal.ruleVersion,
      reason: proposal.reason,
    });
    inputCursor = proposal.canonicalRange.endByte;
  }
  const tail = exactSlice(bytes, inputCursor, bytes.byteLength);
  if (tail.length > 0) {
    recorder.append({
      operation: 'identity',
      beforeText: tail,
      afterText: tail,
      ruleId: NORMALIZER_IDENTITY_RULE_ID,
      ruleVersion: NORMALIZER_PROCESSOR_VERSION,
    });
  }
  const result = recorder.finish();
  return {
    mode: 'apply',
    applied: true,
    canonicalTextRevision: revision,
    normalizedText: result.outputText,
    normalizedTextRevision: result.outputRevision as TextRevisionRefV1 & {
      textLayer: 'normalized';
    },
    rangeMap: result.rangeMap,
    changes,
  };
}

function selectProposals(
  proposals: readonly NormalizationProposalV1[],
  selectedIds: readonly string[] | undefined,
  mode: NormalizationModeV1,
): {
  proposals: readonly NormalizationProposalV1[];
  skipped: readonly NormalizationSkippedProposalV1[];
} {
  const byId = new Map(proposals.map(proposal => [proposal.proposalId, proposal]));
  let selected: NormalizationProposalV1[];
  if (selectedIds === undefined) {
    selected = mode === 'apply'
      ? proposals.filter(proposal => proposal.reviewStatus === 'approved')
      : [...proposals];
  } else {
    if (!Array.isArray(selectedIds))
      invalid('normalization_selection_invalid', 'Selected proposal IDs must be an array');
    const seen = new Set<string>();
    selected = selectedIds.map((id) => {
      if (typeof id !== 'string' || seen.has(id))
        invalid('normalization_selection_invalid', 'Selected proposal IDs must be unique strings');
      seen.add(id);
      const proposal = byId.get(id);
      if (proposal === undefined)
        invalid('normalization_selection_unknown', 'Selected proposal ID does not exist');
      if (mode === 'apply' && proposal.reviewStatus !== 'approved')
        invalid('normalization_proposal_not_approved', 'Explicit apply selection must contain only approved proposals');
      return proposal;
    });
  }
  const skipped: NormalizationSkippedProposalV1[] = [];
  if (mode === 'dry-run') {
    selected = selected.filter((proposal) => {
      if (proposal.reviewStatus !== 'rejected')
        return true;
      skipped.push({
        proposalId: proposal.proposalId,
        reason: 'rejected',
        conflictWithProposalIds: [],
      });
      return false;
    });
  }
  return { proposals: selected, skipped };
}

function validateAppliedChange(
  change: NormalizationAppliedChangeV1,
  normalizedRevision: TextRevisionRefV1,
  canonicalRevision: TextRevisionRefV1,
  normalizedBytes: Buffer,
): void {
  if (typeof change !== 'object' || change === null)
    invalid('normalization_change_invalid', 'Applied change must be an object');
  if (!UUID_V4_PATTERN.test(change.proposalId) || typeof change.operator !== 'string' || change.operator.trim().length === 0)
    invalid('normalization_change_invalid', 'Applied change requires proposalId and operator');
  if (
    typeof change.ruleId !== 'string'
    || change.ruleId.trim().length === 0
    || typeof change.ruleVersion !== 'string'
    || change.ruleVersion.trim().length === 0
    || typeof change.reason !== 'string'
    || change.reason.trim().length === 0
  ) {
    invalid('normalization_change_invalid', 'Applied change requires rule and reason metadata');
  }
  if (typeof change.beforeText !== 'string' || typeof change.afterText !== 'string')
    invalid('normalization_change_invalid', 'Applied change beforeText and afterText must be strings');
  if (
    Buffer.from(change.beforeText, 'utf8').toString('utf8') !== change.beforeText
    || Buffer.from(change.afterText, 'utf8').toString('utf8') !== change.afterText
  ) {
    invalid('normalization_change_invalid', 'Applied change text must contain only UTF-8 scalars');
  }
  try {
    parseTextRangeV1(change.canonicalRange, { revision: canonicalRevision });
    parseTextRangeV1(change.normalizedRange, {
      revision: normalizedRevision,
      utf8Bytes: normalizedBytes,
    });
  } catch (error) {
    invalid('normalization_change_range_invalid', `Applied change range is invalid: ${errorMessage(error)}`);
  }
  if (change.canonicalRange.startByte === change.canonicalRange.endByte)
    invalid('normalization_change_operation_invalid', 'Applied delete or replace must consume canonical text');
  if (Buffer.byteLength(change.beforeText, 'utf8') !== change.canonicalRange.endByte - change.canonicalRange.startByte)
    invalid('normalization_change_before_length_invalid', 'Applied change beforeText length must match canonical range');
  const actualAfter = exactSlice(
    normalizedBytes,
    change.normalizedRange.startByte,
    change.normalizedRange.endByte,
  );
  if (actualAfter !== change.afterText)
    invalid('normalization_change_after_text_mismatch', 'Applied change afterText must match normalized bytes');
  if (
    (change.operation === 'delete' && change.afterText !== '')
    || (change.operation === 'replace' && change.afterText.length === 0)
    || !['delete', 'replace'].includes(change.operation)
  ) {
    invalid('normalization_change_operation_invalid', 'Applied change operation is invalid');
  }
}

function parseCanonicalRevision(
  value: TextRevisionRefV1,
): TextRevisionRefV1 & { textLayer: 'canonical' } {
  return parseLayerRevision(value, 'canonical', 'canonical_revision_invalid');
}

function parseLayerRevision<Layer extends 'canonical' | 'normalized'>(
  value: TextRevisionRefV1,
  layer: Layer,
  reason: string,
): TextRevisionRefV1 & { textLayer: Layer } {
  let revision: TextRevisionRefV1;
  try {
    revision = parseTextRevisionRefV1(value);
  } catch (error) {
    invalid(reason, `Text revision is invalid: ${errorMessage(error)}`);
  }
  if (revision.textLayer !== layer)
    invalid(reason, `Text revision must use the ${layer} layer`);
  return revision as TextRevisionRefV1 & { textLayer: Layer };
}

function exactRevisionBytes(
  text: string,
  revision: TextRevisionRefV1,
  reason: string,
): Buffer {
  if (typeof text !== 'string')
    invalid(reason, 'Revision text must be a string');
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.toString('utf8') !== text)
    invalid(reason, 'Revision text must contain only UTF-8 scalars');
  if (bytes.byteLength !== revision.byteLength || sha256(bytes) !== revision.contentHash)
    invalid(reason, 'Text does not match its immutable revision');
  return bytes;
}

function exactSlice(bytes: Buffer, startByte: number, endByte: number): string {
  const slice = bytes.subarray(startByte, endByte);
  const text = slice.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(slice))
    invalid('normalization_utf8_cursor_invalid', 'Normalization byte cursor must be a UTF-8 scalar boundary');
  return text;
}

function compareProposals(left: NormalizationProposalV1, right: NormalizationProposalV1): number {
  return left.canonicalRange.startByte - right.canonicalRange.startByte
    || left.canonicalRange.endByte - right.canonicalRange.endByte
    || compareCodeUnits(left.proposalId, right.proposalId);
}

function compareChanges(left: NormalizationAppliedChangeV1, right: NormalizationAppliedChangeV1): number {
  return left.canonicalRange.startByte - right.canonicalRange.startByte
    || left.canonicalRange.endByte - right.canonicalRange.endByte
    || compareCodeUnits(left.proposalId, right.proposalId);
}

function rangesOverlap(left: TextRangeV1, right: TextRangeV1): boolean {
  return left.startByte < right.endByte && right.startByte < left.endByte;
}

function compareCodeUnits(left: string, right: string): number {
  if (left < right)
    return -1;
  if (left > right)
    return 1;
  return 0;
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

function invalid(detailReason: string, message: string): never {
  throw new NormalizationExecutionError(detailReason, message);
}
