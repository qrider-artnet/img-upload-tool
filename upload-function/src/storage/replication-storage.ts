import type { Readable } from 'node:stream';

import type { AllowedContentType, ObjectKey } from '../types.js';

/**
 * Input required to write a replicated object to the R2 mirror.
 */
export interface ReplicationPutInput {
  readonly objectKey: ObjectKey;
  readonly bodyFactory: () => Promise<Readable>;
  readonly cacheVersion?: string;
  readonly contentType: AllowedContentType;
  readonly contentLength: number;
}

/**
 * R2-side replication storage operations (spec §2.9).
 */
export interface ReplicationStorage {
  put(input: ReplicationPutInput): Promise<void>;
  delete(objectKey: string): Promise<void>;
  deleteByPrefix(prefix: string): Promise<void>;
  healthCheck(): Promise<void>;
}
