import './quiet.ts';
import { ConfigError } from './config.ts';
import { parseArgs } from 'node:util';
import { start } from './main.ts';
import { installTask, uninstallTask } from './windows.ts';

const [command, ...rest] = process.argv.slice(2);
const run =
  command === 'install-task'
    ? async () =>
        installTask(parseArgs({ args: rest, options: { data: { type: 'string' } } }).values.data)
    : command === 'uninstall-task'
      ? async () => uninstallTask()
      : () => start();

run().catch((e: unknown) => {
  console.error(e instanceof ConfigError ? `Configuration: ${e.message}` : e);
  process.exit(1);
});
