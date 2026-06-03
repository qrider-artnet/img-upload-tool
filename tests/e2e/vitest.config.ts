import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/*.e2e.test.ts'],
    // e2e hits real services (network + image transforms), so allow generous timeouts.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Run files sequentially to avoid hammering the lower environment.
    fileParallelism: false,
  },
});
