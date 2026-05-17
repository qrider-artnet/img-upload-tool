# Server Direct Upload

Use this flow from a backend, CLI, scraper, or internal application that has a local image file and wants to upload it directly.

The running implementation lives in [server-direct-upload.ts](./server-direct-upload.ts).

Run it:

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

The example uploads an `auction-lot`, so it sends `X-Artnet-Product-Id: artnet-auctions` on every `/v1/uploads/*` request and also sends `X-Artnet-Auction-House-Id`. In production, an API gateway sets these trusted headers authoritatively after stripping any client-supplied values. The server example passes them through directly for local dev.
