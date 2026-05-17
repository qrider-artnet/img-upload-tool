import { z } from 'zod';

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export const AllowedContentTypeSchema = z.union([
  z.literal('image/jpeg'),
  z.literal('image/png'),
  z.literal('image/webp'),
]);

const MAX_PATH_SEGMENT_LENGTH = 64;
const MAX_VARIANT_SUFFIX_LENGTH = 16;

const CommonPresignRequestFields = {
  imageId: z.string().min(1).max(MAX_PATH_SEGMENT_LENGTH),
  imageVariantSuffix: z.string().max(MAX_VARIANT_SUFFIX_LENGTH).nullable(),
  contentType: z.string().min(1),
  contentLength: z.number().int().positive(),
} as const;

const GalleryArtworkPresignRequestSchema = z
  .object({
    kind: z.literal('gallery-artwork'),
    galleryId: z.string().min(1).max(MAX_PATH_SEGMENT_LENGTH),
    artworkId: z.string().min(1).max(MAX_PATH_SEGMENT_LENGTH),
    ...CommonPresignRequestFields,
  })
  .strict();

const AuctionLotPresignRequestSchema = z
  .object({
    kind: z.literal('auction-lot'),
    auctionHouseId: z.string().min(1).max(MAX_PATH_SEGMENT_LENGTH),
    auctionDate: z.string().min(1).max(MAX_PATH_SEGMENT_LENGTH),
    lotId: z.string().min(1).max(MAX_PATH_SEGMENT_LENGTH),
    ...CommonPresignRequestFields,
  })
  .strict();

const PdbArtworkPresignRequestSchema = z
  .object({
    kind: z.literal('pdb-artwork'),
    pdbArtworkId: z.string().min(1).max(MAX_PATH_SEGMENT_LENGTH),
    ...CommonPresignRequestFields,
  })
  .strict();

export const PresignRequestSchema = z.discriminatedUnion('kind', [
  GalleryArtworkPresignRequestSchema,
  AuctionLotPresignRequestSchema,
  PdbArtworkPresignRequestSchema,
]);

/**
 * Validated request body for direct-upload presign.
 */
export type PresignRequest = z.infer<typeof PresignRequestSchema>;

export const PresignResponseSchema = z
  .object({
    uploadId: z.string().min(1),
    objectKey: z.string().min(1),
    uploadUrl: z.url(),
    uploadHeaders: z.object({
      'Content-Type': AllowedContentTypeSchema,
      'Content-Length': z.string().regex(/^[1-9][0-9]*$/),
      'X-Goog-Content-Length-Range': z.string().regex(/^[1-9][0-9]*,[1-9][0-9]*$/),
    }),
    expiresAt: z.iso.datetime(),
  })
  .strict();

/**
 * Validated response body for direct-upload presign.
 */
export type PresignResponse = z.infer<typeof PresignResponseSchema>;

export const FinalizeResponseSchema = z
  .object({
    objectKey: z.string().min(1),
    publicUrl: z.url(),
    size: z.number().int().nonnegative(),
    contentType: AllowedContentTypeSchema,
    uploadedAt: z.iso.datetime(),
    replicatedToR2: z.boolean(),
  })
  .strict();

/**
 * Validated response body for upload finalize.
 */
export type FinalizeResponse = z.infer<typeof FinalizeResponseSchema>;

export const HealthResponseSchema = z.object({ status: z.literal('ok') }).strict();

/**
 * Validated response body for health checks.
 */
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const TombstoneSchema = z
  .object({
    objectKey: z.string().min(1),
    deletedAt: z.iso.datetime(),
    deletedBy: z.string().min(1),
    requestId: z.string().min(1),
  })
  .strict();

/**
 * Persisted record marking an intentional deletion. Reconciliation reads
 * tombstones to avoid backfilling a deleted object from GCS to R2.
 */
export type Tombstone = z.infer<typeof TombstoneSchema>;

export const ErrorResponseSchema = z
  .object({
    error: z.object({
      code: z.string().min(1),
      message: z.string().min(1),
      details: z.record(z.string(), z.unknown()).optional(),
    }),
    requestId: z.string().min(1),
  })
  .strict();

/**
 * Validated response body for non-2xx API errors.
 */
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
