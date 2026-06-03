import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const EXIFTOOL = 'exiftool';

/**
 * exiftool deletions that remove privacy-sensitive fields: GPS location (EXIF
 * and XMP) and device serial numbers. Applied during the write so the stored
 * original carries no location/device data — which is what makes the Variant
 * Worker's `metadata: keep` safe (it preserves bytes that never held GPS).
 *
 * Capture date is intentionally NOT stripped: it is part of the photograph
 * attribution layer and is often embedded deliberately.
 */
export const PRIVACY_STRIP_ARGS: readonly string[] = [
  '-GPS:all=',
  '-XMP-exif:GPSLatitude=',
  '-XMP-exif:GPSLongitude=',
  '-XMP-exif:GPSAltitude=',
  '-SerialNumber=',
  '-InternalSerialNumber=',
  '-LensSerialNumber=',
  '-CameraSerialNumber=',
];

export interface WriteOptions {
  /** Strip GPS + device serial numbers during the write. Default true. */
  readonly stripPrivacy: boolean;
}

/**
 * Builds the exiftool argument vector for an in-place write. Pure and exported
 * so the privacy-strip and import flags are unit-testable without the binary.
 */
export const buildWriteArgs = (
  jsonPath: string,
  filePath: string,
  options: WriteOptions,
): string[] => [
  '-m',
  '-struct',
  ...(options.stripPrivacy ? PRIVACY_STRIP_ARGS : []),
  `-json=${jsonPath}`,
  '-overwrite_original',
  filePath,
];

/** Whether the exiftool binary is on PATH. The tool requires it to write. */
export const isExiftoolAvailable = async (): Promise<boolean> => {
  try {
    await execFileAsync(EXIFTOOL, ['-ver']);
    return true;
  } catch {
    return false;
  }
};

/**
 * Applies the given exiftool JSON tag object to `filePath` in place. exiftool's
 * `-json=` import matches entries by `SourceFile`, so it is set to the target.
 * `-struct` preserves the artwork struct list; `-m` downgrades minor warnings
 * (e.g. IIM tags that do not apply to WebP) so they do not fail the write.
 */
export const applyMetadata = async (
  filePath: string,
  json: Record<string, unknown>,
  options: WriteOptions = { stripPrivacy: true },
): Promise<void> => {
  const importDoc = [{ SourceFile: filePath, ...json }];
  await withTempFile(JSON.stringify(importDoc), 'tags.json', async (jsonPath) => {
    await execFileAsync(EXIFTOOL, buildWriteArgs(jsonPath, filePath, options));
  });
};

/** Reads all tags from `filePath` as a grouped, struct-preserving object. */
export const readTags = async (filePath: string): Promise<Record<string, unknown>> => {
  const { stdout } = await execFileAsync(EXIFTOOL, ['-json', '-G', '-struct', filePath]);
  const parsed: unknown = JSON.parse(stdout);
  if (
    !Array.isArray(parsed) ||
    parsed.length === 0 ||
    typeof parsed[0] !== 'object' ||
    parsed[0] === null
  ) {
    throw new Error('Unexpected exiftool output: expected a non-empty JSON array.');
  }
  return parsed[0] as Record<string, unknown>;
};

const withTempFile = async <T>(
  contents: string,
  name: string,
  use: (path: string) => Promise<T>,
): Promise<T> => {
  const dir = await mkdtemp(join(tmpdir(), 'metadata-tagger-'));
  const path = join(dir, name);
  try {
    await writeFile(path, contents, 'utf8');
    return await use(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};
