import { WORKSPACE_PAGE_KEYS } from '@voxweaver/contracts';
import { describe, expect, it } from 'vitest';
import {
  getProjectPageRouteName,
  getWorkspaceModule,
  workspaceModules,
  workspacePages,
} from '@/workspace/navigation';

describe('workspace navigation', () => {
  it('以契约中的 22 个页面键作为唯一生产页面集合', () => {
    expect(workspacePages.map(page => page.key)).toEqual(WORKSPACE_PAGE_KEYS);
    expect(new Set(workspacePages.map(page => page.key)).size).toBe(22);
    expect(workspaceModules.flatMap(module => module.pages)).toEqual(workspacePages);
  });

  it('生成稳定的生产路由名并固定五个模块默认页', () => {
    expect(workspacePages.map(page => getProjectPageRouteName(page.key))).toEqual(
      WORKSPACE_PAGE_KEYS.map(pageKey => `project-${pageKey}`),
    );
    expect(workspaceModules.map(module => [module.key, module.defaultPageKey])).toEqual([
      ['text', 'text-extraction'],
      ['role', 'primary-character-marking'],
      ['audio', 'chapter-parameters'],
      ['post', 'timeline-alignment'],
      ['settings', 'project-settings'],
    ]);
  });

  it('每个模块默认页属于自身且全部页面都有明确实现类型', () => {
    for (const workspaceModule of workspaceModules) {
      expect(workspaceModule.pages).toContainEqual(
        expect.objectContaining({ key: workspaceModule.defaultPageKey }),
      );
      expect(getWorkspaceModule(workspaceModule.key)).toBe(workspaceModule);
    }

    expect(workspacePages.filter(page => page.implementation !== 'gated').map(page => page.key)).toEqual([
      'text-extraction',
      'chapter-splitting',
      'project-settings',
    ]);
  });
});
