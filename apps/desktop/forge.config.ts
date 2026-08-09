import type { ForgeConfig } from '@electron-forge/shared-types';
import { WebpackPlugin } from '@electron-forge/plugin-webpack';

import { mainConfig } from './webpack.main.config';
import { rendererConfig } from './webpack.renderer.config';

const config: ForgeConfig = {
  // Stage 00 does not configure a release signing identity or notarization;
  // those capabilities remain gated by ARCH-D01/D02.
  packagerConfig: {
    asar: true,
    extendInfo: {
      NSAppTransportSecurity: {
        NSAllowsArbitraryLoads: false,
      },
    },
  },
  makers: [],
  plugins: [
    new WebpackPlugin({
      mainConfig,
      renderer: {
        config: rendererConfig,
        entryPoints: [
          {
            html: './renderer/index.html',
            js: './renderer/index.ts',
            name: 'main_window',
            preload: {
              js: './preload/index.ts',
            },
          },
        ],
      },
    }),
  ],
};

export default config;
