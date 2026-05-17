import { z } from 'zod';

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
  })
  .passthrough();

/**
 * Runtime configuration validated from environment variables.
 */
export type UploadFunctionConfig = z.infer<typeof EnvSchema>;

/**
 * Validates environment configuration at process startup.
 */
export const readConfig = (env: NodeJS.ProcessEnv): UploadFunctionConfig => EnvSchema.parse(env);
