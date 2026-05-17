import { UploadFunctionError } from './errors.js';
import { AllowedContentTypeSchema, MAX_UPLOAD_BYTES } from './schemas.js';
import type { AllowedContentType } from './types.js';

/**
 * Validates and narrows a request content type.
 */
export const parseAllowedContentType = (value: string): AllowedContentType => {
  const parsed = AllowedContentTypeSchema.safeParse(value);

  if (parsed.success) {
    return parsed.data;
  }

  throw new UploadFunctionError({
    code: 'unsupported_content_type',
    status: 400,
    message: 'contentType must be image/jpeg, image/png, or image/webp.',
    details: { contentType: value },
  });
};

/**
 * Validates the documented maximum upload size.
 */
export const validateContentLength = (value: number): void => {
  if (value <= MAX_UPLOAD_BYTES) {
    return;
  }

  throw new UploadFunctionError({
    code: 'file_too_large',
    status: 400,
    message: 'contentLength must be 50 MB or smaller.',
    details: { maxBytes: MAX_UPLOAD_BYTES, contentLength: value },
  });
};

/**
 * Normalizes a stored content-type value by stripping media-type parameters
 * (e.g. `image/jpeg; charset=binary` → `image/jpeg`) and lowercasing.
 * Returns `undefined` if the source value is `undefined` or empty.
 */
export const normalizeStoredContentType = (value: string | undefined): string | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.split(';', 1)[0]?.trim().toLowerCase();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
};
