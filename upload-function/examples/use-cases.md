# Upload Function Use Cases

These examples are reference integrations for each supported caller shape. In production, the
trusted headers shown here are injected by the internal gateway or caller boundary, not by an
untrusted browser.

## 1. Auction-Lot Direct Upload

Used by auction-house user flows and the future upload widget.

```typescript
import { uploadAuctionLotImage } from './use-cases.js';

const response = await uploadAuctionLotImage({
  endpoint: 'https://upload-function.example.com',
  file: {
    body: file,
    contentType: 'image/jpeg',
    contentLength: file.size,
  },
  auctionHouseId: '425939177',
  auctionDate: '20260310',
  lotId: '638775',
  imageId: '195',
  imageVariantSuffix: null,
});
```

The Upload Function stores:

```text
products/artnet-auctions/auction-lots/425939177/20260310/638775/images/195.jpg
```

Use `imageVariantSuffix: '_1'`, `'_2'`, and so on for additional images.

## 2. Gallery Artwork Direct Upload

Used by the galleries product.

```typescript
import { uploadGalleryArtworkImage } from './use-cases.js';

const response = await uploadGalleryArtworkImage({
  endpoint: 'https://upload-function.example.com',
  file: {
    body: file,
    contentType: 'image/png',
    contentLength: file.size,
  },
  galleryId: 'gallery-1',
  artworkId: 'artwork-1',
  imageId: 'primary',
  imageVariantSuffix: null,
});
```

The Upload Function stores:

```text
products/galleries/artworks/gallery-1/artwork-1/images/primary.png
```

## 3. PDB Artwork Direct Upload

Used by PDB artwork image flows.

```typescript
import { uploadPdbArtworkImage } from './use-cases.js';

const response = await uploadPdbArtworkImage({
  endpoint: 'https://upload-function.example.com',
  file: {
    body: file,
    contentType: 'image/webp',
    contentLength: file.size,
  },
  pdbArtworkId: 'pdb-123',
  imageId: '195',
  imageVariantSuffix: null,
});
```

The Upload Function stores:

```text
products/pdb/artworks/pdb-123/images/195.webp
```

## 4. Vendor Scraper S3 Ingest

Used when the source image already exists in an allowlisted S3-compatible bucket.

```typescript
import { ingestAuctionLotImageFromS3 } from './use-cases.js';

const response = await ingestAuctionLotImageFromS3({
  endpoint: 'https://upload-function.example.com',
  sourceUri: 's3://artnet-vendor-feed/scrape-2026-05-08/425939177/lot-638775-img-1.jpg',
  auctionHouseId: '425939177',
  auctionDate: '20260310',
  lotId: '638775',
  imageId: '195',
  imageVariantSuffix: null,
  contentType: 'image/jpeg',
});
```

The response includes `sha256` because this path streams the bytes through the function.

## 5. Delete Finalized Image

The caller should update its own database first, then call delete for storage cleanup.

```typescript
import { deleteAuctionLotObject } from './use-cases.js';

await deleteAuctionLotObject({
  endpoint: 'https://upload-function.example.com',
  auctionHouseId: '425939177',
  objectKey: 'products/artnet-auctions/auction-lots/425939177/20260310/638775/images/195.jpg',
});
```

Delete writes a GCS tombstone, removes the R2 original, removes persisted WebP variants, then
removes the GCS original.

## 6. Render Image URLs

Finalize and ingest both return a cache-versioned `publicUrl`. Use it directly for the original or
add a fixed Variant Worker query parameter.

```typescript
import { buildImageReadUrls } from './use-cases.js';

const urls = buildImageReadUrls(response.publicUrl);

image.src = urls.w640;
thumbnail.src = urls.thumb;
```

The Variant Worker supports:

```text
thumb
w320
w640
w960
w1280
w1600
medium  -> w640
large   -> w1600
```
