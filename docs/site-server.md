# 3DWORKFLOW Site Server — administrator guide

*Phase 11. Optional: the Viewer and every delivery package work without it.*

The EVACTIS 3DWORKFLOW Site Server is for sites that want people to work together on
their own network:

- **Shared notes** pinned in scenes: category, status (open, in progress, resolved),
  assignee, replies and photos. Everyone with the environment open sees changes live.
- **Guided sessions**: a host leads a walk-through and every participant's view follows.
  Microphone and camera go directly between browsers (WebRTC), relayed by the server
  itself, so they work even where client PCs cannot reach each other.
- **Usage reports** (off by default): scene views and training completions, kept on the
  server and exported as CSV by an administrator. Nothing is ever sent anywhere.

It runs on a machine the site owns, serves only the site network and never contacts
Evactis, a cloud service or the internet: no telemetry, no update checks, no public
STUN or TURN servers, no external identity providers.

## Choosing how to run it

| | Standalone program | Docker image |
| --- | --- | --- |
| File | `evactis-3dworkflow-site-server.exe` (Windows) or `evactis-3dworkflow-site-server` (Linux), with `NOTICES.txt` and `NODE-LICENSE.txt` | `evactis-3dworkflow-site-server:<version>` (`docker save` archive) |
| Needs | Windows 10/11 or Windows Server 2016+, x64; or Linux x64 (glibc 2.28+) | Docker on Linux, host networking |
| Runs as | A service (see below) | `docker run --network host --restart unless-stopped` |

Both contain the same server and the Node.js 22 runtime; nothing else is installed.
The program is about 125 MB. Disk: the uploaded environments (`.evx` files) plus note
photos.

## First start

1. Pick a data folder (default `site-data` beside where it is started, or `--data <folder>`,
   or `EVX_SITE_DATA`). It holds everything: `config.json`, the database (`site.db`),
   environments, note photos and the TLS files. Back it up while the server is stopped.
2. Start the server once. It writes a default `config.json` (readable only by its owner),
   makes the site's certificate authority and server certificate, and prints a
   **one-time setup code** in its log:

   ```
   evactis-3dworkflow-site-server --data D:\EvactisSite
   ```
3. Open `https://<server name or address>:8443/` from a PC on the site network, enter the
   setup code and create the first administrator (password: at least 10 characters).
   The code stops working once used.
4. On **Administration**: upload environments (`.evx` files made in 3DWORKFLOW Studio;
   every file is checked before it is accepted), add people, turn usage reports on if
   wanted.

### As a service

- **Windows**: register the program with the Service Control Manager through a
  service wrapper the site already uses (for example WinSW or NSSM), with
  `--data <folder>` as its argument and a dedicated low-privilege account that owns the
  data folder. *A built-in Windows service mode is planned for Phase 12.*
- **Linux (systemd)**:

  ```ini
  [Service]
  ExecStart=/opt/evactis/evactis-3dworkflow-site-server --data /var/lib/evactis-site
  User=evactis-site
  Restart=on-failure
  NoNewPrivileges=true
  ProtectSystem=strict
  ReadWritePaths=/var/lib/evactis-site
  ```
- **Docker**: `docker load -i evactis-3dworkflow-site-server-<version>.tar`, then
  `docker run -d --name evx-site --network host --restart unless-stopped -v /srv/evx-site:/data evactis-3dworkflow-site-server:<version>`.
  The data folder must be writable by uid 1000. Host networking matters: the server
  needs the site's real addresses for its certificate, its TURN relay and its
  site-network checks.

## Network

| Port | Protocol | Use |
| --- | --- | --- |
| 8443 | TCP | HTTPS pages, API and live updates (WebSocket) |
| 3478 | UDP | TURN (relays guided-session audio and video) |
| 49160–49200 | UDP | TURN relay ports |

Open these inbound from the site network only. The server needs **no outbound access**:
block it entirely (the acceptance test does). The only connection it ever opens is to
the LDAP directory, if one is configured, and only when that directory's address is on
an allowed network.

`allowedNetworks` (default: the private ranges 10/8, 172.16/12, 192.168/16, 100.64/10,
link-local and loopback, IPv4 and IPv6) is enforced three ways: requests from anywhere
else are refused, the relay sends only to these networks, and directory connections go
only to them. Narrow it to the site's own subnets.

Guided-session audio and video need roughly 50 kbit/s per person for audio and 1 Mbit/s
per camera, for each other person in the session (at most 8 people). Everything stays
on the site network.

## Certificates

Browsers allow microphone and camera only on trusted HTTPS. Either:

- **Use the site's certificate authority** (default). Install `https://<server>:8443/ca.pem`
  (also offered on the Administration page) as a trusted root on client PCs, for example
  by Group Policy (*Computer Configuration → Windows Settings → Security Settings →
  Public Key Policies → Trusted Root Certification Authorities*). The server certificate
  is renewed automatically 30 days before it expires (397-day lifetime) and covers the
  machine name, `localhost` and every site-network address; add other names in
  `tls.names`. The authority's key stays in `<data>/tls/`.
- **Or use your own certificate**: set `tls.certFile` and `tls.keyFile` (PEM) to one
  issued by the organisation's own authority.

## Accounts

- **Site accounts** are created on Administration (role: administrator or member).
  Passwords are stored as scrypt hashes; repeated wrong passwords are throttled.
- **Network accounts (LDAP / Active Directory)**: add an `ldap` section to `config.json`
  and restart. People then sign in with their network name and password; their role
  comes from group membership on each sign-in.

  ```json
  "ldap": {
    "url": "ldaps://dc1.example.local",
    "bindDN": "CN=evactis-lookup,OU=Service,DC=example,DC=local",
    "bindPassword": "…",
    "baseDN": "DC=example,DC=local",
    "userFilter": "(sAMAccountName={username})",
    "adminGroup": "CN=Evactis Admins,OU=Groups,DC=example,DC=local",
    "memberGroup": "CN=Evactis Users,OU=Groups,DC=example,DC=local",
    "caFile": "C:\\EvactisSite\\corp-root.pem"
  }
  ```

  The lookup account needs read access only. Use `ldaps://` or `"startTls": true` so
  passwords never cross the network in clear. People in neither group cannot sign in.
  No cloud identity provider is supported, by design.

## Usage reports

Off until an administrator turns them on. When on, the server records scene views and
training completions (who, what, when) in its own database. Administrators export a
date range as CSV (spreadsheet-safe) or delete everything recorded. Turning reports off
stops recording; it does not delete what was recorded.

## Privacy and data

- Photos attached to notes have their location and camera metadata (EXIF, XMP, text
  chunks) removed before they are stored.
- Uploaded environments are served only to signed-in people, checked against their
  integrity manifest on upload; encrypted environments stay encrypted on the server (the
  passphrase is asked in the browser and never sent to the server).
- Sign-in cookies are HTTP-only, secure and same-site; sessions end after
  `sessionHours` (default 12) of inactivity.

## `config.json` reference

| Key | Default | Meaning |
| --- | --- | --- |
| `siteName` | `"Site"` | Shown in the portal and the certificate names |
| `host`, `port` | `"0.0.0.0"`, `8443` | Where HTTPS listens |
| `tls.certFile`, `tls.keyFile` | — | Site certificate instead of the generated one |
| `tls.names` | `[]` | Extra names/addresses for the generated certificate |
| `turn.port` | `3478` | TURN (UDP) |
| `turn.relayAddress` | first site address | Address clients reach relayed media on |
| `turn.relayPorts` | `[49160, 49200]` | Relay port range |
| `allowedNetworks` | private ranges | CIDRs served, relayed to and connected to |
| `ldap` | — | Directory sign-in (above) |
| `maxUploadMB` | `8192` | Largest environment upload |
| `maxPhotoMB` | `10` | Largest note photo |
| `sessionHours` | `12` | Idle time before sign-out |

## Acceptance (how this is tested)

`scripts/linux/site-server-lan.sh` builds an isolated network from Linux network
namespaces: two client machines on separate subnets with no path between them, the
server in the middle (not forwarding), and a "way out" that is a dead end. Two browsers,
one per machine, share notes and run a guided session with audio through the server's
relay; the run fails if the server sends a single packet off the site network. CI runs
it on every push.
