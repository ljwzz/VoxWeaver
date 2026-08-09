import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  TXT_RESOURCE_SAMPLE_DEFINITIONS,
  TXT_RESOURCE_SAMPLE_GENERATOR_VERSION,
  TXT_RESOURCE_SAMPLE_SEED,
} from './generateTxtResourceSamples.mjs';

export const TXT_RESOURCE_PROFILE_SCHEMA_VERSION = 'm1-resource-budget-profile-v1';
export const TXT_RESOURCE_RESULTS_SCHEMA_VERSION = 'm1-resource-budget-results-v1';

export const TXT_RESOURCE_BUDGET_FIELDS = Object.freeze([
  'maxSourceBytes',
  'readChunkBytes',
  'maxRssBytes',
  'maxTemporaryBytes',
  'maxBlockCount',
  'maxBlockUtf8Bytes',
  'taskTimeoutMs',
  'cancelCheckBytes',
  'progressStepBytes',
]);

const BUDGET_VALUE_FIELDS = Object.freeze([
  'default',
  'minimum',
  'maximum',
  'globalCeiling',
]);

export const TXT_RESOURCE_RUN_METRIC_FIELDS = Object.freeze([
  'processStartRssBytes',
  'sampledPeakRssBytes',
  'resourceUsageMaxRssBytes',
  'peakTemporaryBytes',
  'wallTimeMs',
  'cpuUserMicros',
  'cpuSystemMicros',
  'throughputBytesPerSecond',
  'blockCount',
  'maxBlockUtf8Bytes',
  'cancelLatencyMs',
  'backpressureWaitCount',
  'progressEventCount',
]);

function invalid(message, details = {}) {
  const error = new Error(message);
  error.code = 'NOVEL_IMPORT_BUDGET_INVALID';
  error.details = details;
  return error;
}

function assertRecord(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw invalid(`${label} must be an object.`);
}

function assertExactKeys(value, expectedKeys, label) {
  const allowed = new Set(expectedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key))
      throw invalid(`${label} contains unknown field ${key}.`);
  }
  for (const key of expectedKeys) {
    if (!(key in value))
      throw invalid(`${label} is missing ${key}.`);
  }
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim() === '')
    throw invalid(`${label} must be a non-empty string.`);
}

function assertPositiveSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw invalid(`${label} must be a positive safe integer.`);
}

function assertSha256(value, label) {
  if (typeof value !== 'string' || !/^[\da-f]{64}$/.test(value))
    throw invalid(`${label} must be a lowercase SHA-256 hex digest.`);
}

function stableValue(value) {
  if (Array.isArray(value))
    return value.map(stableValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(key => [key, stableValue(value[key])]),
    );
  }
  return value;
}

export function stableJson(value) {
  return JSON.stringify(stableValue(value));
}

export function sha256Json(value) {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

export function calculateResultsPayloadSha256(results) {
  assertRecord(results, 'results');
  const { payloadSha256: _payloadSha256, ...payload } = results;
  return sha256Json(payload);
}

export function estimateTxtResourceTemporaryBytes(sourceBytes) {
  assertPositiveSafeInteger(sourceBytes, 'sourceBytes');
  if (sourceBytes > Math.floor(Number.MAX_SAFE_INTEGER / 2))
    throw invalid('sourceBytes is too large to estimate temporary bytes safely.');
  return sourceBytes * 2;
}

function validateApproval(approval, requireApproved) {
  assertRecord(approval, 'profile.approval');
  const commonKeys = ['status'];
  const approvedKeys = ['status', 'owner', 'approvedAt'];
  if (approval.status === 'approved') {
    assertExactKeys(approval, approvedKeys, 'profile.approval');
    assertNonEmptyString(approval.owner, 'profile.approval.owner');
    assertNonEmptyString(approval.approvedAt, 'profile.approval.approvedAt');
    if (Number.isNaN(Date.parse(approval.approvedAt)))
      throw invalid('profile.approval.approvedAt must be an ISO-compatible timestamp.');
  } else if (approval.status === 'unapproved') {
    assertExactKeys(approval, commonKeys, 'profile.approval');
  } else {
    throw invalid('profile.approval.status must be approved or unapproved.');
  }
  if (requireApproved && approval.status !== 'approved')
    throw invalid('The resource budget profile is not independently approved.');
}

function validateRealSampleEvidence(evidence) {
  assertRecord(evidence, 'profile.realSampleEvidence');
  assertExactKeys(
    evidence,
    ['sampleId', 'sha256', 'byteLength', 'encoding', 'evidenceRef'],
    'profile.realSampleEvidence',
  );
  assertNonEmptyString(evidence.sampleId, 'profile.realSampleEvidence.sampleId');
  assertSha256(evidence.sha256, 'profile.realSampleEvidence.sha256');
  assertPositiveSafeInteger(evidence.byteLength, 'profile.realSampleEvidence.byteLength');
  assertNonEmptyString(evidence.encoding, 'profile.realSampleEvidence.encoding');
  assertNonEmptyString(evidence.evidenceRef, 'profile.realSampleEvidence.evidenceRef');
  for (const [key, value] of Object.entries(evidence)) {
    if (typeof value === 'string' && (isAbsolute(value) || /^file:/i.test(value)))
      throw invalid(`profile.realSampleEvidence.${key} must not contain a filesystem path.`);
  }
}

export function validateBudgetProfile(profile, options = {}) {
  const { requireApproved = false, requireRealSample = false } = options;
  assertRecord(profile, 'profile');
  const requiredKeys = [
    'schemaVersion',
    'profileId',
    'budgetProfileVersion',
    'approval',
    'runsPerCase',
    'budgets',
  ];
  const expectedKeys = profile.realSampleEvidence === undefined
    ? requiredKeys
    : [...requiredKeys, 'realSampleEvidence'];
  assertExactKeys(profile, expectedKeys, 'profile');
  if (profile.schemaVersion !== TXT_RESOURCE_PROFILE_SCHEMA_VERSION)
    throw invalid(`Unsupported profile schemaVersion: ${profile.schemaVersion}`);
  assertNonEmptyString(profile.profileId, 'profile.profileId');
  assertNonEmptyString(profile.budgetProfileVersion, 'profile.budgetProfileVersion');
  assertPositiveSafeInteger(profile.runsPerCase, 'profile.runsPerCase');
  if (profile.runsPerCase < 5)
    throw invalid('profile.runsPerCase must retain at least five independent runs.');
  validateApproval(profile.approval, requireApproved);

  assertRecord(profile.budgets, 'profile.budgets');
  assertExactKeys(profile.budgets, TXT_RESOURCE_BUDGET_FIELDS, 'profile.budgets');
  for (const field of TXT_RESOURCE_BUDGET_FIELDS) {
    const values = profile.budgets[field];
    assertRecord(values, `profile.budgets.${field}`);
    assertExactKeys(values, BUDGET_VALUE_FIELDS, `profile.budgets.${field}`);
    for (const valueField of BUDGET_VALUE_FIELDS)
      assertPositiveSafeInteger(values[valueField], `profile.budgets.${field}.${valueField}`);
    if (
      values.minimum > values.default
      || values.default > values.maximum
      || values.maximum > values.globalCeiling
    ) {
      throw invalid(`profile.budgets.${field} has a contradictory range.`);
    }
  }

  if (profile.realSampleEvidence !== undefined)
    validateRealSampleEvidence(profile.realSampleEvidence);
  else if (requireRealSample)
    throw invalid('Authorized real sample evidence is required.');
  return profile;
}

export function selectBudget(profile, mode) {
  validateBudgetProfile(profile);
  if (mode !== 'default' && mode !== 'ceiling')
    throw invalid('Budget mode must be default or ceiling.');
  const valueField = mode === 'default' ? 'default' : 'maximum';
  return Object.fromEntries(
    TXT_RESOURCE_BUDGET_FIELDS.map(field => [field, profile.budgets[field][valueField]]),
  );
}

export function buildBudgetBoundaryChecks(profile) {
  validateBudgetProfile(profile);
  const checks = [
    {
      id: 'default',
      expectedCode: null,
      expectedOutcome: 'accepted',
      values: selectBudget(profile, 'default'),
    },
    {
      id: 'ceiling',
      expectedCode: null,
      expectedOutcome: 'accepted',
      values: selectBudget(profile, 'ceiling'),
    },
  ];
  const ceiling = selectBudget(profile, 'ceiling');
  for (const field of TXT_RESOURCE_BUDGET_FIELDS) {
    checks.push({
      id: `ceiling-plus-one:${field}`,
      expectedCode: 'NOVEL_IMPORT_BUDGET_INVALID',
      expectedOutcome: 'rejected',
      values: { ...ceiling, [field]: profile.budgets[field].maximum + 1 },
    });
    checks.push({
      id: `global-ceiling-plus-one:${field}`,
      expectedCode: 'NOVEL_IMPORT_BUDGET_INVALID',
      expectedOutcome: 'rejected',
      values: { ...ceiling, [field]: profile.budgets[field].globalCeiling + 1 },
    });
  }
  return checks;
}

export function validateSelectedBudget(profile, selectedBudget) {
  validateBudgetProfile(profile);
  assertRecord(selectedBudget, 'selectedBudget');
  assertExactKeys(selectedBudget, TXT_RESOURCE_BUDGET_FIELDS, 'selectedBudget');
  for (const field of TXT_RESOURCE_BUDGET_FIELDS) {
    const value = selectedBudget[field];
    assertPositiveSafeInteger(value, `selectedBudget.${field}`);
    const bounds = profile.budgets[field];
    let violatedBound;
    if (value < bounds.minimum)
      violatedBound = 'minimum';
    else if (value > bounds.globalCeiling)
      violatedBound = 'globalCeiling';
    else if (value > bounds.maximum)
      violatedBound = 'maximum';
    if (violatedBound !== undefined) {
      throw invalid(`selectedBudget.${field} is outside the approved range.`, {
        dimension: field,
        configuredLimit: value,
        globalCeiling: bounds.globalCeiling,
        maximum: bounds.maximum,
        minimum: bounds.minimum,
        violatedBound,
      });
    }
  }
  return selectedBudget;
}

function assertMetricSet(run, label) {
  for (const field of TXT_RESOURCE_RUN_METRIC_FIELDS) {
    const value = run[field];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
      throw invalid(`${label}.${field} must be a non-negative finite number.`);
  }
  if (run.processStartRssBytes <= 0 || run.sampledPeakRssBytes <= 0)
    throw invalid(`${label} must record positive RSS measurements.`);
}

export function calculateTxtResourceCaseMaxima(rawRuns) {
  if (!Array.isArray(rawRuns) || rawRuns.length === 0)
    throw invalid('rawRuns must contain at least one measurement.');
  return Object.fromEntries(TXT_RESOURCE_RUN_METRIC_FIELDS.map(field => [
    field,
    Math.max(...rawRuns.map(run => run[field])),
  ]));
}

function assertRecommendationValue(value, label) {
  assertPositiveSafeInteger(value, label);
  return value;
}

export function calculateTxtResourceRecommendations(cases, profile, boundaryChecks) {
  validateBudgetProfile(profile);
  if (!Array.isArray(cases) || cases.length === 0)
    throw invalid('cases must contain benchmark evidence for recommendations.');
  if (!Array.isArray(boundaryChecks))
    throw invalid('boundaryChecks must be an array for recommendations.');
  const rawRuns = cases.flatMap(benchmarkCase => benchmarkCase.rawRuns);
  if (rawRuns.length === 0)
    throw invalid('cases must retain raw runs for recommendations.');
  const observed = field => Math.max(...rawRuns.map(run => run[field]));
  const maxInputBytes = Math.max(...cases.map(benchmarkCase => benchmarkCase.input.byteLength));
  const requiredTemporaryBytes = Math.max(
    ...cases.map(benchmarkCase => estimateTxtResourceTemporaryBytes(
      benchmarkCase.input.byteLength,
    )),
  );
  const cancel = boundaryChecks.find(check => check.id === 'cancel');
  const values = {
    cancelCheckBytes: Math.max(1, cancel?.configuredCancelCheckBytes ?? 1),
    maxBlockCount: Math.ceil(observed('blockCount') * 1.25),
    maxBlockUtf8Bytes: Math.ceil(observed('maxBlockUtf8Bytes') * 1.25),
    maxRssBytes: Math.ceil(Math.max(
      observed('sampledPeakRssBytes'),
      observed('resourceUsageMaxRssBytes'),
    ) * 1.25),
    maxSourceBytes: maxInputBytes,
    maxTemporaryBytes: Math.max(
      requiredTemporaryBytes,
      Math.ceil(observed('peakTemporaryBytes') * 1.25),
    ),
    progressStepBytes: profile.budgets.progressStepBytes.default,
    readChunkBytes: profile.budgets.readChunkBytes.default,
    taskTimeoutMs: Math.max(1, Math.ceil(observed('wallTimeMs') * 2)),
  };
  for (const field of TXT_RESOURCE_BUDGET_FIELDS)
    assertRecommendationValue(values[field], `recommendations.values.${field}`);
  return {
    approvalStatus: 'unapproved',
    basis: 'measurement-derived candidates; independent owner approval is still required',
    values,
  };
}

function validateRawRun(run, input, label) {
  assertRecord(run, label);
  if (run.status !== 'completed')
    throw invalid(`${label}.status must be completed.`);
  assertPositiveSafeInteger(run.sequence, `${label}.sequence`);
  assertPositiveSafeInteger(run.processId, `${label}.processId`);
  assertSha256(run.inputSha256, `${label}.inputSha256`);
  assertSha256(run.outputSha256, `${label}.outputSha256`);
  if (run.inputSha256 !== input.sha256)
    throw invalid(`${label} input hash does not match the case input.`);
  if (run.bytesRead !== input.byteLength || !Number.isSafeInteger(run.bytesWritten) || run.bytesWritten <= 0)
    throw invalid(`${label} byte counts are invalid.`);
  if (run.artifactCommitted !== false || run.temporaryOutputRemoved !== true)
    throw invalid(`${label} must record cleanup without a committed artifact.`);
  assertMetricSet(run, label);
}

function validateInput(input, label) {
  assertRecord(input, label);
  if (input.kind !== 'synthetic' && input.kind !== 'authorized-real')
    throw invalid(`${label}.kind is unsupported.`);
  assertNonEmptyString(input.sampleId, `${label}.sampleId`);
  assertSha256(input.sha256, `${label}.sha256`);
  assertPositiveSafeInteger(input.byteLength, `${label}.byteLength`);
  assertNonEmptyString(input.encoding, `${label}.encoding`);
  if (input.kind === 'synthetic') {
    const definition = TXT_RESOURCE_SAMPLE_DEFINITIONS.find(
      candidate => candidate.id === input.sampleId,
    );
    if (definition === undefined)
      throw invalid(`${label}.sampleId is not a fixed synthetic case.`);
    if (
      input.byteLength !== definition.byteLength
      || input.encoding !== definition.encoding
      || input.layout !== definition.layout
      || input.generatorVersion !== TXT_RESOURCE_SAMPLE_GENERATOR_VERSION
      || !Number.isSafeInteger(input.seed)
      || input.seed < 0
    ) {
      throw invalid(`${label} does not match its fixed synthetic definition.`);
    }
    if (input.seed === TXT_RESOURCE_SAMPLE_SEED && input.sha256 !== definition.expectedSha256)
      throw invalid(`${label}.sha256 does not match the fixed seed hash.`);
  } else {
    assertNonEmptyString(input.evidenceRef, `${label}.evidenceRef`);
  }
}

function validateCases(profile, results, requireFiveRuns, requireRealSample, requireCompleteMatrix) {
  if (!Array.isArray(results.cases) || results.cases.length === 0)
    throw invalid('results.cases must contain benchmark evidence.');
  let realSampleFound = false;
  for (const [caseIndex, benchmarkCase] of results.cases.entries()) {
    const label = `results.cases[${caseIndex}]`;
    assertRecord(benchmarkCase, label);
    validateInput(benchmarkCase.input, `${label}.input`);
    if (!Array.isArray(benchmarkCase.rawRuns))
      throw invalid(`${label}.rawRuns must be an array.`);
    const minimumRuns = requireFiveRuns ? Math.max(5, profile.runsPerCase) : profile.runsPerCase;
    if (benchmarkCase.rawRuns.length < minimumRuns)
      throw invalid(`${label}.rawRuns must retain at least ${minimumRuns} runs.`);
    const processIds = new Set();
    for (const [runIndex, run] of benchmarkCase.rawRuns.entries()) {
      validateRawRun(run, benchmarkCase.input, `${label}.rawRuns[${runIndex}]`);
      if (processIds.has(run.processId))
        throw invalid(`${label}.rawRuns must use independent child processes.`);
      processIds.add(run.processId);
    }
    assertSha256(benchmarkCase.outputSha256, `${label}.outputSha256`);
    assertPositiveSafeInteger(benchmarkCase.outputByteLength, `${label}.outputByteLength`);
    if (benchmarkCase.rawRuns.some(run => run.outputSha256 !== benchmarkCase.outputSha256))
      throw invalid(`${label}.outputSha256 is unstable.`);
    if (benchmarkCase.rawRuns.some(run => run.bytesWritten !== benchmarkCase.outputByteLength))
      throw invalid(`${label}.outputByteLength is unstable.`);
    const expectedMaxima = calculateTxtResourceCaseMaxima(benchmarkCase.rawRuns);
    if (stableJson(benchmarkCase.maxima) !== stableJson(expectedMaxima))
      throw invalid(`${label}.maxima does not match its raw runs.`);
    if (benchmarkCase.input.kind === 'authorized-real') {
      realSampleFound = true;
      const expected = profile.realSampleEvidence;
      if (
        expected === undefined
        || benchmarkCase.input.sampleId !== expected.sampleId
        || benchmarkCase.input.sha256 !== expected.sha256
        || benchmarkCase.input.byteLength !== expected.byteLength
        || benchmarkCase.input.encoding !== expected.encoding
        || benchmarkCase.input.evidenceRef !== expected.evidenceRef
      ) {
        throw invalid(`${label}.input does not match authorized real sample evidence.`);
      }
    }
  }
  if (requireRealSample && !realSampleFound)
    throw invalid('Results do not contain the authorized real sample run.');
  if (requireCompleteMatrix) {
    const syntheticIds = new Set(
      results.cases
        .filter(benchmarkCase => benchmarkCase.input.kind === 'synthetic')
        .map(benchmarkCase => benchmarkCase.input.sampleId),
    );
    if (
      syntheticIds.size !== TXT_RESOURCE_SAMPLE_DEFINITIONS.length
      || TXT_RESOURCE_SAMPLE_DEFINITIONS.some(definition => !syntheticIds.has(definition.id))
      || results.sampleGenerator?.seed !== TXT_RESOURCE_SAMPLE_SEED
      || results.sampleGenerator?.version !== TXT_RESOURCE_SAMPLE_GENERATOR_VERSION
    ) {
      throw invalid('Formal results must retain the complete fixed synthetic matrix.');
    }
  }
}

function validateBoundaryEvidence(results) {
  if (!Array.isArray(results.boundaryChecks))
    throw invalid('results.boundaryChecks must be an array.');
  const requiredIds = [
    'default',
    'ceiling',
    ...TXT_RESOURCE_BUDGET_FIELDS.map(field => `ceiling-plus-one:${field}`),
    ...TXT_RESOURCE_BUDGET_FIELDS.map(field => `global-ceiling-plus-one:${field}`),
    'cancel',
    'timeout',
    'temporary-space',
  ];
  const byId = new Map(results.boundaryChecks.map(check => [check.id, check]));
  for (const id of requiredIds) {
    const check = byId.get(id);
    if (check === undefined || check.passed !== true)
      throw invalid(`Boundary check ${id} is missing or did not pass.`);
  }
  const cancel = byId.get('cancel');
  if (
    cancel.code !== 'NOVEL_IMPORT_CANCELLED'
    || !Number.isFinite(cancel.cancelLatencyMs)
    || cancel.cancelLatencyMs < 0
    || !Number.isSafeInteger(cancel.bytesPastCancellation)
    || cancel.bytesPastCancellation <= 0
    || !Number.isSafeInteger(cancel.cancelAfterBytes)
    || cancel.cancelAfterBytes <= 0
    || !Number.isSafeInteger(cancel.cancellationWindowBytes)
    || cancel.cancellationWindowBytes <= 0
    || cancel.cancelAfterBytes % cancel.cancellationWindowBytes === 0
    || !Number.isSafeInteger(cancel.configuredCancelCheckBytes)
    || !Number.isSafeInteger(cancel.configuredReadChunkBytes)
    || cancel.bytesPastCancellation > Math.min(
      cancel.configuredCancelCheckBytes,
      cancel.configuredReadChunkBytes,
    )
    || cancel.cancellationWindowBytes !== Math.min(
      cancel.configuredCancelCheckBytes,
      cancel.configuredReadChunkBytes,
      results.cases[0].input.byteLength,
    )
  ) {
    throw invalid('Cancellation boundary evidence is invalid.');
  }
  if (byId.get('timeout').code !== 'NOVEL_IMPORT_RESOURCE_LIMIT_EXCEEDED')
    throw invalid('Timeout boundary evidence is invalid.');
  if (byId.get('temporary-space').code !== 'NOVEL_IMPORT_RESOURCE_LIMIT_EXCEEDED')
    throw invalid('Temporary-space boundary evidence is invalid.');
}

function assertNoPersistedPaths(value, label = 'results') {
  if (typeof value === 'string') {
    if (isAbsolute(value) || /^file:/i.test(value))
      throw invalid(`${label} contains a persisted filesystem path.`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoPersistedPaths(entry, `${label}[${index}]`));
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value))
      assertNoPersistedPaths(entry, `${label}.${key}`);
  }
}

function validateExecutionEvidence(results) {
  assertRecord(results.environment, 'results.environment');
  for (const field of [
    'arch',
    'cpuModel',
    'icuVersion',
    'machine',
    'machineId',
    'nodeVersion',
    'osPlatform',
    'osRelease',
  ]) {
    assertNonEmptyString(results.environment[field], `results.environment.${field}`);
  }
  if (results.environment.nodeVersion !== 'v24.18.1')
    throw invalid('Results must be produced by Node v24.18.1.');
  if (typeof results.gitRevision !== 'string' || !/^[\da-f]{40}(?:[\da-f]{24})?$/.test(results.gitRevision))
    throw invalid('results.gitRevision must be a Git object ID.');
  for (const field of ['startedAt', 'completedAt']) {
    if (typeof results[field] !== 'string' || Number.isNaN(Date.parse(results[field])))
      throw invalid(`results.${field} must be an ISO-compatible timestamp.`);
  }
  assertNonEmptyString(results.command, 'results.command');
  if (results.exitCode !== 0)
    throw invalid('results.exitCode must be zero.');
}

export function verifyTxtResourceResults(profile, results, options = {}) {
  const {
    requireApproved = true,
    requireFiveRuns = true,
    requireRealSample = true,
  } = options;
  validateBudgetProfile(profile, { requireApproved, requireRealSample });
  assertRecord(results, 'results');
  if (results.schemaVersion !== TXT_RESOURCE_RESULTS_SCHEMA_VERSION)
    throw invalid(`Unsupported results schemaVersion: ${results.schemaVersion}`);
  if (results.status !== 'complete')
    throw invalid('results.status must be complete.');
  if (results.profileSha256 !== sha256Json(profile))
    throw invalid('Results profile hash does not match the supplied profile.');
  assertSha256(results.payloadSha256, 'results.payloadSha256');
  if (results.payloadSha256 !== calculateResultsPayloadSha256(results))
    throw invalid('Results payload hash does not match its content.');
  validateExecutionEvidence(results);
  if (results.cleanup?.benchmarkTemporaryRootRemoved !== true)
    throw invalid('Results must record benchmark temporary-root cleanup.');
  if (results.formalArtifactCreated !== false)
    throw invalid('The harness must not create a product artifact revision.');
  validateCases(profile, results, requireFiveRuns, requireRealSample, requireApproved);
  validateBoundaryEvidence(results);
  const expectedRecommendations = calculateTxtResourceRecommendations(
    results.cases,
    profile,
    results.boundaryChecks,
  );
  if (stableJson(results.recommendations) !== stableJson(expectedRecommendations))
    throw invalid('results.recommendations does not match raw measurements and preflight rules.');
  assertNoPersistedPaths(results);
  return results;
}

function parseArguments(arguments_) {
  const options = {};
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--profile')
      options.profilePath = arguments_[index += 1];
    else if (argument === '--results')
      options.resultsPath = arguments_[index += 1];
    else
      throw new Error(`Unknown argument: ${argument}`);
  }
  if (options.profilePath === undefined || options.resultsPath === undefined)
    throw new Error('--profile and --results are required.');
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const [profile, results] = await Promise.all([
    readFile(options.profilePath, 'utf8').then(JSON.parse),
    readFile(options.resultsPath, 'utf8').then(JSON.parse),
  ]);
  verifyTxtResourceResults(profile, results);
  process.stdout.write(`${JSON.stringify({
    payloadSha256: results.payloadSha256,
    status: 'verified',
  })}\n`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
