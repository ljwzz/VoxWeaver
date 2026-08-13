import type { CoreEventEnvelope } from '@voxweaver/contracts';
import path from 'node:path';
import { NovelImportService } from './novelImportService.ts';
import { ProjectSessionRegistry } from './projectSessionRegistry.ts';
import { SqliteProjectCatalog } from './sqliteProjectCatalog.ts';

export class AppCoreService {
  readonly sessions: ProjectSessionRegistry;
  readonly novelImport: NovelImportService;
  readonly #catalog: SqliteProjectCatalog;
  #closed = false;

  constructor(
    userDataPath: string,
    appInstanceId: string,
    emitEvent?: (event: CoreEventEnvelope) => void,
  ) {
    this.#catalog = new SqliteProjectCatalog(path.join(userDataPath, 'app-data', 'catalog.sqlite'));
    this.sessions = new ProjectSessionRegistry({
      appInstanceId,
      catalog: this.#catalog,
    });
    this.novelImport = new NovelImportService(this.sessions, { ...(emitEvent ? { emitEvent } : {}) });
  }

  async close(): Promise<void> {
    if (this.#closed)
      return;
    this.#closed = true;
    await this.novelImport.waitForIdle();
    await this.sessions.closeAll();
    this.#catalog.close();
  }
}
