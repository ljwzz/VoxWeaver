import { WORKSPACE_PAGE_KEYS } from '@voxweaver/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryHistory } from 'vue-router';
import ProjectWorkspaceLayout from '@/layouts/ProjectWorkspaceLayout.vue';
import { appPages } from '@/pages';
import {
  DEMO_PREVIEW_ROUTE_CLASS,
  installPreviewRoutes,
} from '@/preview/routes';
import { createAppRouter } from '@/router';
import { getProjectPageRouteName } from '@/workspace/navigation';

afterEach(() => {
  document.body.className = '';
  document.title = '';
});

describe('renderer routes', () => {
  it('生产路由不注册页面预览或页面目录', () => {
    const router = createAppRouter(createMemoryHistory());

    expect(router.hasRoute('pages')).toBe(false);
    expect(router.resolve('/pages').name).toBe('not-found');
    expect(router.getRoutes().some(route => route.path.startsWith('/pages'))).toBe(false);
  });

  it('project 使用父布局、空 child resolver 与 22 个稳定命名子路由', () => {
    const router = createAppRouter(createMemoryHistory());
    const entry = router.resolve('/project');

    expect(entry.name).toBe('project');
    expect(entry.matched[0]?.components?.default).toBe(ProjectWorkspaceLayout);
    expect(entry.matched[1]?.name).toBe('project');

    for (const pageKey of WORKSPACE_PAGE_KEYS) {
      const route = router.resolve(`/project/${pageKey}`);
      expect(route.name).toBe(getProjectPageRouteName(pageKey));
      expect(route.meta).toMatchObject({
        isDemoPreview: false,
        usesProjectTitle: true,
        workspacePageKey: pageKey,
      });
      expect(route.meta.pageTitle).toBeUndefined();
    }

    expect(router.getRoutes().filter(route => (
      typeof route.name === 'string' && route.name.startsWith('project-')
    ))).toHaveLength(22);
  });

  it('项目内导航不覆盖项目名称标题', async () => {
    const router = createAppRouter(createMemoryHistory());
    document.title = 'VoxWeaver · 雨夜来信';

    await router.push('/project/text-extraction');
    await router.isReady();
    expect(document.title).toBe('VoxWeaver · 雨夜来信');

    await router.push('/project/chapter-splitting');
    expect(document.title).toBe('VoxWeaver · 雨夜来信');
  });

  it('仅显式安装后提供全部开发预览路由和 preview-* 路由名', () => {
    const router = createAppRouter(createMemoryHistory());
    installPreviewRoutes(router);

    expect(appPages).toHaveLength(48);
    expect(router.hasRoute('pages')).toBe(true);
    for (const page of appPages) {
      const route = router.resolve(page.path);
      expect(route.name).toBe(`preview-${page.slug}`);
      expect(route.meta).toMatchObject({
        isDemoPreview: true,
        pageGroup: page.group,
        pageKind: page.kind,
        pageSlug: page.slug,
        pageTitle: page.title,
      });
    }
  });

  it('进入页面预览添加 body class，离开后移除', async () => {
    const router = createAppRouter(createMemoryHistory());
    installPreviewRoutes(router);

    await router.push('/pages/overall-text');
    await router.isReady();
    expect(document.body.classList.contains(DEMO_PREVIEW_ROUTE_CLASS)).toBe(true);

    await router.push('/project/text-extraction');
    expect(document.body.classList.contains(DEMO_PREVIEW_ROUTE_CLASS)).toBe(false);
  });
});
