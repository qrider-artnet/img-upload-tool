import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { embed } from './embed.js';
import { parseMetadataDocument } from './schema.js';

// Minimal HTTP bridge so a browser (which can't run exiftool) can tag images:
// POST /tag { imageBase64, metadata, stripPrivacy? } -> { imageBase64, format, ... }.
// The browser then continues its own presign -> PUT -> finalize with the tagged
// bytes, preserving the direct-to-GCS upload. Demo/dev tool, not production.

const PORT = Number(process.env.TAG_SERVER_PORT ?? '8090');
const ALLOW_ORIGIN = process.env.TAG_SERVER_ALLOW_ORIGIN ?? '*';

interface TagPayload {
  readonly imageBase64: string;
  readonly metadata: unknown;
  readonly stripPrivacy: boolean;
}

const handleTag = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  try {
    const payload = parsePayload(await readBody(req));
    const metadata = parseMetadataDocument(payload.metadata);
    const image = Buffer.from(payload.imageBase64, 'base64');
    const result = await embed(image, metadata, { stripPrivacy: payload.stripPrivacy });

    respondJson(res, 200, {
      imageBase64: result.bytes.toString('base64'),
      format: result.format,
      verification: result.verification,
      privacyStripped: result.privacyStripped,
    });
  } catch (error: unknown) {
    respondJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
  }
};

const server = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }
  if (req.method !== 'POST' || req.url !== '/tag') {
    respondJson(res, 404, { error: 'Not found. Use POST /tag.' });
    return;
  }
  void handleTag(req, res);
});

const parsePayload = (body: string): TagPayload => {
  const json: unknown = JSON.parse(body);
  if (typeof json !== 'object' || json === null) {
    throw new Error('Expected a JSON object body.');
  }
  const record = json as Record<string, unknown>;
  const imageBase64 = record['imageBase64'];
  if (typeof imageBase64 !== 'string' || imageBase64.length === 0) {
    throw new Error('imageBase64 (non-empty string) is required.');
  }
  const stripPrivacy = record['stripPrivacy'];
  return {
    imageBase64,
    metadata: record['metadata'],
    stripPrivacy: typeof stripPrivacy === 'boolean' ? stripPrivacy : true,
  };
};

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });

const respondJson = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

server.listen(PORT, () => {
  console.log(`metadata-tagger tag server on http://localhost:${PORT} (POST /tag)`);
});
