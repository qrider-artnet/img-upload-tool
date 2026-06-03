import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const EXIFTOOL = 'exiftool';

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
): Promise<void> => {
  const importDoc = [{ SourceFile: filePath, ...json }];
  await withTempFile(JSON.stringify(importDoc), 'tags.json', async (jsonPath) => {
    await execFileAsync(EXIFTOOL, [
      '-m',
      '-struct',
      `-json=${jsonPath}`,
      '-overwrite_original',
      filePath,
    ]);
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
