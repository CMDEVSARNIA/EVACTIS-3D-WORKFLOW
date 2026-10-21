import { test } from 'node:test';
import assert from 'node:assert/strict';
import { annotation, buildTask, parseReport, reviewable, summaryMarkdown } from './report.mjs';

test('keeps code and drops media, lockfiles, baselines and prose', () => {
  const files = reviewable(
    [
      'M\tapps/site-server/src/auth.ts',
      'A\tcrates/evx-package/src/lib.rs',
      'D\tpackages/viewer/src/old.ts',
      'M\tpnpm-lock.yaml',
      'M\te2e/__screenshots__/viewer.spec.ts/lobby.png',
      'A\tbrand/evactis-logo-mark.png',
      'M\tdocs/it-deployment.md',
      'M\t.github/workflows/ci.yml',
      '',
    ].join('\n'),
  );
  assert.deepEqual(files, [
    { status: 'M', path: 'apps/site-server/src/auth.ts' },
    { status: 'A', path: 'crates/evx-package/src/lib.rs' },
    { status: 'D', path: 'packages/viewer/src/old.ts' },
    { status: 'M', path: '.github/workflows/ci.yml' },
  ]);
});

test('the task names the commit, the scope and the report format', () => {
  const o = {
    repository: 'o/r',
    sha: 'abc',
    ref: 'main',
    mountPath: '/workspace/repo',
    scope: /** @type {const} */ ('changes'),
    base: 'def',
    files: [{ status: 'M', path: 'a.ts' }],
    diff: 'x'.repeat(200_000),
  };
  const task = buildTask(o);
  assert.match(task, /checked out at commit abc \(main\)/);
  assert.match(task, /changes from def to abc/);
  assert.match(task, /- M a\.ts/);
  assert.match(task, /cut at 150000 characters/);
  assert.ok(task.length < 160_000);
  assert.match(task, /Read and report only/);
  const full = buildTask({ ...o, scope: 'full' });
  assert.match(full, /whole code base/);
  assert.doesNotMatch(full, /```diff/);
});

test('reads findings from the last JSON block and drops malformed ones', () => {
  const text = [
    'Looked at the auth module.',
    '```json',
    '{"findings": []}',
    '```',
    'Final answer:',
    '```json',
    JSON.stringify({
      findings: [
        { file: './b.ts', line: 3, severity: 'Low', title: 'Minor', detail: 'd', fix: 'f' },
        { file: 'a.ts', line: 10, severity: 'critical', title: 'Bad', detail: 'd', fix: 'f' },
        { file: 'a.ts', line: 'x', severity: 'high', title: 'No line' },
        { file: '../etc/passwd', severity: 'high', title: 'Outside' },
        { file: 'c.ts', severity: 'urgent', title: 'Unknown severity' },
        { severity: 'high', title: 'No file' },
      ],
    }),
    '```',
  ].join('\n');
  const r = parseReport(text);
  assert.equal(r.parsed, true);
  assert.equal(r.dropped, 3);
  assert.deepEqual(
    r.findings.map((f) => [f.severity, f.file, f.line]),
    [
      ['critical', 'a.ts', 10],
      ['high', 'a.ts', undefined],
      ['low', 'b.ts', 3],
    ],
  );
  assert.match(r.summary, /Final answer:/);
  assert.doesNotMatch(r.summary, /"critical"/);
});

test('a report without JSON is kept as text', () => {
  const r = parseReport('Could not finish.');
  assert.equal(r.parsed, false);
  assert.deepEqual(r.findings, []);
  assert.equal(r.summary, 'Could not finish.');
});

test('annotations escape workflow-command characters', () => {
  const line = annotation({
    file: 'a,b:c.ts',
    line: 7,
    severity: 'high',
    title: 'Off by one, again',
    detail: '100% wrong\nsecond line',
    fix: '',
  });
  assert.equal(
    line,
    '::warning file=a%2Cb%3Ac.ts,line=7,title=HIGH%3A Off by one%2C again::100%25 wrong%0Asecond line',
  );
  assert.match(
    annotation({ file: 'x', severity: 'low', title: 't', detail: '', fix: '' }),
    /^::notice /,
  );
});

test('the summary counts by severity and escapes table cells', () => {
  const md = summaryMarkdown({
    heading: 'Bug scan',
    facts: ['Commit abc'],
    findings: [
      { file: 'a.ts', line: 1, severity: 'high', title: 'A | B', detail: 'x\ny', fix: 'z' },
      { file: 'b.ts', severity: 'low', title: 'C', detail: '', fix: '' },
    ],
    summary: 'All good otherwise.',
  });
  assert.match(md, /\*\*2 finding\(s\):\*\* 1 high, 1 low/);
  assert.match(md, /\| high \| `a\.ts:1` \| \*\*A \\\| B\*\* x y \| z \|/);
  assert.match(md, /<summary>Agent summary<\/summary>/);
  assert.match(
    summaryMarkdown({ heading: 'h', facts: [], findings: [], summary: '' }),
    /No findings/,
  );
});
