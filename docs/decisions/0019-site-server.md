# 0019 — Site Server: one Node process on the site network, its own TLS and TURN

**Context.** Phase 11 adds an optional, client-hosted server for collaboration on the
site's own network: shared notes pinned in scenes (categories, threads, assignees,
status, photos), live guided sessions (the host's navigation synced to participants,
WebRTC audio/video with the server as signalling and TURN, no public STUN), local-only
usage reports exported as CSV (off by default, never sent anywhere), and local or
LDAP/Active Directory accounts (no cloud identity). Done when two machines on an
isolated network run a guided session and share notes with the server's outbound
traffic blocked. Shipped as a Docker image and a standalone program.

**Decision.**
- **One process, few dependencies.** Node.js 22 with Fastify 5 (HTTP), `ws` (live
  channel), `ldapts` (directory sign-in) and the built-in `node:sqlite`; the reader for
  delivery packages is the same `packages/package-format` the players use. The server is
  bundled with esbuild into one file, which runs under `node`, inside the Docker image
  (`node:22 bookworm-slim`, pinned by digest) and as a Node single executable
  application built from the local runtime (`scripts/sea.mjs`; no download), with the
  pages embedded as assets. Node 22 rather than the 20 named in the brief: 20 reached
  end of life in April 2026 and `node:sqlite` needs 22.
- **SQLite only.** One file in the data folder, WAL mode; enough for a site's notes,
  people and reports, trivially backed up. All SQL sits in a few small modules, so a
  PostgreSQL backend can be added behind them if a site ever needs one (deferred).
- **Site network only, enforced three ways.** An allow-list of networks (private ranges
  by default) gates incoming requests, the TURN relay's destinations and the directory
  connection (checked before connecting). Nothing else opens an outbound connection.
- **Its own HTTPS.** Browsers expose microphone and camera only in a secure context, and
  a LAN has no public certificate. On first start the server makes a local certificate
  authority (ECDSA P-256, 10 years) and a server certificate for its name and site
  addresses (397 days, renewed 30 days before expiry), written with a small DER encoder
  of our own (Node can verify certificates but not issue them; a library for this
  would be larger than the code). IT installs the authority once by Group Policy, or
  configures the organisation's own certificate.
- **Its own TURN relay (RFC 8656, UDP).** No public STUN or TURN; client PCs on
  different VLANs often cannot reach each other, so media goes through the server.
  Short-lived TURN credentials (`<expiry>:<user>`, HMAC-SHA1, the TURN REST convention)
  are issued only to signed-in people; the relay refuses destinations off the site
  network. Browsers form a full mesh (at most 8 people per session; the lower peer id
  offers), with audio and video transceivers set up once and tracks swapped without
  renegotiation.
- **Live channel.** One WebSocket per page carries note changes, session membership,
  the host's navigation (rate-limited) and WebRTC signalling. Sessions live in memory:
  a restart ends them, which is acceptable for walk-throughs.
- **Accounts and sign-in.** Everything needs sign-in. Site accounts use scrypt hashes;
  directory accounts are verified by a lookup with a read-only service account and a
  bind as the user, roles from group membership at each sign-in. Session tokens are
  stored hashed; cookies are HttpOnly, Secure, SameSite=Strict; API writes need a custom
  header and same origin; wrong passwords are throttled; the first administrator is
  created with a one-time code printed in the server log.
- **Notes.** Status, category and assignee can be changed by anyone (triage); title,
  text and position by the author or an administrator. Photos are identified by their
  bytes (JPEG/PNG/WebP) and stored with EXIF/XMP/text metadata removed (location data
  from phones never reaches the server's disk).
- **Reports** are a setting stored in the database, off by default; recording is
  refused while off; CSV export escapes spreadsheet formulas.
- **Acceptance on a real isolated network.** `scripts/linux/site-server-lan.sh` builds two
  client machines and the server from Linux network namespaces (separate subnets, no
  forwarding, no path between clients, a dead-end "outside" link counted and logged)
  and drives one browser per machine. Browser-level tests on loopback
  (`e2e/site-server.spec.ts`) and unit tests (TURN, certificates, LDAP against a real
  OpenLDAP, the HTTP API) run in `pnpm check`.

**Consequences.**
- No cloud anywhere: the server works in an air-gapped building, and its traffic is
  confined to the site network by its own checks as well as the site's firewall.
- IT must distribute the site's certificate authority (or provide a certificate) before
  people can use microphones and cameras; the Administration page explains it.
- The mesh limits sessions to 8 people with media; larger briefings would need a
  selective forwarding unit on the server (not planned).
- The desktop 3DWORKFLOW Viewer does not connect to a Site Server; collaboration happens
  in the browser pages the server serves. Hosting installers on the server is deferred.
