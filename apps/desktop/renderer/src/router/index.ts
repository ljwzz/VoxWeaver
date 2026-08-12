import type { RouteRecordRaw } from 'vue-router';

import { createRouter, createWebHashHistory } from 'vue-router';
import NotFoundPage from '@/components/NotFoundPage.vue';
import PageCatalog from '@/components/PageCatalog.vue';
import { appPages } from '@/pages';
import NewProjectPage from '@/pages/startup/NewProjectPage.vue';
import StartupHomePage from '@/pages/startup/StartupHomePage.vue';
import WorkspaceTextPage from '@/pages/workspace/WorkspaceTextPage.vue';

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
      redirect: '/startup',
    },
    {
      component: StartupHomePage,
      meta: { pageTitle: 'VoxWeaver' },
      name: 'startup',
      path: '/startup',
    },
    {
      component: NewProjectPage,
      meta: { pageTitle: 'VoxWeaver · 新建项目' },
      name: 'new-project',
      path: '/new-project',
    },
    {
      component: WorkspaceTextPage,
      meta: { pageTitle: 'VoxWeaver · 项目工作台' },
      name: 'project',
      path: '/project',
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
