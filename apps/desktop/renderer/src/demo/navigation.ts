const demoModuleSeeds = [
  {
    key: 'text',
    name: '文本整理',
    activityLabel: '文本',
    landingSlug: 'overall-text',
    sidebarSlugs: [
      'text-extraction',
      'chapter-splitting',
      'proofreading',
      'character-extraction',
      'script-management',
    ],
    auxiliarySlugs: [
      'overall-text-1280',
      'text-downstream-stale-dialog',
    ],
  },
  {
    key: 'role',
    name: '角色管理',
    activityLabel: '角色',
    landingSlug: 'overall-role',
    sidebarSlugs: [
      'primary-character-marking',
      'crowd-voice-pool',
      'character-voice-refinement',
    ],
    auxiliarySlugs: [],
  },
  {
    key: 'audio',
    name: '音频生成',
    activityLabel: '音频',
    landingSlug: 'overall-audio',
    sidebarSlugs: [
      'audio-chapter-parameters',
      'audio-selection-requirements',
      'audio-asr-review',
      'audio-chapter-generation',
      'audio-stale-propagation',
    ],
    auxiliarySlugs: [
      'audio-stale-confirm-dialog',
      'audio-cancel-generation-dialog',
      'audio-chapter-parameters-1280',
    ],
  },
  {
    key: 'post',
    name: '后期处理',
    activityLabel: '后期',
    landingSlug: 'overall-post',
    sidebarSlugs: [
      'timeline-alignment',
      'loudness-consistency',
      'chapter-summary',
      'chapter-cover',
      'tar-export',
    ],
    auxiliarySlugs: [
      'offline-player-export',
    ],
  },
  {
    key: 'settings',
    name: '设置',
    activityLabel: '设置',
    landingSlug: 'overall-settings',
    sidebarSlugs: [
      'project-backup',
      'project-settings',
      'software-settings',
    ],
    auxiliarySlugs: [
      'restore-backup-dialog',
      'unsaved-to-backup-dialog',
      'unsaved-to-software-dialog',
      'settings-validation-dialog',
      'settings-save-success-dialog',
      'project-settings-1280',
      'settings-focus-overflow-qa',
    ],
  },
] as const;

type DemoModuleSeed = typeof demoModuleSeeds[number];

export type DemoModuleKey = DemoModuleSeed['key'];
export type DemoLandingPageSlug = DemoModuleSeed['landingSlug'];
export type DemoSidebarPageSlug = DemoModuleSeed['sidebarSlugs'][number];
export type DemoAuxiliaryPageSlug = DemoModuleSeed['auxiliarySlugs'][number];
export type DemoPageSlug = DemoLandingPageSlug | DemoSidebarPageSlug | DemoAuxiliaryPageSlug;

export interface DemoModuleDefinition {
  readonly key: DemoModuleKey;
  readonly name: string;
  readonly activityLabel: string;
  readonly landingSlug: DemoLandingPageSlug;
  readonly sidebarSlugs: readonly DemoSidebarPageSlug[];
  readonly auxiliarySlugs: readonly DemoAuxiliaryPageSlug[];
}

function createDemoModuleDefinition(seed: DemoModuleSeed): DemoModuleDefinition {
  return Object.freeze({
    ...seed,
    sidebarSlugs: Object.freeze([...seed.sidebarSlugs]),
    auxiliarySlugs: Object.freeze([...seed.auxiliarySlugs]),
  });
}

export const demoModules: readonly DemoModuleDefinition[] = Object.freeze(
  demoModuleSeeds.map(createDemoModuleDefinition),
);

const demoModulesByKey = new Map<DemoModuleKey, DemoModuleDefinition>();
const demoModulesBySlug = new Map<string, DemoModuleDefinition>();

for (const demoModule of demoModules) {
  demoModulesByKey.set(demoModule.key, demoModule);

  const slugs: readonly DemoPageSlug[] = [
    demoModule.landingSlug,
    ...demoModule.sidebarSlugs,
    ...demoModule.auxiliarySlugs,
  ];

  for (const slug of slugs) {
    if (demoModulesBySlug.has(slug))
      throw new Error(`Duplicate demo page slug: ${slug}`);

    demoModulesBySlug.set(slug, demoModule);
  }
}

export function getDemoModule(moduleKey: DemoModuleKey): DemoModuleDefinition {
  const demoModule = demoModulesByKey.get(moduleKey);

  if (!demoModule)
    throw new Error(`Unknown demo module: ${moduleKey}`);

  return demoModule;
}

export function resolveDemoModuleBySlug(slug: string | null | undefined): DemoModuleDefinition | undefined {
  return slug ? demoModulesBySlug.get(slug) : undefined;
}

export function getDemoPageRouteName<TSlug extends string>(slug: TSlug): `preview-${TSlug}` {
  return `preview-${slug}` as const;
}
