// A minimal valid 1x1 JPEG (160 bytes), used as the upload fixture so the suite
// is self-contained and does not depend on files in other components.
const SAMPLE_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRof' +
  'Hh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAAB' +
  'AAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwD/2Q==';

export const sampleJpeg = (): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(Buffer.from(SAMPLE_JPEG_BASE64, 'base64'));
