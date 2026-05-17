import { VariantWorkerError } from './errors.js';
import { parseObjectKey, type ObjectKey } from './object-key.js';
import { parseVariant, type WebpVariant } from './variants.js';

export interface ParsedImageRequest {
  readonly objectKey: ObjectKey;
  readonly cacheVersion?: string;
  readonly variant?: WebpVariant;
}

export const parseImageRequest = (request: Request): ParsedImageRequest => {
  const url = new URL(request.url);
  const queryParams = Array.from(url.searchParams.keys());
  const parsedPath = parseVersionedPath(decodePathname(url.pathname));
  const legacyRequest = parseLegacyImageRequest(parsedPath.rawObjectKey, parsedPath.cacheVersion);

  if (queryParams.some((key) => key !== 'variant')) {
    throw new VariantWorkerError({
      code: 'invalid_variant',
      status: 400,
      message: 'Only the variant query parameter is supported.',
    });
  }

  if (url.searchParams.getAll('variant').length > 1) {
    throw new VariantWorkerError({
      code: 'invalid_variant',
      status: 400,
      message: 'Only one variant query parameter is supported.',
    });
  }

  if (legacyRequest !== undefined) {
    if (url.searchParams.has('variant')) {
      throw new VariantWorkerError({
        code: 'invalid_variant',
        status: 400,
        message: 'Legacy variant paths cannot also specify a variant query parameter.',
      });
    }

    return legacyRequest;
  }

  const objectKey = parseObjectKey(parsedPath.rawObjectKey);
  const rawVariant = url.searchParams.get('variant');

  if (rawVariant === null) {
    return parsedPath.cacheVersion === undefined
      ? { objectKey }
      : { objectKey, cacheVersion: parsedPath.cacheVersion };
  }

  if (rawVariant.length === 0) {
    throw new VariantWorkerError({
      code: 'invalid_variant',
      status: 400,
      message: 'Variant query parameter cannot be empty.',
    });
  }

  return {
    objectKey,
    ...(parsedPath.cacheVersion === undefined ? {} : { cacheVersion: parsedPath.cacheVersion }),
    variant: parseVariant(rawVariant),
  };
};

const decodePathname = (pathname: string): string => {
  const pathWithoutSlash = pathname.replace(/^\/+/, '');

  try {
    return decodeURIComponent(pathWithoutSlash);
  } catch {
    throw new VariantWorkerError({
      code: 'invalid_request',
      status: 400,
      message: 'Image path is not valid URL encoding.',
    });
  }
};

const LEGACY_IMAGE_PATH_PATTERN =
  /^(lot_images\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/)([0-9]+(?:_[1-9][0-9]*)?)([io])\.jpg$/;
const PRODUCT_AUCTION_LEGACY_IMAGE_PATH_PATTERN =
  /^(products\/artnet-auctions\/auction-lots\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/images\/)([0-9]+(?:_[1-9][0-9]*)?)([io])\.jpg$/;
const VERSIONED_PATH_PATTERN = /^_v\/([0-9A-HJKMNP-TV-Z]{26})\/(.+)$/;

interface ParsedPath {
  readonly rawObjectKey: string;
  readonly cacheVersion?: string;
}

const parseVersionedPath = (rawPath: string): ParsedPath => {
  const match = VERSIONED_PATH_PATTERN.exec(rawPath);

  if (match === null) {
    return { rawObjectKey: rawPath };
  }

  const [, cacheVersion, rawObjectKey] = match;
  if (cacheVersion === undefined || rawObjectKey === undefined) {
    return { rawObjectKey: rawPath };
  }

  return { rawObjectKey, cacheVersion };
};

const parseLegacyImageRequest = (
  rawObjectKey: string,
  cacheVersion: string | undefined,
): ParsedImageRequest | undefined => {
  const match =
    LEGACY_IMAGE_PATH_PATTERN.exec(rawObjectKey) ??
    PRODUCT_AUCTION_LEGACY_IMAGE_PATH_PATTERN.exec(rawObjectKey);

  if (match === null) {
    return undefined;
  }

  const [, prefix, imageId, legacyVariant] = match;
  if (prefix === undefined || imageId === undefined || legacyVariant === undefined) {
    return undefined;
  }

  return {
    objectKey: parseObjectKey(`${prefix}${imageId}.jpg`),
    ...(cacheVersion === undefined ? {} : { cacheVersion }),
    variant: legacyVariant === 'i' ? 'thumb' : parseVariant('large'),
  };
};
