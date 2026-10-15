<#
.SYNOPSIS
  Stages the Microsoft WebView2 Runtime offline (standalone) installer that both
  installers embed, and checks it is signed by Microsoft.

.DESCRIPTION
  The Tauri bundler's own "offlineInstaller" mode asks Microsoft's servers for the
  file name on every build, even when the file is cached, so it cannot build with
  networking disabled. EVACTIS 3DWORKFLOW uses webviewInstallMode "skip" and its own
  installer templates embed this file instead (ADR 0003).

  Run on a connected machine (prepare-offline-build.ps1 does this). With -Offline the
  file must already be present; it is only verified.

  Output: target\webview2\MicrosoftEdgeWebView2RuntimeInstallerX64.exe
  Prints the full path, which build-installers.ps1 passes to NSIS/WiX through
  EVX_WEBVIEW2_INSTALLER.
#>
param([switch]$Offline)
$ErrorActionPreference = 'Stop'
$repo = Resolve-Path "$PSScriptRoot\..\.."
$dir = Join-Path $repo 'target\webview2'
$file = Join-Path $dir 'MicrosoftEdgeWebView2RuntimeInstallerX64.exe'
# Microsoft's permanent link to the x64 Evergreen Standalone Installer.
$url = 'https://go.microsoft.com/fwlink/?linkid=2124701'

if (-not (Test-Path $file)) {
  if ($Offline) {
    throw "WebView2 offline installer missing: $file (run prepare-offline-build.ps1 on a connected machine)"
  }
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  Write-Host "Downloading the WebView2 Runtime offline installer from Microsoft..."
  $tmp = "$file.part"
  $ProgressPreference = 'SilentlyContinue'
  Invoke-WebRequest -Uri $url -OutFile $tmp -UseBasicParsing
  Move-Item -Force $tmp $file
}

# Embed only a file Microsoft signed. Offline, revocation cannot be checked, so the
# status may be UnknownError; a missing, broken or foreign signature always fails.
$sig = Get-AuthenticodeSignature $file
if (-not $sig.SignerCertificate) { throw "WebView2 installer is not signed: $file" }
if ($sig.Status -in @('HashMismatch', 'NotSigned', 'NotTrusted', 'Incompatible')) {
  throw "WebView2 installer signature is $($sig.Status): $file"
}
if ($sig.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') {
  throw "WebView2 installer is not signed by Microsoft: $($sig.SignerCertificate.Subject)"
}
if ($sig.Status -ne 'Valid') {
  Write-Warning "WebView2 installer signature status is $($sig.Status) (offline: revocation not checked)."
}
$mb = [math]::Round((Get-Item $file).Length / 1MB, 1)
Write-Host "WebView2 offline installer OK ($mb MB, $($sig.SignerCertificate.Subject))"
Write-Output $file
