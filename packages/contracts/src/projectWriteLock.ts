import type { JSONSchemaType } from 'ajv/dist/2020.js';

import addFormatsModule from 'ajv-formats';
import Ajv2020Module from 'ajv/dist/2020.js';

const Ajv2020 = Ajv2020Module.default;
const addFormats = addFormatsModule.default;

export const PROJECT_WRITE_LOCK_SCHEMA_VERSION = 1 as const;

export interface ProjectWriteLockFields {
  schemaVersion: typeof PROJECT_WRITE_LOCK_SCHEMA_VERSION;
  projectId: string;
  projectSessionId: string;
  processId: number;
  hostname: string;
  acquiredAt: string;
}

export type ProjectWriteLock = ProjectWriteLockFields & Record<string, unknown>;

export const PROJECT_WRITE_LOCK_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://voxweaver.local/schemas/project-write-lock.schema.json',
  title: 'VoxWeaver project write lock',
  type: 'object',
  required: [
    'schemaVersion',
    'projectId',
    'projectSessionId',
    'processId',
    'hostname',
    'acquiredAt',
  ],
  properties: {
    schemaVersion: {
      type: 'integer',
      const: PROJECT_WRITE_LOCK_SCHEMA_VERSION,
    },
    projectId: {
      type: 'string',
      pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
    },
    projectSessionId: {
      type: 'string',
      pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
    },
    processId: {
      type: 'integer',
      minimum: 1,
    },
    hostname: {
      type: 'string',
      minLength: 1,
      maxLength: 255,
    },
    acquiredAt: {
      type: 'string',
      format: 'date-time',
    },
  },
  additionalProperties: true,
} as const satisfies JSONSchemaType<ProjectWriteLockFields>;

const writeLockValidator = createWriteLockValidator();

export class ProjectWriteLockValidationError extends Error {
  readonly code = 'PROJECT_WRITE_LOCK_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'ProjectWriteLockValidationError';
  }
}

export function parseProjectWriteLock(value: unknown): ProjectWriteLock {
  if (!writeLockValidator.validate(value)) {
    throw new ProjectWriteLockValidationError(
      writeLockValidator.ajv.errorsText(writeLockValidator.validate.errors, {
        dataVar: 'Project write lock',
      }),
    );
  }

  return value as ProjectWriteLock;
}

function createWriteLockValidator() {
  const ajv = new Ajv2020({ allErrors: true });
  addFormats(ajv);

  return {
    ajv,
    validate: ajv.compile<ProjectWriteLockFields>(PROJECT_WRITE_LOCK_SCHEMA),
  };
}
