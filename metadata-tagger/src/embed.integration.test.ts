import { describe, expect, it } from 'vitest';

import { embed } from './embed.js';
import { isExiftoolAvailable } from './exiftool.js';
import { parseMetadataDocument } from './schema.js';

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
});
