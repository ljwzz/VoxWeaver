import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createReadStream, createWriteStream } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  statfs,
  writeFile,
} from 'node:fs/promises';
import { arch, cpus, machine, platform, release, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';

import {
  assertSystemTemporaryChild,
  generateTxtResourceSamples,
  TXT_RESOURCE_SAMPLE_GENERATOR_VERSION,
  TXT_RESOURCE_SAMPLE_SEED,
} from './generateTxtResourceSamples.mjs';
import {
  buildBudgetBoundaryChecks,
  calculateResultsPayloadSha256,
  calculateTxtResourceCaseMaxima,
  calculateTxtResourceRecommendations,
  estimateTxtResourceTemporaryBytes,
  selectBudget,
  sha256Json,
  TXT_RESOURCE_BUDGET_FIELDS,
  TXT_RESOURCE_PROFILE_SCHEMA_VERSION,
  TXT_RESOURCE_RESULTS_SCHEMA_VERSION,
  validateBudgetProfile,
  validateSelectedBudget,
  verifyTxtResourceResults,
} from './verifyTxtResourceResults.mjs';

export const TXT_RESOURCE_BENCHMARK_VERSION = 'm1-b05-benchmark-v1';

const REQUIRED_NODE_VERSION = 'v24.18.1';
const MEBIBYTE = 1_048_576;
const WORKER_ARGUMENT = '--worker';
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export const TXT_RESOURCE_EXPLORATION_PROFILE = Object.freeze({
  schemaVersion: TXT_RESOURCE_PROFILE_SCHEMA_VERSION,
  profileId: 'm1-b05-exploration-safety-envelope',
  budgetProfileVersion: 'm1-b05-exploration-unapproved-v1',
  approval: Object.freeze({ status: 'unapproved' }),
  runsPerCase: 5,
  budgets: Object.freeze({
    maxSourceBytes: budget(1, 50 * MEBIBYTE, 50 * MEBIBYTE, 50 * MEBIBYTE),
    readChunkBytes: budget(4096, 256 * 1024, MEBIBYTE, 4 * MEBIBYTE),
    maxRssBytes: budget(32 * MEBIBYTE, 512 * MEBIBYTE, 768 * MEBIBYTE, 1024 * MEBIBYTE),
    maxTemporaryBytes: budget(MEBIBYTE, 128 * MEBIBYTE, 256 * MEBIBYTE, 512 * MEBIBYTE),
    maxBlockCount: budget(1, 20_000_000, 20_000_000, 50_000_000),
    maxBlockUtf8Bytes: budget(1, 160 * MEBIBYTE, 200 * MEBIBYTE, 256 * MEBIBYTE),
    taskTimeoutMs: budget(100, 120_000, 300_000, 600_000),
    cancelCheckBytes: budget(4096, 256 * 1024, MEBIBYTE, 4 * MEBIBYTE),
    progressStepBytes: budget(4096, MEBIBYTE, 10 * MEBIBYTE, 50 * MEBIBYTE),
  }),
});

function budget(minimum, defaultValue, maximum, globalCeiling) {
  return Object.freeze({
    default: defaultValue,
    globalCeiling,
    maximum,
    minimum,
  });
}

function resourceLimitError(config, dimension, observed, reason) {
  const error = new Error(`TXT resource limit exceeded: ${dimension}.`);
  error.code = 'NOVEL_IMPORT_RESOURCE_LIMIT_EXCEEDED';
  error.details = {
    budgetProfileVersion: config.budgetProfileVersion,
    configuredLimit: config.budget[dimension],
    dimension,
    globalCeiling: config.globalCeilings[dimension],
    observed,
    reason,
  };
  return error;
}

function cancellationError(config, measurement) {
  const error = new Error('TXT resource benchmark cancelled.');
  error.code = 'NOVEL_IMPORT_CANCELLED';
  error.details = {
    budgetProfileVersion: config.budgetProfileVersion,
    bytesPastCancellation: measurement.bytesPastCancellation,
    cancelLatencyMs: measurement.cancelLatencyMs,
    configuredCancelCheckBytes: config.budget.cancelCheckBytes,
  };
  return error;
}

function checkCancellation(config, measurement) {
  if (measurement.cancellationRequestedAt === undefined)
    return;
  measurement.cancelLatencyMs = performance.now() - measurement.cancellationRequestedAt;
  throw cancellationError(config, measurement);
}

function globalCeilings(profile) {
  return Object.fromEntries(
    TXT_RESOURCE_BUDGET_FIELDS.map(field => [field, profile.budgets[field].globalCeiling]),
  );
}

function toSafeAvailableBytes(fileSystem) {
  const available = BigInt(fileSystem.bavail) * BigInt(fileSystem.bsize);
  return Number(available > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : available);
}

function recordDecodedBytes(text, measurement, config) {
  if (text.length === 0)
    return Buffer.alloc(0);
  const encoded = Buffer.from(text, 'utf8');
  let start = 0;
  while (start < encoded.length) {
    const newline = encoded.indexOf(0x0A, start);
    if (newline === -1) {
      measurement.currentBlockUtf8Bytes += encoded.length - start;
      break;
    }
    measurement.currentBlockUtf8Bytes += newline - start;
    measurement.maxBlockUtf8Bytes = Math.max(
      measurement.maxBlockUtf8Bytes,
      measurement.currentBlockUtf8Bytes,
    );
    measurement.currentBlockUtf8Bytes = 0;
    measurement.blockCount += 1;
    checkCancellation(config, measurement);
    start = newline + 1;
  }
  measurement.maxBlockUtf8Bytes = Math.max(
    measurement.maxBlockUtf8Bytes,
    measurement.currentBlockUtf8Bytes,
  );
  if (measurement.blockCount > config.budget.maxBlockCount) {
    throw resourceLimitError(
      config,
      'maxBlockCount',
      measurement.blockCount,
      'runtime_block_count',
    );
  }
  if (measurement.maxBlockUtf8Bytes > config.budget.maxBlockUtf8Bytes) {
    throw resourceLimitError(
      config,
      'maxBlockUtf8Bytes',
      measurement.maxBlockUtf8Bytes,
      'runtime_block_size',
    );
  }
  return encoded;
}

function updateProgress(measurement, config) {
  while (measurement.bytesRead >= measurement.nextProgressByte) {
    measurement.progressEventCount += 1;
    measurement.nextProgressByte += config.budget.progressStepBytes;
  }
}

function updateRss(measurement, config) {
  const rss = process.memoryUsage.rss();
  measurement.sampledPeakRssBytes = Math.max(measurement.sampledPeakRssBytes, rss);
  measurement.periodicRssSampleCount += 1;
  if (rss > config.budget.maxRssBytes)
    throw resourceLimitError(config, 'maxRssBytes', rss, 'runtime_rss');
}

function checkElapsed(measurement, config) {
  const elapsed = performance.now() - measurement.startedAt;
  if (elapsed > config.budget.taskTimeoutMs) {
    throw resourceLimitError(
      config,
      'taskTimeoutMs',
      Math.ceil(elapsed),
      'runtime_timeout',
    );
  }
}

async function writeWithBackpressure(output, chunk, measurement) {
  if (chunk.length === 0)
    return;
  if (!output.write(chunk)) {
    measurement.backpressureWaitCount += 1;
    await once(output, 'drain');
  }
  measurement.bytesWritten += chunk.length;
  measurement.peakTemporaryBytes = Math.max(
    measurement.peakTemporaryBytes,
    measurement.bytesWritten,
  );
}

function createMeasurement(config) {
  const processStartRssBytes = process.memoryUsage.rss();
  return {
    backpressureWaitCount: 0,
    blockCount: 1,
    bytesPastCancellation: 0,
    bytesRead: 0,
    bytesWritten: 0,
    cancelLatencyMs: 0,
    cancellationRequestedAt: undefined,
    cpuStart: process.cpuUsage(),
    currentBlockUtf8Bytes: 0,
    maxBlockUtf8Bytes: 0,
    nextProgressByte: config.budget.progressStepBytes,
    peakTemporaryBytes: 0,
    periodicRssSampleCount: 1,
    processStartRssBytes,
    progressEventCount: 0,
    sampledPeakRssBytes: processStartRssBytes,
    startedAt: performance.now(),
  };
}

function finalizeMeasurement(measurement) {
  const cpu = process.cpuUsage(measurement.cpuStart);
  const wallTimeMs = performance.now() - measurement.startedAt;
  const resourceUsageMaxRssBytes = process.resourceUsage().maxRSS * 1024;
  return {
    backpressureWaitCount: measurement.backpressureWaitCount,
    blockCount: measurement.blockCount,
    bytesPastCancellation: measurement.bytesPastCancellation,
    bytesRead: measurement.bytesRead,
    bytesWritten: measurement.bytesWritten,
    cancelLatencyMs: measurement.cancelLatencyMs,
    cpuSystemMicros: cpu.system,
    cpuUserMicros: cpu.user,
    maxBlockUtf8Bytes: measurement.maxBlockUtf8Bytes,
    peakTemporaryBytes: measurement.peakTemporaryBytes,
    periodicRssSampleCount: measurement.periodicRssSampleCount,
    processStartRssBytes: measurement.processStartRssBytes,
    progressEventCount: measurement.progressEventCount,
    resourceUsageMaxRssBytes,
    sampledPeakRssBytes: Math.max(
      measurement.sampledPeakRssBytes,
      process.memoryUsage.rss(),
    ),
    throughputBytesPerSecond: wallTimeMs === 0
      ? 0
      : measurement.bytesRead / (wallTimeMs / 1000),
    wallTimeMs,
  };
}

function validateWorkerConfig(config) {
  if (config === null || typeof config !== 'object')
    throw new TypeError('Worker config must be an object.');
  validateSelectedBudget({
    ...TXT_RESOURCE_EXPLORATION_PROFILE,
    budgetProfileVersion: config.budgetProfileVersion,
    budgets: Object.fromEntries(TXT_RESOURCE_BUDGET_FIELDS.map(field => [field, {
      default: config.budget[field],
      globalCeiling: config.globalCeilings[field],
      maximum: config.globalCeilings[field],
      minimum: 1,
    }])),
  }, config.budget);
  if (typeof config.sourcePath !== 'string' || typeof config.outputPath !== 'string')
    throw new TypeError('Worker sourcePath and outputPath are required.');
  if (typeof config.encoding !== 'string')
    throw new TypeError('Worker encoding is required.');
}

async function executeWorker(config) {
  validateWorkerConfig(config);
  const measurement = createMeasurement(config);
  const inputDigest = createHash('sha256');
  const outputDigest = createHash('sha256');
  let input;
  let output;
  let result;
  let temporaryOutputRemoved = false;
  const rssSampler = setInterval(() => {
    const rss = process.memoryUsage.rss();
    measurement.sampledPeakRssBytes = Math.max(measurement.sampledPeakRssBytes, rss);
    measurement.periodicRssSampleCount += 1;
  }, 5);
  rssSampler.unref();

  try {
    const source = await stat(config.sourcePath);
    if (!source.isFile())
      throw new TypeError('Worker source must be a regular file.');
    if (source.size > config.budget.maxSourceBytes) {
      throw resourceLimitError(
        config,
        'maxSourceBytes',
        source.size,
        'source_preflight',
      );
    }
    const estimatedTemporaryBytes = estimateTxtResourceTemporaryBytes(source.size);
    if (estimatedTemporaryBytes > config.budget.maxTemporaryBytes) {
      throw resourceLimitError(
        config,
        'maxTemporaryBytes',
        estimatedTemporaryBytes,
        'temporary_preflight',
      );
    }
    const fileSystem = await statfs(dirname(config.outputPath));
    const actualAvailable = toSafeAvailableBytes(fileSystem);
    const availableTemporaryBytes = Math.min(
      actualAvailable,
      config.availableTemporaryBytes ?? Number.MAX_SAFE_INTEGER,
    );
    if (estimatedTemporaryBytes > availableTemporaryBytes) {
      throw resourceLimitError(
        config,
        'maxTemporaryBytes',
        estimatedTemporaryBytes,
        'insufficient_temporary_space',
      );
    }
    updateRss(measurement, config);

    const decoder = new TextDecoder(config.encoding, { fatal: true, ignoreBOM: true });
    const highWaterMark = Math.min(
      config.budget.readChunkBytes,
      config.budget.cancelCheckBytes,
    );
    input = createReadStream(config.sourcePath, { highWaterMark });
    output = createWriteStream(config.outputPath, { flags: 'wx' });

    for await (const chunk of input) {
      if (config.perChunkDelayMs !== undefined)
        await delay(config.perChunkDelayMs);
      checkElapsed(measurement, config);
      inputDigest.update(chunk);
      measurement.bytesRead += chunk.length;
      updateProgress(measurement, config);
      if (
        config.cancelAfterBytes !== undefined
        && measurement.bytesRead >= config.cancelAfterBytes
      ) {
        measurement.cancellationRequestedAt ??= performance.now();
        measurement.bytesPastCancellation = measurement.bytesRead - config.cancelAfterBytes;
      }
      const decoded = decoder.decode(chunk, { stream: true });
      const encoded = recordDecodedBytes(decoded, measurement, config);
      checkCancellation(config, measurement);
      outputDigest.update(encoded);
      await writeWithBackpressure(output, encoded, measurement);
      if (measurement.peakTemporaryBytes > config.budget.maxTemporaryBytes) {
        throw resourceLimitError(
          config,
          'maxTemporaryBytes',
          measurement.peakTemporaryBytes,
          'runtime_temporary_bytes',
        );
      }
      updateRss(measurement, config);
    }

    const finalEncoded = recordDecodedBytes(decoder.decode(), measurement, config);
    outputDigest.update(finalEncoded);
    await writeWithBackpressure(output, finalEncoded, measurement);
    output.end();
    await once(output, 'finish');
    updateRss(measurement, config);
    checkElapsed(measurement, config);
    const metrics = finalizeMeasurement(measurement);
    if (metrics.resourceUsageMaxRssBytes > config.budget.maxRssBytes) {
      throw resourceLimitError(
        config,
        'maxRssBytes',
        metrics.resourceUsageMaxRssBytes,
        'resource_usage_max_rss',
      );
    }
    result = {
      ...metrics,
      artifactCommitted: false,
      inputSha256: inputDigest.digest('hex'),
      outputSha256: outputDigest.digest('hex'),
      processId: process.pid,
      status: 'completed',
    };
  } catch (error) {
    result = {
      ...finalizeMeasurement(measurement),
      artifactCommitted: false,
      code: typeof error?.code === 'string' ? error.code : 'BENCHMARK_WORKER_FAILED',
      details: error?.details ?? {},
      message: error instanceof Error ? error.message : String(error),
      processId: process.pid,
      status: 'failed',
    };
  } finally {
    clearInterval(rssSampler);
    input?.destroy();
    output?.destroy();
    if (output !== undefined && !output.closed)
      await once(output, 'close').catch(() => {});
    await rm(config.outputPath, { force: true });
    temporaryOutputRemoved = true;
  }
  return { ...result, temporaryOutputRemoved };
}

function encodeWorkerConfig(config) {
  return Buffer.from(JSON.stringify(config)).toString('base64url');
}

function decodeWorkerConfig(payload) {
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

async function spawnWorker(config) {
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), WORKER_ARGUMENT, encodeWorkerConfig(config)], {
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const standardOutput = [];
  const standardError = [];
  child.stdout.on('data', chunk => standardOutput.push(chunk));
  child.stderr.on('data', chunk => standardError.push(chunk));
  const [exitCode] = await once(child, 'exit');
  const outputText = Buffer.concat(standardOutput).toString('utf8').trim();
  if (exitCode !== 0 || outputText === '') {
    throw new Error(
      `TXT resource worker failed (${exitCode}): ${Buffer.concat(standardError).toString('utf8').trim()}`,
    );
  }
  const envelope = JSON.parse(outputText);
  if (envelope.ok !== true)
    throw new Error(`TXT resource worker bootstrap failed: ${envelope.message}`);
  return envelope.result;
}

async function hashFile(path) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(path))
    digest.update(chunk);
  return digest.digest('hex');
}

async function readGitRevision() {
  const child = spawn('git', ['rev-parse', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'] });
  const chunks = [];
  child.stdout.on('data', chunk => chunks.push(chunk));
  const [exitCode] = await once(child, 'exit');
  return exitCode === 0 ? Buffer.concat(chunks).toString('utf8').trim() : 'unavailable';
}

function sanitizeSyntheticSample(sample) {
  return {
    byteLength: sample.byteLength,
    encoding: sample.encoding,
    generatorVersion: sample.generatorVersion,
    kind: 'synthetic',
    layout: sample.layout,
    sampleId: sample.id,
    seed: sample.seed,
    sha256: sample.sha256,
  };
}

async function loadAuthorizedRealSample(profile, realSamplePath) {
  if (realSamplePath === undefined)
    throw new Error('An approved run requires --real-sample or VOXWEAVER_M1_REAL_SAMPLE_PATH.');
  const evidence = profile.realSampleEvidence;
  const metadata = await stat(realSamplePath);
  if (!metadata.isFile())
    throw new Error('The authorized real sample runtime input is not a regular file.');
  const sha256 = await hashFile(realSamplePath);
  if (metadata.size !== evidence.byteLength || sha256 !== evidence.sha256)
    throw new Error('The authorized real sample runtime input does not match its evidence.');
  return {
    input: {
      byteLength: metadata.size,
      encoding: evidence.encoding,
      evidenceRef: evidence.evidenceRef,
      kind: 'authorized-real',
      sampleId: evidence.sampleId,
      sha256,
    },
    path: realSamplePath,
  };
}

function workerConfig(profile, selectedBudget, sample, outputPath, overrides = {}) {
  return {
    budget: selectedBudget,
    budgetProfileVersion: profile.budgetProfileVersion,
    encoding: sample.input.encoding,
    globalCeilings: globalCeilings(profile),
    outputPath,
    sourcePath: sample.path,
    ...overrides,
  };
}

async function runOneWorker({
  benchmarkRoot,
  profile,
  sample,
  selectedBudget,
  sequence,
  overrides,
}) {
  const runDirectory = join(benchmarkRoot, `run-${String(sequence).padStart(4, '0')}-${randomUUID()}`);
  await mkdir(runDirectory);
  let run;
  try {
    run = await spawnWorker(workerConfig(
      profile,
      selectedBudget,
      sample,
      join(runDirectory, 'raw-utf8.tmp'),
      overrides,
    ));
  } finally {
    await rm(runDirectory, { force: true, recursive: true });
  }
  return { ...run, runDirectoryRemoved: true, sequence };
}

async function executeConfigurationBoundaries(profile) {
  return buildBudgetBoundaryChecks(profile).map((check) => {
    try {
      validateSelectedBudget(profile, check.values);
      return {
        code: null,
        expectedCode: check.expectedCode,
        id: check.id,
        passed: check.expectedOutcome === 'accepted',
      };
    } catch (error) {
      return {
        code: error.code ?? 'UNKNOWN',
        expectedCode: check.expectedCode,
        id: check.id,
        passed: check.expectedOutcome === 'rejected' && error.code === check.expectedCode,
      };
    }
  });
}

async function executeRuntimeBoundaries(context, sample, nextSequence) {
  const checks = [];
  for (const mode of ['default', 'ceiling']) {
    const budgetValues = selectBudget(context.profile, mode);
    const run = await runOneWorker({
      ...context,
      sample,
      selectedBudget: budgetValues,
      sequence: nextSequence(),
    });
    checks.push({
      id: mode,
      outputSha256: run.outputSha256,
      passed: run.status === 'completed' && run.runDirectoryRemoved,
      processId: run.processId,
    });
  }

  const selectedBudget = selectBudget(context.profile, 'default');
  const cancellationWindowBytes = Math.min(
    sample.input.byteLength,
    selectedBudget.cancelCheckBytes,
    selectedBudget.readChunkBytes,
  );
  const cancelAfterBytes = Math.max(1, Math.floor(cancellationWindowBytes / 2) + 1);
  const cancelRun = await runOneWorker({
    ...context,
    overrides: { cancelAfterBytes },
    sample,
    selectedBudget,
    sequence: nextSequence(),
  });
  checks.push({
    bytesPastCancellation: cancelRun.details?.bytesPastCancellation,
    cancelAfterBytes,
    cancelLatencyMs: cancelRun.details?.cancelLatencyMs,
    cancellationWindowBytes,
    code: cancelRun.code,
    configuredCancelCheckBytes: selectedBudget.cancelCheckBytes,
    configuredReadChunkBytes: selectedBudget.readChunkBytes,
    id: 'cancel',
    passed: cancelRun.code === 'NOVEL_IMPORT_CANCELLED'
      && cancelRun.temporaryOutputRemoved
      && cancelRun.runDirectoryRemoved
      && cancelAfterBytes % cancellationWindowBytes !== 0
      && cancelRun.details.bytesPastCancellation > 0
      && cancelRun.details.bytesPastCancellation <= Math.min(
        selectedBudget.cancelCheckBytes,
        selectedBudget.readChunkBytes,
      ),
    processId: cancelRun.processId,
  });

  const timeoutBudget = { ...selectedBudget, taskTimeoutMs: 1 };
  const timeoutRun = await runOneWorker({
    ...context,
    overrides: { perChunkDelayMs: 5 },
    sample,
    selectedBudget: timeoutBudget,
    sequence: nextSequence(),
  });
  checks.push({
    code: timeoutRun.code,
    dimension: timeoutRun.details?.dimension,
    id: 'timeout',
    passed: timeoutRun.code === 'NOVEL_IMPORT_RESOURCE_LIMIT_EXCEEDED'
      && timeoutRun.details?.dimension === 'taskTimeoutMs'
      && timeoutRun.temporaryOutputRemoved
      && timeoutRun.runDirectoryRemoved,
    processId: timeoutRun.processId,
  });

  const temporaryRun = await runOneWorker({
    ...context,
    overrides: { availableTemporaryBytes: sample.input.byteLength - 1 },
    sample,
    selectedBudget,
    sequence: nextSequence(),
  });
  checks.push({
    code: temporaryRun.code,
    dimension: temporaryRun.details?.dimension,
    id: 'temporary-space',
    passed: temporaryRun.code === 'NOVEL_IMPORT_RESOURCE_LIMIT_EXCEEDED'
      && temporaryRun.details?.reason === 'insufficient_temporary_space'
      && temporaryRun.temporaryOutputRemoved
      && temporaryRun.runDirectoryRemoved,
    processId: temporaryRun.processId,
  });
  return checks;
}

function mergeBoundaryChecks(configurationChecks, runtimeChecks) {
  const runtimeById = new Map(runtimeChecks.map(check => [check.id, check]));
  return configurationChecks.map(check => runtimeById.get(check.id) ?? check)
    .concat(runtimeChecks.filter(check => !['default', 'ceiling'].includes(check.id)));
}

function environmentEvidence() {
  const cpuModel = cpus()[0]?.model ?? 'unknown';
  return {
    arch: arch(),
    cpuModel,
    icuVersion: process.versions.icu ?? 'unavailable',
    machine: machine(),
    machineId: process.env.VOXWEAVER_BENCHMARK_MACHINE_ID ?? 'unapproved-exploration-host',
    nodeVersion: process.version,
    osPlatform: platform(),
    osRelease: release(),
  };
}

async function writeJsonAtomically(outputPath, value) {
  await mkdir(dirname(outputPath), { recursive: true });
  const temporaryPath = join(dirname(outputPath), `.${basename(outputPath)}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, undefined, 2)}\n`, { flag: 'wx' });
    await rename(temporaryPath, outputPath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

export async function runTxtResourceBenchmark(options = {}) {
  const {
    caseIds,
    mode = 'explore',
    outputPath,
    realSamplePath,
    seed = TXT_RESOURCE_SAMPLE_SEED,
  } = options;
  if (process.version !== REQUIRED_NODE_VERSION)
    throw new Error(`TXT resource benchmark requires ${REQUIRED_NODE_VERSION}; found ${process.version}.`);
  if (mode !== 'explore' && mode !== 'formal')
    throw new Error('Benchmark mode must be explore or formal.');
  if (mode === 'formal' && caseIds !== undefined)
    throw new Error('Formal benchmark runs must use the complete fixed synthetic matrix.');
  if (mode === 'formal' && seed !== TXT_RESOURCE_SAMPLE_SEED)
    throw new Error('Formal benchmark runs must use the fixed synthetic seed.');
  if (mode === 'formal' && options.runsPerCase !== undefined)
    throw new Error('Formal benchmark run count must come from the approved profile.');
  const profile = mode === 'explore'
    ? structuredClone(TXT_RESOURCE_EXPLORATION_PROFILE)
    : options.profile;
  validateBudgetProfile(profile, {
    requireApproved: mode === 'formal',
    requireRealSample: mode === 'formal',
  });
  if (options.runsPerCase !== undefined) {
    if (!Number.isSafeInteger(options.runsPerCase) || options.runsPerCase < 5)
      throw new Error('runsPerCase must be a safe integer of at least five.');
    profile.runsPerCase = options.runsPerCase;
  }
  if (mode === 'explore' && outputPath !== undefined) {
    await mkdir(dirname(outputPath), { recursive: true });
    await assertSystemTemporaryChild(dirname(outputPath));
  }

  const benchmarkRoot = await mkdtemp(join(tmpdir(), 'voxweaver-m1-b05-'));
  await assertSystemTemporaryChild(benchmarkRoot);
  const startedAt = new Date().toISOString();
  const selectedBudget = selectBudget(profile, 'default');
  const cases = [];
  let sequence = 0;
  let boundaryChecks = [];
  let benchmarkTemporaryRootRemoved = false;
  let benchmarkFailure;
  const nextSequence = () => sequence += 1;

  try {
    const authorizedRealSample = mode === 'formal'
      ? await loadAuthorizedRealSample(profile, realSamplePath)
      : undefined;
    const generated = await generateTxtResourceSamples({
      caseIds,
      directory: join(benchmarkRoot, 'samples'),
      seed,
    });
    const samples = generated.map(sample => ({
      input: sanitizeSyntheticSample(sample),
      path: sample.path,
    }));
    if (authorizedRealSample !== undefined)
      samples.push(authorizedRealSample);

    for (const sample of samples) {
      const rawRuns = [];
      for (let runIndex = 0; runIndex < profile.runsPerCase; runIndex += 1) {
        const run = await runOneWorker({
          benchmarkRoot,
          profile,
          sample,
          selectedBudget,
          sequence: nextSequence(),
        });
        if (run.status !== 'completed') {
          throw new Error(
            `Benchmark case ${sample.input.sampleId} failed: ${run.message} ${JSON.stringify(run.details)}`,
          );
        }
        rawRuns.push(run);
      }
      const outputHashes = new Set(rawRuns.map(run => run.outputSha256));
      if (outputHashes.size !== 1)
        throw new Error(`Benchmark case ${sample.input.sampleId} produced unstable output hashes.`);
      cases.push({
        input: sample.input,
        maxima: calculateTxtResourceCaseMaxima(rawRuns),
        outputByteLength: rawRuns[0].bytesWritten,
        outputSha256: rawRuns[0].outputSha256,
        rawRuns,
      });
    }

    const configurationChecks = await executeConfigurationBoundaries(profile);
    const runtimeChecks = await executeRuntimeBoundaries(
      { benchmarkRoot, profile },
      samples[0],
      nextSequence,
    );
    boundaryChecks = mergeBoundaryChecks(configurationChecks, runtimeChecks);
    if (boundaryChecks.some(check => !check.passed))
      throw new Error('One or more TXT resource boundary checks failed.');
  } catch (error) {
    benchmarkFailure = error;
    throw error;
  } finally {
    await rm(benchmarkRoot, { force: true, recursive: true });
    benchmarkTemporaryRootRemoved = true;
    if (benchmarkFailure !== undefined && typeof benchmarkFailure === 'object') {
      benchmarkFailure.benchmarkCleanup = {
        benchmarkTemporaryRootRemoved,
        formalArtifactCreated: false,
      };
    }
  }

  const completedAt = new Date().toISOString();
  const results = {
    approvalStatus: profile.approval.status,
    benchmarkVersion: TXT_RESOURCE_BENCHMARK_VERSION,
    boundaryChecks,
    cases,
    cleanup: { benchmarkTemporaryRootRemoved },
    command: mode === 'formal'
      ? 'fnm exec --using=24.18.1 pnpm --filter @voxweaver/novel-import run benchmark:txt -- --profile docs/validation/m1-resource-budget.profile.json --out docs/validation/m1-resource-budget.results.json'
      : 'node benchmark/runTxtResourceBenchmark.mjs --explore --out <system-temp-result>',
    completedAt,
    eligibleForGateClosure: false,
    environment: environmentEvidence(),
    exitCode: 0,
    formalArtifactCreated: false,
    gateStatus: 'open-awaiting-independent-approval-and-real-sample-evidence',
    gitRevision: await readGitRevision(),
    mode,
    profileId: profile.profileId,
    profileSha256: sha256Json(profile),
    profileVersion: profile.budgetProfileVersion,
    recommendations: calculateTxtResourceRecommendations(cases, profile, boundaryChecks),
    runId: randomUUID(),
    sampleGenerator: {
      seed,
      version: TXT_RESOURCE_SAMPLE_GENERATOR_VERSION,
    },
    schemaVersion: TXT_RESOURCE_RESULTS_SCHEMA_VERSION,
    startedAt,
    status: 'complete',
  };
  results.payloadSha256 = calculateResultsPayloadSha256(results);
  verifyTxtResourceResults(profile, results, {
    requireApproved: mode === 'formal',
    requireFiveRuns: true,
    requireRealSample: mode === 'formal',
  });
  if (outputPath !== undefined)
    await writeJsonAtomically(outputPath, results);
  return results;
}

function parseArguments(arguments_) {
  const options = { caseIds: [] };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--')
      continue;
    if (argument === '--explore')
      options.mode = 'explore';
    else if (argument === '--profile')
      options.profilePath = arguments_[index += 1];
    else if (argument === '--out')
      options.outputPath = arguments_[index += 1];
    else if (argument === '--real-sample')
      options.realSamplePath = arguments_[index += 1];
    else if (argument === '--case')
      options.caseIds.push(arguments_[index += 1]);
    else if (argument === '--runs')
      options.runsPerCase = Number(arguments_[index += 1]);
    else if (argument === '--seed')
      options.seed = Number(arguments_[index += 1]);
    else
      throw new Error(`Unknown argument: ${argument}`);
  }
  options.mode ??= 'formal';
  if (options.outputPath === undefined)
    throw new Error('--out is required.');
  if (options.caseIds.length === 0)
    delete options.caseIds;
  if (options.mode === 'formal' && options.profilePath === undefined)
    throw new Error('--profile is required outside --explore mode.');
  return options;
}

async function workerMain(payload) {
  try {
    const result = await executeWorker(decodeWorkerConfig(payload));
    process.stdout.write(`${JSON.stringify({ ok: true, result })}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      message: error instanceof Error ? error.message : String(error),
      ok: false,
    })}\n`);
  }
}

async function main() {
  if (process.argv[2] === WORKER_ARGUMENT) {
    if (process.argv[3] === undefined)
      throw new Error('Worker payload is required.');
    await workerMain(process.argv[3]);
    return;
  }
  const options = parseArguments(process.argv.slice(2));
  options.outputPath = isAbsolute(options.outputPath)
    ? options.outputPath
    : resolve(REPOSITORY_ROOT, options.outputPath);
  if (options.profilePath !== undefined) {
    options.profilePath = isAbsolute(options.profilePath)
      ? options.profilePath
      : resolve(REPOSITORY_ROOT, options.profilePath);
  }
  if (options.profilePath !== undefined)
    options.profile = JSON.parse(await readFile(options.profilePath, 'utf8'));
  options.realSamplePath ??= process.env.VOXWEAVER_M1_REAL_SAMPLE_PATH;
  const results = await runTxtResourceBenchmark(options);
  process.stdout.write(`${JSON.stringify({
    approvalStatus: results.approvalStatus,
    gateStatus: results.gateStatus,
    outputPath: options.outputPath,
    payloadSha256: results.payloadSha256,
    status: results.status,
  }, undefined, 2)}\n`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
