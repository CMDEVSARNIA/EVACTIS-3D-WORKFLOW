/**
 * Chromium flags for the "network is blocked" mode (playwright.config.ts, and specs that
 * need extra flags, such as fake media devices): every hostname resolves to nothing and
 * a dead proxy takes anything that is not loopback.
 */
export const BLOCKED_NETWORK_ARGS = [
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
  '--proxy-server=http://127.0.0.1:9',
  '--proxy-bypass-list=127.0.0.1',
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-domain-reliability',
  '--no-pings',
];
