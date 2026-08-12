import type { ProjectManifest, RecentProjectAvailability, RecentProjectSummary } from '@voxweaver/contracts';

import { VoxWeaverError } from '@voxweaver/contracts';

export interface OpenedProject {
  rootPath: string;
  manifest: ProjectManifest;
}

export interface ProjectInspection {
  availability: RecentProjectAvailability;
  manifest?: ProjectManifest;
}

export interface ProjectWorkspacePort {
  createProject: (input: {
    displayName: string;
    rootPath: string;
    sourcePath: string;
  }) => Promise<OpenedProject>;
  inspectProject: (rootPath: string, expectedProjectId?: string) => Promise<ProjectInspection>;
  openProject: (rootPath: string) => Promise<OpenedProject>;
}

export interface ProjectCatalogRecord {
  projectId: string;
  displayName: string;
  directoryPath: string;
  sourceFileName: string;
  createdAt: string;
  lastOpenedAt: string;
}

export interface ProjectCatalogPort {
  get: (projectId: string) => Promise<ProjectCatalogRecord | undefined>;
  list: () => Promise<ProjectCatalogRecord[]>;
  remove: (projectId: string) => Promise<void>;
  upsert: (record: ProjectCatalogRecord) => Promise<void>;
}

const RECENT_PROJECT_INSPECTION_CONCURRENCY = 8;

async function mapWithConcurrency<Input, Output>(
  inputs: readonly Input[],
  concurrency: number,
  mapper: (input: Input) => Promise<Output>,
): Promise<Output[]> {
  const outputs: Output[] = [];
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < inputs.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      outputs[currentIndex] = await mapper(inputs[currentIndex]!);
    }
  }

  const workerCount = Math.min(concurrency, inputs.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return outputs;
}

export interface ProjectOperationOutcome {
  project: OpenedProject;
  warnings: string[];
}

export class ProjectApplicationService {
  readonly #workspace: ProjectWorkspacePort;
  readonly #catalog: ProjectCatalogPort;
  readonly #now: () => Date;

  constructor(workspace: ProjectWorkspacePort, catalog: ProjectCatalogPort, now: () => Date = () => new Date()) {
    this.#workspace = workspace;
    this.#catalog = catalog;
    this.#now = now;
  }

  async createProject(input: {
    displayName: string;
    rootPath: string;
    sourcePath: string;
  }): Promise<ProjectOperationOutcome> {
    const project = await this.#workspace.createProject(input);
    return this.#recordOpenedProject(project);
  }

  async openProject(rootPath: string): Promise<ProjectOperationOutcome> {
    const project = await this.#workspace.openProject(rootPath);
    return this.#recordOpenedProject(project);
  }

  async openRecentProject(projectId: string): Promise<ProjectOperationOutcome> {
    let record: ProjectCatalogRecord | undefined;
    try {
      record = await this.#catalog.get(projectId);
    } catch {
      throw new VoxWeaverError('CATALOG_UNAVAILABLE', '最近项目目录暂时不可用。');
    }

    if (!record)
      throw new VoxWeaverError('PROJECT_DIRECTORY_INVALID', '最近项目记录不存在。', false);

    return this.openProject(record.directoryPath);
  }

  async listRecentProjects(): Promise<RecentProjectSummary[]> {
    let records: ProjectCatalogRecord[];
    try {
      records = await this.#catalog.list();
    } catch {
      throw new VoxWeaverError('CATALOG_UNAVAILABLE', '最近项目目录暂时不可用。');
    }

    return mapWithConcurrency(records, RECENT_PROJECT_INSPECTION_CONCURRENCY, async (record) => {
      const inspection = await this.#workspace.inspectProject(record.directoryPath, record.projectId);
      return {
        projectId: record.projectId,
        displayName: record.displayName,
        sourceFileName: record.sourceFileName,
        createdAt: record.createdAt,
        directoryPath: record.directoryPath,
        lastOpenedAt: record.lastOpenedAt,
        availability: inspection.availability,
      };
    });
  }

  async removeRecentProject(projectId: string): Promise<void> {
    try {
      await this.#catalog.remove(projectId);
    } catch {
      throw new VoxWeaverError('CATALOG_UNAVAILABLE', '无法移除最近项目记录。');
    }
  }

  async #recordOpenedProject(project: OpenedProject): Promise<ProjectOperationOutcome> {
    const warnings: string[] = [];
    const record: ProjectCatalogRecord = {
      projectId: project.manifest.projectId,
      displayName: project.manifest.displayName,
      directoryPath: project.rootPath,
      sourceFileName: project.manifest.sourceAsset.originalName,
      createdAt: project.manifest.createdAt,
      lastOpenedAt: this.#now().toISOString(),
    };

    try {
      await this.#catalog.upsert(record);
    } catch {
      warnings.push('项目已成功打开，但最近项目记录更新失败。');
    }

    return { project, warnings };
  }
}
