// Default target is the deployed QA Upload Function. Override with
// E2E_UPLOAD_FUNCTION_URL to point the suite at a different environment.
const DEFAULT_UPLOAD_FUNCTION_URL =
  'https://artnet-qa-upload-function-566327068481.us-east4.run.app';

export interface E2eConfig {
  readonly uploadFunctionUrl: string;
  readonly accessClientId: string | undefined;
  readonly accessClientSecret: string | undefined;
}

export const config: E2eConfig = {
  uploadFunctionUrl: process.env.E2E_UPLOAD_FUNCTION_URL ?? DEFAULT_UPLOAD_FUNCTION_URL,
  accessClientId: process.env.CF_ACCESS_CLIENT_ID,
  accessClientSecret: process.env.CF_ACCESS_CLIENT_SECRET,
};

/**
 * The read path (artworks.artnet-dev.com) is behind Cloudflare Access. Read-path
 * tests need a service token; without one they skip rather than fail.
 */
export const hasAccessServiceToken = (): boolean =>
  config.accessClientId !== undefined && config.accessClientSecret !== undefined;

export const accessHeaders = (): Record<string, string> => {
  const { accessClientId, accessClientSecret } = config;
  if (accessClientId === undefined || accessClientSecret === undefined) {
    return {};
  }
  return {
    'CF-Access-Client-Id': accessClientId,
    'CF-Access-Client-Secret': accessClientSecret,
  };
};
