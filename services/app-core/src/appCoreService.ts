import type {
  AssertProjectSessionCommand,
  CreateProjectCommand,
  InspectProjectCommand,
  NovelImportBundleV1,
  NovelImportTemporaryArtifact,
  NovelImportWorkflowPort,
  OpenProjectCommand,
  ProjectInspectionPreview,
  ProjectWorkflowApplicationService,
  ProjectWorkflowFactory,
  ProjectWorkspacePort,
  ValidateNovelImportBundleCommand,
  WriteNovelImportBundleCommand,
} from '@voxweaver/application';
import type {
  ProjectContext,
  SourceAssetRecord,
  TaskRecord,
} from '@voxweaver/contracts';
import type { NovelSourceAsset } from '@voxweaver/novel-import';

import { Buffer } from 'node:buffer';
import { constants } from 'node:fs';
import {
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  writeFile,
} from 'node:fs/promises';
import { extname, isAbsolute, join, posix, resolve, sep } from 'node:path';

import {
  NovelImportApplicationService,
  ProjectApplicationService,
  ProjectWorkflowApplicationService as WorkflowApplicationService,
} from '@voxweaver/application';
import {
  TXT_SOURCE_ADAPTER_ID,
  TxtSourceAdapter,
} from '@voxweaver/novel-import';
import {
  NodeProjectWorkflow,
  NodeProjectWorkspace,
} from '@voxweaver/project-workspace';

const NOVEL_IMPORT_OUTPUT_DIRECTORY = 'novel-import-bundle';
const NOVEL_IMPORT_BUNDLE_FILE = 'bundle.json';

export interface AppCoreServiceOptions {
  projectWorkspace?: ProjectWorkspacePort;
  projectWorkflowFactory?: ProjectWorkflowFactory;
}

export class AppCoreService {
  readonly #projects: ProjectApplicationService;
  readonly novelImport: NovelImportApplicationService;
  readonly workflow: ProjectWorkflowApplicationService;

  constructor(options: AppCoreServiceOptions = {}) {
    this.#projects = new ProjectApplicationService(
      options.projectWorkspace ?? new NodeProjectWorkspace(),
    );
    const workflowFactory = options.projectWorkflowFactory
      ?? (context => new NodeProjectWorkflow(context));
    this.workflow = new WorkflowApplicationService(
      this.#projects,
      workflowFactory,
    );
    this.novelImport = new NovelImportApplicationService(
      this.#projects,
      context => requireNovelImportWorkflow(workflowFactory(context)),
      {
        resolveSourceAsset: (sourceAsset, expectedByteLength) => (
          resolveNovelSourceAsset(
            requireActiveProject(this.#projects),
            sourceAsset,
            expectedByteLength,
          )
        ),
      },
      {
        resolveAdapter: (adapterId) => {
          if (adapterId !== TXT_SOURCE_ADAPTER_ID)
            throw new Error('The requested novel source adapter is unavailable.');
          return new TxtSourceAdapter();
        },
      },
      {
        writeBundle: command => writeNovelImportBundle(
          requireActiveProject(this.#projects),
          command,
        ),
      },
      {
        validateBundle: command => validateNovelImportBundle(
          requireActiveProject(this.#projects),
          command,
        ),
      },
    );
  }

  assertActiveProjectSession(
    command: AssertProjectSessionCommand,
  ): ProjectContext {
    return this.#projects.assertActiveProjectSession(command);
  }

  closeProject(): Promise<void> {
    return this.#projects.closeProject();
  }

  createProject(command: CreateProjectCommand): Promise<ProjectContext> {
    return this.#projects.createProject(command);
  }

  getActiveProject(): ProjectContext | undefined {
    return this.#projects.getActiveProject();
  }

  inspectProject(
    command: InspectProjectCommand,
  ): Promise<ProjectInspectionPreview> {
    return this.#projects.inspectProject(command);
  }

  openProject(command: OpenProjectCommand): Promise<ProjectContext> {
    return this.#projects.openProject(command);
  }

  switchProject(command: OpenProjectCommand): Promise<ProjectContext> {
    return this.#projects.switchProject(command);
  }
}

function requireNovelImportWorkflow(
  workflow: ReturnType<ProjectWorkflowFactory>,
): NovelImportWorkflowPort {
  if (typeof Reflect.get(workflow, 'commitSourceAsset') !== 'function') {
    throw new TypeError(
      'The active project workflow cannot commit immutable SourceAssets.',
    );
  }
  return workflow as NovelImportWorkflowPort;
}

function requireActiveProject(projects: ProjectApplicationService): ProjectContext {
  const context = projects.getActiveProject();
  if (!context)
    throw new Error('An active project is required for novel import.');
  return context;
}

async function resolveNovelSourceAsset(
  context: ProjectContext,
  sourceAsset: SourceAssetRecord,
  expectedByteLength: number,
): Promise<NovelSourceAsset> {
  const sourcePath = resolveProjectPath(
    context,
    sourceAsset.relativePath,
    'inputs/source-assets',
  );
  const sourceEntry = await assertPhysicalFile(sourcePath);
  if (sourceEntry.size !== expectedByteLength) {
    throw new Error(
      'The committed SourceAsset byte length does not match its physical file.',
    );
  }

  return {
    sourceAssetId: sourceAsset.sourceAssetId,
    sourceContentHash: sourceAsset.contentHash,
    sourceByteLength: expectedByteLength,
    fileExtension: extname(sourceAsset.originalName).toLowerCase(),
    mediaType: 'text/plain',
    openByteStream: () => openPhysicalSourceStream(sourcePath),
  };
}

async function* openPhysicalSourceStream(
  sourcePath: string,
): AsyncIterable<Uint8Array> {
  const handle = await open(
    sourcePath,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      if (!(chunk instanceof Uint8Array))
        throw new Error('The physical SourceAsset stream returned invalid data.');
      yield chunk;
    }
  } finally {
    await handle.close();
  }
}

async function writeNovelImportBundle(
  context: ProjectContext,
  command: WriteNovelImportBundleCommand,
): Promise<NovelImportTemporaryArtifact> {
  assertTaskProject(command.task, context);
  const outputRelativePath = novelImportOutputRelativePath(command.task);
  const taskOutputPath = resolveProjectPath(
    context,
    posix.join(command.task.temporaryPath, 'output'),
    'tmp',
  );
  await assertPhysicalDirectory(taskOutputPath);

  const outputPath = resolveProjectPath(context, outputRelativePath, 'tmp');
  await mkdir(outputPath, { mode: 0o700 });
  await writeFile(
    join(outputPath, NOVEL_IMPORT_BUNDLE_FILE),
    serializeNovelImportBundle(command.bundle),
    { encoding: 'utf8', flag: 'wx', flush: true, mode: 0o600 },
  );
  return { outputDirectory: outputRelativePath };
}

async function validateNovelImportBundle(
  context: ProjectContext,
  command: ValidateNovelImportBundleCommand,
): Promise<void> {
  assertTaskProject(command.task, context);
  const expectedOutputDirectory = novelImportOutputRelativePath(command.task);
  if (command.artifact.outputDirectory !== expectedOutputDirectory) {
    throw new Error(
      'The novel import bundle is outside the active task output directory.',
    );
  }

  const outputPath = resolveProjectPath(context, expectedOutputDirectory, 'tmp');
  await assertPhysicalDirectory(outputPath);
  const entries = await readdir(outputPath, { withFileTypes: true });
  if (
    entries.length !== 1
    || entries[0]?.name !== NOVEL_IMPORT_BUNDLE_FILE
    || !entries[0].isFile()
    || entries[0].isSymbolicLink()
  ) {
    throw new Error('The temporary novel import bundle layout is invalid.');
  }

  const expectedContents = serializeNovelImportBundle(command.expectedBundle);
  const bundlePath = join(outputPath, NOVEL_IMPORT_BUNDLE_FILE);
  const bundleEntry = await assertPhysicalFile(bundlePath);
  if (bundleEntry.size !== Buffer.byteLength(expectedContents, 'utf8'))
    throw new Error('The temporary novel import bundle size is invalid.');

  const actualContents = await readFile(bundlePath, 'utf8');
  if (actualContents !== expectedContents)
    throw new Error('The temporary novel import bundle content is invalid.');
  JSON.parse(actualContents) as NovelImportBundleV1;
}

function novelImportOutputRelativePath(task: TaskRecord): string {
  return posix.join(
    task.temporaryPath,
    'output',
    NOVEL_IMPORT_OUTPUT_DIRECTORY,
  );
}

function assertTaskProject(task: TaskRecord, context: ProjectContext): void {
  if (task.projectId !== context.manifest.projectId)
    throw new Error('The novel import task belongs to another project.');
}

function serializeNovelImportBundle(bundle: NovelImportBundleV1): string {
  return `${JSON.stringify(bundle, undefined, 2)}\n`;
}

function resolveProjectPath(
  context: ProjectContext,
  relativePath: string,
  requiredRoot: 'inputs/source-assets' | 'tmp',
): string {
  assertPortableRelativePath(relativePath);
  if (
    relativePath !== requiredRoot
    && !relativePath.startsWith(`${requiredRoot}/`)
  ) {
    throw new Error('The project-relative path is outside its required root.');
  }

  const projectRoot = resolve(context.projectDirectory);
  const targetPath = resolve(projectRoot, ...relativePath.split('/'));
  if (!isPathWithin(projectRoot, targetPath))
    throw new Error('The project-relative path escapes the active project.');
  return targetPath;
}

function assertPortableRelativePath(relativePath: string): void {
  const segments = relativePath.split('/');
  if (
    relativePath.length === 0
    || isAbsolute(relativePath)
    || relativePath.includes('\\')
    || segments.some(segment => (
      segment.length === 0 || segment === '.' || segment === '..'
    ))
  ) {
    throw new Error('A portable project-relative path is required.');
  }
}

function isPathWithin(rootPath: string, targetPath: string): boolean {
  return targetPath === rootPath || targetPath.startsWith(`${rootPath}${sep}`);
}

async function assertPhysicalFile(path: string) {
  const [entry, resolvedPath] = await Promise.all([lstat(path), realpath(path)]);
  if (!entry.isFile() || entry.isSymbolicLink() || resolvedPath !== path)
    throw new Error('A physical project file is required.');
  return entry;
}

async function assertPhysicalDirectory(path: string): Promise<void> {
  const [entry, resolvedPath] = await Promise.all([lstat(path), realpath(path)]);
  if (!entry.isDirectory() || entry.isSymbolicLink() || resolvedPath !== path)
    throw new Error('A physical project directory is required.');
}
