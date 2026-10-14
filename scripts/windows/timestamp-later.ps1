<#
.SYNOPSIS
  Adds RFC 3161 timestamps to files that were signed offline.

.DESCRIPTION
  Run on any machine with internet access (no certificate or token needed): signtool
  sends only each file's signature hash to the timestamp authority. Copy the signed
  files there on removable media, run this, copy them back. Afterwards the signatures
  stay valid after the signing certificate expires.

.EXAMPLE
  .\timestamp-later.ps1 -Path E:\release\out\installers
#>
param(
  [Parameter(Mandatory)][string]$Path,
  [string]$Url = 'http://timestamp.digicert.com'
)
$ErrorActionPreference = 'Stop'
$signtool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" |
  Sort-Object FullName -Descending | Select-Object -First 1
if (-not $signtool) { throw 'signtool.exe not found (install the Windows 10/11 SDK)' }

$files = Get-ChildItem $Path -Recurse -Include *.exe, *.msi, *.dll
foreach ($f in $files) {
  $sig = Get-AuthenticodeSignature $f.FullName
  if (-not $sig.SignerCertificate) { Write-Warning "Not signed, skipped: $($f.Name)"; continue }
  if ($sig.TimeStamperCertificate) { Write-Host "Already timestamped: $($f.Name)"; continue }
  & $signtool.FullName timestamp /tr $Url /td sha256 $f.FullName
  if ($LASTEXITCODE -ne 0) { throw "Timestamping failed: $($f.Name)" }
  & $signtool.FullName verify /pa /v $f.FullName | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Verification failed after timestamping: $($f.Name)" }
  Write-Host "Timestamped: $($f.Name)"
}
