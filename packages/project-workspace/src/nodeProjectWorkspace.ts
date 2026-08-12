import type { ProjectManifest, RecentProjectAvailability } from '@voxweaver/contracts';
import type { Stats } from 'node:fs';

import { createHash, randomUUID } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { access, copyFile, lstat, mkdir, open, readdir, readFile, realpath, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  isSupportedProjectSourceFileName,
  normalizeProjectDisplayName,
  parseProjectManifest,
  PROJECT_LAYOUT_VERSION,
  PROJECT_SCHEMA_VERSION,
  PROJECT_STATE_DATABASE_PATH,
  VoxWeaverError,
} from '@voxweaver/contracts';

const PROJECT_MANIFEST_FILE = 'project.json';
const REQUIRED_DIRECTORIES = ['artifacts', 'exports', 'inputs', 'state', 'tmp'] as const;
const COMMIT_DIRECTORIES = ['state', 'inputs', 'artifacts', 'exports', 'tmp'] as const;

interface CreateProjectInput {
  displayName: string;
  rootPath: string;
  sourcePath: string;
}

export interface OpenedProject {
  rootPath: string;
  manifest: ProjectManifest;
}

export interface ProjectInspection {
  availability: RecentProjectAvailability;
  manifest?: ProjectManifest;
}

interface ProjectRow {
  id: string;
  display_name: string;
  created_at: string;
}

interface SourceAssetRow {
  id: string;
  project_id: string;
  original_name: string;
  relative_path: string;
  byte_length: number;
  sha256: string;
}

interface SchemaInfoRow {
  key: string;
  value: string;
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash('sha256');

  for await (const chunk of createReadStream(filePath, { flags: 'r' }))
    hash.update(chunk as Uint8Array);

  return hash.digest('hex');
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

async function assertNoSymbolicLinkComponents(targetPath: string): Promise<void> {
  const selectedStats = await lstat(path.resolve(targetPath));
  if (selectedStats.isSymbolicLink()) {
    throw new VoxWeaverError(
      'PROJECT_DIRECTORY_INVALID',
      '项目目录不能是符号链接。',
      false,
    );
  }

  let currentPath = await realpath(targetPath);

  while (true) {
    const currentStats = await lstat(currentPath);
    if (currentStats.isSymbolicLink()) {
      throw new VoxWeaverError(
        'PROJECT_DIRECTORY_INVALID',
        '项目目录及其上级路径不能包含符号链接。',
        false,
      );
    }

    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath)
      break;

    currentPath = parentPath;
  }
}

async function assertPhysicalDirectory(directoryPath: string, errorCode: 'PROJECT_DATABASE_INVALID' | 'PROJECT_DIRECTORY_INVALID'): Promise<Stats> {
  const directoryStats = await lstat(directoryPath);
  if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink())
    throw new VoxWeaverError(errorCode, '项目目录结构无效。', false);

  return directoryStats;
}

async function assertPhysicalProjectEntry(
  rootPath: string,
  relativePath: string,
  finalKind: 'directory' | 'file',
  errorCode: 'PROJECT_DATABASE_INVALID' | 'PROJECT_SOURCE_MISSING',
  errorMessage: string,
): Promise<Stats> {
  let currentPath = rootPath;
  const segments = relativePath.split('/');

  try {
    for (const [index, segment] of segments.entries()) {
      currentPath = path.join(currentPath, segment);
      const entryStats = await lstat(currentPath);
      const isFinalEntry = index === segments.length - 1;
      if (entryStats.isSymbolicLink()
        || (isFinalEntry && finalKind === 'file' && !entryStats.isFile())
        || (isFinalEntry && finalKind === 'directory' && !entryStats.isDirectory())
        || (!isFinalEntry && !entryStats.isDirectory())) {
        throw new Error('invalid project entry');
      }

      if (isFinalEntry)
        return entryStats;
    }
  } catch {
    throw new VoxWeaverError(errorCode, errorMessage, false);
  }

  throw new VoxWeaverError(errorCode, errorMessage, false);
}

async function assertEmptyWritableProjectRoot(rootPath: string): Promise<void> {
  try {
    await assertNoSymbolicLinkComponents(rootPath);
    await assertPhysicalDirectory(rootPath, 'PROJECT_DIRECTORY_INVALID');
    await access(rootPath, constants.R_OK | constants.W_OK);
  } catch (error) {
    if (error instanceof VoxWeaverError)
      throw error;

    throw new VoxWeaverError('PROJECT_DIRECTORY_INVALID', '项目目录不存在、不可访问或不可写。');
  }

  const entries = await readdir(rootPath);
  if (entries.length > 0) {
    throw new VoxWeaverError(
      'PROJECT_DIRECTORY_NOT_EMPTY',
      '请选择一个空文件夹作为项目目录。',
    );
  }
}

async function assertReadableSourceFile(sourcePath: string): Promise<Stats> {
  try {
    const sourceStats = await lstat(sourcePath);
    if (!sourceStats.isFile() || sourceStats.isSymbolicLink())
      throw new VoxWeaverError('SOURCE_FILE_INVALID', '源文件必须是可读取的普通文件。');

    await access(sourcePath, constants.R_OK);
    return sourceStats;
  } catch (error) {
    if (error instanceof VoxWeaverError)
      throw error;

    throw new VoxWeaverError('SOURCE_FILE_INVALID', '源文件不存在或不可读取。');
  }
}

function initializeProjectDatabase(databasePath: string, manifest: ProjectManifest): void {
  const database = new DatabaseSync(databasePath, { timeout: 5_000 });

  try {
    database.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA user_version = 1;
      CREATE TABLE schema_info (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT;
      CREATE TABLE project (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE source_asset (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES project(id),
        original_name TEXT NOT NULL,
        relative_path TEXT NOT NULL UNIQUE,
        byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
        sha256 TEXT NOT NULL
      ) STRICT;
      BEGIN IMMEDIATE;
    `);

    database.prepare('INSERT INTO schema_info (key, value) VALUES (?, ?)')
      .run('layout_version', String(PROJECT_LAYOUT_VERSION));
    database.prepare('INSERT INTO schema_info (key, value) VALUES (?, ?)')
      .run('schema_version', String(PROJECT_SCHEMA_VERSION));
    database.prepare('INSERT INTO project (id, display_name, created_at) VALUES (?, ?, ?)')
      .run(manifest.projectId, manifest.displayName, manifest.createdAt);
    database.prepare(`
      INSERT INTO source_asset (
        id, project_id, original_name, relative_path, byte_length, sha256
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      manifest.sourceAsset.id,
      manifest.projectId,
      manifest.sourceAsset.originalName,
      manifest.sourceAsset.relativePath,
      manifest.sourceAsset.byteLength,
      manifest.sourceAsset.sha256,
    );
    database.exec('COMMIT;');
  } catch (error) {
    if (database.isTransaction)
      database.exec('ROLLBACK;');
    throw error;
  } finally {
    database.close();
  }
}

function verifyProjectDatabase(databasePath: string, manifest: ProjectManifest): void {
  let database: DatabaseSync;

  try {
    database = new DatabaseSync(databasePath, {
      readOnly: true,
      timeout: 5_000,
    });
  } catch {
    throw new VoxWeaverError('PROJECT_DATABASE_INVALID', '项目状态库无法打开。', false);
  }

  try {
    const check = database.prepare('PRAGMA quick_check').get() as Record<string, unknown> | undefined;
    if (!check || !Object.values(check).includes('ok'))
      throw new Error('quick_check failed');

    const userVersion = database.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined;
    if (userVersion?.user_version !== 1)
      throw new Error('unsupported database version');

    const schemaRows = database.prepare('SELECT key, value FROM schema_info').all() as unknown as SchemaInfoRow[];
    const schemaInfo = new Map(schemaRows.map(row => [row.key, row.value]));
    if (schemaInfo.get('schema_version') !== String(PROJECT_SCHEMA_VERSION)
      || schemaInfo.get('layout_version') !== String(PROJECT_LAYOUT_VERSION)) {
      throw new Error('database schema version mismatch');
    }

    const project = database.prepare('SELECT id, display_name, created_at FROM project LIMIT 1').get() as ProjectRow | undefined;
    const sourceAsset = database.prepare(`
      SELECT id, project_id, original_name, relative_path, byte_length, sha256
      FROM source_asset
      LIMIT 1
    `).get() as SourceAssetRow | undefined;

    if (!project
      || !sourceAsset
      || project.id !== manifest.projectId
      || project.display_name !== manifest.displayName
      || project.created_at !== manifest.createdAt
      || sourceAsset.id !== manifest.sourceAsset.id
      || sourceAsset.project_id !== manifest.projectId
      || sourceAsset.original_name !== manifest.sourceAsset.originalName
      || sourceAsset.relative_path !== manifest.sourceAsset.relativePath
      || sourceAsset.byte_length !== manifest.sourceAsset.byteLength
      || sourceAsset.sha256 !== manifest.sourceAsset.sha256) {
      throw new Error('database record mismatch');
    }
  } catch (error) {
    if (error instanceof VoxWeaverError)
      throw error;

    throw new VoxWeaverError('PROJECT_DATABASE_INVALID', '项目状态库校验失败。', false);
  } finally {
    database.close();
  }
}

async function readManifest(rootPath: string): Promise<ProjectManifest> {
  try {
    const manifestPath = path.join(rootPath, PROJECT_MANIFEST_FILE);
    const manifestStats = await lstat(manifestPath);
    if (!manifestStats.isFile() || manifestStats.isSymbolicLink())
      throw new Error('manifest is not a physical file');

    return parseProjectManifest(JSON.parse(await readFile(manifestPath, 'utf8')));
  } catch (error) {
    if (error instanceof VoxWeaverError)
      throw error;

    throw new VoxWeaverError('PROJECT_MANIFEST_INVALID', '项目标识文件缺失或无效。', false);
  }
}

export class NodeProjectWorkspace {
  async createProject(input: CreateProjectInput): Promise<OpenedProject> {
    const displayName = normalizeProjectDisplayName(input.displayName);
    const rootPath = path.resolve(input.rootPath);
    const sourcePath = path.resolve(input.sourcePath);

    await assertEmptyWritableProjectRoot(rootPath);
    const originalName = path.basename(sourcePath);
    if (!isSupportedProjectSourceFileName(originalName)) {
      throw new VoxWeaverError(
        'SOURCE_FILE_INVALID',
        '当前仅支持 TXT（.txt）源文件。',
        false,
      );
    }
    const initialSourceStats = await assertReadableSourceFile(sourcePath);

    const projectId = randomUUID();
    const sourceAssetId = randomUUID();
    const sourceRelativePath = path.posix.join('inputs', 'source-assets', sourceAssetId, originalName);
    const stagingName = `.voxweaver-creating-${projectId}`;
    const stagingPath = path.join(rootPath, stagingName);
    const manifestTemporaryPath = path.join(rootPath, `.project-${projectId}.json.tmp`);
    const committedPaths: string[] = [];

    try {
      await mkdir(stagingPath, { recursive: false, mode: 0o700 });
      await Promise.all([
        mkdir(path.join(stagingPath, 'artifacts')),
        mkdir(path.join(stagingPath, 'exports')),
        mkdir(path.join(stagingPath, 'tmp')),
        mkdir(path.join(stagingPath, 'state')),
        mkdir(path.join(stagingPath, 'inputs', 'source-assets', sourceAssetId), { recursive: true }),
      ]);

      const entriesAfterReservation = await readdir(rootPath);
      if (entriesAfterReservation.length !== 1 || entriesAfterReservation[0] !== stagingName) {
        throw new VoxWeaverError(
          'PROJECT_DIRECTORY_NOT_EMPTY',
          '项目目录在创建过程中出现了其他内容，请选择新的空文件夹。',
        );
      }

      const sourceHash = await hashFile(sourcePath);
      const stagedSourcePath = path.join(stagingPath, ...sourceRelativePath.split('/'));
      await copyFile(sourcePath, stagedSourcePath, constants.COPYFILE_EXCL);
      const [finalSourceStats, copiedSourceStats, copiedHash] = await Promise.all([
        stat(sourcePath),
        stat(stagedSourcePath),
        hashFile(stagedSourcePath),
      ]);

      if (initialSourceStats.size !== finalSourceStats.size
        || copiedSourceStats.size !== finalSourceStats.size
        || copiedHash !== sourceHash) {
        throw new VoxWeaverError(
          'PROJECT_SOURCE_MISMATCH',
          '源文件在复制期间发生变化，或项目副本校验失败。',
        );
      }

      const manifest: ProjectManifest = {
        schemaVersion: PROJECT_SCHEMA_VERSION,
        layoutVersion: PROJECT_LAYOUT_VERSION,
        projectId,
        displayName,
        createdAt: new Date().toISOString(),
        stateDatabase: PROJECT_STATE_DATABASE_PATH,
        sourceAsset: {
          id: sourceAssetId,
          originalName,
          relativePath: sourceRelativePath,
          byteLength: copiedSourceStats.size,
          sha256: copiedHash,
        },
      };

      initializeProjectDatabase(path.join(stagingPath, PROJECT_STATE_DATABASE_PATH), manifest);

      for (const directoryName of COMMIT_DIRECTORIES) {
        const destinationPath = path.join(rootPath, directoryName);
        try {
          await lstat(destinationPath);
          throw new VoxWeaverError(
            'PROJECT_DIRECTORY_NOT_EMPTY',
            '项目目录在创建过程中出现了冲突内容。',
          );
        } catch (error) {
          if (!isNotFound(error))
            throw error;
        }

        await rename(path.join(stagingPath, directoryName), destinationPath);
        committedPaths.push(destinationPath);
      }

      await rm(stagingPath, { recursive: true, force: true });

      const manifestHandle = await open(manifestTemporaryPath, 'wx', 0o600);
      try {
        await manifestHandle.writeFile(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
        await manifestHandle.sync();
      } finally {
        await manifestHandle.close();
      }

      await rename(manifestTemporaryPath, path.join(rootPath, PROJECT_MANIFEST_FILE));

      return { rootPath, manifest };
    } catch (error) {
      await rm(manifestTemporaryPath, { force: true });
      for (const committedPath of committedPaths.reverse())
        await rm(committedPath, { recursive: true, force: true });
      await rm(stagingPath, { recursive: true, force: true });

      if (error instanceof VoxWeaverError)
        throw error;

      throw new VoxWeaverError('PROJECT_CREATE_FAILED', '项目创建失败，请检查目录权限后重试。');
    }
  }

  async openProject(inputPath: string): Promise<OpenedProject> {
    const rootPath = path.resolve(inputPath);

    try {
      await assertNoSymbolicLinkComponents(rootPath);
      await assertPhysicalDirectory(rootPath, 'PROJECT_DIRECTORY_INVALID');
    } catch (error) {
      if (error instanceof VoxWeaverError)
        throw error;

      throw new VoxWeaverError('PROJECT_DIRECTORY_INVALID', '项目目录不存在或不可访问。', false);
    }

    const manifest = await readManifest(rootPath);

    for (const directoryName of REQUIRED_DIRECTORIES)
      await assertPhysicalDirectory(path.join(rootPath, directoryName), 'PROJECT_DATABASE_INVALID');

    const sourcePath = path.join(rootPath, ...manifest.sourceAsset.relativePath.split('/'));
    const sourceStats = await assertPhysicalProjectEntry(
      rootPath,
      manifest.sourceAsset.relativePath,
      'file',
      'PROJECT_SOURCE_MISSING',
      '项目源文件副本缺失或路径无效。',
    );

    let sourceHash: string;
    try {
      sourceHash = await hashFile(sourcePath);
    } catch {
      throw new VoxWeaverError('PROJECT_SOURCE_MISSING', '项目源文件副本无法读取。', false);
    }

    if (sourceStats.size !== manifest.sourceAsset.byteLength
      || sourceHash !== manifest.sourceAsset.sha256) {
      throw new VoxWeaverError('PROJECT_SOURCE_MISMATCH', '项目源文件副本已发生变化。', false);
    }

    const databasePath = path.join(rootPath, ...manifest.stateDatabase.split('/'));
    await assertPhysicalProjectEntry(
      rootPath,
      manifest.stateDatabase,
      'file',
      'PROJECT_DATABASE_INVALID',
      '项目状态库缺失或路径无效。',
    );

    verifyProjectDatabase(databasePath, manifest);
    return { rootPath, manifest };
  }

  async inspectProject(inputPath: string, expectedProjectId?: string): Promise<ProjectInspection> {
    const rootPath = path.resolve(inputPath);

    try {
      await assertPhysicalDirectory(rootPath, 'PROJECT_DIRECTORY_INVALID');
      const manifest = await readManifest(rootPath);
      if (expectedProjectId && manifest.projectId !== expectedProjectId)
        return { availability: 'invalid' };

      for (const directoryName of REQUIRED_DIRECTORIES)
        await assertPhysicalDirectory(path.join(rootPath, directoryName), 'PROJECT_DATABASE_INVALID');
      await assertPhysicalProjectEntry(
        rootPath,
        manifest.stateDatabase,
        'file',
        'PROJECT_DATABASE_INVALID',
        '项目状态库缺失或路径无效。',
      );
      await assertPhysicalProjectEntry(
        rootPath,
        manifest.sourceAsset.relativePath,
        'file',
        'PROJECT_SOURCE_MISSING',
        '项目源文件副本缺失或路径无效。',
      );

      return { availability: 'available', manifest };
    } catch (error) {
      if (isNotFound(error))
        return { availability: 'missing' };

      try {
        await lstat(rootPath);
      } catch (directoryError) {
        if (isNotFound(directoryError))
          return { availability: 'missing' };
      }

      return { availability: 'invalid' };
    }
  }
}
