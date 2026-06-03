import { describe, expect, it } from 'vitest';

import { buildExiftoolJson } from './exiftool-mapping.js';
import { parseMetadataDocument } from './schema.js';

describe('buildExiftoolJson', () => {
  it('maps multiple artworks to an ArtworkOrObject struct list with AO* fields', () => {
    const doc = parseMetadataDocument({
      artworks: [
        {
          title: 'Mona Lisa',
          creator: ['Leonardo da Vinci'],
          physicalDescription: 'Oil on poplar, 77 × 53 cm',
          copyrightNotice: 'Public domain',
        },
        { title: 'The Wall', creator: ['Artist A', 'Artist B'] },
      ],
      photograph: {},
    });

    const json = buildExiftoolJson(doc);
    const artworks = json['XMP-iptcExt:ArtworkOrObject'];

    expect(Array.isArray(artworks)).toBe(true);
    expect(artworks).toHaveLength(2);
    expect(artworks).toEqual([
      {
        AOTitle: 'Mona Lisa',
        AOCreator: ['Leonardo da Vinci'],
        AOPhysicalDescription: 'Oil on poplar, 77 × 53 cm',
        AOCopyrightNotice: 'Public domain',
      },
      { AOTitle: 'The Wall', AOCreator: ['Artist A', 'Artist B'] },
    ]);
  });

  it('writes the photograph layer to IPTC, Dublin Core, and PLUS — separate from the artwork', () => {
    const doc = parseMetadataDocument({
      artworks: [{ title: 'A painting', copyrightNotice: 'Artist estate' }],
      photograph: { creator: ['Jane Photographer'], copyrightNotice: '© 2026 Studio' },
    });

    const json = buildExiftoolJson(doc);

    expect(json['IPTC:By-line']).toEqual(['Jane Photographer']);
    expect(json['XMP-dc:Creator']).toEqual(['Jane Photographer']);
    expect(json['XMP-plus:ImageCreatorName']).toEqual(['Jane Photographer']);
    expect(json['IPTC:CopyrightNotice']).toBe('© 2026 Studio');
    expect(json['XMP-dc:Rights']).toBe('© 2026 Studio');
    expect(json['XMP-plus:CopyrightOwnerName']).toBe('© 2026 Studio');
    // The artwork copyright is on the struct, never conflated with the photo's.
    expect(json['XMP-dc:Rights']).not.toBe('Artist estate');
  });

  it('omits absent fields and the artwork list when there are no artworks', () => {
    const json = buildExiftoolJson(
      parseMetadataDocument({ photograph: { creator: ['Solo'] } }),
    );

    expect('XMP-iptcExt:ArtworkOrObject' in json).toBe(false);
    expect('IPTC:CopyrightNotice' in json).toBe(false);
    expect(json['XMP-dc:Creator']).toEqual(['Solo']);
  });
});
