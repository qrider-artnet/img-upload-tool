export {
  ArtworkSchema,
  MetadataDocumentSchema,
  PhotographSchema,
  parseMetadataDocument,
} from './schema.js';
export type { Artwork, MetadataDocument, Photograph } from './schema.js';

export { buildExiftoolJson } from './exiftool-mapping.js';
export { detectFormat, embed, verifyEmbedded } from './embed.js';
export type { EmbedResult, ImageFormat, VerificationResult } from './embed.js';
export { isExiftoolAvailable } from './exiftool.js';
export { readImageSource } from './sources.js';
export { tagAndUpload } from './upload.js';
export type { TagAndUploadInput, TagAndUploadResult } from './upload.js';
