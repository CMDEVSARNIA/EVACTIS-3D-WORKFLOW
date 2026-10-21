import { defineConfig } from 'vitest/config';

// Server tests live in test/; vite.config.ts is for the pages (its root is web/).
export default defineConfig({
  test: {
    root: __dirname,
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
