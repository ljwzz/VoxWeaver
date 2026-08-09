import type {
  ProjectAccessMode,
  ProjectContext,
  ProjectManifest,
  ProjectWriteLock,
} from '@voxweaver/contracts';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { constants as fileSystemConstants } from 'node:fs';
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rename,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { hostname as getHostname } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import {
  parseProjectManifest,
  parseProjectWriteLock,
  PROJECT_LAYOUT_VERSION,
  PROJECT_MANIFEST_SCHEMA_VERSION,
  PROJECT_WRITE_LOCK_SCHEMA_VERSION,
  ProjectManifestValidationError,
} from '@voxweaver/contracts';

import {
  ensureProjectState,
  initializeProjectState,
} from './nodeProjectStateStore.js';
import { ProjectStateError } from './projectStateError.js';
import { PROJECT_STATE_SCHEMA_VERSION } from './projectStateSchema.js';
import { ProjectWorkspaceError } from './projectWorkspaceError.js';

export interface CreateProjectWorkspaceCommand {
  displayName: string;
  parentDirectory: string;
}

export interface OpenProjectWorkspaceCommand {
  accessMode?: ProjectAccessMode;
  confirmMigration?: boolean;
  projectDirectory: string;
  recoverStaleWriteLock?: boolean;
}

export interface InspectProjectWorkspaceCommand {
  projectDirectory: string;
}

export type ProjectWorkspaceWriteLockStatus
  = | 'available'
    | 'locked'
    | 'recoverable';

export interface ProjectWorkspaceWriteLockInspection {
  readonly recoveryAvailable: boolean;
  readonly status: ProjectWorkspaceWriteLockStatus;
}

export interface ProjectWorkspaceInspectionPreview {
  readonly displayName: string;
  readonly layoutVersion: number;
  readonly migrationRequired: boolean;
  readonly projectId: string;
  readonly writeLock: ProjectWorkspaceWriteLockInspection;
}

interface InspectedProjectWorkspace {
  readonly manifest: ProjectManifest;
  readonly preview: ProjectWorkspaceInspectionPreview;
  readonly projectDirectory: string;
}

export interface NodeProjectWorkspaceOptions {
  /**
   * Deterministic test barrier after removing an owned write lock.
   * @internal
   */
  afterWriteLockUnlink?: (paths: {
    lockPath: string;
    projectSessionId: string;
  }) => Promise<void> | void;
  /**
   * Deterministic test barrier before removing an owned write lock.
   * @internal
   */
  beforeWriteLockRelease?: (paths: {
    lockPath: string;
    projectSessionId: string;
  }) => Promise<void> | void;
  /**
   * Deterministic test barrier before publishing a complete lock.
   * @internal
   */
  beforeWriteLockPublish?: (paths: {
    lockPath: string;
    temporaryPath: string;
  }) => Promise<void> | void;
  generateProjectId?: () => string;
  generateProjectSessionId?: () => string;
  hostname?: string | (() => string);
  isProcessAlive?: (processId: number) => boolean;
  now?: () => Date;
  processId?: number | (() => number);
}

const PROJECT_ID_PATTERN
  = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const PROJECT_WRITE_LOCK_RELATIVE_PATH = 'state/locks/project-write.lock';
const PROJECT_WRITE_MUTATION_RELATIVE_PATH
  = 'state/locks/project-write.mutation';
const PROJECT_WRITE_LOCK_MAX_BYTES = 16 * 1024;

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

const PROJECT_LAYOUT_ROOT_DIRECTORIES = Array.from(
  new Set(
    PROJECT_LAYOUT_DIRECTORIES.map(relativePath => relativePath.split('/')[0]),
  ),
);

export class NodeProjectWorkspace {
  readonly #afterWriteLockUnlink: NonNullable<
    NodeProjectWorkspaceOptions['afterWriteLockUnlink']
  > | undefined;

  readonly #beforeWriteLockRelease: NonNullable<
    NodeProjectWorkspaceOptions['beforeWriteLockRelease']
  > | undefined;

  readonly #beforeWriteLockPublish: NonNullable<
    NodeProjectWorkspaceOptions['beforeWriteLockPublish']
  > | undefined;

  readonly #generateProjectId: () => string;
  readonly #generateProjectSessionId: () => string;
  readonly #hostname: () => string;
  readonly #isProcessAlive: (processId: number) => boolean;
  readonly #mutationTails = new Map<string, Promise<void>>();
  readonly #now: () => Date;
  readonly #ownedMutationGuards = new Map<string, string>();
  readonly #ongoingWriteReleases = new Map<
    string,
    { projectSessionId: string; promise: Promise<void> }
  >();

  readonly #ownedWriteSessions = new Map<string, string>();
  readonly #processId: () => number;

  constructor(options: NodeProjectWorkspaceOptions = {}) {
    this.#afterWriteLockUnlink = options.afterWriteLockUnlink;
    this.#beforeWriteLockRelease = options.beforeWriteLockRelease;
    this.#beforeWriteLockPublish = options.beforeWriteLockPublish;
    this.#generateProjectId = options.generateProjectId ?? randomUUID;
    this.#generateProjectSessionId
      = options.generateProjectSessionId ?? randomUUID;
    this.#hostname = normalizeValueProvider(options.hostname, getHostname);
    this.#isProcessAlive = options.isProcessAlive ?? isProcessAlive;
    this.#now = options.now ?? (() => new Date());
    this.#processId = normalizeValueProvider(options.processId, () => process.pid);
  }

  closeProject(project: ProjectContext): Promise<void> {
    const ongoingRelease = this.#ongoingWriteReleases.get(
      project.projectDirectory,
    );

    if (ongoingRelease?.projectSessionId === project.projectSessionId)
      return ongoingRelease.promise;

    const ownedProjectSessionId = this.#ownedWriteSessions.get(
      project.projectDirectory,
    );

    if (
      project.accessMode !== 'read-write'
      || ownedProjectSessionId !== project.projectSessionId
    ) {
      return Promise.resolve();
    }

    const releasePromise = this.#releaseOwnedWriteLock(project).finally(() => {
      const currentRelease = this.#ongoingWriteReleases.get(
        project.projectDirectory,
      );
      if (currentRelease?.promise === releasePromise)
        this.#ongoingWriteReleases.delete(project.projectDirectory);
    });
    this.#ongoingWriteReleases.set(project.projectDirectory, {
      projectSessionId: project.projectSessionId,
      promise: releasePromise,
    });

    return releasePromise;
  }

  async #releaseOwnedWriteLock(project: ProjectContext): Promise<void> {
    try {
      await this.#withWriteMutation(
        project.projectDirectory,
        project.manifest,
        project.projectSessionId,
        async () => {
          const lockPath = join(
            project.projectDirectory,
            PROJECT_WRITE_LOCK_RELATIVE_PATH,
          );
          const snapshot = await readProjectWriteLock(lockPath, 'release');

          if (snapshot === undefined) {
            this.#ownedWriteSessions.delete(project.projectDirectory);
            return;
          }

          assertWriteLockProject(snapshot.lock, project.manifest);

          if (snapshot.lock.projectSessionId !== project.projectSessionId) {
            this.#ownedWriteSessions.delete(project.projectDirectory);
            return;
          }

          await this.#beforeWriteLockRelease?.({
            lockPath,
            projectSessionId: project.projectSessionId,
          });
          await unlinkUnchangedLock(lockPath, snapshot.identity);
          try {
            await this.#afterWriteLockUnlink?.({
              lockPath,
              projectSessionId: project.projectSessionId,
            });
          } catch {
            // The lock is already absent. An internal observation hook cannot
            // turn a completed release into a rejection.
          }
          this.#ownedWriteSessions.delete(project.projectDirectory);
        },
      );
    } catch (error) {
      if (
        error instanceof LockOwnershipLostError
        || (
          error instanceof ProjectWorkspaceError
          && error.code === 'PROJECT_WRITE_LOCK_INVALID'
        )
      ) {
        this.#ownedWriteSessions.delete(project.projectDirectory);
        return;
      }

      throw error;
    }
  }

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

    const projectSessionId = validateProjectSessionId(
      this.#generateProjectSessionId(),
    );

    await assertTargetDoesNotExist(projectDirectory);

    const temporaryDirectory = await mkdtemp(
      join(parentDirectory, `.${directoryName}.creating-`),
    );
    let reservationCreated = false;
    let reservedDirectoryIdentity: FileIdentity | undefined;
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

      await initializeProjectState(temporaryDirectory, manifest, {
        now: () => new Date(timestamp),
      });

      await validateProjectDirectory(temporaryDirectory);
      reservedDirectoryIdentity = await reserveProjectDirectory(projectDirectory);
      reservationCreated = true;

      for (const rootDirectory of PROJECT_LAYOUT_ROOT_DIRECTORIES) {
        await rename(
          join(temporaryDirectory, rootDirectory),
          join(projectDirectory, rootDirectory),
        );
      }

      await this.#acquireWriteLock(
        projectDirectory,
        manifest,
        projectSessionId,
      );

      // The manifest is the openability marker: move it only after the complete
      // physical layout and its initial write lock are present in the
      // exclusively reserved target.
      await rename(
        join(temporaryDirectory, 'project.json'),
        join(projectDirectory, 'project.json'),
      );
      await rm(temporaryDirectory, { force: true, recursive: true });
      committed = true;

      return {
        accessMode: 'read-write',
        manifest,
        projectDirectory,
        projectSessionId,
      };
    } catch (error) {
      this.#ownedWriteSessions.delete(projectDirectory);

      if (
        !committed
        && reservationCreated
        && reservedDirectoryIdentity !== undefined
      ) {
        await preserveReservedProjectDirectory(
          projectDirectory,
          temporaryDirectory,
          reservedDirectoryIdentity,
        );
      }

      if (!committed)
        await rm(temporaryDirectory, { force: true, recursive: true });

      throw normalizeCreateError(error);
    }
  }

  async openProject(
    command: OpenProjectWorkspaceCommand,
  ): Promise<ProjectContext> {
    const accessMode = validateAccessMode(command.accessMode ?? 'read-write');
    const inspected = await this.#inspectProjectWorkspace(command);
    if (
      inspected.preview.migrationRequired
      && command.confirmMigration !== true
    ) {
      throw new ProjectWorkspaceError(
        'PROJECT_MIGRATION_CONFIRMATION_REQUIRED',
        'Project migration requires explicit confirmation.',
      );
    }

    const projectDirectory = inspected.projectDirectory;
    let manifest = inspected.manifest;
    const projectSessionId = validateProjectSessionId(
      this.#generateProjectSessionId(),
    );

    if (accessMode === 'read-write') {
      await this.#acquireWriteLock(
        projectDirectory,
        manifest,
        projectSessionId,
        command.recoverStaleWriteLock === true,
      );
      try {
        manifest = await prepareProjectForOpen({
          accessMode,
          manifest,
          now: this.#now,
          projectDirectory,
        });
      } catch (error) {
        await this.closeProject({
          accessMode,
          manifest,
          projectDirectory,
          projectSessionId,
        });
        throw error;
      }
    } else {
      manifest = await prepareProjectForOpen({
        accessMode,
        manifest,
        now: this.#now,
        projectDirectory,
      });
    }

    return {
      accessMode,
      manifest,
      projectDirectory,
      projectSessionId,
    };
  }

  async inspectProject(
    command: InspectProjectWorkspaceCommand,
  ): Promise<ProjectWorkspaceInspectionPreview> {
    return (await this.#inspectProjectWorkspace(command)).preview;
  }

  async #inspectProjectWorkspace(
    command: InspectProjectWorkspaceCommand,
  ): Promise<InspectedProjectWorkspace> {
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

    const [migrationRequired, writeLock] = await Promise.all([
      inspectProjectMigrationRequired(projectDirectory, manifest),
      this.#inspectProjectWriteLock(projectDirectory, manifest),
    ]);

    const preview = Object.freeze({
      displayName: manifest.displayName,
      layoutVersion: manifest.layoutVersion,
      migrationRequired,
      projectId: manifest.projectId,
      writeLock: Object.freeze(writeLock),
    });
    return { manifest, preview, projectDirectory };
  }

  async #inspectProjectWriteLock(
    projectDirectory: string,
    manifest: ProjectManifest,
  ): Promise<ProjectWorkspaceWriteLockInspection> {
    let snapshots: (ProjectWriteLockSnapshot | undefined)[];
    try {
      snapshots = await Promise.all([
        readProjectWriteLock(
          join(projectDirectory, PROJECT_WRITE_LOCK_RELATIVE_PATH),
          'acquire',
        ),
        readProjectWriteLock(
          join(projectDirectory, PROJECT_WRITE_MUTATION_RELATIVE_PATH),
          'acquire',
        ),
      ]);
    } catch (error) {
      if (
        error instanceof ProjectWorkspaceError
        && error.code === 'PROJECT_WRITE_LOCK_INVALID'
      ) {
        return { recoveryAvailable: false, status: 'locked' };
      }
      throw error;
    }
    const presentSnapshots = snapshots.filter(
      (snapshot): snapshot is ProjectWriteLockSnapshot => snapshot !== undefined,
    );

    try {
      for (const snapshot of presentSnapshots)
        assertWriteLockProject(snapshot.lock, manifest);
    } catch (error) {
      if (
        error instanceof ProjectWorkspaceError
        && error.code === 'PROJECT_WRITE_LOCK_INVALID'
      ) {
        return { recoveryAvailable: false, status: 'locked' };
      }
      throw error;
    }

    if (presentSnapshots.length === 0) {
      return { recoveryAvailable: false, status: 'available' };
    }

    const recoveryAvailable = presentSnapshots.every(snapshot =>
      this.#isStaleLocalOwner(snapshot.lock),
    );
    return recoveryAvailable
      ? { recoveryAvailable: true, status: 'recoverable' }
      : { recoveryAvailable: false, status: 'locked' };
  }

  async #acquireWriteLock(
    projectDirectory: string,
    manifest: ProjectManifest,
    projectSessionId: string,
    recoverStaleWriteLock = false,
  ): Promise<void> {
    if (this.#ongoingWriteReleases.has(projectDirectory))
      throw createProjectLockedError();

    const lock: ProjectWriteLock = {
      schemaVersion: PROJECT_WRITE_LOCK_SCHEMA_VERSION,
      projectId: manifest.projectId,
      projectSessionId,
      processId: this.#processId(),
      hostname: this.#hostname(),
      acquiredAt: this.#now().toISOString(),
    };
    const lockPath = join(projectDirectory, PROJECT_WRITE_LOCK_RELATIVE_PATH);

    await this.#withWriteMutation(
      projectDirectory,
      manifest,
      projectSessionId,
      async () => {
        try {
          await createExclusiveFile(
            lockPath,
            serializeLock(lock),
            projectSessionId,
            this.#beforeWriteLockPublish,
          );
        } catch (error) {
          if (!isFileSystemError(error, 'EEXIST'))
            throw normalizeLockOperationError(error, 'acquire');

          if (!recoverStaleWriteLock)
            throw createProjectLockedError();

          await this.#replaceStaleWriteLock(
            lockPath,
            manifest,
            lock,
            projectSessionId,
          );
        }
        this.#ownedWriteSessions.set(projectDirectory, projectSessionId);
      },
    );
  }

  async #replaceStaleWriteLock(
    lockPath: string,
    manifest: ProjectManifest,
    replacement: ProjectWriteLock,
    projectSessionId: string,
  ): Promise<void> {
    const snapshot = await readProjectWriteLock(lockPath, 'acquire');
    if (!snapshot)
      return this.#publishReplacementLock(lockPath, replacement, projectSessionId);
    assertWriteLockProject(snapshot.lock, manifest);
    if (!this.#isStaleLocalOwner(snapshot.lock))
      throw createProjectLockedError();

    const backupPath = join(
      dirname(dirname(lockPath)),
      'backups',
      `stale-write-lock-${snapshot.lock.projectSessionId}-${randomUUID()}.json`,
    );
    await writeFile(backupPath, serializeLock(snapshot.lock), {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    await unlinkUnchangedLock(lockPath, snapshot.identity);
    await this.#publishReplacementLock(lockPath, replacement, projectSessionId);
  }

  async #publishReplacementLock(
    lockPath: string,
    replacement: ProjectWriteLock,
    projectSessionId: string,
  ): Promise<void> {
    try {
      await createExclusiveFile(
        lockPath,
        serializeLock(replacement),
        projectSessionId,
        this.#beforeWriteLockPublish,
      );
    } catch (error) {
      if (isFileSystemError(error, 'EEXIST'))
        throw createProjectLockedError();
      throw normalizeLockOperationError(error, 'acquire');
    }
  }

  #isStaleLocalOwner(lock: ProjectWriteLock): boolean {
    return lock.hostname === this.#hostname()
      && !this.#isProcessAlive(lock.processId);
  }

  async #withWriteMutation<T>(
    projectDirectory: string,
    manifest: ProjectManifest,
    projectSessionId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.#mutationTails.get(projectDirectory)
      ?? Promise.resolve();
    let releaseTurn!: () => void;
    const turn = new Promise<void>((resolveTurn) => {
      releaseTurn = resolveTurn;
    });
    const tail = previous.catch(() => {}).then(() => turn);
    this.#mutationTails.set(projectDirectory, tail);
    await previous.catch(() => {});

    try {
      await this.#acquireMutationGuard(
        projectDirectory,
        manifest,
        projectSessionId,
      );
      return await operation();
    } finally {
      await this.#releaseMutationGuardBestEffort(
        projectDirectory,
        manifest,
        projectSessionId,
      );
      releaseTurn();
      if (this.#mutationTails.get(projectDirectory) === tail)
        this.#mutationTails.delete(projectDirectory);
    }
  }

  async #acquireMutationGuard(
    projectDirectory: string,
    manifest: ProjectManifest,
    projectSessionId: string,
  ): Promise<void> {
    const guardPath = join(
      projectDirectory,
      PROJECT_WRITE_MUTATION_RELATIVE_PATH,
    );
    const ownedSession = this.#ownedMutationGuards.get(projectDirectory);
    if (ownedSession === projectSessionId) {
      const owned = await readProjectWriteLock(guardPath, 'acquire');
      if (
        owned
        && owned.lock.projectId === manifest.projectId
        && owned.lock.projectSessionId === projectSessionId
      ) {
        await unlinkUnchangedLock(guardPath, owned.identity);
      }
      this.#ownedMutationGuards.delete(projectDirectory);
    }

    const guard: ProjectWriteLock = {
      schemaVersion: PROJECT_WRITE_LOCK_SCHEMA_VERSION,
      projectId: manifest.projectId,
      projectSessionId,
      processId: this.#processId(),
      hostname: this.#hostname(),
      acquiredAt: this.#now().toISOString(),
    };
    try {
      await createExclusiveFile(
        guardPath,
        serializeLock(guard),
        projectSessionId,
      );
    } catch (error) {
      if (!isFileSystemError(error, 'EEXIST'))
        throw normalizeLockOperationError(error, 'acquire');

      const existing = await readProjectWriteLock(guardPath, 'acquire');
      if (!existing || !this.#isStaleLocalOwner(existing.lock))
        throw createProjectLockedError();
      assertWriteLockProject(existing.lock, manifest);
      await unlinkUnchangedLock(guardPath, existing.identity);
      try {
        await createExclusiveFile(
          guardPath,
          serializeLock(guard),
          projectSessionId,
        );
      } catch (retryError) {
        if (isFileSystemError(retryError, 'EEXIST'))
          throw createProjectLockedError();
        throw normalizeLockOperationError(retryError, 'acquire');
      }
    }
    this.#ownedMutationGuards.set(projectDirectory, projectSessionId);
  }

  async #releaseMutationGuardBestEffort(
    projectDirectory: string,
    manifest: ProjectManifest,
    projectSessionId: string,
  ): Promise<void> {
    if (this.#ownedMutationGuards.get(projectDirectory) !== projectSessionId)
      return;
    const guardPath = join(
      projectDirectory,
      PROJECT_WRITE_MUTATION_RELATIVE_PATH,
    );
    try {
      const snapshot = await readProjectWriteLock(guardPath, 'release');
      if (!snapshot) {
        this.#ownedMutationGuards.delete(projectDirectory);
        return;
      }
      assertWriteLockProject(snapshot.lock, manifest);
      if (snapshot.lock.projectSessionId !== projectSessionId) {
        this.#ownedMutationGuards.delete(projectDirectory);
        return;
      }
      await unlinkUnchangedLock(guardPath, snapshot.identity);
      this.#ownedMutationGuards.delete(projectDirectory);
    } catch (error) {
      if (
        error instanceof LockOwnershipLostError
        || (
          error instanceof ProjectWorkspaceError
          && error.code === 'PROJECT_WRITE_LOCK_INVALID'
        )
      ) {
        this.#ownedMutationGuards.delete(projectDirectory);
      }
    }
  }
}

interface PrepareProjectForOpenOptions {
  accessMode: ProjectAccessMode;
  manifest: ProjectManifest;
  now: () => Date;
  projectDirectory: string;
}

async function inspectProjectMigrationRequired(
  projectDirectory: string,
  manifest: ProjectManifest,
): Promise<boolean> {
  if (manifest.layoutVersion !== PROJECT_LAYOUT_VERSION)
    return true;

  const databasePath = join(projectDirectory, 'state/project.sqlite');
  let entry;
  try {
    entry = await lstat(databasePath);
  } catch (error) {
    if (isFileSystemError(error, 'ENOENT')) {
      throw new ProjectStateError(
        'PROJECT_STATE_INVALID',
        'The project state database is missing or invalid.',
        error,
      );
    }
    throw error;
  }

  if (!entry.isFile() || entry.isSymbolicLink()) {
    throw new ProjectStateError(
      'PROJECT_STATE_INVALID',
      'The project state database is missing or invalid.',
    );
  }

  const schemaVersion = await readProjectStateHeaderVersion(databasePath);
  if (schemaVersion > PROJECT_STATE_SCHEMA_VERSION) {
    throw new ProjectStateError(
      'PROJECT_STATE_SCHEMA_TOO_NEW',
      `Project state schema ${schemaVersion} is newer than supported schema ${PROJECT_STATE_SCHEMA_VERSION}.`,
    );
  }

  return schemaVersion < PROJECT_STATE_SCHEMA_VERSION;
}

const SQLITE_HEADER_MAGIC = 'SQLite format 3\0';
const SQLITE_USER_VERSION_OFFSET = 60;

// Opening the source with SQLite's read-only mode can still create WAL
// shared-memory sidecars. Reading the header is intentionally conservative;
// openProject performs the full state validation after confirmation and lock
// acquisition.
async function readProjectStateHeaderVersion(
  databasePath: string,
): Promise<number> {
  let handle;
  try {
    handle = await open(
      databasePath,
      fileSystemConstants.O_RDONLY | fileSystemConstants.O_NOFOLLOW,
    );
  } catch (error) {
    throw new ProjectStateError(
      'PROJECT_STATE_INVALID',
      'The project state database is missing or invalid.',
      error,
    );
  }

  try {
    const header = Buffer.alloc(100);
    let read = 0;
    while (read < header.length) {
      const { bytesRead } = await handle.read(
        header,
        read,
        header.length - read,
      );
      if (bytesRead === 0)
        break;
      read += bytesRead;
    }

    if (
      read !== header.length
      || header.subarray(0, 16).toString('ascii') !== SQLITE_HEADER_MAGIC
    ) {
      throw new ProjectStateError(
        'PROJECT_STATE_INVALID',
        'The project state database is not a valid SQLite database.',
      );
    }

    return header.readUInt32BE(SQLITE_USER_VERSION_OFFSET);
  } finally {
    await handle.close();
  }
}

async function prepareProjectForOpen(
  options: PrepareProjectForOpenOptions,
): Promise<ProjectManifest> {
  if (options.manifest.layoutVersion === PROJECT_LAYOUT_VERSION) {
    await ensureProjectState({
      accessMode: options.accessMode,
      projectDirectory: options.projectDirectory,
      projectId: options.manifest.projectId,
      now: options.now,
    });
    return options.manifest;
  }

  if (options.accessMode === 'read-only') {
    throw new ProjectWorkspaceError(
      'PROJECT_MIGRATION_REQUIRED',
      'The project layout must be migrated by a write session before read-only use.',
    );
  }

  const timestamp = options.now().toISOString();
  const backupPath = join(
    options.projectDirectory,
    'state/backups',
    `project-manifest-layout-v${options.manifest.layoutVersion}-${randomUUID()}.json`,
  );
  const databasePath = join(options.projectDirectory, 'state/project.sqlite');

  try {
    await writeFile(
      backupPath,
      await readFile(join(options.projectDirectory, 'project.json'), 'utf8'),
      { encoding: 'utf8', flag: 'wx', mode: 0o600 },
    );

    try {
      const databaseEntry = await lstat(databasePath);
      if (!databaseEntry.isFile() || databaseEntry.isSymbolicLink())
        throw new Error('Legacy state path is not a physical file.');
      await ensureProjectState({
        accessMode: 'read-write',
        projectDirectory: options.projectDirectory,
        projectId: options.manifest.projectId,
        now: options.now,
      });
    } catch (error) {
      if (isFileSystemError(error, 'ENOENT')) {
        await initializeProjectState(options.projectDirectory, options.manifest, {
          now: () => new Date(timestamp),
        });
      } else {
        throw error;
      }
    }

    const migratedManifest: ProjectManifest = {
      ...options.manifest,
      layoutVersion: PROJECT_LAYOUT_VERSION,
      updatedAt: timestamp,
    };
    await replaceProjectManifest(options.projectDirectory, migratedManifest);
    return parseProjectManifest(migratedManifest);
  } catch (error) {
    if (error instanceof ProjectWorkspaceError)
      throw error;
    throw new ProjectWorkspaceError(
      'PROJECT_MIGRATION_FAILED',
      'Unable to migrate the project layout.',
      error,
    );
  }
}

async function replaceProjectManifest(
  projectDirectory: string,
  manifest: ProjectManifest,
): Promise<void> {
  const manifestPath = join(projectDirectory, 'project.json');
  const temporaryPath = join(
    projectDirectory,
    `.project.json.migrating-${randomUUID()}.tmp`,
  );
  const handle = await open(temporaryPath, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(manifest, undefined, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporaryPath, manifestPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

type LockOperation = 'acquire' | 'release';

class LockOwnershipLostError extends Error {}

interface FileIdentity {
  device: number;
  inode: number;
}

interface ProjectWriteLockSnapshot {
  identity: FileIdentity;
  lock: ProjectWriteLock;
}

function assertWriteLockProject(
  lock: ProjectWriteLock,
  manifest: ProjectManifest,
): void {
  if (lock.projectId !== manifest.projectId) {
    throw new ProjectWorkspaceError(
      'PROJECT_WRITE_LOCK_INVALID',
      'The project write lock belongs to a different project.',
    );
  }
}

async function assertPhysicalLockDirectory(
  lockPath: string,
  operation: LockOperation,
): Promise<void> {
  const lockDirectory = dirname(lockPath);

  try {
    const entry = await lstat(lockDirectory);
    const canonicalDirectory = await realpath(lockDirectory);

    if (
      !entry.isDirectory()
      || entry.isSymbolicLink()
      || canonicalDirectory !== resolve(lockDirectory)
    ) {
      throw new ProjectWorkspaceError(
        'PROJECT_WRITE_LOCK_INVALID',
        'The project write lock directory must be a physical directory inside the project.',
      );
    }
  } catch (error) {
    if (error instanceof ProjectWorkspaceError)
      throw error;

    throw normalizeLockOperationError(error, operation);
  }
}

async function createExclusiveFile(
  path: string,
  contents: string,
  temporarySuffix: string,
  beforePublish?: NonNullable<
    NodeProjectWorkspaceOptions['beforeWriteLockPublish']
  >,
): Promise<void> {
  await assertPhysicalLockDirectory(path, 'acquire');
  const temporaryPath = join(
    dirname(path),
    `.${basename(path)}.${temporarySuffix}-${randomUUID()}.tmp`,
  );
  let handle;

  try {
    handle = await open(temporaryPath, 'wx', 0o600);
  } catch (error) {
    throw normalizeLockOperationError(error, 'acquire');
  }

  let identity: FileIdentity | undefined;

  try {
    identity = toFileIdentity(await handle.stat());
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
    await handle.close();
  } catch (error) {
    try {
      await handle.close();
    } catch {
      // The original acquisition error is more useful to the caller.
    }

    if (identity !== undefined)
      await unlinkMatchingFileBestEffort(temporaryPath, identity);

    throw error;
  }

  try {
    await beforePublish?.({ lockPath: path, temporaryPath });
    await link(temporaryPath, path);
  } finally {
    await unlinkMatchingFileBestEffort(temporaryPath, identity);
  }
}

function createProjectLockedError(): ProjectWorkspaceError {
  return new ProjectWorkspaceError(
    'PROJECT_WRITE_LOCKED',
    'The project already has an active write session.',
  );
}

function normalizeLockOperationError(
  error: unknown,
  operation: LockOperation,
): ProjectWorkspaceError {
  if (error instanceof ProjectWorkspaceError)
    return error;

  if (operation === 'acquire') {
    return new ProjectWorkspaceError(
      'PROJECT_WRITE_LOCK_ACQUIRE_FAILED',
      'Unable to acquire the project write lock.',
      error,
    );
  }

  return new ProjectWorkspaceError(
    'PROJECT_WRITE_LOCK_RELEASE_FAILED',
    'Unable to release the project write lock.',
    error,
  );
}

function normalizeValueProvider<T>(
  value: T | (() => T) | undefined,
  fallback: () => T,
): () => T {
  if (typeof value === 'function')
    return value as () => T;

  if (value === undefined)
    return fallback;

  return () => value;
}

async function preserveReservedProjectDirectory(
  projectDirectory: string,
  temporaryDirectory: string,
  reservedDirectoryIdentity: FileIdentity,
): Promise<void> {
  try {
    const currentEntry = await lstat(projectDirectory);
    if (
      !currentEntry.isDirectory()
      || currentEntry.isSymbolicLink()
      || !hasFileIdentity(currentEntry, reservedDirectoryIdentity)
    ) {
      return;
    }

    const recoveryContainer = await mkdtemp(`${temporaryDirectory}.reserved-`);
    await rename(projectDirectory, join(recoveryContainer, 'project'));
  } catch {
    // The reserved target may contain competing data. If recovery renaming is
    // unavailable, leave it in place instead of deleting or merging it.
  }
}

async function readProjectWriteLock(
  lockPath: string,
  operation: LockOperation,
): Promise<ProjectWriteLockSnapshot | undefined> {
  await assertPhysicalLockDirectory(lockPath, operation);

  let entry;
  try {
    entry = await lstat(lockPath);
  } catch (error) {
    if (isFileSystemError(error, 'ENOENT'))
      return undefined;

    throw normalizeLockOperationError(error, operation);
  }

  if (!entry.isFile() || entry.isSymbolicLink()) {
    throw new ProjectWorkspaceError(
      'PROJECT_WRITE_LOCK_INVALID',
      'The project write lock must be a physical regular file.',
    );
  }

  let handle;
  try {
    handle = await open(
      lockPath,
      fileSystemConstants.O_RDONLY | fileSystemConstants.O_NOFOLLOW,
    );
  } catch (error) {
    if (isFileSystemError(error, 'ENOENT'))
      return undefined;

    if (isFileSystemError(error, 'ELOOP')) {
      throw new ProjectWorkspaceError(
        'PROJECT_WRITE_LOCK_INVALID',
        'The project write lock must not be a symbolic link.',
        error,
      );
    }

    throw normalizeLockOperationError(error, operation);
  }

  let contents: string;
  let identity: FileIdentity;
  try {
    const openedEntry = await handle.stat();
    const currentEntry = await lstat(lockPath);

    if (
      !openedEntry.isFile()
      || openedEntry.size > PROJECT_WRITE_LOCK_MAX_BYTES
      || !currentEntry.isFile()
      || currentEntry.isSymbolicLink()
      || !hasFileIdentity(currentEntry, toFileIdentity(openedEntry))
    ) {
      throw new ProjectWorkspaceError(
        'PROJECT_WRITE_LOCK_INVALID',
        'The project write lock changed while it was being opened.',
      );
    }

    identity = toFileIdentity(openedEntry);
    const buffer = Buffer.alloc(PROJECT_WRITE_LOCK_MAX_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > PROJECT_WRITE_LOCK_MAX_BYTES) {
      throw new ProjectWorkspaceError(
        'PROJECT_WRITE_LOCK_INVALID',
        'The project write lock exceeds the maximum supported size.',
      );
    }
    contents = buffer.subarray(0, bytesRead).toString('utf8');
  } catch (error) {
    if (error instanceof ProjectWorkspaceError)
      throw error;

    if (isFileSystemError(error, 'ENOENT'))
      return undefined;

    throw normalizeLockOperationError(error, operation);
  } finally {
    try {
      await handle.close();
    } catch {
      // Reading and ownership checks already determine whether removal is safe.
    }
  }

  try {
    return {
      identity,
      lock: parseProjectWriteLock(JSON.parse(contents)),
    };
  } catch (error) {
    throw new ProjectWorkspaceError(
      'PROJECT_WRITE_LOCK_INVALID',
      'The project write lock contains invalid JSON or unsupported values.',
      error,
    );
  }
}

function validateAccessMode(accessMode: unknown): ProjectAccessMode {
  if (accessMode !== 'read-write' && accessMode !== 'read-only') {
    throw new ProjectWorkspaceError(
      'PROJECT_ACCESS_MODE_INVALID',
      'Project access mode must be either "read-write" or "read-only".',
    );
  }

  return accessMode;
}

function validateProjectSessionId(projectSessionId: unknown): string {
  if (
    typeof projectSessionId !== 'string'
    || !PROJECT_ID_PATTERN.test(projectSessionId)
  ) {
    throw new ProjectWorkspaceError(
      'PROJECT_SESSION_ID_INVALID',
      'Generated project session ID must be a UUID v4 string.',
    );
  }

  return projectSessionId;
}

function serializeLock(lock: ProjectWriteLock): string {
  return `${JSON.stringify(parseProjectWriteLock(lock), undefined, 2)}\n`;
}

function hasFileIdentity(
  entry: { dev: number; ino: number },
  identity: FileIdentity,
): boolean {
  return entry.dev === identity.device && entry.ino === identity.inode;
}

function toFileIdentity(entry: { dev: number; ino: number }): FileIdentity {
  return { device: entry.dev, inode: entry.ino };
}

async function unlinkMatchingFileBestEffort(
  path: string,
  identity: FileIdentity,
): Promise<void> {
  try {
    const entry = await lstat(path);
    if (
      entry.isFile()
      && !entry.isSymbolicLink()
      && hasFileIdentity(entry, identity)
    ) {
      await unlink(path);
    }
  } catch {
    // Cleanup must not hide the original write or sync error.
  }
}

async function unlinkUnchangedLock(
  lockPath: string,
  identity: FileIdentity,
): Promise<void> {
  await assertPhysicalLockDirectory(lockPath, 'release');

  let entry;
  try {
    entry = await lstat(lockPath);
  } catch (error) {
    if (isFileSystemError(error, 'ENOENT'))
      throw new LockOwnershipLostError('Project write-lock ownership was lost.');

    throw normalizeLockOperationError(error, 'release');
  }

  if (!entry.isFile() || entry.isSymbolicLink())
    throw new LockOwnershipLostError('Project write-lock ownership was lost.');

  if (!hasFileIdentity(entry, identity))
    throw new LockOwnershipLostError('Project write-lock ownership was lost.');

  try {
    await unlink(lockPath);
  } catch (error) {
    if (isFileSystemError(error, 'ENOENT'))
      throw new LockOwnershipLostError('Project write-lock ownership was lost.');

    throw normalizeLockOperationError(error, 'release');
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

async function assertDirectoryPath(
  projectDirectory: string,
  relativePath: string,
): Promise<void> {
  const checkedComponents: string[] = [];
  let currentPath = projectDirectory;

  for (const component of relativePath.split('/')) {
    checkedComponents.push(component);
    currentPath = join(currentPath, component);
    await assertDirectory(currentPath, checkedComponents.join('/'));
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

async function reserveProjectDirectory(path: string): Promise<FileIdentity> {
  try {
    await mkdir(path);
    const entry = await lstat(path);
    if (!entry.isDirectory() || entry.isSymbolicLink())
      throw new Error('Reserved project path is not a physical directory.');

    return toFileIdentity(entry);
  } catch (error) {
    if (isFileSystemError(error, 'EEXIST')) {
      throw new ProjectWorkspaceError(
        'PROJECT_ALREADY_EXISTS',
        'The target project directory already exists.',
        error,
      );
    }

    throw new ProjectWorkspaceError(
      'PROJECT_CREATE_FAILED',
      'Unable to reserve the target project directory.',
      error,
    );
  }
}

function isFileSystemError(
  error: unknown,
  code: string,
): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === code;
}

function isProcessAlive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    if (isFileSystemError(error, 'ESRCH'))
      return false;
    return true;
  }
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

  if (!manifest.directoryName.endsWith(`--${manifest.projectId}`)) {
    throw new ProjectWorkspaceError(
      'PROJECT_MANIFEST_INVALID',
      'Project directory name must end with the project ID.',
    );
  }

  await Promise.all(
    PROJECT_LAYOUT_DIRECTORIES.map(relativePath =>
      assertDirectoryPath(projectDirectory, relativePath),
    ),
  );

  return manifest;
}

function validateDisplayName(displayName: string): string {
  if (
    typeof displayName !== 'string'
    || displayName.length === 0
    || displayName !== displayName.trim()
    || displayName.includes('\0')
    || Array.from(displayName).length > 120
  ) {
    throw new ProjectWorkspaceError(
      'PROJECT_NAME_INVALID',
      'Project display name must be a non-empty trimmed string without NUL characters and at most 120 characters.',
    );
  }

  return displayName;
}
