# 0021 — Bug scanner: a cloud code review of the source, in CI only

**Context.** Evactis asked for the "GitHub Bug Scanner", a Claude Managed Agent, to scan
this repository for bugs from GitHub. The agent runs in Anthropic's cloud. The product's
fourth requirement is zero cloud exposure: no third party hosts or holds facility data,
and no shipped program makes a network call at runtime.

**Decision.**
- **Source code only, development only.** The scanner reviews the repository's source,
  which already lives on GitHub. It never sees client projects, facility photos, plans or
  packages: the repository holds none (the demo facility is procedural, assumption 12).
  Nothing shipped contains or calls it; it lives in `tools/bug-scanner/` with its own
  lockfile, outside the pnpm workspace, so the SDK cannot reach a product bundle, the SBOM
  or the licence report of what we ship. The external-URL lint is relaxed for that folder
  only.
- **A GitHub Actions workflow drives the agent** (`.github/workflows/bug-scan.yml`): the
  agent and its sandbox are files synced with `ant apply`; each run starts a session on
  one commit, sends the task, follows the event stream and writes a job summary,
  annotations and an artifact.
- **Read and report only, enforced rather than requested.** Sessions override the agent's
  tools: no GitHub MCP server (its write tools would run with nobody to approve them), no
  web, no file writes; the repository is mounted with the job's read-only token through
  Anthropic's git proxy; the sandbox has no network; approval requests are refused. A
  per-scan spend cap and time limit bound the cost.
- **Changes on every push, everything weekly.** A push is scanned against the branch's
  previous head; media, lockfiles, baselines and prose are skipped, and a push with
  nothing else starts no session. Findings never fail the job: they are review input,
  not a gate. A scan that could not run does fail it.
- **Opt-in.** Without an `ANTHROPIC_API_KEY` secret the workflow does nothing.

**Consequences.** Evactis's source code is sent to Anthropic for each scan (retention per
Anthropic's terms for the workspace). If that is ever unacceptable, delete the secret: the
workflow stops and nothing else changes. Results depend on a model and are not
reproducible; treat them as a reviewer's comments, not a test.
