import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { TxtSourceAdapter } from '@voxweaver/novel-import';
import {
  buildChapterIndexV1,
  buildDocumentBlockIndexV1,
  canonicalizeRawTextV1,
  detectChapterCandidatesV1,
  discoverNormalizationProposalsV1,
  normalizeTextV1,
} from '@voxweaver/text-pipeline';
import { sha256CanonicalJson } from '@voxweaver/workflow-core';

import {
  NOVEL_IMPORT_APPLICATION_PROCESSOR_ID,
  NOVEL_IMPORT_APPLICATION_PROCESSOR_VERSION,
  NOVEL_IMPORT_BUNDLE_ARTIFACT_TYPE,
  NOVEL_IMPORT_BUNDLE_SCHEMA_VERSION,
  NOVEL_IMPORT_REVIEW_APPLICATION_PROCESSOR_ID,
  NOVEL_IMPORT_REVIEW_APPLICATION_PROCESSOR_VERSION,
  NovelImportReviewApplicationError,
  NovelImportReviewApplicationService,
  ProjectApplicationService,
} from '../dist/index.js';

const PROJECT_ID = uuid(1);
const PROJECT_SESSION_ID = uuid(2);
const STALE_SESSION_ID = uuid(3);
const SOURCE_ASSET_ID = uuid(4);
const ARTIFACT_ID = uuid(5);
const ARTIFACT_REVISION_ID = uuid(6);
const NEXT_ACTIVE_REVISION_ID = uuid(7);
const CREATED_AT = '2026-08-09T00:00:00.000Z';
const SOURCE_TEXT = '序言。\n第一章 起点\n正文。\n【广告】测试\n第二章 继续\n后文。\n';
const SOURCE_BYTES = Buffer.from(SOURCE_TEXT, 'utf8');

const baseProject = {
  accessMode: 'read-write',
  projectDirectory: 'project-fixtures/review',
  projectSessionId: PROJECT_SESSION_ID,
  manifest: {
    schemaVersion: 1,
    layoutVersion: 2,
    projectId: PROJECT_ID,
    displayName: 'Review',
    directoryName: `review--${PROJECT_ID}`,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  },
};

test('projects a validated inspection snapshot through a read session', async () => {
  const harness = await createHarness();
  const snapshot = await harness.service.inspect(reviewRequest(harness));

  assert.equal(snapshot.readOnly, false);
  assert.equal(snapshot.source.sourceAssetId, SOURCE_ASSET_ID);
  assert.equal(snapshot.adapter.selectionMethod, 'probe');
  assert.equal(snapshot.textRevisions.length, 3);
  assert.equal(snapshot.layerDiffs.length, 2);
  assert.deepEqual(snapshot.chapters, harness.bundle.chapterIndex.entries);
  assert.equal(snapshot.revisionHistory.length, 1);
  assert.equal(snapshot.revisionHistory[0].active, true);
  const negativeDirectoryCandidates = snapshot.chapterCandidates.filter(candidate =>
    candidate.evidence.includes('directory-context:false'));
  assert.ok(negativeDirectoryCandidates.length > 0);
  assert.ok(negativeDirectoryCandidates.every(candidate =>
    snapshot.tableOfContentsEvidence.every(evidence =>
      !evidence.candidateIds.includes(candidate.chapterCandidateId))));
  assert.deepEqual(harness.calls, [
    'workflow-factory',
    'store-factory',
    'get-artifact',
    'read-bundle',
    'list-metadata',
    'list-revisions',
  ]);
});

test('allows read-only inspection and rejects every write before resolving ports', async () => {
  const harness = await createHarness({ accessMode: 'read-only' });
  const snapshot = await harness.service.inspect(reviewRequest(harness));
  assert.equal(snapshot.readOnly, true);

  harness.calls.length = 0;
  await assert.rejects(
    harness.service.execute(commandRequest(harness, classificationCommand(harness))),
    error => error?.code === 'PROJECT_READ_ONLY',
  );
  assert.deepEqual(harness.calls, []);
});

test('saves an uncovered-range classification as a new immutable revision with a narrow selector', async () => {
  const harness = await createHarness();
  const command = classificationCommand(harness);
  const result = await harness.service.execute(commandRequest(harness, command));

  assert.equal(result.outcome, 'committed');
  assert.equal(result.artifact.revisionId, harness.captures.revisionId);
  assert.equal(result.snapshot.coverage.complete, true);
  assert.ok(result.snapshot.coverage.segments.some(segment =>
    segment.classification === 'noise'
    && sameRange(segment.range, command.targetRange)));
  assert.deepEqual(
    harness.captures.commit.changeSelector,
    harness.captures.expectedSelector,
  );
  assert.equal(harness.captures.commit.artifactId, ARTIFACT_ID);
  assert.equal(harness.captures.commit.processorId, NOVEL_IMPORT_REVIEW_APPLICATION_PROCESSOR_ID);
  assert.equal(
    harness.captures.commit.processorVersion,
    NOVEL_IMPORT_REVIEW_APPLICATION_PROCESSOR_VERSION,
  );
  assert.deepEqual(result.snapshot.revisionHistory.map(item => item.active), [false, true]);
  assert.ok(harness.calls.indexOf('stage-bundle') < harness.calls.indexOf('commit-artifact'));
  assert.equal(harness.calls.filter(call => call === 'get-artifact').length, 3);
});

test('adjusts a chapter heading/content split without changing canonical text', async () => {
  const harness = await createHarness();
  const command = boundaryCommand(harness);
  const result = await harness.service.execute(commandRequest(harness, command));

  assert.equal(result.outcome, 'committed');
  const chapter = result.snapshot.chapters.find(item => item.chapterId === command.chapterId);
  assert.deepEqual(chapter.headingRange, command.headingRange);
  assert.deepEqual(chapter.contentRange, command.contentRange);
  assert.equal(chapter.reviewStatus, 'approved');
  assert.equal(
    result.snapshot.baselineRevision.canonicalTextRevision.textRevisionId,
    harness.bundle.canonical.revision.textRevisionId,
  );
  assert.ok(harness.captures.commit.changeSelector.chapterIds.includes(command.chapterId));
});

test('projects a multi-line manual heading to its own source lines, not the full chapter', async () => {
  const harness = await createHarness();
  const command = multiLineBoundaryCommand(harness);
  const result = await harness.service.execute(commandRequest(harness, command));

  assert.equal(result.outcome, 'committed');
  const chapter = result.snapshot.chapters.find(item =>
    item.chapterId === command.chapterId);
  const candidate = result.snapshot.chapterCandidates.find(item =>
    sameRange(item.headingRange, command.headingRange));
  assert.ok(chapter);
  assert.ok(candidate);
  assert.ok(candidate.lineRange.endLineExclusive
    < chapter.sourceLineRange.endLineExclusive);
  assert.deepEqual(candidate.lineRange, sourceLineRangeForCanonicalRange(
    harness.bundle,
    command.headingRange,
  ));
});

test('accepts a normalization proposal by creating a new normalized revision', async () => {
  const harness = await createHarness();
  const proposal = pendingProposal(harness);
  const result = await harness.service.execute(commandRequest(
    harness,
    normalizationCommand(harness, proposal.proposalId, 'approved'),
  ));

  assert.equal(result.outcome, 'committed');
  const projected = result.snapshot.normalizationProposals.find(
    item => item.proposalId === proposal.proposalId,
  );
  assert.equal(projected.reviewStatus, 'approved');
  assert.equal(projected.reviewedBy, 'operator:test');
  assert.equal(projected.operator, 'operator:operator:test');
  assert.notEqual(
    result.snapshot.textRevisions[2].textRevisionId,
    harness.bundle.normalization.result.normalizedTextRevision.textRevisionId,
  );
  assert.ok(result.snapshot.layerDiffs[1].hunks.length > 0);
});

test('persists rejection and later note-only decisions as metadata without content commit or stale propagation', async () => {
  const harness = await createHarness();
  const proposal = pendingProposal(harness);
  const rejected = normalizationCommand(
    harness,
    proposal.proposalId,
    'rejected',
    'first review',
  );
  const result = await harness.service.execute(commandRequest(harness, rejected));

  assert.equal(result.outcome, 'unchanged');
  assert.equal(result.artifact.revisionId, ARTIFACT_REVISION_ID);
  assert.equal(result.snapshot.normalizationProposals.find(
    item => item.proposalId === proposal.proposalId,
  ).reviewStatus, 'rejected');
  assert.equal(harness.captures.commit, undefined);
  assert.equal(harness.captures.stage, undefined);
  assert.equal(harness.captures.metadata.length, 1);

  harness.calls.length = 0;
  const noted = await harness.service.execute(commandRequest(
    harness,
    normalizationCommand(
      harness,
      proposal.proposalId,
      'rejected',
      'note amended without changing content',
    ),
  ));
  assert.equal(noted.outcome, 'unchanged');
  assert.equal(harness.captures.metadata.length, 2);
  assert.ok(!harness.calls.includes('stage-bundle'));
  assert.ok(!harness.calls.includes('commit-artifact'));
});

test('reruns only the selected range and skips staging when output is identical', async () => {
  const harness = await createHarness();
  const command = rerunCommand(harness);
  const result = await harness.service.execute(commandRequest(harness, command));

  assert.equal(result.outcome, 'unchanged');
  assert.deepEqual(harness.captures.rerun.selector, command.selector);
  assert.equal(harness.captures.stage, undefined);
  assert.equal(harness.captures.commit, undefined);
});

test('rejects an identical rerun when its baseline changes during processing', async () => {
  const harness = await createHarness({ staleAtGet: 2 });
  await assert.rejects(
    harness.service.execute(commandRequest(harness, rerunCommand(harness))),
    baselineConflict,
  );
  assert.notEqual(harness.captures.rerun, undefined);
  assert.equal(harness.captures.stage, undefined);
  assert.equal(harness.captures.commit, undefined);
});

test('reruns a changed selected range and commits the command selector exactly', async () => {
  const harness = await createHarness({ rerunChanges: true });
  const command = rerunCommand(harness);
  const result = await harness.service.execute(commandRequest(harness, command));

  assert.equal(result.outcome, 'committed');
  assert.deepEqual(harness.captures.commit.changeSelector, command.selector);
  assert.deepEqual(harness.captures.rerun.selector, command.selector);
});

test('allows block, candidate, and proposal changes within a selected chapter', async () => {
  const harness = await createHarness({
    rerunChanges: true,
    rerunChapterProjectionChanges: true,
  });
  const command = {
    ...commandBase(harness, 'rerun-selection'),
    selector: {
      chapterIds: [harness.bundle.chapterIndex.entries[0].chapterId],
    },
  };
  const result = await harness.service.execute(commandRequest(harness, command));

  assert.equal(result.outcome, 'committed');
  assert.ok(result.snapshot.chapterCandidates.length
    > harness.bundle.chapterCandidates.length);
  assert.ok(result.snapshot.chapterCandidates.some((candidate, index) =>
    candidate.contextAfter.length
    > (harness.bundle.chapterCandidates[index]?.contextAfter.length ?? 0)));
  assert.ok(harness.captures.stage.bundle.blockIndex.blocks.some((block, index) =>
    block.kind !== harness.bundle.blockIndex.blocks[index].kind));
  assert.ok(harness.captures.stage.bundle.normalization.proposals.some(
    (proposal, index) =>
      proposal.confidence
      !== harness.bundle.normalization.proposals[index].confidence,
  ));
});

test('rejects unknown block and chapter selectors before calling the rerunner', async () => {
  for (const [selector, detailReason] of [
    [{ blockIds: [uuid(9998)] }, 'rerun_selector_block_unknown'],
    [{ chapterIds: [uuid(9999)] }, 'rerun_selector_chapter_unknown'],
  ]) {
    const harness = await createHarness({ rerunChanges: true });
    const command = {
      ...commandBase(harness, 'rerun-selection'),
      selector,
    };
    await assert.rejects(
      harness.service.execute(commandRequest(harness, command)),
      error => error instanceof NovelImportReviewApplicationError
        && error.detailReason === detailReason,
    );
    assert.ok(!harness.calls.includes('rerun-selection'));
    assert.equal(harness.captures.stage, undefined);
    assert.equal(harness.captures.commit, undefined);
  }
});

test('rejects a rerunner projection that changes normalization outside the selector', async () => {
  const harness = await createHarness({ rerunChanges: true, rerunOutOfScope: true });
  const command = rerunCommand(harness, 1);
  await assert.rejects(
    harness.service.execute(commandRequest(harness, command)),
    error => error instanceof NovelImportReviewApplicationError
      && error.detailReason === 'rerun_changed_unselected_normalization',
  );
  assert.equal(harness.captures.stage, undefined);
  assert.equal(harness.captures.commit, undefined);
});

test('rejects a rerunner projection that changes a chapter candidate outside the selector', async () => {
  for (const rerunCandidateOutOfScope of ['change', 'add', 'remove']) {
    const harness = await createHarness({
      rerunChanges: true,
      rerunCandidateOutOfScope,
    });
    const command = rerunCommand(harness, 1);
    await assert.rejects(
      harness.service.execute(commandRequest(harness, command)),
      error => error instanceof NovelImportReviewApplicationError
        && error.detailReason === 'rerun_changed_unselected_candidate',
    );
    assert.equal(harness.captures.stage, undefined);
    assert.equal(harness.captures.commit, undefined);
  }
});

test('rejects a rerunner projection that relabels coverage outside the selector', async () => {
  const harness = await createHarness({
    rerunChanges: true,
    rerunCoverageOutOfScope: true,
  });
  const command = rerunCommand(harness, 1);
  await assert.rejects(
    harness.service.execute(commandRequest(harness, command)),
    error => error instanceof NovelImportReviewApplicationError
      && error.detailReason === 'rerun_changed_unselected_coverage',
  );
  assert.equal(harness.captures.stage, undefined);
  assert.equal(harness.captures.commit, undefined);
});

test('rejects ranged chapter and unranged block issue changes outside the selector', async () => {
  for (const rerunIssueOutOfScope of ['chapter', 'block']) {
    const harness = await createHarness({
      rerunChanges: true,
      rerunIssueOutOfScope,
    });
    const command = rerunCommand(harness, 1);
    await assert.rejects(
      harness.service.execute(commandRequest(harness, command)),
      error => error instanceof NovelImportReviewApplicationError
        && error.detailReason === 'rerun_changed_unselected_issue',
    );
    assert.equal(harness.captures.stage, undefined);
    assert.equal(harness.captures.commit, undefined);
  }
});

test('rejects a changed baseline before the first staging or metadata write', async () => {
  const harness = await createHarness({ staleAtGet: 2 });
  await assert.rejects(
    harness.service.execute(commandRequest(harness, classificationCommand(harness))),
    baselineConflict,
  );
  assert.equal(harness.captures.stage, undefined);
  assert.equal(harness.captures.commit, undefined);
  assert.deepEqual(harness.captures.metadata, []);
});

test('rechecks the baseline after validation and refuses formal commit when it changed', async () => {
  const harness = await createHarness({ staleAtGet: 3 });
  await assert.rejects(
    harness.service.execute(commandRequest(harness, classificationCommand(harness))),
    baselineConflict,
  );
  assert.notEqual(harness.captures.stage, undefined);
  assert.equal(harness.captures.commit, undefined);
});

test('surfaces store expected-current conflicts as typed baseline conflicts', async () => {
  const harness = await createHarness({ stageConflict: true });
  await assert.rejects(
    harness.service.execute(commandRequest(harness, classificationCommand(harness))),
    baselineConflict,
  );
  assert.equal(harness.captures.commit, undefined);
});

test('rejects committed artifacts with a mismatched creator or content path', async () => {
  for (const options of [
    { artifactCreatorMismatch: true },
    { artifactContentPathMismatch: true },
  ]) {
    const harness = await createHarness(options);
    await assert.rejects(
      harness.service.execute(commandRequest(harness, classificationCommand(harness))),
      error => error instanceof NovelImportReviewApplicationError
        && error.detailReason === 'committed_review_artifact_mismatch',
    );
    assert.notEqual(harness.captures.commit, undefined);
  }
});

test('previews current and stale selectors without mutating workflow state', async () => {
  const current = await createHarness();
  const currentPreview = await current.service.previewStaleImpact(
    stalePreviewRequest(current),
  );
  assert.equal(currentPreview.baselineStatus, 'current');
  assert.equal(currentPreview.canApply, true);
  assert.equal(current.captures.commit, undefined);

  const stale = await createHarness({
    initialValidity: 'superseded',
    previewCurrentRevisionId: NEXT_ACTIVE_REVISION_ID,
  });
  const stalePreview = await stale.service.previewStaleImpact(
    stalePreviewRequest(stale),
  );
  assert.equal(stalePreview.baselineStatus, 'stale');
  assert.equal(stalePreview.canApply, false);
  assert.equal(stalePreview.currentArtifactRevisionId, NEXT_ACTIVE_REVISION_ID);
  assert.ok(!stale.calls.includes('commit-artifact'));
});

test('maps a two-level impact chain without requiring the root as the transitive producer', async () => {
  const harness = await createHarness({ multiLevelImpact: true });
  const preview = await harness.service.previewStaleImpact(
    stalePreviewRequest(harness),
  );

  assert.equal(preview.impacts.length, 2);
  assert.equal(preview.impacts[0].producerArtifactId, ARTIFACT_ID);
  assert.equal(preview.impacts[0].depth, 1);
  assert.equal(preview.impacts[1].producerArtifactId, uuid(800));
  assert.equal(preview.impacts[1].producerRevisionId, uuid(801));
  assert.equal(preview.impacts[1].depth, 2);
  assert.deepEqual(preview.impacts[1].selector, {
    scriptUnitIds: ['script-unit-1'],
  });
});

test('rejects aggregate bundle identity tampering before exposing a snapshot', async () => {
  const mutations = [
    bundle => ({ ...bundle, parametersHash: 'f'.repeat(64) }),
    bundle => ({
      ...bundle,
      selectedEncoding: { ...bundle.selectedEncoding, encoding: 'utf-16le' },
    }),
    bundle => ({
      ...bundle,
      importWarnings: [...bundle.importWarnings, { tampered: true }],
    }),
    bundle => ({
      ...bundle,
      chapterCandidates: bundle.chapterCandidates.map((candidate, index) =>
        index === 0
          ? { ...candidate, contextAfter: [...candidate.contextAfter, 'tampered'] }
          : candidate),
    }),
    bundle => ({
      ...bundle,
      canonical: {
        ...bundle.canonical,
        rawToCanonicalRangeMap: {
          ...bundle.canonical.rawToCanonicalRangeMap,
          inputRevision: bundle.canonical.revision,
        },
      },
    }),
    bundle => ({
      ...bundle,
      canonical: {
        ...bundle.canonical,
        rawToCanonicalRangeMap: {
          ...bundle.canonical.rawToCanonicalRangeMap,
          outputRevision: bundle.importedNovel.rawTextRevision,
        },
      },
    }),
    bundle => ({
      ...bundle,
      dependencySelector: {
        ...bundle.dependencySelector,
        blockIds: bundle.dependencySelector.blockIds.slice(1),
      },
    }),
    bundle => ({
      ...bundle,
      dependencySelector: {
        ...bundle.dependencySelector,
        chapterIds: bundle.dependencySelector.chapterIds.slice(1),
      },
    }),
    bundle => ({
      ...bundle,
      dependencySelector: {
        ...bundle.dependencySelector,
        scriptUnitIds: [uuid(9997)],
      },
    }),
  ];
  for (const mutateBundle of mutations) {
    const harness = await createHarness({ mutateBundle });
    await assert.rejects(
      harness.service.inspect(reviewRequest(harness)),
      error => error instanceof NovelImportReviewApplicationError
        && error.detailReason === 'bundle_identity_invalid',
    );
  }
});

test('rejects a stale project session before resolving workflow or storage', async () => {
  const harness = await createHarness();
  await assert.rejects(
    harness.service.inspect({
      ...reviewRequest(harness),
      projectSessionId: STALE_SESSION_ID,
    }),
    error => error instanceof NovelImportReviewApplicationError
      && error.code === 'NOVEL_IMPORT_STALE_SESSION',
  );
  assert.deepEqual(harness.calls, []);
});

test('parses review commands before resolving any project capability', async () => {
  const harness = await createHarness();
  const command = {
    ...classificationCommand(harness),
    schemaVersion: 2,
  };
  assert.throws(
    () => harness.service.execute(commandRequest(harness, command)),
    error => error instanceof NovelImportReviewApplicationError
      && error.code === 'NOVEL_IMPORT_STRUCTURE_INVALID'
      && error.detailReason === 'review_command_invalid',
  );
  assert.deepEqual(harness.calls, []);
});

async function createHarness(options = {}) {
  const createdBundle = await createBundle();
  const bundle = options.mutateBundle === undefined
    ? createdBundle
    : options.mutateBundle(createdBundle);
  const artifact = artifactRecord(bundle, {
    validityStatus: options.initialValidity ?? 'current',
  });
  const calls = [];
  const captures = {
    metadata: [],
    commit: undefined,
    expectedSelector: undefined,
    rerun: undefined,
    revisionId: undefined,
    stage: undefined,
  };
  const metadataCommands = [];
  let getCount = 0;
  let currentArtifact = artifact;
  let generatedId = 200;

  const projects = new ProjectApplicationService({
    async closeProject() {},
    async createProject() {
      return { ...baseProject, accessMode: options.accessMode ?? 'read-write' };
    },
    async openProject() {
      return { ...baseProject, accessMode: options.accessMode ?? 'read-write' };
    },
  });
  await projects.openProject({ projectDirectory: baseProject.projectDirectory });

  const workflow = {
    async getArtifactRevision(revisionId) {
      calls.push('get-artifact');
      getCount += 1;
      if (revisionId !== ARTIFACT_REVISION_ID)
        return undefined;
      if (options.staleAtGet === getCount) {
        return { ...artifact, validityStatus: 'superseded' };
      }
      return currentArtifact.revisionId === revisionId
        ? currentArtifact
        : { ...artifact, validityStatus: 'superseded' };
    },
    async previewArtifactImpact(command) {
      calls.push('preview-impact');
      const producerRevisionId = options.previewCurrentRevisionId
        ?? ARTIFACT_REVISION_ID;
      const directImpact = {
        consumerArtifactId: uuid(800),
        consumerRevisionId: uuid(801),
        producerArtifactId: ARTIFACT_ID,
        producerRevisionId,
        dependencyType: 'structure',
        depth: 1,
        selector: command.changeSelector,
      };
      return {
        producerArtifactId: ARTIFACT_ID,
        producerRevisionId,
        changeSelector: command.changeSelector,
        impacts: options.multiLevelImpact
          ? [directImpact, {
              consumerArtifactId: uuid(802),
              consumerRevisionId: uuid(803),
              producerArtifactId: directImpact.consumerArtifactId,
              producerRevisionId: directImpact.consumerRevisionId,
              dependencyType: 'structure',
              depth: 2,
              selector: { scriptUnitIds: ['script-unit-1'] },
            }]
          : [directImpact],
      };
    },
    async listArtifactDependencies() {
      calls.push('list-dependencies');
      return [];
    },
    async commitArtifactRevision(command) {
      calls.push('commit-artifact');
      captures.commit = command;
      const committed = {
        ...artifact,
        revisionId: command.revisionId,
        inputFingerprint: command.inputFingerprint,
        processorId: command.processorId,
        processorVersion: command.processorVersion,
        parametersHash: sha256CanonicalJson(command.parameters),
        contentPath: options.artifactContentPathMismatch
          ? `artifacts/imported/${ARTIFACT_REVISION_ID}/content`
          : `artifacts/imported/${command.revisionId}/content`,
        contentHash: 'e'.repeat(64),
        createdAt: '2026-08-09T00:01:00.000Z',
        createdBy: options.artifactCreatorMismatch
          ? 'operator:other'
          : command.createdBy,
        validityStatus: 'current',
        reviewStatus: command.reviewRequired ? 'pending' : 'not_required',
      };
      currentArtifact = committed;
      return committed;
    },
  };
  const store = {
    async readBundle() {
      calls.push('read-bundle');
      return bundle;
    },
    async listRevisions() {
      calls.push('list-revisions');
      return [{ artifact, bundle }];
    },
    async listMetadataCommands() {
      calls.push('list-metadata');
      return [...metadataCommands];
    },
    async appendMetadataCommand(command) {
      calls.push('append-metadata');
      captures.metadata.push(command);
      if (options.metadataConflict) {
        return {
          status: 'conflict',
          currentArtifactRevisionId: NEXT_ACTIVE_REVISION_ID,
        };
      }
      metadataCommands.push(command.command);
      return {
        status: 'saved',
        currentArtifactRevisionId: ARTIFACT_REVISION_ID,
      };
    },
    async stageBundle(command) {
      calls.push('stage-bundle');
      captures.stage = command;
      captures.revisionId = command.revisionId;
      captures.expectedSelector = expectedSelector(bundle, command.command);
      if (options.stageConflict) {
        return {
          status: 'conflict',
          currentArtifactRevisionId: NEXT_ACTIVE_REVISION_ID,
        };
      }
      return {
        status: 'staged',
        currentArtifactRevisionId: ARTIFACT_REVISION_ID,
        artifact: {
          outputDirectory: `tmp/review/${command.revisionId}`,
        },
      };
    },
    async validateStagedBundle(command) {
      calls.push('validate-bundle');
      assert.equal(command.expectedBundle, captures.stage.bundle);
    },
  };
  const rerunner = {
    async rerunSelection(command) {
      calls.push('rerun-selection');
      captures.rerun = command;
      if (!options.rerunChanges)
        return command.baselineBundle;
      const selectedChapter = bundle.chapterIndex.entries.find(item =>
        command.selector.chapterIds?.includes(item.chapterId));
      assert.ok(selectedChapter, 'changed rerun fixture requires a selected chapter');
      const selectedRange = {
        startByte: selectedChapter.headingRange.startByte,
        endByte: selectedChapter.contentRange.endByte,
      };
      const intersectsSelected = range =>
        range.startByte < selectedRange.endByte
        && selectedRange.startByte < range.endByte;
      const outOfScopeBlock = bundle.blockIndex.blocks.find(block =>
        !intersectsSelected(block.canonicalRange));
      assert.ok(
        !options.rerunIssueOutOfScope || outOfScopeBlock,
        'fixture requires an unselected block',
      );
      const blocks = bundle.blockIndex.blocks.map((block, index) =>
        options.rerunChapterProjectionChanges
        && index === bundle.blockIndex.blocks.findIndex(item =>
          intersectsSelected(item.canonicalRange))
          ? {
              ...block,
              kind: block.kind === 'unknown' ? 'paragraph' : 'unknown',
            }
          : block);
      const outOfScopeCandidate = options.rerunCandidateOutOfScope
        ? bundle.chapterCandidates.find(candidate =>
            !intersectsSelected(candidate.headingRange))
        : undefined;
      assert.ok(
        !options.rerunCandidateOutOfScope || outOfScopeCandidate,
        'fixture requires an unselected chapter candidate',
      );
      let selectedCandidateAdded = false;
      let candidates = bundle.chapterCandidates.flatMap((candidate) => {
        if (
          options.rerunCandidateOutOfScope === 'remove'
          && candidate.chapterCandidateId
          === outOfScopeCandidate.chapterCandidateId
        ) {
          return [];
        }
        const shouldChange = (
          options.rerunCandidateOutOfScope === 'change'
          && candidate.chapterCandidateId
          === outOfScopeCandidate.chapterCandidateId
        ) || (
          options.rerunChapterProjectionChanges
          && intersectsSelected(candidate.headingRange)
        );
        const projected = shouldChange
          ? {
              ...candidate,
              contextAfter: [...candidate.contextAfter, 'rerun-context'],
            }
          : candidate;
        if (
          options.rerunChapterProjectionChanges
          && !selectedCandidateAdded
          && intersectsSelected(candidate.headingRange)
        ) {
          selectedCandidateAdded = true;
          return [projected, {
            ...projected,
            chapterCandidateId: uuid(9001),
            reviewStatus: 'pending',
          }];
        }
        return [projected];
      });
      if (options.rerunCandidateOutOfScope === 'add') {
        candidates = [...candidates, {
          ...outOfScopeCandidate,
          chapterCandidateId: uuid(9002),
        }];
      }
      const outOfScopeProposal = options.rerunOutOfScope
        ? bundle.normalization.proposals.find(proposal =>
            !intersectsSelected(proposal.canonicalRange))
        : undefined;
      assert.ok(
        !options.rerunOutOfScope || outOfScopeProposal,
        'fixture requires an unselected normalization proposal',
      );
      const proposals = bundle.normalization.proposals.map(proposal =>
        (options.rerunOutOfScope
          && proposal.proposalId === outOfScopeProposal.proposalId)
        || (!options.rerunOutOfScope
          && intersectsSelected(proposal.canonicalRange))
          ? { ...proposal, confidence: proposal.confidence - 0.01 }
          : proposal);
      let coverageChanged = false;
      const coverageSegments = bundle.chapterIndex.coverageReport.segments.map(
        (segment) => {
          if (
            !options.rerunCoverageOutOfScope
            || coverageChanged
            || intersectsSelected(segment.range)
          ) {
            return segment;
          }
          coverageChanged = true;
          return segment.classification === 'chapter'
            ? { ...segment, chapterId: uuid(9010) }
            : {
                ...segment,
                classification: segment.classification === 'noise'
                  ? 'front_matter'
                  : 'noise',
              };
        },
      );
      assert.ok(
        !options.rerunCoverageOutOfScope || coverageChanged,
        'fixture requires unselected coverage',
      );
      const blockIssues = options.rerunIssueOutOfScope === 'block'
        ? [...bundle.blockIndex.issues, {
            code: 'ambiguous_reimport_alignment',
            severity: 'warning',
            reviewStatus: 'pending',
            message: 'unselected block issue',
            currentBlockId: outOfScopeBlock.blockId,
            candidateOldBlockIds: [uuid(9011)],
            evidenceLevel: 'globally-unique-content',
          }]
        : bundle.blockIndex.issues;
      const chapterIssues = options.rerunIssueOutOfScope === 'chapter'
        ? [...bundle.chapterIndex.issues, {
            issueId: uuid(9012),
            code: 'rerun_unselected_issue',
            severity: 'warning',
            reviewStatus: 'pending',
            message: 'unselected chapter issue',
            textRange: outOfScopeBlock.canonicalRange,
          }]
        : bundle.chapterIndex.issues;
      return {
        ...bundle,
        blockIndex: {
          ...bundle.blockIndex,
          blocks,
          issues: blockIssues,
          ...(options.rerunIssueOutOfScope === 'block'
            ? { reviewStatus: 'pending' }
            : {}),
        },
        chapterCandidates: candidates,
        chapterIndex: {
          ...bundle.chapterIndex,
          candidates,
          issues: chapterIssues,
          coverageReport: {
            ...bundle.chapterIndex.coverageReport,
            segments: coverageSegments,
          },
          ...(options.rerunChapterProjectionChanges
            || options.rerunIssueOutOfScope === 'chapter'
            ? { reviewStatus: 'pending' }
            : {}),
        },
        normalization: { ...bundle.normalization, proposals },
      };
    },
  };
  const service = new NovelImportReviewApplicationService(
    projects,
    () => {
      calls.push('workflow-factory');
      return workflow;
    },
    () => {
      calls.push('store-factory');
      return store;
    },
    () => rerunner,
    {
      createOpaqueId: () => uuid(generatedId++),
    },
  );
  return { artifact, bundle, calls, captures, service };
}

async function createBundle() {
  const ids = idFactory(20);
  const sourceHash = sha256(SOURCE_BYTES);
  const importedNovel = await new TxtSourceAdapter().extract({
    sourceAssetId: SOURCE_ASSET_ID,
    sourceContentHash: sourceHash,
    sourceByteLength: SOURCE_BYTES.byteLength,
    mediaType: 'text/plain',
    fileExtension: '.txt',
    openByteStream() {
      return (async function* () {
        yield SOURCE_BYTES;
      })();
    },
  }, { createOpaqueId: ids });
  const canonical = canonicalizeRawTextV1({
    rawTextRevision: importedNovel.rawTextRevision,
    rawTextParts: importedNovel.orderedBlocks.map(block => block.rawText),
    canonicalTextRevisionId: ids(),
  });
  const blockIndex = buildDocumentBlockIndexV1({
    importedNovel,
    canonicalText: canonical.canonicalText,
    canonicalTextRevision: canonical.canonicalTextRevision,
    rawToCanonicalRangeMap: canonical.rangeMap,
  });
  const chapterCandidates = detectChapterCandidatesV1(blockIndex, {
    candidateIdFactory: ids,
  });
  const chapterIndex = buildChapterIndexV1({
    blockIndex,
    candidates: chapterCandidates,
    options: {
      chapterIdFactory: ids,
      issueIdFactory: ids,
      volumeIdFactory: ids,
    },
  });
  const proposals = discoverNormalizationProposalsV1({
    canonicalTextRevision: canonical.canonicalTextRevision,
    canonicalText: canonical.canonicalText,
    chapterIndex,
    options: { proposalIdFactory: ids },
  });
  assert.ok(proposals.length > 0, 'fixture must produce a normalization proposal');
  const normalization = normalizeTextV1({
    canonicalTextRevision: canonical.canonicalTextRevision,
    canonicalText: canonical.canonicalText,
    proposals,
    mode: 'apply',
    selectedProposalIds: [],
    normalizedTextRevisionId: ids(),
  });
  assert.equal(normalization.applied, true);
  const dependencySelector = {
    blockIds: blockIndex.blocks.map(block => block.blockId),
    chapterIds: chapterIndex.entries.map(entry => entry.chapterId),
  };
  const parameters = {
    schemaVersion: 1,
    fixture: 'novel-import-review',
    dependencySelector,
  };
  return {
    documentType: 'novel-import-bundle',
    schemaVersion: NOVEL_IMPORT_BUNDLE_SCHEMA_VERSION,
    sourceAsset: {
      sourceAssetId: SOURCE_ASSET_ID,
      sourceType: 'novel-txt',
      originalName: 'review-fixture.txt',
      contentHash: sourceHash,
      relativePath: `inputs/source-assets/${SOURCE_ASSET_ID}/review-fixture.txt`,
      createdAt: CREATED_AT,
      createdBy: 'operator:test',
    },
    sourceByteLength: SOURCE_BYTES.byteLength,
    inputFingerprint: 'a'.repeat(64),
    fingerprintParametersHash: 'b'.repeat(64),
    parameters,
    parametersHash: sha256CanonicalJson(parameters),
    selectedEncoding: importedNovel.encodingDecision,
    importWarnings: importedNovel.warnings,
    importedNovel,
    canonical: {
      text: canonical.canonicalText,
      revision: canonical.canonicalTextRevision,
      rawToCanonicalRangeMap: canonical.rangeMap,
    },
    blockIndex,
    chapterCandidates,
    chapterIndex,
    normalization: { proposals, result: normalization },
    dependencySelector,
  };
}

function artifactRecord(bundle, overrides = {}) {
  return {
    artifactId: ARTIFACT_ID,
    artifactType: NOVEL_IMPORT_BUNDLE_ARTIFACT_TYPE,
    lineageId: ARTIFACT_ID,
    revisionId: ARTIFACT_REVISION_ID,
    scope: {
      kind: 'novel-import',
      identifiers: [SOURCE_ASSET_ID],
    },
    storageKind: 'imported',
    contentPath: `artifacts/imported/${ARTIFACT_REVISION_ID}/content`,
    contentHash: 'c'.repeat(64),
    inputFingerprint: bundle.inputFingerprint,
    processorId: NOVEL_IMPORT_APPLICATION_PROCESSOR_ID,
    processorVersion: NOVEL_IMPORT_APPLICATION_PROCESSOR_VERSION,
    parametersHash: bundle.parametersHash,
    executionStatus: 'succeeded',
    validityStatus: 'current',
    reviewStatus: 'pending',
    createdAt: CREATED_AT,
    createdBy: 'operator:test',
    ...overrides,
  };
}

function baseline(harness) {
  return {
    artifactId: ARTIFACT_ID,
    artifactRevisionId: ARTIFACT_REVISION_ID,
    canonicalTextRevision: harness.bundle.canonical.revision,
  };
}

function reviewRequest(harness) {
  return {
    projectId: PROJECT_ID,
    projectSessionId: PROJECT_SESSION_ID,
    query: {
      documentType: 'novel-import-review-query',
      schemaVersion: 1,
      readOnly: true,
      baselineRevision: baseline(harness),
    },
  };
}

function stalePreviewRequest(harness) {
  const chapterId = harness.bundle.chapterIndex.entries[0].chapterId;
  return {
    projectId: PROJECT_ID,
    projectSessionId: PROJECT_SESSION_ID,
    query: {
      documentType: 'novel-import-stale-preview-query',
      schemaVersion: 1,
      readOnly: true,
      baselineRevision: baseline(harness),
      changeKind: 'boundary-adjustment',
      changeSelector: { chapterIds: [chapterId] },
    },
  };
}

function commandRequest(harness, command) {
  return {
    projectId: PROJECT_ID,
    projectSessionId: PROJECT_SESSION_ID,
    command,
  };
}

function commandBase(harness, commandType) {
  return {
    documentType: 'novel-import-review-command',
    schemaVersion: 1,
    commandType,
    baselineRevision: baseline(harness),
    requestedBy: 'operator:test',
  };
}

function classificationCommand(harness) {
  const segment = harness.bundle.chapterIndex.coverageReport.segments.find(
    item => item.classification !== 'chapter',
  );
  assert.ok(segment, 'fixture must contain non-chapter coverage');
  return {
    ...commandBase(harness, 'classify-uncovered-range'),
    targetRange: segment.range,
    classification: segment.classification === 'noise' ? 'front_matter' : 'noise',
  };
}

function boundaryCommand(harness) {
  const chapter = harness.bundle.chapterIndex.entries[0];
  const bytes = Buffer.from(harness.bundle.canonical.text, 'utf8');
  let boundary = chapter.headingRange.endByte;
  if (bytes[boundary] === 0x0A)
    boundary += 1;
  else if (bytes[boundary - 1] === 0x0A)
    boundary -= 1;
  else
    throw new Error('fixture heading boundary must touch a newline');
  return {
    ...commandBase(harness, 'adjust-chapter-boundary'),
    chapterId: chapter.chapterId,
    headingRange: { ...chapter.headingRange, endByte: boundary },
    contentRange: { ...chapter.contentRange, startByte: boundary },
  };
}

function multiLineBoundaryCommand(harness) {
  const chapter = harness.bundle.chapterIndex.entries[0];
  const contentBlocks = harness.bundle.blockIndex.blocks.filter(block =>
    block.canonicalRange.startByte >= chapter.contentRange.startByte
    && block.canonicalRange.endByte < chapter.contentRange.endByte
    && block.canonicalText.trim().length > 0);
  assert.ok(contentBlocks.length > 0, 'fixture chapter needs multiple content lines');
  const boundary = contentBlocks[0].canonicalRange.endByte;
  return {
    ...commandBase(harness, 'adjust-chapter-boundary'),
    chapterId: chapter.chapterId,
    headingRange: { ...chapter.headingRange, endByte: boundary },
    contentRange: { ...chapter.contentRange, startByte: boundary },
  };
}

function sourceLineRangeForCanonicalRange(bundle, range) {
  const blocks = bundle.blockIndex.blocks.filter(block =>
    block.canonicalRange.startByte < range.endByte
    && range.startByte < block.canonicalRange.endByte);
  assert.ok(blocks.length > 0);
  return {
    lineBase: 1,
    startLine: Math.min(...blocks.map(block =>
      block.sourceLocator.lineRange.startLine)),
    endLineExclusive: Math.max(...blocks.map(block =>
      block.sourceLocator.lineRange.endLineExclusive)),
  };
}

function normalizationCommand(harness, proposalId, decision, note) {
  return {
    ...commandBase(harness, 'decide-normalization-proposal'),
    proposalId,
    decision,
    ...(note === undefined ? {} : { note }),
  };
}

function rerunCommand(harness, chapterIndex = 0) {
  const chapter = harness.bundle.chapterIndex.entries[chapterIndex];
  const block = harness.bundle.blockIndex.blocks.find(item =>
    item.canonicalRange.startByte < chapter.contentRange.endByte
    && item.canonicalRange.endByte > chapter.headingRange.startByte);
  return {
    ...commandBase(harness, 'rerun-selection'),
    selector: {
      blockIds: [block.blockId],
      chapterIds: [chapter.chapterId],
    },
  };
}

function pendingProposal(harness) {
  const proposal = harness.bundle.normalization.proposals.find(
    item => item.reviewStatus === 'pending',
  );
  assert.ok(proposal, 'fixture must contain a pending normalization proposal');
  return proposal;
}

function expectedSelector(bundle, command) {
  if (command.commandType === 'rerun-selection')
    return command.selector;
  const ranges = command.commandType === 'classify-uncovered-range'
    ? [command.targetRange]
    : command.commandType === 'adjust-chapter-boundary'
      ? [command.headingRange, command.contentRange]
      : bundle.normalization.proposals
          .filter(item => item.proposalId === command.proposalId)
          .map(item => item.canonicalRange);
  const blockIds = bundle.blockIndex.blocks
    .filter(block => ranges.some(range =>
      block.canonicalRange.startByte < range.endByte
      && range.startByte < block.canonicalRange.endByte))
    .map(block => block.blockId);
  const chapterIds = bundle.chapterIndex.entries
    .filter(chapter => ranges.some(range =>
      chapter.headingRange.startByte < range.endByte
      && range.startByte < chapter.contentRange.endByte))
    .map(chapter => chapter.chapterId);
  return {
    ...(blockIds.length === 0 ? {} : { blockIds }),
    ...(chapterIds.length === 0 ? {} : { chapterIds }),
  };
}

function baselineConflict(error) {
  return error instanceof NovelImportReviewApplicationError
    && error.code === 'NOVEL_IMPORT_REVIEW_REQUIRED'
    && error.detailReason === 'baseline_revision_stale';
}

function sameRange(left, right) {
  return left.textRevisionId === right.textRevisionId
    && left.textLayer === right.textLayer
    && left.offsetUnit === right.offsetUnit
    && left.startByte === right.startByte
    && left.endByte === right.endByte;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function idFactory(start) {
  let value = start;
  return () => uuid(value++);
}

function uuid(value) {
  return `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
}
