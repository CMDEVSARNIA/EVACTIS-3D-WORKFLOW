#!/usr/bin/env node
/**
 * Judges smoke reports written by the desktop apps (`--smoke-test <report.json>`,
 * crates/evx-core/src/smoke.rs). Each argument is a report path, optionally followed
 * by "=import" (the run must also have imported media), "=environment" (the Viewer must
 * have opened a package) or "=refused:<text>" (the run must have refused, with an error
 * containing <text>: a wrong passphrase, an altered file).
 *
 * A report passes when the UI rendered, no network request was attempted or blocked
 * (CSP violations count), and no error was reported (unless a refusal was expected);
 * import and environment runs must also list what they verified. Exits 1 on any failure.
 */
import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';

let failed = 0;
for (const arg of process.argv.slice(2)) {
  const [path, kind = ''] = arg.split('=');
  const refusal = kind.startsWith('refused:') ? kind.slice('refused:'.length) : null;
  const name = basename(path, '.json');
  const problems = [];
  if (!existsSync(path)) {
    problems.push('no report written (the app did not finish)');
  } else {
    const r = JSON.parse(readFileSync(path, 'utf8'));
    if (r.uiReady !== true) problems.push('UI did not report ready');
    if (refusal !== null) {
      if (!r.error?.includes(refusal))
        problems.push(`expected a refusal (“${refusal}”), got: ${r.error ?? 'none'}`);
      else console.log(`   ${name}: refused as expected: ${r.error}`);
    } else if (r.error) problems.push(`error: ${r.error}`);
    for (const b of r.blockedRequests ?? []) problems.push(`blocked or attempted request: ${b}`);
    if ((kind === 'import' || kind === 'environment') && !(r.checks ?? []).length)
      problems.push(`${kind} run listed no checks`);
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
