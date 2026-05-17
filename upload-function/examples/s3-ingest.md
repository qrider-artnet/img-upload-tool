# S3-Compatible Source Ingest

This is the future single-call server-side flow for cases where the source image already lives in an S3-compatible bucket, such as vendor scraper output or a mock R2 bucket.

This endpoint is not implemented in stage 1.

Planned request:

```typescript
interface S3IngestRequest {
  sourceUri: string;
  objectKey: string;
  contentType?: 'image/jpeg' | 'image/png' | 'image/webp';
}

interface S3IngestResponse {
  objectKey: string;
  publicUrl: string;
  size: number;
  sha256: string;
  contentType: string;
  sourceUri: string;
  uploadedAt: string;
  replicatedToR2: boolean;
}

const ingestLotImageFromS3 = async (input: {
  endpoint: string;
  sourceUri: string;
  objectKey: string;
  contentType?: 'image/jpeg' | 'image/png' | 'image/webp';
}): Promise<S3IngestResponse> => {
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };

  const response = await fetch(`${input.endpoint}/v1/ingest/from-s3`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      sourceUri: input.sourceUri,
      objectKey: input.objectKey,
      contentType: input.contentType,
    } satisfies S3IngestRequest),
  });

  if (!response.ok) {
    throw new Error(`S3 ingest failed: ${await response.text()}`);
  }

  return (await response.json()) as S3IngestResponse;
};
```

Example payload:

```json
{
  "sourceUri": "s3://artnet-vendor-feed/scrape-2026-05-08/425939177/lot-638775-img-1.jpg",
  "objectKey": "products/artnet-auctions/auction-lots/425939177/20260310/638775/images/195.jpg",
  "contentType": "image/jpeg"
}
```

This is the best fit when a developer wants one Upload Function call and does not need browser direct upload.
