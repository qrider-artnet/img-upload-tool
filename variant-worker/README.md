# Variant Worker

Cloudflare Worker that serves canonical lot-image originals from R2 and persists fixed WebP
variants back into the same bucket on first request.

## Commands

```bash
npm install
npm run check
npm run test
npm run build
npm run dev
```

## Bindings

- `R2_PRIMARY` — R2 bucket containing originals and persisted generated variants.
- `IMAGES` — Cloudflare Images binding used for stream-based transformations.

## URL Contract

```text
GET /lot_images/<auctionHouseId>/<auctionDate>/<lotId>/<imageId>.<ext>
GET /lot_images/<auctionHouseId>/<auctionDate>/<lotId>/<imageId>.<ext>?variant=thumb
GET /lot_images/<auctionHouseId>/<auctionDate>/<lotId>/<imageId>.<ext>?variant=w320
GET /lot_images/<auctionHouseId>/<auctionDate>/<lotId>/<imageId>.<ext>?variant=w640
GET /lot_images/<auctionHouseId>/<auctionDate>/<lotId>/<imageId>.<ext>?variant=w960
GET /lot_images/<auctionHouseId>/<auctionDate>/<lotId>/<imageId>.<ext>?variant=w1280
GET /lot_images/<auctionHouseId>/<auctionDate>/<lotId>/<imageId>.<ext>?variant=w1600
GET /_v/<cacheVersion>/lot_images/<auctionHouseId>/<auctionDate>/<lotId>/<imageId>.<ext>
GET /_v/<cacheVersion>/lot_images/<auctionHouseId>/<auctionDate>/<lotId>/<imageId>.<ext>?variant=w640
```

Compatibility aliases:

- `variant=medium` maps to `w640`
- `variant=large` maps to `w1600`

Legacy paths are rewritten before lookup:

- `/lot_images/<...>/<imageId>i.jpg` maps to `/lot_images/<...>/<imageId>.jpg?variant=thumb`
- `/lot_images/<...>/<imageId>o.jpg` maps to `/lot_images/<...>/<imageId>.jpg?variant=large`

Generated variants are stored as:

```text
variants/webp/<variant>/<objectKey-with-webp-extension>
variants/webp/<variant>/<objectKey-without-extension>/_v/<cacheVersion>.webp
```
