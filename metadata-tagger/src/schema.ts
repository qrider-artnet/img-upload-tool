import { z } from 'zod';

/**
 * Metadata for one artwork depicted in the photograph. Maps to one entry in the
 * IPTC Extension "Artwork or Object in the Image" list (XMP-iptcExt). Distinct
 * from the photograph's own attribution (see PhotographSchema).
 */
export const ArtworkSchema = z
  .object({
    title: z.string().min(1).optional(),
    /** Artist(s) of the artwork — not the photographer. */
    creator: z.array(z.string().min(1)).optional(),
    dateCreated: z.string().min(1).optional(),
    /** Medium + physical dimensions, e.g. "Oil on canvas, 130 × 190 cm". */
    physicalDescription: z.string().min(1).optional(),
    contentDescription: z.string().min(1).optional(),
    /** Owning collection / institution. */
    source: z.string().min(1).optional(),
    /** Accession / inventory number. */
    sourceInvNo: z.string().min(1).optional(),
    /** The artwork's own copyright — separate from the photo's copyright. */
    copyrightNotice: z.string().min(1).optional(),
  })
  .strict();

export type Artwork = z.infer<typeof ArtworkSchema>;

/**
 * Metadata about the photograph itself — the reproduction shot, not the artwork
 * it depicts. A public-domain painting can still have a copyrighted photo.
 */
export const PhotographSchema = z
  .object({
    /** Photographer / byline. */
    creator: z.array(z.string().min(1)).optional(),
    /** The photograph's copyright notice. */
    copyrightNotice: z.string().min(1).optional(),
    captureDate: z.string().min(1).optional(),
  })
  .strict();

export type Photograph = z.infer<typeof PhotographSchema>;

export const MetadataDocumentSchema = z
  .object({
    artworks: z.array(ArtworkSchema).default([]),
    photograph: PhotographSchema.default({}),
  })
  .strict()
  .refine(
    (doc) => doc.artworks.length > 0 || Object.keys(doc.photograph).length > 0,
    { message: 'Provide at least one artwork or photograph field to embed.' },
  );

export type MetadataDocument = z.infer<typeof MetadataDocumentSchema>;

export const parseMetadataDocument = (value: unknown): MetadataDocument =>
  MetadataDocumentSchema.parse(value);
