import type { ProjectContext } from '@voxweaver/contracts';
import { randomUUID } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';

const RECENT_PROJECTS_SCHEMA_VERSION = 1 as const;
const RECENT_PROJECTS_FILENAME = 'recent-projects.v1.json';

export type RecentProjectAvailability = 'available' | 'invalid' | 'missing';

export interface RecentProjectRecord {
  readonly displayName: string;
  readonly lastOpenedAt: string;
  readonly projectDirectory: string;
  readonly projectId: string;
}

export interface RecentProjectSummary {
  readonly availability: RecentProjectAvailability;
  readonly displayName: string;
  readonly lastOpenedAt: string;
  readonly projectId: string;
}

interface RecentProjectRegistry {
  readonly projects: readonly RecentProjectRecord[];
  readonly schemaVersion: typeof RECENT_PROJECTS_SCHEMA_VERSION;
}

export interface RecentProjectStoreOptions {
  readonly now?: () => Date;
}

export class NodeRecentProjectStore {
  readonly #now: () => Date;
  readonly #registryPath: string;
  readonly #userDataDirectory: string;
  #mutationTail: Promise<void> = Promise.resolve();

  constructor(
    userDataDirectory: string,
    options: RecentProjectStoreOptions = {},
  ) {
    if (!userDataDirectory)
      throw new TypeError('The user data directory is required.');

    this.#now = options.now ?? (() => new Date());
    this.#userDataDirectory = userDataDirectory;
    this.#registryPath = join(userDataDirectory, RECENT_PROJECTS_FILENAME);
  }

  async get(projectId: string): Promise<RecentProjectRecord | undefined> {
    return (await this.#readRegistry()).projects.find(
      project => project.projectId === projectId,
    );
  }

  async list(): Promise<readonly RecentProjectSummary[]> {
    const registry = await this.#readRegistry();
    return Promise.all(registry.projects.map(async project => ({
      availability: await inspectAvailability(project.projectDirectory),
      displayName: project.displayName,
      lastOpenedAt: project.lastOpenedAt,
      projectId: project.projectId,
    })));
  }

  async record(project: ProjectContext): Promise<void> {
    await this.#mutate(async () => {
      const registry = await this.#readRegistry();
      const record: RecentProjectRecord = {
        displayName: project.manifest.displayName,
        lastOpenedAt: this.#now().toISOString(),
        projectDirectory: project.projectDirectory,
        projectId: project.manifest.projectId,
      };
      const projects = [
        record,
        ...registry.projects.filter(item => item.projectId !== record.projectId),
      ];
      await this.#writeRegistry({
        projects,
        schemaVersion: RECENT_PROJECTS_SCHEMA_VERSION,
      });
    });
  }

  async remove(projectId: string): Promise<boolean> {
    return this.#mutate(async () => {
      const registry = await this.#readRegistry();
      const projects = registry.projects.filter(
        project => project.projectId !== projectId,
      );
      if (projects.length === registry.projects.length)
        return false;

      await this.#writeRegistry({
        projects,
        schemaVersion: RECENT_PROJECTS_SCHEMA_VERSION,
      });
      return true;
    });
  }

  async #mutate<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#mutationTail;
    let release: (() => void) | undefined;
    this.#mutationTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release?.();
    }
  }

  async #readRegistry(): Promise<RecentProjectRegistry> {
    let contents: string;
    try {
      contents = await readFile(this.#registryPath, 'utf8');
    } catch (error) {
      if (isFileSystemError(error, 'ENOENT'))
        return createEmptyRegistry();
      return createEmptyRegistry();
    }

    try {
      const value: unknown = JSON.parse(contents);
      return parseRegistry(value);
    } catch {
      return createEmptyRegistry();
    }
  }

  async #writeRegistry(registry: RecentProjectRegistry): Promise<void> {
    await mkdir(this.#userDataDirectory, { recursive: true, mode: 0o700 });
    const temporaryPath = join(
      this.#userDataDirectory,
      `.${RECENT_PROJECTS_FILENAME}.${randomUUID()}.tmp`,
    );

    try {
      await writeFile(
        temporaryPath,
        `${JSON.stringify(registry, undefined, 2)}\n`,
        { encoding: 'utf8', flag: 'wx', mode: 0o600 },
      );
      await rename(temporaryPath, this.#registryPath);
      await chmod(this.#registryPath, 0o600);
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }
}

function createEmptyRegistry(): RecentProjectRegistry {
  return {
    projects: [],
    schemaVersion: RECENT_PROJECTS_SCHEMA_VERSION,
  };
}

async function inspectAvailability(
  projectDirectory: string,
): Promise<RecentProjectAvailability> {
  try {
    const entry = await lstat(projectDirectory);
    if (entry.isSymbolicLink() || !entry.isDirectory())
      return 'invalid';
    return 'available';
  } catch (error) {
    return isFileSystemError(error, 'ENOENT') ? 'missing' : 'invalid';
  }
}

function parseRegistry(value: unknown): RecentProjectRegistry {
  if (!isRecord(value) || value.schemaVersion !== RECENT_PROJECTS_SCHEMA_VERSION)
    throw new TypeError('Recent project registry schema is invalid.');
  if (!Array.isArray(value.projects))
    throw new TypeError('Recent project registry projects are invalid.');

  const seenProjectIds = new Set<string>();
  const projects = value.projects.map((project) => {
    if (!isRecord(project))
      throw new TypeError('Recent project record is invalid.');
    const parsed: RecentProjectRecord = {
      displayName: requireNonEmptyString(project.displayName),
      lastOpenedAt: requireDateTime(project.lastOpenedAt),
      projectDirectory: requireNonEmptyString(project.projectDirectory),
      projectId: requireNonEmptyString(project.projectId),
    };
    if (seenProjectIds.has(parsed.projectId))
      throw new TypeError('Recent project registry contains duplicate project IDs.');
    seenProjectIds.add(parsed.projectId);
    return parsed;
  });

  return {
    projects,
    schemaVersion: RECENT_PROJECTS_SCHEMA_VERSION,
  };
}

function requireDateTime(value: unknown): string {
  const dateTime = requireNonEmptyString(value);
  if (Number.isNaN(Date.parse(dateTime)))
    throw new TypeError('Recent project timestamp is invalid.');
  return dateTime;
}

function requireNonEmptyString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0)
    throw new TypeError('Recent project string is invalid.');
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFileSystemError(
  error: unknown,
  code: string,
): error is NodeJS.ErrnoException {
  return isRecord(error) && error.code === code;
}
