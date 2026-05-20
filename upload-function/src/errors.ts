import type { UploadErrorCode } from './types.js';

/**
 * Extra machine-readable context included in error envelopes.
 */
export type ErrorDetails = Record<string, unknown>;

/**
 * HTTP statuses used by typed Upload Function errors.
 */
export type ErrorHttpStatus = 400 | 401 | 403 | 404 | 409 | 500 | 502 | 503;

/**
 * Typed error used for all expected Upload Function failures.
 */
export class UploadFunctionError extends Error {
  public readonly code: UploadErrorCode;

  public readonly status: ErrorHttpStatus;

  public readonly details: ErrorDetails | undefined;

  public constructor(input: {
    code: UploadErrorCode;
    status: ErrorHttpStatus;
    message: string;
    details?: ErrorDetails;
  }) {
    super(input.message);
    this.name = 'UploadFunctionError';
    this.code = input.code;
    this.status = input.status;
    this.details = input.details;
  }
}

/**
 * Converts unknown exceptions into API-safe typed errors.
 */
export const toUploadFunctionError = (err: unknown): UploadFunctionError => {
  if (err instanceof UploadFunctionError) {
    return err;
  }

  return new UploadFunctionError({
    code: 'internal_error',
    status: 500,
    message: 'An unexpected error occurred.',
  });
};
