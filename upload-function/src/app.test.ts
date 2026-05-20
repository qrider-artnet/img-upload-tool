import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createUploadFunctionApp } from './app.js';
import { UploadFunctionError } from './errors.js';
import { parseObjectKey } from './object-key.js';
import {
  ErrorResponseSchema,
  FinalizeResponseSchema,
  IngestFromS3ResponseSchema,
  PresignResponseSchema,
  type Tombstone,
} from './schemas.js';
import type { SourceStorage, S3SourceObjectMetadata } from './storage/s3-source-storage.js';
import type { ReplicationPutInput, ReplicationStorage } from './storage/replication-storage.js';
import type {
  ObjectMetadata,
  SignedUploadUrl,
  SignedUploadUrlInput,
  UploadStorage,
  WriteObjectInput,
  WriteObjectResult,
} from './storage/upload-storage.js';
import type { ObjectKey } from './types.js';
import { InMemoryUploadSessionStore } from './upload-session-store.js';
import { buildAllWebpVariantKeys, buildAllWebpVariantPrefixes } from './variant-keys.js';

describe('Upload Function app', () => {
  it('presigns a valid upload request', async () => {
    const { app } = createTestApp();

    const response = await app.request('/v1/uploads/presign', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify(validPresignBody()),
    });

    expect(response.status).toBe(200);
    const body = PresignResponseSchema.parse(await response.json());
    expect(body.objectKey).toBe(
      'products/artnet-auctions/auction-lots/425939177/20260310/638775/images/195.jpg',
    );
    expect(body.uploadHeaders).toEqual({
      'Content-Type': 'image/jpeg',
      'Content-Length': '1024576',
      'X-Goog-Content-Length-Range': '1024576,1024576',
    });
  });

  it('handles browser CORS preflight requests', async () => {
    const { app } = createTestApp();

    const response = await app.request('/v1/uploads/presign', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://consumer.example',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,x-artnet-auction-house-id',
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('access-control-allow-methods')).toBe('GET, POST, DELETE, OPTIONS');
    expect(response.headers.get('access-control-allow-headers')).toBe(
      'Content-Type, X-Artnet-Product-Id, X-Artnet-Auction-House-Id',
    );
  });

  it('rejects presign when the trusted auction-house header is missing', async () => {
    const { app } = createTestApp();

    const response = await app.request('/v1/uploads/presign', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-artnet-product-id': 'artnet-auctions',
      },
      body: JSON.stringify(validPresignBody()),
    });

    expect(response.status).toBe(403);
    const body = ErrorResponseSchema.parse(await response.json());
    expect(body.error.code).toBe('auction_house_required');
  });

  it('rejects finalize when the trusted auction-house header is missing', async () => {
    const { app } = createTestApp();
    const presignResponse = await app.request('/v1/uploads/presign', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify(validPresignBody()),
    });
    const presignBody = PresignResponseSchema.parse(await presignResponse.json());

    const finalizeResponse = await app.request(`/v1/uploads/${presignBody.uploadId}/finalize`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-artnet-product-id': 'artnet-auctions',
      },
    });

    expect(finalizeResponse.status).toBe(403);
    const body = ErrorResponseSchema.parse(await finalizeResponse.json());
    expect(body.error.code).toBe('auction_house_required');
  });

  it('rejects cancel when the trusted auction-house header is missing', async () => {
    const { app } = createTestApp();
    const presignResponse = await app.request('/v1/uploads/presign', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify(validPresignBody()),
    });
    const presignBody = PresignResponseSchema.parse(await presignResponse.json());

    const deleteResponse = await app.request(`/v1/uploads/${presignBody.uploadId}`, {
      method: 'DELETE',
      headers: { 'x-artnet-product-id': 'artnet-auctions' },
    });

    expect(deleteResponse.status).toBe(403);
    const body = ErrorResponseSchema.parse(await deleteResponse.json());
    expect(body.error.code).toBe('auction_house_required');
  });

  it('rejects uploads for a different trusted auction-house context', async () => {
    const { app } = createTestApp();

    const response = await app.request('/v1/uploads/presign', {
      method: 'POST',
      headers: jsonHeaders({ 'x-artnet-auction-house-id': 'other-house' }),
      body: JSON.stringify(validPresignBody()),
    });

    expect(response.status).toBe(403);
    const body = ErrorResponseSchema.parse(await response.json());
    expect(body.error.code).toBe('auction_house_mismatch');
  });

  it('rejects presign when the trusted product header is missing', async () => {
    const { app } = createTestApp();

    const response = await app.request('/v1/uploads/presign', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-artnet-auction-house-id': '425939177',
      },
      body: JSON.stringify(validPresignBody()),
    });

    expect(response.status).toBe(403);
    const body = ErrorResponseSchema.parse(await response.json());
    expect(body.error.code).toBe('product_required');
  });

  it('rejects presign when the trusted product does not match the entity kind', async () => {
    const { app } = createTestApp();

    const response = await app.request('/v1/uploads/presign', {
      method: 'POST',
      headers: jsonHeaders({ 'x-artnet-product-id': 'galleries' }),
      body: JSON.stringify(validPresignBody()),
    });

    expect(response.status).toBe(403);
    const body = ErrorResponseSchema.parse(await response.json());
    expect(body.error.code).toBe('product_mismatch');
  });

  it('presigns gallery artwork uploads without auction-house context', async () => {
    const { app } = createTestApp();

    const response = await app.request('/v1/uploads/presign', {
      method: 'POST',
      headers: productJsonHeaders('galleries'),
      body: JSON.stringify(validGalleryPresignBody()),
    });

    expect(response.status).toBe(200);
    const body = PresignResponseSchema.parse(await response.json());
    expect(body.objectKey).toBe('products/galleries/artworks/gallery-1/artwork-1/images/195.jpg');
  });

  it('presigns PDB artwork uploads without auction-house context', async () => {
    const { app } = createTestApp();

    const response = await app.request('/v1/uploads/presign', {
      method: 'POST',
      headers: productJsonHeaders('pdb'),
      body: JSON.stringify(validPdbPresignBody()),
    });

    expect(response.status).toBe(200);
    const body = PresignResponseSchema.parse(await response.json());
    expect(body.objectKey).toBe('products/pdb/artworks/pdb-123/images/195.jpg');
  });

  it('rejects unsupported content types', async () => {
    const { app } = createTestApp();

    const response = await app.request('/v1/uploads/presign', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ ...validPresignBody(), contentType: 'image/gif' }),
    });

    expect(response.status).toBe(400);
    const body = ErrorResponseSchema.parse(await response.json());
    expect(body.error.code).toBe('unsupported_content_type');
  });

  it('rejects path segments that exceed the schema length cap', async () => {
    const { app } = createTestApp();

    const response = await app.request('/v1/uploads/presign', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ ...validPresignBody(), lotId: 'a'.repeat(65) }),
    });

    expect(response.status).toBe(400);
    const body = ErrorResponseSchema.parse(await response.json());
    expect(body.error.code).toBe('invalid_request');
  });

  it('rejects files larger than 50 MB', async () => {
    const { app } = createTestApp();

    const response = await app.request('/v1/uploads/presign', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ ...validPresignBody(), contentLength: 50 * 1024 * 1024 + 1 }),
    });

    expect(response.status).toBe(400);
    const body = ErrorResponseSchema.parse(await response.json());
    expect(body.error.code).toBe('file_too_large');
  });

  it('finalizes an uploaded object and deletes the session', async () => {
    const { app, replication, storage } = createTestApp();
    const presignResponse = await app.request('/v1/uploads/presign', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify(validPresignBody()),
    });
    const presignBody = PresignResponseSchema.parse(await presignResponse.json());
    const objectKey = parseObjectKey(presignBody.objectKey);
    storage.metadataByKey.set(objectKey, {
      contentType: 'image/jpeg',
      size: 1024576,
      updatedAt: new Date('2026-05-08T12:30:00.000Z'),
    });

    const finalizeResponse = await app.request(`/v1/uploads/${presignBody.uploadId}/finalize`, {
      method: 'POST',
      headers: jsonHeaders(),
    });

    expect(finalizeResponse.status).toBe(200);
    const finalizeBody = FinalizeResponseSchema.parse(await finalizeResponse.json());
    expect(finalizeBody).toEqual({
      objectKey: 'products/artnet-auctions/auction-lots/425939177/20260310/638775/images/195.jpg',
      publicUrl: `https://artworks.artnet.test/_v/${presignBody.uploadId}/products/artnet-auctions/auction-lots/425939177/20260310/638775/images/195.jpg`,
      size: 1024576,
      contentType: 'image/jpeg',
      uploadedAt: '2026-05-08T12:30:00.000Z',
      replicatedToR2: true,
    });
    expect(replication.putByKey.get(objectKey)?.cacheVersion).toBe(presignBody.uploadId);

    const secondFinalizeResponse = await app.request(
      `/v1/uploads/${presignBody.uploadId}/finalize`,
      {
        method: 'POST',
        headers: jsonHeaders(),
      },
    );
    expect(secondFinalizeResponse.status).toBe(404);
  });

  it('finalizes gallery artwork uploads without auction-house context', async () => {
    const { app, storage } = createTestApp();
    const presignResponse = await app.request('/v1/uploads/presign', {
      method: 'POST',
      headers: productJsonHeaders('galleries'),
      body: JSON.stringify(validGalleryPresignBody()),
    });
    const presignBody = PresignResponseSchema.parse(await presignResponse.json());
    const objectKey = parseObjectKey(presignBody.objectKey);
    storage.metadataByKey.set(objectKey, {
      contentType: 'image/jpeg',
      size: 1024576,
      updatedAt: new Date('2026-05-08T12:30:00.000Z'),
    });

    const finalizeResponse = await app.request(`/v1/uploads/${presignBody.uploadId}/finalize`, {
      method: 'POST',
      headers: productJsonHeaders('galleries'),
    });

    expect(finalizeResponse.status).toBe(200);
    const finalizeBody = FinalizeResponseSchema.parse(await finalizeResponse.json());
    expect(finalizeBody.objectKey).toBe(
      'products/galleries/artworks/gallery-1/artwork-1/images/195.jpg',
    );
    expect(finalizeBody.publicUrl).toBe(
      `https://artworks.artnet.test/_v/${presignBody.uploadId}/products/galleries/artworks/gallery-1/artwork-1/images/195.jpg`,
    );
  });

  it('finalizes PDB artwork uploads without auction-house context', async () => {
    const { app, storage } = createTestApp();
    const presignResponse = await app.request('/v1/uploads/presign', {
      method: 'POST',
      headers: productJsonHeaders('pdb'),
      body: JSON.stringify(validPdbPresignBody()),
    });
    const presignBody = PresignResponseSchema.parse(await presignResponse.json());
    const objectKey = parseObjectKey(presignBody.objectKey);
    storage.metadataByKey.set(objectKey, {
      contentType: 'image/jpeg',
      size: 1024576,
      updatedAt: new Date('2026-05-08T12:30:00.000Z'),
    });

    const finalizeResponse = await app.request(`/v1/uploads/${presignBody.uploadId}/finalize`, {
      method: 'POST',
      headers: productJsonHeaders('pdb'),
    });

    expect(finalizeResponse.status).toBe(200);
    const finalizeBody = FinalizeResponseSchema.parse(await finalizeResponse.json());
    expect(finalizeBody.objectKey).toBe('products/pdb/artworks/pdb-123/images/195.jpg');
    expect(finalizeBody.publicUrl).toBe(
      `https://artworks.artnet.test/_v/${presignBody.uploadId}/products/pdb/artworks/pdb-123/images/195.jpg`,
    );
  });

  it('still finalizes with replicatedToR2: false when R2 replication fails', async () => {
    const { app, storage, replication } = createTestApp();
    const presignResponse = await app.request('/v1/uploads/presign', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify(validPresignBody()),
    });
    const presignBody = PresignResponseSchema.parse(await presignResponse.json());
    const objectKey = parseObjectKey(presignBody.objectKey);
    storage.metadataByKey.set(objectKey, {
      contentType: 'image/jpeg',
      size: 1024576,
      updatedAt: new Date('2026-05-08T12:30:00.000Z'),
    });
    replication.putError = new UploadFunctionError({
      code: 'r2_unavailable',
      status: 503,
      message: 'Unable to replicate object to R2.',
    });

    const finalizeResponse = await app.request(`/v1/uploads/${presignBody.uploadId}/finalize`, {
      method: 'POST',
      headers: jsonHeaders(),
    });

    expect(finalizeResponse.status).toBe(200);
    const finalizeBody = FinalizeResponseSchema.parse(await finalizeResponse.json());
    expect(finalizeBody.replicatedToR2).toBe(false);
  });

  it('ingests an allowed S3 source object into GCS and R2', async () => {
    const { app, replication, sourceStorage } = createTestApp();
    const sourceUri = 's3://artnet-vendor-feed/scrape-2026-05-08/lot.jpg';
    const objectKey = parseObjectKey('lot_images/425939177/20260310/638775/195.jpg');
    sourceStorage.metadataByUri.set(sourceUri, {
      contentLength: 11,
      contentType: 'image/jpeg',
    });
    sourceStorage.bytesByUri.set(sourceUri, Buffer.from('hello-world'));

    const response = await app.request('/v1/ingest/from-s3', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sourceUri,
        objectKey,
      }),
    });

    expect(response.status).toBe(200);
    const body = IngestFromS3ResponseSchema.parse(await response.json());
    expect(body).toMatchObject({
      objectKey,
      size: 11,
      sha256: createHash('sha256').update('hello-world').digest('hex'),
      contentType: 'image/jpeg',
      sourceUri,
      replicatedToR2: true,
    });
    expect(body.publicUrl).toMatch(
      /^https:\/\/artworks\.artnet\.test\/_v\/[0-9A-HJKMNP-TV-Z]{26}\/lot_images\/425939177\/20260310\/638775\/195\.jpg$/,
    );
    expect(replication.putByKey.get(objectKey)?.cacheVersion).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('allows S3 ingest content type overrides', async () => {
    const { app, sourceStorage } = createTestApp();
    const sourceUri = 's3://artnet-vendor-feed/scrape-2026-05-08/lot.bin';
    const objectKey = parseObjectKey('lot_images/425939177/20260310/638775/195.jpg');
    sourceStorage.metadataByUri.set(sourceUri, {
      contentLength: 5,
      contentType: 'application/octet-stream',
    });
    sourceStorage.bytesByUri.set(sourceUri, Buffer.from('bytes'));

    const response = await app.request('/v1/ingest/from-s3', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sourceUri,
        objectKey,
        contentType: 'image/jpeg',
      }),
    });

    expect(response.status).toBe(200);
    const body = IngestFromS3ResponseSchema.parse(await response.json());
    expect(body.contentType).toBe('image/jpeg');
  });

  it('rejects S3 ingest requests for disallowed source buckets', async () => {
    const { app, sourceStorage } = createTestApp();
    sourceStorage.metadataError = new UploadFunctionError({
      code: 'invalid_source',
      status: 400,
      message: 'sourceUri bucket is not allowed.',
    });

    const response = await app.request('/v1/ingest/from-s3', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sourceUri: 's3://other-bucket/source.jpg',
        objectKey: 'lot_images/425939177/20260310/638775/195.jpg',
      }),
    });

    expect(response.status).toBe(400);
    const body = ErrorResponseSchema.parse(await response.json());
    expect(body.error.code).toBe('invalid_source');
  });

  it('returns source_not_found for missing S3 source objects', async () => {
    const { app, sourceStorage } = createTestApp();
    sourceStorage.metadataError = new UploadFunctionError({
      code: 'source_not_found',
      status: 404,
      message: 'Source object was not found.',
    });

    const response = await app.request('/v1/ingest/from-s3', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sourceUri: 's3://artnet-vendor-feed/missing.jpg',
        objectKey: 'lot_images/425939177/20260310/638775/195.jpg',
      }),
    });

    expect(response.status).toBe(404);
    const body = ErrorResponseSchema.parse(await response.json());
    expect(body.error.code).toBe('source_not_found');
  });

  it('returns upload_not_received when the object is missing from GCS', async () => {
    const { app } = createTestApp();
    const presignResponse = await app.request('/v1/uploads/presign', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify(validPresignBody()),
    });
    const presignBody = PresignResponseSchema.parse(await presignResponse.json());

    const finalizeResponse = await app.request(`/v1/uploads/${presignBody.uploadId}/finalize`, {
      method: 'POST',
      headers: jsonHeaders(),
    });

    expect(finalizeResponse.status).toBe(409);
    const body = ErrorResponseSchema.parse(await finalizeResponse.json());
    expect(body.error.code).toBe('upload_not_received');
  });

  it('returns size_mismatch when uploaded bytes differ from the presign request', async () => {
    const { app, storage } = createTestApp();
    const presignResponse = await app.request('/v1/uploads/presign', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify(validPresignBody()),
    });
    const presignBody = PresignResponseSchema.parse(await presignResponse.json());
    const objectKey = parseObjectKey(presignBody.objectKey);
    storage.metadataByKey.set(objectKey, {
      contentType: 'image/jpeg',
      size: 99,
      updatedAt: new Date('2026-05-08T12:30:00.000Z'),
    });

    const finalizeResponse = await app.request(`/v1/uploads/${presignBody.uploadId}/finalize`, {
      method: 'POST',
      headers: jsonHeaders(),
    });

    expect(finalizeResponse.status).toBe(400);
    const body = ErrorResponseSchema.parse(await finalizeResponse.json());
    expect(body.error.code).toBe('size_mismatch');
    expect(storage.deletedKeys).toEqual([objectKey]);
  });

  it('accepts a finalize when GCS reports a parameterized content type matching the session', async () => {
    const { app, storage } = createTestApp();
    const presignResponse = await app.request('/v1/uploads/presign', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify(validPresignBody()),
    });
    const presignBody = PresignResponseSchema.parse(await presignResponse.json());
    const objectKey = parseObjectKey(presignBody.objectKey);
    storage.metadataByKey.set(objectKey, {
      contentType: 'image/jpeg; charset=binary',
      size: 1024576,
      updatedAt: new Date('2026-05-08T12:30:00.000Z'),
    });

    const finalizeResponse = await app.request(`/v1/uploads/${presignBody.uploadId}/finalize`, {
      method: 'POST',
      headers: jsonHeaders(),
    });

    expect(finalizeResponse.status).toBe(200);
    const finalizeBody = FinalizeResponseSchema.parse(await finalizeResponse.json());
    expect(finalizeBody.contentType).toBe('image/jpeg');
    expect(storage.deletedKeys).toEqual([]);
  });

  it('deletes and rejects uploaded objects when content type differs from the presign request', async () => {
    const { app, storage } = createTestApp();
    const presignResponse = await app.request('/v1/uploads/presign', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify(validPresignBody()),
    });
    const presignBody = PresignResponseSchema.parse(await presignResponse.json());
    const objectKey = parseObjectKey(presignBody.objectKey);
    storage.metadataByKey.set(objectKey, {
      contentType: 'image/png',
      size: 1024576,
      updatedAt: new Date('2026-05-08T12:30:00.000Z'),
    });

    const finalizeResponse = await app.request(`/v1/uploads/${presignBody.uploadId}/finalize`, {
      method: 'POST',
      headers: jsonHeaders(),
    });

    expect(finalizeResponse.status).toBe(400);
    const body = ErrorResponseSchema.parse(await finalizeResponse.json());
    expect(body.error.code).toBe('content_type_mismatch');
    expect(storage.deletedKeys).toEqual([objectKey]);
  });

  it('rejects finalize for a mismatched trusted auction-house context', async () => {
    const { app, storage } = createTestApp();
    const presignResponse = await app.request('/v1/uploads/presign', {
      method: 'POST',
      headers: jsonHeaders({ 'x-artnet-auction-house-id': '425939177' }),
      body: JSON.stringify(validPresignBody()),
    });
    const presignBody = PresignResponseSchema.parse(await presignResponse.json());
    const objectKey = parseObjectKey(presignBody.objectKey);
    storage.metadataByKey.set(objectKey, {
      contentType: 'image/jpeg',
      size: 1024576,
      updatedAt: new Date('2026-05-08T12:30:00.000Z'),
    });

    const finalizeResponse = await app.request(`/v1/uploads/${presignBody.uploadId}/finalize`, {
      method: 'POST',
      headers: jsonHeaders({ 'x-artnet-auction-house-id': 'other-house' }),
    });

    expect(finalizeResponse.status).toBe(403);
    const body = ErrorResponseSchema.parse(await finalizeResponse.json());
    expect(body.error.code).toBe('auction_house_mismatch');
  });

  it('returns storage_unavailable and does not delete the object on transient GCS metadata errors', async () => {
    const { app, storage } = createTestApp();
    const presignResponse = await app.request('/v1/uploads/presign', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify(validPresignBody()),
    });
    const presignBody = PresignResponseSchema.parse(await presignResponse.json());
    storage.metadataError = new UploadFunctionError({
      code: 'storage_unavailable',
      status: 503,
      message: 'Unable to read GCS object metadata.',
      details: { storageCode: 503, storageName: 'GaxiosError' },
    });

    const finalizeResponse = await app.request(`/v1/uploads/${presignBody.uploadId}/finalize`, {
      method: 'POST',
      headers: jsonHeaders(),
    });

    expect(finalizeResponse.status).toBe(503);
    const body = ErrorResponseSchema.parse(await finalizeResponse.json());
    expect(body.error.code).toBe('storage_unavailable');
    expect(body.error.details).toEqual({ storageCode: 503, storageName: 'GaxiosError' });
    expect(storage.deletedKeys).toEqual([]);
  });

  it('cancels an upload session', async () => {
    const { app } = createTestApp();
    const presignResponse = await app.request('/v1/uploads/presign', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify(validPresignBody()),
    });
    const presignBody = PresignResponseSchema.parse(await presignResponse.json());

    const deleteResponse = await app.request(`/v1/uploads/${presignBody.uploadId}`, {
      method: 'DELETE',
      headers: jsonHeaders(),
    });
    expect(deleteResponse.status).toBe(204);

    const finalizeResponse = await app.request(`/v1/uploads/${presignBody.uploadId}/finalize`, {
      method: 'POST',
      headers: jsonHeaders(),
    });
    expect(finalizeResponse.status).toBe(404);
  });

  it('rejects cancel for a mismatched trusted auction-house context', async () => {
    const { app } = createTestApp();
    const presignResponse = await app.request('/v1/uploads/presign', {
      method: 'POST',
      headers: jsonHeaders({ 'x-artnet-auction-house-id': '425939177' }),
      body: JSON.stringify(validPresignBody()),
    });
    const presignBody = PresignResponseSchema.parse(await presignResponse.json());

    const deleteResponse = await app.request(`/v1/uploads/${presignBody.uploadId}`, {
      method: 'DELETE',
      headers: jsonHeaders({ 'x-artnet-auction-house-id': 'other-house' }),
    });

    expect(deleteResponse.status).toBe(403);
    const body = ErrorResponseSchema.parse(await deleteResponse.json());
    expect(body.error.code).toBe('auction_house_mismatch');
  });

  it('deletes a finalized object from R2 + GCS and writes a tombstone', async () => {
    const { app, storage, replication } = createTestApp();
    const objectKey = parseObjectKey('lot_images/425939177/20260310/638775/195.jpg');
    storage.metadataByKey.set(objectKey, {
      contentType: 'image/jpeg',
      size: 1024576,
      updatedAt: new Date('2026-05-08T12:30:00.000Z'),
    });
    replication.putByKey.set(objectKey, {
      objectKey,
      bodyFactory: () => Promise.resolve(Readable.from(Buffer.from('x'))),
      contentType: 'image/jpeg',
      contentLength: 1024576,
    });

    const response = await app.request(`/v1/objects/${objectKey}`, {
      method: 'DELETE',
      headers: jsonHeaders(),
    });

    expect(response.status).toBe(204);
    expect(storage.tombstones.get(objectKey)).toMatchObject({
      objectKey,
      deletedBy: '425939177',
    });
    expect(storage.deletedKeys).toEqual([objectKey]);
    expect(replication.deletedKeys).toEqual([objectKey, ...buildAllWebpVariantKeys(objectKey)]);
    expect(replication.deletedPrefixes).toEqual(buildAllWebpVariantPrefixes(objectKey));
  });

  it('deletes product-prefixed gallery objects without auction-house context', async () => {
    const { app, storage, replication } = createTestApp();
    const objectKey = parseObjectKey(
      'products/galleries/artworks/gallery-1/artwork-1/images/195.jpg',
    );

    const response = await app.request(`/v1/objects/${objectKey}`, {
      method: 'DELETE',
      headers: productJsonHeaders('galleries'),
    });

    expect(response.status).toBe(204);
    expect(storage.tombstones.get(objectKey)).toMatchObject({
      objectKey,
      deletedBy: 'galleries',
    });
    expect(storage.deletedKeys).toEqual([objectKey]);
    expect(replication.deletedKeys).toEqual([objectKey, ...buildAllWebpVariantKeys(objectKey)]);
    expect(replication.deletedPrefixes).toEqual(buildAllWebpVariantPrefixes(objectKey));
  });

  it('rejects delete when the trusted product does not own the object', async () => {
    const { app } = createTestApp();
    const objectKey = parseObjectKey('products/pdb/artworks/pdb-123/images/195.jpg');

    const response = await app.request(`/v1/objects/${objectKey}`, {
      method: 'DELETE',
      headers: productJsonHeaders('galleries'),
    });

    expect(response.status).toBe(403);
    const body = ErrorResponseSchema.parse(await response.json());
    expect(body.error.code).toBe('product_mismatch');
  });

  it('returns 204 on a repeat delete (idempotent)', async () => {
    const { app } = createTestApp();
    const objectKey = parseObjectKey('lot_images/425939177/20260310/638775/195.jpg');

    const first = await app.request(`/v1/objects/${objectKey}`, {
      method: 'DELETE',
      headers: jsonHeaders(),
    });
    const second = await app.request(`/v1/objects/${objectKey}`, {
      method: 'DELETE',
      headers: jsonHeaders(),
    });

    expect(first.status).toBe(204);
    expect(second.status).toBe(204);
  });

  it('rejects delete when the trusted auction-house header is missing', async () => {
    const { app } = createTestApp();
    const response = await app.request(`/v1/objects/lot_images/425939177/20260310/638775/195.jpg`, {
      method: 'DELETE',
      headers: productJsonHeaders('artnet-auctions'),
    });

    expect(response.status).toBe(403);
    const body = ErrorResponseSchema.parse(await response.json());
    expect(body.error.code).toBe('auction_house_required');
  });

  it('rejects delete when the tenant does not own the object', async () => {
    const { app } = createTestApp();
    const response = await app.request(`/v1/objects/lot_images/425939177/20260310/638775/195.jpg`, {
      method: 'DELETE',
      headers: jsonHeaders({ 'x-artnet-auction-house-id': 'other-house' }),
    });

    expect(response.status).toBe(403);
    const body = ErrorResponseSchema.parse(await response.json());
    expect(body.error.code).toBe('auction_house_mismatch');
  });

  it('rejects delete for a malformed objectKey', async () => {
    const { app } = createTestApp();
    const response = await app.request('/v1/objects/not-an-object-key', {
      method: 'DELETE',
      headers: jsonHeaders(),
    });

    expect(response.status).toBe(400);
    const body = ErrorResponseSchema.parse(await response.json());
    expect(body.error.code).toBe('invalid_request');
  });

  it('rejects delete for malformed URL encoding as invalid_request', async () => {
    const { app } = createTestApp();
    const response = await app.request('/v1/objects/%E0%A4%A', {
      method: 'DELETE',
      headers: jsonHeaders(),
    });

    expect(response.status).toBe(400);
    const body = ErrorResponseSchema.parse(await response.json());
    expect(body.error.code).toBe('invalid_request');
  });

  it('surfaces R2 failure as 503 with tombstone intact for retry', async () => {
    const { app, storage, replication } = createTestApp();
    const objectKey = parseObjectKey('lot_images/425939177/20260310/638775/195.jpg');
    replication.deleteError = new UploadFunctionError({
      code: 'r2_unavailable',
      status: 503,
      message: 'Unable to delete object from R2.',
    });

    const response = await app.request(`/v1/objects/${objectKey}`, {
      method: 'DELETE',
      headers: jsonHeaders(),
    });

    expect(response.status).toBe(503);
    const body = ErrorResponseSchema.parse(await response.json());
    expect(body.error.code).toBe('r2_unavailable');
    expect(storage.tombstones.has(objectKey)).toBe(true);
    expect(storage.deletedKeys).toEqual([]);
  });

  it('surfaces tombstone write failure before touching R2 or GCS', async () => {
    const { app, storage, replication } = createTestApp();
    const objectKey = parseObjectKey('lot_images/425939177/20260310/638775/195.jpg');
    storage.tombstoneWriteError = new UploadFunctionError({
      code: 'tombstone_write_failed',
      status: 503,
      message: 'Unable to write tombstone for delete.',
    });

    const response = await app.request(`/v1/objects/${objectKey}`, {
      method: 'DELETE',
      headers: jsonHeaders(),
    });

    expect(response.status).toBe(503);
    const body = ErrorResponseSchema.parse(await response.json());
    expect(body.error.code).toBe('tombstone_write_failed');
    expect(replication.deletedKeys).toEqual([]);
    expect(storage.deletedKeys).toEqual([]);
  });

  it('returns health status when storage is reachable', async () => {
    const { app } = createTestApp();

    const response = await app.request('/v1/health');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('returns r2_unavailable when R2 is unreachable', async () => {
    const { app, replication } = createTestApp();
    replication.healthError = new UploadFunctionError({
      code: 'r2_unavailable',
      status: 503,
      message: 'Configured R2 bucket is not reachable.',
    });

    const response = await app.request('/v1/health');

    expect(response.status).toBe(503);
    const body = ErrorResponseSchema.parse(await response.json());
    expect(body.error.code).toBe('r2_unavailable');
  });
});

const createTestApp = () => {
  const storage = new FakeUploadStorage();
  const replication = new FakeReplicationStorage();
  const sourceStorage = new FakeSourceStorage();
  const app = createUploadFunctionApp({
    publicBaseUrl: 'https://artworks.artnet.test',
    signedUrlTtlSeconds: 900,
    storage,
    replication,
    sourceStorage,
    uploadSessionStore: new InMemoryUploadSessionStore(),
  });

  return { app, storage, replication, sourceStorage };
};

const validPresignBody = () => ({
  kind: 'auction-lot',
  auctionHouseId: '425939177',
  auctionDate: '20260310',
  lotId: '638775',
  imageId: '195',
  imageVariantSuffix: null,
  contentType: 'image/jpeg',
  contentLength: 1024576,
});

const validGalleryPresignBody = () => ({
  kind: 'gallery-artwork',
  galleryId: 'gallery-1',
  artworkId: 'artwork-1',
  imageId: '195',
  imageVariantSuffix: null,
  contentType: 'image/jpeg',
  contentLength: 1024576,
});

const validPdbPresignBody = () => ({
  kind: 'pdb-artwork',
  pdbArtworkId: 'pdb-123',
  imageId: '195',
  imageVariantSuffix: null,
  contentType: 'image/jpeg',
  contentLength: 1024576,
});

const productJsonHeaders = (productId: string, extraHeaders: HeadersInit = {}): HeadersInit => ({
  'content-type': 'application/json',
  'x-artnet-product-id': productId,
  ...extraHeaders,
});

const jsonHeaders = (extraHeaders: HeadersInit = {}): HeadersInit => ({
  'content-type': 'application/json',
  'x-artnet-product-id': 'artnet-auctions',
  'x-artnet-auction-house-id': '425939177',
  ...extraHeaders,
});

class FakeReplicationStorage implements ReplicationStorage {
  public readonly putByKey = new Map<string, ReplicationPutInput>();

  public readonly deletedKeys: string[] = [];

  public readonly deletedPrefixes: string[] = [];

  public putError: UploadFunctionError | undefined = undefined;

  public deleteError: UploadFunctionError | undefined = undefined;

  public healthError: UploadFunctionError | undefined = undefined;

  public put(input: ReplicationPutInput): Promise<void> {
    if (this.putError !== undefined) {
      return Promise.reject(this.putError);
    }
    this.putByKey.set(input.objectKey, input);
    return Promise.resolve();
  }

  public delete(objectKey: string): Promise<void> {
    if (this.deleteError !== undefined) {
      return Promise.reject(this.deleteError);
    }
    this.deletedKeys.push(objectKey);
    this.putByKey.delete(objectKey);
    return Promise.resolve();
  }

  public deleteByPrefix(prefix: string): Promise<void> {
    if (this.deleteError !== undefined) {
      return Promise.reject(this.deleteError);
    }
    this.deletedPrefixes.push(prefix);
    return Promise.resolve();
  }

  public healthCheck(): Promise<void> {
    if (this.healthError !== undefined) {
      return Promise.reject(this.healthError);
    }
    return Promise.resolve();
  }
}

class FakeUploadStorage implements UploadStorage {
  public readonly metadataByKey = new Map<ObjectKey, ObjectMetadata>();

  public readonly deletedKeys: ObjectKey[] = [];

  public metadataError: UploadFunctionError | undefined = undefined;

  public createSignedUploadUrl(input: SignedUploadUrlInput): Promise<SignedUploadUrl> {
    return Promise.resolve({
      uploadUrl: `https://storage.test/${input.objectKey}`,
      contentLengthRange: `${input.contentLength},${input.contentLength}`,
    });
  }

  public deleteObject(objectKey: ObjectKey): Promise<void> {
    this.deletedKeys.push(objectKey);
    this.metadataByKey.delete(objectKey);
    return Promise.resolve();
  }

  public getObjectMetadata(objectKey: ObjectKey): Promise<ObjectMetadata | undefined> {
    if (this.metadataError !== undefined) {
      return Promise.reject(this.metadataError);
    }
    return Promise.resolve(this.metadataByKey.get(objectKey));
  }

  public getObjectStream(objectKey: ObjectKey): Promise<Readable> {
    const bytes = this.bytesByKey.get(objectKey) ?? Buffer.from('fake-bytes');
    return Promise.resolve(Readable.from(bytes));
  }

  public readonly bytesByKey = new Map<ObjectKey, Buffer>();

  public readonly tombstones = new Map<ObjectKey, Tombstone>();

  public tombstoneWriteError: UploadFunctionError | undefined = undefined;

  public healthCheck(): Promise<void> {
    return Promise.resolve();
  }

  public tombstoneExists(objectKey: ObjectKey): Promise<boolean> {
    return Promise.resolve(this.tombstones.has(objectKey));
  }

  public async writeObject(input: WriteObjectInput): Promise<WriteObjectResult> {
    const body = await input.bodyFactory();
    const bytes = await readNodeStream(body);
    this.bytesByKey.set(input.objectKey, bytes);
    this.metadataByKey.set(input.objectKey, {
      contentType: input.contentType,
      size: bytes.byteLength,
      updatedAt: new Date('2026-05-08T12:30:00.000Z'),
    });
    return {
      size: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      uploadedAt: new Date('2026-05-08T12:30:00.000Z'),
    };
  }

  public writeTombstone(objectKey: ObjectKey, tombstone: Tombstone): Promise<void> {
    if (this.tombstoneWriteError !== undefined) {
      return Promise.reject(this.tombstoneWriteError);
    }
    this.tombstones.set(objectKey, tombstone);
    return Promise.resolve();
  }
}

class FakeSourceStorage implements SourceStorage {
  public readonly metadataByUri = new Map<string, S3SourceObjectMetadata>();

  public readonly bytesByUri = new Map<string, Buffer>();

  public metadataError: UploadFunctionError | undefined = undefined;

  public healthError: UploadFunctionError | undefined = undefined;

  public getObjectMetadata(sourceUri: string): Promise<S3SourceObjectMetadata> {
    if (this.metadataError !== undefined) {
      return Promise.reject(this.metadataError);
    }

    const metadata = this.metadataByUri.get(sourceUri);
    if (metadata === undefined) {
      return Promise.reject(
        new UploadFunctionError({
          code: 'source_not_found',
          status: 404,
          message: 'Source object was not found.',
        }),
      );
    }

    return Promise.resolve(metadata);
  }

  public getObjectStream(sourceUri: string): Promise<Readable> {
    const bytes = this.bytesByUri.get(sourceUri);
    if (bytes === undefined) {
      return Promise.reject(
        new UploadFunctionError({
          code: 'source_not_found',
          status: 404,
          message: 'Source object was not found.',
        }),
      );
    }

    return Promise.resolve(Readable.from(bytes));
  }

  public healthCheck(): Promise<void> {
    if (this.healthError !== undefined) {
      return Promise.reject(this.healthError);
    }

    return Promise.resolve();
  }
}

const readNodeStream = async (stream: Readable): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }

  return Buffer.concat(chunks);
};
