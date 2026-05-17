import type { ObjectKey } from './types.js';

export const FIXED_WEBP_VARIANTS = ['thumb', 'w320', 'w640', 'w960', 'w1280', 'w1600'] as const;

export type FixedWebpVariant = (typeof FIXED_WEBP_VARIANTS)[number];

/**
 * Legacy unversioned R2 key contract for persisted Variant Worker outputs.
 */
export const buildWebpVariantKey = (objectKey: ObjectKey, variant: FixedWebpVariant): string => {
  const objectKeyWithWebpExtension = objectKey.replace(/\.(?:jpg|png|webp)$/, '.webp');
  return `variants/webp/${variant}/${objectKeyWithWebpExtension}`;
};

export const buildAllWebpVariantKeys = (objectKey: ObjectKey): string[] =>
  FIXED_WEBP_VARIANTS.map((variant) => buildWebpVariantKey(objectKey, variant));

/**
 * Prefix contract for cache-versioned Variant Worker outputs.
 */
export const buildWebpVariantPrefix = (objectKey: ObjectKey, variant: FixedWebpVariant): string => {
  const objectKeyWithoutExtension = objectKey.replace(/\.(?:jpg|png|webp)$/, '');
  return `variants/webp/${variant}/${objectKeyWithoutExtension}/_v/`;
};

export const buildAllWebpVariantPrefixes = (objectKey: ObjectKey): string[] =>
  FIXED_WEBP_VARIANTS.map((variant) => buildWebpVariantPrefix(objectKey, variant));
