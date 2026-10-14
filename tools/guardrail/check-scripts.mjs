#!/usr/bin/env node
/**
 * Windows PowerShell 5.1 reads a .ps1 without a byte-order mark as Windows-1252, so a
 * UTF-8 em dash becomes a "smart quote" byte that silently breaks string parsing. Keep
 * every PowerShell script plain ASCII, and never use the automatic `$args`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dir = join(repo, 'scripts/windows');
let bad = 0;
for (const f of readdirSync(dir).filter((n) => n.endsWith('.ps1'))) {
  readFileSync(join(dir, f), 'utf8')
    .split('\n')
    .forEach((line, i) => {
      const at = `${relative(repo, join(dir, f))}:${i + 1}`;
      if (/[^\x00-\x7F]/.test(line)) {
        console.error(`${at}: non-ASCII character`);
        bad++;
      }
      // $args is PowerShell's automatic variable; reusing it (or splatting @args) has
      // already caused one silent signing failure.
      if (/[$@]args\b/i.test(line.replace(/#.*$/, ''))) {
        console.error(`${at}: do not use the automatic variable $args / @args`);
        bad++;
      }
    });
}
if (bad) process.exit(1);
console.log('PowerShell scripts are ASCII.');
