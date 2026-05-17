import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  type AllowedContentType,
  type FinalizeResponse,
  finalizeUpload,
  presignUpload,
  uploadToSignedUrl,
} from './upload-client.js';

interface ServerUploadInput {
  readonly endpoint: string;
  readonly filePath: string;
  readonly contentType: AllowedContentType;
  readonly auctionHouseId: string;
  readonly auctionDate: string;
  readonly lotId: string;
  readonly imageId: string;
  readonly imageVariantSuffix: string | null;
}

/**
 * Runs the complete server-side direct-upload flow.
 */
export const uploadLotImageFromServer = async (
  input: ServerUploadInput,
): Promise<FinalizeResponse> => {
  const bytes = await readFile(input.filePath);
  const presign = await presignUpload(
    {
      endpoint: input.endpoint,
      productHeader: 'artnet-auctions',
      auctionHouseHeader: input.auctionHouseId,
    },
    {
      kind: 'auction-lot',
      auctionHouseId: input.auctionHouseId,
      auctionDate: input.auctionDate,
      lotId: input.lotId,
      imageId: input.imageId,
      imageVariantSuffix: input.imageVariantSuffix,
      contentType: input.contentType,
      contentLength: bytes.byteLength,
    },
  );

  await uploadToSignedUrl({
    presign,
    body: new Blob([bytes], { type: input.contentType }),
    includeContentLengthHeader: true,
  });

  return await finalizeUpload(
    {
      endpoint: input.endpoint,
      productHeader: 'artnet-auctions',
      auctionHouseHeader: input.auctionHouseId,
    },
    presign.uploadId,
  );
};

const runFromCli = async (argv: readonly string[]): Promise<FinalizeResponse> => {
  const args = parseArgs(argv.slice(2));
  const input: ServerUploadInput = {
    endpoint: requireArg(args, 'endpoint', 'UPLOAD_FUNCTION_ENDPOINT'),
    filePath: requireArg(args, 'file', 'UPLOAD_FILE'),
    contentType: parseAllowedContentType(requireArg(args, 'content-type', 'UPLOAD_CONTENT_TYPE')),
    auctionHouseId: requireArg(args, 'auction-house-id', 'UPLOAD_AUCTION_HOUSE_ID'),
    auctionDate: requireArg(args, 'auction-date', 'UPLOAD_AUCTION_DATE'),
    lotId: requireArg(args, 'lot-id', 'UPLOAD_LOT_ID'),
    imageId: requireArg(args, 'image-id', 'UPLOAD_IMAGE_ID'),
    imageVariantSuffix: optionalArg(args, 'image-variant-suffix', 'UPLOAD_IMAGE_VARIANT_SUFFIX'),
  };

  return await uploadLotImageFromServer(input);
};

const parseArgs = (args: readonly string[]): Map<string, string> => {
  const parsed = new Map<string, string>();

  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];

    if (name === undefined || value === undefined || !name.startsWith('--')) {
      throw new Error('Arguments must use --name value pairs.');
    }

    parsed.set(name.slice(2), value);
  }

  return parsed;
};

const requireArg = (args: ReadonlyMap<string, string>, name: string, envName: string): string => {
  const value = optionalArg(args, name, envName);

  if (value !== null) {
    return value;
  }

  throw new Error(`Missing --${name} or ${envName}.`);
};

const optionalArg = (
  args: ReadonlyMap<string, string>,
  name: string,
  envName: string,
): string | null => {
  const argValue = args.get(name);

  if (argValue !== undefined && argValue.length > 0) {
    return argValue;
  }

  const envValue = process.env[envName];

  if (envValue !== undefined && envValue.length > 0) {
    return envValue;
  }

  return null;
};

const parseAllowedContentType = (value: string): AllowedContentType => {
  if (value === 'image/jpeg' || value === 'image/png' || value === 'image/webp') {
    return value;
  }

  throw new Error('content-type must be image/jpeg, image/png, or image/webp.');
};

const formatUnknownError = (err: unknown): string => {
  if (err instanceof Error) {
    return err.message;
  }

  return 'Unknown upload error.';
};

const entrypoint = process.argv[1];

if (entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href) {
  try {
    const response = await runFromCli(process.argv);
    console.info(
      `Uploaded ${basename(requireArg(parseArgs(process.argv.slice(2)), 'file', 'UPLOAD_FILE'))}`,
    );
    console.info(JSON.stringify(response, null, 2));
  } catch (err: unknown) {
    console.error(formatUnknownError(err));
    process.exitCode = 1;
  }
}
