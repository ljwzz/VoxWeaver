import type { ForgeConfig } from '@electron-forge/shared-types';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { MakerZIP } from '@electron-forge/maker-zip';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { createBrandedDevelopmentRuntimePlugin } from './scripts/brandedDevelopmentRuntime.ts';

const execFileAsync = promisify(execFile);

const config: ForgeConfig = {
  hooks: {
    postPackage: async (_forgeConfig, packageResult) => {
      if (packageResult.platform !== 'darwin')
        return;

      for (const outputPath of packageResult.outputPaths) {
        const appPath = outputPath.endsWith('.app')
          ? outputPath
          : path.resolve(outputPath, 'VoxWeaver.app');

        await execFileAsync('/usr/bin/codesign', [
          '--force',
          '--deep',
          '--sign',
          '-',
          appPath,
        ]);
        await execFileAsync('/usr/bin/codesign', [
          '--verify',
          '--deep',
          '--strict',
          appPath,
        ]);
      }
    },
  },
  packagerConfig: {
    appBundleId: 'com.voxweaver.desktop',
    appCategoryType: 'public.app-category.productivity',
    asar: true,
    executableName: 'VoxWeaver',
    icon: path.resolve(__dirname, 'assets/app-icon'),
    name: 'VoxWeaver',
  },
  makers: [
    new MakerZIP({}, ['darwin']),
  ],
  plugins: [
    createBrandedDevelopmentRuntimePlugin(),
    new VitePlugin({
      build: [
        {
          entry: { main: 'main/index.ts' },
          config: 'vite.main.config.mts',
        },
        {
          entry: { core: 'core/index.ts' },
          config: 'vite.main.config.mts',
        },
        {
          entry: { preload: 'preload/index.ts' },
          config: 'vite.preload.config.mts',
          target: 'preload',
        },
      ],
      concurrent: false,
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.mts',
        },
      ],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
