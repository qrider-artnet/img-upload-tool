import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { embed } from './embed.js';
import { applyMetadata, isExiftoolAvailable, readTags } from './exiftool.js';
import { parseMetadataDocument } from './schema.js';

const hasGpsTags = (tags: Record<string, unknown>): boolean =>
  Object.keys(tags).some((key) => /GPS(Latitude|Longitude|Position)/.test(key));

// 1x1 JPEG fixture (160 bytes).
const SAMPLE_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRof' +
    'Hh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAAB' +
    'AAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwD/2Q==',
  'base64',
);

// Requires the exiftool binary; skips otherwise (CI without exiftool, local dev).
const exiftoolAvailable = await isExiftoolAvailable();
const describeWithExiftool = exiftoolAvailable ? describe : describe.skip;

describeWithExiftool('embed (requires exiftool)', () => {
  it('embeds both layers into a JPEG and verifies the read-back', async () => {
    const doc = parseMetadataDocument({
      artworks: [
        {
          title: 'Churchgate Station',
          creator: ['Sebastião Salgado'],
          physicalDescription: 'Gelatin silver print',
          copyrightNotice: 'Public domain artwork',
        },
      ],
      photograph: {
        creator: ['Studio Reproduction'],
        copyrightNotice: '© 2026 Artnet',
      },
    });

    const result = await embed(SAMPLE_JPEG, doc);

    expect(result.format).toBe('jpg');
    expect(result.verification.ok).toBe(true);
    expect(result.verification.missing).toEqual([]);
    expect(result.bytes.byteLength).toBeGreaterThan(SAMPLE_JPEG.byteLength);

    const readBack = JSON.stringify(result.tags);
    expect(readBack).toContain('Churchgate Station');
    expect(readBack).toContain('Sebastião Salgado');
    expect(readBack).toContain('Studio Reproduction');
  });

  it('strips GPS and device serials present in the original (default strip)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tagger-gps-'));
    const seededPath = join(dir, 'with-gps.jpg');
    try {
      // Seed the fixture with GPS + a serial number, with the strip disabled.
      await writeFile(seededPath, SAMPLE_JPEG);
      await applyMetadata(
        seededPath,
        {
          'GPS:GPSLatitude': 48.8584,
          'GPS:GPSLatitudeRef': 'N',
          'GPS:GPSLongitude': 2.2945,
          'GPS:GPSLongitudeRef': 'E',
          'EXIF:SerialNumber': 'CAM-SERIAL-12345',
        },
        { stripPrivacy: false },
      );

      // Sanity: the seed actually wrote GPS + serial, so the test is not vacuous.
      const seededTags = await readTags(seededPath);
      expect(hasGpsTags(seededTags)).toBe(true);
      expect(JSON.stringify(seededTags)).toContain('CAM-SERIAL-12345');

      // Embed with the default privacy strip — GPS + serial must be gone, while
      // attribution is written.
      const withGps = await readFile(seededPath);
      const result = await embed(
        withGps,
        parseMetadataDocument({ photograph: { creator: ['Studio Reproduction'] } }),
      );

      expect(result.privacyStripped).toBe(true);
      expect(hasGpsTags(result.tags)).toBe(false);
      expect(JSON.stringify(result.tags)).not.toContain('CAM-SERIAL-12345');
      expect(JSON.stringify(result.tags)).toContain('Studio Reproduction');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
