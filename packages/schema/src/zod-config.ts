import { z } from 'zod';

/**
 * No eval: Zod 4 otherwise probes `new Function` to compile fast parsers, which a strict
 * CSP (script-src 'self') reports as a violation. Imported first by every schema module
 * so it runs before any schema is constructed.
 */
z.config({ jitless: true });
