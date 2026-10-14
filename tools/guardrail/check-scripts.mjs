#!/usr/bin/env node
/**
 * Windows PowerShell 5.1 reads a .ps1 without a byte-order mark as Windows-1252, so a
 * UTF-8 em dash becomes a "smart quote" byte that silently breaks string parsing. Keep
 * every PowerShell script plain ASCII.
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
      if (/[^\x00-\x7F]/.test(line)) {
        console.error(`${relative(repo, join(dir, f))}:${i + 1}: non-ASCII character`);
        bad++;
      }
    });
}
if (bad) process.exit(1);
console.log('PowerShell scripts are ASCII.');
