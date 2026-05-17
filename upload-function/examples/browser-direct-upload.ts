import {
  type AllowedContentType,
  type FinalizeResponse,
  finalizeUpload,
  presignUpload,
  uploadToSignedUrl,
} from './upload-client.js';

interface BrowserUploadInput {
  readonly endpoint: string;
  readonly file: File;
  readonly auctionHouseId: string;
  readonly auctionDate: string;
  readonly lotId: string;
  readonly imageId: string;
  readonly imageVariantSuffix: string | null;
}

/**
 * Runs the complete browser direct-upload flow.
 */
export const uploadLotImageFromBrowser = async (
  input: BrowserUploadInput,
): Promise<FinalizeResponse> => {
  const contentType = parseAllowedContentType(input.file.type);
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
      contentType,
      contentLength: input.file.size,
    },
  );

  await uploadToSignedUrl({
    presign,
    body: input.file,
    includeContentLengthHeader: false,
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

const form = getElement('upload-form', HTMLFormElement);
const resultOutput = getElement('result', HTMLPreElement);
const statusElement = getElement('status', HTMLElement);

form.addEventListener('submit', (event) => {
  event.preventDefault();
  void runBrowserUpload().catch((err: unknown) => {
    statusElement.textContent = 'Upload failed';
    resultOutput.textContent = formatUnknownError(err);
  });
});

const runBrowserUpload = async (): Promise<void> => {
  statusElement.textContent = 'Uploading...';
  resultOutput.textContent = '';

  const file = getSelectedFile();
  const response = await uploadLotImageFromBrowser({
    endpoint: getInputValue('endpoint'),
    file,
    auctionHouseId: getInputValue('auction-house-id'),
    auctionDate: getInputValue('auction-date'),
    lotId: getInputValue('lot-id'),
    imageId: getInputValue('image-id'),
    imageVariantSuffix: parseImageVariantSuffix(getInputValue('image-variant-suffix')),
  });

  statusElement.textContent = 'Upload finalized';
  resultOutput.textContent = JSON.stringify(response, null, 2);
};

const getSelectedFile = (): File => {
  const input = getElement('file', HTMLInputElement);
  const file = input.files?.item(0);

  if (file !== null && file !== undefined) {
    return file;
  }

  throw new Error('Select an image file first.');
};

const getInputValue = (id: string): string => {
  const input = getElement(id, HTMLInputElement);
  return input.value.trim();
};

function getElement<ElementType extends Element>(
  id: string,
  constructor: new () => ElementType,
): ElementType {
  const element = document.getElementById(id);

  if (element instanceof constructor) {
    return element;
  }

  throw new Error(`Missing expected element: ${id}`);
}

const parseImageVariantSuffix = (value: string): string | null => {
  if (value.length === 0) {
    return null;
  }

  return value;
};

const parseAllowedContentType = (value: string): AllowedContentType => {
  if (value === 'image/jpeg' || value === 'image/png' || value === 'image/webp') {
    return value;
  }

  throw new Error('Select a JPEG, PNG, or WebP image.');
};

const formatUnknownError = (err: unknown): string => {
  if (err instanceof Error) {
    return err.message;
  }

  return 'Unknown upload error.';
};
