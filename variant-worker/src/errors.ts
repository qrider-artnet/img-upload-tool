export type VariantErrorCode = 'image_not_found' | 'invalid_request' | 'invalid_variant';

export class VariantWorkerError extends Error {
  public readonly code: VariantErrorCode;

  public readonly status: number;

  public constructor(input: {
    readonly code: VariantErrorCode;
    readonly status: number;
    readonly message: string;
  }) {
    super(input.message);
    this.name = 'VariantWorkerError';
    this.code = input.code;
    this.status = input.status;
  }
}

export const toErrorResponse = (err: unknown): Response => {
  if (err instanceof VariantWorkerError) {
    return jsonError(err.code, err.message, err.status);
  }

  return jsonError('invalid_request', 'Unable to serve image request.', 500);
};

export const jsonError = (code: VariantErrorCode, message: string, status: number): Response =>
  Response.json(
    {
      error: {
        code,
        message,
      },
    },
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  );
