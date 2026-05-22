import type { Readable } from 'node:stream';

import type { Tombstone } from '../schemas.js';
import type { AllowedContentType, ObjectKey, StorageObjectKey } from '../types.js';

/**
 * Input required to create a signed direct-upload URL.
 */
export interface SignedUploadUrlInput {
  readonly objectKey: StorageObjectKey;
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

export interface WriteObjectInput {
  readonly objectKey: ObjectKey;
  readonly contentType: AllowedContentType;
  readonly contentLength: number;
  readonly bodyFactory: () => Promise<Readable>;
}

export interface WriteObjectResult {
  readonly size: number;
  readonly sha256: string;
  readonly uploadedAt: Date;
}

export interface PromoteObjectInput {
  readonly sourceObjectKey: StorageObjectKey;
  readonly destinationObjectKey: ObjectKey;
  readonly contentType: AllowedContentType;
}

/**
 * Storage operations needed by the stage 1 direct-upload flow.
 */
export interface UploadStorage {
  createSignedUploadUrl(input: SignedUploadUrlInput): Promise<SignedUploadUrl>;
  deleteObject(objectKey: StorageObjectKey): Promise<void>;
  getObjectMetadata(objectKey: StorageObjectKey): Promise<ObjectMetadata | undefined>;
  getObjectStream(objectKey: StorageObjectKey): Promise<Readable>;
  healthCheck(): Promise<void>;
  promoteObject(input: PromoteObjectInput): Promise<void>;
  tombstoneExists(objectKey: ObjectKey): Promise<boolean>;
  writeObject(input: WriteObjectInput): Promise<WriteObjectResult>;
  writeTombstone(objectKey: ObjectKey, tombstone: Tombstone): Promise<void>;
}

/**
 * Builds the GCS path used to persist a tombstone marker (spec §2.12).
 */
export const buildTombstonePath = (objectKey: ObjectKey): string => `tombstones/${objectKey}.json`;
