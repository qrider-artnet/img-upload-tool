import { z } from 'zod';

const SessionStoreModeSchema = z.enum(['redis', 'memory']);

export type SessionStoreMode = z.infer<typeof SessionStoreModeSchema>;

const EnvSchema = z
  .object({
    GCS_BUCKET: z.string().min(1),
    PUBLIC_BASE_URL: z.url(),
    CORS_ALLOW_ORIGIN: z.string().min(1).default('*'),
    SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    R2_ACCOUNT_ID: z.string().min(1),
    R2_BUCKET: z.string().min(1),
    R2_ACCESS_KEY_ID: z.string().min(1),
    R2_SECRET_ACCESS_KEY: z.string().min(1),
    R2_REPLICATION_RETRIES: z.coerce.number().int().min(0).default(3),
    S3_SOURCE_ENDPOINT: z.url(),
    S3_SOURCE_REGION: z.string().min(1),
    S3_SOURCE_ACCESS_KEY_ID: z.string().min(1),
    S3_SOURCE_SECRET_ACCESS_KEY: z.string().min(1),
    S3_SOURCE_ALLOWED_BUCKETS: z
      .string()
      .min(1)
      .transform((value) =>
        value
          .split(',')
          .map((bucket) => bucket.trim())
          .filter((bucket) => bucket.length > 0),
      )
      .refine((buckets) => buckets.length > 0, {
        message: 'S3_SOURCE_ALLOWED_BUCKETS must include at least one bucket.',
      }),
    SESSION_STORE: SessionStoreModeSchema.optional(),
    REDIS_URL: z.url().optional(),
    REDIS_KEY_PREFIX: z.string().min(1).default('upload-session:'),
  })
  .passthrough();

/**
 * Runtime configuration validated from environment variables.
 */
export interface UploadFunctionConfig {
  readonly GCS_BUCKET: string;
  readonly PUBLIC_BASE_URL: string;
  readonly CORS_ALLOW_ORIGIN: string;
  readonly SIGNED_URL_TTL_SECONDS: number;
  readonly R2_ACCOUNT_ID: string;
  readonly R2_BUCKET: string;
  readonly R2_ACCESS_KEY_ID: string;
  readonly R2_SECRET_ACCESS_KEY: string;
  readonly R2_REPLICATION_RETRIES: number;
  readonly S3_SOURCE_ENDPOINT: string;
  readonly S3_SOURCE_REGION: string;
  readonly S3_SOURCE_ACCESS_KEY_ID: string;
  readonly S3_SOURCE_SECRET_ACCESS_KEY: string;
  readonly S3_SOURCE_ALLOWED_BUCKETS: readonly string[];
  readonly SESSION_STORE: SessionStoreMode;
  readonly REDIS_URL?: string;
  readonly REDIS_KEY_PREFIX: string;
}

/**
 * Validates environment configuration at process startup.
 */
export const readConfig = (env: NodeJS.ProcessEnv): UploadFunctionConfig => {
  const parsed = EnvSchema.parse(env);

  return {
    GCS_BUCKET: parsed.GCS_BUCKET,
    PUBLIC_BASE_URL: parsed.PUBLIC_BASE_URL,
    CORS_ALLOW_ORIGIN: parsed.CORS_ALLOW_ORIGIN,
    SIGNED_URL_TTL_SECONDS: parsed.SIGNED_URL_TTL_SECONDS,
    R2_ACCOUNT_ID: parsed.R2_ACCOUNT_ID,
    R2_BUCKET: parsed.R2_BUCKET,
    R2_ACCESS_KEY_ID: parsed.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: parsed.R2_SECRET_ACCESS_KEY,
    R2_REPLICATION_RETRIES: parsed.R2_REPLICATION_RETRIES,
    S3_SOURCE_ENDPOINT: parsed.S3_SOURCE_ENDPOINT,
    S3_SOURCE_REGION: parsed.S3_SOURCE_REGION,
    S3_SOURCE_ACCESS_KEY_ID: parsed.S3_SOURCE_ACCESS_KEY_ID,
    S3_SOURCE_SECRET_ACCESS_KEY: parsed.S3_SOURCE_SECRET_ACCESS_KEY,
    S3_SOURCE_ALLOWED_BUCKETS: parsed.S3_SOURCE_ALLOWED_BUCKETS,
    SESSION_STORE: parsed.SESSION_STORE ?? defaultSessionStoreMode(env),
    ...(parsed.REDIS_URL === undefined ? {} : { REDIS_URL: parsed.REDIS_URL }),
    REDIS_KEY_PREFIX: parsed.REDIS_KEY_PREFIX,
  };
};

export const defaultSessionStoreMode = (env: NodeJS.ProcessEnv): SessionStoreMode =>
  isTestEnvironment(env) ? 'memory' : 'redis';

const isTestEnvironment = (env: NodeJS.ProcessEnv): boolean =>
  env.NODE_ENV === 'test' || env.VITEST === 'true' || env.VITEST_WORKER_ID !== undefined;
