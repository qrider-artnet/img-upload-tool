import { describe, expect, it } from 'vitest';

import { parseMetadataDocument } from './schema.js';

describe('parseMetadataDocument', () => {
  it('parses a two-layer document and defaults missing layers', () => {
    const doc = parseMetadataDocument({ photograph: { creator: ['Jane'] } });
    expect(doc.artworks).toEqual([]);
    expect(doc.photograph.creator).toEqual(['Jane']);
  });

  it('rejects an empty document (nothing to embed)', () => {
    expect(() => parseMetadataDocument({})).toThrow();
    expect(() => parseMetadataDocument({ artworks: [], photograph: {} })).toThrow();
  });

  it('rejects unknown fields (strict)', () => {
    expect(() =>
      parseMetadataDocument({ artworks: [{ title: 'X', artist: 'wrong-key' }] }),
    ).toThrow();
  });
});
