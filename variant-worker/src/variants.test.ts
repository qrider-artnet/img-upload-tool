import { describe, expect, it } from 'vitest';

import { parseObjectKey } from './object-key.js';
import { parseImageRequest } from './request.js';
import { buildVariantKey, getVariantSpec, parseVariant } from './variants.js';

const OBJECT_KEY = 'lot_images/425939177/20260310/638775/195.jpg';
const PRODUCT_AUCTION_OBJECT_KEY =
  'products/artnet-auctions/auction-lots/425939177/20260310/638775/images/195.jpg';

describe('variant contract helpers', () => {
  it('validates canonical object keys', () => {
    expect(parseObjectKey(OBJECT_KEY)).toBe(OBJECT_KEY);
    expect(parseObjectKey('products/galleries/artworks/gallery-1/artwork-1/images/195.jpg')).toBe(
      'products/galleries/artworks/gallery-1/artwork-1/images/195.jpg',
    );
    expect(parseObjectKey(PRODUCT_AUCTION_OBJECT_KEY)).toBe(PRODUCT_AUCTION_OBJECT_KEY);
    expect(parseObjectKey('products/pdb/artworks/pdb-123/images/195.jpg')).toBe(
      'products/pdb/artworks/pdb-123/images/195.jpg',
    );
    expect(() => parseObjectKey('variants/webp/w640/lot_images/425939177/x.webp')).toThrow();
    expect(() => parseObjectKey('lot_images/425939177/20260310/638775/195.gif')).toThrow();
  });

  it('maps compatibility aliases to fixed WebP variants', () => {
    expect(parseVariant('medium')).toBe('w640');
    expect(parseVariant('large')).toBe('w1600');
    expect(parseVariant('thumb')).toBe('thumb');
    expect(() => parseVariant('tiny')).toThrow();
  });

  it('defines fixed transformation settings', () => {
    expect(getVariantSpec('thumb')).toEqual({
      name: 'thumb',
      transform: { width: 150, height: 150, fit: 'cover' },
      quality: 70,
    });
    expect(getVariantSpec('w1280')).toEqual({
      name: 'w1280',
      transform: { width: 1280, fit: 'scale-down' },
      quality: 82,
    });
  });

  it('generates the persisted R2 variant key', () => {
    expect(buildVariantKey(parseObjectKey(OBJECT_KEY), 'w640')).toBe(
      'variants/webp/w640/lot_images/425939177/20260310/638775/195.webp',
    );
    expect(buildVariantKey(parseObjectKey(OBJECT_KEY), 'w640', '01ARZ3NDEKTSV4RRFFQ69G5FAV')).toBe(
      'variants/webp/w640/lot_images/425939177/20260310/638775/195/_v/01ARZ3NDEKTSV4RRFFQ69G5FAV.webp',
    );
    expect(
      buildVariantKey(
        parseObjectKey('products/pdb/artworks/pdb-123/images/195.jpg'),
        'w640',
        '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      ),
    ).toBe(
      'variants/webp/w640/products/pdb/artworks/pdb-123/images/195/_v/01ARZ3NDEKTSV4RRFFQ69G5FAV.webp',
    );
    expect(
      buildVariantKey(parseObjectKey('lot_images/425939177/20260310/638775/195.png'), 'thumb'),
    ).toBe('variants/webp/thumb/lot_images/425939177/20260310/638775/195.webp');
  });

  it('parses valid image URLs', () => {
    expect(parseImageRequest(new Request(`https://artworks.test/${OBJECT_KEY}`))).toEqual({
      objectKey: OBJECT_KEY,
    });
    expect(
      parseImageRequest(new Request(`https://artworks.test/${OBJECT_KEY}?variant=medium`)),
    ).toEqual({
      objectKey: OBJECT_KEY,
      variant: 'w640',
    });
    expect(
      parseImageRequest(
        new Request(
          `https://artworks.test/_v/01ARZ3NDEKTSV4RRFFQ69G5FAV/${OBJECT_KEY}?variant=w960`,
        ),
      ),
    ).toEqual({
      objectKey: OBJECT_KEY,
      cacheVersion: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      variant: 'w960',
    });
    expect(
      parseImageRequest(
        new Request(
          'https://artworks.test/products/galleries/artworks/gallery-1/artwork-1/images/195.jpg?variant=w640',
        ),
      ),
    ).toEqual({
      objectKey: 'products/galleries/artworks/gallery-1/artwork-1/images/195.jpg',
      variant: 'w640',
    });
  });

  it('rewrites legacy i/o jpg paths to persisted variants', () => {
    expect(
      parseImageRequest(
        new Request(
          'https://artworks.test/_v/01ARZ3NDEKTSV4RRFFQ69G5FAV/lot_images/425939177/20260310/638775/195i.jpg',
        ),
      ),
    ).toEqual({
      objectKey: OBJECT_KEY,
      cacheVersion: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      variant: 'thumb',
    });
    expect(
      parseImageRequest(
        new Request('https://artworks.test/lot_images/425939177/20260310/638775/195o.jpg'),
      ),
    ).toEqual({
      objectKey: OBJECT_KEY,
      variant: 'w1600',
    });
    expect(
      parseImageRequest(
        new Request('https://artworks.test/lot_images/425939177/20260310/638775/195_1o.jpg'),
      ),
    ).toEqual({
      objectKey: 'lot_images/425939177/20260310/638775/195_1.jpg',
      variant: 'w1600',
    });
    expect(
      parseImageRequest(
        new Request(
          'https://artworks.test/products/artnet-auctions/auction-lots/425939177/20260310/638775/images/195i.jpg',
        ),
      ),
    ).toEqual({
      objectKey: PRODUCT_AUCTION_OBJECT_KEY,
      variant: 'thumb',
    });
    expect(
      parseImageRequest(
        new Request(
          'https://artworks.test/products/galleries/artworks/gallery-1/artwork-1/images/195i.jpg',
        ),
      ),
    ).toEqual({
      objectKey: 'products/galleries/artworks/gallery-1/artwork-1/images/195i.jpg',
    });
  });

  it('rejects unsupported query params and duplicate variant params', () => {
    expect(() =>
      parseImageRequest(new Request(`https://artworks.test/${OBJECT_KEY}?w=640`)),
    ).toThrow();
    expect(() =>
      parseImageRequest(
        new Request(`https://artworks.test/${OBJECT_KEY}?variant=w640&variant=w960`),
      ),
    ).toThrow();
  });

  it('rejects ambiguous legacy paths with explicit variant params', () => {
    expect(() =>
      parseImageRequest(
        new Request(
          'https://artworks.test/lot_images/425939177/20260310/638775/195i.jpg?variant=w640',
        ),
      ),
    ).toThrow();
  });
});
