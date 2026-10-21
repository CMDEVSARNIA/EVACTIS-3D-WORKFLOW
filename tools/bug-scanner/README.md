# Bug scanner (development tooling)

Runs the **GitHub Bug Scanner**, a Claude Managed Agent, on this repository from GitHub
Actions (`.github/workflows/bug-scan.yml`) and reports what it finds. It is a review aid
for the people who build EVACTIS 3DWORKFLOW; no shipped product contains or calls it.
Why a cloud service is acceptable here, and what never goes to it: ADR 0021.

| File | What |
| --- | --- |
| `agents/git-hub-bug-scanner.md` | The agent (model, tools, system prompt), synced with `ant apply` |
| `environments/bug-scanner.yaml` | The sandbox it runs in: no package registries, no MCP servers, no other hosts |
| `claude-lock.json` | IDs of the agent and environment in the Anthropic workspace (written by `ant apply`) |
| `scan.mjs` | Starts a session on one commit, follows it, writes the report |
| `report.mjs` | Task text, file filtering, findings parsing, summary and annotations (tested offline: `node --test tools/bug-scanner/report.test.mjs`) |

## When it runs

- **Every push**: the changes since the branch's previous push (media, lockfiles,
  screenshots and Markdown are skipped; a push with nothing else does not start a
  session).
- **Mondays**: the whole repository (default branch).
- **By hand**: Actions → Bug scan → Run workflow, "full" or "changes" (optionally from a
  given commit).

Results: the run's summary page (a table of findings and the agent's summary), warnings on
the files and lines in the commit view, and a `bug-scan` artifact (`report.md`,
`findings.json`). Findings never fail the job; only a scan that could not run does.

## What the agent can do in CI

The workflow overrides the agent's tools **for its own sessions only** (the agent
definition is unchanged):

- The repository is cloned into the sandbox at the scanned commit by Anthropic's git proxy
  with the job's read-only `GITHUB_TOKEN` (which never enters the sandbox and expires with
  the job). Pushing is impossible with that token.
- No GitHub MCP server, no web search or fetch, no file writes or edits; it reads, greps
  and runs `git` locally.
- Any tool call that asks for approval is refused: nobody is watching.
- A hard spend cap per scan: `BUG_SCAN_BUDGET_CENTS` (repository variable, default 300 =
  $3.00 at list price), and a 40-minute limit.

## Setup (once)

1. Install the Anthropic CLI (`ant`, 1.30 or later) and sign in to the workspace that holds
   the agent (`ant auth login`).
2. From this folder, create the environment and sync the agent; review the plan before
   answering yes:

   ```sh
   cd tools/bug-scanner
   ant apply --dry-run -v agents/git-hub-bug-scanner.md environments/bug-scanner.yaml
   ant apply agents/git-hub-bug-scanner.md environments/bug-scanner.yaml
   ```

   Commit the updated `claude-lock.json` (it now also holds the environment's ID).
3. In the GitHub repository settings → Secrets and variables → Actions:
   - secret `ANTHROPIC_API_KEY`: an API key **of that workspace** (a key from another
     workspace cannot see the agent);
   - optional variables: `ANTHROPIC_WORKSPACE_ID` (for the Console links; default
     workspace otherwise), `BUG_SCAN_BUDGET_CENTS`.

To change the agent, edit `agents/git-hub-bug-scanner.md` and run `ant apply` again; each
scan uses the latest version.

Watch a scan live from the "Session" link in the run's summary (Anthropic Console), or
`ant beta:sessions connect <session id>`.
