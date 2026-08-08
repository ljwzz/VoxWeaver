import type { ArtifactSelector } from '@voxweaver/contracts';

const SELECTOR_KEYS = [
  'chapterIds',
  'blockIds',
  'scriptUnitIds',
  'voiceProfileIds',
  'dictionaryEntryIds',
] as const satisfies readonly (keyof ArtifactSelector)[];

export function selectorsIntersect(
  dependencySelector: ArtifactSelector | undefined,
  changeSelector: ArtifactSelector | undefined,
): boolean {
  if (!dependencySelector || !changeSelector)
    return true;

  for (const key of SELECTOR_KEYS) {
    const dependencyValues = dependencySelector[key];
    const changeValues = changeSelector[key];
    if (!dependencyValues || !changeValues)
      continue;

    const changed = new Set(changeValues);
    if (!dependencyValues.some(value => changed.has(value)))
      return false;
  }

  return true;
}
