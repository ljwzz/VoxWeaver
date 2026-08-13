import type { RouteRecordRaw, RouterHistory } from 'vue-router';

import { createRouter, createWebHashHistory } from 'vue-router';
import ProjectWorkspaceLayout from '@/layouts/ProjectWorkspaceLayout.vue';
import ProductionNotFoundPage from '@/pages/project/ProductionNotFoundPage.vue';
import ProjectEntryResolverPage from '@/pages/project/ProjectEntryResolverPage.vue';
import NewProjectPage from '@/pages/startup/NewProjectPage.vue';
import StartupHomePage from '@/pages/startup/StartupHomePage.vue';
import {
  getProjectPageRouteName,
  workspacePages,
} from '@/workspace/navigation';

const projectPageRoutes: RouteRecordRaw[] = workspacePages.map(page => ({
  component: page.component,
  meta: {
    isDemoPreview: false,
    workspaceModuleKey: page.moduleKey,
    workspacePageKey: page.key,
    ...(page.stageId ? { workspaceStageId: page.stageId } : {}),
  },
  name: getProjectPageRouteName(page.key),
  path: page.key,
}));

export function createAppRouter(history: RouterHistory = createWebHashHistory()) {
  const appRouter = createRouter({
    history,
    routes: [
      {
        path: '/',
        redirect: '/startup',
      },
      {
        component: StartupHomePage,
        meta: {
          isDemoPreview: false,
          pageTitle: 'VoxWeaver',
        },
        name: 'startup',
        path: '/startup',
      },
      {
        component: NewProjectPage,
        meta: {
          isDemoPreview: false,
          pageTitle: 'VoxWeaver · 新建项目',
        },
        name: 'new-project',
        path: '/new-project',
      },
      {
        children: [
          {
            component: ProjectEntryResolverPage,
            meta: {
              isDemoPreview: false,
            },
            name: 'project',
            path: '',
          },
          ...projectPageRoutes,
        ],
        component: ProjectWorkspaceLayout,
        meta: {
          isDemoPreview: false,
          usesProjectTitle: true,
        },
        path: '/project',
      },
      {
        component: ProductionNotFoundPage,
        meta: {
          isDemoPreview: false,
          pageTitle: 'VoxWeaver · 页面不存在',
        },
        name: 'not-found',
        path: '/:pathMatch(.*)*',
      },
    ],
  });

  appRouter.afterEach((route, _from, failure) => {
    if (failure || route.meta.usesProjectTitle)
      return;

    document.title = route.meta.pageTitle ?? 'VoxWeaver';
  });

  return appRouter;
}

export const router = createAppRouter();
