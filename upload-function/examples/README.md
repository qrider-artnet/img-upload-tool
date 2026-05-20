# Upload Function Examples

These examples show how callers integrate with the Upload Function.

- Direct upload from a browser or server application:

  ```text
  POST /v1/uploads/presign
  PUT bytes to the returned GCS signed URL
  POST /v1/uploads/:uploadId/finalize
  ```

- S3-compatible source ingest:

  ```text
  POST /v1/ingest/from-s3
  ```

## Files

- [browser-direct-upload.html](./browser-direct-upload.html) and [browser-direct-upload.ts](./browser-direct-upload.ts) - runnable browser flow using `File`, `fetch`, and Web Crypto.
- [server-direct-upload.ts](./server-direct-upload.ts) - runnable backend/server CLI using Node 22, `fetch`, and `node:crypto`.
- [curl-direct-upload.md](./curl-direct-upload.md) - manual smoke-test flow with curl.
- [s3-ingest.md](./s3-ingest.md) - single-call S3/R2 source ingest flow.

## Build Examples

```bash
npm run examples:build
```

The browser HTML loads the compiled module from `examples/dist/browser-direct-upload.js`.

## Run Browser Example

1. Start the Upload Function:

   ```bash
   npm run dev
   ```

2. Build examples:

   ```bash
   npm run examples:build
   ```

3. Open [browser-direct-upload.html](./browser-direct-upload.html) in a browser.

The function must be configured with a real dev GCS bucket because the example uploads to the signed GCS URL returned by `presign`.

## Run Server Example

The CLI accepts either flags or environment variables.

```bash
npm run examples:server -- \
  --endpoint http://localhost:8080 \
  --file ./sample.jpg \
  --content-type image/jpeg \
  --auction-house-id 425939177 \
  --auction-date 20260310 \
  --lot-id 638775 \
  --image-id 195
```

Equivalent environment variables:

```bash
UPLOAD_FUNCTION_ENDPOINT=http://localhost:8080 \
UPLOAD_FILE=./sample.jpg \
UPLOAD_CONTENT_TYPE=image/jpeg \
UPLOAD_AUCTION_HOUSE_ID=425939177 \
UPLOAD_AUCTION_DATE=20260310 \
UPLOAD_LOT_ID=638775 \
UPLOAD_IMAGE_ID=195 \
npm run examples:server
```

## Gateway Assumption

The Upload Function assumes an API gateway handles authentication and admission before requests reach the function.

The gateway must inject a trusted product context for upload and delete calls:

```text
X-Artnet-Product-Id: galleries | artnet-auctions | pdb
```

For `auction-lot` uploads, the gateway must also inject:

```text
X-Artnet-Auction-House-Id: 425939177
```

The function verifies `X-Artnet-Product-Id` against the request/session entity kind. For auction lots, it also verifies `X-Artnet-Auction-House-Id` against the request/session auction house. Browsers should generally not be trusted to provide these headers directly unless the gateway strips and replaces client-supplied values.
