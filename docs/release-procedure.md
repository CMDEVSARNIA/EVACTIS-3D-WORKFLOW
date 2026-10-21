# Release procedure — EVACTIS 3DWORKFLOW

*Phase 12. The order of work for a release, from a green CI run to the kit Evactis
delivers. Details live in the linked documents; this page is the checklist.*

## 1. Before building

- [ ] CI is green on the release commit: "CI" (pnpm check, real apps offline, Site Server
      on an isolated network, standalone program, Docker image) and "Windows installers"
      (build, signatures, offline rebuild, install → launch → uninstall and package
      acceptance on Windows Server 2022 and 2025).
- [ ] Version numbers raised in `apps/*/package.json` (the apps' `tauri.conf.json` reads
      them) and the `Cargo.toml` workspace version; release notes drafted (below).
- [ ] The CycloneDX SBOM of that commit (CI artifact `sbom`, or `pnpm sbom`) checked
      against a vulnerability advisory database on a connected machine. Only the SBOM
      leaves the building.
- [ ] Windows Sandbox air-gap check passed on the release candidate
      ([windows-installers.md](windows-installers.md#air-gap-acceptance-windows-sandbox-networking-off)),
      including a machine without the WebView2 Runtime.
- [ ] On a PC whose Windows display language is French: install Studio and the Viewer
      from the bilingual setups, check the installer and the apps open in French, open an
      `.evx`, uninstall ([windows-installers.md](windows-installers.md#what-ci-proves-every-push)
      covers the rest of the installer QA matrix in CI).
- [ ] Reference-PC checks done ([performance.md](performance.md#checked-by-hand-on-reference-pcs-evactis)).

## 2. Build and sign at the offline signing station

Follow [windows-installers.md](windows-installers.md#fully-offline-build-and-signing) and
[code-signing.md](code-signing.md#signing-a-release-fully-offline):

- [ ] `scripts/windows/prepare-offline-build.ps1` on a connected machine, carried over on
      removable media; then `scripts/windows/build-installers.ps1 -Offline` at the station
      with networking off and the USB token inserted (`EVX_SIGN_THUMBPRINT`). Every
      program is signed: Studio, Viewer, the Viewer inside Studio, FFmpeg, the installers.
- [ ] Site Server standalone program: `node apps/site-server/scripts/sea.mjs --check`,
      then `scripts/windows/sign.ps1` on `evactis-3dworkflow-site-server.exe`. Docker
      image: built where the pinned base image is available, exported with
      `docker save`.
- [ ] `scripts/windows/timestamp-later.ps1` on a connected machine with copies of the
      signed files (hashes only leave; option A, ADR 0008), then back to the station.
- [ ] `Get-AuthenticodeSignature` on every `.exe` and `.msi`: signer Evactis, status Valid,
      timestamp present.

## 3. The release kit

| Item | From |
| --- | --- |
| Studio setup (NSIS, per-user) and MSI (EN, FR) | `out/installers` |
| Viewer setup (NSIS) and MSI (EN, FR) | `out/installers` |
| Site Server: Windows program, Linux program, Docker image archive, `NOTICES.txt`, `NODE-LICENSE.txt` | `apps/site-server/dist/standalone`, `docker save` |
| FFmpeg source offer (`ffmpeg\SOURCE.txt`, inside Studio) or the source archive itself | assumption 14 |
| SBOM (`evactis-3dworkflow.cdx.json`) | `pnpm sbom` |
| Guides: IT deployment, Site Server administration, Studio and Viewer user guides (EN/FR), release notes | `docs/` |
| SHA-256 of every file in the kit (`SHA256SUMS.txt`) | `Get-FileHash` |

## 4. Release notes (template)

- Version, date, commit.
- What changed for people (Studio, Viewer, Site Server), in English and French.
- Known limitations (from the Assumptions in CLAUDE.md that affect users).
- Measured on the reference PCs (performance.md).
- SBOM advisory check result.

## 5. Client deliveries (per facility)

Delivery packages made in Studio are unsigned until they pass through the signing
station (assumption 65): sign each per-facility setup there before it leaves Evactis,
and give the package passphrase through a different channel than the package.
