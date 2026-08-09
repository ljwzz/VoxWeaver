import type {
  TextRangeMapV1,
  TextRevisionRefV1,
} from '@voxweaver/contracts';

import { parseTextRevisionRefV1 } from '@voxweaver/contracts';

import {
  TextTransformRecorder,
  TextTransformValidationError,
} from './textTransform.js';

export const CANONICALIZER_PROCESSOR_ID
  = 'voxweaver.text-pipeline.canonicalizer' as const;
export const CANONICALIZER_PROCESSOR_VERSION = '1.0.0' as const;
export const CANONICAL_RULE_VERSION = '1.0.0' as const;
export const CANONICAL_RULE_IDS = {
  identity: 'canonical.identity',
  leadingBom: 'canonical.leading-bom',
  lineEnding: 'canonical.line-ending',
  controlCharacter: 'canonical.control-character',
} as const;

const IDENTITY_BATCH_CODE_UNITS = 16 * 1024;

export interface CanonicalizeRawTextInputV1 {
  readonly rawTextRevision: TextRevisionRefV1 & { readonly textLayer: 'raw' };
  readonly rawTextParts: Iterable<string>;
  readonly canonicalTextRevisionId: string;
}

export interface CanonicalizeRawTextResultV1 {
  readonly canonicalText: string;
  readonly canonicalTextRevision: TextRevisionRefV1 & {
    readonly textLayer: 'canonical';
  };
  readonly rangeMap: TextRangeMapV1;
}

export function canonicalizeRawTextV1(
  input: CanonicalizeRawTextInputV1,
): CanonicalizeRawTextResultV1 {
  const rawTextRevision = parseTextRevisionRefV1(input.rawTextRevision);
  if (rawTextRevision.textLayer !== 'raw') {
    throw new TextTransformValidationError(
      'input_layer_invalid',
      'Canonicalization input revision must use the raw text layer',
    );
  }

  const recorder = new TextTransformRecorder({
    inputRevision: rawTextRevision,
    outputRevisionId: input.canonicalTextRevisionId,
    outputLayer: 'canonical',
    processorId: CANONICALIZER_PROCESSOR_ID,
    processorVersion: CANONICALIZER_PROCESSOR_VERSION,
  });
  let isFirstCharacter = true;
  let pendingCarriageReturn = false;
  let identityText = '';

  const flushIdentity = (): void => {
    if (identityText.length === 0)
      return;
    recorder.append({
      operation: 'identity',
      beforeText: identityText,
      afterText: identityText,
      ruleId: CANONICAL_RULE_IDS.identity,
      ruleVersion: CANONICAL_RULE_VERSION,
    });
    identityText = '';
  };

  const preserve = (character: string): void => {
    identityText += character;
    if (identityText.length >= IDENTITY_BATCH_CODE_UNITS)
      flushIdentity();
  };

  for (const character of iterateUnicodeScalars(input.rawTextParts)) {
    if (isFirstCharacter) {
      isFirstCharacter = false;
      if (character === '\uFEFF') {
        recorder.append({
          operation: 'delete',
          beforeText: character,
          afterText: '',
          ruleId: CANONICAL_RULE_IDS.leadingBom,
          ruleVersion: CANONICAL_RULE_VERSION,
        });
        continue;
      }
    }

    if (pendingCarriageReturn) {
      pendingCarriageReturn = false;
      if (character === '\n') {
        appendLineEnding(recorder, '\r\n');
        continue;
      }
      appendLineEnding(recorder, '\r');
    }

    if (character === '\r') {
      flushIdentity();
      pendingCarriageReturn = true;
      continue;
    }

    if (isForbiddenControlCharacter(character)) {
      flushIdentity();
      recorder.append({
        operation: 'delete',
        beforeText: character,
        afterText: '',
        ruleId: CANONICAL_RULE_IDS.controlCharacter,
        ruleVersion: CANONICAL_RULE_VERSION,
      });
      continue;
    }

    preserve(character);
  }

  if (pendingCarriageReturn)
    appendLineEnding(recorder, '\r');
  flushIdentity();

  const result = recorder.finish();
  return {
    canonicalText: result.outputText,
    canonicalTextRevision: result.outputRevision as TextRevisionRefV1 & {
      readonly textLayer: 'canonical';
    },
    rangeMap: result.rangeMap,
  };
}

function appendLineEnding(
  recorder: TextTransformRecorder,
  beforeText: '\r' | '\r\n',
): void {
  recorder.append({
    operation: 'replace',
    beforeText,
    afterText: '\n',
    ruleId: CANONICAL_RULE_IDS.lineEnding,
    ruleVersion: CANONICAL_RULE_VERSION,
  });
}

function isForbiddenControlCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0);
  return codePoint !== undefined
    && ((codePoint >= 0 && codePoint <= 0x1F
      && codePoint !== 0x09
      && codePoint !== 0x0A
      && codePoint !== 0x0D)
    || codePoint === 0x7F);
}

function* iterateUnicodeScalars(parts: Iterable<string>): Iterable<string> {
  let pendingHighSurrogate: string | undefined;

  for (const part of parts) {
    if (typeof part !== 'string') {
      throw new TextTransformValidationError(
        'input_part_invalid',
        'Canonicalization rawTextParts must contain only strings',
      );
    }

    let index = 0;
    if (pendingHighSurrogate !== undefined) {
      if (part.length > 0 && isLowSurrogate(part.charCodeAt(0))) {
        yield pendingHighSurrogate + part[0];
        index = 1;
      } else {
        yield pendingHighSurrogate;
      }
      pendingHighSurrogate = undefined;
    }

    while (index < part.length) {
      const codeUnit = part.charCodeAt(index);
      if (!isHighSurrogate(codeUnit)) {
        yield part[index];
        index += 1;
        continue;
      }

      if (index + 1 >= part.length) {
        pendingHighSurrogate = part[index];
        index += 1;
        continue;
      }

      if (isLowSurrogate(part.charCodeAt(index + 1))) {
        yield part.slice(index, index + 2);
        index += 2;
      } else {
        yield part[index];
        index += 1;
      }
    }
  }

  if (pendingHighSurrogate !== undefined)
    yield pendingHighSurrogate;
}

function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xD800 && codeUnit <= 0xDBFF;
}

function isLowSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xDC00 && codeUnit <= 0xDFFF;
}
