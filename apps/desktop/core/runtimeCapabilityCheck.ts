import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';

const REQUIRED_ELECTRON_NODE = /^24\.18\./;

/**
 * Runs inside the utility process before it accepts any project request. This
 * prevents a packaged Electron runtime with an incompatible node:sqlite build
 * from appearing healthy merely because the development Node binary passed.
 */
export async function verifyCoreRuntimeCapabilities(
  userDataDirectory: string,
): Promise<void> {
  if (!REQUIRED_ELECTRON_NODE.test(process.versions.node)) {
    throw new Error('The Electron Core Node runtime is not an approved 24.18.x build.');
  }

  await mkdir(userDataDirectory, { mode: 0o700, recursive: true });
  const capabilityDirectory = join(
    userDataDirectory,
    `.core-capability-${randomUUID()}`,
  );
  const sourcePath = join(capabilityDirectory, 'source.sqlite');
  const backupPath = join(capabilityDirectory, 'backup.sqlite');

  try {
    await mkdir(capabilityDirectory, { mode: 0o700, recursive: true });
    const source = openCapabilityDatabase(sourcePath);
    try {
      source.exec([
        'PRAGMA foreign_keys = ON;',
        'PRAGMA trusted_schema = OFF;',
        'CREATE TABLE capability_probe (value INTEGER NOT NULL);',
        'INSERT INTO capability_probe (value) VALUES (1);',
      ].join('\n'));
      await backup(source, backupPath);
    } finally {
      source.close();
    }

    const restored = openCapabilityDatabase(backupPath);
    try {
      const row = restored.prepare(
        'SELECT value FROM capability_probe LIMIT 1',
      ).get() as { readonly value?: unknown } | undefined;
      if (row?.value !== 1)
        throw new Error('The SQLite backup capability probe returned an unexpected value.');
    } finally {
      restored.close();
    }
  } finally {
    await rm(capabilityDirectory, { force: true, recursive: true });
  }
}

function openCapabilityDatabase(path: string): DatabaseSync {
  return new DatabaseSync(path, {
    allowExtension: false,
    defensive: true,
    enableDoubleQuotedStringLiterals: false,
  });
}
