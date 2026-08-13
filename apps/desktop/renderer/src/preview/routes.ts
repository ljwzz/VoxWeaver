import type { Router, RouteRecordRaw } from 'vue-router';

import PageCatalog from '@/components/PageCatalog.vue';
import { getDemoPageRouteName } from '@/demo/navigation';
import { appPages } from '@/pages';

export const DEMO_PREVIEW_ROUTE_CLASS = 'demo-preview-route';

const installedRouters = new WeakSet<Router>();

export const previewRoutes: RouteRecordRaw[] = [
  {
    component: PageCatalog,
    meta: {
      isDemoPreview: true,
      pageTitle: 'VoxWeaver · 页面目录',
    },
    name: 'pages',
    path: '/pages',
  },
  ...appPages.map(page => ({
    component: page.component,
    meta: {
      isDemoPreview: true,
      pageGroup: page.group,
      pageKind: page.kind,
      pageSlug: page.slug,
      pageTitle: page.title,
    },
    name: getDemoPageRouteName(page.slug),
    path: page.path,
  } satisfies RouteRecordRaw)),
];

export function installPreviewRoutes(router: Router): void {
  for (const route of previewRoutes) {
    if (!route.name || !router.hasRoute(route.name))
      router.addRoute(route);
  }

  if (installedRouters.has(router))
    return;

  installedRouters.add(router);
  router.afterEach((route, _from, failure) => {
    if (failure)
      return;
    document.body.classList.toggle(
      DEMO_PREVIEW_ROUTE_CLASS,
      route.meta.isDemoPreview === true,
    );
  });
}
