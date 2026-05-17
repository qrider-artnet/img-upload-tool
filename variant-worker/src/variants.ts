import type { ImageTransformOptions } from './bindings.js';
import { VariantWorkerError } from './errors.js';
import type { ObjectKey } from './object-key.js';

export const WEBP_VARIANTS = ['thumb', 'w320', 'w640', 'w960', 'w1280', 'w1600'] as const;

export type WebpVariant = (typeof WEBP_VARIANTS)[number];

export interface VariantSpec {
  readonly name: WebpVariant;
  readonly transform: ImageTransformOptions;
  readonly quality: number;
}

const variantSpecs = {
  thumb: {
    name: 'thumb',
    transform: { width: 150, height: 150, fit: 'cover' },
    quality: 70,
  },
  w320: {
    name: 'w320',
    transform: { width: 320, fit: 'scale-down' },
    quality: 82,
  },
  w640: {
    name: 'w640',
    transform: { width: 640, fit: 'scale-down' },
    quality: 82,
  },
  w960: {
    name: 'w960',
    transform: { width: 960, fit: 'scale-down' },
    quality: 82,
  },
  w1280: {
    name: 'w1280',
    transform: { width: 1280, fit: 'scale-down' },
    quality: 82,
  },
  w1600: {
    name: 'w1600',
    transform: { width: 1600, fit: 'scale-down' },
    quality: 82,
  },
} satisfies Record<WebpVariant, VariantSpec>;

const aliases: Record<string, WebpVariant> = {
  medium: 'w640',
  large: 'w1600',
};

export const parseVariant = (value: string): WebpVariant => {
  if (isWebpVariant(value)) {
    return value;
  }

  const alias = aliases[value];
  if (alias !== undefined) {
    return alias;
  }

  throw new VariantWorkerError({
    code: 'invalid_variant',
    status: 400,
    message: 'Requested variant is not supported.',
  });
};

export const getVariantSpec = (variant: WebpVariant): VariantSpec => variantSpecs[variant];

export const buildVariantKey = (
  objectKey: ObjectKey,
  variant: WebpVariant,
  cacheVersion: string | undefined = undefined,
): string => {
  if (cacheVersion !== undefined) {
    const objectKeyWithoutExtension = objectKey.replace(/\.(?:jpg|png|webp)$/, '');
    return `variants/webp/${variant}/${objectKeyWithoutExtension}/_v/${cacheVersion}.webp`;
  }

  const objectKeyWithWebpExtension = objectKey.replace(/\.(?:jpg|png|webp)$/, '.webp');
  return `variants/webp/${variant}/${objectKeyWithWebpExtension}`;
};

const isWebpVariant = (value: string): value is WebpVariant =>
  WEBP_VARIANTS.some((variant) => variant === value);
