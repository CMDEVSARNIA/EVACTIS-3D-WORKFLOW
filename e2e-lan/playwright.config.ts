import { defineConfig } from '@playwright/test';

/**
 * The isolated-network acceptance (Phase 11). Run only by scripts/linux/site-server-lan.sh,
 * which builds the network (machines A and B, the server, no way out) and passes the
 * addresses and per-machine browsers in the environment.
 */
export default defineConfig({
  testDir: '.',
  outputDir: '../target/site-lan/results',
  retries: 0,
  workers: 1,
  timeout: 240_000,
  reporter: 'list',
});
