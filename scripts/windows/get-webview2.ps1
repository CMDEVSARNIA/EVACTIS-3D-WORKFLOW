<#
.SYNOPSIS
  Stages the Microsoft WebView2 Runtime offline (standalone) installer that the
  installers embed: exactly the file pinned in packaging\windows\webview2-pin.json,
  signed by Microsoft.

.DESCRIPTION
  The Tauri bundler's own "offlineInstaller" mode asks Microsoft's servers for the
  file name on every build, even when the file is cached, so it cannot build with
  networking disabled. EVACTIS 3DWORKFLOW uses webviewInstallMode "skip" and its own
  installer templates embed this file instead (ADR 0003).

  Pinned (ADR 0023): Microsoft's link always serves its newest installer, so the same
  commit built on two days would embed two different files (205 MB on 2026-11-19,
  281 MB on 2026-11-22). The build uses only the file whose SHA-256 and size are in
  webview2-pin.json; anything else stops it. Moving to a newer WebView2 is a
  deliberate change: run with -UpdatePin on a connected machine, test, commit the pin.

  Without the file, it is downloaded from the pin's own URL (Microsoft's delivery
  address for that file), else from Microsoft's permanent link, and checked against
  the pin. With -Offline the file must already be present; it is only checked.

  Output: target\webview2\MicrosoftEdgeWebView2RuntimeInstallerX64.exe
  Prints the full path, which build-installers.ps1 passes to NSIS/WiX through
  TAURI_EVX_WEBVIEW2_INSTALLER.
#>
param([switch]$Offline, [switch]$UpdatePin)
$ErrorActionPreference = 'Stop'
$repo = Resolve-Path "$PSScriptRoot\..\.."
$pinFile = Join-Path $repo 'packaging\windows\webview2-pin.json'
$pin = Get-Content -Raw $pinFile | ConvertFrom-Json
$dir = Join-Path $repo 'target\webview2'
$file = Join-Path $dir $pin.file
# Microsoft's permanent link to the x64 Evergreen Standalone Installer (newest version).
$latest = 'https://go.microsoft.com/fwlink/?linkid=2124701'

function Get-Sha256([string]$path) {
  (Get-FileHash -Algorithm SHA256 $path).Hash.ToLowerInvariant()
}

function Test-Pinned([string]$path) {
  (Test-Path $path) -and ((Get-Item $path).Length -eq [int64]$pin.bytes) -and
    ((Get-Sha256 $path) -eq $pin.sha256)
}

# Downloads $url to $path; returns the address it finally came from, or $null on failure.
function Save-From([string]$url, [string]$path) {
  $tmp = "$path.part"
  try {
    $ProgressPreference = 'SilentlyContinue'
    $r = Invoke-WebRequest -Uri $url -OutFile $tmp -UseBasicParsing -PassThru
    Move-Item -Force $tmp $path
    $final = $r.BaseResponse.RequestMessage.RequestUri
    if (-not $final) { $final = $r.BaseResponse.ResponseUri }
    if (-not $final) { $final = $url }
    return [string]$final
  } catch {
    Remove-Item -Force -ErrorAction SilentlyContinue $tmp
    Write-Warning "Could not download $url ($($_.Exception.Message))"
    return $null
  }
}

# Embed only a file Microsoft signed. Offline, revocation cannot be checked, so the
# status may be UnknownError; a missing, broken or foreign signature always fails.
function Assert-MicrosoftSigned([string]$path) {
  $sig = Get-AuthenticodeSignature $path
  if (-not $sig.SignerCertificate) { throw "WebView2 installer is not signed: $path" }
  if ($sig.Status -in @('HashMismatch', 'NotSigned', 'NotTrusted', 'Incompatible')) {
    throw "WebView2 installer signature is $($sig.Status): $path"
  }
  if ($sig.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') {
    throw "WebView2 installer is not signed by Microsoft: $($sig.SignerCertificate.Subject)"
  }
  if ($sig.Status -ne 'Valid') {
    Write-Warning "WebView2 installer signature status is $($sig.Status) (offline: revocation not checked)."
  }
  return $sig
}

New-Item -ItemType Directory -Force -Path $dir | Out-Null

if ($UpdatePin) {
  if ($Offline) { throw '-UpdatePin needs a connected machine.' }
  Write-Host 'Downloading the newest WebView2 Runtime offline installer from Microsoft...'
  $from = Save-From $latest $file
  if (-not $from) { throw 'Download failed.' }
  $sig = Assert-MicrosoftSigned $file
  $new = [ordered]@{
    file        = $pin.file
    sha256      = Get-Sha256 $file
    bytes       = (Get-Item $file).Length
    fileVersion = (Get-Item $file).VersionInfo.FileVersion
    url         = $from
    pinned      = (Get-Date -Format 'yyyy-MM-dd')
  }
  ($new | ConvertTo-Json) + "`n" | Set-Content -NoNewline -Encoding utf8 $pinFile
  Write-Host "Pinned $($new.sha256) ($([math]::Round($new.bytes / 1MB, 1)) MB, $($sig.SignerCertificate.Subject))."
  Write-Host 'Build and test the installers, then commit packaging\windows\webview2-pin.json.'
  Write-Output $file
  exit 0
}

if (-not (Test-Pinned $file)) {
  if (Test-Path $file) {
    Write-Warning "target\webview2 holds a different WebView2 installer than the pin; replacing it."
    Remove-Item -Force $file
  }
  if ($Offline) {
    throw "Pinned WebView2 installer missing: $file (sha256 $($pin.sha256)). Run prepare-offline-build.ps1 on a connected machine."
  }
  Write-Host 'Downloading the pinned WebView2 Runtime offline installer from Microsoft...'
  foreach ($url in @($pin.url, $latest)) {
    if (-not $url) { continue }
    if ((Save-From $url $file) -and (Test-Pinned $file)) { break }
  }
  if (-not (Test-Pinned $file)) {
    $got = if (Test-Path $file) {
      "Microsoft now serves sha256 $(Get-Sha256 $file), $([math]::Round((Get-Item $file).Length / 1MB, 1)) MB"
    } else { 'nothing could be downloaded' }
    if (Test-Path $file) { Remove-Item -Force $file }
    throw ("The pinned WebView2 installer (sha256 $($pin.sha256), pinned $($pin.pinned)) is no " +
      "longer available, and $got. To move to the newer one deliberately: run " +
      "scripts\windows\get-webview2.ps1 -UpdatePin, build and test, then commit " +
      'packaging\windows\webview2-pin.json (docs/windows-installers.md).')
  }
}

$sig = Assert-MicrosoftSigned $file
$mb = [math]::Round((Get-Item $file).Length / 1MB, 1)
Write-Host "WebView2 offline installer OK: pinned $($pin.pinned), sha256 $($pin.sha256) ($mb MB, $($sig.SignerCertificate.Subject))"
Write-Output $file
