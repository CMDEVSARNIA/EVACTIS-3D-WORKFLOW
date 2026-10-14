<#
.SYNOPSIS
  Builds the signed NSIS setup .exe and WiX .msi for Studio and Viewer and copies them
  to out\installers with stable names:
    EVACTIS-3DWORKFLOW-<App>-<version>-x64-setup.exe
    EVACTIS-3DWORKFLOW-<App>-<version>-x64-<lang>.msi
#>
param([string]$OutDir = 'out\installers')
$ErrorActionPreference = 'Stop'
$repo = Resolve-Path "$PSScriptRoot\..\.."
$sign = Join-Path $repo 'scripts\windows\sign.ps1'
New-Item -ItemType Directory -Force -Path (Join-Path $repo $OutDir) | Out-Null

# Signing hook for the bundler. Kept out of tauri.conf.json so unsigned local builds work.
$signConf = Join-Path $env:TEMP 'evx-sign.conf.json'
@{ bundle = @{ windows = @{ signCommand = @{ cmd = 'powershell.exe'; args = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "$sign", '%1') } } } } |
  ConvertTo-Json -Depth 6 | Set-Content -Encoding utf8 $signConf

foreach ($app in @(@{ Dir = 'studio'; Name = 'Studio' }, @{ Dir = 'viewer-desktop'; Name = 'Viewer' })) {
  Push-Location (Join-Path $repo "apps\$($app.Dir)")
  try {
    $extra = @()
    if ($env:EVX_SIGN_THUMBPRINT) { $extra = @('--config', $signConf) }
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
