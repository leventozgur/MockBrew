export type ErrorCode =
  | 'INVALID'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'STALE'
  | 'FORBIDDEN'
  | 'UNSUPPORTED_VERSION'
  | 'UNAUTHORIZED';

const STATUS: Record<ErrorCode, number> = {
  INVALID: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  STALE: 409,
  UNSUPPORTED_VERSION: 422,
};

export class StudioError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'StudioError';
    this.status = STATUS[code];
  }
}

export const invalid = (message: string, details?: unknown): StudioError => new StudioError('INVALID', message, details);
export const notFound = (what: string, id: string): StudioError => new StudioError('NOT_FOUND', `${what} "${id}" was not found.`);
