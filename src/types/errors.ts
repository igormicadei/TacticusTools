/**
 * Error payloads returned by the Tacticus API.
 *
 * Every documented non-2xx response shares the same body shape: a single
 * `type` discriminator.
 */

export const API_ERROR_TYPES = ['FORBIDDEN', 'NOT_FOUND', 'UNKNOWN_ERROR'] as const;

/**
 * Documented error discriminators.
 *
 * - `FORBIDDEN`     — 403, the key is missing, invalid, or lacks the scope.
 * - `NOT_FOUND`     — 404, e.g. the player is not a member of a guild.
 * - `UNKNOWN_ERROR` — 500, retryable.
 *
 * The `(string & {})` arm keeps unknown future discriminators assignable while
 * preserving autocompletion for the known ones.
 */
export type ApiErrorType = (typeof API_ERROR_TYPES)[number] | (string & {});

export interface ApiErrorBody {
  type: ApiErrorType;
}

/**
 * Runtime guard for {@link ApiErrorBody}.
 */
export function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}

/**
 * Thrown by the client for any non-2xx response.
 */
export class TacticusApiError extends Error {
  /** HTTP status code. */
  readonly status: number;
  /** The API's `type` discriminator, when the body carried one. */
  readonly type: ApiErrorType | undefined;
  /** Raw parsed body, for diagnostics. */
  readonly body: unknown;
  /** Request path that produced the error, without the API key. */
  readonly path: string;

  constructor(args: {
    status: number;
    type?: ApiErrorType | undefined;
    body?: unknown;
    path: string;
    message?: string;
  }) {
    super(
      args.message ??
        `Tacticus API request to ${args.path} failed: HTTP ${args.status}${
          args.type ? ` (${args.type})` : ''
        }`,
    );
    this.name = 'TacticusApiError';
    this.status = args.status;
    this.type = args.type;
    this.body = args.body;
    this.path = args.path;
  }

  /** 500s are documented as retryable; everything else is not. */
  get retryable(): boolean {
    return this.status >= 500;
  }
}
