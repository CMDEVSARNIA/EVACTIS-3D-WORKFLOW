import { defineConfig } from 'vitest/config';

// Each test builds real PDFs and reads them back with poppler: seconds, not milliseconds.
export default defineConfig({ test: { testTimeout: 60_000 } });
