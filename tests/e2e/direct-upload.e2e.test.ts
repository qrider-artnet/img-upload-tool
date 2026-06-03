import { afterAll, describe, expect, it } from 'vitest';

import { deleteObject, finalize, presign, uniqueImageId, uploadSampleImage } from './lib/client.js';
import { sampleJpeg } from './lib/image.js';
import { errorCode } from './lib/json.js';

describe('e2e: direct upload (Mode A)', () => {
  const createdKeys: string[] = [];

  afterAll(async () => {
    // Best-effort cleanup; staging/uploads + tombstone lifecycle rules also expire.
    await Promise.all(createdKeys.map((key) => deleteObject(key).catch(() => undefined)));
  });

  it('uploads, finalizes, and replicates to R2', async () => {
    const result = await uploadSampleImage(uniqueImageId());
    createdKeys.push(result.objectKey);

    expect(result.objectKey).toMatch(
      /^products\/artnet-auctions\/auction-lots\/425939177\/20260310\/638775\/images\/e2e-[0-9a-f]{8}\.jpg$/,
    );
    expect(result.replicatedToR2).toBe(true);

    const publicUrl = new URL(result.publicUrl);
    expect(publicUrl.hostname).toBe('artworks.artnet-dev.com');
    expect(publicUrl.pathname).toContain('/_v/');
  });

  it('rejects an unsupported content type at presign', async () => {
    const response = await presign(uniqueImageId(), sampleJpeg().byteLength, {
      contentType: 'image/gif',
    });

    expect(response.status).toBe(400);
    expect(errorCode(response.body)).toBe('unsupported_content_type');
  });

  it('rejects presign without the product gateway header', async () => {
    const response = await presign(uniqueImageId(), sampleJpeg().byteLength, {
      headers: { 'X-Artnet-Auction-House-Id': '425939177' },
    });

    expect(response.status).toBe(403);
    expect(errorCode(response.body)).toBe('product_required');
  });

  it('returns upload_session_not_found when finalizing an unknown upload', async () => {
    const response = await finalize('01ARZ3NDEKTSV4RRFFQ69G5FAV');

    expect(response.status).toBe(404);
    expect(errorCode(response.body)).toBe('upload_session_not_found');
  });
});
