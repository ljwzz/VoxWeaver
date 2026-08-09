import type { ValidateFunction } from 'ajv';

import Ajv2020Module from 'ajv/dist/2020.js';

const Ajv2020 = Ajv2020Module.default;

export const TEXT_RANGE_MAP_SCHEMA_VERSION = 1 as const;
export const TEXT_RANGE_MAP_VERSION = 'm1-text-range-map-v1' as const;
export const TEXT_RANGE_MAPPING_SCHEMA_VERSION = 1 as const;

export type TextLayerV1 = 'raw' | 'canonical' | 'normalized';

export interface TextRevisionRefV1 {
  readonly textRevisionId: string;
  readonly textLayer: TextLayerV1;
  readonly contentHash: string;
  readonly byteLength: number;
}

export interface TextRangeV1 {
  readonly textRevisionId: string;
  readonly textLayer: TextLayerV1;
  readonly offsetUnit: 'utf8-byte';
  readonly startByte: number;
  readonly endByte: number;
}

export type TextRangeMapOperationV1
  = | 'identity'
    | 'replace'
    | 'delete'
    | 'insert';

export interface TextRangeMapSegmentV1 {
  readonly segmentIndex: number;
  readonly operation: TextRangeMapOperationV1;
  readonly inputRange: TextRangeV1;
  readonly outputRange: TextRangeV1;
  readonly ruleId: string;
  readonly ruleVersion: string;
  readonly beforeContentHash: string;
  readonly afterContentHash: string;
}

export interface TextRangeMapV1Fields {
  readonly documentType: 'text-range-map';
  readonly schemaVersion: typeof TEXT_RANGE_MAP_SCHEMA_VERSION;
  readonly mapVersion: typeof TEXT_RANGE_MAP_VERSION;
  readonly processorId: string;
  readonly processorVersion: string;
  readonly inputRevision: TextRevisionRefV1;
  readonly outputRevision: TextRevisionRefV1;
  readonly segments: readonly TextRangeMapSegmentV1[];
}

export type TextRangeMapV1
  = TextRangeMapV1Fields & Record<string, unknown>;

export interface TextRangeValidationContextV1 {
  readonly revision: TextRevisionRefV1;
  readonly utf8Bytes?: Uint8Array;
}

export type TextRangeMapDirectionV1 = 'input-to-output' | 'output-to-input';
export type TextRangeCursorBiasV1 = 'before' | 'after';

export interface TextRangeMapRequestV1 {
  readonly schemaVersion: typeof TEXT_RANGE_MAPPING_SCHEMA_VERSION;
  readonly mapVersion: typeof TEXT_RANGE_MAP_VERSION;
  readonly direction: TextRangeMapDirectionV1;
  readonly range: TextRangeV1;
  readonly cursorBias?: TextRangeCursorBiasV1;
}

export interface TextRangeMappedFragmentV1 {
  readonly mappingKind: 'cursor' | 'identity' | 'replace';
  readonly segmentIndexes: readonly number[];
  readonly sourceRange: TextRangeV1;
  readonly targetRange: TextRangeV1;
}

export interface TextRangeUnmappableFragmentV1 {
  readonly operation: 'replace' | 'delete' | 'insert';
  readonly segmentIndex: number;
  readonly sourceRange: TextRangeV1;
  readonly targetRange: TextRangeV1;
  readonly reason: 'range_unmappable';
}

export interface TextRangeMapResultV1 {
  readonly schemaVersion: typeof TEXT_RANGE_MAPPING_SCHEMA_VERSION;
  readonly mapVersion: typeof TEXT_RANGE_MAP_VERSION;
  readonly direction: TextRangeMapDirectionV1;
  readonly requestedRange: TextRangeV1;
  readonly mappedFragments: readonly TextRangeMappedFragmentV1[];
  readonly unmappableFragments: readonly TextRangeUnmappableFragmentV1[];
}

const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
const UUID_V4_PATTERN
  = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$';
const SHA256_PATTERN = '^[0-9a-f]{64}$';
const NON_EMPTY_STRING = { type: 'string', minLength: 1 } as const;
const UUID_V4 = { type: 'string', pattern: UUID_V4_PATTERN } as const;
const SHA256 = { type: 'string', pattern: SHA256_PATTERN } as const;
const SAFE_BYTE_OFFSET = {
  type: 'integer',
  minimum: 0,
  maximum: MAX_SAFE_INTEGER,
} as const;

const TEXT_REVISION_REF_V1_SCHEMA = {
  type: 'object',
  required: ['textRevisionId', 'textLayer', 'contentHash', 'byteLength'],
  properties: {
    textRevisionId: UUID_V4,
    textLayer: {
      type: 'string',
      enum: ['raw', 'canonical', 'normalized'],
    },
    contentHash: SHA256,
    byteLength: SAFE_BYTE_OFFSET,
  },
  additionalProperties: false,
} as const;

const TEXT_RANGE_V1_SCHEMA = {
  type: 'object',
  required: [
    'textRevisionId',
    'textLayer',
    'offsetUnit',
    'startByte',
    'endByte',
  ],
  properties: {
    textRevisionId: UUID_V4,
    textLayer: {
      type: 'string',
      enum: ['raw', 'canonical', 'normalized'],
    },
    offsetUnit: { const: 'utf8-byte' },
    startByte: SAFE_BYTE_OFFSET,
    endByte: SAFE_BYTE_OFFSET,
  },
  additionalProperties: false,
} as const;

const TEXT_RANGE_MAP_SEGMENT_V1_SCHEMA = {
  type: 'object',
  required: [
    'segmentIndex',
    'operation',
    'inputRange',
    'outputRange',
    'ruleId',
    'ruleVersion',
    'beforeContentHash',
    'afterContentHash',
  ],
  properties: {
    segmentIndex: SAFE_BYTE_OFFSET,
    operation: {
      type: 'string',
      enum: ['identity', 'replace', 'delete', 'insert'],
    },
    inputRange: { $ref: '#/$defs/textRangeV1' },
    outputRange: { $ref: '#/$defs/textRangeV1' },
    ruleId: NON_EMPTY_STRING,
    ruleVersion: NON_EMPTY_STRING,
    beforeContentHash: SHA256,
    afterContentHash: SHA256,
  },
  additionalProperties: false,
} as const;

const TEXT_RANGE_MAP_REQUEST_V1_SCHEMA = {
  type: 'object',
  required: ['schemaVersion', 'mapVersion', 'direction', 'range'],
  properties: {
    schemaVersion: {
      type: 'integer',
      const: TEXT_RANGE_MAPPING_SCHEMA_VERSION,
    },
    mapVersion: { const: TEXT_RANGE_MAP_VERSION },
    direction: {
      type: 'string',
      enum: ['input-to-output', 'output-to-input'],
    },
    range: { $ref: '#/$defs/textRangeV1' },
    cursorBias: { type: 'string', enum: ['before', 'after'] },
  },
  additionalProperties: false,
} as const;

const TEXT_RANGE_MAPPED_FRAGMENT_V1_SCHEMA = {
  type: 'object',
  required: ['mappingKind', 'segmentIndexes', 'sourceRange', 'targetRange'],
  properties: {
    mappingKind: {
      type: 'string',
      enum: ['cursor', 'identity', 'replace'],
    },
    segmentIndexes: {
      type: 'array',
      items: SAFE_BYTE_OFFSET,
    },
    sourceRange: { $ref: '#/$defs/textRangeV1' },
    targetRange: { $ref: '#/$defs/textRangeV1' },
  },
  additionalProperties: false,
} as const;

const TEXT_RANGE_UNMAPPABLE_FRAGMENT_V1_SCHEMA = {
  type: 'object',
  required: [
    'operation',
    'segmentIndex',
    'sourceRange',
    'targetRange',
    'reason',
  ],
  properties: {
    operation: {
      type: 'string',
      enum: ['replace', 'delete', 'insert'],
    },
    segmentIndex: SAFE_BYTE_OFFSET,
    sourceRange: { $ref: '#/$defs/textRangeV1' },
    targetRange: { $ref: '#/$defs/textRangeV1' },
    reason: { const: 'range_unmappable' },
  },
  additionalProperties: false,
} as const;

const TEXT_RANGE_MAP_RESULT_V1_SCHEMA = {
  type: 'object',
  required: [
    'schemaVersion',
    'mapVersion',
    'direction',
    'requestedRange',
    'mappedFragments',
    'unmappableFragments',
  ],
  properties: {
    schemaVersion: {
      type: 'integer',
      const: TEXT_RANGE_MAPPING_SCHEMA_VERSION,
    },
    mapVersion: { const: TEXT_RANGE_MAP_VERSION },
    direction: {
      type: 'string',
      enum: ['input-to-output', 'output-to-input'],
    },
    requestedRange: { $ref: '#/$defs/textRangeV1' },
    mappedFragments: {
      type: 'array',
      items: { $ref: '#/$defs/textRangeMappedFragmentV1' },
    },
    unmappableFragments: {
      type: 'array',
      items: { $ref: '#/$defs/textRangeUnmappableFragmentV1' },
    },
  },
  additionalProperties: false,
} as const;

export const TEXT_REFERENCE_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://voxweaver.local/schemas/text-reference.schema.json',
  title: 'VoxWeaver M1 text range map',
  type: 'object',
  required: [
    'documentType',
    'schemaVersion',
    'mapVersion',
    'processorId',
    'processorVersion',
    'inputRevision',
    'outputRevision',
    'segments',
  ],
  properties: {
    documentType: { const: 'text-range-map' },
    schemaVersion: {
      type: 'integer',
      const: TEXT_RANGE_MAP_SCHEMA_VERSION,
    },
    mapVersion: { const: TEXT_RANGE_MAP_VERSION },
    processorId: NON_EMPTY_STRING,
    processorVersion: NON_EMPTY_STRING,
    inputRevision: { $ref: '#/$defs/textRevisionRefV1' },
    outputRevision: { $ref: '#/$defs/textRevisionRefV1' },
    segments: {
      type: 'array',
      items: { $ref: '#/$defs/textRangeMapSegmentV1' },
    },
  },
  additionalProperties: true,
  $defs: {
    textRevisionRefV1: TEXT_REVISION_REF_V1_SCHEMA,
    textRangeV1: TEXT_RANGE_V1_SCHEMA,
    textRangeMapSegmentV1: TEXT_RANGE_MAP_SEGMENT_V1_SCHEMA,
    textRangeMapRequestV1: TEXT_RANGE_MAP_REQUEST_V1_SCHEMA,
    textRangeMappedFragmentV1: TEXT_RANGE_MAPPED_FRAGMENT_V1_SCHEMA,
    textRangeUnmappableFragmentV1: TEXT_RANGE_UNMAPPABLE_FRAGMENT_V1_SCHEMA,
    textRangeMapResultV1: TEXT_RANGE_MAP_RESULT_V1_SCHEMA,
  },
} as const;

const validators = createTextReferenceValidators();

export class TextReferenceValidationError extends Error {
  readonly code = 'TEXT_REFERENCE_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'TextReferenceValidationError';
  }
}

export function parseTextRevisionRefV1(value: unknown): TextRevisionRefV1 {
  validateSchema(value, validators.textRevision, 'Text revision reference');
  return value as TextRevisionRefV1;
}

export function parseTextRangeV1(
  value: unknown,
  context?: TextRangeValidationContextV1,
): TextRangeV1 {
  validateSchema(value, validators.textRange, 'Text range');
  const range = value as TextRangeV1;
  assertRangeOrder(range, 'Text range');

  if (context !== undefined)
    assertRangeContext(range, context, 'Text range');

  return range;
}

export function parseTextRangeMapV1(value: unknown): TextRangeMapV1 {
  validateSchema(value, validators.rangeMap, 'Text range map');
  const rangeMap = value as TextRangeMapV1;
  assertRangeMapSemantics(rangeMap);
  return rangeMap;
}

export function parseTextRangeMapRequestV1(
  value: unknown,
): TextRangeMapRequestV1 {
  validateSchema(value, validators.mappingRequest, 'Text range map request');
  const request = value as TextRangeMapRequestV1;
  const range = parseTextRangeV1(request.range);
  const isCursor = range.startByte === range.endByte;

  if (isCursor && request.cursorBias === undefined)
    fail('Zero-length text range mapping requires an explicit cursorBias');
  if (!isCursor && request.cursorBias !== undefined) {
    fail(
      'Non-empty text range mapping fixes start=after and end=before; cursorBias is not allowed',
    );
  }
  return request;
}

export function parseTextRangeMapResultV1(
  value: unknown,
): TextRangeMapResultV1 {
  validateSchema(value, validators.mappingResult, 'Text range map result');
  const result = value as TextRangeMapResultV1;
  parseTextRangeV1(result.requestedRange);
  for (const fragment of result.mappedFragments) {
    parseTextRangeV1(fragment.sourceRange);
    parseTextRangeV1(fragment.targetRange);
  }
  for (const fragment of result.unmappableFragments) {
    parseTextRangeV1(fragment.sourceRange);
    parseTextRangeV1(fragment.targetRange);
  }
  return result;
}

export class TextRangeMappingReviewRequiredError extends Error {
  readonly code = 'NOVEL_IMPORT_REVIEW_REQUIRED';
  readonly reason = 'range_unmappable';

  constructor(readonly result: TextRangeMapResultV1) {
    super('Text range cannot be represented as one complete mapped fragment');
    this.name = 'TextRangeMappingReviewRequiredError';
  }
}

export function mapTextRangeV1(
  rangeMapValue: unknown,
  requestValue: unknown,
): TextRangeMapResultV1 {
  const rangeMap = parseTextRangeMapV1(rangeMapValue);
  const request = parseTextRangeMapRequestV1(requestValue);
  const sourceRevision = request.direction === 'input-to-output'
    ? rangeMap.inputRevision
    : rangeMap.outputRevision;
  const targetRevision = request.direction === 'input-to-output'
    ? rangeMap.outputRevision
    : rangeMap.inputRevision;
  const requestedRange = parseTextRangeV1(request.range, {
    revision: sourceRevision,
  });
  const fragments = requestedRange.startByte === requestedRange.endByte
    ? mapCursor(rangeMap, request, requestedRange, targetRevision)
    : mapNonEmptyRange(rangeMap, request, requestedRange);

  return parseTextRangeMapResultV1({
    schemaVersion: TEXT_RANGE_MAPPING_SCHEMA_VERSION,
    mapVersion: TEXT_RANGE_MAP_VERSION,
    direction: request.direction,
    requestedRange,
    ...fragments,
  });
}

export function mapTextRangeToSingleV1(
  rangeMapValue: unknown,
  requestValue: unknown,
): TextRangeV1 {
  const result = mapTextRangeV1(rangeMapValue, requestValue);
  const fragment = result.mappedFragments[0];
  if (
    fragment === undefined
    || result.mappedFragments.length !== 1
    || result.unmappableFragments.length !== 0
    || !sameRange(fragment.sourceRange, result.requestedRange)
  ) {
    throw new TextRangeMappingReviewRequiredError(result);
  }
  return fragment.targetRange;
}

function mapCursor(
  rangeMap: TextRangeMapV1,
  request: TextRangeMapRequestV1,
  requestedRange: TextRangeV1,
  targetRevision: TextRevisionRefV1,
): Pick<TextRangeMapResultV1, 'mappedFragments' | 'unmappableFragments'> {
  const cursorBias = request.cursorBias;
  if (cursorBias === undefined)
    fail('Zero-length text range mapping requires an explicit cursorBias');

  const anchorOperation = request.direction === 'input-to-output'
    ? 'insert'
    : 'delete';
  const anchorSegments = rangeMap.segments.filter((segment) => {
    const sourceRange = directionalSourceRange(segment, request.direction);
    return segment.operation === anchorOperation
      && sourceRange.startByte === requestedRange.startByte
      && sourceRange.endByte === requestedRange.endByte;
  });

  if (anchorSegments.length > 0) {
    const firstTarget = directionalTargetRange(anchorSegments[0], request.direction);
    const lastTarget = directionalTargetRange(
      anchorSegments[anchorSegments.length - 1],
      request.direction,
    );
    const targetByte = cursorBias === 'before'
      ? firstTarget.startByte
      : lastTarget.endByte;
    return {
      mappedFragments: [{
        mappingKind: 'cursor',
        segmentIndexes: anchorSegments.map(segment => segment.segmentIndex),
        sourceRange: requestedRange,
        targetRange: rangeAt(targetRevision, targetByte, targetByte),
      }],
      unmappableFragments: [],
    };
  }

  const candidate = selectCursorSegment(
    rangeMap.segments,
    request.direction,
    requestedRange.startByte,
    cursorBias,
  );
  if (candidate === undefined) {
    if (sourceRevisionLength(rangeMap, request.direction) !== 0)
      fail('Cursor does not fall on a mappable range-map boundary');
    return {
      mappedFragments: [{
        mappingKind: 'cursor',
        segmentIndexes: [],
        sourceRange: requestedRange,
        targetRange: rangeAt(targetRevision, 0, 0),
      }],
      unmappableFragments: [],
    };
  }

  const sourceRange = directionalSourceRange(candidate, request.direction);
  const targetRange = directionalTargetRange(candidate, request.direction);
  const cursor = requestedRange.startByte;
  const unavailable = isUnavailableOperation(candidate.operation, request.direction);
  const inside = cursor > sourceRange.startByte && cursor < sourceRange.endByte;
  if ((candidate.operation === 'replace' || unavailable) && inside) {
    return {
      mappedFragments: [],
      unmappableFragments: [{
        operation: candidate.operation as 'replace' | 'delete' | 'insert',
        segmentIndex: candidate.segmentIndex,
        sourceRange: requestedRange,
        targetRange,
        reason: 'range_unmappable',
      }],
    };
  }

  let targetByte: number;
  if (candidate.operation === 'identity') {
    targetByte = targetRange.startByte + cursor - sourceRange.startByte;
  } else if (cursor === sourceRange.startByte) {
    targetByte = targetRange.startByte;
  } else {
    targetByte = targetRange.endByte;
  }

  return {
    mappedFragments: [{
      mappingKind: 'cursor',
      segmentIndexes: [candidate.segmentIndex],
      sourceRange: requestedRange,
      targetRange: rangeLike(targetRange, targetByte, targetByte),
    }],
    unmappableFragments: [],
  };
}

function mapNonEmptyRange(
  rangeMap: TextRangeMapV1,
  request: TextRangeMapRequestV1,
  requestedRange: TextRangeV1,
): Pick<TextRangeMapResultV1, 'mappedFragments' | 'unmappableFragments'> {
  const mappedFragments: TextRangeMappedFragmentV1[] = [];
  const unmappableFragments: TextRangeUnmappableFragmentV1[] = [];
  let previousEventCanMerge = false;

  for (const segment of rangeMap.segments) {
    const sourceRange = directionalSourceRange(segment, request.direction);
    const targetRange = directionalTargetRange(segment, request.direction);
    if (sourceRange.startByte === sourceRange.endByte) {
      if (
        sourceRange.startByte > requestedRange.startByte
        && sourceRange.startByte < requestedRange.endByte
      ) {
        previousEventCanMerge = false;
      }
      continue;
    }

    const intersection = intersectRange(sourceRange, requestedRange);
    if (intersection === undefined)
      continue;

    if (segment.operation === 'identity') {
      const targetStart
        = targetRange.startByte + intersection.startByte - sourceRange.startByte;
      const mapped = {
        mappingKind: 'identity' as const,
        segmentIndexes: [segment.segmentIndex],
        sourceRange: intersection,
        targetRange: rangeLike(
          targetRange,
          targetStart,
          targetStart + rangeLength(intersection),
        ),
      };
      previousEventCanMerge = pushMappedFragment(
        mappedFragments,
        mapped,
        previousEventCanMerge,
      );
      continue;
    }

    if (segment.operation === 'replace') {
      const coversWholeSegment
        = requestedRange.startByte <= sourceRange.startByte
          && requestedRange.endByte >= sourceRange.endByte;
      if (coversWholeSegment) {
        mappedFragments.push({
          mappingKind: 'replace',
          segmentIndexes: [segment.segmentIndex],
          sourceRange,
          targetRange,
        });
      } else {
        unmappableFragments.push({
          operation: 'replace',
          segmentIndex: segment.segmentIndex,
          sourceRange: intersection,
          targetRange,
          reason: 'range_unmappable',
        });
      }
      previousEventCanMerge = false;
      continue;
    }

    if (isUnavailableOperation(segment.operation, request.direction)) {
      unmappableFragments.push({
        operation: segment.operation,
        segmentIndex: segment.segmentIndex,
        sourceRange: intersection,
        targetRange,
        reason: 'range_unmappable',
      });
      previousEventCanMerge = false;
    }
  }

  return { mappedFragments, unmappableFragments };
}

function pushMappedFragment(
  fragments: TextRangeMappedFragmentV1[],
  fragment: TextRangeMappedFragmentV1,
  mayMerge: boolean,
): boolean {
  const previous = fragments[fragments.length - 1];
  const previousLastIndex = previous === undefined
    ? undefined
    : previous.segmentIndexes[previous.segmentIndexes.length - 1];
  if (
    mayMerge
    && previous?.mappingKind === 'identity'
    && fragment.mappingKind === 'identity'
    && previousLastIndex !== undefined
    && previousLastIndex + 1 === fragment.segmentIndexes[0]
    && rangesAreContiguous(previous.sourceRange, fragment.sourceRange)
    && rangesAreContiguous(previous.targetRange, fragment.targetRange)
  ) {
    fragments[fragments.length - 1] = {
      mappingKind: 'identity',
      segmentIndexes: [...previous.segmentIndexes, ...fragment.segmentIndexes],
      sourceRange: {
        ...previous.sourceRange,
        endByte: fragment.sourceRange.endByte,
      },
      targetRange: {
        ...previous.targetRange,
        endByte: fragment.targetRange.endByte,
      },
    };
  } else {
    fragments.push(fragment);
  }
  return true;
}

function assertRangeMapSemantics(rangeMap: TextRangeMapV1): void {
  const inputRevision = parseTextRevisionRefV1(rangeMap.inputRevision);
  const outputRevision = parseTextRevisionRefV1(rangeMap.outputRevision);

  const isSupportedTransition
    = (inputRevision.textLayer === 'raw'
      && outputRevision.textLayer === 'canonical')
    || (inputRevision.textLayer === 'canonical'
      && outputRevision.textLayer === 'normalized');

  if (!isSupportedTransition) {
    fail(
      `Text range map transition ${inputRevision.textLayer} -> ${outputRevision.textLayer} is not supported`,
    );
  }

  if (inputRevision.textRevisionId === outputRevision.textRevisionId)
    fail('Text range map input and output revisions must be different');

  let inputCursor = 0;
  let outputCursor = 0;

  for (const [index, segment] of rangeMap.segments.entries()) {
    if (segment.segmentIndex !== index) {
      fail(
        `Text range map segmentIndex must be contiguous from zero; expected ${index}`,
      );
    }

    const inputRange = parseTextRangeV1(segment.inputRange, {
      revision: inputRevision,
    });
    const outputRange = parseTextRangeV1(segment.outputRange, {
      revision: outputRevision,
    });
    const inputIsEmpty = inputRange.startByte === inputRange.endByte;
    const outputIsEmpty = outputRange.startByte === outputRange.endByte;

    if (inputRange.startByte !== inputCursor) {
      fail(
        `Text range map input has a gap or overlap before segment ${index}`,
      );
    }

    if (outputRange.startByte !== outputCursor) {
      fail(
        `Text range map output has a gap or overlap before segment ${index}`,
      );
    }

    switch (segment.operation) {
      case 'identity':
        if (inputIsEmpty || outputIsEmpty)
          fail(`Identity segment ${index} must be non-empty on both sides`);
        if (rangeLength(inputRange) !== rangeLength(outputRange))
          fail(`Identity segment ${index} must preserve byte length`);
        if (segment.beforeContentHash !== segment.afterContentHash)
          fail(`Identity segment ${index} must preserve exact bytes`);
        break;
      case 'replace':
        if (inputIsEmpty || outputIsEmpty)
          fail(`Replace segment ${index} must be non-empty on both sides`);
        break;
      case 'delete':
        if (inputIsEmpty || !outputIsEmpty) {
          fail(
            `Delete segment ${index} requires a non-empty input and zero-length output anchor`,
          );
        }
        break;
      case 'insert':
        if (!inputIsEmpty || outputIsEmpty) {
          fail(
            `Insert segment ${index} requires a zero-length input anchor and non-empty output`,
          );
        }
        break;
    }

    inputCursor = inputRange.endByte;
    outputCursor = outputRange.endByte;
  }

  if (inputCursor !== inputRevision.byteLength) {
    fail(
      'Text range map non-empty input segments must cover the entire input revision',
    );
  }

  if (outputCursor !== outputRevision.byteLength) {
    fail(
      'Text range map non-empty output segments must cover the entire output revision',
    );
  }
}

function assertRangeContext(
  range: TextRangeV1,
  context: TextRangeValidationContextV1,
  dataName: string,
): void {
  const revision = parseTextRevisionRefV1(context.revision);

  if (
    range.textRevisionId !== revision.textRevisionId
    || range.textLayer !== revision.textLayer
  ) {
    fail(`${dataName} must reference the supplied immutable text revision`);
  }

  if (range.endByte > revision.byteLength)
    fail(`${dataName} exceeds the supplied text revision byteLength`);

  if (context.utf8Bytes === undefined)
    return;

  if (context.utf8Bytes.byteLength !== revision.byteLength) {
    fail(
      `${dataName} validation bytes do not match the text revision byteLength`,
    );
  }

  if (
    !isUtf8ScalarBoundary(context.utf8Bytes, range.startByte)
    || !isUtf8ScalarBoundary(context.utf8Bytes, range.endByte)
  ) {
    fail(`${dataName} endpoints must be UTF-8 scalar boundaries`);
  }
}

function assertRangeOrder(range: TextRangeV1, dataName: string): void {
  if (range.startByte > range.endByte)
    fail(`${dataName} startByte must not exceed endByte`);
}

function isUtf8ScalarBoundary(bytes: Uint8Array, offset: number): boolean {
  if (offset === 0 || offset === bytes.byteLength)
    return true;

  const byte = bytes[offset];
  return byte !== undefined && (byte & 0b1100_0000) !== 0b1000_0000;
}

function directionalSourceRange(
  segment: TextRangeMapSegmentV1,
  direction: TextRangeMapDirectionV1,
): TextRangeV1 {
  return direction === 'input-to-output'
    ? segment.inputRange
    : segment.outputRange;
}

function directionalTargetRange(
  segment: TextRangeMapSegmentV1,
  direction: TextRangeMapDirectionV1,
): TextRangeV1 {
  return direction === 'input-to-output'
    ? segment.outputRange
    : segment.inputRange;
}

function selectCursorSegment(
  segments: readonly TextRangeMapSegmentV1[],
  direction: TextRangeMapDirectionV1,
  cursor: number,
  bias: TextRangeCursorBiasV1,
): TextRangeMapSegmentV1 | undefined {
  const nonEmpty = segments.filter((segment) => {
    const range = directionalSourceRange(segment, direction);
    return range.startByte < range.endByte;
  });

  if (bias === 'before') {
    for (let index = nonEmpty.length - 1; index >= 0; index -= 1) {
      const segment = nonEmpty[index];
      const range = directionalSourceRange(segment, direction);
      if (range.startByte < cursor && cursor <= range.endByte)
        return segment;
    }
    return nonEmpty.find(
      segment => directionalSourceRange(segment, direction).startByte === cursor,
    );
  }

  const following = nonEmpty.find((segment) => {
    const range = directionalSourceRange(segment, direction);
    return range.startByte <= cursor && cursor < range.endByte;
  });
  if (following !== undefined)
    return following;
  for (let index = nonEmpty.length - 1; index >= 0; index -= 1) {
    const segment = nonEmpty[index];
    if (directionalSourceRange(segment, direction).endByte === cursor)
      return segment;
  }
  return undefined;
}

function sourceRevisionLength(
  rangeMap: TextRangeMapV1,
  direction: TextRangeMapDirectionV1,
): number {
  return direction === 'input-to-output'
    ? rangeMap.inputRevision.byteLength
    : rangeMap.outputRevision.byteLength;
}

function isUnavailableOperation(
  operation: TextRangeMapOperationV1,
  direction: TextRangeMapDirectionV1,
): operation is 'delete' | 'insert' {
  return direction === 'input-to-output'
    ? operation === 'delete'
    : operation === 'insert';
}

function rangeAt(
  revision: TextRevisionRefV1,
  startByte: number,
  endByte: number,
): TextRangeV1 {
  return {
    textRevisionId: revision.textRevisionId,
    textLayer: revision.textLayer,
    offsetUnit: 'utf8-byte',
    startByte,
    endByte,
  };
}

function rangeLike(
  range: TextRangeV1,
  startByte: number,
  endByte: number,
): TextRangeV1 {
  return { ...range, startByte, endByte };
}

function intersectRange(
  left: TextRangeV1,
  right: TextRangeV1,
): TextRangeV1 | undefined {
  const startByte = Math.max(left.startByte, right.startByte);
  const endByte = Math.min(left.endByte, right.endByte);
  return startByte < endByte ? rangeLike(left, startByte, endByte) : undefined;
}

function rangesAreContiguous(left: TextRangeV1, right: TextRangeV1): boolean {
  return left.textRevisionId === right.textRevisionId
    && left.textLayer === right.textLayer
    && left.endByte === right.startByte;
}

function sameRange(left: TextRangeV1, right: TextRangeV1): boolean {
  return left.textRevisionId === right.textRevisionId
    && left.textLayer === right.textLayer
    && left.offsetUnit === right.offsetUnit
    && left.startByte === right.startByte
    && left.endByte === right.endByte;
}

function rangeLength(range: TextRangeV1): number {
  return range.endByte - range.startByte;
}

function createTextReferenceValidators() {
  const ajv = new Ajv2020({ allErrors: true });
  ajv.addSchema(TEXT_REFERENCE_SCHEMA);

  return {
    ajv,
    rangeMap: getSchema(ajv, TEXT_REFERENCE_SCHEMA.$id),
    mappingRequest: getSchema(
      ajv,
      `${TEXT_REFERENCE_SCHEMA.$id}#/$defs/textRangeMapRequestV1`,
    ),
    mappingResult: getSchema(
      ajv,
      `${TEXT_REFERENCE_SCHEMA.$id}#/$defs/textRangeMapResultV1`,
    ),
    textRange: getSchema(
      ajv,
      `${TEXT_REFERENCE_SCHEMA.$id}#/$defs/textRangeV1`,
    ),
    textRevision: getSchema(
      ajv,
      `${TEXT_REFERENCE_SCHEMA.$id}#/$defs/textRevisionRefV1`,
    ),
  };
}

function getSchema(ajv: InstanceType<typeof Ajv2020>, reference: string) {
  const validate = ajv.getSchema(reference);
  if (validate === undefined)
    throw new Error(`Missing JSON Schema validator: ${reference}`);
  return validate;
}

function validateSchema(
  value: unknown,
  validate: ValidateFunction,
  dataVar: string,
): void {
  if (validate(value))
    return;

  fail(validators.ajv.errorsText(validate.errors, { dataVar }));
}

function fail(message: string): never {
  throw new TextReferenceValidationError(message);
}
