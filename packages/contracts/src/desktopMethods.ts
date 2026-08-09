import type { ValidateFunction } from 'ajv';

import type { ProjectAccessMode } from './project.js';

import addFormatsModule from 'ajv-formats';
import Ajv2020Module from 'ajv/dist/2020.js';

const Ajv2020 = Ajv2020Module.default;
const addFormats = addFormatsModule.default;

const NON_EMPTY_STRING = { type: 'string', minLength: 1 } as const;
const EMPTY_OBJECT_SCHEMA = {
  type: 'object',
  additionalProperties: true,
} as const;

const PROJECT_SUMMARY_DTO_SCHEMA = {
  type: 'object',
  required: [
    'projectId',
    'projectSessionId',
    'displayName',
    'accessMode',
    'layoutVersion',
  ],
  properties: {
    projectId: NON_EMPTY_STRING,
    projectSessionId: NON_EMPTY_STRING,
    displayName: NON_EMPTY_STRING,
    accessMode: {
      enum: ['read-write', 'read-only'],
    },
    layoutVersion: {
      type: 'integer',
      minimum: 1,
    },
    projectDirectory: false,
    parentDirectory: false,
    absolutePath: false,
  },
  additionalProperties: false,
} as const;

const RECENT_PROJECT_DTO_SCHEMA = {
  type: 'object',
  required: [
    'projectId',
    'displayName',
    'lastOpenedAt',
    'availability',
  ],
  properties: {
    projectId: NON_EMPTY_STRING,
    displayName: NON_EMPTY_STRING,
    lastOpenedAt: {
      type: 'string',
      format: 'date-time',
    },
    availability: {
      enum: ['available', 'unavailable'],
    },
    projectDirectory: false,
    parentDirectory: false,
    absolutePath: false,
  },
  additionalProperties: false,
} as const;

const SELECT_DIRECTORY_PAYLOAD_SCHEMA = {
  type: 'object',
  required: ['purpose'],
  properties: {
    purpose: {
      enum: ['create-project-parent', 'open-project', 'switch-project'],
    },
  },
  additionalProperties: true,
} as const;

const SELECT_DIRECTORY_RESULT_SCHEMA = {
  oneOf: [
    {
      type: 'object',
      required: ['canceled'],
      properties: {
        canceled: { const: true },
        projectDirectory: false,
        parentDirectory: false,
        absolutePath: false,
      },
      not: {
        required: ['selectionToken'],
      },
      additionalProperties: false,
    },
    {
      type: 'object',
      required: ['canceled', 'selectionToken', 'displayName', 'expiresAt'],
      properties: {
        canceled: { const: false },
        selectionToken: NON_EMPTY_STRING,
        displayName: NON_EMPTY_STRING,
        expiresAt: {
          type: 'string',
          format: 'date-time',
        },
        projectDirectory: false,
        parentDirectory: false,
        absolutePath: false,
      },
      additionalProperties: false,
    },
  ],
} as const;

const CREATE_PROJECT_PAYLOAD_SCHEMA = {
  type: 'object',
  required: ['selectionToken', 'displayName'],
  properties: {
    selectionToken: NON_EMPTY_STRING,
    displayName: NON_EMPTY_STRING,
  },
  additionalProperties: true,
} as const;

const OPEN_PROJECT_PAYLOAD_SCHEMA = {
  type: 'object',
  properties: {
    selectionToken: NON_EMPTY_STRING,
    recentProjectId: NON_EMPTY_STRING,
    accessMode: {
      enum: ['read-write', 'read-only'],
    },
    confirmMigration: {
      type: 'boolean',
    },
    recoverStaleWriteLock: {
      type: 'boolean',
    },
  },
  oneOf: [
    {
      required: ['selectionToken'],
      not: {
        required: ['recentProjectId'],
      },
    },
    {
      required: ['recentProjectId'],
      not: {
        required: ['selectionToken'],
      },
    },
  ],
  additionalProperties: true,
} as const;

const REMOVE_RECENT_PROJECT_PAYLOAD_SCHEMA = {
  type: 'object',
  required: ['projectId'],
  properties: {
    projectId: NON_EMPTY_STRING,
  },
  additionalProperties: true,
} as const;

const APP_HEALTH_RESULT_SCHEMA = {
  type: 'object',
  required: ['healthy'],
  properties: {
    healthy: {
      const: true,
    },
  },
  additionalProperties: false,
} as const;

const RECENT_PROJECT_LIST_RESULT_SCHEMA = {
  type: 'object',
  required: ['projects'],
  properties: {
    projects: {
      type: 'array',
      items: { $ref: '#/$defs/recentProjectDto' },
    },
  },
  additionalProperties: false,
} as const;

const REMOVE_RECENT_PROJECT_RESULT_SCHEMA = {
  type: 'object',
  required: ['removed'],
  properties: {
    removed: {
      type: 'boolean',
    },
  },
  additionalProperties: false,
} as const;

export const DESKTOP_METHOD_NAMES = {
  APP_GET_HEALTH: 'app.getHealth',
  DIALOG_SELECT_DIRECTORY: 'dialog.selectDirectory',
  PROJECT_CLOSE: 'project.close',
  PROJECT_CREATE: 'project.create',
  PROJECT_GET_SUMMARY: 'project.getSummary',
  PROJECT_LIST_RECENT: 'project.listRecent',
  PROJECT_OPEN: 'project.open',
  PROJECT_REMOVE_RECENT: 'project.removeRecent',
  PROJECT_SWITCH: 'project.switch',
} as const;

export type DesktopMethodName
  = typeof DESKTOP_METHOD_NAMES[keyof typeof DESKTOP_METHOD_NAMES];

export type DirectorySelectionPurpose
  = | 'create-project-parent'
    | 'open-project'
    | 'switch-project';

export type RecentProjectAvailability = 'available' | 'unavailable';

export interface EmptyDesktopMethodPayload extends Record<string, unknown> {}

export interface AppHealthResultFields {
  readonly healthy: true;
}

export type AppHealthResult = AppHealthResultFields;

export interface ProjectSummaryDtoFields {
  readonly projectId: string;
  readonly projectSessionId: string;
  readonly displayName: string;
  readonly accessMode: ProjectAccessMode;
  readonly layoutVersion: number;
}

export type ProjectSummaryDto = ProjectSummaryDtoFields;

export interface RecentProjectDtoFields {
  readonly projectId: string;
  readonly displayName: string;
  readonly lastOpenedAt: string;
  readonly availability: RecentProjectAvailability;
}

export type RecentProjectDto = RecentProjectDtoFields;

export interface SelectDirectoryPayloadFields {
  readonly purpose: DirectorySelectionPurpose;
}

export type SelectDirectoryPayload
  = SelectDirectoryPayloadFields & Record<string, unknown>;

export interface CanceledDirectorySelectionFields {
  readonly canceled: true;
}

export type CanceledDirectorySelection = CanceledDirectorySelectionFields;

export interface SelectedDirectoryFields {
  readonly canceled: false;
  readonly selectionToken: string;
  readonly displayName: string;
  readonly expiresAt: string;
}

export type SelectedDirectory = SelectedDirectoryFields;

export type SelectDirectoryResult
  = | CanceledDirectorySelection
    | SelectedDirectory;

export interface CreateProjectPayloadFields {
  readonly selectionToken: string;
  readonly displayName: string;
}

export type CreateProjectPayload
  = CreateProjectPayloadFields & Record<string, unknown>;

export interface OpenProjectPayloadFields {
  readonly accessMode?: ProjectAccessMode;
  readonly confirmMigration?: boolean;
  readonly recoverStaleWriteLock?: boolean;
}

export type OpenProjectPayload
  = OpenProjectPayloadFields & (
    | {
      readonly selectionToken: string;
      readonly recentProjectId?: never;
    }
    | {
      readonly selectionToken?: never;
      readonly recentProjectId: string;
    }
  ) & Record<string, unknown>;

export interface RemoveRecentProjectPayloadFields {
  readonly projectId: string;
}

export type RemoveRecentProjectPayload
  = RemoveRecentProjectPayloadFields & Record<string, unknown>;

export interface RecentProjectListResultFields {
  readonly projects: readonly RecentProjectDto[];
}

export type RecentProjectListResult = RecentProjectListResultFields;

export interface RemoveRecentProjectResultFields {
  readonly removed: boolean;
}

export type RemoveRecentProjectResult = RemoveRecentProjectResultFields;

export interface DesktopMethodPayloadMap {
  'app.getHealth': EmptyDesktopMethodPayload;
  'dialog.selectDirectory': SelectDirectoryPayload;
  'project.close': EmptyDesktopMethodPayload;
  'project.create': CreateProjectPayload;
  'project.getSummary': EmptyDesktopMethodPayload;
  'project.listRecent': EmptyDesktopMethodPayload;
  'project.open': OpenProjectPayload;
  'project.removeRecent': RemoveRecentProjectPayload;
  'project.switch': OpenProjectPayload;
}

export interface DesktopMethodResultMap {
  'app.getHealth': AppHealthResult;
  'dialog.selectDirectory': SelectDirectoryResult;
  'project.close': null;
  'project.create': ProjectSummaryDto;
  'project.getSummary': ProjectSummaryDto | null;
  'project.listRecent': RecentProjectListResult;
  'project.open': ProjectSummaryDto;
  'project.removeRecent': RemoveRecentProjectResult;
  'project.switch': ProjectSummaryDto;
}

export type DesktopMethodPayload<TMethod extends DesktopMethodName = DesktopMethodName>
  = DesktopMethodPayloadMap[TMethod];

export type DesktopMethodResult<TMethod extends DesktopMethodName = DesktopMethodName>
  = DesktopMethodResultMap[TMethod];

export const DESKTOP_METHOD_PAYLOAD_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://voxweaver.local/schemas/desktop-method-payload.schema.json',
  title: 'VoxWeaver desktop method payload',
  type: 'object',
  oneOf: [
    createMethodBranch(DESKTOP_METHOD_NAMES.APP_GET_HEALTH, 'emptyPayload', 'payload'),
    createMethodBranch(
      DESKTOP_METHOD_NAMES.DIALOG_SELECT_DIRECTORY,
      'selectDirectoryPayload',
      'payload',
    ),
    createMethodBranch(DESKTOP_METHOD_NAMES.PROJECT_CREATE, 'createProjectPayload', 'payload'),
    createMethodBranch(DESKTOP_METHOD_NAMES.PROJECT_OPEN, 'openProjectPayload', 'payload'),
    createMethodBranch(DESKTOP_METHOD_NAMES.PROJECT_SWITCH, 'openProjectPayload', 'payload'),
    createMethodBranch(DESKTOP_METHOD_NAMES.PROJECT_CLOSE, 'emptyPayload', 'payload'),
    createMethodBranch(DESKTOP_METHOD_NAMES.PROJECT_GET_SUMMARY, 'emptyPayload', 'payload'),
    createMethodBranch(DESKTOP_METHOD_NAMES.PROJECT_LIST_RECENT, 'emptyPayload', 'payload'),
    createMethodBranch(
      DESKTOP_METHOD_NAMES.PROJECT_REMOVE_RECENT,
      'removeRecentProjectPayload',
      'payload',
    ),
  ],
  $defs: {
    emptyPayload: EMPTY_OBJECT_SCHEMA,
    selectDirectoryPayload: SELECT_DIRECTORY_PAYLOAD_SCHEMA,
    createProjectPayload: CREATE_PROJECT_PAYLOAD_SCHEMA,
    openProjectPayload: OPEN_PROJECT_PAYLOAD_SCHEMA,
    removeRecentProjectPayload: REMOVE_RECENT_PROJECT_PAYLOAD_SCHEMA,
  },
} as const;

export const DESKTOP_METHOD_RESULT_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://voxweaver.local/schemas/desktop-method-result.schema.json',
  title: 'VoxWeaver desktop method result',
  type: 'object',
  oneOf: [
    createMethodBranch(DESKTOP_METHOD_NAMES.APP_GET_HEALTH, 'appHealthResult', 'result'),
    createMethodBranch(
      DESKTOP_METHOD_NAMES.DIALOG_SELECT_DIRECTORY,
      'selectDirectoryResult',
      'result',
    ),
    createMethodBranch(DESKTOP_METHOD_NAMES.PROJECT_CREATE, 'projectSummaryDto', 'result'),
    createMethodBranch(DESKTOP_METHOD_NAMES.PROJECT_OPEN, 'projectSummaryDto', 'result'),
    createMethodBranch(DESKTOP_METHOD_NAMES.PROJECT_SWITCH, 'projectSummaryDto', 'result'),
    {
      type: 'object',
      required: ['method', 'result'],
      properties: {
        method: { const: DESKTOP_METHOD_NAMES.PROJECT_CLOSE },
        result: { type: 'null' },
      },
      additionalProperties: true,
    },
    {
      type: 'object',
      required: ['method', 'result'],
      properties: {
        method: { const: DESKTOP_METHOD_NAMES.PROJECT_GET_SUMMARY },
        result: {
          anyOf: [
            { $ref: '#/$defs/projectSummaryDto' },
            { type: 'null' },
          ],
        },
      },
      additionalProperties: true,
    },
    createMethodBranch(
      DESKTOP_METHOD_NAMES.PROJECT_LIST_RECENT,
      'recentProjectListResult',
      'result',
    ),
    createMethodBranch(
      DESKTOP_METHOD_NAMES.PROJECT_REMOVE_RECENT,
      'removeRecentProjectResult',
      'result',
    ),
  ],
  $defs: {
    appHealthResult: APP_HEALTH_RESULT_SCHEMA,
    selectDirectoryResult: SELECT_DIRECTORY_RESULT_SCHEMA,
    projectSummaryDto: PROJECT_SUMMARY_DTO_SCHEMA,
    recentProjectDto: RECENT_PROJECT_DTO_SCHEMA,
    recentProjectListResult: RECENT_PROJECT_LIST_RESULT_SCHEMA,
    removeRecentProjectResult: REMOVE_RECENT_PROJECT_RESULT_SCHEMA,
  },
} as const;

const validators = createDesktopMethodValidators();
const desktopMethodNames = new Set<string>(Object.values(DESKTOP_METHOD_NAMES));

export type DesktopMethodValidationErrorCode
  = | 'DESKTOP_METHOD_NOT_FOUND'
    | 'DESKTOP_METHOD_PAYLOAD_INVALID'
    | 'DESKTOP_METHOD_RESULT_INVALID';

export class DesktopMethodValidationError extends Error {
  constructor(
    readonly code: DesktopMethodValidationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DesktopMethodValidationError';
  }
}

export function isDesktopMethodName(method: string): method is DesktopMethodName {
  return desktopMethodNames.has(method);
}

export function parseDesktopMethodPayload<TMethod extends DesktopMethodName>(
  method: TMethod,
  value: unknown,
): DesktopMethodPayload<TMethod>;
export function parseDesktopMethodPayload(
  method: string,
  value: unknown,
): DesktopMethodPayload;
export function parseDesktopMethodPayload(
  method: string,
  value: unknown,
): DesktopMethodPayload {
  assertKnownDesktopMethod(method);
  assertJsonValue(value, 'Desktop method payload', 'DESKTOP_METHOD_PAYLOAD_INVALID');
  validateDesktopMethodValue(
    { method, payload: value },
    validators.payload,
    'Desktop method payload',
    'DESKTOP_METHOD_PAYLOAD_INVALID',
  );
  return value as DesktopMethodPayload;
}

export function parseDesktopMethodResult<TMethod extends DesktopMethodName>(
  method: TMethod,
  value: unknown,
): DesktopMethodResult<TMethod>;
export function parseDesktopMethodResult(
  method: string,
  value: unknown,
): DesktopMethodResult;
export function parseDesktopMethodResult(
  method: string,
  value: unknown,
): DesktopMethodResult {
  assertKnownDesktopMethod(method);
  assertJsonValue(value, 'Desktop method result', 'DESKTOP_METHOD_RESULT_INVALID');
  validateDesktopMethodValue(
    { method, result: value },
    validators.result,
    'Desktop method result',
    'DESKTOP_METHOD_RESULT_INVALID',
  );
  return value as DesktopMethodResult;
}

function createMethodBranch(
  method: DesktopMethodName,
  definition: string,
  valueProperty: 'payload' | 'result',
) {
  return {
    type: 'object',
    required: ['method', valueProperty],
    properties: {
      method: { const: method },
      [valueProperty]: { $ref: `#/$defs/${definition}` },
    },
    additionalProperties: true,
  } as const;
}

function assertKnownDesktopMethod(method: string): asserts method is DesktopMethodName {
  if (isDesktopMethodName(method))
    return;

  throw new DesktopMethodValidationError(
    'DESKTOP_METHOD_NOT_FOUND',
    `Unknown desktop method: ${method}`,
  );
}

function validateDesktopMethodValue(
  value: unknown,
  validate: ValidateFunction,
  dataName: string,
  code: DesktopMethodValidationErrorCode,
): void {
  if (validate(value))
    return;

  throw new DesktopMethodValidationError(
    code,
    validators.ajv.errorsText(validate.errors, { dataVar: dataName }),
  );
}

function assertJsonValue(
  value: unknown,
  dataName: string,
  code: DesktopMethodValidationErrorCode,
): void {
  if (isJsonValue(value))
    return;

  throw new DesktopMethodValidationError(code, `${dataName} must be a JSON value`);
}

function isJsonValue(value: unknown, ancestors = new WeakSet<object>()): boolean {
  if (value === null)
    return true;

  switch (typeof value) {
    case 'boolean':
    case 'string':
      return true;
    case 'number':
      return Number.isFinite(value);
    case 'object': {
      if (ancestors.has(value))
        return false;

      if (Array.isArray(value)) {
        ancestors.add(value);
        const valid = value.every(item => isJsonValue(item, ancestors));
        ancestors.delete(value);
        return valid;
      }

      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null)
        return false;

      ancestors.add(value);
      const valid = Object.values(value).every(item => isJsonValue(item, ancestors));
      ancestors.delete(value);
      return valid;
    }
    default:
      return false;
  }
}

function createDesktopMethodValidators() {
  const ajv = new Ajv2020({ allErrors: true });
  addFormats(ajv);

  return {
    ajv,
    payload: ajv.compile(DESKTOP_METHOD_PAYLOAD_SCHEMA),
    result: ajv.compile(DESKTOP_METHOD_RESULT_SCHEMA),
  };
}
