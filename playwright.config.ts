import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end and visual tests. Every test runs in "network is blocked" mode (see
 * e2e/offline.ts): requests to anything but the local test server fail the test.
 */
const PORT = 4173;

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}-{platform}{ext}',
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01, threshold: 0.2, animations: 'disabled' } },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    serviceWorkers: 'block',
    launchOptions: {
      args: [
        '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
        '--proxy-server=http://127.0.0.1:9',
        '--proxy-bypass-list=127.0.0.1',
        '--disable-background-networking',
        '--disable-component-update',
        '--disable-domain-reliability',
        '--no-pings',
      ],
    },
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: /viewer-mobile/,
      use: { ...devices['Desktop Chrome'], deviceScaleFactor: 1 },
    },
    {
      name: 'mobile',
      testMatch: /viewer-(mobile|shared)/,
      use: { ...devices['Pixel 7'], deviceScaleFactor: 1 },
    },
  ],
  webServer: [
    ['packages/brand/sheet-dist', PORT],
    ['apps/studio/dist', PORT + 1],
    ['apps/viewer-desktop/dist', PORT + 2],
    ['packages/viewer/demo-dist', PORT + 3],
  ]
    .map(([dir, port]) => ({
      command: `node tools/static-server.mjs ${dir} ${port}`,
      url: `http://127.0.0.1:${port}/index.html`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    }))
    .concat({
      // Tiles made by the Studio pipeline (Rust), shown by the Viewer demo page.
      command: `node e2e/fixtures/studio-tiles.mjs && node tools/static-server.mjs target/e2e-studio-tiles ${PORT + 4}`,
      url: `http://127.0.0.1:${PORT + 4}/index.html`,
      reuseExistingServer: !process.env.CI,
      timeout: 300_000,
    })
    .concat({
      // Studio's browser test build over media imported by the real pipeline (Rust).
      command: `node e2e/fixtures/studio-project.mjs && node tools/static-server.mjs target/e2e-studio-project ${PORT + 5}`,
      url: `http://127.0.0.1:${PORT + 5}/index.html`,
      reuseExistingServer: !process.env.CI,
      timeout: 300_000,
    }),
});
