import { readFile } from 'node:fs/promises';

/**
 * Reads image bytes from a local path, a `gs://bucket/key` URI (via the GCS
 * SDK, imported lazily so the dependency is only loaded when used), or an HTTPS
 * URL. For an Access-gated delivery URL, pass service-token headers.
 */
export const readImageSource = async (
  source: string,
  httpHeaders: Record<string, string> = {},
): Promise<Buffer> => {
  if (source.startsWith('gs://')) {
    return readGcs(source);
  }
  if (source.startsWith('http://') || source.startsWith('https://')) {
    return readHttps(source, httpHeaders);
  }
  return readFile(source);
};

const readHttps = async (url: string, headers: Record<string, string>): Promise<Buffer> => {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status} ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
};

const readGcs = async (uri: string): Promise<Buffer> => {
  const match = /^gs:\/\/([^/]+)\/(.+)$/.exec(uri);
  if (match === null) {
    throw new Error(`Invalid GCS URI: ${uri}`);
  }
  const bucket = match[1];
  const key = match[2];
  if (bucket === undefined || key === undefined) {
    throw new Error(`Invalid GCS URI: ${uri}`);
  }
  const { Storage } = await import('@google-cloud/storage');
  const [contents] = await new Storage().bucket(bucket).file(key).download();
  return contents;
};
