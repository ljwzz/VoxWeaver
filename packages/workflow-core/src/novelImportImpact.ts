import type { ArtifactSelector } from '@voxweaver/contracts';

import { selectorsIntersect } from './selector.js';

const NOVEL_IMPORT_CHANGE_SCOPES = [
  'content',
  'structure',
  'display',
] as const;

export type NovelImportChangeScopeV1
  = typeof NOVEL_IMPORT_CHANGE_SCOPES[number];

/**
 * Read-only projection of one M1-16A change bucket. This is planning input,
 * not a persisted workflow record.
 */
export interface NovelReimportAffectedIdsPlanInputV1 {
  readonly currentBlockIds: readonly string[];
  readonly currentChapterIds: readonly string[];
}

/**
 * Minimal structural projection accepted directly from NovelReimportPlanV1.
 * workflow-core intentionally does not depend on novel-domain.
 */
export interface NovelReimportImpactPlanInputV1 {
  readonly changes: Readonly<Record<
    NovelImportChangeScopeV1,
    NovelReimportAffectedIdsPlanInputV1
  >>;
}

export interface NovelImportImpactSelectorV1 {
  readonly changeScope: NovelImportChangeScopeV1;
  readonly selector: ArtifactSelector;
}

/**
 * One planning-only dependency declaration. Repeating a scope supplies
 * alternative selectors (OR); each selector retains selectorsIntersect's
 * shared-dimension AND semantics.
 */
export interface NovelImportImpactSubscriptionPlanInputV1 {
  readonly changeScope: NovelImportChangeScopeV1;
  readonly selector?: ArtifactSelector;
}

/**
 * Planning input for one consumer. changeScope is deliberately explicit so a
 * display-only title change never implies a content dependency.
 */
export interface NovelImportImpactConsumerPlanInputV1 {
  readonly consumerArtifactId: string;
  readonly consumerRevisionId: string;
  readonly subscriptions: readonly NovelImportImpactSubscriptionPlanInputV1[];
}

export interface NovelImportAffectedConsumerV1 {
  readonly consumerArtifactId: string;
  readonly consumerRevisionId: string;
  readonly matchedChangeScopes: readonly NovelImportChangeScopeV1[];
}

/**
 * Converts M1-16A change buckets to valid ArtifactSelectors for the current
 * text revision. Empty buckets are omitted rather than emitted as `{}`.
 */
export function buildNovelImportImpactSelectorsV1(
  input: NovelReimportImpactPlanInputV1,
): readonly NovelImportImpactSelectorV1[] {
  const planned: NovelImportImpactSelectorV1[] = [];

  for (const changeScope of NOVEL_IMPORT_CHANGE_SCOPES) {
    const selector = affectedIdsToSelector(input.changes[changeScope]);
    if (selector === undefined)
      continue;
    planned.push(Object.freeze({ changeScope, selector }));
  }

  return Object.freeze(planned);
}

/**
 * Selects consumers without reading or writing workflow state. Consumers may
 * provide multiple selectors per scope; any intersecting selector is enough.
 */
export function selectNovelImportAffectedConsumersV1(
  impactSelectors: readonly NovelImportImpactSelectorV1[],
  consumers: readonly NovelImportImpactConsumerPlanInputV1[],
): readonly NovelImportAffectedConsumerV1[] {
  const matchedByConsumer = new Map<string, {
    readonly consumerArtifactId: string;
    readonly consumerRevisionId: string;
    readonly scopes: Set<NovelImportChangeScopeV1>;
  }>();

  for (const consumer of consumers) {
    assertNonEmpty(consumer.consumerArtifactId, 'consumerArtifactId');
    assertNonEmpty(consumer.consumerRevisionId, 'consumerRevisionId');
    const key = consumerKey(consumer);
    let matched = matchedByConsumer.get(key);

    for (const impact of impactSelectors) {
      if (!consumer.subscriptions.some(subscription =>
        subscription.changeScope === impact.changeScope
        && selectorsIntersect(subscription.selector, impact.selector))) {
        continue;
      }

      matched ??= {
        consumerArtifactId: consumer.consumerArtifactId,
        consumerRevisionId: consumer.consumerRevisionId,
        scopes: new Set(),
      };
      matched.scopes.add(impact.changeScope);
    }

    if (matched !== undefined)
      matchedByConsumer.set(key, matched);
  }

  return Object.freeze(
    [...matchedByConsumer.values()]
      .sort(compareConsumers)
      .map(consumer => Object.freeze({
        consumerArtifactId: consumer.consumerArtifactId,
        consumerRevisionId: consumer.consumerRevisionId,
        matchedChangeScopes: Object.freeze(
          NOVEL_IMPORT_CHANGE_SCOPES.filter(scope =>
            consumer.scopes.has(scope)),
        ),
      })),
  );
}

function affectedIdsToSelector(
  affected: NovelReimportAffectedIdsPlanInputV1,
): ArtifactSelector | undefined {
  const blockIds = normalizedIds(affected.currentBlockIds, 'currentBlockIds');
  const chapterIds = normalizedIds(
    affected.currentChapterIds,
    'currentChapterIds',
  );
  if (blockIds.length === 0 && chapterIds.length === 0)
    return undefined;

  return Object.freeze({
    ...(chapterIds.length > 0 ? { chapterIds } : {}),
    ...(blockIds.length > 0 ? { blockIds } : {}),
  });
}

function normalizedIds(
  values: readonly string[],
  name: string,
): readonly string[] {
  for (const value of values)
    assertNonEmpty(value, name);
  return Object.freeze([...new Set(values)].sort(compareStrings));
}

function assertNonEmpty(value: string, name: string): void {
  if (typeof value !== 'string' || value.length === 0)
    throw new TypeError(`${name} must contain non-empty stable identifiers`);
}

function consumerKey(consumer: NovelImportImpactConsumerPlanInputV1): string {
  return JSON.stringify([
    consumer.consumerArtifactId,
    consumer.consumerRevisionId,
  ]);
}

function compareConsumers(
  left: {
    readonly consumerArtifactId: string;
    readonly consumerRevisionId: string;
  },
  right: {
    readonly consumerArtifactId: string;
    readonly consumerRevisionId: string;
  },
): number {
  return compareStrings(left.consumerArtifactId, right.consumerArtifactId)
    || compareStrings(left.consumerRevisionId, right.consumerRevisionId);
}

function compareStrings(left: string, right: string): number {
  if (left < right)
    return -1;
  if (left > right)
    return 1;
  return 0;
}
