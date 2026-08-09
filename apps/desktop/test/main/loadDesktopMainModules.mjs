import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import TypeScript from 'typescript';

const moduleCache = new Map();

/**
 * Desktop sources use normal TypeScript ESM `.js` specifiers for Forge. Node
 * tests transpile the small Main modules into a temporary ESM directory so
 * they exercise their real runtime behavior without adding a test loader.
 */
export async function loadDesktopMainModule(moduleName) {
  let loaded = moduleCache.get(moduleName);
  if (!loaded) {
    loaded = await compileDesktopMainModules();
    moduleCache.set(moduleName, loaded);
  }
  return loaded[moduleName];
}

async function compileDesktopMainModules() {
  const registrySource = await readFile(
    new URL('../../main/selectionTokenRegistry.ts', import.meta.url),
    'utf8',
  );
  const novelSourceRegistry = await readFile(
    new URL('../../main/novelSourceSelectionTokenRegistry.ts', import.meta.url),
    'utf8',
  );
  const controllerSource = await readFile(
    new URL('../../main/desktopMainController.ts', import.meta.url),
    'utf8',
  );
  const contractsUrl = pathToFileURL(fileURLToPath(
    new URL('../../../../packages/contracts/dist/index.js', import.meta.url),
  )).href;

  const outputDirectory = await mkdtemp(join(tmpdir(), 'voxweaver-desktop-main-'));
  const registryFile = join(outputDirectory, 'selectionTokenRegistry.js');
  const novelSourceRegistryFile = join(
    outputDirectory,
    'novelSourceSelectionTokenRegistry.js',
  );
  const controllerFile = join(outputDirectory, 'desktopMainController.js');

  try {
    await writeFile(registryFile, transpile(registrySource));
    await writeFile(novelSourceRegistryFile, transpile(novelSourceRegistry));
    await writeFile(
      controllerFile,
      transpile(controllerSource.replaceAll('@voxweaver/contracts', contractsUrl)),
    );

    return {
      controller: await import(pathToFileURL(controllerFile).href),
      novelSourceRegistry: await import(pathToFileURL(novelSourceRegistryFile).href),
      registry: await import(pathToFileURL(registryFile).href),
    };
  } finally {
    await rm(outputDirectory, { force: true, recursive: true });
  }
}

function transpile(source) {
  return TypeScript.transpileModule(source, {
    compilerOptions: {
      module: TypeScript.ModuleKind.ESNext,
      target: TypeScript.ScriptTarget.ES2021,
      verbatimModuleSyntax: true,
    },
    fileName: basename('desktop-main.ts'),
  }).outputText;
}
