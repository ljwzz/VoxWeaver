import type { ProjectContext, ProjectManifest } from '@voxweaver/contracts';
import { randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';

import { basename, dirname, join, resolve } from 'node:path';
import {
  parseProjectManifest,
  PROJECT_LAYOUT_VERSION,
  PROJECT_MANIFEST_SCHEMA_VERSION,
  ProjectManifestValidationError,
} from '@voxweaver/contracts';

import { ProjectWorkspaceError } from './projectWorkspaceError.js';

export interface CreateProjectWorkspaceCommand {
  displayName: string;
  parentDirectory: string;
}

export interface OpenProjectWorkspaceCommand {
  projectDirectory: string;
}

export interface NodeProjectWorkspaceOptions {
  generateProjectId?: () => string;
  now?: () => Date;
}

const PROJECT_ID_PATTERN
  = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const PROJECT_LAYOUT_DIRECTORIES = [
  'state/backups',
  'state/locks',
  'inputs/novels',
  'inputs/voice-sources',
  'inputs/artwork',
  'artifacts/imported',
  'artifacts/canonical',
  'artifacts/normalized',
  'artifacts/corrected',
  'artifacts/structure',
  'artifacts/knowledge',
  'artifacts/scripts',
  'artifacts/spoken',
  'artifacts/voice-profiles',
  'artifacts/renders',
  'artifacts/qa',
  'artifacts/assemblies',
  'exports',
  'cache',
  'logs',
  'tmp',
] as const;

export class NodeProjectWorkspace {
  readonly #generateProjectId: () => string;
  readonly #now: () => Date;

  constructor(options: NodeProjectWorkspaceOptions = {}) {
    this.#generateProjectId = options.generateProjectId ?? randomUUID;
    this.#now = options.now ?? (() => new Date());
  }

  async closeProject(_project: ProjectContext): Promise<void> {}

  async createProject(
    command: CreateProjectWorkspaceCommand,
  ): Promise<ProjectContext> {
    const displayName = validateDisplayName(command.displayName);
    const parentDirectory = await resolveDirectory(
      command.parentDirectory,
      'PROJECT_PARENT_INVALID',
      'Project parent directory does not exist or is not a directory.',
    );
    const projectId = this.#generateProjectId();

    if (!PROJECT_ID_PATTERN.test(projectId)) {
      throw new ProjectWorkspaceError(
        'PROJECT_ID_INVALID',
        'Generated project ID must be a UUID v4 string.',
      );
    }

    const directoryName = `${createSafeSlug(displayName)}--${projectId}`;
    const projectDirectory = join(parentDirectory, directoryName);

    if (dirname(projectDirectory) !== parentDirectory) {
      throw new ProjectWorkspaceError(
        'PROJECT_DIRECTORY_INVALID',
        'Generated project directory escapes the selected parent directory.',
      );
    }

    await assertTargetDoesNotExist(projectDirectory);

    const temporaryDirectory = await mkdtemp(
      join(parentDirectory, `.${directoryName}.creating-`),
    );
    let committed = false;

    try {
      const timestamp = this.#now().toISOString();
      const manifest: ProjectManifest = {
        schemaVersion: PROJECT_MANIFEST_SCHEMA_VERSION,
        layoutVersion: PROJECT_LAYOUT_VERSION,
        projectId,
        displayName,
        directoryName,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      await Promise.all(
        PROJECT_LAYOUT_DIRECTORIES.map(relativePath =>
          mkdir(join(temporaryDirectory, relativePath), { recursive: true }),
        ),
      );
      await writeFile(
        join(temporaryDirectory, 'project.json'),
        `${JSON.stringify(manifest, undefined, 2)}\n`,
        { encoding: 'utf8', flag: 'wx' },
      );

      await validateProjectDirectory(temporaryDirectory);
      await assertTargetDoesNotExist(projectDirectory);
      await rename(temporaryDirectory, projectDirectory);
      committed = true;

      return await this.openProject({ projectDirectory });
    } catch (error) {
      if (!committed)
        await rm(temporaryDirectory, { force: true, recursive: true });

      throw normalizeCreateError(error);
    }
  }

  async openProject(
    command: OpenProjectWorkspaceCommand,
  ): Promise<ProjectContext> {
    const projectDirectory = await resolveDirectory(
      command.projectDirectory,
      'PROJECT_DIRECTORY_INVALID',
      'Project directory does not exist or is not a directory.',
    );
    const manifest = await validateProjectDirectory(projectDirectory);

    if (basename(projectDirectory) !== manifest.directoryName) {
      throw new ProjectWorkspaceError(
        'PROJECT_DIRECTORY_INVALID',
        'Project directory name does not match its manifest.',
      );
    }

    return { projectDirectory, manifest };
  }
}

export function createSafeSlug(displayName: string): string {
  const parts = displayName
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .match(/[\p{Letter}\p{Number}]+/gu) ?? [];
  const characters = Array.from(parts.join('-')).slice(0, 48);

  while (characters[characters.length - 1] === '-')
    characters.pop();

  return characters.join('') || 'project';
}

async function assertDirectory(path: string, relativePath: string): Promise<void> {
  try {
    const entry = await lstat(path);
    if (!entry.isDirectory() || entry.isSymbolicLink())
      throw new Error('Entry is not a physical directory.');
  } catch (error) {
    throw new ProjectWorkspaceError(
      'PROJECT_LAYOUT_INCOMPLETE',
      `Project layout entry "${relativePath}" is missing or invalid.`,
      error,
    );
  }
}

async function assertRegularFile(path: string, relativePath: string): Promise<void> {
  try {
    const entry = await lstat(path);
    if (!entry.isFile() || entry.isSymbolicLink())
      throw new Error('Entry is not a physical file.');
  } catch (error) {
    throw new ProjectWorkspaceError(
      'PROJECT_MANIFEST_INVALID',
      `Project manifest "${relativePath}" is missing or invalid.`,
      error,
    );
  }
}

async function assertTargetDoesNotExist(path: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error) {
    if (isFileSystemError(error, 'ENOENT'))
      return;

    throw new ProjectWorkspaceError(
      'PROJECT_CREATE_FAILED',
      'Unable to inspect the target project directory.',
      error,
    );
  }

  throw new ProjectWorkspaceError(
    'PROJECT_ALREADY_EXISTS',
    'The target project directory already exists.',
  );
}

function isFileSystemError(
  error: unknown,
  code: string,
): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === code;
}

function normalizeCreateError(error: unknown): ProjectWorkspaceError {
  if (error instanceof ProjectWorkspaceError)
    return error;

  if (error instanceof ProjectManifestValidationError) {
    return new ProjectWorkspaceError(
      'PROJECT_MANIFEST_INVALID',
      error.message,
      error,
    );
  }

  return new ProjectWorkspaceError(
    'PROJECT_CREATE_FAILED',
    'Unable to create the project workspace.',
    error,
  );
}

async function readManifest(projectDirectory: string): Promise<ProjectManifest> {
  const manifestPath = join(projectDirectory, 'project.json');
  await assertRegularFile(manifestPath, 'project.json');

  try {
    return parseProjectManifest(JSON.parse(await readFile(manifestPath, 'utf8')));
  } catch (error) {
    if (error instanceof ProjectWorkspaceError)
      throw error;

    throw new ProjectWorkspaceError(
      'PROJECT_MANIFEST_INVALID',
      'Project manifest contains invalid JSON or unsupported values.',
      error,
    );
  }
}

async function resolveDirectory(
  path: string,
  code: 'PROJECT_DIRECTORY_INVALID' | 'PROJECT_PARENT_INVALID',
  message: string,
): Promise<string> {
  if (typeof path !== 'string' || path.trim().length === 0)
    throw new ProjectWorkspaceError(code, message);

  try {
    const canonicalPath = await realpath(resolve(path));
    const entry = await lstat(canonicalPath);

    if (!entry.isDirectory())
      throw new Error('Entry is not a directory.');

    return canonicalPath;
  } catch (error) {
    if (error instanceof ProjectWorkspaceError)
      throw error;

    throw new ProjectWorkspaceError(code, message, error);
  }
}

async function validateProjectDirectory(
  projectDirectory: string,
): Promise<ProjectManifest> {
  const manifest = await readManifest(projectDirectory);

  await Promise.all(
    PROJECT_LAYOUT_DIRECTORIES.map(relativePath =>
      assertDirectory(join(projectDirectory, relativePath), relativePath),
    ),
  );

  return manifest;
}

function validateDisplayName(displayName: string): string {
  if (
    typeof displayName !== 'string'
    || displayName.length === 0
    || displayName !== displayName.trim()
    || Array.from(displayName).length > 120
  ) {
    throw new ProjectWorkspaceError(
      'PROJECT_NAME_INVALID',
      'Project display name must be a non-empty trimmed string of at most 120 characters.',
    );
  }

  return displayName;
}
