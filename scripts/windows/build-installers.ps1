<#
.SYNOPSIS
  Builds the NSIS setup .exe and WiX .msi for Studio and Viewer and copies them to
  out\installers with stable names:
    EVACTIS-3DWORKFLOW-<App>-<version>-x64-setup.exe
    EVACTIS-3DWORKFLOW-<App>-<version>-x64-<lang>.msi

.PARAMETER Offline
  Build with no network access: Cargo and pnpm run offline, every HTTP(S) request from
  the toolchain is sent to a dead proxy (so a cache miss fails loudly instead of
  downloading), and no timestamp is requested. Run prepare-offline-build.ps1 once first.

  Signing: set EVX_SIGN_THUMBPRINT (USB token / certificate store) or EVX_SIGN_PFX;
  without either, the installers are built unsigned.
#>
param([string]$OutDir = 'out\installers', [switch]$Offline)
$ErrorActionPreference = 'Stop'
$repo = Resolve-Path "$PSScriptRoot\..\.."
$sign = Join-Path $repo 'scripts\windows\sign.ps1'
New-Item -ItemType Directory -Force -Path (Join-Path $repo $OutDir) | Out-Null

if ($Offline) {
  $env:CARGO_NET_OFFLINE = 'true'
  $env:npm_config_offline = 'true'
  $env:HTTP_PROXY = 'http://127.0.0.1:9'
  $env:HTTPS_PROXY = 'http://127.0.0.1:9'
  $env:ALL_PROXY = 'http://127.0.0.1:9'
  $env:NO_PROXY = ''
  Remove-Item Env:\EVX_TIMESTAMP_URL -ErrorAction SilentlyContinue
  Write-Host 'Offline build: network access disabled for the toolchain.'
}
$env:TURBO_TELEMETRY_DISABLED = '1'

# WebView2 offline installer, embedded by our NSIS/WiX templates (ADR 0003). Downloaded
# once when online; -Offline only verifies the staged copy.
$env:EVX_WEBVIEW2_INSTALLER = & "$PSScriptRoot\get-webview2.ps1" -Offline:$Offline | Select-Object -Last 1

$signing = [bool]($env:EVX_SIGN_THUMBPRINT -or $env:EVX_SIGN_PFX)
if (-not $signing) { Write-Warning 'No signing key configured: building UNSIGNED installers.' }
$env:EVX_SIGN_LOG = Join-Path $env:TEMP 'evx-sign.log'
Remove-Item $env:EVX_SIGN_LOG -ErrorAction SilentlyContinue

# LGPL ffmpeg/ffprobe for Studio's 360 video import (ADR 0010). Signed with the same
# key as the apps so application-control policies (AppLocker, WDAC) accept them.
$ffmpegDir = & "$PSScriptRoot\get-ffmpeg.ps1" -Offline:$Offline | Select-Object -Last 1
if ($signing) {
  foreach ($f in @('ffmpeg.exe', 'ffprobe.exe')) {
    & $sign (Join-Path $ffmpegDir $f)
    if ($LASTEXITCODE -ne 0) { throw "Signing $f failed" }
  }
}

# Per-app config overlay passed with --config (kept out of tauri.conf.json so plain
# local builds stay simple):
#  - signing hook, run under the same PowerShell as this script: Windows PowerShell 5.1
#    started from pwsh 7 inherits pwsh's PSModulePath and then cannot load the module
#    that provides Get-AuthenticodeSignature;
#  - Studio: the ffmpeg files as resources. The app's own resources are repeated so the
#    result is the same whether the bundler merges or replaces the map.
$shell = (Get-Process -Id $PID).Path
function New-Overlay($app) {
  $bundle = @{}
  if ($signing) {
    $bundle.windows = @{ signCommand = @{ cmd = $shell; args = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "$sign", '%1') } }
  }
  if ($app.Dir -eq 'studio') {
    $base = Get-Content (Join-Path $repo 'apps\studio\src-tauri\tauri.conf.json') -Raw | ConvertFrom-Json
    $resources = [ordered]@{}
    foreach ($p in $base.bundle.resources.PSObject.Properties) { $resources[$p.Name] = $p.Value }
    foreach ($f in @('ffmpeg.exe', 'ffprobe.exe', 'LICENSE.txt', 'SOURCE.txt')) {
      $resources["../../../target/ffmpeg/$f"] = "ffmpeg/$f"
    }
    $bundle.resources = $resources
  }
  $path = Join-Path $env:TEMP "evx-$($app.Dir).conf.json"
  @{ bundle = $bundle } | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 $path
  return $path
}

foreach ($app in @(@{ Dir = 'studio'; Name = 'Studio' }, @{ Dir = 'viewer-desktop'; Name = 'Viewer' })) {
  Push-Location (Join-Path $repo "apps\$($app.Dir)")
  try {
    $extra = @('--config', (New-Overlay $app))
    # --verbose: the bundler otherwise hides candle/light/makensis errors.
    pnpm tauri build --ci --verbose @extra
    if ($LASTEXITCODE -ne 0) {
      # The bundler hides the sign command's output; sign.ps1 keeps its own log.
      if (Test-Path $env:EVX_SIGN_LOG) { Get-Content $env:EVX_SIGN_LOG | Write-Host }
      throw "tauri build failed for $($app.Name)"
    }
  } finally { Pop-Location }

  $version = (Get-Content (Join-Path $repo "apps\$($app.Dir)\package.json") | ConvertFrom-Json).version
  $bundle = Join-Path $repo 'target\release\bundle'
  Get-ChildItem "$bundle\nsis\*$($app.Name)*setup.exe" | ForEach-Object {
    Copy-Item $_.FullName (Join-Path $repo "$OutDir\EVACTIS-3DWORKFLOW-$($app.Name)-$version-x64-setup.exe")
  }
  Get-ChildItem "$bundle\msi\*$($app.Name)*.msi" | ForEach-Object {
    $lang = ($_.BaseName -split '_')[-1]
    Copy-Item $_.FullName (Join-Path $repo "$OutDir\EVACTIS-3DWORKFLOW-$($app.Name)-$version-x64-$lang.msi")
  }
}
Get-ChildItem (Join-Path $repo $OutDir) | Format-Table Name, @{ n = 'MB'; e = { [math]::Round($_.Length / 1MB, 1) } }
