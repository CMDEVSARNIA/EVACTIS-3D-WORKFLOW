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

# Signing hook for the bundler. Kept out of tauri.conf.json so unsigned local builds work.
$signConf = Join-Path $env:TEMP 'evx-sign.conf.json'
@{ bundle = @{ windows = @{ signCommand = @{ cmd = 'powershell.exe'; args = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "$sign", '%1') } } } } |
  ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 $signConf
$signing = [bool]($env:EVX_SIGN_THUMBPRINT -or $env:EVX_SIGN_PFX)
if (-not $signing) { Write-Warning 'No signing key configured: building UNSIGNED installers.' }

foreach ($app in @(@{ Dir = 'studio'; Name = 'Studio' }, @{ Dir = 'viewer-desktop'; Name = 'Viewer' })) {
  Push-Location (Join-Path $repo "apps\$($app.Dir)")
  try {
    $extra = @()
    if ($signing) { $extra = @('--config', $signConf) }
    pnpm tauri build --ci @extra
    if ($LASTEXITCODE -ne 0) { throw "tauri build failed for $($app.Name)" }
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
