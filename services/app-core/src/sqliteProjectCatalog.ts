import type { ProjectCatalogPort, ProjectCatalogRecord } from '@voxweaver/application';

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

interface CatalogRow {
  project_id: string;
  display_name: string;
  directory_path: string;
  source_file_name: string;
  created_at: string;
  last_opened_at: string;
}

function fromRow(row: CatalogRow): ProjectCatalogRecord {
  return {
    projectId: row.project_id,
    displayName: row.display_name,
    directoryPath: row.directory_path,
    sourceFileName: row.source_file_name,
    createdAt: row.created_at,
    lastOpenedAt: row.last_opened_at,
  };
}

export class SqliteProjectCatalog implements ProjectCatalogPort {
  readonly #database: DatabaseSync;

  constructor(databasePath: string) {
    mkdirSync(path.dirname(databasePath), { recursive: true, mode: 0o700 });
    this.#database = new DatabaseSync(databasePath, { timeout: 5_000 });
    this.#database.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA user_version = 1;
      CREATE TABLE IF NOT EXISTS recent_project (
        project_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        directory_path TEXT NOT NULL UNIQUE,
        source_file_name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_opened_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS recent_project_last_opened
        ON recent_project(last_opened_at DESC);
    `);
  }

  close(): void {
    this.#database.close();
  }

  async get(projectId: string): Promise<ProjectCatalogRecord | undefined> {
    const row = this.#database.prepare(`
      SELECT project_id, display_name, directory_path, source_file_name, created_at, last_opened_at
      FROM recent_project
      WHERE project_id = ?
    `).get(projectId) as CatalogRow | undefined;

    return row ? fromRow(row) : undefined;
  }

  async list(): Promise<ProjectCatalogRecord[]> {
    const rows = this.#database.prepare(`
      SELECT project_id, display_name, directory_path, source_file_name, created_at, last_opened_at
      FROM recent_project
      ORDER BY last_opened_at DESC, project_id ASC
    `).all() as unknown as CatalogRow[];

    return rows.map(fromRow);
  }

  async remove(projectId: string): Promise<void> {
    this.#database.prepare('DELETE FROM recent_project WHERE project_id = ?').run(projectId);
  }

  async upsert(record: ProjectCatalogRecord): Promise<void> {
    this.#database.exec('BEGIN IMMEDIATE;');
    try {
      this.#database.prepare(`
        DELETE FROM recent_project
        WHERE directory_path = ? AND project_id <> ?
      `).run(record.directoryPath, record.projectId);
      this.#database.prepare(`
        INSERT INTO recent_project (
          project_id, display_name, directory_path, source_file_name, created_at, last_opened_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(project_id) DO UPDATE SET
          display_name = excluded.display_name,
          directory_path = excluded.directory_path,
          source_file_name = excluded.source_file_name,
          created_at = excluded.created_at,
          last_opened_at = excluded.last_opened_at
      `).run(
        record.projectId,
        record.displayName,
        record.directoryPath,
        record.sourceFileName,
        record.createdAt,
        record.lastOpenedAt,
      );
      this.#database.exec('COMMIT;');
    } catch (error) {
      this.#database.exec('ROLLBACK;');
      throw error;
    }
  }
}
