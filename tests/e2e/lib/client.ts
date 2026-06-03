import { config } from './config.js';
import { sampleJpeg } from './image.js';
import { asObject, getBoolean, getString } from './json.js';

// Fixed auction-lot context for the suite. The gateway headers must agree with
// the body (product = artnet-auctions for auction lots; auction house id matches).
const PRODUCT_ID = 'artnet-auctions';
const AUCTION_HOUSE_ID = '425939177';
const AUCTION_DATE = '20260310';
const LOT_ID = '638775';

export interface JsonResponse {
  readonly status: number;
  readonly body: unknown;
}

export interface FinalizeResult {
  readonly objectKey: string;
  readonly publicUrl: string;
  readonly replicatedToR2: boolean;
}

export const gatewayHeaders = (): Record<string, string> => ({
  'X-Artnet-Product-Id': PRODUCT_ID,
  'X-Artnet-Auction-House-Id': AUCTION_HOUSE_ID,
});

/** Unique, URL-safe image id per test so runs do not collide (§2.6 charset). */
export const uniqueImageId = (): string => `e2e-${crypto.randomUUID().slice(0, 8)}`;

export const presign = async (
  imageId: string,
  byteLength: number,
  overrides: { contentType?: string; headers?: Record<string, string> } = {},
): Promise<JsonResponse> => {
  const response = await fetch(`${config.uploadFunctionUrl}/v1/uploads/presign`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(overrides.headers ?? gatewayHeaders()),
    },
    body: JSON.stringify({
      kind: 'auction-lot',
      auctionHouseId: AUCTION_HOUSE_ID,
      auctionDate: AUCTION_DATE,
      lotId: LOT_ID,
      imageId,
      imageVariantSuffix: null,
      contentType: overrides.contentType ?? 'image/jpeg',
      contentLength: byteLength,
    }),
  });
  return { status: response.status, body: await response.json() };
};

export const putToSignedUrl = async (
  uploadUrl: string,
  uploadHeaders: Record<string, string>,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<number> => {
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: uploadHeaders,
    // Wrap in a Blob: the DOM lib's BodyInit type does not accept a bare
    // Uint8Array. The Content-Length / content-type are set via uploadHeaders.
    body: new Blob([bytes]),
  });
  return response.status;
};

export const finalize = async (
  uploadId: string,
  headers: Record<string, string> = gatewayHeaders(),
): Promise<JsonResponse> => {
  const response = await fetch(`${config.uploadFunctionUrl}/v1/uploads/${uploadId}/finalize`, {
    method: 'POST',
    headers,
  });
  return { status: response.status, body: await response.json() };
};

export const deleteObject = async (objectKey: string): Promise<number> => {
  const response = await fetch(`${config.uploadFunctionUrl}/v1/objects/${objectKey}`, {
    method: 'DELETE',
    headers: gatewayHeaders(),
  });
  return response.status;
};

/**
 * Runs the full direct-upload happy path (presign -> PUT -> finalize) and
 * returns the finalize result. Throws with context if any step fails, so
 * read-path setup surfaces upload failures clearly.
 */
export const uploadSampleImage = async (imageId: string): Promise<FinalizeResult> => {
  const bytes = sampleJpeg();

  const presignResponse = await presign(imageId, bytes.byteLength);
  if (presignResponse.status !== 200) {
    throw new Error(`presign failed: ${presignResponse.status} ${JSON.stringify(presignResponse.body)}`);
  }
  const presignBody = asObject(presignResponse.body);
  const uploadUrl = getString(presignBody, 'uploadUrl');
  const uploadId = getString(presignBody, 'uploadId');
  const uploadHeaders = asObject(presignBody['uploadHeaders'] ?? {});

  const putStatus = await putToSignedUrl(uploadUrl, toHeaderRecord(uploadHeaders), bytes);
  if (putStatus !== 200) {
    throw new Error(`PUT to signed URL failed: ${putStatus}`);
  }

  const finalizeResponse = await finalize(uploadId);
  if (finalizeResponse.status !== 200) {
    throw new Error(
      `finalize failed: ${finalizeResponse.status} ${JSON.stringify(finalizeResponse.body)}`,
    );
  }
  const finalizeBody = asObject(finalizeResponse.body);
  return {
    objectKey: getString(finalizeBody, 'objectKey'),
    publicUrl: getString(finalizeBody, 'publicUrl'),
    replicatedToR2: getBoolean(finalizeBody, 'replicatedToR2'),
  };
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
