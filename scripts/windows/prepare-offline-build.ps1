<#
.SYNOPSIS
  Fills every cache an EVACTIS 3DWORKFLOW Windows build needs, so later builds (and
  signing) can run on a machine with networking disabled.

.DESCRIPTION
  Run once on a connected machine, from a clone of the repository:
    - pnpm store       (all npm packages for the lockfile)
    - Cargo registry   (all crates for Cargo.lock)
    - Tauri tools dir  (NSIS, WiX, NSIS plugins) in target\.tauri, because
                       tauri.conf.json sets useLocalToolsDir
    - WebView2 Runtime offline installer in target\webview2 (get-webview2.ps1),
                       checked to be signed by Microsoft
    - LGPL ffmpeg/ffprobe for Studio in target\ffmpeg (get-ffmpeg.ps1), checked to
                       be built without --enable-gpl / --enable-nonfree
  Then copy the repository folder, %LOCALAPPDATA%\pnpm\store and %USERPROFILE%\.cargo
  to the offline build machine (or build on this machine after disconnecting it) and
  run:  scripts\windows\build-installers.ps1 -Offline
#>
$ErrorActionPreference = 'Stop'
$repo = Resolve-Path "$PSScriptRoot\..\.."
Push-Location $repo
try {
  pnpm fetch --frozen-lockfile
  if ($LASTEXITCODE -ne 0) { throw 'pnpm fetch failed' }
  pnpm install --frozen-lockfile --offline
  if ($LASTEXITCODE -ne 0) { throw 'pnpm install failed' }
  cargo fetch --locked
  if ($LASTEXITCODE -ne 0) { throw 'cargo fetch failed' }
  # One unsigned online build downloads and caches the bundler tools.
  $env:TURBO_TELEMETRY_DISABLED = '1'
  pnpm turbo run build
  & "$PSScriptRoot\build-installers.ps1" -OutDir 'out\prepare'
  Remove-Item -Recurse -Force 'out\prepare'
  Write-Host 'Offline build caches are ready.'
} finally { Pop-Location }
