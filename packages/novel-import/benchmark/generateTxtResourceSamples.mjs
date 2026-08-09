import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdir, open, realpath, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TXT_RESOURCE_SAMPLE_GENERATOR_VERSION = 'm1-b05-samples-v1';
export const TXT_RESOURCE_SAMPLE_SEED = 0x5EED_B055;
export const MEBIBYTE = 1_048_576;
export const GB18030_CROSS_CHUNK_BOUNDARY_BYTE = 256 * 1024;
export const GB18030_FOUR_BYTE_SEQUENCE = Object.freeze([0x81, 0x30, 0x81, 0x30]);
export const TXT_RESOURCE_SAMPLE_BYTE_LENGTHS = Object.freeze([
  MEBIBYTE,
  10 * MEBIBYTE,
  50 * MEBIBYTE,
]);

const ENCODING_ATOMS = Object.freeze({
  'utf-8': Object.freeze([
    Buffer.from('第一章 起点'),
    Buffer.from('正文段落'),
    Buffer.from('人物与场景'),
  ]),
  'gbk': Object.freeze([
    Buffer.from([0xB5, 0xDA, 0xD2, 0xBB, 0xD5, 0xC2]),
    Buffer.from([0xD5, 0xFD, 0xCE, 0xC4, 0xB6, 0xCE, 0xC2, 0xE4]),
    Buffer.from([0xD6, 0xD0, 0xCE, 0xC4]),
  ]),
  'gb18030': Object.freeze([
    Buffer.from([0xB5, 0xDA, 0xD2, 0xBB, 0xD5, 0xC2]),
    Buffer.from([0xD5, 0xFD, 0xCE, 0xC4, 0xB6, 0xCE, 0xC2, 0xE4]),
    Buffer.from([0xD6, 0xD0, 0xCE, 0xC4]),
  ]),
  'big5': Object.freeze([
    Buffer.from([0xA4, 0x40, 0xA4, 0x41, 0xA4, 0x42]),
    Buffer.from([0xA4, 0xA4, 0xA4, 0xE5]),
    Buffer.from([0xA4, 0x43, 0xA4, 0x44]),
  ]),
});

const LAYOUT_SEPARATORS = Object.freeze({
  regularChapters: Object.freeze([
    Buffer.from('\n\n'),
    Buffer.from('\n'),
    Buffer.from(' 1\n'),
  ]),
  denseShortBlocks: Object.freeze([
    Buffer.from('\n'),
    Buffer.from('\n\n'),
    Buffer.from(' x\n'),
  ]),
  longestSingleLine: Object.freeze([
    Buffer.from(' '),
    Buffer.from('-'),
    Buffer.from('0'),
  ]),
});

export const TXT_RESOURCE_SAMPLE_DEFINITIONS = Object.freeze([
  sampleDefinition('utf8-dense-1mib', MEBIBYTE, 'utf-8', 'denseShortBlocks', '4aae024a4f77d4d8c5e5c28fef045cd103ac4f10516cf41a70b50ea0eb1354a1'),
  sampleDefinition('gbk-regular-1mib', MEBIBYTE, 'gbk', 'regularChapters', '8dcac13f89956b01f17120f6ec03e1428ff6296a79cba3ce9bfc7b8dea24abe9'),
  sampleDefinition('big5-long-line-1mib', MEBIBYTE, 'big5', 'longestSingleLine', 'd6867bc4c89e7003e354aa48144671b9b013dfe8cbe2122255b6fc87a27192cd'),
  sampleDefinition('utf8-regular-10mib', 10 * MEBIBYTE, 'utf-8', 'regularChapters', '65b1323c9205424be267392de26b9b4a1058714f6ff794d5c4c6d735c61f80ea'),
  sampleDefinition('gb18030-long-line-10mib', 10 * MEBIBYTE, 'gb18030', 'longestSingleLine', '860acc6717db146f09a0611ca94ee75965852d6ce89fc096b687d43d37bd6fcf'),
  sampleDefinition('big5-dense-10mib', 10 * MEBIBYTE, 'big5', 'denseShortBlocks', '1d2a4ee3fe59ba6ea200e0097c00df70c1a77e0b2e0f6c2271908478dc96f045'),
  sampleDefinition('utf8-long-line-50mib', 50 * MEBIBYTE, 'utf-8', 'longestSingleLine', '40dcc789d0fb4e6765b33986c1e005b962bd18b4910b76d6944349349a63378d'),
  sampleDefinition('gbk-dense-50mib', 50 * MEBIBYTE, 'gbk', 'denseShortBlocks', '58035db5133aeb6705a619720dbc1adde13e098e9caf4eeb205cb2c9d6130c92'),
  sampleDefinition('big5-regular-50mib', 50 * MEBIBYTE, 'big5', 'regularChapters', '9cdd40c0aa29aae763f9ab1a4bf8b432363bebc9bb31f1c5d4677213ef173c35'),
]);

function sampleDefinition(id, byteLength, encoding, layout, expectedSha256) {
  return Object.freeze({ byteLength, encoding, expectedSha256, id, layout });
}

function createPrng(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
}

function deriveCaseSeed(seed, caseId) {
  let value = seed >>> 0;
  for (const character of caseId)
    value = Math.imul(value ^ character.codePointAt(0), 16_777_619) >>> 0;
  return value || 1;
}

function fillDeterministicChunk(target, definition, nextRandom) {
  const atoms = ENCODING_ATOMS[definition.encoding];
  const separators = LAYOUT_SEPARATORS[definition.layout];
  let offset = 0;

  while (offset < target.length) {
    const parts = [
      atoms[nextRandom() % atoms.length],
      separators[nextRandom() % separators.length],
    ];
    for (const part of parts) {
      if (part.length > target.length - offset) {
        target.fill(0x78, offset);
        return;
      }
      part.copy(target, offset);
      offset += part.length;
    }
  }
}

function overlayGb18030BoundarySequence(target, definition, absoluteOffset) {
  if (definition.encoding !== 'gb18030')
    return;
  const sequenceStart = GB18030_CROSS_CHUNK_BOUNDARY_BYTE - 2;
  const sequenceEnd = sequenceStart + GB18030_FOUR_BYTE_SEQUENCE.length;
  const chunkEnd = absoluteOffset + target.length;
  const overlapStart = Math.max(absoluteOffset, sequenceStart);
  const overlapEnd = Math.min(chunkEnd, sequenceEnd);
  for (let offset = overlapStart; offset < overlapEnd; offset += 1) {
    target[offset - absoluteOffset] = GB18030_FOUR_BYTE_SEQUENCE[offset - sequenceStart];
  }
}

async function writeComplete(file, buffer, position) {
  let bufferOffset = 0;
  while (bufferOffset < buffer.length) {
    const result = await file.write(
      buffer,
      bufferOffset,
      buffer.length - bufferOffset,
      position + bufferOffset,
    );
    if (result.bytesWritten === 0)
      throw new Error('Unable to make progress while writing the TXT resource sample.');
    bufferOffset += result.bytesWritten;
  }
}

export async function assertSystemTemporaryChild(directory) {
  const [resolvedDirectory, resolvedTemporaryRoot] = await Promise.all([
    realpath(directory),
    realpath(tmpdir()),
  ]);
  const pathFromTemporaryRoot = relative(resolvedTemporaryRoot, resolvedDirectory);
  if (
    pathFromTemporaryRoot === ''
    || pathFromTemporaryRoot === '..'
    || pathFromTemporaryRoot.startsWith(`..${sep}`)
  ) {
    throw new Error('TXT resource samples must stay below the system temporary directory.');
  }
  return resolvedDirectory;
}

function assertSystemTemporaryCandidate(directory) {
  const resolvedDirectory = resolve(directory);
  const resolvedTemporaryRoot = resolve(tmpdir());
  const pathFromTemporaryRoot = relative(resolvedTemporaryRoot, resolvedDirectory);
  if (
    pathFromTemporaryRoot === ''
    || pathFromTemporaryRoot === '..'
    || pathFromTemporaryRoot.startsWith(`..${sep}`)
  ) {
    throw new Error('TXT resource samples must stay below the system temporary directory.');
  }
}

export async function generateTxtResourceSample({
  definition,
  directory,
  seed = TXT_RESOURCE_SAMPLE_SEED,
}) {
  if (!TXT_RESOURCE_SAMPLE_DEFINITIONS.includes(definition))
    throw new TypeError('definition must be one of TXT_RESOURCE_SAMPLE_DEFINITIONS.');
  if (!Number.isSafeInteger(seed) || seed < 0)
    throw new TypeError('seed must be a non-negative safe integer.');

  assertSystemTemporaryCandidate(directory);
  await mkdir(directory, { recursive: true });
  const safeDirectory = await assertSystemTemporaryChild(directory);
  const outputPath = join(safeDirectory, `${definition.id}.txt`);
  const file = await open(outputPath, 'wx');
  const digest = createHash('sha256');
  const nextRandom = createPrng(deriveCaseSeed(seed, definition.id));
  let bytesWritten = 0;

  try {
    while (bytesWritten < definition.byteLength) {
      const chunk = Buffer.allocUnsafe(Math.min(
        64 * 1024,
        definition.byteLength - bytesWritten,
      ));
      fillDeterministicChunk(chunk, definition, nextRandom);
      overlayGb18030BoundarySequence(chunk, definition, bytesWritten);
      await writeComplete(file, chunk, bytesWritten);
      digest.update(chunk);
      bytesWritten += chunk.length;
    }
  } catch (error) {
    await file.close().catch(() => {});
    await unlink(outputPath).catch(() => {});
    throw error;
  }

  await file.close();
  const sha256 = digest.digest('hex');
  if (seed === TXT_RESOURCE_SAMPLE_SEED && sha256 !== definition.expectedSha256) {
    await unlink(outputPath).catch(() => {});
    throw new Error(
      `Deterministic hash mismatch for TXT resource sample ${definition.id}: expected ${definition.expectedSha256}, received ${sha256}.`,
    );
  }
  return Object.freeze({
    byteLength: bytesWritten,
    encoding: definition.encoding,
    generatorVersion: TXT_RESOURCE_SAMPLE_GENERATOR_VERSION,
    id: definition.id,
    layout: definition.layout,
    path: outputPath,
    seed,
    sha256,
  });
}

export async function generateTxtResourceSamples({
  caseIds,
  directory,
  seed = TXT_RESOURCE_SAMPLE_SEED,
}) {
  const definitions = caseIds === undefined
    ? TXT_RESOURCE_SAMPLE_DEFINITIONS
    : caseIds.map((caseId) => {
        const definition = TXT_RESOURCE_SAMPLE_DEFINITIONS.find(
          candidate => candidate.id === caseId,
        );
        if (definition === undefined)
          throw new Error(`Unknown TXT resource sample case: ${caseId}`);
        return definition;
      });
  const samples = [];
  for (const definition of definitions) {
    samples.push(await generateTxtResourceSample({ definition, directory, seed }));
  }
  return samples;
}

function parseArguments(arguments_) {
  const options = { caseIds: [] };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === '--out-dir')
      options.directory = arguments_[index += 1];
    else if (argument === '--case')
      options.caseIds.push(arguments_[index += 1]);
    else if (argument === '--seed')
      options.seed = Number(arguments_[index += 1]);
    else
      throw new Error(`Unknown argument: ${argument}`);
  }
  if (options.directory === undefined)
    throw new Error('--out-dir is required.');
  if (options.caseIds.length === 0)
    delete options.caseIds;
  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const samples = await generateTxtResourceSamples(options);
  process.stdout.write(`${JSON.stringify({
    generatorVersion: TXT_RESOURCE_SAMPLE_GENERATOR_VERSION,
    samples: samples.map(({ path, ...sample }) => ({
      ...sample,
      temporaryFileName: basename(path),
    })),
  }, undefined, 2)}\n`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
