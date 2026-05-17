import { describe, expect, it } from 'vitest';

import { UploadFunctionError } from './errors.js';
import { buildObjectKey, parseObjectKey } from './object-key.js';

describe('buildObjectKey', () => {
  it('builds gallery artwork object keys', () => {
    const objectKey = buildObjectKey({
      entity: {
        kind: 'gallery-artwork',
        galleryId: 'gallery-1',
        artworkId: 'artwork-1',
      },
      imageId: '195',
      imageVariantSuffix: null,
      contentType: 'image/jpeg',
    });

    expect(objectKey).toBe('products/galleries/artworks/gallery-1/artwork-1/images/195.jpg');
  });

  it('builds auction lot object keys', () => {
    const objectKey = buildObjectKey({
      entity: {
        kind: 'auction-lot',
        auctionHouseId: '425939177',
        auctionDate: '20260310',
        lotId: '638775',
      },
      imageId: '195',
      imageVariantSuffix: '_2',
      contentType: 'image/webp',
    });

    expect(objectKey).toBe(
      'products/artnet-auctions/auction-lots/425939177/20260310/638775/images/195_2.webp',
    );
  });

  it('builds PDB artwork object keys', () => {
    const objectKey = buildObjectKey({
      entity: {
        kind: 'pdb-artwork',
        pdbArtworkId: 'pdb-123',
      },
      imageId: '195',
      imageVariantSuffix: null,
      contentType: 'image/png',
    });

    expect(objectKey).toBe('products/pdb/artworks/pdb-123/images/195.png');
  });

  it('rejects path traversal segments', () => {
    expect(() =>
      buildObjectKey({
        entity: {
          kind: 'auction-lot',
          auctionHouseId: '425939177',
          auctionDate: '20260310',
          lotId: '../638775',
        },
        imageId: '195',
        imageVariantSuffix: null,
        contentType: 'image/png',
      }),
    ).toThrow(UploadFunctionError);
  });
});

describe('parseObjectKey', () => {
  it('brands valid product-prefixed canonical object keys', () => {
    expect(parseObjectKey('products/galleries/artworks/gallery-1/artwork-1/images/195.jpg')).toBe(
      'products/galleries/artworks/gallery-1/artwork-1/images/195.jpg',
    );
    expect(
      parseObjectKey(
        'products/artnet-auctions/auction-lots/425939177/20260310/638775/images/195.png',
      ),
    ).toBe('products/artnet-auctions/auction-lots/425939177/20260310/638775/images/195.png');
    expect(parseObjectKey('products/pdb/artworks/pdb-123/images/195.webp')).toBe(
      'products/pdb/artworks/pdb-123/images/195.webp',
    );
  });

  it('preserves legacy lot_images support', () => {
    expect(parseObjectKey('lot_images/425939177/20260310/638775/195.png')).toBe(
      'lot_images/425939177/20260310/638775/195.png',
    );
  });

  it('rejects keys outside the canonical layout', () => {
    expect(() => parseObjectKey('other/425939177/20260310/638775/195.png')).toThrow(
      UploadFunctionError,
    );
  });
});
