import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { access, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';

import {
  GB18030_CROSS_CHUNK_BOUNDARY_BYTE,
  GB18030_FOUR_BYTE_SEQUENCE,
  generateTxtResourceSamples,
  MEBIBYTE,
  TXT_RESOURCE_SAMPLE_BYTE_LENGTHS,
  TXT_RESOURCE_SAMPLE_DEFINITIONS,
  TXT_RESOURCE_SAMPLE_SEED,
} from '../benchmark/generateTxtResourceSamples.mjs';
import {
  runTxtResourceBenchmark,
  TXT_RESOURCE_EXPLORATION_PROFILE,
} from '../benchmark/runTxtResourceBenchmark.mjs';
import {
  buildBudgetBoundaryChecks,
  calculateResultsPayloadSha256,
  estimateTxtResourceTemporaryBytes,
  selectBudget,
  TXT_RESOURCE_BUDGET_FIELDS,
  validateBudgetProfile,
  validateSelectedBudget,
  verifyTxtResourceResults,
} from '../benchmark/verifyTxtResourceResults.mjs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(packageRoot, '..', '..');

async function temporaryDirectory(prefix) {
  return mkdtemp(join(tmpdir(), prefix));
}

function approvedProfile() {
  const profile = structuredClone(TXT_RESOURCE_EXPLORATION_PROFILE);
  profile.profileId = 'approved-test-profile';
  profile.budgetProfileVersion = 'approved-test-v1';
  profile.approval = {
    approvedAt: '2026-08-09T00:00:00.000Z',
    owner: 'independent-test-owner',
    status: 'approved',
  };
  profile.realSampleEvidence = {
    byteLength: MEBIBYTE,
    encoding: 'utf-8',
    evidenceRef: 'authorization-record:test-only',
    sampleId: 'opaque-test-sample',
    sha256: 'a'.repeat(64),
  };
  return profile;
}

function rehashResults(results) {
  results.payloadSha256 = calculateResultsPayloadSha256(results);
  return results;
}

function sha256Bytes(value) {
  return createHash('sha256').update(value).digest('hex');
}

test('synthetic sample matrix fixes exact sizes, encodings, layouts, seed, and hashes', () => {
  assert.deepEqual(TXT_RESOURCE_SAMPLE_BYTE_LENGTHS, [MEBIBYTE, 10 * MEBIBYTE, 50 * MEBIBYTE]);
  assert.equal(TXT_RESOURCE_SAMPLE_DEFINITIONS.length, 9);
  assert.deepEqual(
    new Set(TXT_RESOURCE_SAMPLE_DEFINITIONS.map(definition => definition.byteLength)),
    new Set(TXT_RESOURCE_SAMPLE_BYTE_LENGTHS),
  );
  assert.deepEqual(
    new Set(TXT_RESOURCE_SAMPLE_DEFINITIONS.map(definition => definition.encoding)),
    new Set(['utf-8', 'gbk', 'gb18030', 'big5']),
  );
  assert.deepEqual(
    new Set(TXT_RESOURCE_SAMPLE_DEFINITIONS.map(definition => definition.layout)),
    new Set(['regularChapters', 'denseShortBlocks', 'longestSingleLine']),
  );
  assert.equal(TXT_RESOURCE_SAMPLE_SEED, 1_592_635_477);
  for (const definition of TXT_RESOURCE_SAMPLE_DEFINITIONS)
    assert.match(definition.expectedSha256, /^[\da-f]{64}$/);
});

test('generator writes exact 1 MiB, 10 MiB, and 50 MiB deterministic samples only below system temp', async (context) => {
  const root = await temporaryDirectory('voxweaver-m1-b05-generator-');
  context.after(() => rm(root, { force: true, recursive: true }));
  const caseIds = [
    'utf8-dense-1mib',
    'gb18030-long-line-10mib',
    'utf8-long-line-50mib',
  ];
  const samples = await generateTxtResourceSamples({
    caseIds,
    directory: join(root, 'first'),
  });
  assert.deepEqual(samples.map(sample => sample.byteLength), TXT_RESOURCE_SAMPLE_BYTE_LENGTHS);
  for (const sample of samples) {
    assert.equal((await stat(sample.path)).size, sample.byteLength);
    const definition = TXT_RESOURCE_SAMPLE_DEFINITIONS.find(entry => entry.id === sample.id);
    assert.equal(sample.sha256, definition.expectedSha256);
  }

  const gb18030Bytes = await readFile(samples[1].path);
  const fourByteSequence = Buffer.from(GB18030_FOUR_BYTE_SEQUENCE);
  const sequenceStart = GB18030_CROSS_CHUNK_BOUNDARY_BYTE - 2;
  assert.equal(gb18030Bytes.indexOf(fourByteSequence), sequenceStart);
  assert.equal(gb18030Bytes.indexOf(fourByteSequence, sequenceStart + 1), -1);
  const streamingDecoder = new TextDecoder('gb18030', { fatal: true });
  assert.equal(
    streamingDecoder.decode(
      gb18030Bytes.subarray(sequenceStart, GB18030_CROSS_CHUNK_BOUNDARY_BYTE),
      { stream: true },
    ),
    '',
  );
  assert.equal(
    streamingDecoder.decode(
      gb18030Bytes.subarray(
        GB18030_CROSS_CHUNK_BOUNDARY_BYTE,
        GB18030_CROSS_CHUNK_BOUNDARY_BYTE + 2,
      ),
    ),
    '\u0080',
  );

  const repeated = await generateTxtResourceSamples({
    caseIds: ['utf8-dense-1mib'],
    directory: join(root, 'second'),
  });
  assert.equal(repeated[0].sha256, samples[0].sha256);
  assert.deepEqual(await readFile(repeated[0].path), await readFile(samples[0].path));
  await assert.rejects(
    generateTxtResourceSamples({
      caseIds: ['utf8-dense-1mib'],
      directory: join(packageRoot, 'benchmark', 'forbidden-generated-samples'),
    }),
    /system temporary directory/,
  );
});

test('worker strictly decodes the fixed GB18030 four-byte sequence across its read chunk', async () => {
  const results = await runTxtResourceBenchmark({
    caseIds: ['gb18030-long-line-10mib'],
    mode: 'explore',
  });
  verifyTxtResourceResults(TXT_RESOURCE_EXPLORATION_PROFILE, results, {
    requireApproved: false,
    requireRealSample: false,
  });
  const benchmarkCase = results.cases[0];
  assert.equal(benchmarkCase.input.sha256, '860acc6717db146f09a0611ca94ee75965852d6ce89fc096b687d43d37bd6fcf');
  assert.equal(benchmarkCase.rawRuns.length, 5);
  assert.equal(new Set(benchmarkCase.rawRuns.map(run => run.outputSha256)).size, 1);
  assert.ok(benchmarkCase.outputByteLength > benchmarkCase.input.byteLength);
});

test('profile validator enforces every field minimum, maximum, and global ceiling', () => {
  validateBudgetProfile(TXT_RESOURCE_EXPLORATION_PROFILE);
  for (const field of TXT_RESOURCE_BUDGET_FIELDS) {
    const missing = structuredClone(TXT_RESOURCE_EXPLORATION_PROFILE);
    delete missing.budgets[field];
    assert.throws(() => validateBudgetProfile(missing), { code: 'NOVEL_IMPORT_BUDGET_INVALID' });

    const zero = structuredClone(TXT_RESOURCE_EXPLORATION_PROFILE);
    zero.budgets[field].default = 0;
    assert.throws(() => validateBudgetProfile(zero), { code: 'NOVEL_IMPORT_BUDGET_INVALID' });

    const overCeiling = structuredClone(TXT_RESOURCE_EXPLORATION_PROFILE);
    overCeiling.budgets[field].default = overCeiling.budgets[field].globalCeiling + 1;
    assert.throws(() => validateBudgetProfile(overCeiling), { code: 'NOVEL_IMPORT_BUDGET_INVALID' });

    const contradictory = structuredClone(TXT_RESOURCE_EXPLORATION_PROFILE);
    contradictory.budgets[field].maximum = contradictory.budgets[field].globalCeiling + 1;
    assert.throws(() => validateBudgetProfile(contradictory), { code: 'NOVEL_IMPORT_BUDGET_INVALID' });

    const belowMinimumProfile = structuredClone(TXT_RESOURCE_EXPLORATION_PROFILE);
    belowMinimumProfile.budgets[field].minimum = 2;
    const belowMinimum = selectBudget(belowMinimumProfile, 'default');
    belowMinimum[field] = 1;
    assert.throws(
      () => validateSelectedBudget(belowMinimumProfile, belowMinimum),
      error => error.code === 'NOVEL_IMPORT_BUDGET_INVALID'
        && error.details.violatedBound === 'minimum',
    );

    const aboveMaximumProfile = structuredClone(TXT_RESOURCE_EXPLORATION_PROFILE);
    aboveMaximumProfile.budgets[field].globalCeiling
      = aboveMaximumProfile.budgets[field].maximum + 2;
    const aboveMaximum = selectBudget(aboveMaximumProfile, 'default');
    aboveMaximum[field] = aboveMaximumProfile.budgets[field].maximum + 1;
    assert.throws(
      () => validateSelectedBudget(aboveMaximumProfile, aboveMaximum),
      error => error.code === 'NOVEL_IMPORT_BUDGET_INVALID'
        && error.details.violatedBound === 'maximum',
    );

    const aboveGlobal = selectBudget(TXT_RESOURCE_EXPLORATION_PROFILE, 'default');
    aboveGlobal[field] = TXT_RESOURCE_EXPLORATION_PROFILE.budgets[field].globalCeiling + 1;
    assert.throws(
      () => validateSelectedBudget(TXT_RESOURCE_EXPLORATION_PROFILE, aboveGlobal),
      error => error.code === 'NOVEL_IMPORT_BUDGET_INVALID'
        && error.details.violatedBound === 'globalCeiling',
    );
  }
});

test('default, project ceiling, and each ceiling plus one are explicit boundary cases', () => {
  const profile = structuredClone(TXT_RESOURCE_EXPLORATION_PROFILE);
  validateSelectedBudget(profile, selectBudget(profile, 'default'));
  const ceiling = selectBudget(profile, 'ceiling');
  validateSelectedBudget(profile, ceiling);
  for (const field of TXT_RESOURCE_BUDGET_FIELDS)
    assert.equal(ceiling[field], profile.budgets[field].maximum);
  const checks = buildBudgetBoundaryChecks(profile);
  assert.equal(checks.length, TXT_RESOURCE_BUDGET_FIELDS.length * 2 + 2);
  assert.deepEqual(checks.slice(0, 2).map(check => check.id), ['default', 'ceiling']);
  for (const check of checks.slice(2)) {
    assert.throws(
      () => validateSelectedBudget(profile, check.values),
      { code: 'NOVEL_IMPORT_BUDGET_INVALID' },
    );
  }
});

test('approved profile requires owner approval and authorized real-sample evidence', () => {
  const profile = approvedProfile();
  validateBudgetProfile(profile, { requireApproved: true, requireRealSample: true });

  const missingReference = structuredClone(profile);
  delete missingReference.realSampleEvidence.evidenceRef;
  assert.throws(
    () => validateBudgetProfile(missingReference, { requireApproved: true, requireRealSample: true }),
    { code: 'NOVEL_IMPORT_BUDGET_INVALID' },
  );

  const persistedPath = structuredClone(profile);
  persistedPath.realSampleEvidence.evidenceRef = '/private/corpus/book.txt';
  assert.throws(
    () => validateBudgetProfile(persistedPath, { requireApproved: true, requireRealSample: true }),
    { code: 'NOVEL_IMPORT_BUDGET_INVALID' },
  );

  const unapproved = structuredClone(TXT_RESOURCE_EXPLORATION_PROFILE);
  assert.throws(
    () => validateBudgetProfile(unapproved, { requireApproved: true, requireRealSample: true }),
    { code: 'NOVEL_IMPORT_BUDGET_INVALID' },
  );
});

test('benchmark retains five independent raw runs plus cancel, timeout, temp-space, backpressure, and cleanup evidence', async () => {
  const results = await runTxtResourceBenchmark({
    caseIds: ['utf8-dense-1mib'],
    mode: 'explore',
  });
  verifyTxtResourceResults(TXT_RESOURCE_EXPLORATION_PROFILE, results, {
    requireApproved: false,
    requireRealSample: false,
  });

  const benchmarkCase = results.cases[0];
  assert.equal(benchmarkCase.rawRuns.length, 5);
  assert.equal(new Set(benchmarkCase.rawRuns.map(run => run.processId)).size, 5);
  assert.equal(new Set(benchmarkCase.rawRuns.map(run => run.outputSha256)).size, 1);
  for (const run of benchmarkCase.rawRuns) {
    assert.equal(run.status, 'completed');
    assert.equal(run.artifactCommitted, false);
    assert.equal(run.temporaryOutputRemoved, true);
    assert.equal(run.runDirectoryRemoved, true);
    assert.ok(run.periodicRssSampleCount >= 1);
    assert.ok(run.backpressureWaitCount >= 1);
  }
  const boundaries = new Map(results.boundaryChecks.map(check => [check.id, check]));
  assert.equal(boundaries.get('cancel').code, 'NOVEL_IMPORT_CANCELLED');
  assert.notEqual(
    boundaries.get('cancel').cancelAfterBytes % boundaries.get('cancel').cancellationWindowBytes,
    0,
  );
  assert.ok(
    boundaries.get('cancel').bytesPastCancellation > 0,
  );
  assert.ok(
    boundaries.get('cancel').bytesPastCancellation <= Math.min(
      boundaries.get('cancel').configuredCancelCheckBytes,
      boundaries.get('cancel').configuredReadChunkBytes,
    ),
  );
  assert.deepEqual(
    [boundaries.get('timeout').code, boundaries.get('timeout').dimension],
    ['NOVEL_IMPORT_RESOURCE_LIMIT_EXCEEDED', 'taskTimeoutMs'],
  );
  assert.deepEqual(
    [boundaries.get('temporary-space').code, boundaries.get('temporary-space').dimension],
    ['NOVEL_IMPORT_RESOURCE_LIMIT_EXCEEDED', 'maxTemporaryBytes'],
  );
  assert.equal(results.cleanup.benchmarkTemporaryRootRemoved, true);
  assert.equal(results.formalArtifactCreated, false);
  assert.equal(results.approvalStatus, 'unapproved');
  assert.equal(results.eligibleForGateClosure, false);
  assert.ok(
    results.recommendations.values.maxTemporaryBytes
    >= estimateTxtResourceTemporaryBytes(benchmarkCase.input.byteLength),
  );

  const profileMismatch = structuredClone(results);
  profileMismatch.profileSha256 = '0'.repeat(64);
  rehashResults(profileMismatch);
  assert.throws(
    () => verifyTxtResourceResults(TXT_RESOURCE_EXPLORATION_PROFILE, profileMismatch, {
      requireApproved: false,
      requireRealSample: false,
    }),
    { code: 'NOVEL_IMPORT_BUDGET_INVALID' },
  );

  const outputMismatch = structuredClone(results);
  outputMismatch.cases[0].rawRuns[0].outputSha256 = '0'.repeat(64);
  rehashResults(outputMismatch);
  assert.throws(
    () => verifyTxtResourceResults(TXT_RESOURCE_EXPLORATION_PROFILE, outputMismatch, {
      requireApproved: false,
      requireRealSample: false,
    }),
    { code: 'NOVEL_IMPORT_BUDGET_INVALID' },
  );

  const payloadMismatch = structuredClone(results);
  payloadMismatch.exitCode = 1;
  assert.throws(
    () => verifyTxtResourceResults(TXT_RESOURCE_EXPLORATION_PROFILE, payloadMismatch, {
      requireApproved: false,
      requireRealSample: false,
    }),
    { code: 'NOVEL_IMPORT_BUDGET_INVALID' },
  );

  const maximaMismatch = structuredClone(results);
  maximaMismatch.cases[0].maxima.wallTimeMs += 1;
  rehashResults(maximaMismatch);
  assert.throws(
    () => verifyTxtResourceResults(TXT_RESOURCE_EXPLORATION_PROFILE, maximaMismatch, {
      requireApproved: false,
      requireRealSample: false,
    }),
    { code: 'NOVEL_IMPORT_BUDGET_INVALID' },
  );

  const recommendationMismatch = structuredClone(results);
  recommendationMismatch.recommendations.values.maxTemporaryBytes += 1;
  rehashResults(recommendationMismatch);
  assert.throws(
    () => verifyTxtResourceResults(TXT_RESOURCE_EXPLORATION_PROFILE, recommendationMismatch, {
      requireApproved: false,
      requireRealSample: false,
    }),
    { code: 'NOVEL_IMPORT_BUDGET_INVALID' },
  );
});

test('formal preflight failure creates no result or product artifact', async (context) => {
  const root = await temporaryDirectory('voxweaver-m1-b05-formal-failure-');
  context.after(() => rm(root, { force: true, recursive: true }));
  const outputPath = join(root, 'results.json');
  const profile = approvedProfile();
  delete profile.realSampleEvidence;
  await assert.rejects(
    runTxtResourceBenchmark({ mode: 'formal', outputPath, profile }),
    { code: 'NOVEL_IMPORT_BUDGET_INVALID' },
  );
  await assert.rejects(access(outputPath));
  const repositoryBenchmarkEntries = await readdir(join(packageRoot, 'benchmark'));
  assert.equal(repositoryBenchmarkEntries.some(entry => entry.endsWith('.txt')), false);
});

test('authorized real sample size or hash mismatch fails before synthetic runs and records cleanup', async (context) => {
  const root = await temporaryDirectory('voxweaver-m1-b05-real-mismatch-');
  context.after(() => rm(root, { force: true, recursive: true }));
  const expectedBytes = Buffer.alloc(MEBIBYTE, 0x61);
  const profile = approvedProfile();
  profile.realSampleEvidence.byteLength = expectedBytes.length;
  profile.realSampleEvidence.sha256 = sha256Bytes(expectedBytes);
  const mismatches = [
    { id: 'size', value: expectedBytes.subarray(0, expectedBytes.length - 1) },
    { id: 'hash', value: Buffer.alloc(MEBIBYTE, 0x62) },
  ];

  for (const mismatch of mismatches) {
    const realSamplePath = join(root, `${mismatch.id}.runtime-input`);
    const outputPath = join(root, `${mismatch.id}.results.json`);
    await writeFile(realSamplePath, mismatch.value);
    let failure;
    try {
      await runTxtResourceBenchmark({
        mode: 'formal',
        outputPath,
        profile: structuredClone(profile),
        realSamplePath,
      });
    } catch (error) {
      failure = error;
    }
    assert.match(failure?.message ?? '', /does not match its evidence/);
    assert.deepEqual(failure?.benchmarkCleanup, {
      benchmarkTemporaryRootRemoved: true,
      formalArtifactCreated: false,
    });
    await assert.rejects(access(outputPath));
  }
});

test('repository evidence placeholders stay explicitly unapproved and non-closing', async () => {
  const [profile, results] = await Promise.all([
    readFile(join(repositoryRoot, 'docs', 'validation', 'm1-resource-budget.profile.json'), 'utf8').then(JSON.parse),
    readFile(join(repositoryRoot, 'docs', 'validation', 'm1-resource-budget.results.json'), 'utf8').then(JSON.parse),
  ]);
  assert.equal(profile.approval.status, 'unapproved');
  assert.equal(results.approvalStatus, 'unapproved');
  assert.equal(results.eligibleForGateClosure, false);
  assert.equal(results.status, 'not-run');
});
