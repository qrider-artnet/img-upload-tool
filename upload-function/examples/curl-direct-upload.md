# curl Direct Upload

This is useful for smoke testing the direct upload flow locally.

Set inputs:

```bash
ENDPOINT="http://localhost:8080"
FILE="./sample.jpg"
CONTENT_TYPE="image/jpeg"
CONTENT_LENGTH="$(wc -c < "$FILE" | tr -d ' ')"
```

Presign:

```bash
curl -sS -X POST "$ENDPOINT/v1/uploads/presign" \
  -H "Content-Type: application/json" \
  -H "X-Artnet-Product-Id: artnet-auctions" \
  -H "X-Artnet-Auction-House-Id: 425939177" \
  -d "{
    \"kind\": \"auction-lot\",
    \"auctionHouseId\": \"425939177\",
    \"auctionDate\": \"20260310\",
    \"lotId\": \"638775\",
    \"imageId\": \"195\",
    \"imageVariantSuffix\": null,
    \"contentType\": \"$CONTENT_TYPE\",
    \"contentLength\": $CONTENT_LENGTH
  }"
```

Upload to the returned `uploadUrl`. Pass every header from the presign response's `uploadHeaders` — they are part of the v4 signature:

```bash
curl -sS -X PUT "<uploadUrl-from-presign-response>" \
  -H "Content-Type: $CONTENT_TYPE" \
  -H "Content-Length: $CONTENT_LENGTH" \
  -H "X-Goog-Content-Length-Range: $CONTENT_LENGTH,$CONTENT_LENGTH" \
  --data-binary "@$FILE"
```

Finalize:

```bash
curl -sS -X POST "$ENDPOINT/v1/uploads/<uploadId-from-presign-response>/finalize" \
  -H "X-Artnet-Product-Id: artnet-auctions" \
  -H "X-Artnet-Auction-House-Id: 425939177"
```

Cancel an unused upload session:

```bash
curl -sS -X DELETE "$ENDPOINT/v1/uploads/<uploadId-from-presign-response>" \
  -H "X-Artnet-Product-Id: artnet-auctions" \
  -H "X-Artnet-Auction-House-Id: 425939177"
```
