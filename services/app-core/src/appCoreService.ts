import path from 'node:path';
import { ProjectApplicationService } from '@voxweaver/application';
import { NodeProjectWorkspace } from '@voxweaver/project-workspace';
import { SqliteProjectCatalog } from './sqliteProjectCatalog.ts';

export class AppCoreService {
  readonly projects: ProjectApplicationService;
  readonly #catalog: SqliteProjectCatalog;

  constructor(userDataPath: string) {
    const workspace = new NodeProjectWorkspace();
    this.#catalog = new SqliteProjectCatalog(path.join(userDataPath, 'app-data', 'catalog.sqlite'));
    this.projects = new ProjectApplicationService(workspace, this.#catalog);
  }

  close(): void {
    this.#catalog.close();
  }
}
