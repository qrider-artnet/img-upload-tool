import { UploadFunctionError } from './errors.js';
import type { AllowedContentType, ObjectKey } from './types.js';

const PATH_SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/;
const VARIANT_SUFFIX_PATTERN = /^_[1-9][0-9]*$/;
const IMAGE_FILENAME_PATTERN = /^[A-Za-z0-9_-]+(?:_[1-9][0-9]*)?\.(?:jpg|png|webp)$/;
const LEGACY_OBJECT_KEY_PATTERN =
  /^lot_images\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+(?:_[1-9][0-9]*)?\.(?:jpg|png|webp)$/;

const extensionByContentType: Record<AllowedContentType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export const PRODUCT_IDS = ['galleries', 'artnet-auctions', 'pdb'] as const;

export type ProductId = (typeof PRODUCT_IDS)[number];

export type EntityKind = 'gallery-artwork' | 'auction-lot' | 'pdb-artwork';

export type ObjectKeyDetails =
  | {
      readonly layout: 'product';
      readonly productId: 'galleries';
      readonly kind: 'gallery-artwork';
      readonly galleryId: string;
      readonly artworkId: string;
    }
  | {
      readonly layout: 'product';
      readonly productId: 'artnet-auctions';
      readonly kind: 'auction-lot';
      readonly auctionHouseId: string;
      readonly auctionDate: string;
      readonly lotId: string;
    }
  | {
      readonly layout: 'product';
      readonly productId: 'pdb';
      readonly kind: 'pdb-artwork';
      readonly pdbArtworkId: string;
    }
  | {
      readonly layout: 'legacy';
      readonly productId: 'artnet-auctions';
      readonly kind: 'auction-lot';
      readonly auctionHouseId: string;
      readonly auctionDate: string;
      readonly lotId: string;
    };

export type EntityInput =
  | {
      readonly kind: 'gallery-artwork';
      readonly galleryId: string;
      readonly artworkId: string;
    }
  | {
      readonly kind: 'auction-lot';
      readonly auctionHouseId: string;
      readonly auctionDate: string;
      readonly lotId: string;
    }
  | {
      readonly kind: 'pdb-artwork';
      readonly pdbArtworkId: string;
    };

/**
 * Input fields used to derive a canonical storage object key.
 */
export interface BuildObjectKeyInput {
  readonly entity: EntityInput;
  readonly imageId: string;
  readonly imageVariantSuffix: string | null;
  readonly contentType: AllowedContentType;
}

/**
 * Builds a canonical storage key from validated upload request fields.
 */
export const buildObjectKey = (input: BuildObjectKeyInput): ObjectKey => {
  validatePathSegment('imageId', input.imageId);
  validateImageVariantSuffix(input.imageVariantSuffix);

  const suffix = input.imageVariantSuffix ?? '';
  const extension = extensionByContentType[input.contentType];
  const filename = `${input.imageId}${suffix}.${extension}`;
  const objectKey = buildObjectKeyString(input.entity, filename);

  return parseObjectKey(objectKey);
};

/**
 * Validates and brands a canonical object key.
 */
export const parseObjectKey = (value: string): ObjectKey => {
  parseObjectKeyDetails(value);
  return value as ObjectKey;
};

/**
 * Parses a validated object key into the product/entity authorization context.
 */
export const parseObjectKeyDetails = (value: string): ObjectKeyDetails => {
  const segments = value.split('/');

  if (segments[0] === 'products') {
    return parseProductObjectKey(segments);
  }

  if (LEGACY_OBJECT_KEY_PATTERN.test(value)) {
    const [, auctionHouseId, auctionDate, lotId] = segments;
    if (auctionHouseId !== undefined && auctionDate !== undefined && lotId !== undefined) {
      return {
        layout: 'legacy',
        productId: 'artnet-auctions',
        kind: 'auction-lot',
        auctionHouseId,
        auctionDate,
        lotId,
      };
    }
  }

  throw invalidObjectKeyError();
};

export const productIdForEntityKind = (kind: EntityKind): ProductId => {
  switch (kind) {
    case 'gallery-artwork':
      return 'galleries';
    case 'auction-lot':
      return 'artnet-auctions';
    case 'pdb-artwork':
      return 'pdb';
  }
};

export const isProductId = (value: string): value is ProductId =>
  PRODUCT_IDS.some((productId) => productId === value);

const buildObjectKeyString = (entity: EntityInput, filename: string): string => {
  switch (entity.kind) {
    case 'gallery-artwork':
      validatePathSegment('galleryId', entity.galleryId);
      validatePathSegment('artworkId', entity.artworkId);
      return `products/galleries/artworks/${entity.galleryId}/${entity.artworkId}/images/${filename}`;
    case 'auction-lot':
      validatePathSegment('auctionHouseId', entity.auctionHouseId);
      validatePathSegment('auctionDate', entity.auctionDate);
      validatePathSegment('lotId', entity.lotId);
      return `products/artnet-auctions/auction-lots/${entity.auctionHouseId}/${entity.auctionDate}/${entity.lotId}/images/${filename}`;
    case 'pdb-artwork':
      validatePathSegment('pdbArtworkId', entity.pdbArtworkId);
      return `products/pdb/artworks/${entity.pdbArtworkId}/images/${filename}`;
  }
};

const parseProductObjectKey = (segments: string[]): ObjectKeyDetails => {
  const [, productId] = segments;

  if (productId === 'galleries') {
    const [, , entityNamespace, galleryId, artworkId, imagesSegment, filename] = segments;
    if (
      segments.length === 7 &&
      entityNamespace === 'artworks' &&
      galleryId !== undefined &&
      artworkId !== undefined &&
      imagesSegment === 'images' &&
      isValidPathSegment(galleryId) &&
      isValidPathSegment(artworkId) &&
      isValidImageFilename(filename)
    ) {
      return {
        layout: 'product',
        productId,
        kind: 'gallery-artwork',
        galleryId,
        artworkId,
      };
    }
  }

  if (productId === 'artnet-auctions') {
    const [, , entityNamespace, auctionHouseId, auctionDate, lotId, imagesSegment, filename] =
      segments;
    if (
      segments.length === 8 &&
      entityNamespace === 'auction-lots' &&
      auctionHouseId !== undefined &&
      auctionDate !== undefined &&
      lotId !== undefined &&
      imagesSegment === 'images' &&
      isValidPathSegment(auctionHouseId) &&
      isValidPathSegment(auctionDate) &&
      isValidPathSegment(lotId) &&
      isValidImageFilename(filename)
    ) {
      return {
        layout: 'product',
        productId,
        kind: 'auction-lot',
        auctionHouseId,
        auctionDate,
        lotId,
      };
    }
  }

  if (productId === 'pdb') {
    const [, , entityNamespace, pdbArtworkId, imagesSegment, filename] = segments;
    if (
      segments.length === 6 &&
      entityNamespace === 'artworks' &&
      pdbArtworkId !== undefined &&
      imagesSegment === 'images' &&
      isValidPathSegment(pdbArtworkId) &&
      isValidImageFilename(filename)
    ) {
      return {
        layout: 'product',
        productId,
        kind: 'pdb-artwork',
        pdbArtworkId,
      };
    }
  }

  throw invalidObjectKeyError();
};

const invalidObjectKeyError = (): UploadFunctionError =>
  new UploadFunctionError({
    code: 'invalid_request',
    status: 400,
    message: 'objectKey does not match a canonical image layout.',
    details: { field: 'objectKey' },
  });

const validateImageVariantSuffix = (value: string | null): void => {
  if (value === null || VARIANT_SUFFIX_PATTERN.test(value)) {
    return;
  }

  throw new UploadFunctionError({
    code: 'invalid_request',
    status: 400,
    message: 'imageVariantSuffix must be null or a suffix like _1.',
    details: { field: 'imageVariantSuffix' },
  });
};

const isValidPathSegment = (value: string | undefined): value is string =>
  value !== undefined && PATH_SEGMENT_PATTERN.test(value);

const isValidImageFilename = (value: string | undefined): value is string =>
  value !== undefined && IMAGE_FILENAME_PATTERN.test(value);

const validatePathSegment = (field: string, value: string): void => {
  if (isValidPathSegment(value)) {
    return;
  }

  throw new UploadFunctionError({
    code: 'invalid_request',
    status: 400,
    message: `${field} must contain only URL-safe characters.`,
    details: { field },
  });
};
