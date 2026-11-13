# 0022 — One combined Windows setup for people installing by hand

**Context.** Each release has six Windows installers: a setup `.exe` and two MSIs (en-US,
fr-FR) for Studio and for the Viewer. IT departments want the MSIs; a person installing
on their own PC had to pick the right file out of six, and each file carries its own
copy of Microsoft's offline WebView2 installer (about 130 MB, ADR 0003).

**Options.**
| Option | For | Against |
| --- | --- | --- |
| One NSIS setup with both programs' files and its own uninstaller | Single Apps entry | A third install identity: upgrades, MSI and uninstall QA all doubled; the two programs could no longer be removed separately |
| A bootstrapper that runs the existing product setups | Products keep their identity, uninstaller, upgrade code and tests | Two Apps entries (one per program), as today |
| A WiX Burn bundle | Native chaining, also of the MSIs | Its own engine and per-user/per-machine rules; nothing else in the build uses Burn |

**Decision.** A small NSIS bootstrapper, `EVACTIS-3DWORKFLOW-<version>-x64-Setup.exe`
(`packaging/windows/suite/suite.nsi`), built and signed by `build-installers.ps1` with the
same tools and key as the rest:
- **Pages:** language (EN/FR) → welcome → licence → programs (Viewer ticked, Studio not)
  → who can use them ("Just me" / "Everyone who uses this computer"; the second is
  disabled without administrator rights) → install → finish.
- **What it does:** installs the WebView2 Runtime from its single embedded copy, only if
  missing; then runs each chosen product setup silently with `/CurrentUser` or
  `/AllUsers`; stops with the setup's exit code if one fails.
- **Parts:** the product setups inside it are the same NSIS setups, rebuilt with
  `TAURI_EVX_SUITE_PART=1`, which our generated template reads to leave out their own
  WebView2 copy. The standalone setups and MSIs are unchanged.
- **Silent:** `/S [/CurrentUser | /AllUsers] [/Viewer] [/Studio]`; the Viewer alone by
  default; `/AllUsers` without administrator rights exits 740.
- **Registers nothing itself:** no uninstaller and no Apps entry. Each program is
  uninstalled on its own, as before; a newer combined setup upgrades both in place.

**Consequences.** The release kit leads with one file ("START HERE" in its README), and
the installation guide describes that wizard in its own words. It is one WebView2 copy
smaller than the two setups together. The build runs the bundler twice more (NSIS only),
so the Windows build job's limit rises to 90 minutes. CI installs the Viewer per user and
Studio for all users through it, and checks each with the existing smoke test. The guide
is not added to the Start menu: with no uninstaller of its own, the setup would leave it
behind. The WebView2 branch is exercised only on a machine without the runtime (the
Windows Sandbox check), as for the product setups.
