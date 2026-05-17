export interface R2ObjectBodyLike {
  readonly body: ReadableStream<Uint8Array>;
  readonly httpMetadata?: {
    readonly contentType?: string;
    readonly cacheControl?: string;
  };
  readonly customMetadata?: Record<string, string>;
  writeHttpMetadata?(headers: Headers): void;
}

export interface R2BucketLike {
  get(key: string): Promise<R2ObjectBodyLike | null>;
  put(
    key: string,
    value: ReadableStream<Uint8Array> | ArrayBuffer | Blob | string | null,
    options?: R2PutOptionsLike,
  ): Promise<unknown>;
}

export interface R2PutOptionsLike {
  readonly httpMetadata?: {
    readonly contentType?: string;
    readonly cacheControl?: string;
  };
}

export interface ImagesBindingLike {
  input(stream: ReadableStream<Uint8Array>): ImagesInputLike;
}

export interface ImagesInputLike {
  transform(options: ImageTransformOptions): ImagesInputLike;
  output(options: ImageOutputOptions): Promise<ImagesOutputLike>;
}

export interface ImagesOutputLike {
  response(): Response;
}

export interface ImageTransformOptions {
  readonly width?: number;
  readonly height?: number;
  readonly fit: 'cover' | 'scale-down';
}

export interface ImageOutputOptions {
  readonly format: 'image/webp';
  readonly quality: number;
}

export interface Env {
  readonly R2_PRIMARY: R2BucketLike;
  readonly IMAGES: ImagesBindingLike;
}
