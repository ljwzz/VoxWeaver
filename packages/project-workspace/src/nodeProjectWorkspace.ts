import type {
  AnySupportedProjectManifest,
  LegacyProjectManifest,
  ProjectManifest,
  RecentProjectAvailability,
  WorkspacePageKey,
} from '@voxweaver/contracts';
import type { Stats } from 'node:fs';

import { createHash, randomUUID } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import {
  access,
  copyFile,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  unlink,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { backup, DatabaseSync } from 'node:sqlite';
import {
  isSupportedProjectSourceFileName,
  isWorkspacePageKey,
  normalizeProjectDisplayName,
  parseAnyProjectManifest,
  parseProjectManifest,
  PROJECT_LAYOUT_VERSION,
  PROJECT_SCHEMA_VERSION,
  PROJECT_STATE_DATABASE_PATH,
  VoxWeaverError,
} from '@voxweaver/contracts';

export const PROJECT_MANIFEST_FILE = 'project.json';
export const PROJECT_WRITE_LOCK_RELATIVE_PATH = 'state/locks/write-lock.json';
export const PROJECT_MIGRATION_JOURNAL_RELATIVE_PATH = 'state/migration-journal.json';
export const PROJECT_DATABASE_VERSION = 2;

export const PROJECT_LAYOUT_DIRECTORIES = [
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
  'cache',
  'exports',
  'inputs/source-assets',
  'inputs/voice-sources',
  'inputs/artwork',
  'logs',
  'state/backups',
  'state/locks',
  'tmp',
] as const;

const REQUIRED_TOP_LEVEL_DIRECTORIES = [
  'artifacts',
  'cache',
  'exports',
  'inputs',
  'logs',
  'state',
  'tmp',
] as const;

const LEGACY_REQUIRED_DIRECTORIES = ['artifacts', 'exports', 'inputs', 'state', 'tmp'] as const;

export interface CreateProjectInput {
  readonly displayName: string;
  readonly rootPath: string;
  readonly sourcePath: string;
}

export interface OpenedProject {
  readonly rootPath: string;
  readonly canonicalRootPath: string;
  readonly manifest: ProjectManifest;
}

export interface ProjectInspection {
  readonly availability: RecentProjectAvailability;
  readonly manifest?: ProjectManifest;
  readonly migrationRequired?: boolean;
  readonly canonicalRootPath?: string;
}

export interface FileIdentity {
  readonly device: number;
  readonly inode: number;
  readonly size: number;
  readonly modifiedAtMs: number;
  readonly sha256: string;
}

export interface ProjectOpenInspection {
  readonly status: 'current' | 'migration-required';
  readonly rootPath: string;
  readonly canonicalRootPath: string;
  readonly manifest: AnySupportedProjectManifest;
  readonly manifestIdentity: FileIdentity;
  readonly databaseIdentity: FileIdentity;
  readonly writeLock: ProjectWriteLockInspection;
}

export interface ProjectWriteLock {
  readonly schemaVersion: 1;
  readonly projectId: string;
  readonly appInstanceId: string;
  readonly projectSessionId: string;
  readonly coreProcessId: number;
  readonly hostname: string;
  readonly acquiredAt: string;
}

export type ProjectWriteLockInspection
  = { readonly status: 'available' }
    | {
      readonly status: 'active' | 'stale' | 'invalid';
      readonly lock?: ProjectWriteLock;
      readonly identity: FileIdentity;
    };

export interface AcquireProjectWriteLockInput {
  readonly rootPath: string;
  readonly projectId: string;
  readonly appInstanceId: string;
  readonly projectSessionId: string;
  readonly recoverStale?: boolean;
  readonly expectedStaleIdentity?: FileIdentity;
}

export type ProjectMigrationPhase
  = | 'backup-created'
    | 'temporary-database-ready'
    | 'temporary-manifest-ready'
    | 'database-replaced'
    | 'manifest-replaced';

export interface ProjectMigrationJournal {
  readonly schemaVersion: 1;
  readonly migrationId: string;
  readonly projectId: string;
  readonly fromLayoutVersion: 1;
  readonly toLayoutVersion: 2;
  readonly phase: ProjectMigrationPhase;
  readonly createdAt: string;
  readonly backupDirectory: string;
  readonly backupManifest: string;
  readonly backupDatabase: string;
  readonly temporaryManifest: string;
  readonly temporaryDatabase: string;
}

export interface NodeProjectWorkspaceOptions {
  readonly onMigrationPhase?: (phase: ProjectMigrationPhase) => void | Promise<void>;
}

interface ProjectRow {
  readonly id: string;
  readonly display_name: string;
  readonly created_at: string;
  readonly updated_at: string;
}

interface SourceAssetRow {
  readonly id: string;
  readonly project_id: string;
  readonly original_name: string;
  readonly relative_path: string;
  readonly byte_length: number;
  readonly sha256: string;
}

interface SchemaInfoRow {
  readonly key: string;
  readonly value: string;
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

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}

async function syncFile(filePath: string): Promise<void> {
  const handle = await open(filePath, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectory(directoryPath: string): Promise<void> {
  const handle = await open(directoryPath, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeJsonFileExclusive(filePath: string, value: unknown): Promise<void> {
  const handle = await open(filePath, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(path.dirname(filePath));
}

async function writeJsonFileAtomic(filePath: string, value: unknown): Promise<void> {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    await writeJsonFileExclusive(temporaryPath, value);
    await rename(temporaryPath, filePath);
    await syncDirectory(path.dirname(filePath));
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function restoreFileAtomically(sourcePath: string, destinationPath: string): Promise<void> {
  const temporaryPath = `${destinationPath}.${randomUUID()}.recovery.tmp`;
  try {
    await copyFile(sourcePath, temporaryPath, constants.COPYFILE_EXCL);
    await syncFile(temporaryPath);
    await rename(temporaryPath, destinationPath);
    await syncDirectory(path.dirname(destinationPath));
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function fileIdentity(filePath: string): Promise<FileIdentity> {
  const fileStats = await lstat(filePath);
  if (!fileStats.isFile() || fileStats.isSymbolicLink())
    throw new VoxWeaverError('PROJECT_DIRECTORY_INVALID', '项目文件身份无效。', false);
  return {
    device: fileStats.dev,
    inode: fileStats.ino,
    size: fileStats.size,
    modifiedAtMs: fileStats.mtimeMs,
    sha256: await hashFile(filePath),
  };
}

export function sameFileIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.device === right.device
    && left.inode === right.inode
    && left.size === right.size
    && left.modifiedAtMs === right.modifiedAtMs
    && left.sha256 === right.sha256;
}

async function assertNoSymbolicLinkComponents(targetPath: string): Promise<string> {
  const selectedStats = await lstat(path.resolve(targetPath));
  if (selectedStats.isSymbolicLink())
    throw new VoxWeaverError('PROJECT_DIRECTORY_INVALID', '项目目录不能是符号链接。', false);

  let currentPath = await realpath(targetPath);
  const canonicalPath = currentPath;
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
  return canonicalPath;
}

async function assertPhysicalDirectory(
  directoryPath: string,
  errorCode: 'PROJECT_DATABASE_INVALID' | 'PROJECT_DIRECTORY_INVALID',
): Promise<Stats> {
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

async function assertEmptyWritableProjectRoot(rootPath: string): Promise<string> {
  let canonicalRootPath: string;
  try {
    canonicalRootPath = await assertNoSymbolicLinkComponents(rootPath);
    await assertPhysicalDirectory(rootPath, 'PROJECT_DIRECTORY_INVALID');
    await access(rootPath, constants.R_OK | constants.W_OK);
  } catch (error) {
    if (error instanceof VoxWeaverError)
      throw error;
    throw new VoxWeaverError('PROJECT_DIRECTORY_INVALID', '项目目录不存在、不可访问或不可写。');
  }
  if ((await readdir(rootPath)).length > 0)
    throw new VoxWeaverError('PROJECT_DIRECTORY_NOT_EMPTY', '请选择一个空文件夹作为项目目录。');
  return canonicalRootPath;
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

function projectDatabaseSchemaSql(): string {
  return `
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA user_version = ${PROJECT_DATABASE_VERSION};
    CREATE TABLE IF NOT EXISTS schema_info (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS project (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS source_asset (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES project(id),
      original_name TEXT NOT NULL,
      relative_path TEXT NOT NULL UNIQUE,
      byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
      sha256 TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS artifact_revision (
      revision_id TEXT PRIMARY KEY,
      artifact_id TEXT NOT NULL,
      artifact_type TEXT NOT NULL,
      lineage_id TEXT NOT NULL,
      storage_kind TEXT NOT NULL,
      content_path TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      input_fingerprint TEXT NOT NULL,
      processor_id TEXT NOT NULL,
      processor_version TEXT NOT NULL,
      parameters_hash TEXT NOT NULL,
      execution_status TEXT NOT NULL,
      validity_status TEXT NOT NULL,
      review_status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}'
    ) STRICT;
    CREATE INDEX IF NOT EXISTS artifact_revision_by_artifact
      ON artifact_revision(artifact_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS artifact_dependency (
      dependency_id TEXT PRIMARY KEY,
      consumer_revision_id TEXT NOT NULL REFERENCES artifact_revision(revision_id),
      producer_revision_id TEXT NOT NULL REFERENCES artifact_revision(revision_id),
      dependency_type TEXT NOT NULL,
      selector_json TEXT
    ) STRICT;
    CREATE TABLE IF NOT EXISTS stale_cause (
      stale_cause_id TEXT PRIMARY KEY,
      consumer_revision_id TEXT NOT NULL,
      previous_producer_revision_id TEXT NOT NULL,
      current_producer_revision_id TEXT NOT NULL,
      dependency_type TEXT NOT NULL,
      selector_json TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      resolved_at TEXT
    ) STRICT;
    CREATE TABLE IF NOT EXISTS task (
      task_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES project(id),
      task_type TEXT NOT NULL,
      input_fingerprint TEXT NOT NULL,
      command_json TEXT NOT NULL,
      execution_status TEXT NOT NULL,
      recovery_status TEXT NOT NULL,
      attempt INTEGER NOT NULL,
      stage TEXT NOT NULL,
      progress_completed INTEGER NOT NULL DEFAULT 0,
      progress_total INTEGER NOT NULL DEFAULT 100,
      progress_message TEXT NOT NULL DEFAULT '',
      cancel_requested_at TEXT,
      lease_id TEXT,
      heartbeat_at TEXT,
      temporary_path TEXT NOT NULL,
      result_revision_id TEXT,
      error_code TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS task_active_fingerprint
      ON task(project_id, task_type, input_fingerprint)
      WHERE execution_status IN ('pending', 'running', 'succeeded');
    CREATE TABLE IF NOT EXISTS stage_run (
      stage_run_id TEXT PRIMARY KEY,
      stage_id TEXT NOT NULL,
      input_fingerprint TEXT NOT NULL,
      execution_status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT
    ) STRICT;
    CREATE TABLE IF NOT EXISTS review_decision (
      review_decision_id TEXT PRIMARY KEY,
      artifact_id TEXT NOT NULL,
      revision_id TEXT NOT NULL,
      decision TEXT NOT NULL,
      note TEXT,
      decided_at TEXT NOT NULL,
      decided_by TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS workspace_state (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      last_page_key TEXT,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS novel_import_revision (
      revision_id TEXT PRIMARY KEY,
      baseline_revision INTEGER NOT NULL UNIQUE,
      source_asset_id TEXT NOT NULL REFERENCES source_asset(id),
      source_hash TEXT NOT NULL,
      source_encoding TEXT NOT NULL,
      encoding_method TEXT NOT NULL,
      processor_version TEXT NOT NULL,
      raw_text_path TEXT NOT NULL,
      canonical_text_path TEXT NOT NULL,
      review_snapshot_json TEXT NOT NULL,
      review_status TEXT NOT NULL,
      active INTEGER NOT NULL CHECK (active IN (0, 1)),
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS novel_import_single_active
      ON novel_import_revision(active) WHERE active = 1;
    CREATE TABLE IF NOT EXISTS novel_import_review_preview (
      preview_id TEXT PRIMARY KEY,
      baseline_revision INTEGER NOT NULL,
      command_hash TEXT NOT NULL,
      preview_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      consumed_at TEXT
    ) STRICT;
  `;
}

function initializeProjectDatabase(databasePath: string, manifest: ProjectManifest): void {
  const database = new DatabaseSync(databasePath, { timeout: 5_000 });
  try {
    database.exec(projectDatabaseSchemaSql());
    database.exec('BEGIN IMMEDIATE;');
    database.prepare('INSERT OR REPLACE INTO schema_info (key, value) VALUES (?, ?)')
      .run('layout_version', String(PROJECT_LAYOUT_VERSION));
    database.prepare('INSERT OR REPLACE INTO schema_info (key, value) VALUES (?, ?)')
      .run('schema_version', String(PROJECT_SCHEMA_VERSION));
    database.prepare('INSERT INTO project (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(manifest.projectId, manifest.displayName, manifest.createdAt, manifest.updatedAt);
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
    database.prepare('INSERT INTO workspace_state (singleton, last_page_key, updated_at) VALUES (1, NULL, ?)')
      .run(manifest.updatedAt);
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
    database = new DatabaseSync(databasePath, { readOnly: true, timeout: 5_000 });
  } catch {
    throw new VoxWeaverError('PROJECT_DATABASE_INVALID', '项目状态库无法打开。', false);
  }
  try {
    const check = database.prepare('PRAGMA quick_check').get() as Record<string, unknown> | undefined;
    if (!check || !Object.values(check).includes('ok'))
      throw new Error('quick_check failed');
    const version = database.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined;
    if (version?.user_version !== PROJECT_DATABASE_VERSION)
      throw new Error('unsupported database version');
    const schemaRows = database.prepare('SELECT key, value FROM schema_info').all() as unknown as SchemaInfoRow[];
    const schemaInfo = new Map(schemaRows.map(row => [row.key, row.value]));
    if (schemaInfo.get('schema_version') !== String(PROJECT_SCHEMA_VERSION)
      || schemaInfo.get('layout_version') !== String(PROJECT_LAYOUT_VERSION)) {
      throw new Error('database schema version mismatch');
    }
    const project = database.prepare('SELECT id, display_name, created_at, updated_at FROM project LIMIT 1').get() as ProjectRow | undefined;
    const sourceAsset = database.prepare(`
      SELECT id, project_id, original_name, relative_path, byte_length, sha256
      FROM source_asset LIMIT 1
    `).get() as SourceAssetRow | undefined;
    if (!project
      || !sourceAsset
      || project.id !== manifest.projectId
      || project.display_name !== manifest.displayName
      || project.created_at !== manifest.createdAt
      || project.updated_at !== manifest.updatedAt
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

async function readAnyManifest(rootPath: string): Promise<AnySupportedProjectManifest> {
  try {
    const manifestPath = path.join(rootPath, PROJECT_MANIFEST_FILE);
    const manifestStats = await lstat(manifestPath);
    if (!manifestStats.isFile() || manifestStats.isSymbolicLink())
      throw new Error('manifest is not a physical file');
    return parseAnyProjectManifest(JSON.parse(await readFile(manifestPath, 'utf8')));
  } catch (error) {
    if (error instanceof VoxWeaverError)
      throw error;
    throw new VoxWeaverError('PROJECT_MANIFEST_INVALID', '项目标识文件缺失或无效。', false);
  }
}

async function assertSourceAsset(rootPath: string, manifest: AnySupportedProjectManifest): Promise<void> {
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
  if (sourceStats.size !== manifest.sourceAsset.byteLength || sourceHash !== manifest.sourceAsset.sha256)
    throw new VoxWeaverError('PROJECT_SOURCE_MISMATCH', '项目源文件副本已发生变化。', false);
}

function isProcessAlive(processId: number): boolean {
  if (!Number.isSafeInteger(processId) || processId <= 0)
    return false;
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    return !(error instanceof Error && 'code' in error && error.code === 'ESRCH');
  }
}

function parseProjectWriteLock(value: unknown): ProjectWriteLock {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new TypeError('invalid lock');
  const lock = value as Record<string, unknown>;
  if (lock.schemaVersion !== 1
    || typeof lock.projectId !== 'string'
    || typeof lock.appInstanceId !== 'string'
    || typeof lock.projectSessionId !== 'string'
    || !Number.isSafeInteger(lock.coreProcessId)
    || typeof lock.hostname !== 'string'
    || typeof lock.acquiredAt !== 'string'
    || Number.isNaN(Date.parse(lock.acquiredAt))) {
    throw new TypeError('invalid lock');
  }
  return lock as unknown as ProjectWriteLock;
}

async function readMigrationJournal(rootPath: string): Promise<ProjectMigrationJournal | undefined> {
  const journalPath = path.join(rootPath, PROJECT_MIGRATION_JOURNAL_RELATIVE_PATH);
  try {
    const journalStats = await lstat(journalPath);
    if (!journalStats.isFile() || journalStats.isSymbolicLink())
      throw new Error('invalid journal');
    const value = JSON.parse(await readFile(journalPath, 'utf8')) as Record<string, unknown>;
    const phases: readonly ProjectMigrationPhase[] = [
      'backup-created',
      'temporary-database-ready',
      'temporary-manifest-ready',
      'database-replaced',
      'manifest-replaced',
    ];
    const relativePathKeys = [
      'backupDirectory',
      'backupManifest',
      'backupDatabase',
      'temporaryManifest',
      'temporaryDatabase',
    ] as const;
    if (value.schemaVersion !== 1
      || typeof value.migrationId !== 'string'
      || value.migrationId.length === 0
      || typeof value.projectId !== 'string'
      || value.projectId.length === 0
      || value.fromLayoutVersion !== 1
      || value.toLayoutVersion !== 2
      || typeof value.phase !== 'string'
      || !phases.includes(value.phase as ProjectMigrationPhase)
      || typeof value.createdAt !== 'string'
      || Number.isNaN(Date.parse(value.createdAt))
      || relativePathKeys.some(key => !isSafeJournalRelativePath(value[key]))) {
      throw new Error('invalid journal');
    }
    return value as unknown as ProjectMigrationJournal;
  } catch (error) {
    if (isNotFound(error))
      return undefined;
    throw new VoxWeaverError('PROJECT_MIGRATION_FAILED', '项目迁移日志无效。', false);
  }
}

function isSafeJournalRelativePath(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && !path.isAbsolute(value)
    && !value.includes('\\')
    && value.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..');
}

function resolveJournalPath(rootPath: string, relativePath: string): string {
  const resolved = path.resolve(rootPath, relativePath);
  if (resolved === rootPath || !resolved.startsWith(`${rootPath}${path.sep}`))
    throw new VoxWeaverError('PROJECT_MIGRATION_FAILED', '项目迁移路径越界。', false);
  return resolved;
}

async function assertPhysicalMigrationFile(rootPath: string, relativePath: string): Promise<void> {
  let currentPath = rootPath;
  try {
    const segments = relativePath.split('/');
    for (const [index, segment] of segments.entries()) {
      currentPath = path.join(currentPath, segment);
      const entry = await lstat(currentPath);
      const isFinal = index === segments.length - 1;
      if (entry.isSymbolicLink()
        || (isFinal ? !entry.isFile() : !entry.isDirectory())) {
        throw new Error('invalid migration backup path');
      }
    }
  } catch {
    throw new VoxWeaverError('PROJECT_MIGRATION_FAILED', '项目迁移备份缺失或路径无效。', false);
  }
}

async function assertPhysicalRecoveryDestination(destinationPath: string): Promise<void> {
  try {
    const destination = await lstat(destinationPath);
    const parent = await lstat(path.dirname(destinationPath));
    if (!destination.isFile()
      || destination.isSymbolicLink()
      || !parent.isDirectory()
      || parent.isSymbolicLink()) {
      throw new Error('invalid migration recovery destination');
    }
  } catch {
    throw new VoxWeaverError('PROJECT_MIGRATION_FAILED', '项目迁移恢复目标无效。', false);
  }
}

async function migrateLegacyDatabase(
  temporaryDatabasePath: string,
  manifest: ProjectManifest,
): Promise<void> {
  const database = new DatabaseSync(temporaryDatabasePath, { timeout: 5_000 });
  try {
    database.exec('PRAGMA journal_mode = DELETE; PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE;');
    const columns = database.prepare('PRAGMA table_info(project)').all() as unknown as Array<{ name: string }>;
    if (!columns.some(column => column.name === 'updated_at'))
      database.exec('ALTER TABLE project ADD COLUMN updated_at TEXT;');
    database.prepare('UPDATE project SET updated_at = ? WHERE updated_at IS NULL OR updated_at = ?')
      .run(manifest.updatedAt, '');
    database.exec('COMMIT;');
    database.exec(projectDatabaseSchemaSql());
    database.exec('BEGIN IMMEDIATE;');
    database.prepare('INSERT OR REPLACE INTO schema_info (key, value) VALUES (?, ?)')
      .run('layout_version', String(PROJECT_LAYOUT_VERSION));
    database.prepare('INSERT OR REPLACE INTO schema_info (key, value) VALUES (?, ?)')
      .run('schema_version', String(PROJECT_SCHEMA_VERSION));
    database.prepare('UPDATE project SET display_name = ?, updated_at = ? WHERE id = ?')
      .run(manifest.displayName, manifest.updatedAt, manifest.projectId);
    database.prepare(`
      INSERT OR IGNORE INTO workspace_state (singleton, last_page_key, updated_at)
      VALUES (1, NULL, ?)
    `).run(manifest.updatedAt);
    database.exec('COMMIT; PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode = DELETE;');
  } catch (error) {
    if (database.isTransaction)
      database.exec('ROLLBACK;');
    throw error;
  } finally {
    database.close();
  }
}

export class NodeProjectWorkspace {
  readonly #onMigrationPhase: (phase: ProjectMigrationPhase) => void | Promise<void>;

  constructor(options: NodeProjectWorkspaceOptions = {}) {
    this.#onMigrationPhase = options.onMigrationPhase ?? (() => {});
  }

  async createProject(input: CreateProjectInput): Promise<OpenedProject> {
    const displayName = normalizeProjectDisplayName(input.displayName);
    const rootPath = path.resolve(input.rootPath);
    const sourcePath = path.resolve(input.sourcePath);
    const canonicalRootPath = await assertEmptyWritableProjectRoot(rootPath);
    const originalName = path.basename(sourcePath);
    if (!isSupportedProjectSourceFileName(originalName)) {
      throw new VoxWeaverError('SOURCE_FILE_INVALID', '当前仅支持 TXT（.txt）源文件。', false);
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
      for (const relativeDirectory of PROJECT_LAYOUT_DIRECTORIES)
        await mkdir(path.join(stagingPath, ...relativeDirectory.split('/')), { recursive: true, mode: 0o700 });
      await mkdir(path.join(stagingPath, 'inputs', 'source-assets', sourceAssetId), { recursive: true, mode: 0o700 });

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

      const now = new Date().toISOString();
      const manifest: ProjectManifest = {
        schemaVersion: PROJECT_SCHEMA_VERSION,
        layoutVersion: PROJECT_LAYOUT_VERSION,
        projectId,
        displayName,
        createdAt: now,
        updatedAt: now,
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

      for (const directoryName of REQUIRED_TOP_LEVEL_DIRECTORIES) {
        const destinationPath = path.join(rootPath, directoryName);
        try {
          await lstat(destinationPath);
          throw new VoxWeaverError('PROJECT_DIRECTORY_NOT_EMPTY', '项目目录在创建过程中出现了冲突内容。');
        } catch (error) {
          if (!isNotFound(error))
            throw error;
        }
        await rename(path.join(stagingPath, directoryName), destinationPath);
        committedPaths.push(destinationPath);
      }
      await rm(stagingPath, { recursive: true, force: true });
      await writeJsonFileExclusive(manifestTemporaryPath, manifest);
      await rename(manifestTemporaryPath, path.join(rootPath, PROJECT_MANIFEST_FILE));
      await syncDirectory(rootPath);
      return { rootPath, canonicalRootPath, manifest };
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

  async inspectOpenProject(inputPath: string): Promise<ProjectOpenInspection> {
    const rootPath = path.resolve(inputPath);
    let canonicalRootPath: string;
    try {
      canonicalRootPath = await assertNoSymbolicLinkComponents(rootPath);
      await assertPhysicalDirectory(rootPath, 'PROJECT_DIRECTORY_INVALID');
    } catch (error) {
      if (error instanceof VoxWeaverError)
        throw error;
      throw new VoxWeaverError('PROJECT_DIRECTORY_INVALID', '项目目录不存在或不可访问。', false);
    }

    const pendingMigration = await readMigrationJournal(rootPath);
    if (pendingMigration) {
      const migrationLock = await this.inspectWriteLock(rootPath, pendingMigration.projectId);
      if (migrationLock.status === 'active') {
        throw new VoxWeaverError(
          'PROJECT_WRITE_LOCK_ACTIVE',
          '项目迁移仍由其他会话写入，不能执行恢复。',
          false,
        );
      }
    }

    await this.recoverMigration(rootPath);
    const manifest = await readAnyManifest(rootPath);
    const requiredDirectories = manifest.layoutVersion === PROJECT_LAYOUT_VERSION
      ? REQUIRED_TOP_LEVEL_DIRECTORIES
      : LEGACY_REQUIRED_DIRECTORIES;
    for (const directoryName of requiredDirectories)
      await assertPhysicalDirectory(path.join(rootPath, directoryName), 'PROJECT_DATABASE_INVALID');
    await assertSourceAsset(rootPath, manifest);
    await assertPhysicalProjectEntry(
      rootPath,
      manifest.stateDatabase,
      'file',
      'PROJECT_DATABASE_INVALID',
      '项目状态库缺失或路径无效。',
    );

    if (manifest.layoutVersion === PROJECT_LAYOUT_VERSION)
      verifyProjectDatabase(path.join(rootPath, ...manifest.stateDatabase.split('/')), manifest);

    return {
      status: manifest.layoutVersion === PROJECT_LAYOUT_VERSION ? 'current' : 'migration-required',
      rootPath,
      canonicalRootPath,
      manifest,
      manifestIdentity: await fileIdentity(path.join(rootPath, PROJECT_MANIFEST_FILE)),
      databaseIdentity: await fileIdentity(path.join(rootPath, ...manifest.stateDatabase.split('/'))),
      writeLock: await this.inspectWriteLock(rootPath, manifest.projectId),
    };
  }

  async openProject(inputPath: string): Promise<OpenedProject> {
    const inspection = await this.inspectOpenProject(inputPath);
    if (inspection.status === 'migration-required') {
      throw new VoxWeaverError(
        'PROJECT_MIGRATION_REQUIRED',
        '该项目需要确认迁移后才能打开。',
        false,
      );
    }
    return {
      rootPath: inspection.rootPath,
      canonicalRootPath: inspection.canonicalRootPath,
      manifest: parseProjectManifest(inspection.manifest),
    };
  }

  async inspectProject(inputPath: string, expectedProjectId?: string): Promise<ProjectInspection> {
    const rootPath = path.resolve(inputPath);
    try {
      const inspection = await this.inspectOpenProject(rootPath);
      if (expectedProjectId && inspection.manifest.projectId !== expectedProjectId)
        return { availability: 'invalid' };
      return {
        availability: 'available',
        canonicalRootPath: inspection.canonicalRootPath,
        migrationRequired: inspection.status === 'migration-required',
        ...(inspection.status === 'current' ? { manifest: parseProjectManifest(inspection.manifest) } : {}),
      };
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

  async migrateProject(
    inputPath: string,
    expected: Pick<ProjectOpenInspection, 'manifestIdentity' | 'databaseIdentity'>,
    ownedWriteLock?: ProjectWriteLock,
  ): Promise<OpenedProject> {
    const inspection = await this.inspectOpenProject(inputPath);
    if (inspection.status === 'current') {
      return {
        rootPath: inspection.rootPath,
        canonicalRootPath: inspection.canonicalRootPath,
        manifest: parseProjectManifest(inspection.manifest),
      };
    }
    if (!sameFileIdentity(inspection.manifestIdentity, expected.manifestIdentity)
      || !sameFileIdentity(inspection.databaseIdentity, expected.databaseIdentity)) {
      throw new VoxWeaverError(
        'CONFIRMATION_STATE_CHANGED',
        '项目文件在确认期间发生变化，请重新检查后再试。',
        false,
      );
    }
    if (inspection.writeLock.status === 'active'
      && (!ownedWriteLock
        || !inspection.writeLock.lock
        || inspection.writeLock.lock.projectId !== ownedWriteLock.projectId
        || inspection.writeLock.lock.appInstanceId !== ownedWriteLock.appInstanceId
        || inspection.writeLock.lock.projectSessionId !== ownedWriteLock.projectSessionId
        || inspection.writeLock.lock.coreProcessId !== ownedWriteLock.coreProcessId)) {
      throw new VoxWeaverError('PROJECT_WRITE_LOCK_ACTIVE', '项目正在由其他会话写入。', false);
    }
    if (inspection.writeLock.status === 'stale')
      throw new VoxWeaverError('PROJECT_WRITE_LOCK_STALE', '项目存在失效写锁，需要单独确认恢复。', false);

    const legacyManifest = inspection.manifest as LegacyProjectManifest;
    const migrationId = randomUUID();
    const backupRelativeDirectory = path.posix.join('state', 'backups', `migration-${migrationId}`);
    const backupDirectory = path.join(inspection.rootPath, ...backupRelativeDirectory.split('/'));
    await mkdir(path.dirname(backupDirectory), { recursive: true, mode: 0o700 });
    await mkdir(backupDirectory, { recursive: false, mode: 0o700 });
    const backupManifestRelativePath = path.posix.join(backupRelativeDirectory, 'project.v1.json');
    const backupDatabaseRelativePath = path.posix.join(backupRelativeDirectory, 'project.v1.sqlite');
    const temporaryDatabaseRelativePath = path.posix.join(backupRelativeDirectory, 'project.v2.sqlite.tmp');
    const temporaryManifestRelativePath = `.project-migration-${migrationId}.json.tmp`;
    const originalManifestPath = path.join(inspection.rootPath, PROJECT_MANIFEST_FILE);
    const originalDatabasePath = path.join(inspection.rootPath, ...legacyManifest.stateDatabase.split('/'));
    const backupManifestPath = resolveJournalPath(inspection.rootPath, backupManifestRelativePath);
    const backupDatabasePath = resolveJournalPath(inspection.rootPath, backupDatabaseRelativePath);
    const temporaryDatabasePath = resolveJournalPath(inspection.rootPath, temporaryDatabaseRelativePath);
    const temporaryManifestPath = resolveJournalPath(inspection.rootPath, temporaryManifestRelativePath);
    const journalPath = path.join(inspection.rootPath, PROJECT_MIGRATION_JOURNAL_RELATIVE_PATH);
    let journal: ProjectMigrationJournal = {
      schemaVersion: 1,
      migrationId,
      projectId: legacyManifest.projectId,
      fromLayoutVersion: 1,
      toLayoutVersion: 2,
      phase: 'backup-created',
      createdAt: new Date().toISOString(),
      backupDirectory: backupRelativeDirectory,
      backupManifest: backupManifestRelativePath,
      backupDatabase: backupDatabaseRelativePath,
      temporaryManifest: temporaryManifestRelativePath,
      temporaryDatabase: temporaryDatabaseRelativePath,
    };

    try {
      await copyFile(originalManifestPath, backupManifestPath, constants.COPYFILE_EXCL);
      const sourceDatabase = new DatabaseSync(originalDatabasePath, { readOnly: true, timeout: 5_000 });
      try {
        await backup(sourceDatabase, backupDatabasePath);
        await backup(sourceDatabase, temporaryDatabasePath);
      } finally {
        sourceDatabase.close();
      }
      await Promise.all([syncFile(backupManifestPath), syncFile(backupDatabasePath), syncFile(temporaryDatabasePath)]);
      await writeJsonFileAtomic(journalPath, journal);
      await this.#reachMigrationPhase('backup-created');

      const updatedAt = new Date().toISOString();
      const manifest: ProjectManifest = {
        ...legacyManifest,
        layoutVersion: PROJECT_LAYOUT_VERSION,
        updatedAt,
      };
      await migrateLegacyDatabase(temporaryDatabasePath, manifest);
      await syncFile(temporaryDatabasePath);
      journal = { ...journal, phase: 'temporary-database-ready' };
      await writeJsonFileAtomic(journalPath, journal);
      await this.#reachMigrationPhase('temporary-database-ready');

      for (const relativeDirectory of PROJECT_LAYOUT_DIRECTORIES)
        await mkdir(path.join(inspection.rootPath, ...relativeDirectory.split('/')), { recursive: true, mode: 0o700 });
      await writeJsonFileExclusive(temporaryManifestPath, manifest);
      verifyProjectDatabase(temporaryDatabasePath, manifest);
      journal = { ...journal, phase: 'temporary-manifest-ready' };
      await writeJsonFileAtomic(journalPath, journal);
      await this.#reachMigrationPhase('temporary-manifest-ready');

      await rm(`${originalDatabasePath}-wal`, { force: true });
      await rm(`${originalDatabasePath}-shm`, { force: true });
      await rename(temporaryDatabasePath, originalDatabasePath);
      await syncDirectory(path.dirname(originalDatabasePath));
      journal = { ...journal, phase: 'database-replaced' };
      await writeJsonFileAtomic(journalPath, journal);
      await this.#reachMigrationPhase('database-replaced');

      await rename(temporaryManifestPath, originalManifestPath);
      await syncDirectory(inspection.rootPath);
      journal = { ...journal, phase: 'manifest-replaced' };
      await writeJsonFileAtomic(journalPath, journal);
      await this.#reachMigrationPhase('manifest-replaced');

      const migrated = await this.#verifyCurrentProjectWithoutRecovery(inspection.rootPath);
      await rm(`${temporaryDatabasePath}-wal`, { force: true });
      await rm(`${temporaryDatabasePath}-shm`, { force: true });
      await rm(journalPath, { force: true });
      await syncDirectory(path.dirname(journalPath));
      return migrated;
    } catch (error) {
      await this.recoverMigration(inspection.rootPath);
      if (error instanceof VoxWeaverError)
        throw error;
      throw new VoxWeaverError('PROJECT_MIGRATION_FAILED', '项目迁移失败，已恢复迁移前文件。');
    }
  }

  async recoverMigration(inputPath: string): Promise<void> {
    const rootPath = path.resolve(inputPath);
    const journal = await readMigrationJournal(rootPath);
    if (!journal)
      return;
    const originalManifestPath = path.join(rootPath, PROJECT_MANIFEST_FILE);
    const originalDatabasePath = path.join(rootPath, PROJECT_STATE_DATABASE_PATH);
    const backupManifestPath = resolveJournalPath(rootPath, journal.backupManifest);
    const backupDatabasePath = resolveJournalPath(rootPath, journal.backupDatabase);
    const temporaryManifestPath = resolveJournalPath(rootPath, journal.temporaryManifest);
    const temporaryDatabasePath = resolveJournalPath(rootPath, journal.temporaryDatabase);
    const journalPath = path.join(rootPath, PROJECT_MIGRATION_JOURNAL_RELATIVE_PATH);

    await Promise.all([
      assertPhysicalMigrationFile(rootPath, journal.backupManifest),
      assertPhysicalMigrationFile(rootPath, journal.backupDatabase),
      assertPhysicalRecoveryDestination(originalManifestPath),
      assertPhysicalRecoveryDestination(originalDatabasePath),
    ]);
    await rm(`${originalDatabasePath}-wal`, { force: true });
    await rm(`${originalDatabasePath}-shm`, { force: true });
    await restoreFileAtomically(backupDatabasePath, originalDatabasePath);
    await restoreFileAtomically(backupManifestPath, originalManifestPath);
    await rm(temporaryManifestPath, { force: true });
    await rm(temporaryDatabasePath, { force: true });
    await rm(`${temporaryDatabasePath}-wal`, { force: true });
    await rm(`${temporaryDatabasePath}-shm`, { force: true });
    await rm(journalPath, { force: true });
    await syncDirectory(rootPath);
  }

  async inspectWriteLock(rootPath: string, projectId: string): Promise<ProjectWriteLockInspection> {
    const lockPath = path.join(rootPath, ...PROJECT_WRITE_LOCK_RELATIVE_PATH.split('/'));
    try {
      const identity = await fileIdentity(lockPath);
      let lock: ProjectWriteLock;
      try {
        lock = parseProjectWriteLock(JSON.parse(await readFile(lockPath, 'utf8')));
      } catch {
        return { status: 'invalid', identity };
      }
      if (lock.projectId !== projectId)
        return { status: 'invalid', lock, identity };
      const active = lock.hostname !== os.hostname() || isProcessAlive(lock.coreProcessId);
      return { status: active ? 'active' : 'stale', lock, identity };
    } catch (error) {
      if (isNotFound(error))
        return { status: 'available' };
      throw new VoxWeaverError('PROJECT_DATABASE_INVALID', '项目写锁无法读取。', false);
    }
  }

  async acquireWriteLock(input: AcquireProjectWriteLockInput): Promise<ProjectWriteLock> {
    const rootPath = path.resolve(input.rootPath);
    const stateDirectory = path.join(rootPath, 'state');
    await assertPhysicalDirectory(stateDirectory, 'PROJECT_DATABASE_INVALID');
    const lockDirectory = path.join(stateDirectory, 'locks');
    try {
      await mkdir(lockDirectory, { recursive: false, mode: 0o700 });
    } catch (error) {
      if (!isAlreadyExists(error))
        throw error;
      await assertPhysicalDirectory(lockDirectory, 'PROJECT_DATABASE_INVALID');
    }
    const lockPath = path.join(lockDirectory, 'write-lock.json');
    const existing = await this.inspectWriteLock(rootPath, input.projectId);
    if (existing.status === 'active')
      throw new VoxWeaverError('PROJECT_WRITE_LOCK_ACTIVE', '项目正在由其他会话写入。', false);
    if (existing.status === 'invalid')
      throw new VoxWeaverError('PROJECT_WRITE_LOCK_STALE', '项目写锁无效，需要人工检查。', false);
    if (existing.status === 'stale') {
      if (!input.recoverStale
        || !input.expectedStaleIdentity
        || !sameFileIdentity(existing.identity, input.expectedStaleIdentity)) {
        throw new VoxWeaverError('PROJECT_WRITE_LOCK_STALE', '项目存在失效写锁，需要确认恢复。', false);
      }
      const staleBackup = path.join(
        rootPath,
        'state',
        'backups',
        `stale-lock-${Date.now()}-${randomUUID()}.json`,
      );
      await rename(lockPath, staleBackup);
      await syncDirectory(lockDirectory);
    }

    const lock: ProjectWriteLock = {
      schemaVersion: 1,
      projectId: input.projectId,
      appInstanceId: input.appInstanceId,
      projectSessionId: input.projectSessionId,
      coreProcessId: process.pid,
      hostname: os.hostname(),
      acquiredAt: new Date().toISOString(),
    };
    try {
      await writeJsonFileExclusive(lockPath, lock);
    } catch (error) {
      if (isAlreadyExists(error))
        throw new VoxWeaverError('PROJECT_WRITE_LOCK_ACTIVE', '项目写锁被其他会话抢先获取。', false);
      throw error;
    }
    return lock;
  }

  async releaseWriteLock(rootPath: string, expected: ProjectWriteLock): Promise<void> {
    const lockPath = path.join(path.resolve(rootPath), ...PROJECT_WRITE_LOCK_RELATIVE_PATH.split('/'));
    try {
      const current = parseProjectWriteLock(JSON.parse(await readFile(lockPath, 'utf8')));
      if (current.projectId !== expected.projectId
        || current.appInstanceId !== expected.appInstanceId
        || current.projectSessionId !== expected.projectSessionId
        || current.coreProcessId !== expected.coreProcessId) {
        throw new VoxWeaverError('PROJECT_SESSION_STALE', '项目写锁已属于其他会话。', false);
      }
      await unlink(lockPath);
      await syncDirectory(path.dirname(lockPath));
    } catch (error) {
      if (isNotFound(error))
        return;
      throw error;
    }
  }

  async readLastPage(rootPath: string): Promise<WorkspacePageKey | undefined> {
    const database = new DatabaseSync(path.join(rootPath, PROJECT_STATE_DATABASE_PATH), { readOnly: true, timeout: 5_000 });
    try {
      const row = database.prepare('SELECT last_page_key FROM workspace_state WHERE singleton = 1').get() as { last_page_key?: unknown } | undefined;
      return isWorkspacePageKey(row?.last_page_key) ? row.last_page_key : undefined;
    } finally {
      database.close();
    }
  }

  async recordLastPage(rootPath: string, pageKey: WorkspacePageKey): Promise<void> {
    if (!isWorkspacePageKey(pageKey))
      throw new VoxWeaverError('IPC_PAYLOAD_INVALID', '工作台页面键无效。', false);
    const database = new DatabaseSync(path.join(rootPath, PROJECT_STATE_DATABASE_PATH), { timeout: 5_000 });
    try {
      database.prepare(`
        INSERT INTO workspace_state (singleton, last_page_key, updated_at)
        VALUES (1, ?, ?)
        ON CONFLICT(singleton) DO UPDATE SET
          last_page_key = excluded.last_page_key,
          updated_at = excluded.updated_at
      `).run(pageKey, new Date().toISOString());
    } finally {
      database.close();
    }
  }

  async #reachMigrationPhase(phase: ProjectMigrationPhase): Promise<void> {
    await this.#onMigrationPhase(phase);
  }

  async #verifyCurrentProjectWithoutRecovery(rootPath: string): Promise<OpenedProject> {
    const canonicalRootPath = await assertNoSymbolicLinkComponents(rootPath);
    const manifest = parseProjectManifest(await readAnyManifest(rootPath));
    for (const directoryName of REQUIRED_TOP_LEVEL_DIRECTORIES)
      await assertPhysicalDirectory(path.join(rootPath, directoryName), 'PROJECT_DATABASE_INVALID');
    await assertSourceAsset(rootPath, manifest);
    verifyProjectDatabase(path.join(rootPath, PROJECT_STATE_DATABASE_PATH), manifest);
    return { rootPath, canonicalRootPath, manifest };
  }
}
