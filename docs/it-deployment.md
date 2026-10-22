# IT deployment guide — EVACTIS 3DWORKFLOW

*Version numbers below are examples. Companion guides: [Site Server](site-server.md),
[release procedure](release-procedure.md), [security review](security-review.md).*

EVACTIS 3DWORKFLOW Studio and Viewer install and uninstall like any Windows program.
Neither contacts Evactis, Microsoft or any other server: no telemetry, no update
checks, no licence server. Installs succeed with networking fully disabled.

## System requirements

| | Minimum | Recommended |
| --- | --- | --- |
| OS | Windows 10 22H2 or Windows 11, x64 | Windows 11 x64 |
| RAM | 8 GB | 16 GB for Studio |
| GPU | WebGL2-capable | Discrete GPU for large 3D/splat scenes |
| Disk (program) | Viewer ≈ 300 MB, Studio ≈ 350 MB including the embedded WebView2 installer during setup; ≈ 30 MB each once installed (+ ≈ 500 MB if WebView2 was missing) | |

## Packages

| File | Use |
| --- | --- |
| `EVACTIS-3DWORKFLOW-<App>-<ver>-x64-setup.exe` | Interactive install (EN/FR wizard), per-machine or per-user. |
| `EVACTIS-3DWORKFLOW-<App>-<ver>-x64-en-US.msi` / `-fr-FR.msi` | Managed, per-machine deployment (GPO, Intune, SCCM/ConfigMgr). |

Both are Authenticode-signed by Evactis (offline, on a hardware token; see
`docs/code-signing.md` for timestamping).

## MSI — silent install and removal

```bat
msiexec /i EVACTIS-3DWORKFLOW-Viewer-1.0.0-x64-en-US.msi /qn /norestart /l*v viewer-install.log
msiexec /x EVACTIS-3DWORKFLOW-Viewer-1.0.0-x64-en-US.msi /qn /norestart
```

| Property | Default | Meaning |
| --- | --- | --- |
| `INSTALLDIR` | `C:\Program Files\EVACTIS\3DWORKFLOW\Viewer` | Install folder |
| `ALLUSERS` | `1` (fixed) | Per-machine install |

| Product | UpgradeCode (fixed forever) |
| --- | --- |
| EVACTIS 3DWORKFLOW Studio | `{909A880C-A380-4ACC-B63B-4C710E275196}` |
| EVACTIS 3DWORKFLOW Viewer | `{31227426-D911-4A16-AC52-B73EF932C17F}` |

Installing a newer MSI upgrades in place and keeps user data and settings. Installing
an older version is refused ("A newer version … is already installed").

## Setup .exe — silent options

```bat
EVACTIS-3DWORKFLOW-Viewer-1.0.0-x64-setup.exe /S /AllUsers      :: per-machine (admin)
EVACTIS-3DWORKFLOW-Viewer-1.0.0-x64-setup.exe /S /CurrentUser   :: per-user, no admin
"C:\Program Files\EVACTIS\3DWORKFLOW\Viewer\uninstall.exe" /S
```

Per-user installs go to `%LOCALAPPDATA%\Programs\EVACTIS\3DWORKFLOW\<App>`.
The setup's install folder is fixed in silent installs (it ignores `/D=`): to deploy to
another folder, use the MSI with `INSTALLDIR`. Uninstalling either kind removes the
program, its shortcuts, file association and remembered install location.

## Group Policy (software installation)

1. Copy the MSI to a share readable by computer accounts (`\\server\deploy\evactis\`).
2. GPMC → Computer Configuration → Policies → Software Settings → Software installation
   → New → Package → choose the MSI by UNC path → **Assigned**.
3. For upgrades, add the new MSI and set it to upgrade the existing package; the shared
   UpgradeCode makes Windows Installer replace the old version.

## Microsoft Intune

1. Apps → Windows → Add → **Line-of-business app** → upload the MSI.
2. Install command and product code are read from the MSI; assign to device groups.
3. Detection: MSI product code (automatic). Intune itself needs connectivity to deliver
   the package; the installed product never does.

## Configuration Manager (SCCM / MECM)

Create an Application with a Windows Installer (`*.msi`) deployment type. Install:
`msiexec /i "EVACTIS-3DWORKFLOW-Viewer-1.0.0-x64-en-US.msi" /qn /norestart`. Uninstall:
`msiexec /x {ProductCode} /qn`. Detection: the MSI product code.

## WebView2 on offline machines

Studio and Viewer use the Microsoft Edge WebView2 runtime. The installers embed
Microsoft's **offline** WebView2 installer and run it silently only if the runtime is
missing, so no download ever happens. Windows 11 and most Windows 10 22H2 machines
already have it. To pre-stage it yourself, deploy Microsoft's "Evergreen Standalone
Installer" (x64) from your software repository first. Servicing the runtime follows
your own Windows Update / WSUS policy.

## What is written to the machine

| Location | Content | Removed on uninstall |
| --- | --- | --- |
| `C:\Program Files\EVACTIS\3DWORKFLOW\<App>` | Program files, file-type icons, `licenses.md` | Yes |
| Start menu → `EVACTIS 3DWORKFLOW` | "3DWORKFLOW Studio", "3DWORKFLOW Viewer" | Yes |
| Desktop shortcut (optional) | | Yes |
| `HKLM\Software\Classes\.evxproj`, `.evx` + ProgIDs | File associations | Yes |
| Apps & features entry | Name, publisher "Evactis", version, icon | Yes |
| `%APPDATA%\ca.evactis.3dworkflow.<app>`, `%LOCALAPPDATA%\ca.evactis.3dworkflow.<app>` | Settings, WebView2 cache | Only if the user ticks "Delete application data" (setup .exe) |
| `Documents\EVACTIS 3DWORKFLOW` | User projects | **Never** |

## Delivered environments (what clients receive per facility)

Evactis prepares each facility's environment in Studio and delivers it in one of these
forms (ADR 0018). All of them work with no network connection; every file is checked
against an SHA-256 manifest before use, and encrypted ones ask for a passphrase that
travels separately.

| Form | How it is opened | IT notes |
| --- | --- | --- |
| Per-facility setup (`<Facility> Setup.exe`) | Installs the Viewer with the environment, per user, Start menu "Evactis – <facility>" | No administrator rights; `/S` for silent; uninstalls only its own files; installs WebView2 from its own offline copy only if missing |
| `.evx` file | Double-click (needs the Viewer installed), or "Open an environment…" | Deploy the Viewer MSI once, then copy `.evx` files to a share or each PC |
| Portable folder | Run `EVACTIS-3DWORKFLOW-Viewer.exe` in the folder; `viewer.json` beside it names the environment | Nothing installed; needs WebView2 on the PC unless a fixed runtime was included |
| Intranet folder | Publish on any internal web server (static files) | Strict Content-Security-Policy is in the pages; no server code |
| Browser folder / single HTML file | Open `index.html` / the `.html` file from disk | For PCs where nothing can be installed |
| SCORM 1.2 / 2004 | Import into the LMS | Reports score, completion, success, time only |

## Application control (AppLocker, WDAC, Defender SmartScreen)

Every program is Authenticode-signed by Evactis, including the bundled FFmpeg and the
Viewer inside Studio; a **publisher rule for "Evactis"** covers them all. Per-facility
setups are signed at Evactis's signing station before delivery. Nothing downloads or
executes code at runtime, and no scripting engine is exposed.

## Network and firewall

Studio and the Viewer need **no network access and no firewall rules**; they may be
blocked outbound entirely (CI tests them that way). The optional Site Server needs
inbound HTTPS (8443/tcp), TURN (3478/udp) and its relay range (49160–49200/udp) from the
site network only, and no outbound access; its `install-task` command adds those inbound
rules ([site-server.md](site-server.md#network)).

## Accessibility

Studio, the Viewer and the Site Server pages are tested against WCAG 2.1 AA (automated
rules, text contrast, 24 px targets, 44 px on the Viewer toolbar), work in English and
French, follow the system's reduced-motion setting, and can be used with the keyboard
alone, including placing scenes, hotspots and equipment in Studio.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Blank window | WebView2 Runtime present (`Apps & features` → "Microsoft Edge WebView2 Runtime"); for portable viewers, a fixed runtime in `webview2\` beside the program |
| "This environment failed its integrity check" | The package was altered or damaged in transit; copy it again from the original medium |
| Passphrase refused | The passphrase is case-sensitive; it cannot be recovered (ask Evactis for a new package) |
| Self-test | `EVACTIS-3DWORKFLOW-Viewer.exe --smoke-test report.json` writes what the program checked (including that no network request was made) |

## Updates

There is no auto-updater and no update check. New versions ship as new installers that
upgrade in place (MSI: same UpgradeCode). Delivered environments are replaced by
delivering a new package; a package never overwrites an earlier one.
