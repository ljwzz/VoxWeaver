// @vitest-environment node

import { describe, expect, it } from 'vitest';
import rendererConfig from '../../vite.renderer.config.mts';

describe('renderer Vite config', () => {
  it('keeps local contracts out of dependency pre-bundling', () => {
    expect(rendererConfig.optimizeDeps?.exclude).toContain('@voxweaver/contracts');
  });
});
