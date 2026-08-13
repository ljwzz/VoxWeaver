import type { PageGroup } from '@/pages';

import { describe, expect, it } from 'vitest';
import {
  demoModules,
  getDemoModule,
  getDemoPageRouteName,
  resolveDemoModuleBySlug,
} from '@/demo/navigation';
import { appPages } from '@/pages';

const modulePageGroups = new Set<PageGroup>([
  'overall',
  'text',
  'role',
  'audio',
  'post',
  'settings',
]);

function registeredSlugs(): string[] {
  return demoModules.flatMap(demoModule => [
    demoModule.landingSlug,
    ...demoModule.sidebarSlugs,
    ...demoModule.auxiliarySlugs,
  ]);
}

describe('demo navigation registry', () => {
  it('五个模块的 key 和登记 slug 均不重复', () => {
    const moduleKeys = demoModules.map(demoModule => demoModule.key);
    const slugs = registeredSlugs();

    expect(demoModules).toHaveLength(5);
    expect(new Set(moduleKeys).size).toBe(moduleKeys.length);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('所有登记 slug 均来自页面 manifest', () => {
    const manifestSlugs = new Set(appPages.map(page => page.slug));

    for (const slug of registeredSlugs())
      expect(manifestSlugs.has(slug), `Missing manifest slug: ${slug}`).toBe(true);
  });

  it('每个侧栏入口属于对应模块 group', () => {
    const pagesBySlug = new Map(appPages.map(page => [page.slug, page]));

    for (const demoModule of demoModules) {
      for (const slug of demoModule.sidebarSlugs)
        expect(pagesBySlug.get(slug)?.group).toBe(demoModule.key);
    }
  });

  it('完整覆盖 overall 与五个模块页面，并排除 startup 和 workbench', () => {
    const expectedSlugs = appPages
      .filter(page => modulePageGroups.has(page.group))
      .map(page => page.slug)
      .sort();
    const actualSlugs = registeredSlugs().sort();

    expect(actualSlugs).toEqual(expectedSlugs);

    const excludedSlugs = appPages
      .filter(page => page.group === 'startup' || page.group === 'workbench')
      .map(page => page.slug);

    for (const slug of excludedSlugs)
      expect(actualSlugs).not.toContain(slug);
  });

  it('按 key、slug 和页面路由名解析公共导航', () => {
    expect(getDemoModule('text').landingSlug).toBe('overall-text');
    expect(resolveDemoModuleBySlug('audio-cancel-generation-dialog')?.key).toBe('audio');
    expect(resolveDemoModuleBySlug('workbench-keyboard-focus')).toBeUndefined();
    expect(getDemoPageRouteName('overall-settings')).toBe('preview-overall-settings');
  });
});
