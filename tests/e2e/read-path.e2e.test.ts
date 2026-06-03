import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { deleteObject, uniqueImageId, uploadSampleImage } from './lib/client.js';
import { accessHeaders, hasAccessServiceToken } from './lib/config.js';

// The read path (artworks.artnet-dev.com) is behind Cloudflare Access. Without a
// service token these tests skip rather than fail — set CF_ACCESS_CLIENT_ID /
// CF_ACCESS_CLIENT_SECRET to run them. See docs/design/test-harness-and-e2e.md §7.
const describeReadPath = hasAccessServiceToken() ? describe : describe.skip;

describeReadPath('e2e: read path (Variant Worker, requires CF Access service token)', () => {
  let publicUrl = '';
  let objectKey = '';

  beforeAll(async () => {
    const result = await uploadSampleImage(uniqueImageId());
    publicUrl = result.publicUrl;
    objectKey = result.objectKey;
  });

  afterAll(async () => {
    if (objectKey !== '') {
      await deleteObject(objectKey).catch(() => undefined);
    }
  });

  it('serves the original image', async () => {
    const response = await fetch(publicUrl, { headers: accessHeaders() });
    await response.arrayBuffer();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
  });

  it('serves a WebP variant and reports cache-status headers', async () => {
    const variantUrl = `${publicUrl}?variant=w640`;

    const first = await fetch(variantUrl, { headers: accessHeaders() });
    await first.arrayBuffer();
    expect(first.status).toBe(200);
    expect(first.headers.get('content-type')).toBe('image/webp');
    expect(first.headers.get('x-cache')).toBeTypeOf('string');
    expect(['edge', 'r2', 'images']).toContain(first.headers.get('x-cache-source'));

    // The variant is now persisted in R2 and/or edge-cached, so a follow-up must
    // not regenerate it (source is r2 or edge, never images). This is colo-
    // independent, unlike asserting an edge HIT specifically.
    const second = await fetch(variantUrl, { headers: accessHeaders() });
    await second.arrayBuffer();
    expect(second.status).toBe(200);
    expect(['edge', 'r2']).toContain(second.headers.get('x-cache-source'));
  });

  it('rejects an unsupported variant size', async () => {
    const response = await fetch(`${publicUrl}?variant=w500`, { headers: accessHeaders() });
    await response.arrayBuffer();

    expect(response.status).toBe(400);
  });
});
