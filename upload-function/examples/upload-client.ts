export type AllowedContentType = 'image/jpeg' | 'image/png' | 'image/webp';

export type ProductId = 'galleries' | 'artnet-auctions' | 'pdb';

export type PresignRequest =
  | GalleryArtworkPresignRequest
  | AuctionLotPresignRequest
  | PdbArtworkPresignRequest;

interface CommonPresignFields {
  readonly imageId: string;
  readonly imageVariantSuffix: string | null;
  readonly contentType: AllowedContentType;
  readonly contentLength: number;
}

export interface GalleryArtworkPresignRequest extends CommonPresignFields {
  readonly kind: 'gallery-artwork';
  readonly galleryId: string;
  readonly artworkId: string;
}

export interface AuctionLotPresignRequest extends CommonPresignFields {
  readonly kind: 'auction-lot';
  readonly auctionHouseId: string;
  readonly auctionDate: string;
  readonly lotId: string;
}

export interface PdbArtworkPresignRequest extends CommonPresignFields {
  readonly kind: 'pdb-artwork';
  readonly pdbArtworkId: string;
}

export interface PresignResponse {
  readonly uploadId: string;
  readonly objectKey: string;
  readonly uploadUrl: string;
  readonly uploadHeaders: {
    readonly 'Content-Type': AllowedContentType;
    readonly 'Content-Length': string;
    readonly 'X-Goog-Content-Length-Range': string;
  };
  readonly expiresAt: string;
}

export interface FinalizeResponse {
  readonly objectKey: string;
  readonly publicUrl: string;
  readonly size: number;
  readonly contentType: AllowedContentType;
  readonly uploadedAt: string;
  readonly replicatedToR2: boolean;
}

export interface S3IngestRequest {
  readonly sourceUri: string;
  readonly objectKey: string;
  readonly contentType?: AllowedContentType;
}

export interface S3IngestResponse {
  readonly objectKey: string;
  readonly publicUrl: string;
  readonly size: number;
  readonly sha256: string;
  readonly contentType: AllowedContentType;
  readonly sourceUri: string;
  readonly uploadedAt: string;
  readonly replicatedToR2: boolean;
}

export interface UploadFunctionClientOptions {
  readonly endpoint: string;
  readonly productHeader: ProductId;
  readonly auctionHouseHeader?: string;
}

export interface UploadToSignedUrlInput {
  readonly presign: PresignResponse;
  readonly body: Blob;
  readonly includeContentLengthHeader: boolean;
}

/**
 * Requests a signed GCS upload URL from the Upload Function.
 */
export const presignUpload = async (
  options: UploadFunctionClientOptions,
  request: PresignRequest,
): Promise<PresignResponse> => {
  const headers = buildJsonHeaders(options);
  const response = await fetch(`${trimTrailingSlash(options.endpoint)}/v1/uploads/presign`, {
    method: 'POST',
    headers,
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(`Presign failed: ${await response.text()}`);
  }

  return parsePresignResponse(await response.json());
};

/**
 * Uploads bytes to the signed GCS URL returned by presign.
 */
export const uploadToSignedUrl = async (input: UploadToSignedUrlInput): Promise<void> => {
  const headers = new Headers({
    'Content-Type': input.presign.uploadHeaders['Content-Type'],
    'X-Goog-Content-Length-Range': input.presign.uploadHeaders['X-Goog-Content-Length-Range'],
  });

  if (input.includeContentLengthHeader) {
    headers.set('Content-Length', input.presign.uploadHeaders['Content-Length']);
  }

  const response = await fetch(input.presign.uploadUrl, {
    method: 'PUT',
    headers,
    body: input.body,
  });

  if (!response.ok) {
    throw new Error(`Signed URL upload failed: ${response.status} ${await response.text()}`);
  }
};

/**
 * Finalizes a direct upload after the signed URL PUT succeeds.
 */
export const finalizeUpload = async (
  options: UploadFunctionClientOptions,
  uploadId: string,
): Promise<FinalizeResponse> => {
  const headers = buildTrustedHeaders(options);
  const response = await fetch(
    `${trimTrailingSlash(options.endpoint)}/v1/uploads/${uploadId}/finalize`,
    {
      method: 'POST',
      headers,
    },
  );

  if (!response.ok) {
    throw new Error(`Finalize failed: ${await response.text()}`);
  }

  return parseFinalizeResponse(await response.json());
};

/**
 * Ingests an image that already exists in an allowlisted S3-compatible source bucket.
 */
export const ingestFromS3 = async (
  endpoint: string,
  request: S3IngestRequest,
): Promise<S3IngestResponse> => {
  const response = await fetch(`${trimTrailingSlash(endpoint)}/v1/ingest/from-s3`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(`S3 ingest failed: ${await response.text()}`);
  }

  return parseS3IngestResponse(await response.json());
};

/**
 * Deletes a finalized object from GCS, R2 originals, and persisted R2 WebP variants.
 */
export const deleteFinalizedObject = async (
  options: UploadFunctionClientOptions,
  objectKey: string,
): Promise<void> => {
  const response = await fetch(
    `${trimTrailingSlash(options.endpoint)}/v1/objects/${encodeURIComponent(objectKey)}`,
    {
      method: 'DELETE',
      headers: buildTrustedHeaders(options),
    },
  );

  if (!response.ok) {
    throw new Error(`Delete failed: ${await response.text()}`);
  }
};

const buildJsonHeaders = (options: UploadFunctionClientOptions): Headers => {
  const headers = buildTrustedHeaders(options);
  headers.set('Content-Type', 'application/json');
  return headers;
};

const buildTrustedHeaders = (options: UploadFunctionClientOptions): Headers => {
  const headers = new Headers();
  headers.set('X-Artnet-Product-Id', options.productHeader);

  if (options.auctionHouseHeader !== undefined && options.auctionHouseHeader.length > 0) {
    headers.set('X-Artnet-Auction-House-Id', options.auctionHouseHeader);
  }

  return headers;
};

const parsePresignResponse = (value: unknown): PresignResponse => {
  const record = requireRecord(value, 'presign response');
  const uploadHeaders = requireRecord(record.uploadHeaders, 'presign uploadHeaders');

  return {
    uploadId: requireString(record.uploadId, 'uploadId'),
    objectKey: requireString(record.objectKey, 'objectKey'),
    uploadUrl: requireString(record.uploadUrl, 'uploadUrl'),
    uploadHeaders: {
      'Content-Type': requireAllowedContentType(uploadHeaders['Content-Type']),
      'Content-Length': requireString(uploadHeaders['Content-Length'], 'Content-Length'),
      'X-Goog-Content-Length-Range': requireString(
        uploadHeaders['X-Goog-Content-Length-Range'],
        'X-Goog-Content-Length-Range',
      ),
    },
    expiresAt: requireString(record.expiresAt, 'expiresAt'),
  };
};

const parseFinalizeResponse = (value: unknown): FinalizeResponse => {
  const record = requireRecord(value, 'finalize response');

  return {
    objectKey: requireString(record.objectKey, 'objectKey'),
    publicUrl: requireString(record.publicUrl, 'publicUrl'),
    size: requireNumber(record.size, 'size'),
    contentType: requireAllowedContentType(record.contentType),
    uploadedAt: requireString(record.uploadedAt, 'uploadedAt'),
    replicatedToR2: requireBoolean(record.replicatedToR2, 'replicatedToR2'),
  };
};

const parseS3IngestResponse = (value: unknown): S3IngestResponse => {
  const record = requireRecord(value, 'S3 ingest response');

  return {
    objectKey: requireString(record.objectKey, 'objectKey'),
    publicUrl: requireString(record.publicUrl, 'publicUrl'),
    size: requireNumber(record.size, 'size'),
    sha256: requireString(record.sha256, 'sha256'),
    contentType: requireAllowedContentType(record.contentType),
    sourceUri: requireString(record.sourceUri, 'sourceUri'),
    uploadedAt: requireString(record.uploadedAt, 'uploadedAt'),
    replicatedToR2: requireBoolean(record.replicatedToR2, 'replicatedToR2'),
  };
};

const requireRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(value));
  }

  throw new Error(`Expected ${label} to be an object.`);
};

const requireString = (value: unknown, label: string): string => {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }

  throw new Error(`Expected ${label} to be a non-empty string.`);
};

const requireNumber = (value: unknown, label: string): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  throw new Error(`Expected ${label} to be a finite number.`);
};

const requireBoolean = (value: unknown, label: string): boolean => {
  if (typeof value === 'boolean') {
    return value;
  }

  throw new Error(`Expected ${label} to be a boolean.`);
};

const requireAllowedContentType = (value: unknown): AllowedContentType => {
  if (value === 'image/jpeg' || value === 'image/png' || value === 'image/webp') {
    return value;
  }

  throw new Error('Expected contentType to be image/jpeg, image/png, or image/webp.');
};

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, '');
