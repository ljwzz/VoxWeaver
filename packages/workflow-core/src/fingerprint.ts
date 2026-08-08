import type { ArtifactSelector, JsonValue } from '@voxweaver/contracts';
import { createHash } from 'node:crypto';

export interface InputFingerprintDescriptor {
  readonly compatibilityVersion: string;
  readonly dependencies: readonly {
    readonly artifactId: string;
    readonly contentHash: string;
    readonly revisionId: string;
    readonly selector?: ArtifactSelector;
  }[];
  readonly modelId?: string;
  readonly parameters: JsonValue;
  readonly processorId: string;
  readonly processorVersion: string;
  readonly ruleVersions?: Readonly<Record<string, string>>;
}

export function computeInputFingerprint(
  descriptor: InputFingerprintDescriptor,
): string {
  const dependencies = descriptor.dependencies
    .map(dependency => ({
      ...dependency,
      ...(dependency.selector
        ? { selector: normalizeSelector(dependency.selector) }
        : {}),
    }))
    .sort((left, right) => compareStrings(
      canonicalizeJson(left as unknown as JsonValue),
      canonicalizeJson(right as unknown as JsonValue),
    ));
  return sha256CanonicalJson({
    ...descriptor,
    dependencies,
  } as unknown as JsonValue);
}

export function sha256CanonicalJson(value: JsonValue): string {
  return createHash('sha256').update(canonicalizeJson(value)).digest('hex');
}

export function canonicalizeJson(value: JsonValue): string {
  const ancestors = new Set<object>();
  return canonicalizeValue(value, ancestors);
}

function canonicalizeValue(
  value: JsonValue,
  ancestors: Set<object>,
): string {
  if (value === null)
    return 'null';

  if (typeof value === 'boolean' || typeof value === 'string')
    return JSON.stringify(value);

  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new TypeError('Canonical JSON cannot contain non-finite numbers.');
    return Object.is(value, -0) ? '0' : JSON.stringify(value);
  }

  if (ancestors.has(value))
    throw new TypeError('Canonical JSON cannot contain cycles.');

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map(item => canonicalizeValue(item, ancestors)).join(',')}]`;
    }

    const entries = Object.entries(value).sort(([left], [right]) =>
      compareStrings(left, right),
    );
    return `{${entries.map(([key, item]) =>
      `${JSON.stringify(key)}:${canonicalizeValue(item, ancestors)}`).join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}

function normalizeSelector(selector: ArtifactSelector): ArtifactSelector {
  return Object.fromEntries(
    Object.entries(selector).map(([key, values]) => [
      key,
      values ? [...values].sort(compareStrings) : values,
    ]),
  );
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
