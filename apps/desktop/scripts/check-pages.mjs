import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rendererSource = path.join(desktopRoot, 'renderer', 'src');
const manifestPath = path.join(rendererSource, 'page-manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

if (!Array.isArray(manifest) || manifest.length !== 48)
  throw new Error(`Expected 48 page routes, received ${Array.isArray(manifest) ? manifest.length : 'invalid manifest'}`);

const slugs = new Set();
for (const page of manifest) {
  if (!page || typeof page.slug !== 'string' || slugs.has(page.slug))
    throw new Error(`Invalid or duplicate page slug: ${page?.slug}`);
  slugs.add(page.slug);

  if (typeof page.componentPath !== 'string' || !page.componentPath.startsWith('./pages/') || !page.componentPath.endsWith('.vue'))
    throw new Error(`Invalid component path for ${page.slug}`);

  await stat(path.join(rendererSource, page.componentPath.slice(2)));
}

for (const startupSlug of ['startup-home', 'startup-new-project']) {
  const page = manifest.find(entry => entry.slug === startupSlug);
  if (page?.width !== 700 || page?.height !== 450)
    throw new Error(`${startupSlug} must use the 700x450 startup window size`);
}

for (const componentPath of [
  'pages/startup/StartupHomePage.vue',
  'pages/startup/NewProjectPage.vue',
  'pages/workspace/WorkspaceTextPage.vue',
]) {
  const source = await readFile(path.join(rendererSource, componentPath), 'utf8');
  if (source.includes('window-controls'))
    throw new Error(`${componentPath} still renders fake window controls`);
}

console.log(`Validated ${manifest.length} page routes and production window chrome boundaries.`);
