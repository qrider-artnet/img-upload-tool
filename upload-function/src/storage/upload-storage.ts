import type { Readable } from 'node:stream';

import type { Tombstone } from '../schemas.js';
import type { AllowedContentType, ObjectKey } from '../types.js';

/**
 * Input required to create a signed direct-upload URL.
 */
export interface SignedUploadUrlInput {
  readonly objectKey: ObjectKey;
  readonly contentType: AllowedContentType;
  readonly contentLength: number;
  readonly expiresAt: Date;
}

/**
 * Storage provider response for a signed direct-upload URL.
 */
export interface SignedUploadUrl {
  readonly uploadUrl: string;
  readonly contentLengthRange: string;
}

/**
 * Object metadata read during finalize.
 */
export interface ObjectMetadata {
  readonly size: number;
  readonly contentType: string | undefined;
  readonly updatedAt: Date | undefined;
}

/**
 * Storage operations needed by the stage 1 direct-upload flow.
 */
export interface UploadStorage {
  createSignedUploadUrl(input: SignedUploadUrlInput): Promise<SignedUploadUrl>;
  deleteObject(objectKey: ObjectKey): Promise<void>;
  getObjectMetadata(objectKey: ObjectKey): Promise<ObjectMetadata | undefined>;
  getObjectStream(objectKey: ObjectKey): Promise<Readable>;
  healthCheck(): Promise<void>;
  tombstoneExists(objectKey: ObjectKey): Promise<boolean>;
  writeTombstone(objectKey: ObjectKey, tombstone: Tombstone): Promise<void>;
}

/**
 * Builds the GCS path used to persist a tombstone marker (spec §2.12).
 */
export const buildTombstonePath = (objectKey: ObjectKey): string => `tombstones/${objectKey}.json`;
