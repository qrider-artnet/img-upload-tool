import { describe, it } from 'vitest';

// S3 ingest (Mode B) e2e requires the mock vendor source bucket
// (artnet-mock-vendor-feed) to exist and be reachable via the Upload Function's
// S3_SOURCE_* config. That bucket is not provisioned yet (see
// docs/design/test-harness-and-e2e.md §9), so these scenarios are recorded here
// and skipped until it is seeded.
describe.skip('e2e: S3 ingest (Mode B) — needs the mock vendor bucket', () => {
  it.todo('ingests an object from the mock bucket and replicates to R2 (returns sha256)');
  it.todo('rejects a source bucket outside the allowlist (invalid_source)');
  it.todo('returns source_not_found for a missing source object');
});
