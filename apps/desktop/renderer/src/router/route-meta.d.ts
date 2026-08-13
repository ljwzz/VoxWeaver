import type {
  WorkflowStageId,
  WorkspaceModuleKey,
  WorkspacePageKey,
} from '@voxweaver/contracts';

import 'vue-router';

export {};

type PreviewPageGroup = 'startup' | 'overall' | 'workbench' | 'text' | 'role' | 'audio' | 'post' | 'settings';
type PreviewPageKind = 'page' | 'responsive' | 'state' | 'overlay' | 'tooltip' | 'qa';

declare module 'vue-router' {
  interface RouteMeta {
    pageSlug?: string;
    pageGroup?: PreviewPageGroup;
    pageKind?: PreviewPageKind;
    pageTitle?: string;
    isDemoPreview?: boolean;
    usesProjectTitle?: boolean;
    workspaceModuleKey?: WorkspaceModuleKey;
    workspacePageKey?: WorkspacePageKey;
    workspaceStageId?: WorkflowStageId;
  }
}
