import type { Env } from './bindings.js';
import { handleRequest } from './worker.js';

export default {
  fetch: handleRequest,
} satisfies ExportedHandler<Env>;
