import { embed, type VerificationResult } from './embed.js';
import type { MetadataDocument } from './schema.js';

export interface TagAndUploadInput {
  /** Upload Function base URL. */
  readonly endpoint: string;
  /** Original image bytes (untagged). */
  readonly image: Buffer;
  readonly metadata: MetadataDocument;
  /**
   * Presign body entity fields for the target key (kind + ids), minus
   * contentType/contentLength which are filled from the tagged result. Kept as a
   * passthrough so all object-key kinds (auction-lot, galleries, pdb) work.
   */
  readonly presignFields: Record<string, unknown>;
  /** Trusted gateway headers (X-Artnet-Product-Id, etc.). */
  readonly gatewayHeaders: Record<string, string>;
  /** Strip GPS + device serials while embedding. Default true. */
  readonly stripPrivacy?: boolean;
}

export interface TagAndUploadResult {
  readonly objectKey: string;
  readonly publicUrl: string;
  readonly replicatedToR2: boolean;
  readonly verification: VerificationResult;
}

/**
 * Embeds metadata into the image, then uploads the tagged bytes through the
 * normal presign -> PUT -> finalize flow. The embed runs first so presign is
 * called with the tagged byte length (the signed PUT pins exact content length).
 */
export const tagAndUpload = async (input: TagAndUploadInput): Promise<TagAndUploadResult> => {
  const embedded = await embed(input.image, input.metadata, {
    stripPrivacy: input.stripPrivacy ?? true,
  });
  const contentType = embedded.format === 'webp' ? 'image/webp' : 'image/jpeg';

  const presign = asObject(
    await postJson(
      `${input.endpoint}/v1/uploads/presign`,
      { ...input.presignFields, contentType, contentLength: embedded.bytes.byteLength },
      input.gatewayHeaders,
    ),
  );
  const uploadUrl = getString(presign, 'uploadUrl');
  const uploadId = getString(presign, 'uploadId');
  const uploadHeaders = toHeaderRecord(asObject(presign['uploadHeaders'] ?? {}));

  const putResponse = await fetch(uploadUrl, {
    method: 'PUT',
    headers: uploadHeaders,
    body: embedded.bytes,
  });
  if (!putResponse.ok) {
    throw new Error(`Tagged PUT to signed URL failed: ${putResponse.status}`);
  }

  const finalize = asObject(
    await postJson(
      `${input.endpoint}/v1/uploads/${uploadId}/finalize`,
      undefined,
      input.gatewayHeaders,
    ),
  );

  return {
    objectKey: getString(finalize, 'objectKey'),
    publicUrl: getString(finalize, 'publicUrl'),
    replicatedToR2: getBoolean(finalize, 'replicatedToR2'),
    verification: embedded.verification,
  };
};

const postJson = async (
  url: string,
  body: unknown,
  headers: Record<string, string>,
): Promise<unknown> => {
  const response = await fetch(url, {
    method: 'POST',
    headers: body === undefined ? headers : { 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json: unknown = await response.json();
  if (!response.ok) {
    throw new Error(`${url} failed: ${response.status} ${JSON.stringify(json)}`);
  }
  return json;
};

const asObject = (value: unknown): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Expected a JSON object response.');
  }
  return value as Record<string, unknown>;
};

const getString = (object: Record<string, unknown>, key: string): string => {
  const value = object[key];
  if (typeof value !== 'string') {
    throw new Error(`Expected string at "${key}".`);
  }
  return value;
};

const getBoolean = (object: Record<string, unknown>, key: string): boolean => {
  const value = object[key];
  if (typeof value !== 'boolean') {
    throw new Error(`Expected boolean at "${key}".`);
  }
  return value;
};

const toHeaderRecord = (object: Record<string, unknown>): Record<string, string> => {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(object)) {
    if (typeof value === 'string') {
      headers[key] = value;
    }
  }
  return headers;
};
