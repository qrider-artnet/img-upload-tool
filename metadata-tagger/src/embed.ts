import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { applyMetadata, readTags } from './exiftool.js';
import { buildExiftoolJson } from './exiftool-mapping.js';
import type { MetadataDocument } from './schema.js';

export type ImageFormat = 'jpg' | 'webp';

export interface VerificationResult {
  readonly ok: boolean;
  /** Requested values not found in the read-back (embed did not fully take). */
  readonly missing: readonly string[];
}

export interface EmbedOptions {
  /**
   * Strip GPS + device serial numbers while embedding (default true), so the
   * stored original carries no location/device data and the Variant Worker's
   * `metadata: keep` is safe. Set false to leave existing metadata untouched.
   */
  readonly stripPrivacy?: boolean;
}

export interface EmbedResult {
  readonly bytes: Buffer;
  readonly format: ImageFormat;
  /** Read-back of the tagged file (`exiftool -json -G -struct`). */
  readonly tags: Record<string, unknown>;
  readonly verification: VerificationResult;
  /** Whether the privacy strip (GPS + device serials) was applied. */
  readonly privacyStripped: boolean;
}

/** Detects JPEG / WebP from magic bytes; throws for anything else. */
export const detectFormat = (bytes: Buffer): ImageFormat => {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpg';
  }
  if (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'webp';
  }
  throw new Error('Unsupported image: expected JPEG or WebP.');
};

/**
 * Embeds the metadata into the image bytes via exiftool and returns the tagged
 * bytes plus a read-back verification. Requires the exiftool binary.
 */
export const embed = async (
  input: Buffer,
  doc: MetadataDocument,
  options: EmbedOptions = {},
): Promise<EmbedResult> => {
  const stripPrivacy = options.stripPrivacy ?? true;
  const format = detectFormat(input);
  const dir = await mkdtemp(join(tmpdir(), 'metadata-tagger-'));
  const workPath = join(dir, `image.${format}`);
  try {
    await writeFile(workPath, input);
    await applyMetadata(workPath, buildExiftoolJson(doc), { stripPrivacy });
    const tags = await readTags(workPath);
    const bytes = await readFile(workPath);
    return {
      bytes,
      format,
      tags,
      verification: verifyEmbedded(doc, tags),
      privacyStripped: stripPrivacy,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

/**
 * Confirms each requested value is present in the read-back. Checks value
 * presence rather than exact tag keys, so it is robust to exiftool's grouped key
 * names and the difference between struct and flattened output.
 */
export const verifyEmbedded = (
  doc: MetadataDocument,
  tags: Record<string, unknown>,
): VerificationResult => {
  const haystack = JSON.stringify(tags);
  const missing = expectedValues(doc).filter((value) => !haystack.includes(value));
  return { ok: missing.length === 0, missing };
};

const expectedValues = (doc: MetadataDocument): string[] => {
  const values: string[] = [];
  for (const artwork of doc.artworks) {
    pushDefined(values, artwork.title);
    pushAll(values, artwork.creator);
    pushDefined(values, artwork.dateCreated);
    pushDefined(values, artwork.physicalDescription);
    pushDefined(values, artwork.contentDescription);
    pushDefined(values, artwork.source);
    pushDefined(values, artwork.sourceInvNo);
    pushDefined(values, artwork.copyrightNotice);
  }
  pushAll(values, doc.photograph.creator);
  pushDefined(values, doc.photograph.copyrightNotice);
  pushDefined(values, doc.photograph.captureDate);
  return values;
};

const pushDefined = (target: string[], value: string | undefined): void => {
  if (value !== undefined) {
    target.push(value);
  }
};

const pushAll = (target: string[], values: readonly string[] | undefined): void => {
  if (values !== undefined) {
    target.push(...values);
  }
};
