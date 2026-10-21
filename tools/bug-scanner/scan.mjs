#!/usr/bin/env node
/**
 * Runs the GitHub Bug Scanner (a Claude Managed Agent, agents/git-hub-bug-scanner.md) on
 * this repository from GitHub Actions, then reports what it found: job summary, file/line
 * annotations, bug-scan/report.md and bug-scan/findings.json. Read and report only; the
 * shipped products never use this (ADR 0021).
 *
 *   node tools/bug-scanner/scan.mjs [--dry-run]
 *
 * Environment (set by .github/workflows/bug-scan.yml):
 *   ANTHROPIC_API_KEY        API key of the workspace that holds the agent
 *   GITHUB_TOKEN             the job's read-only token; Anthropic's git proxy clones with it
 *   SCAN_SCOPE               "changes" (default) or "full"
 *   SCAN_BASE                commit to diff against (default: the push's previous head,
 *                            the pull request's base, or the default branch)
 *   SCAN_BUDGET_CENTS        hard spend cap per scan, US cents (default 300)
 *   SCAN_TIMEOUT_MINUTES     give up (and interrupt the session) after this long (default 40)
 *   ANTHROPIC_WORKSPACE_ID   for the Console link (default "default")
 *   BUG_SCANNER_AGENT_ID / BUG_SCANNER_ENVIRONMENT_ID  override claude-lock.json
 * plus GitHub's own GITHUB_* variables.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { annotation, buildTask, parseReport, reviewable, summaryMarkdown } from './report.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const env = process.env;
const dryRun = process.argv.includes('--dry-run');
const outDir = resolve(repoRoot, env.SCAN_OUT_DIR ?? 'bug-scan');
const MOUNT = '/workspace/repo';

const git = (...a) =>
  execFileSync('git', a, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 256 << 20 });
const log = (s) => console.log(s);
const summary = (md) =>
  env.GITHUB_STEP_SUMMARY && appendFileSync(env.GITHUB_STEP_SUMMARY, `${md}\n`);
function fail(message) {
  console.log(`::error title=Bug scan::${message.replace(/\n/g, '%0A')}`);
  summary(`## Bug scan failed\n\n${message}\n`);
  process.exit(1);
}

// ------------------------------------------------------------------ what to scan
const event =
  env.GITHUB_EVENT_PATH && existsSync(env.GITHUB_EVENT_PATH)
    ? JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'))
    : {};
const repository = env.GITHUB_REPOSITORY ?? 'local/repo';
const sha = env.GITHUB_SHA ?? git('rev-parse', 'HEAD').trim();
const ref = env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME || 'HEAD';
let scope = env.SCAN_SCOPE === 'full' ? 'full' : 'changes';
const ZERO = /^0+$/;

function pickBase() {
  if (env.SCAN_BASE) return env.SCAN_BASE;
  if (event.pull_request?.base?.sha) return event.pull_request.base.sha;
  if (event.before && !ZERO.test(event.before)) return event.before;
  const main = event.repository?.default_branch;
  return main && main !== ref ? `origin/${main}` : undefined;
}

let base;
let files = [];
let diff = '';
if (scope === 'changes') {
  base = pickBase();
  try {
    if (!base) throw new Error('no earlier commit to compare with');
    // Two trees are enough for a diff, so a shallow fetch of the base will do.
    if (base.startsWith('origin/')) {
      git('fetch', '--no-tags', '--depth=1', 'origin', base.slice('origin/'.length));
      base = git('rev-parse', 'FETCH_HEAD').trim();
    } else {
      try {
        base = git('rev-parse', '--verify', `${base}^{commit}`).trim();
      } catch {
        git('fetch', '--no-tags', '--depth=1', 'origin', base);
      }
    }
    files = reviewable(git('diff', '--name-status', '--no-renames', base, sha));
    if (files.length)
      diff = git(
        'diff',
        '--no-color',
        '--no-renames',
        '-U3',
        base,
        sha,
        '--',
        ...files.map((f) => f.path),
      );
  } catch (e) {
    log(
      `::notice title=Bug scan::No usable base commit (${String(e.message).split('\n')[0]}); scanning the whole repository.`,
    );
    scope = 'full';
    base = undefined;
  }
  if (scope === 'changes' && !files.length) {
    log(`No code changes between ${base} and ${sha}; nothing to scan.`);
    summary(
      `## Bug scan\n\nNo code changes between \`${base.slice(0, 12)}\` and \`${sha.slice(0, 12)}\` (media, lockfiles and prose are skipped).\n`,
    );
    process.exit(0);
  }
}

const task = buildTask({ repository, sha, ref, mountPath: MOUNT, scope, base, files, diff });

// ------------------------------------------------------------------ which agent
const lockPath = join(here, 'claude-lock.json');
const lock = existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, 'utf8')) : { resources: {} };
const agentId = env.BUG_SCANNER_AGENT_ID || lock.resources['./agents/git-hub-bug-scanner.md']?.id;
const environmentId =
  env.BUG_SCANNER_ENVIRONMENT_ID || lock.resources['./environments/bug-scanner.yaml']?.id;
const cents = String(Number.parseInt(env.SCAN_BUDGET_CENTS ?? '300', 10) || 300);

const params = {
  title: `Bug scan: ${repository}@${sha.slice(0, 12)} (${scope})`,
  // CI overrides the agent's tools for this session only: no GitHub MCP server (the
  // repository is mounted instead, and nobody is there to approve its write tools), no
  // web, no file writes. The agent's own definition is unchanged.
  agent: {
    type: 'agent_with_overrides',
    id: agentId,
    mcp_servers: [],
    tools: [
      {
        type: 'agent_toolset_20260401',
        default_config: { enabled: true, permission_policy: { type: 'auto' } },
        configs: [
          { name: 'web_fetch', enabled: false },
          { name: 'web_search', enabled: false },
          { name: 'write', enabled: false },
          { name: 'edit', enabled: false },
        ],
      },
    ],
  },
  environment_id: environmentId,
  budget: { type: 'limit', max_list_cost: { amount: cents, currency: 'USD' } },
  metadata: { repository, sha, scope, run: env.GITHUB_RUN_ID ?? 'local' },
  resources: [
    {
      type: 'github_repository',
      url: `${env.GITHUB_SERVER_URL ?? 'https://github.com'}/${repository}`,
      authorization_token: env.GITHUB_TOKEN,
      checkout: { type: 'commit', sha },
      mount_path: MOUNT,
    },
  ],
};

if (dryRun) {
  const shown = structuredClone(params);
  shown.resources[0].authorization_token = shown.resources[0].authorization_token
    ? '***'
    : undefined;
  log(JSON.stringify(shown, null, 2));
  log('\n--- task ---\n' + task);
  process.exit(0);
}
if (!agentId || !environmentId)
  fail(
    'No agent or environment ID. Run `ant apply agents/git-hub-bug-scanner.md environments/bug-scanner.yaml` ' +
      'in tools/bug-scanner and commit claude-lock.json (see tools/bug-scanner/README.md).',
  );
if (!env.GITHUB_TOKEN) fail('GITHUB_TOKEN is not set; the session could not clone the repository.');

// ------------------------------------------------------------------ run the session
const { default: Anthropic } = await import('@anthropic-ai/sdk');
const client = new Anthropic();
const session = await client.beta.sessions
  .create(params)
  .catch((e) => fail(`Could not start the session: ${e.message}`));
const consoleUrl = `https://platform.claude.com/workspaces/${env.ANTHROPIC_WORKSPACE_ID || 'default'}/sessions/${session.id}`;
log(`Session ${session.id} (${scope}, cap $${(Number(cents) / 100).toFixed(2)}): ${consoleUrl}`);

const interrupt = () =>
  client.beta.sessions.events
    .send(session.id, { events: [{ type: 'user.interrupt' }] })
    .catch(() => undefined);
for (const sig of ['SIGINT', 'SIGTERM'])
  process.on(sig, async () => {
    log(`${sig}: interrupting the session.`);
    await interrupt();
    process.exit(1);
  });

const messages = [];
const notes = [];
let outcome; // 'done' | 'budget' | 'failed' | 'timeout'
let reason = '';
const seen = new Set();
const deadline = Date.now() + (Number(env.SCAN_TIMEOUT_MINUTES) || 40) * 60_000;

/** Handles one event; returns true when the session is finished with the task. */
async function handle(ev) {
  if (seen.has(ev.id)) return false;
  seen.add(ev.id);
  switch (ev.type) {
    case 'agent.message':
      messages.push(
        ev.content
          .filter((b) => b.type === 'text')
          .map((b) => b.text)
          .join(''),
      );
      return false;
    case 'agent.tool_use':
    case 'agent.mcp_tool_use':
      if (ev.evaluated_permission === 'ask') {
        // Nobody is watching a CI run: anything that needs a person's approval is refused.
        log(`Refused a tool call that asked for approval: ${ev.name}`);
        await client.beta.sessions.events.send(session.id, {
          events: [
            {
              type: 'user.tool_confirmation',
              tool_use_id: ev.id,
              result: 'deny',
              deny_message: 'Unattended CI scan: read and report only, nothing needing approval.',
            },
          ],
        });
      }
      return false;
    case 'session.error': {
      const kind = ev.error?.type ?? 'unknown_error';
      log(`::warning title=Bug scan session error::${kind}: ${ev.error?.message ?? ''}`);
      if (/^(repository_|billing_)/.test(kind)) {
        outcome = 'failed';
        reason = `${kind}: ${ev.error?.message ?? ''}`;
        await interrupt();
        return true;
      }
      return false;
    }
    case 'session.status_idle':
      switch (ev.stop_reason.type) {
        case 'requires_action':
          return false;
        case 'end_turn':
          outcome = 'done';
          return true;
        case 'budget_reached':
          outcome = 'budget';
          return true;
        default:
          outcome = 'failed';
          reason = `the session stopped: ${ev.stop_reason.type}`;
          return true;
      }
    case 'session.status_terminated':
      outcome ??= messages.length ? 'done' : 'failed';
      reason ||= 'the session terminated';
      return true;
    default:
      return false;
  }
}

async function follow(first) {
  for (let attempt = 0; ; attempt++) {
    const stream = await client.beta.sessions.events.stream(session.id);
    const timer = setTimeout(() => stream.controller.abort(), Math.max(0, deadline - Date.now()));
    try {
      if (first) {
        first = false;
        await client.beta.sessions.events.send(session.id, {
          events: [{ type: 'user.message', content: [{ type: 'text', text: task }] }],
        });
      } else {
        // The stream does not replay: read what was missed, then carry on live.
        for await (const ev of client.beta.sessions.events.list(session.id))
          if (await handle(ev)) return;
      }
      for await (const ev of stream) if (await handle(ev)) return;
    } catch (e) {
      if (Date.now() >= deadline) {
        outcome = 'timeout';
        await interrupt();
        return;
      }
      if (attempt >= 5) throw e;
      log(`Event stream dropped (${e.message}); reconnecting.`);
    } finally {
      clearTimeout(timer);
    }
    await new Promise((r) => setTimeout(r, 2000));
    if (Date.now() >= deadline) {
      outcome = 'timeout';
      await interrupt();
      return;
    }
  }
}

try {
  await follow(true);
} catch (e) {
  outcome = 'failed';
  reason = e.message;
  await interrupt();
}

// ------------------------------------------------------------------ report
const final = [...messages].reverse().find((m) => /```json/.test(m)) ?? messages.join('\n\n');
const report = parseReport(final);
const done = await client.beta.sessions.retrieve(session.id).catch(() => undefined);
const cost = done?.usage?.list_cost?.amount;

if (outcome === 'budget')
  notes.push(
    `The scan reached its $${(Number(cents) / 100).toFixed(2)} cap before finishing; findings may be incomplete.`,
  );
if (outcome === 'timeout')
  notes.push('The scan ran out of time and was interrupted; findings may be incomplete.');
if (outcome === 'failed') notes.push(`The scan did not finish: ${reason}.`);
if (outcome === 'done' && !report.parsed)
  notes.push('The agent did not return findings in the expected JSON form; its text is below.');
if (report.dropped) notes.push(`${report.dropped} malformed finding(s) were ignored.`);

mkdirSync(outDir, { recursive: true });
writeFileSync(
  join(outDir, 'findings.json'),
  `${JSON.stringify({ repository, sha, scope, base, session: session.id, outcome, findings: report.findings }, null, 2)}\n`,
);
const md = summaryMarkdown({
  heading: 'Bug scan',
  facts: [
    `Commit \`${sha.slice(0, 12)}\` on \`${ref}\``,
    scope === 'changes'
      ? `Changes since \`${base.slice(0, 12)}\` (${files.length} file(s))`
      : 'Whole repository',
    `Session [${session.id}](${consoleUrl})${cost ? `, list cost $${(Number(cost) / 100).toFixed(2)}` : ''}`,
  ],
  findings: report.findings,
  summary: report.summary,
  notes,
});
writeFileSync(join(outDir, 'report.md'), md);
summary(md);
// GitHub shows at most 10 warnings per step; the summary and report list them all.
for (const f of report.findings.slice(0, 10)) log(annotation(f));
log(`${report.findings.length} finding(s); outcome: ${outcome}.`);
process.exit(outcome === 'failed' || outcome === 'timeout' ? 1 : 0);
