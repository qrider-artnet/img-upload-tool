import type { HttpFunction } from '@google-cloud/functions-framework';

import { createUploadFunctionApp } from './app.js';
import { readConfig } from './config.js';
import { UploadFunctionError } from './errors.js';
import { createGcsUploadStorage } from './storage/gcs-storage.js';
import { createR2ReplicationStorage } from './storage/r2-replication-storage.js';
import { InMemoryUploadSessionStore } from './upload-session-store.js';

const config = readConfig(process.env);
const app = createUploadFunctionApp({
  corsAllowOrigin: config.CORS_ALLOW_ORIGIN,
  publicBaseUrl: config.PUBLIC_BASE_URL,
  signedUrlTtlSeconds: config.SIGNED_URL_TTL_SECONDS,
  storage: createGcsUploadStorage({ bucketName: config.GCS_BUCKET }),
  replication: createR2ReplicationStorage({
    accountId: config.R2_ACCOUNT_ID,
    bucketName: config.R2_BUCKET,
    accessKeyId: config.R2_ACCESS_KEY_ID,
    secretAccessKey: config.R2_SECRET_ACCESS_KEY,
    maxRetries: config.R2_REPLICATION_RETRIES,
  }),
  uploadSessionStore: new InMemoryUploadSessionStore(),
});

/**
 * Cloud Run Functions HTTP entrypoint.
 */
export const uploadFunction: HttpFunction = async (req, res) => {
  const request = await createFetchRequest(req);
  const response = await app.fetch(request);

  res.status(response.status);
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });

  if (response.body === null) {
    res.end();
    return;
  }

  const body = Buffer.from(await response.arrayBuffer());
  res.send(body);
};

const createFetchRequest = async (req: Parameters<HttpFunction>[0]): Promise<Request> => {
  const headers = new Headers();

  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item);
      }
      continue;
    }

    headers.set(key, value);
  }

  const host = req.get('host') ?? 'localhost';
  const protocol = req.protocol;
  const url = new URL(req.originalUrl, `${protocol}://${host}`);
  const body = canHaveBody(req.method)
    ? (readRawBodyFromRequest(req) ?? (await readIncomingBody(req)))
    : undefined;
  const requestInit: RequestInit = {
    headers,
    method: req.method,
  };

  if (body !== undefined) {
    requestInit.body = body;
  }

  return new Request(url, requestInit);
};

const readIncomingBody = async (req: Parameters<HttpFunction>[0]): Promise<ArrayBuffer> =>
  await new Promise<ArrayBuffer>((resolve, reject) => {
    const chunks: Buffer[] = [];

    req.on('data', (chunk: unknown) => {
      if (Buffer.isBuffer(chunk)) {
        chunks.push(chunk);
        return;
      }

      if (typeof chunk === 'string') {
        chunks.push(Buffer.from(chunk));
      }
    });
    req.on('error', () => {
      reject(
        new UploadFunctionError({
          code: 'invalid_request',
          status: 400,
          message: 'Unable to read request body.',
        }),
      );
    });
    req.on('end', () => {
      const combined = Buffer.concat(chunks);
      const body = new ArrayBuffer(combined.byteLength);
      new Uint8Array(body).set(combined);
      resolve(body);
    });
  });

const readRawBodyFromRequest = (value: unknown): ArrayBuffer | undefined => {
  if (typeof value !== 'object' || value === null || !('rawBody' in value)) {
    return undefined;
  }

  const rawBody = value.rawBody;

  if (!Buffer.isBuffer(rawBody)) {
    return undefined;
  }

  const body = new ArrayBuffer(rawBody.byteLength);
  new Uint8Array(body).set(rawBody);
  return body;
};

const canHaveBody = (method: string): boolean => method !== 'GET' && method !== 'HEAD';
