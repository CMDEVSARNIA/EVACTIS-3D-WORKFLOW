# IT deployment guide — EVACTIS 3DWORKFLOW

*Phase 1 draft; completed in Phase 12. Version numbers below are examples.*

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

Both are Authenticode-signed by Evactis and timestamped.

## MSI — silent install and removal

```bat
msiexec /i EVACTIS-3DWORKFLOW-Viewer-0.1.0-x64-en-US.msi /qn /norestart /l*v viewer-install.log
msiexec /x EVACTIS-3DWORKFLOW-Viewer-0.1.0-x64-en-US.msi /qn /norestart
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
EVACTIS-3DWORKFLOW-Viewer-0.1.0-x64-setup.exe /S /AllUsers      :: per-machine (admin)
EVACTIS-3DWORKFLOW-Viewer-0.1.0-x64-setup.exe /S /CurrentUser   :: per-user, no admin
"C:\Program Files\EVACTIS\3DWORKFLOW\Viewer\uninstall.exe" /S
```

Per-user installs go to `%LOCALAPPDATA%\Programs\EVACTIS\3DWORKFLOW\<App>`.

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
`msiexec /i "EVACTIS-3DWORKFLOW-Viewer-0.1.0-x64-en-US.msi" /qn /norestart`. Uninstall:
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

## Updates

There is no auto-updater. New versions ship as new installers that upgrade in place.
Clients running the optional 3DWORKFLOW Site Server (Phase 11) can host the latest
installer on their LAN.
