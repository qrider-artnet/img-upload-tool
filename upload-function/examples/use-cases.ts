import {
  type AllowedContentType,
  type FinalizeResponse,
  type S3IngestResponse,
  deleteFinalizedObject,
  finalizeUpload,
  ingestFromS3,
  presignUpload,
  uploadToSignedUrl,
} from './upload-client.js';

interface DirectUploadFile {
  readonly body: Blob;
  readonly contentLength: number;
  readonly contentType: AllowedContentType;
}

export interface AuctionLotDirectUploadInput {
  readonly endpoint: string;
  readonly file: DirectUploadFile;
  readonly auctionHouseId: string;
  readonly auctionDate: string;
  readonly lotId: string;
  readonly imageId: string;
  readonly imageVariantSuffix: string | null;
}

export interface GalleryArtworkDirectUploadInput {
  readonly endpoint: string;
  readonly file: DirectUploadFile;
  readonly galleryId: string;
  readonly artworkId: string;
  readonly imageId: string;
  readonly imageVariantSuffix: string | null;
}

export interface PdbArtworkDirectUploadInput {
  readonly endpoint: string;
  readonly file: DirectUploadFile;
  readonly pdbArtworkId: string;
  readonly imageId: string;
  readonly imageVariantSuffix: string | null;
}

export interface AuctionLotS3IngestInput {
  readonly endpoint: string;
  readonly sourceUri: string;
  readonly auctionHouseId: string;
  readonly auctionDate: string;
  readonly lotId: string;
  readonly imageId: string;
  readonly imageVariantSuffix: string | null;
  readonly contentType?: AllowedContentType;
}

export interface DeleteAuctionLotObjectInput {
  readonly endpoint: string;
  readonly objectKey: string;
  readonly auctionHouseId: string;
}

export interface ImageReadUrls {
  readonly original: string;
  readonly thumb: string;
  readonly medium: string;
  readonly large: string;
  readonly w640: string;
}

/**
 * Use case: auction-house user uploads a lot image through a trusted internal caller.
 */
export const uploadAuctionLotImage = async (
  input: AuctionLotDirectUploadInput,
): Promise<FinalizeResponse> => {
  const client = {
    endpoint: input.endpoint,
    productHeader: 'artnet-auctions' as const,
    auctionHouseHeader: input.auctionHouseId,
  };
  const presign = await presignUpload(client, {
    kind: 'auction-lot',
    auctionHouseId: input.auctionHouseId,
    auctionDate: input.auctionDate,
    lotId: input.lotId,
    imageId: input.imageId,
    imageVariantSuffix: input.imageVariantSuffix,
    contentType: input.file.contentType,
    contentLength: input.file.contentLength,
  });

  await uploadToSignedUrl({
    presign,
    body: input.file.body,
    includeContentLengthHeader: false,
  });

  return await finalizeUpload(client, presign.uploadId);
};

/**
 * Use case: gallery product uploads an artwork image.
 */
export const uploadGalleryArtworkImage = async (
  input: GalleryArtworkDirectUploadInput,
): Promise<FinalizeResponse> => {
  const client = {
    endpoint: input.endpoint,
    productHeader: 'galleries' as const,
  };
  const presign = await presignUpload(client, {
    kind: 'gallery-artwork',
    galleryId: input.galleryId,
    artworkId: input.artworkId,
    imageId: input.imageId,
    imageVariantSuffix: input.imageVariantSuffix,
    contentType: input.file.contentType,
    contentLength: input.file.contentLength,
  });

  await uploadToSignedUrl({
    presign,
    body: input.file.body,
    includeContentLengthHeader: false,
  });

  return await finalizeUpload(client, presign.uploadId);
};

/**
 * Use case: PDB product uploads an artwork image.
 */
export const uploadPdbArtworkImage = async (
  input: PdbArtworkDirectUploadInput,
): Promise<FinalizeResponse> => {
  const client = {
    endpoint: input.endpoint,
    productHeader: 'pdb' as const,
  };
  const presign = await presignUpload(client, {
    kind: 'pdb-artwork',
    pdbArtworkId: input.pdbArtworkId,
    imageId: input.imageId,
    imageVariantSuffix: input.imageVariantSuffix,
    contentType: input.file.contentType,
    contentLength: input.file.contentLength,
  });

  await uploadToSignedUrl({
    presign,
    body: input.file.body,
    includeContentLengthHeader: false,
  });

  return await finalizeUpload(client, presign.uploadId);
};

/**
 * Use case: vendor scraper image already exists in S3/R2 and should be copied into canonical storage.
 */
export const ingestAuctionLotImageFromS3 = async (
  input: AuctionLotS3IngestInput,
): Promise<S3IngestResponse> => {
  return await ingestFromS3(input.endpoint, {
    sourceUri: input.sourceUri,
    objectKey: buildAuctionLotObjectKey({
      auctionHouseId: input.auctionHouseId,
      auctionDate: input.auctionDate,
      lotId: input.lotId,
      imageId: input.imageId,
      imageVariantSuffix: input.imageVariantSuffix,
      extension: extensionForContentType(input.contentType ?? 'image/jpeg'),
    }),
    ...(input.contentType === undefined ? {} : { contentType: input.contentType }),
  });
};

/**
 * Use case: caller deletes a finalized auction-lot object after its own database row is updated.
 */
export const deleteAuctionLotObject = async (input: DeleteAuctionLotObjectInput): Promise<void> => {
  await deleteFinalizedObject(
    {
      endpoint: input.endpoint,
      productHeader: 'artnet-auctions',
      auctionHouseHeader: input.auctionHouseId,
    },
    input.objectKey,
  );
};

/**
 * Use case: consumer renders original and fixed WebP Variant Worker URLs from a finalize/ingest URL.
 */
export const buildImageReadUrls = (publicUrl: string): ImageReadUrls => ({
  original: publicUrl,
  thumb: withVariant(publicUrl, 'thumb'),
  medium: withVariant(publicUrl, 'medium'),
  large: withVariant(publicUrl, 'large'),
  w640: withVariant(publicUrl, 'w640'),
});

const buildAuctionLotObjectKey = (input: {
  readonly auctionHouseId: string;
  readonly auctionDate: string;
  readonly lotId: string;
  readonly imageId: string;
  readonly imageVariantSuffix: string | null;
  readonly extension: 'jpg' | 'png' | 'webp';
}): string => {
  const suffix = input.imageVariantSuffix ?? '';
  return `products/artnet-auctions/auction-lots/${input.auctionHouseId}/${input.auctionDate}/${input.lotId}/images/${input.imageId}${suffix}.${input.extension}`;
};

const extensionForContentType = (contentType: AllowedContentType): 'jpg' | 'png' | 'webp' => {
  switch (contentType) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
  }
};

const withVariant = (publicUrl: string, variant: string): string => {
  const url = new URL(publicUrl);
  url.searchParams.set('variant', variant);
  return url.toString();
};
