import type { RouteRecordRaw } from 'vue-router';

import { createRouter, createWebHashHistory } from 'vue-router';
import NotFoundPage from '@/components/NotFoundPage.vue';
import PageCatalog from '@/components/PageCatalog.vue';
import { appPages, defaultPagePath } from '@/pages';

const pageRoutes: RouteRecordRaw[] = appPages.map(page => ({
  component: page.component,
  meta: {
    pageKind: page.kind,
    pageTitle: page.title,
  },
  name: `page-${page.slug}`,
  path: page.path,
}));

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      redirect: defaultPagePath,
    },
    {
      component: PageCatalog,
      meta: {
        pageTitle: 'VoxWeaver · 页面目录',
      },
      name: 'pages',
      path: '/pages',
    },
    ...pageRoutes,
    {
      component: NotFoundPage,
      meta: {
        pageTitle: 'VoxWeaver · 页面不存在',
      },
      name: 'not-found',
      path: '/:pathMatch(.*)*',
    },
  ],
});

router.afterEach((route) => {
  document.title = typeof route.meta.pageTitle === 'string'
    ? route.meta.pageTitle
    : 'VoxWeaver';
});
