import { describe, expect, it } from 'vitest';

import { config } from './lib/config.js';
import { errorCode } from './lib/json.js';

describe('e2e: health', () => {
  it('GET /v1/health is reachable and returns a structured response', async () => {
    const response = await fetch(`${config.uploadFunctionUrl}/v1/health`);
    const body: unknown = await response.json();

    // 200 when GCS, R2, the S3 source, and the session store are all reachable.
    // The QA environment currently returns 502 source_unavailable because the S3
    // ingest source (the mock vendor bucket) is not provisioned yet — that does
    // not affect the direct-upload path. See docs/design/test-harness-and-e2e.md.
    expect([200, 502]).toContain(response.status);
    if (response.status === 502) {
      expect(errorCode(body)).toBe('source_unavailable');
    }
  });
});
