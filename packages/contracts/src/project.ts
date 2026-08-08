import type { JSONSchemaType } from 'ajv/dist/2020.js';

import addFormatsModule from 'ajv-formats';
import Ajv2020Module from 'ajv/dist/2020.js';

const Ajv2020 = Ajv2020Module.default;
const addFormats = addFormatsModule.default;

export const PROJECT_MANIFEST_SCHEMA_VERSION = 1 as const;
export const PROJECT_LAYOUT_VERSION = 2 as const;
export const PROJECT_MIN_LAYOUT_VERSION = 1 as const;

export interface ProjectManifestFields {
  readonly schemaVersion: typeof PROJECT_MANIFEST_SCHEMA_VERSION;
  readonly layoutVersion:
    | typeof PROJECT_LAYOUT_VERSION
    | typeof PROJECT_MIN_LAYOUT_VERSION;
  readonly projectId: string;
  readonly displayName: string;
  readonly directoryName: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type ProjectManifest = ProjectManifestFields & Record<string, unknown>;

export type ProjectAccessMode = 'read-write' | 'read-only';

export interface ProjectContext {
  readonly projectDirectory: string;
  readonly projectSessionId: string;
  readonly accessMode: ProjectAccessMode;
  readonly manifest: ProjectManifest;
}

export const PROJECT_MANIFEST_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://voxweaver.local/schemas/project-manifest.schema.json',
  title: 'VoxWeaver project manifest',
  type: 'object',
  required: [
    'schemaVersion',
    'layoutVersion',
    'projectId',
    'displayName',
    'directoryName',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    schemaVersion: {
      type: 'integer',
      const: PROJECT_MANIFEST_SCHEMA_VERSION,
    },
    layoutVersion: {
      type: 'integer',
      enum: [PROJECT_MIN_LAYOUT_VERSION, PROJECT_LAYOUT_VERSION],
    },
    projectId: {
      type: 'string',
      pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
    },
    displayName: {
      type: 'string',
      minLength: 1,
      maxLength: 120,
      pattern: '^(?!\\s)(?![\\s\\S]*\\u0000)[\\s\\S]*\\S$',
    },
    directoryName: {
      type: 'string',
      minLength: 1,
      maxLength: 160,
      pattern: '^(?!\\s)(?![\\s\\S]*[\\\\/\\u0000])[\\s\\S]+--[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
    },
    createdAt: {
      type: 'string',
      format: 'date-time',
    },
    updatedAt: {
      type: 'string',
      format: 'date-time',
    },
  },
  additionalProperties: true,
} as const satisfies JSONSchemaType<ProjectManifestFields>;

const manifestValidator = createManifestValidator();

export class ProjectManifestValidationError extends Error {
  readonly code = 'PROJECT_MANIFEST_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'ProjectManifestValidationError';
  }
}

/**
 * Validates the serialized manifest shape. Cross-field and filesystem
 * invariants are enforced by the project workspace.
 */
export function parseProjectManifest(value: unknown): ProjectManifest {
  if (!manifestValidator.validate(value)) {
    throw new ProjectManifestValidationError(
      manifestValidator.ajv.errorsText(manifestValidator.validate.errors, {
        dataVar: 'Project manifest',
      }),
    );
  }

  return value as ProjectManifest;
}

function createManifestValidator() {
  const ajv = new Ajv2020({ allErrors: true });
  addFormats(ajv);

  return {
    ajv,
    validate: ajv.compile<ProjectManifestFields>(PROJECT_MANIFEST_SCHEMA),
  };
}
