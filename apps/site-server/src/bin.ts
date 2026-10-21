import './quiet.ts';
import { ConfigError } from './config.ts';
import { start } from './main.ts';

start().catch((e: unknown) => {
  console.error(e instanceof ConfigError ? `Configuration: ${e.message}` : e);
  process.exit(1);
});
