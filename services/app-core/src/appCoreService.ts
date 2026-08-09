import type {
  AssertProjectSessionCommand,
  CreateProjectCommand,
  InspectProjectCommand,
  NovelImportBundleV1,
  NovelImportReviewArtifactStorePort,
  NovelImportReviewRevisionEntry,
  NovelImportReviewSelectionRerunnerPort,
  NovelImportTemporaryArtifact,
  NovelImportWorkflowPort,
  OpenProjectCommand,
  ProjectInspectionPreview,
  ProjectWorkflowApplicationService,
  ProjectWorkflowFactory,
  ProjectWorkspacePort,
  RerunNovelImportReviewSelectionCommand,
  ValidateNovelImportBundleCommand,
  WriteNovelImportBundleCommand,
} from '@voxweaver/application';
import type {
  ArtifactRecord,
  ChapterCandidateV1,
  ChapterIndexEntryV1,
  ChapterIndexV1,
  CoverageReportV1,
  CoverageSegmentV1,
  ImportIssueV1,
  NovelImportReviewCommandV1,
  ProjectContext,
  SourceAssetRecord,
  TaskRecord,
  TextRangeV1,
} from '@voxweaver/contracts';
import type { NovelSourceAsset } from '@voxweaver/novel-import';
import type { NormalizationProposalV1 } from '@voxweaver/text-pipeline';

import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
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
  NovelImportReviewApplicationError,
  NovelImportReviewApplicationService,
  ProjectApplicationService,
  ProjectWorkflowApplicationService as WorkflowApplicationService,
} from '@voxweaver/application';
import {
  parseArtifactRevisionDocument,
  parseNovelImportReviewCommandV1,
} from '@voxweaver/contracts';
import {
  TXT_SOURCE_ADAPTER_ID,
  TxtSourceAdapter,
} from '@voxweaver/novel-import';
import {
  NodeProjectWorkflow,
  NodeProjectWorkspace,
} from '@voxweaver/project-workspace';
import {
  buildChapterIndexV1,
  buildDocumentBlockIndexV1,
  detectChapterCandidatesV1,
  discoverNormalizationProposalsV1,
  NORMALIZATION_PROPOSER_ID,
  normalizeTextV1,
} from '@voxweaver/text-pipeline';

const NOVEL_IMPORT_OUTPUT_DIRECTORY = 'novel-import-bundle';
const NOVEL_IMPORT_BUNDLE_FILE = 'bundle.json';
const NOVEL_IMPORT_REVIEW_LOG_ROOT = 'logs/novel-import-review';
const NOVEL_IMPORT_REVIEW_TEMP_ROOT = 'tmp/novel-import-review';
const REVIEW_COMMAND_FILE_PATTERN = /^(\d{12})\.json$/u;
const UUID_V4_PATTERN
  = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const NORMALIZATION_POLICY = Object.freeze({
  contextLineLimit: 2,
  maxPreservedBlankLines: 2,
  repeatedLineMinimumGapLines: 3,
  repeatedLineMinimumOccurrences: 3,
});

export interface AppCoreServiceOptions {
  projectWorkspace?: ProjectWorkspacePort;
  projectWorkflowFactory?: ProjectWorkflowFactory;
}

export class AppCoreService {
  readonly #projects: ProjectApplicationService;
  readonly novelImport: NovelImportApplicationService;
  readonly novelImportReview: NovelImportReviewApplicationService;
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
    this.novelImportReview = new NovelImportReviewApplicationService(
      this.#projects,
      context => adaptNovelImportReviewWorkflow(workflowFactory(context)),
      context => new NodeNovelImportReviewArtifactStore(
        context,
        workflowFactory(context),
      ),
      () => new DeterministicNovelImportReviewSelectionRerunner(),
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

function adaptNovelImportReviewWorkflow(
  workflow: ReturnType<ProjectWorkflowFactory>,
): ReturnType<ProjectWorkflowFactory> {
  return new Proxy(workflow, {
    get(target, property, receiver) {
      if (property === 'previewArtifactImpact') {
        return async (
          command: Parameters<typeof target.previewArtifactImpact>[0],
        ) => {
          const preview = await target.previewArtifactImpact(command);
          return {
            ...preview,
            impacts: preview.impacts.map(item => (
              item.depth === 1
              && item.producerArtifactId === preview.producerArtifactId
                ? {
                    ...item,
                    producerRevisionId: preview.producerRevisionId,
                  }
                : item
            )),
          };
        };
      }
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

class NodeNovelImportReviewArtifactStore
implements NovelImportReviewArtifactStorePort {
  readonly #context: ProjectContext;
  readonly #workflow: ReturnType<ProjectWorkflowFactory>;

  constructor(
    context: ProjectContext,
    workflow: ReturnType<ProjectWorkflowFactory>,
  ) {
    this.#context = context;
    this.#workflow = workflow;
  }

  readBundle(artifact: ArtifactRecord): Promise<NovelImportBundleV1> {
    return readCommittedNovelImportBundle(this.#context, artifact);
  }

  async listRevisions(
    artifactId: string,
  ): Promise<readonly NovelImportReviewRevisionEntry[]> {
    const records = await listNovelImportArtifactRecords(
      this.#context,
      this.#workflow,
      artifactId,
    );
    return Promise.all(records.map(async artifact => ({
      artifact,
      bundle: await readCommittedNovelImportBundle(this.#context, artifact),
    })));
  }

  listMetadataCommands(
    artifact: ArtifactRecord,
  ): Promise<readonly NovelImportReviewCommandV1[]> {
    return readNovelImportReviewMetadata(this.#context, artifact);
  }

  async appendMetadataCommand(
    command: Parameters<
      NovelImportReviewArtifactStorePort['appendMetadataCommand']
    >[0],
  ): ReturnType<NovelImportReviewArtifactStorePort['appendMetadataCommand']> {
    assertArtifactComponent(command.artifactId, 'artifact ID');
    assertArtifactComponent(
      command.expectedCurrentRevisionId,
      'artifact revision ID',
    );
    const observed = await currentNovelImportRevisionId(
      this.#context,
      this.#workflow,
      command.artifactId,
    );
    if (observed !== command.expectedCurrentRevisionId) {
      return {
        status: 'conflict',
        currentArtifactRevisionId: observed,
      };
    }

    const relativeDirectory = metadataRelativeDirectory(
      command.artifactId,
      command.expectedCurrentRevisionId,
    );
    const directory = await ensurePhysicalProjectDirectory(
      this.#context,
      relativeDirectory,
      'logs',
    );
    const rechecked = await currentNovelImportRevisionId(
      this.#context,
      this.#workflow,
      command.artifactId,
    );
    if (rechecked !== command.expectedCurrentRevisionId) {
      return {
        status: 'conflict',
        currentArtifactRevisionId: rechecked,
      };
    }

    await appendReviewCommandFile(directory, command.command);
    return {
      status: 'saved',
      currentArtifactRevisionId: command.expectedCurrentRevisionId,
    };
  }

  async stageBundle(
    command: Parameters<NovelImportReviewArtifactStorePort['stageBundle']>[0],
  ): ReturnType<NovelImportReviewArtifactStorePort['stageBundle']> {
    assertArtifactComponent(command.artifactId, 'artifact ID');
    assertArtifactComponent(command.revisionId, 'artifact revision ID');
    const observed = await currentNovelImportRevisionId(
      this.#context,
      this.#workflow,
      command.artifactId,
    );
    if (observed !== command.expectedCurrentRevisionId) {
      return {
        status: 'conflict',
        currentArtifactRevisionId: observed,
      };
    }

    const artifactRootRelativePath = posix.join(
      NOVEL_IMPORT_REVIEW_TEMP_ROOT,
      command.artifactId,
    );
    const artifactRoot = await ensurePhysicalProjectDirectory(
      this.#context,
      artifactRootRelativePath,
      'tmp',
    );
    const rechecked = await currentNovelImportRevisionId(
      this.#context,
      this.#workflow,
      command.artifactId,
    );
    if (rechecked !== command.expectedCurrentRevisionId) {
      return {
        status: 'conflict',
        currentArtifactRevisionId: rechecked,
      };
    }

    const revisionRoot = join(artifactRoot, command.revisionId);
    try {
      await mkdir(revisionRoot, { mode: 0o700 });
    } catch (error) {
      if (isFileSystemError(error, 'EEXIST')) {
        reviewDependencyUnavailable(
          'review_revision_stage_conflict',
          'The selected review revision already has staged content.',
        );
      }
      throw error;
    }
    await assertPhysicalDirectory(revisionRoot);
    const outputRelativePath = posix.join(
      artifactRootRelativePath,
      command.revisionId,
      'output',
    );
    const outputDirectory = join(revisionRoot, 'output');
    await mkdir(outputDirectory, { mode: 0o700 });
    await assertPhysicalDirectory(outputDirectory);
    await writeExclusivePhysicalFile(
      join(outputDirectory, NOVEL_IMPORT_BUNDLE_FILE),
      serializeNovelImportBundle(command.bundle),
    );
    return {
      status: 'staged',
      currentArtifactRevisionId: command.expectedCurrentRevisionId,
      artifact: { outputDirectory: outputRelativePath },
    };
  }

  async validateStagedBundle(
    command: Parameters<
      NovelImportReviewArtifactStorePort['validateStagedBundle']
    >[0],
  ): Promise<void> {
    const baselineArtifactId = stagedReviewArtifactId(
      command.artifact.outputDirectory,
      command.revisionId,
    );
    const observed = await currentNovelImportRevisionId(
      this.#context,
      this.#workflow,
      baselineArtifactId,
    );
    if (observed !== command.expectedCurrentRevisionId)
      reviewBaselineConflict(observed);

    assertArtifactComponent(command.revisionId, 'artifact revision ID');
    const expectedRelativePath = posix.join(
      NOVEL_IMPORT_REVIEW_TEMP_ROOT,
      baselineArtifactId,
      command.revisionId,
      'output',
    );
    if (command.artifact.outputDirectory !== expectedRelativePath) {
      reviewDependencyUnavailable(
        'review_stage_path_invalid',
        'The staged review bundle is outside its reserved revision directory.',
      );
    }
    const outputDirectory = resolveProjectPath(
      this.#context,
      expectedRelativePath,
      'tmp',
    );
    await assertSingleBundleDirectory(outputDirectory);
    const expected = serializeNovelImportBundle(command.expectedBundle);
    const actual = await readPhysicalUtf8File(
      join(outputDirectory, NOVEL_IMPORT_BUNDLE_FILE),
    );
    if (actual !== expected) {
      reviewDependencyUnavailable(
        'review_stage_content_invalid',
        'The staged review bundle does not match the validated projection.',
      );
    }
    JSON.parse(actual) as NovelImportBundleV1;
  }
}

class DeterministicNovelImportReviewSelectionRerunner
implements NovelImportReviewSelectionRerunnerPort {
  async rerunSelection(
    command: RerunNovelImportReviewSelectionCommand,
  ): Promise<NovelImportBundleV1> {
    return rerunNovelImportSelection(command);
  }
}

async function readCommittedNovelImportBundle(
  context: ProjectContext,
  artifact: ArtifactRecord,
): Promise<NovelImportBundleV1> {
  const expectedContentPath = posix.join(
    'artifacts',
    'imported',
    artifact.revisionId,
    'content',
  );
  if (
    artifact.storageKind !== 'imported'
    || artifact.contentPath !== expectedContentPath
  ) {
    reviewDependencyUnavailable(
      'review_bundle_path_invalid',
      'The novel import bundle has an invalid project-relative content path.',
    );
  }

  const contentDirectory = resolveProjectPath(
    context,
    expectedContentPath,
    'artifacts',
  );
  await assertSingleBundleDirectory(contentDirectory);
  const contents = await readPhysicalUtf8File(
    join(contentDirectory, NOVEL_IMPORT_BUNDLE_FILE),
  );
  if (hashSingleBundleFile(contents) !== artifact.contentHash) {
    reviewDependencyUnavailable(
      'review_bundle_hash_mismatch',
      'The committed novel import bundle no longer matches its artifact hash.',
    );
  }
  try {
    return JSON.parse(contents) as NovelImportBundleV1;
  } catch {
    reviewDependencyUnavailable(
      'review_bundle_json_invalid',
      'The committed novel import bundle is not valid JSON.',
    );
  }
}

async function listNovelImportArtifactRecords(
  context: ProjectContext,
  workflow: ReturnType<ProjectWorkflowFactory>,
  artifactId: string,
): Promise<readonly ArtifactRecord[]> {
  assertArtifactComponent(artifactId, 'artifact ID');
  const importedRoot = resolveProjectPath(
    context,
    'artifacts/imported',
    'artifacts',
  );
  await assertPhysicalDirectory(importedRoot);
  const entries = await readdir(importedRoot, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
  const records: ArtifactRecord[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      reviewDependencyUnavailable(
        'review_revision_layout_invalid',
        'The imported artifact history contains an unsupported entry.',
      );
    }
    assertArtifactComponent(entry.name, 'artifact revision directory');
    const revisionDirectory = join(importedRoot, entry.name);
    await assertPhysicalDirectory(revisionDirectory);
    const revisionPath = join(revisionDirectory, 'revision.json');
    if (!await physicalFileExists(revisionPath))
      continue;

    let document;
    try {
      document = parseArtifactRevisionDocument(
        JSON.parse(await readPhysicalUtf8File(revisionPath)),
      );
    } catch {
      reviewDependencyUnavailable(
        'review_revision_document_invalid',
        'The imported artifact history contains an invalid revision document.',
      );
    }
    if (
      document.record.revisionId !== entry.name
      || document.record.storageKind !== 'imported'
      || document.record.contentPath !== posix.join(
        'artifacts',
        'imported',
        entry.name,
        'content',
      )
    ) {
      reviewDependencyUnavailable(
        'review_revision_document_mismatch',
        'The imported artifact revision document does not match its directory.',
      );
    }
    if (document.record.artifactId !== artifactId)
      continue;

    const record = await workflow.getArtifactRevision(entry.name);
    if (record === undefined || !sameStoredArtifact(record, document.record)) {
      reviewDependencyUnavailable(
        'review_revision_state_mismatch',
        'The imported artifact history does not match project state.',
      );
    }
    records.push(record);
  }

  return records.sort((left, right) => (
    left.createdAt.localeCompare(right.createdAt, 'en')
    || left.revisionId.localeCompare(right.revisionId, 'en')
  ));
}

async function currentNovelImportRevisionId(
  context: ProjectContext,
  workflow: ReturnType<ProjectWorkflowFactory>,
  artifactId: string,
): Promise<string> {
  const records = await listNovelImportArtifactRecords(
    context,
    workflow,
    artifactId,
  );
  const current = records.filter(record => record.validityStatus === 'current');
  if (current.length !== 1) {
    reviewDependencyUnavailable(
      'review_current_revision_invalid',
      'The novel import artifact must have exactly one current revision.',
    );
  }
  return current[0].revisionId;
}

function sameStoredArtifact(
  current: ArtifactRecord,
  immutable: ArtifactRecord,
): boolean {
  return current.artifactId === immutable.artifactId
    && current.artifactType === immutable.artifactType
    && current.lineageId === immutable.lineageId
    && current.revisionId === immutable.revisionId
    && current.storageKind === immutable.storageKind
    && current.contentPath === immutable.contentPath
    && current.contentHash === immutable.contentHash
    && current.inputFingerprint === immutable.inputFingerprint
    && current.processorId === immutable.processorId
    && current.processorVersion === immutable.processorVersion
    && current.parametersHash === immutable.parametersHash
    && current.createdAt === immutable.createdAt
    && current.createdBy === immutable.createdBy
    && current.scope.kind === immutable.scope.kind
    && current.scope.identifiers.length === immutable.scope.identifiers.length
    && current.scope.identifiers.every((identifier, index) =>
      identifier === immutable.scope.identifiers[index]);
}

async function readNovelImportReviewMetadata(
  context: ProjectContext,
  artifact: ArtifactRecord,
): Promise<readonly NovelImportReviewCommandV1[]> {
  const relativeDirectory = metadataRelativeDirectory(
    artifact.artifactId,
    artifact.revisionId,
  );
  const directory = await resolveOptionalPhysicalProjectDirectory(
    context,
    relativeDirectory,
    'logs',
  );
  if (directory === undefined)
    return [];

  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
  const commands: NovelImportReviewCommandV1[] = [];
  for (const [index, entry] of entries.entries()) {
    const match = REVIEW_COMMAND_FILE_PATTERN.exec(entry.name);
    if (
      match === null
      || !entry.isFile()
      || entry.isSymbolicLink()
      || Number(match[1]) !== index + 1
    ) {
      reviewDependencyUnavailable(
        'review_metadata_layout_invalid',
        'The novel import review metadata log is not a contiguous append-only sequence.',
      );
    }
    try {
      commands.push(parseNovelImportReviewCommandV1(
        JSON.parse(await readPhysicalUtf8File(join(directory, entry.name))),
      ));
    } catch {
      reviewDependencyUnavailable(
        'review_metadata_command_invalid',
        'The novel import review metadata log contains an invalid command.',
      );
    }
  }
  return commands;
}

async function appendReviewCommandFile(
  directory: string,
  command: NovelImportReviewCommandV1,
): Promise<void> {
  for (;;) {
    const entries = await readdir(directory, { withFileTypes: true });
    let highest = 0;
    for (const entry of entries) {
      const match = REVIEW_COMMAND_FILE_PATTERN.exec(entry.name);
      if (match === null || !entry.isFile() || entry.isSymbolicLink()) {
        reviewDependencyUnavailable(
          'review_metadata_layout_invalid',
          'The novel import review metadata log contains an unsupported entry.',
        );
      }
      highest = Math.max(highest, Number(match[1]));
    }
    const sequence = highest + 1;
    if (!Number.isSafeInteger(sequence) || sequence > 999_999_999_999) {
      reviewDependencyUnavailable(
        'review_metadata_sequence_exhausted',
        'The novel import review metadata sequence is exhausted.',
      );
    }
    const path = join(directory, `${String(sequence).padStart(12, '0')}.json`);
    try {
      await writeExclusivePhysicalFile(
        path,
        `${JSON.stringify(command, undefined, 2)}\n`,
      );
      return;
    } catch (error) {
      if (!isFileSystemError(error, 'EEXIST'))
        throw error;
    }
  }
}

function metadataRelativeDirectory(
  artifactId: string,
  revisionId: string,
): string {
  assertArtifactComponent(artifactId, 'artifact ID');
  assertArtifactComponent(revisionId, 'artifact revision ID');
  return posix.join(NOVEL_IMPORT_REVIEW_LOG_ROOT, artifactId, revisionId);
}

function stagedReviewArtifactId(
  outputDirectory: string,
  revisionId: string,
): string {
  const segments = outputDirectory.split('/');
  if (
    segments.length !== 5
    || segments[0] !== 'tmp'
    || segments[1] !== 'novel-import-review'
    || segments[3] !== revisionId
    || segments[4] !== 'output'
  ) {
    reviewDependencyUnavailable(
      'review_stage_path_invalid',
      'The staged review bundle path does not match its reserved revision.',
    );
  }
  assertArtifactComponent(segments[2], 'artifact ID');
  return segments[2];
}

async function assertSingleBundleDirectory(directory: string): Promise<void> {
  await assertPhysicalDirectory(directory);
  const entries = await readdir(directory, { withFileTypes: true });
  if (
    entries.length !== 1
    || entries[0]?.name !== NOVEL_IMPORT_BUNDLE_FILE
    || !entries[0].isFile()
    || entries[0].isSymbolicLink()
  ) {
    reviewDependencyUnavailable(
      'review_bundle_layout_invalid',
      'A novel import bundle must contain exactly one physical bundle file.',
    );
  }
}

function hashSingleBundleFile(contents: string): string {
  const bytes = Buffer.from(contents, 'utf8');
  return createHash('sha256')
    .update(`file\0${NOVEL_IMPORT_BUNDLE_FILE}\0${bytes.byteLength}\0`)
    .update(bytes)
    .update('\0')
    .digest('hex');
}

async function physicalFileExists(path: string): Promise<boolean> {
  try {
    const entry = await lstat(path);
    if (!entry.isFile() || entry.isSymbolicLink()) {
      reviewDependencyUnavailable(
        'review_revision_layout_invalid',
        'The imported artifact revision document is not a physical file.',
      );
    }
    return true;
  } catch (error) {
    if (isFileSystemError(error, 'ENOENT'))
      return false;
    throw error;
  }
}

async function readPhysicalUtf8File(path: string): Promise<string> {
  let entry;
  try {
    entry = await lstat(path);
  } catch {
    reviewDependencyUnavailable(
      'review_file_unavailable',
      'A required novel import review file is unavailable.',
    );
  }
  if (!entry.isFile() || entry.isSymbolicLink()) {
    reviewDependencyUnavailable(
      'review_file_invalid',
      'A required novel import review file is not a physical file.',
    );
  }
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (
      !opened.isFile()
      || opened.dev !== entry.dev
      || opened.ino !== entry.ino
      || opened.size !== entry.size
    ) {
      reviewDependencyUnavailable(
        'review_file_changed',
        'A novel import review file changed while it was opened.',
      );
    }
    const contents = await handle.readFile({ encoding: 'utf8' });
    const final = await handle.stat();
    if (
      final.dev !== opened.dev
      || final.ino !== opened.ino
      || final.size !== opened.size
    ) {
      reviewDependencyUnavailable(
        'review_file_changed',
        'A novel import review file changed while it was read.',
      );
    }
    return contents;
  } finally {
    await handle.close();
  }
}

async function writeExclusivePhysicalFile(
  path: string,
  contents: string,
): Promise<void> {
  const handle = await open(
    path,
    constants.O_WRONLY
    | constants.O_CREAT
    | constants.O_EXCL
    | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.writeFile(contents, { encoding: 'utf8' });
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function ensurePhysicalProjectDirectory(
  context: ProjectContext,
  relativePath: string,
  requiredRoot: 'logs' | 'tmp',
): Promise<string> {
  resolveProjectPath(context, relativePath, requiredRoot);
  const root = resolveProjectPath(context, requiredRoot, requiredRoot);
  await assertPhysicalDirectory(root);
  const segments = relativePath.split('/');
  const rootSegments = requiredRoot.split('/');
  let current = root;
  for (const segment of segments.slice(rootSegments.length)) {
    current = join(current, segment);
    try {
      await mkdir(current, { mode: 0o700 });
    } catch (error) {
      if (!isFileSystemError(error, 'EEXIST'))
        throw error;
    }
    await assertPhysicalDirectory(current);
  }
  return current;
}

async function resolveOptionalPhysicalProjectDirectory(
  context: ProjectContext,
  relativePath: string,
  requiredRoot: 'logs' | 'tmp',
): Promise<string | undefined> {
  resolveProjectPath(context, relativePath, requiredRoot);
  const root = resolveProjectPath(context, requiredRoot, requiredRoot);
  await assertPhysicalDirectory(root);
  const segments = relativePath.split('/');
  const rootSegments = requiredRoot.split('/');
  let current = root;
  for (const segment of segments.slice(rootSegments.length)) {
    current = join(current, segment);
    try {
      await assertPhysicalDirectory(current);
    } catch (error) {
      if (isFileSystemError(error, 'ENOENT'))
        return undefined;
      throw error;
    }
  }
  return current;
}

function assertArtifactComponent(value: string, label: string): void {
  if (!UUID_V4_PATTERN.test(value)) {
    reviewDependencyUnavailable(
      'review_artifact_identity_invalid',
      `The novel import review ${label} is invalid.`,
    );
  }
}

function reviewBaselineConflict(currentRevisionId: string): never {
  throw new NovelImportReviewApplicationError(
    'NOVEL_IMPORT_REVIEW_REQUIRED',
    'baseline_revision_stale',
    `The review baseline changed to revision ${currentRevisionId}.`,
  );
}

function reviewDependencyUnavailable(
  detailReason: string,
  message: string,
): never {
  throw new NovelImportReviewApplicationError(
    'NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE',
    detailReason,
    message,
  );
}

function isFileSystemError(
  error: unknown,
  code: string,
): error is NodeJS.ErrnoException {
  return error instanceof Error
    && 'code' in error
    && Reflect.get(error, 'code') === code;
}

function rerunNovelImportSelection(
  command: RerunNovelImportReviewSelectionCommand,
): NovelImportBundleV1 {
  const baseline = command.baselineBundle;
  const selectedRanges = selectedReviewRanges(baseline, command.selector);
  const rebuiltBlockIndex = buildDocumentBlockIndexV1({
    importedNovel: baseline.importedNovel,
    canonicalText: baseline.canonical.text,
    canonicalTextRevision: baseline.canonical.revision,
    rawToCanonicalRangeMap: baseline.canonical.rawToCanonicalRangeMap,
    previousIndex: baseline.blockIndex,
  });
  const blockIndex = {
    ...baseline.blockIndex,
    blocks: baseline.blockIndex.blocks.map((block) => {
      if (!rangeIntersectsAny(block.canonicalRange, selectedRanges))
        return block;
      const refreshed = rebuiltBlockIndex.blocks.find(
        item => item.blockId === block.blockId,
      );
      if (refreshed === undefined) {
        reviewStructureInvalid(
          'rerun_selected_block_missing',
          'Selected-range processing removed an immutable source-backed block.',
        );
      }
      return refreshed;
    }),
    issues: baseline.blockIndex.issues,
    reviewStatus: baseline.blockIndex.reviewStatus,
  };

  const detectedCandidates = detectChapterCandidatesV1(blockIndex, {
    candidateIdFactory: queuedIdFactory(
      baseline.chapterCandidates.map(candidate => candidate.chapterCandidateId),
    ),
  });
  const chapterCandidates = mergeSelectedCandidates(
    baseline.chapterCandidates,
    detectedCandidates,
    selectedRanges,
  );
  const rebuiltChapterIndex = buildChapterIndexV1({
    blockIndex,
    candidates: chapterCandidates,
    options: {
      chapterIdFactory: queuedIdFactory(
        baseline.chapterIndex.entries.map(entry => entry.chapterId),
      ),
      issueIdFactory: queuedIdFactory(
        baseline.chapterIndex.issues.map(issue => issue.issueId),
      ),
      volumeIdFactory: queuedIdFactory(uniqueStrings(
        baseline.chapterIndex.entries.flatMap(entry =>
          entry.volumeId === undefined ? [] : [entry.volumeId]),
      )),
    },
  });
  const chapterIndex = mergeSelectedChapterIndex(
    baseline.chapterIndex,
    rebuiltChapterIndex,
    chapterCandidates,
    selectedRanges,
    new Set(command.selector.chapterIds ?? []),
  );

  const discoveredProposals = carryNormalizationReviewDecisions(
    discoverNormalizationProposalsV1({
      canonicalTextRevision: baseline.canonical.revision,
      canonicalText: baseline.canonical.text,
      chapterIndex,
      options: {
        ...NORMALIZATION_POLICY,
        proposalIdFactory: queuedIdFactory(
          baseline.normalization.proposals.map(proposal => proposal.proposalId),
        ),
        proposedBy: NORMALIZATION_PROPOSER_ID,
      },
    }),
    baseline.normalization.proposals,
  );
  const proposals = mergeSelectedNormalizationProposals(
    baseline.normalization.proposals,
    discoveredProposals,
    selectedRanges,
  );
  const selectedProposalIds = proposals
    .filter(proposal => proposal.reviewStatus === 'approved')
    .map(proposal => proposal.proposalId);
  const projectedNormalization = normalizeTextV1({
    canonicalTextRevision: baseline.canonical.revision,
    canonicalText: baseline.canonical.text,
    proposals,
    mode: 'apply',
    selectedProposalIds,
    normalizedTextRevisionId:
      baseline.normalization.result.normalizedTextRevision.textRevisionId,
  });
  if (!projectedNormalization.applied) {
    reviewStructureInvalid(
      'rerun_normalization_not_materialized',
      'Selected-range processing did not materialize normalized text.',
    );
  }
  const normalizationResult = JSON.stringify(projectedNormalization)
    === JSON.stringify(baseline.normalization.result)
    ? baseline.normalization.result
    : materializeRerunNormalization(baseline, proposals, selectedProposalIds);
  const dependencySelector = {
    blockIds: blockIndex.blocks.map(block => block.blockId),
    ...(chapterIndex.entries.length === 0
      ? {}
      : { chapterIds: chapterIndex.entries.map(entry => entry.chapterId) }),
  };
  const rerun: NovelImportBundleV1 = {
    ...baseline,
    blockIndex,
    chapterCandidates,
    chapterIndex,
    normalization: {
      proposals,
      result: normalizationResult,
    },
    dependencySelector,
  };
  return sameRerunProjection(rerun, baseline) ? baseline : rerun;
}

function materializeRerunNormalization(
  baseline: NovelImportBundleV1,
  proposals: readonly NormalizationProposalV1[],
  selectedProposalIds: readonly string[],
): NovelImportBundleV1['normalization']['result'] {
  const result = normalizeTextV1({
    canonicalTextRevision: baseline.canonical.revision,
    canonicalText: baseline.canonical.text,
    proposals,
    mode: 'apply',
    selectedProposalIds,
    normalizedTextRevisionId: randomUUID(),
  });
  if (!result.applied) {
    reviewStructureInvalid(
      'rerun_normalization_not_materialized',
      'Selected-range processing did not materialize normalized text.',
    );
  }
  return result;
}

function selectedReviewRanges(
  bundle: NovelImportBundleV1,
  selector: RerunNovelImportReviewSelectionCommand['selector'],
): readonly TextRangeV1[] {
  const blockIds = new Set(selector.blockIds ?? []);
  const chapterIds = new Set(selector.chapterIds ?? []);
  return [
    ...bundle.blockIndex.blocks
      .filter(block => blockIds.has(block.blockId))
      .map(block => block.canonicalRange),
    ...bundle.chapterIndex.entries
      .filter(entry => chapterIds.has(entry.chapterId))
      .map(combinedChapterRange),
  ];
}

function mergeSelectedCandidates(
  baseline: readonly ChapterCandidateV1[],
  refreshed: readonly ChapterCandidateV1[],
  selectedRanges: readonly TextRangeV1[],
): readonly ChapterCandidateV1[] {
  return [
    ...baseline.filter(candidate =>
      !rangeIntersectsAny(candidate.headingRange, selectedRanges)),
    ...refreshed.filter(candidate =>
      rangeIntersectsAny(candidate.headingRange, selectedRanges)),
  ].sort(compareRangedValues);
}

function mergeSelectedChapterIndex(
  baseline: ChapterIndexV1,
  refreshed: ChapterIndexV1,
  candidates: readonly ChapterCandidateV1[],
  selectedRanges: readonly TextRangeV1[],
  selectedChapterIds: ReadonlySet<string>,
): ChapterIndexV1 {
  const entries = [
    ...baseline.entries.filter(entry => (
      !selectedChapterIds.has(entry.chapterId)
      && !rangeIntersectsAny(combinedChapterRange(entry), selectedRanges)
    )),
    ...refreshed.entries.filter(entry => (
      selectedChapterIds.has(entry.chapterId)
      || rangeIntersectsAny(combinedChapterRange(entry), selectedRanges)
    )),
  ]
    .sort((left, right) => (
      left.headingRange.startByte - right.headingRange.startByte
      || left.headingRange.endByte - right.headingRange.endByte
    ))
    .map((entry, order) => ({ ...entry, order }));
  const issues = mergeSelectedIssues(
    baseline.issues,
    refreshed.issues,
    selectedRanges,
  );
  const pending = candidates.some(candidate => candidate.reviewStatus === 'pending')
    || entries.some(entry => entry.reviewStatus === 'pending')
    || issues.some(issue => issue.reviewStatus === 'pending');
  return {
    ...baseline,
    candidates,
    entries,
    coverageReport: mergeCoverageReports(
      baseline.coverageReport,
      refreshed.coverageReport,
      selectedRanges,
    ),
    issues,
    reviewStatus: pending
      ? 'pending'
      : baseline.reviewStatus === 'pending'
        ? refreshed.reviewStatus
        : baseline.reviewStatus,
  };
}

function mergeSelectedIssues(
  baseline: readonly ImportIssueV1[],
  refreshed: readonly ImportIssueV1[],
  selectedRanges: readonly TextRangeV1[],
): readonly ImportIssueV1[] {
  const issues = [
    ...baseline.filter(issue => issue.textRange === undefined
      || !rangeIntersectsAny(issue.textRange, selectedRanges)),
    ...refreshed.filter(issue => issue.textRange !== undefined
      && rangeIntersectsAny(issue.textRange, selectedRanges)),
  ];
  const byId = new Map<string, ImportIssueV1>();
  for (const issue of issues)
    byId.set(issue.issueId, issue);
  return [...byId.values()];
}

function mergeCoverageReports(
  baseline: CoverageReportV1,
  refreshed: CoverageReportV1,
  selectedRanges: readonly TextRangeV1[],
): CoverageReportV1 {
  const boundaries = uniqueNumbers([
    0,
    baseline.totalByteLength,
    ...baseline.segments.flatMap(segment => [
      segment.range.startByte,
      segment.range.endByte,
    ]),
    ...baseline.unclassifiedRanges.flatMap(range => [
      range.startByte,
      range.endByte,
    ]),
    ...refreshed.segments.flatMap(segment => [
      segment.range.startByte,
      segment.range.endByte,
    ]),
    ...refreshed.unclassifiedRanges.flatMap(range => [
      range.startByte,
      range.endByte,
    ]),
    ...selectedRanges.flatMap(range => [range.startByte, range.endByte]),
  ]).sort((left, right) => left - right);
  const template = baseline.segments[0]?.range
    ?? baseline.unclassifiedRanges[0]
    ?? selectedRanges[0];
  if (template === undefined)
    return baseline;

  const segments: CoverageSegmentV1[] = [];
  const unclassifiedRanges: TextRangeV1[] = [];
  for (let index = 1; index < boundaries.length; index += 1) {
    const startByte = boundaries[index - 1];
    const endByte = boundaries[index];
    if (startByte === endByte)
      continue;
    const range = rangeLike(template, startByte, endByte);
    const source = rangeIntersectsAny(range, selectedRanges)
      ? refreshed
      : baseline;
    const coverage = coverageAt(source, startByte, endByte);
    if (coverage === 'unclassified') {
      appendAdjacentRange(unclassifiedRanges, range);
    } else {
      appendAdjacentCoverageSegment(segments, coverage, range);
    }
  }
  const classifiedByteLength = segments.reduce(
    (total, segment) => total + rangeLength(segment.range),
    0,
  );
  const unclassifiedByteLength = unclassifiedRanges.reduce(
    (total, range) => total + rangeLength(range),
    0,
  );
  return {
    ...baseline,
    classifiedByteLength,
    unclassifiedByteLength,
    complete: unclassifiedByteLength === 0,
    segments,
    unclassifiedRanges,
  };
}

type CoverageValue = Omit<CoverageSegmentV1, 'range'> | 'unclassified';

function coverageAt(
  report: CoverageReportV1,
  startByte: number,
  endByte: number,
): CoverageValue {
  const segment = report.segments.find(item =>
    item.range.startByte <= startByte && endByte <= item.range.endByte);
  if (segment !== undefined) {
    return segment.classification === 'chapter'
      ? { classification: 'chapter', chapterId: segment.chapterId }
      : { classification: segment.classification };
  }
  if (report.unclassifiedRanges.some(range =>
    range.startByte <= startByte && endByte <= range.endByte)) {
    return 'unclassified';
  }
  reviewStructureInvalid(
    'rerun_coverage_incomplete',
    'Selected-range processing returned incomplete canonical coverage.',
  );
}

function appendAdjacentCoverageSegment(
  target: CoverageSegmentV1[],
  coverage: Exclude<CoverageValue, 'unclassified'>,
  range: TextRangeV1,
): void {
  const next: CoverageSegmentV1 = coverage.classification === 'chapter'
    ? {
        classification: 'chapter',
        chapterId: requireCoverageChapterId(coverage.chapterId),
        range,
      }
    : { classification: coverage.classification, range };
  const previous = target[target.length - 1];
  if (
    previous !== undefined
    && previous.range.endByte === range.startByte
    && previous.classification === next.classification
    && (
      previous.classification !== 'chapter'
      || (next.classification === 'chapter'
        && previous.chapterId === next.chapterId)
    )
  ) {
    target[target.length - 1] = {
      ...previous,
      range: rangeLike(previous.range, previous.range.startByte, range.endByte),
    };
    return;
  }
  target.push(next);
}

function appendAdjacentRange(
  target: TextRangeV1[],
  range: TextRangeV1,
): void {
  const previous = target[target.length - 1];
  if (previous !== undefined && previous.endByte === range.startByte) {
    target[target.length - 1] = rangeLike(
      previous,
      previous.startByte,
      range.endByte,
    );
    return;
  }
  target.push(range);
}

function requireCoverageChapterId(value: string | undefined): string {
  if (value === undefined) {
    reviewStructureInvalid(
      'rerun_coverage_chapter_missing',
      'Selected-range processing returned chapter coverage without a chapter ID.',
    );
  }
  return value;
}

function carryNormalizationReviewDecisions(
  refreshed: readonly NormalizationProposalV1[],
  baseline: readonly NormalizationProposalV1[],
): readonly NormalizationProposalV1[] {
  return refreshed.map((proposal) => {
    const previous = baseline.find(item => (
      item.proposalId === proposal.proposalId
      && sameRange(item.canonicalRange, proposal.canonicalRange)
      && item.ruleId === proposal.ruleId
      && item.ruleVersion === proposal.ruleVersion
      && item.operation === proposal.operation
      && item.beforeText === proposal.beforeText
      && item.afterText === proposal.afterText
    ));
    if (previous === undefined)
      return proposal;
    return {
      ...proposal,
      reviewStatus: previous.reviewStatus,
      ...(previous.reviewedBy === undefined
        ? {}
        : { reviewedBy: previous.reviewedBy }),
      ...(previous.operator === undefined
        ? {}
        : { operator: previous.operator }),
    };
  });
}

function mergeSelectedNormalizationProposals(
  baseline: readonly NormalizationProposalV1[],
  refreshed: readonly NormalizationProposalV1[],
  selectedRanges: readonly TextRangeV1[],
): readonly NormalizationProposalV1[] {
  return [
    ...baseline.filter(proposal =>
      !rangeIntersectsAny(proposal.canonicalRange, selectedRanges)),
    ...refreshed.filter(proposal =>
      rangeIntersectsAny(proposal.canonicalRange, selectedRanges)),
  ].sort(compareRangedValues);
}

function queuedIdFactory(ids: readonly string[]): () => string {
  let position = 0;
  return () => ids[position++] ?? randomUUID();
}

function combinedChapterRange(entry: ChapterIndexEntryV1): TextRangeV1 {
  return rangeLike(
    entry.headingRange,
    entry.headingRange.startByte,
    entry.contentRange.endByte,
  );
}

function rangeLike(
  template: TextRangeV1,
  startByte: number,
  endByte: number,
): TextRangeV1 {
  return { ...template, startByte, endByte };
}

function sameRange(left: TextRangeV1, right: TextRangeV1): boolean {
  return left.textRevisionId === right.textRevisionId
    && left.textLayer === right.textLayer
    && left.offsetUnit === right.offsetUnit
    && left.startByte === right.startByte
    && left.endByte === right.endByte;
}

function rangeIntersectsAny(
  range: TextRangeV1,
  selectedRanges: readonly TextRangeV1[],
): boolean {
  return selectedRanges.some(selected => (
    range.startByte < selected.endByte
    && selected.startByte < range.endByte
  ));
}

interface RangedValue {
  readonly canonicalRange?: TextRangeV1;
  readonly headingRange?: TextRangeV1;
}

function compareRangedValues<T extends RangedValue>(left: T, right: T): number {
  const leftRange = left.headingRange ?? left.canonicalRange;
  const rightRange = right.headingRange ?? right.canonicalRange;
  if (leftRange === undefined || rightRange === undefined)
    return 0;
  return leftRange.startByte - rightRange.startByte
    || leftRange.endByte - rightRange.endByte;
}

function rangeLength(range: TextRangeV1): number {
  return range.endByte - range.startByte;
}

function uniqueNumbers(values: readonly number[]): number[] {
  return [...new Set(values)];
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function sameRerunProjection(
  left: NovelImportBundleV1,
  right: NovelImportBundleV1,
): boolean {
  return JSON.stringify({
    blockIndex: left.blockIndex,
    chapterCandidates: left.chapterCandidates,
    chapterIndex: left.chapterIndex,
    normalization: left.normalization,
    dependencySelector: left.dependencySelector,
  }) === JSON.stringify({
    blockIndex: right.blockIndex,
    chapterCandidates: right.chapterCandidates,
    chapterIndex: right.chapterIndex,
    normalization: right.normalization,
    dependencySelector: right.dependencySelector,
  });
}

function reviewStructureInvalid(
  detailReason: string,
  message: string,
): never {
  throw new NovelImportReviewApplicationError(
    'NOVEL_IMPORT_STRUCTURE_INVALID',
    detailReason,
    message,
  );
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
  requiredRoot: 'artifacts' | 'inputs/source-assets' | 'logs' | 'tmp',
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
