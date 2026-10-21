# Security review — EVACTIS 3DWORKFLOW

*Phase 12, 2026-10-21. Internal review by the development team, not an independent
audit; Evactis may want one before the first release. Re-run when a dependency, a
network surface or a delivery format changes.*

## What we protect

| Asset | Where it lives | Why it matters |
| --- | --- | --- |
| Facility media (panoramas, photos, plans) and safety content | Studio project folders (Evactis), delivery packages (clients), Site Server data folder | Reveals building layout, security equipment, first-responder details |
| Package passphrases | People; never stored by the products | Protect encrypted packages in transit and at rest |
| Site Server accounts, sessions, notes, photos, usage reports | Site Server data folder (SQLite, files) | Personal data; notes may describe hazards |
| Code-signing key | USB hardware token at the offline signing station (ADR 0008) | Anyone holding it can ship software in Evactis's name |
| The site's certificate authority key | `<data>/tls/ca-key.pem` on the Site Server | Can issue certificates trusted by the site's PCs (for this site only) |

## Trust boundaries and how each is held

**1. Nothing leaves the machine or the site (requirement 4).**
- [Certain] No product code contacts the network on its own: no telemetry, update checks,
  CDNs, fonts or third-party APIs. Enforced by the ESLint external-URL rule on source, the
  URL scan of every build output (`tools/guardrail/scan-urls.mjs`), the licence/dependency
  guardrail, Playwright running every page with the network blocked (any attempt fails
  the test), the desktop apps' smoke tests in a network namespace with no interfaces
  (Linux) and firewalled (Windows), and the Site Server's acceptance on an isolated
  network where its outbound packets are counted (must stay 0).
- [Certain] Every shipped page has a Content-Security-Policy: `default-src 'self'`, no
  `eval`, no workers, no plugins, no forms posting elsewhere, not frameable. Since this
  review `worker-src 'none'` is set everywhere (it was missing from Studio and the shared
  page policy); the PDF reader runs pdf.js on the page itself.
- [Certain] The desktop apps install no Tauri plugins (no HTTP, shell, updater, opener)
  and grant only `core:default`; a navigation guard keeps the webview on the app's own
  pages.

**2. The page in the desktop apps cannot reach the rest of the computer.**
- Studio exposes 28 commands (project, library, media import, export and packaging); the
  Viewer 5 (open a package, read a file from it, pick a package, app info, smoke report).
- [Likely] Paths from the page are never trusted: commands work inside the open project,
  a folder the person picked in a native dialog, or the open package; file names are
  checked segment by segment (`safe_file_name`, `export_dir_allowed`). The asset protocol
  is scoped to the open project's media.
- [Certain] `Object.prototype` is hardened before any script runs (ADR 0016).

**3. Delivered packages cannot be altered or read without the passphrase.**
- [Certain] Every file is checked against the SHA-256 manifest before use; a failure
  stops the environment (tested with altered bytes in browsers, the Linux apps and
  Windows CI). Encryption: Argon2id (64 MiB) → AES-256-GCM per file, names hidden,
  blobs bound to their names (ADR 0018). Decrypted data stays in memory.
- Residual: the manifest is not signed. Someone who can replace the whole package can
  replace its manifest too; integrity protects against corruption and partial tampering,
  and the info panel shows the manifest's hash so a copy can be compared with what
  Evactis made. Signed manifests would need a key in Studio (see "Open items").

**4. The Site Server serves the site network and nothing else.**
- [Certain] An allow-list of networks gates requests, TURN relay destinations and the
  directory connection; no other outbound connection exists. HTTPS only (own authority
  or the site's certificate), TLS 1.2+.
- [Certain] Sign-in for everything; scrypt password hashes; session tokens stored
  hashed; cookies HttpOnly, Secure, SameSite=Strict; writes need a custom header and the
  same origin; wrong passwords throttled; first administrator by a one-time code from
  the log. Uploaded packages are verified before they are accepted and served as
  `application/octet-stream` with a sandbox CSP. Note photos are identified by content
  and stripped of EXIF/XMP/text metadata. CSV exports neutralise spreadsheet formulas.
- [Certain] TURN credentials are short-lived and per person; the relay sends only to the
  allowed networks and binds to its announced address.
- Fixed in this review: directory sign-in over plain `ldap://` without StartTLS is now
  refused unless explicitly allowed (it would send passwords in clear); the admin pages'
  browser `confirm()`/`prompt()` were replaced by in-page dialogs.
- The Windows scheduled task runs as LOCAL SERVICE with least privilege, with change
  rights on the data folder only; firewall rules admit only the allowed networks.

**5. Builds and signing.**
- [Certain] The release key never reaches CI (test certificate only); builds and signing
  run offline at the signing station; timestamping is a hash-only hop (ADR 0008).
- [Certain] Dependencies are pinned (lockfiles, `--frozen-lockfile`, `--locked`), their
  licences checked, and a CycloneDX SBOM with lockfile checksums is produced for each
  build (`pnpm sbom`).

## Residual risks and open items

| Item | Risk | Proposal |
| --- | --- | --- |
| `style-src 'unsafe-inline'` | Inline styles are used for runtime layout (positions, transforms); a style injection could restyle a page, not run script | Keep; all user text is set as text, never markup. Revisit with nonces if pages become server-rendered |
| Package manifests are not signed | A wholesale replacement of a package is not detected | Optional Studio signing key (offline) and a "signed by" line in the info panel; needs an Evactis decision |
| Setups made in Studio are unsigned until the signing station (assumption 65) | Windows SmartScreen warnings; no publisher identity | Delivery procedure: sign every client setup at the station before it leaves Evactis |
| CA key on the Site Server's disk | Theft lets an attacker impersonate this site's server to its PCs | File is owner-only; back up and protect the data folder; or use the organisation's own certificate |
| Site Server denial of service from inside the site | A hostile PC on the LAN can load the server | Rate limits on sign-in and live messages exist; the server is not exposed beyond the site |
| Sessions and live channel in memory | A restart ends guided sessions | Accepted (assumption 73) |
| Dependency vulnerabilities | Bundled libraries age | Check the SBOM against an advisory database at each release, on a connected machine (the SBOM, not the product, leaves the building) |

## How to re-run

`pnpm check` (guardrails, CSP violations and network attempts fail the e2e suite), the
CI jobs "Real apps offline (Linux)", "Site Server (isolated network…)" and the Windows
installers workflow, and `pnpm sbom`.
