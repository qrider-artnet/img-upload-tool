import { describe, expect, it } from 'vitest';

import { PRIVACY_STRIP_ARGS, buildWriteArgs } from './exiftool.js';

describe('buildWriteArgs', () => {
  it('strips GPS + device serials by default and imports the struct JSON', () => {
    const args = buildWriteArgs('/tmp/tags.json', '/tmp/image.jpg', { stripPrivacy: true });

    expect(args).toContain('-struct');
    expect(args).toContain('-GPS:all=');
    expect(args).toContain('-SerialNumber=');
    expect(args).toContain('-json=/tmp/tags.json');
    expect(args).toContain('-overwrite_original');
    expect(args.at(-1)).toBe('/tmp/image.jpg');
    for (const stripArg of PRIVACY_STRIP_ARGS) {
      expect(args).toContain(stripArg);
    }
  });

  it('omits the privacy strip when opted out', () => {
    const args = buildWriteArgs('/tmp/tags.json', '/tmp/image.jpg', { stripPrivacy: false });

    expect(args).not.toContain('-GPS:all=');
    expect(args).not.toContain('-SerialNumber=');
    expect(args).toContain('-json=/tmp/tags.json');
    expect(args).toContain('-overwrite_original');
  });
});
