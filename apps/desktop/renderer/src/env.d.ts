/// <reference types="vite/client" />

import type { DesktopApi } from '@voxweaver/contracts';

declare global {
  interface Window {
    readonly voxweaver: DesktopApi;
  }
}
