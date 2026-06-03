// Small runtime guards for reading untyped JSON responses. Tests fail loudly
// with a clear message when a response does not match the documented shape,
// instead of relying on unchecked type assertions.

export const asObject = (value: unknown): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`Expected a JSON object, got ${value === null ? 'null' : typeof value}`);
  }
  return value as Record<string, unknown>;
};

export const getString = (object: Record<string, unknown>, key: string): string => {
  const value = object[key];
  if (typeof value !== 'string') {
    throw new Error(`Expected string at "${key}", got ${typeof value}`);
  }
  return value;
};

export const getBoolean = (object: Record<string, unknown>, key: string): boolean => {
  const value = object[key];
  if (typeof value !== 'boolean') {
    throw new Error(`Expected boolean at "${key}", got ${typeof value}`);
  }
  return value;
};

/** Reads the stable `error.code` from an error envelope, or undefined. */
export const errorCode = (body: unknown): string | undefined => {
  if (typeof body !== 'object' || body === null || !('error' in body)) {
    return undefined;
  }
  const error = (body as { error: unknown }).error;
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  const code = (error as { code: unknown }).code;
  return typeof code === 'string' ? code : undefined;
};
