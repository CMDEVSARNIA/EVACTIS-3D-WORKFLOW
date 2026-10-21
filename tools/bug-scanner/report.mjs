/**
 * Pure helpers for the bug scan (no network, no SDK): which changed files are worth a
 * review, the task given to the agent, reading its findings back, and turning them into
 * a job summary and GitHub annotations. Tested by report.test.mjs.
 */

export const SEVERITIES = ['critical', 'high', 'medium', 'low'];

/** Files a code review has nothing to say about: media, fonts, lockfiles, baselines, prose. */
const SKIPPED = [
  /\.(png|jpe?g|gif|webp|avif|bmp|tiff?|ico|icns|hdr|exr|glb|gltf|splat|ply|webm|mp4|mov|mp3|wav|ogg|flac|pdf|woff2?|ttf|otf|zip|evx|bin|exe|msi|dll|cab)$/i,
  /(^|\/)(pnpm-lock\.yaml|Cargo\.lock|package-lock\.json|claude-lock\.json)$/,
  /\.md$/i,
  /^brand\//,
  /^e2e\/__screenshots__\//,
  /^docs\/licenses\//,
];

/**
 * `git diff --name-status --no-renames` output → the files to review.
 * @param {string} nameStatus
 * @returns {{ status: string, path: string }[]}
 */
export function reviewable(nameStatus) {
  return nameStatus
    .split('\n')
    .map((line) => line.split('\t'))
    .filter((parts) => parts.length >= 2 && parts[0] && parts[1])
    .map(([status, path]) => ({ status: status[0], path }))
    .filter(({ path }) => !SKIPPED.some((re) => re.test(path)));
}

export const MAX_DIFF_CHARS = 150_000;

/**
 * The message that starts a scan.
 * @param {{
 *   repository: string, sha: string, ref: string, mountPath: string,
 *   scope: 'full' | 'changes', base?: string,
 *   files?: { status: string, path: string }[], diff?: string,
 * }} o
 */
export function buildTask(o) {
  const lines = [
    `Scan the repository ${o.repository} for bugs. It is already cloned at ${o.mountPath},`,
    `checked out at commit ${o.sha} (${o.ref}). Work only on that copy.`,
    '',
    'This run is an unattended GitHub Actions job: nobody can answer questions or approve',
    'anything. Read and report only. Do not modify files, commit, push, open issues or pull',
    'requests, and do not try to reach the network.',
    '',
    'Read CLAUDE.md at the repository root first: it states the product rules that make',
    'something a bug here, notably that the shipped apps never contact the network at',
    'runtime (no telemetry, CDNs, external fonts or third-party APIs), the strict CSP (no',
    'eval, no workers), and that safety content (evacuation routes, equipment) is only',
    'shown or printed once a person has confirmed it.',
    '',
  ];
  if (o.scope === 'changes') {
    lines.push(
      `Review the changes from ${o.base} to ${o.sha}. Changed files (A added, M modified,`,
      'D deleted):',
      ...o.files.map((f) => `- ${f.status} ${f.path}`),
      '',
      'Read the surrounding code of each change, including callers and callees in other',
      'files, before deciding something is a bug. Report problems the changes introduce or',
      'expose; leave untouched code alone unless a change makes it wrong.',
    );
    if (o.diff) {
      const cut = o.diff.length > MAX_DIFF_CHARS;
      lines.push(
        '',
        cut
          ? `The diff, cut at ${MAX_DIFF_CHARS} characters (read the files for the rest):`
          : 'The diff:',
        '```diff',
        cut ? o.diff.slice(0, MAX_DIFF_CHARS) : o.diff,
        '```',
      );
    }
  } else {
    lines.push(
      'Review the whole code base (apps/, packages/, crates/, tools/, scripts/, e2e/).',
      'Spend your effort where a bug would cost the most: package integrity and encryption,',
      'the Site Server (authentication, uploads, the site-network guard, TURN relay), file',
      'and path handling in Studio and the Rust crates, and anything that could make the',
      'apps reach the network.',
    );
  }
  lines.push(
    '',
    'Report real defects only: logic errors, unhandled null/undefined or error paths,',
    'security issues (injection, path traversal, authentication, cryptography misuse,',
    'secrets), races, resource leaks, broken offline guarantees. No style remarks. Check',
    'each finding against the code before reporting it; if you are unsure, say so in the',
    'detail and lower the severity.',
    '',
    'End your final message with exactly one fenced JSON block in this form (an empty',
    '"findings" array when there is nothing to report):',
    '```json',
    '{"findings": [{"file": "path/from/repo/root.ts", "line": 42, "severity": "high",',
    '  "title": "One-line summary", "detail": "What goes wrong and when", "fix": "Suggested fix"}]}',
    '```',
    `"severity" is one of ${SEVERITIES.join(', ')}. "file" is relative to the repository root.`,
    'Before the JSON block, write a short Markdown summary for the people reading the job.',
  );
  return lines.join('\n');
}

const str = (v) => (typeof v === 'string' ? v.trim() : '');

/**
 * Reads the agent's final text: its last ```json block holds the findings; the text
 * before it is the summary. Malformed entries are dropped and counted.
 * @param {string} text
 */
export function parseReport(text) {
  const blocks = [...text.matchAll(/```json\s*\n([\s\S]*?)```/g)];
  const last = blocks.at(-1);
  if (!last) return { summary: text.trim(), findings: [], dropped: 0, parsed: false };
  let data;
  try {
    data = JSON.parse(last[1]);
  } catch {
    return { summary: text.trim(), findings: [], dropped: 0, parsed: false };
  }
  const raw = Array.isArray(data?.findings) ? data.findings : [];
  const findings = [];
  for (const f of raw) {
    const severity = str(f?.severity).toLowerCase();
    const file = str(f?.file).replace(/^\.?\//, '');
    const title = str(f?.title);
    if (!file || !title || !SEVERITIES.includes(severity) || file.includes('..')) continue;
    const line = Number.isInteger(f.line) && f.line > 0 ? f.line : undefined;
    findings.push({ file, line, severity, title, detail: str(f.detail), fix: str(f.fix) });
  }
  findings.sort(
    (a, b) =>
      SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) ||
      a.file.localeCompare(b.file) ||
      (a.line ?? 0) - (b.line ?? 0),
  );
  const summary = (text.slice(0, last.index) + text.slice(last.index + last[0].length)).trim();
  return { summary, findings, dropped: raw.length - findings.length, parsed: true };
}

// Workflow commands: data escapes %, CR, LF; properties also escape : and ,.
const escData = (s) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escProp = (s) => escData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');

/** A `::warning` / `::notice` line that GitHub shows on the file and line. */
export function annotation(f) {
  const level = f.severity === 'low' ? 'notice' : 'warning';
  const props = [`file=${escProp(f.file)}`];
  if (f.line) props.push(`line=${f.line}`);
  props.push(`title=${escProp(`${f.severity.toUpperCase()}: ${f.title}`)}`);
  const body = [f.detail, f.fix && `Fix: ${f.fix}`].filter(Boolean).join('\n\n');
  return `::${level} ${props.join(',')}::${escData(body || f.title)}`;
}

const cell = (s) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

/**
 * The job summary in Markdown.
 * @param {{ heading: string, facts: string[], findings: ReturnType<typeof parseReport>['findings'], summary: string, notes?: string[] }} o
 */
export function summaryMarkdown(o) {
  const counts = SEVERITIES.map((s) => [s, o.findings.filter((f) => f.severity === s).length])
    .filter(([, n]) => n)
    .map(([s, n]) => `${n} ${s}`);
  const out = [`## ${o.heading}`, '', ...o.facts.map((f) => `- ${f}`), ''];
  for (const n of o.notes ?? []) out.push(`> ${n}`, '');
  out.push(
    o.findings.length
      ? `**${o.findings.length} finding(s):** ${counts.join(', ')}`
      : '**No findings.**',
    '',
  );
  if (o.findings.length) {
    out.push('| Severity | Where | Finding | Suggested fix |', '| --- | --- | --- | --- |');
    for (const f of o.findings)
      out.push(
        `| ${f.severity} | \`${cell(f.file)}${f.line ? `:${f.line}` : ''}\` | **${cell(f.title)}** ${cell(f.detail)} | ${cell(f.fix)} |`,
      );
    out.push('');
  }
  if (o.summary)
    out.push('<details><summary>Agent summary</summary>', '', o.summary, '', '</details>', '');
  return out.join('\n');
}
