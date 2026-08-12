import type { Component } from 'vue';

import rawPageManifest from '@/page-manifest.json';

export type PageGroup = 'startup' | 'overall' | 'workbench' | 'text' | 'role' | 'audio' | 'post' | 'settings';
export type PageKind = 'page' | 'responsive' | 'state' | 'overlay' | 'tooltip' | 'qa';

interface PageModule {
  default: Component;
}

interface PageManifestEntry {
  slug: string;
  title: string;
  group: PageGroup;
  kind: PageKind;
  componentPath: string;
  width: number;
  height: number;
  renderWidth?: number;
  renderHeight?: number;
}

export interface AppPage extends PageManifestEntry {
  component: () => Promise<Component>;
  path: string;
}

const pageComponents = import.meta.glob<PageModule>('./pages/**/*.vue');

function componentLoader(componentPath: string): () => Promise<Component> {
  const loader = pageComponents[componentPath];

  if (!loader)
    throw new Error(`Missing page component: ${componentPath}`);

  return async () => (await loader()).default;
}

const definitions = rawPageManifest as PageManifestEntry[];
const slugs = new Set<string>();

export const appPages: readonly AppPage[] = Object.freeze(definitions.map((definition) => {
  if (slugs.has(definition.slug))
    throw new Error(`Duplicate page slug: ${definition.slug}`);

  slugs.add(definition.slug);

  return Object.freeze({
    ...definition,
    component: componentLoader(definition.componentPath),
    path: `/pages/${definition.slug}`,
  });
}));

export const pageGroupLabels: Record<PageGroup, string> = {
  startup: '项目启动',
  overall: '整体工作台',
  workbench: '工作台状态',
  text: '文本整理',
  role: '角色管理',
  audio: '音频生成',
  post: '后期处理',
  settings: '设置',
};

export const defaultPagePath = '/pages/startup-home';
