import { describe, expect, it } from 'vitest';

import type {
  CacheLike,
  Env,
  ImageOutputOptions,
  ImagesBindingLike,
  ImagesInputLike,
  ImageTransformOptions,
  R2BucketLike,
  R2ObjectBodyLike,
  R2PutOptionsLike,
} from './bindings.js';
import { handleRequest } from './worker.js';

const OBJECT_KEY = 'lot_images/425939177/20260310/638775/195.jpg';
const VARIANT_KEY = 'variants/webp/w640/lot_images/425939177/20260310/638775/195.webp';
const PRODUCT_OBJECT_KEYS = [
  'products/galleries/artworks/gallery-1/artwork-1/images/195.jpg',
  'products/artnet-auctions/auction-lots/425939177/20260310/638775/images/195.jpg',
  'products/pdb/artworks/pdb-123/images/195.jpg',
] as const;

describe('Variant Worker', () => {
  it('returns original bytes from R2', async () => {
    const env = createEnv();
    env.R2_PRIMARY.objects.set(
      OBJECT_KEY,
      createR2Object('original-bytes', { httpMetadata: { contentType: 'image/jpeg' } }),
    );

    const response = await handleRequest(new Request(`https://artworks.test/${OBJECT_KEY}`), env);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(await response.text()).toBe('original-bytes');
  });

  it('returns a stored WebP variant without transforming', async () => {
    const env = createEnv();
    env.R2_PRIMARY.objects.set(VARIANT_KEY, createR2Object('stored-webp'));
    env.R2_PRIMARY.objects.set(OBJECT_KEY, createR2Object('original-bytes'));

    const response = await handleRequest(
      new Request(`https://artworks.test/${OBJECT_KEY}?variant=w640`),
      env,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/webp');
    expect(await response.text()).toBe('stored-webp');
    expect(env.IMAGES.transforms).toEqual([]);
    expect(env.R2_PRIMARY.puts).toEqual([]);
  });

  it.each(PRODUCT_OBJECT_KEYS)(
    'returns product-prefixed original bytes from R2: %s',
    async (key) => {
      const env = createEnv();
      env.R2_PRIMARY.objects.set(
        key,
        createR2Object('original-bytes', { httpMetadata: { contentType: 'image/jpeg' } }),
      );

      const response = await handleRequest(new Request(`https://artworks.test/${key}`), env);

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/jpeg');
      expect(await response.text()).toBe('original-bytes');
    },
  );

  it.each(PRODUCT_OBJECT_KEYS)('transforms product-prefixed variants: %s', async (key) => {
    const env = createEnv();
    env.R2_PRIMARY.objects.set(key, createR2Object('original-bytes'));

    const response = await handleRequest(
      new Request(`https://artworks.test/${key}?variant=w640`),
      env,
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('webp:w640:original-bytes');
    expect(env.R2_PRIMARY.puts[0]?.key).toBe(
      `variants/webp/w640/${key.replace(/\.jpg$/, '.webp')}`,
    );
  });

  it('transforms, stores, and returns a variant on R2 miss', async () => {
    const env = createEnv();
    env.R2_PRIMARY.objects.set(OBJECT_KEY, createR2Object('original-bytes'));

    const response = await handleRequest(
      new Request(`https://artworks.test/${OBJECT_KEY}?variant=w640`),
      env,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/webp');
    expect(await response.text()).toBe('webp:w640:original-bytes');
    expect(env.IMAGES.transforms).toEqual([{ width: 640, fit: 'scale-down' }]);
    expect(env.IMAGES.outputs).toEqual([{ format: 'image/webp', quality: 82 }]);
    expect(env.R2_PRIMARY.puts).toEqual([
      {
        key: VARIANT_KEY,
        value: 'webp:w640:original-bytes',
        options: {
          httpMetadata: {
            contentType: 'image/webp',
            cacheControl: 'public, max-age=31536000, immutable',
          },
        },
      },
    ]);
  });

  it('serves legacy o.jpg URLs from the large variant of the canonical original', async () => {
    const env = createEnv();
    env.R2_PRIMARY.objects.set(
      OBJECT_KEY,
      createR2Object('original-bytes', {
        customMetadata: { 'cache-version': '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      }),
    );

    const response = await handleRequest(
      new Request(
        'https://artworks.test/_v/01ARZ3NDEKTSV4RRFFQ69G5FAV/lot_images/425939177/20260310/638775/195o.jpg',
      ),
      env,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/webp');
    expect(await response.text()).toBe('webp:w1600:original-bytes');
    expect(env.IMAGES.transforms).toEqual([{ width: 1600, fit: 'scale-down' }]);
    expect(env.R2_PRIMARY.puts[0]?.key).toBe(
      'variants/webp/w1600/lot_images/425939177/20260310/638775/195/_v/01ARZ3NDEKTSV4RRFFQ69G5FAV.webp',
    );
  });

  it('rejects versioned URLs when the original cache version does not match', async () => {
    const env = createEnv();
    env.R2_PRIMARY.objects.set(
      OBJECT_KEY,
      createR2Object('original-bytes', {
        customMetadata: { 'cache-version': '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      }),
    );

    const response = await handleRequest(
      new Request(`https://artworks.test/_v/01BX5ZZKBKACTAV9WEVGEMMVRZ/${OBJECT_KEY}?variant=w640`),
      env,
    );

    expect(response.status).toBe(404);
    expect(env.R2_PRIMARY.puts).toEqual([]);
  });

  it('returns image_not_found when the original is missing', async () => {
    const env = createEnv();

    const response = await handleRequest(
      new Request(`https://artworks.test/${OBJECT_KEY}?variant=w640`),
      env,
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: {
        code: 'image_not_found',
        message: 'Image was not found.',
      },
    });
  });

  it('returns invalid_variant for unsupported variants and query params', async () => {
    const env = createEnv();

    const invalidVariant = await handleRequest(
      new Request(`https://artworks.test/${OBJECT_KEY}?variant=tiny`),
      env,
    );
    const invalidQuery = await handleRequest(
      new Request(`https://artworks.test/${OBJECT_KEY}?w=640`),
      env,
    );

    expect(invalidVariant.status).toBe(400);
    expect(await readErrorCode(invalidVariant)).toBe('invalid_variant');
    expect(invalidQuery.status).toBe(400);
    expect(await readErrorCode(invalidQuery)).toBe('invalid_variant');
  });

  it('reports a MISS served from R2 when no edge cache is wired', async () => {
    const env = createEnv();
    env.R2_PRIMARY.objects.set(OBJECT_KEY, createR2Object('original-bytes'));

    const response = await handleRequest(new Request(`https://artworks.test/${OBJECT_KEY}`), env);

    expect(response.headers.get('x-cache')).toBe('MISS');
    expect(response.headers.get('x-cache-source')).toBe('r2');
  });

  it('reports X-Cache-Source images for a freshly generated variant', async () => {
    const env = createEnv();
    env.R2_PRIMARY.objects.set(OBJECT_KEY, createR2Object('original-bytes'));

    const response = await handleRequest(
      new Request(`https://artworks.test/${OBJECT_KEY}?variant=w640`),
      env,
    );

    expect(response.headers.get('x-cache')).toBe('MISS');
    expect(response.headers.get('x-cache-source')).toBe('images');
  });

  it('reports X-Cache-Source r2 for a persisted variant', async () => {
    const env = createEnv();
    env.R2_PRIMARY.objects.set(VARIANT_KEY, createR2Object('stored-webp'));
    env.R2_PRIMARY.objects.set(OBJECT_KEY, createR2Object('original-bytes'));

    const response = await handleRequest(
      new Request(`https://artworks.test/${OBJECT_KEY}?variant=w640`),
      env,
    );

    expect(response.headers.get('x-cache')).toBe('MISS');
    expect(response.headers.get('x-cache-source')).toBe('r2');
  });

  it('stores a MISS in the edge cache and serves a HIT on the next request', async () => {
    const env = createEnv();
    env.R2_PRIMARY.objects.set(
      OBJECT_KEY,
      createR2Object('original-bytes', { httpMetadata: { contentType: 'image/jpeg' } }),
    );
    const cache = new FakeCache();
    const url = `https://artworks.test/${OBJECT_KEY}`;

    const first = await handleRequest(new Request(url), env, cache);
    expect(first.headers.get('x-cache')).toBe('MISS');
    expect(first.headers.get('x-cache-source')).toBe('r2');
    expect(cache.puts).toEqual([url]);

    const second = await handleRequest(new Request(url), env, cache);
    expect(second.headers.get('x-cache')).toBe('HIT');
    expect(second.headers.get('x-cache-source')).toBe('edge');
    expect(second.headers.get('content-type')).toBe('image/jpeg');
    expect(second.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(await second.text()).toBe('original-bytes');
  });

  it('serves a generated variant from the edge cache without transforming again', async () => {
    const env = createEnv();
    env.R2_PRIMARY.objects.set(OBJECT_KEY, createR2Object('original-bytes'));
    const cache = new FakeCache();
    const url = `https://artworks.test/${OBJECT_KEY}?variant=w640`;

    const first = await handleRequest(new Request(url), env, cache);
    expect(first.headers.get('x-cache')).toBe('MISS');
    expect(first.headers.get('x-cache-source')).toBe('images');
    expect(env.IMAGES.transforms).toHaveLength(1);

    const second = await handleRequest(new Request(url), env, cache);
    expect(second.headers.get('x-cache')).toBe('HIT');
    expect(second.headers.get('x-cache-source')).toBe('edge');
    expect(second.headers.get('content-type')).toBe('image/webp');
    // Served from the edge — no second transform.
    expect(env.IMAGES.transforms).toHaveLength(1);
  });
});

interface FakeEnv extends Env {
  readonly R2_PRIMARY: FakeR2Bucket;
  readonly IMAGES: FakeImagesBinding;
}

class FakeCache implements CacheLike {
  public readonly store = new Map<string, Response>();

  public readonly puts: string[] = [];

  public match(request: Request): Promise<Response | undefined> {
    const cached = this.store.get(request.url);
    return Promise.resolve(cached === undefined ? undefined : cached.clone());
  }

  public put(request: Request, response: Response): void {
    this.puts.push(request.url);
    this.store.set(request.url, response);
  }
}

const createEnv = (): FakeEnv => ({
  R2_PRIMARY: new FakeR2Bucket(),
  IMAGES: new FakeImagesBinding(),
});

class FakeR2Bucket implements R2BucketLike {
  public readonly objects = new Map<string, R2ObjectBodyLike>();

  public readonly puts: Array<{
    readonly key: string;
    readonly value: string;
    readonly options?: R2PutOptionsLike;
  }> = [];

  public get(key: string): Promise<R2ObjectBodyLike | null> {
    return Promise.resolve(this.objects.get(key) ?? null);
  }

  public async put(
    key: string,
    value: ReadableStream<Uint8Array> | ArrayBuffer | Blob | string | null,
    options?: R2PutOptionsLike,
  ): Promise<unknown> {
    const storedValue = await readBody(value);
    this.puts.push(
      options === undefined ? { key, value: storedValue } : { key, value: storedValue, options },
    );
    this.objects.set(
      key,
      createR2Object(
        storedValue,
        options?.httpMetadata === undefined ? {} : { httpMetadata: options.httpMetadata },
      ),
    );
    return undefined;
  }
}

class FakeImagesBinding implements ImagesBindingLike {
  public readonly transforms: ImageTransformOptions[] = [];

  public readonly outputs: ImageOutputOptions[] = [];

  public input(stream: ReadableStream<Uint8Array>): ImagesInputLike {
    return new FakeImagesInput(stream, this.transforms, this.outputs);
  }
}

class FakeImagesInput implements ImagesInputLike {
  public constructor(
    private readonly stream: ReadableStream<Uint8Array>,
    private readonly transforms: ImageTransformOptions[],
    private readonly outputs: ImageOutputOptions[],
  ) {}

  public transform(options: ImageTransformOptions): ImagesInputLike {
    this.transforms.push(options);
    return this;
  }

  public async output(options: ImageOutputOptions): Promise<{ response(): Response }> {
    this.outputs.push(options);
    const source = await readBody(this.stream);
    const width = this.transforms.at(-1)?.width ?? 'original';
    return {
      response: () => new Response(`webp:w${width}:${source}`),
    };
  }
}

const createR2Object = (
  value: string,
  metadata: {
    readonly customMetadata?: R2ObjectBodyLike['customMetadata'];
    readonly httpMetadata?: R2ObjectBodyLike['httpMetadata'];
  } = {},
): R2ObjectBodyLike => ({
  body: new Response(value).body ?? new ReadableStream<Uint8Array>(),
  httpMetadata: metadata.httpMetadata ?? {},
  ...(metadata.customMetadata === undefined ? {} : { customMetadata: metadata.customMetadata }),
  writeHttpMetadata: (headers) => {
    const httpMetadata = metadata.httpMetadata ?? {};
    if (httpMetadata.contentType !== undefined) {
      headers.set('Content-Type', httpMetadata.contentType);
    }
    if (httpMetadata.cacheControl !== undefined) {
      headers.set('Cache-Control', httpMetadata.cacheControl);
    }
  },
});

const readBody = async (
  value: ReadableStream<Uint8Array> | ArrayBuffer | Blob | string | null,
): Promise<string> => {
  if (value === null) {
    return '';
  }
  return await new Response(value).text();
};

const readErrorCode = async (response: Response): Promise<string | undefined> => {
  const body: unknown = await response.json();
  if (typeof body !== 'object' || body === null || !('error' in body)) {
    return undefined;
  }

  const error = body.error;
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }

  return typeof error.code === 'string' ? error.code : undefined;
};
