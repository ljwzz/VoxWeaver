/// <reference types="node" />

import type {
  TextLayerV1,
  TextRangeMapOperationV1,
  TextRangeMapSegmentV1,
  TextRangeMapV1,
  TextRevisionRefV1,
} from '@voxweaver/contracts';

import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import {
  parseTextRangeMapV1,
  parseTextRevisionRefV1,
  TEXT_RANGE_MAP_SCHEMA_VERSION,
  TEXT_RANGE_MAP_VERSION,
} from '@voxweaver/contracts';

const EMPTY_SHA256 = createHash('sha256').digest('hex');

export interface TextTransformStep {
  readonly operation: TextRangeMapOperationV1;
  readonly beforeText: string;
  readonly afterText: string;
  readonly ruleId: string;
  readonly ruleVersion: string;
}

export interface TextTransformRecorderOptions {
  readonly inputRevision: TextRevisionRefV1;
  readonly outputRevisionId: string;
  readonly outputLayer: TextLayerV1;
  readonly processorId: string;
  readonly processorVersion: string;
}

export interface TextTransformResult {
  readonly outputText: string;
  readonly outputRevision: TextRevisionRefV1;
  readonly rangeMap: TextRangeMapV1;
}

interface PendingSegment {
  readonly operation: TextRangeMapOperationV1;
  readonly ruleId: string;
  readonly ruleVersion: string;
  readonly inputStartByte: number;
  readonly outputStartByte: number;
  inputEndByte: number;
  outputEndByte: number;
  readonly beforeHash: ReturnType<typeof createHash>;
  readonly afterHash: ReturnType<typeof createHash>;
}

export class TextTransformValidationError extends Error {
  readonly code = 'NOVEL_IMPORT_STRUCTURE_INVALID';

  constructor(
    readonly detailReason: string,
    message: string,
  ) {
    super(message);
    this.name = 'TextTransformValidationError';
  }
}

export class TextTransformRecorder {
  readonly #inputRevision: TextRevisionRefV1;
  readonly #outputRevisionId: string;
  readonly #outputLayer: TextLayerV1;
  readonly #processorId: string;
  readonly #processorVersion: string;
  readonly #inputHash = createHash('sha256');
  readonly #outputHash = createHash('sha256');
  readonly #outputParts: string[] = [];
  readonly #segments: TextRangeMapSegmentV1[] = [];
  #inputByteLength = 0;
  #outputByteLength = 0;
  #pendingSegment: PendingSegment | undefined;
  #finished = false;

  constructor(options: TextTransformRecorderOptions) {
    this.#inputRevision = parseTextRevisionRefV1(options.inputRevision);
    this.#outputRevisionId = options.outputRevisionId;
    this.#outputLayer = options.outputLayer;
    this.#processorId = options.processorId;
    this.#processorVersion = options.processorVersion;

    parseTextRevisionRefV1({
      textRevisionId: this.#outputRevisionId,
      textLayer: this.#outputLayer,
      contentHash: EMPTY_SHA256,
      byteLength: 0,
    });
  }

  append(step: TextTransformStep): void {
    if (this.#finished) {
      throw new TextTransformValidationError(
        'transform_already_finished',
        'Text transform cannot append after finish',
      );
    }
    assertStep(step);

    const inputByteLength = Buffer.byteLength(step.beforeText, 'utf8');
    const outputByteLength = Buffer.byteLength(step.afterText, 'utf8');
    const inputEndByte = addSafeByteLength(
      this.#inputByteLength,
      inputByteLength,
      'input',
    );
    const outputEndByte = addSafeByteLength(
      this.#outputByteLength,
      outputByteLength,
      'output',
    );

    this.#inputHash.update(step.beforeText, 'utf8');
    this.#outputHash.update(step.afterText, 'utf8');
    if (step.afterText.length > 0)
      this.#outputParts.push(step.afterText);

    const pending = this.#pendingSegment;
    if (
      pending !== undefined
      && pending.operation === step.operation
      && pending.ruleId === step.ruleId
      && pending.ruleVersion === step.ruleVersion
    ) {
      pending.inputEndByte = inputEndByte;
      pending.outputEndByte = outputEndByte;
      pending.beforeHash.update(step.beforeText, 'utf8');
      pending.afterHash.update(step.afterText, 'utf8');
    } else {
      this.#flushPendingSegment();
      const beforeHash = createHash('sha256');
      const afterHash = createHash('sha256');
      beforeHash.update(step.beforeText, 'utf8');
      afterHash.update(step.afterText, 'utf8');
      this.#pendingSegment = {
        operation: step.operation,
        ruleId: step.ruleId,
        ruleVersion: step.ruleVersion,
        inputStartByte: this.#inputByteLength,
        outputStartByte: this.#outputByteLength,
        inputEndByte,
        outputEndByte,
        beforeHash,
        afterHash,
      };
    }

    this.#inputByteLength = inputEndByte;
    this.#outputByteLength = outputEndByte;
  }

  finish(): TextTransformResult {
    if (this.#finished) {
      throw new TextTransformValidationError(
        'transform_already_finished',
        'Text transform can only finish once',
      );
    }
    this.#finished = true;
    this.#flushPendingSegment();

    const actualInputHash = this.#inputHash.digest('hex');
    if (
      this.#inputByteLength !== this.#inputRevision.byteLength
      || actualInputHash !== this.#inputRevision.contentHash
    ) {
      throw new TextTransformValidationError(
        'input_revision_mismatch',
        'Raw text parts do not match the supplied text revision byteLength and contentHash',
      );
    }

    const outputRevision = parseTextRevisionRefV1({
      textRevisionId: this.#outputRevisionId,
      textLayer: this.#outputLayer,
      contentHash: this.#outputHash.digest('hex'),
      byteLength: this.#outputByteLength,
    });
    const rangeMap = parseTextRangeMapV1({
      documentType: 'text-range-map',
      schemaVersion: TEXT_RANGE_MAP_SCHEMA_VERSION,
      mapVersion: TEXT_RANGE_MAP_VERSION,
      processorId: this.#processorId,
      processorVersion: this.#processorVersion,
      inputRevision: this.#inputRevision,
      outputRevision,
      segments: this.#segments,
    });

    return {
      outputText: this.#outputParts.join(''),
      outputRevision,
      rangeMap,
    };
  }

  #flushPendingSegment(): void {
    const pending = this.#pendingSegment;
    if (pending === undefined)
      return;

    this.#segments.push({
      segmentIndex: this.#segments.length,
      operation: pending.operation,
      inputRange: {
        textRevisionId: this.#inputRevision.textRevisionId,
        textLayer: this.#inputRevision.textLayer,
        offsetUnit: 'utf8-byte',
        startByte: pending.inputStartByte,
        endByte: pending.inputEndByte,
      },
      outputRange: {
        textRevisionId: this.#outputRevisionId,
        textLayer: this.#outputLayer,
        offsetUnit: 'utf8-byte',
        startByte: pending.outputStartByte,
        endByte: pending.outputEndByte,
      },
      ruleId: pending.ruleId,
      ruleVersion: pending.ruleVersion,
      beforeContentHash: pending.beforeHash.digest('hex'),
      afterContentHash: pending.afterHash.digest('hex'),
    });
    this.#pendingSegment = undefined;
  }
}

function assertStep(step: TextTransformStep): void {
  if (step.ruleId.length === 0 || step.ruleVersion.length === 0) {
    throw new TextTransformValidationError(
      'transform_rule_invalid',
      'Text transform rule ID and version must be non-empty',
    );
  }

  const inputIsEmpty = Buffer.byteLength(step.beforeText, 'utf8') === 0;
  const outputIsEmpty = Buffer.byteLength(step.afterText, 'utf8') === 0;
  let valid: boolean;
  switch (step.operation) {
    case 'identity':
      valid = !inputIsEmpty
        && !outputIsEmpty
        && step.beforeText === step.afterText;
      break;
    case 'replace':
      valid = !inputIsEmpty && !outputIsEmpty;
      break;
    case 'delete':
      valid = !inputIsEmpty && outputIsEmpty;
      break;
    case 'insert':
      valid = inputIsEmpty && !outputIsEmpty;
      break;
  }

  if (!valid) {
    throw new TextTransformValidationError(
      'transform_step_invalid',
      `Text transform ${step.operation} step has invalid before/after bytes`,
    );
  }
}

function addSafeByteLength(
  current: number,
  increment: number,
  side: 'input' | 'output',
): number {
  const result = current + increment;
  if (!Number.isSafeInteger(result)) {
    throw new TextTransformValidationError(
      'text_byte_length_unsafe',
      `Text transform ${side} byteLength exceeds the safe integer range`,
    );
  }
  return result;
}
