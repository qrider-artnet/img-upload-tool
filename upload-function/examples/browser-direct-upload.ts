import {
  type AllowedContentType,
  type FinalizeResponse,
  finalizeUpload,
  presignUpload,
  uploadToSignedUrl,
} from './upload-client.js';

interface MetadataInput {
  readonly tagServerUrl: string;
  readonly artworkTitle: string;
  readonly artworkCreator: string;
  readonly artworkCopyright: string;
  readonly photoCreator: string;
  readonly photoCopyright: string;
}

interface BrowserUploadInput {
  readonly endpoint: string;
  readonly file: File;
  readonly auctionHouseId: string;
  readonly auctionDate: string;
  readonly lotId: string;
  readonly imageId: string;
  readonly imageVariantSuffix: string | null;
  readonly metadata: MetadataInput;
  readonly onStatus: (message: string) => void;
}

interface TaggingInfo {
  readonly format: string;
  readonly privacyStripped: boolean;
  readonly verification: unknown;
}

interface BrowserUploadResult {
  readonly finalize: FinalizeResponse;
  readonly tagging: TaggingInfo | null;
}

/**
 * Runs the complete browser direct-upload flow. When a tag-server URL and
 * metadata are provided (JPEG/WebP only), the bytes are tagged via the tag
 * server first, then the tagged bytes go through the normal presign -> PUT ->
 * finalize (the upload stays browser-direct to GCS).
 */
export const uploadLotImageFromBrowser = async (
  input: BrowserUploadInput,
): Promise<BrowserUploadResult> => {
  let body: Blob = input.file;
  let contentType = parseAllowedContentType(input.file.type);
  let tagging: TaggingInfo | null = null;

  const doc = buildMetadataDoc(input.metadata);
  const taggable = contentType === 'image/jpeg' || contentType === 'image/webp';

  if (input.metadata.tagServerUrl.length > 0 && doc !== null && taggable) {
    input.onStatus('Tagging metadata...');
    const tagged = await tagViaServer(input.metadata.tagServerUrl, input.file, doc);
    body = tagged.blob;
    contentType = tagged.contentType;
    tagging = tagged.info;
  }

  input.onStatus('Uploading...');
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
      contentLength: body.size,
    },
  );

  await uploadToSignedUrl({ presign, body, includeContentLengthHeader: false });

  const finalize = await finalizeUpload(
    {
      endpoint: input.endpoint,
      productHeader: 'artnet-auctions',
      auctionHouseHeader: input.auctionHouseId,
    },
    presign.uploadId,
  );

  return { finalize, tagging };
};

interface TaggedImage {
  readonly blob: Blob;
  readonly contentType: AllowedContentType;
  readonly info: TaggingInfo;
}

const tagViaServer = async (
  tagServerUrl: string,
  file: File,
  metadata: Record<string, unknown>,
): Promise<TaggedImage> => {
  const imageBase64 = await blobToBase64(file);
  const response = await fetch(`${trimTrailingSlash(tagServerUrl)}/tag`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageBase64, metadata }),
  });

  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    const message =
      typeof payload['error'] === 'string' ? payload['error'] : `HTTP ${response.status}`;
    throw new Error(`Tag server failed: ${message}`);
  }

  const taggedBase64 = payload['imageBase64'];
  const format = payload['format'];
  if (typeof taggedBase64 !== 'string' || typeof format !== 'string') {
    throw new Error('Tag server returned an unexpected response.');
  }

  const contentType: AllowedContentType = format === 'webp' ? 'image/webp' : 'image/jpeg';
  return {
    blob: base64ToBlob(taggedBase64, contentType),
    contentType,
    info: {
      format,
      privacyStripped: payload['privacyStripped'] === true,
      verification: payload['verification'],
    },
  };
};

const buildMetadataDoc = (metadata: MetadataInput): Record<string, unknown> | null => {
  const artwork: Record<string, unknown> = {};
  if (metadata.artworkTitle.length > 0) artwork['title'] = metadata.artworkTitle;
  if (metadata.artworkCreator.length > 0) artwork['creator'] = splitList(metadata.artworkCreator);
  if (metadata.artworkCopyright.length > 0) artwork['copyrightNotice'] = metadata.artworkCopyright;

  const photograph: Record<string, unknown> = {};
  if (metadata.photoCreator.length > 0) photograph['creator'] = splitList(metadata.photoCreator);
  if (metadata.photoCopyright.length > 0) photograph['copyrightNotice'] = metadata.photoCopyright;

  const artworks = Object.keys(artwork).length > 0 ? [artwork] : [];
  if (artworks.length === 0 && Object.keys(photograph).length === 0) {
    return null;
  }
  return { artworks, photograph };
};

const splitList = (value: string): string[] =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read the selected file.'));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Unexpected file read result.'));
        return;
      }
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.readAsDataURL(blob);
  });

const base64ToBlob = (base64: string, contentType: string): Blob => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: contentType });
};

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, '');

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
  statusElement.textContent = 'Starting...';
  resultOutput.textContent = '';

  const file = getSelectedFile();
  const result = await uploadLotImageFromBrowser({
    endpoint: getInputValue('endpoint'),
    file,
    auctionHouseId: getInputValue('auction-house-id'),
    auctionDate: getInputValue('auction-date'),
    lotId: getInputValue('lot-id'),
    imageId: getInputValue('image-id'),
    imageVariantSuffix: parseImageVariantSuffix(getInputValue('image-variant-suffix')),
    metadata: {
      tagServerUrl: getInputValue('tag-server'),
      artworkTitle: getInputValue('art-title'),
      artworkCreator: getInputValue('art-creator'),
      artworkCopyright: getInputValue('art-copyright'),
      photoCreator: getInputValue('photo-creator'),
      photoCopyright: getInputValue('photo-copyright'),
    },
    onStatus: (message) => {
      statusElement.textContent = message;
    },
  });

  statusElement.textContent =
    result.tagging === null ? 'Upload finalized' : 'Tagged + upload finalized';
  resultOutput.textContent = JSON.stringify(result, null, 2);
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
