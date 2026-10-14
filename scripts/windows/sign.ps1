<#
.SYNOPSIS
  Authenticode-signs one file. Called by the Tauri bundler (bundle.windows.signCommand)
  for every .exe, .msi and the NSIS uninstaller.

.DESCRIPTION
  Uses the certificate whose SHA-1 thumbprint is in $env:EVX_SIGN_THUMBPRINT
  (CurrentUser\My). Timestamps with $env:EVX_TIMESTAMP_URL when set (RFC 3161); the
  build machine needs network access for that, client machines never do.
#>
param([Parameter(Mandatory)][string]$File)
$ErrorActionPreference = 'Stop'

if (-not $env:EVX_SIGN_THUMBPRINT) { throw 'EVX_SIGN_THUMBPRINT is not set' }

$signtool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" |
  Sort-Object FullName -Descending | Select-Object -First 1
if (-not $signtool) { throw 'signtool.exe not found (install the Windows 10/11 SDK)' }

$args = @('sign', '/fd', 'sha256', '/sha1', $env:EVX_SIGN_THUMBPRINT, '/d', 'EVACTIS 3DWORKFLOW')
if ($env:EVX_TIMESTAMP_URL) { $args += @('/tr', $env:EVX_TIMESTAMP_URL, '/td', 'sha256') }
$args += $File

for ($i = 1; $i -le 3; $i++) {
  & $signtool.FullName @args
  if ($LASTEXITCODE -eq 0) { exit 0 }
  Write-Warning "signtool failed (attempt $i), retrying"
  Start-Sleep -Seconds (2 * $i)
}
throw "Signing failed: $File"
