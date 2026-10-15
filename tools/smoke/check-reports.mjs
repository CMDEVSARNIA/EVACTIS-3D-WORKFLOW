#!/usr/bin/env node
/**
 * Judges smoke reports written by the desktop apps (`--smoke-test <report.json>`,
 * crates/evx-core/src/smoke.rs). Each argument is a report path, optionally followed
 * by "=import" when the run must also have imported media.
 *
 * A report passes when the UI rendered, no network request was attempted or blocked
 * (CSP violations count), and no error was reported; an import run must also list
 * what it verified. Exits 1 on any failure.
 */
import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';

let failed = 0;
for (const arg of process.argv.slice(2)) {
  const [path, kind] = arg.split('=');
  const name = basename(path, '.json');
  const problems = [];
  if (!existsSync(path)) {
    problems.push('no report written (the app did not finish)');
  } else {
    const r = JSON.parse(readFileSync(path, 'utf8'));
    if (r.uiReady !== true) problems.push('UI did not report ready');
    if (r.error) problems.push(`error: ${r.error}`);
    for (const b of r.blockedRequests ?? []) problems.push(`blocked or attempted request: ${b}`);
    if (kind === 'import' && !(r.checks ?? []).length) problems.push('import run listed no checks');
    for (const c of r.checks ?? []) console.log(`   ${name}: ${c}`);
  }
  if (problems.length) {
    failed++;
    console.log(`FAIL ${name}`);
    for (const p of problems) console.log(`     ${p}`);
  } else {
    console.log(`PASS ${name}`);
  }
}
if (failed) {
  console.error(`${failed} real-app smoke run(s) failed`);
  process.exit(1);
}
