import type { Artwork, MetadataDocument } from './schema.js';

/**
 * Maps the two-layer metadata document to the JSON shape exiftool imports via
 * `-json=FILE`. This is the highest-bug-risk part of the tool (tag names and the
 * artwork struct list), so it is a pure function with direct unit coverage —
 * separate from the exiftool spawn, which needs the binary present.
 *
 * - Artwork layer → IPTC Extension "Artwork or Object in the Image" struct list
 *   (`XMP-iptcExt:ArtworkOrObject`), one struct per depicted artwork, keyed by
 *   the `AO*` sub-field names.
 * - Photograph layer → IPTC (IIM), Dublin Core, and PLUS. The XMP forms
 *   (`XMP-dc` / `XMP-plus`) are what survive in WebP; the IIM tags apply to JPEG.
 */
export const buildExiftoolJson = (doc: MetadataDocument): Record<string, unknown> => {
  const json: Record<string, unknown> = {};

  if (doc.artworks.length > 0) {
    json['XMP-iptcExt:ArtworkOrObject'] = doc.artworks.map(artworkToStruct);
  }

  const photo = doc.photograph;

  if (photo.creator !== undefined) {
    json['IPTC:By-line'] = photo.creator;
    json['XMP-dc:Creator'] = photo.creator;
    json['XMP-plus:ImageCreatorName'] = photo.creator;
  }

  if (photo.copyrightNotice !== undefined) {
    json['IPTC:CopyrightNotice'] = photo.copyrightNotice;
    json['XMP-dc:Rights'] = photo.copyrightNotice;
    json['XMP-plus:CopyrightOwnerName'] = photo.copyrightNotice;
  }

  if (photo.captureDate !== undefined) {
    // XMP form only: the IIM DateCreated has a stricter date format.
    json['XMP-photoshop:DateCreated'] = photo.captureDate;
  }

  return json;
};

const artworkToStruct = (artwork: Artwork): Record<string, unknown> => {
  const struct: Record<string, unknown> = {};
  setIfPresent(struct, 'AOTitle', artwork.title);
  setIfPresent(struct, 'AOCreator', artwork.creator);
  setIfPresent(struct, 'AODateCreated', artwork.dateCreated);
  setIfPresent(struct, 'AOPhysicalDescription', artwork.physicalDescription);
  setIfPresent(struct, 'AOContentDescription', artwork.contentDescription);
  setIfPresent(struct, 'AOSource', artwork.source);
  setIfPresent(struct, 'AOSourceInvNo', artwork.sourceInvNo);
  setIfPresent(struct, 'AOCopyrightNotice', artwork.copyrightNotice);
  return struct;
};

const setIfPresent = (
  target: Record<string, unknown>,
  key: string,
  value: string | readonly string[] | undefined,
): void => {
  if (value !== undefined) {
    target[key] = value;
  }
};
