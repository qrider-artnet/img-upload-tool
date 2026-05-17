import { VariantWorkerError } from './errors.js';

export type ObjectKey = string & { readonly __brand: 'ObjectKey' };

const LEGACY_OBJECT_KEY_PATTERN =
  /^lot_images\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+(?:_[1-9][0-9]*)?\.(?:jpg|png|webp)$/;
const GALLERY_ARTWORK_OBJECT_KEY_PATTERN =
  /^products\/galleries\/artworks\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/images\/[A-Za-z0-9_-]+(?:_[1-9][0-9]*)?\.(?:jpg|png|webp)$/;
const AUCTION_LOT_OBJECT_KEY_PATTERN =
  /^products\/artnet-auctions\/auction-lots\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/images\/[A-Za-z0-9_-]+(?:_[1-9][0-9]*)?\.(?:jpg|png|webp)$/;
const PDB_ARTWORK_OBJECT_KEY_PATTERN =
  /^products\/pdb\/artworks\/[A-Za-z0-9_-]+\/images\/[A-Za-z0-9_-]+(?:_[1-9][0-9]*)?\.(?:jpg|png|webp)$/;

const objectKeyPatterns = [
  LEGACY_OBJECT_KEY_PATTERN,
  GALLERY_ARTWORK_OBJECT_KEY_PATTERN,
  AUCTION_LOT_OBJECT_KEY_PATTERN,
  PDB_ARTWORK_OBJECT_KEY_PATTERN,
] as const;

export const parseObjectKey = (value: string): ObjectKey => {
  if (objectKeyPatterns.some((pattern) => pattern.test(value))) {
    return value as ObjectKey;
  }

  throw new VariantWorkerError({
    code: 'invalid_request',
    status: 400,
    message: 'Object key does not match a canonical image layout.',
  });
};
