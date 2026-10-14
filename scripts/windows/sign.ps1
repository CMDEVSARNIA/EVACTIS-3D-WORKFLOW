<#
.SYNOPSIS
  Authenticode-signs one file. Called by the Tauri bundler (bundle.windows.signCommand)
  for every .exe, .msi and the NSIS uninstaller. Works with no network access.

.DESCRIPTION
  Key sources (no cloud signing service is used, by Evactis decision - ADR 0008):
    EVX_SIGN_THUMBPRINT  SHA-1 thumbprint of a certificate in CurrentUser\My. This is
                         how a USB hardware token (e.g. SafeNet eToken) exposes the
                         Evactis certificate; signtool asks the token for the PIN.
    EVX_SIGN_PFX (+ EVX_SIGN_PFX_PASSWORD)  a local .pfx file (test certificates only;
                         public CAs no longer issue code-signing keys as files).
  EVX_TIMESTAMP_URL is optional. When it is unset (fully offline signing) files are
  signed without a timestamp; run scripts/windows/timestamp-later.ps1 on any connected
  machine before distribution - only file hashes leave the building, never the key.

  Files already signed by the same certificate are left alone, so a staged build can
  sign and timestamp the app executable before the installers are assembled.
#>
param([Parameter(Mandatory)][string]$File)
$ErrorActionPreference = 'Stop'

$signtool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" |
  Sort-Object FullName -Descending | Select-Object -First 1
if (-not $signtool) { throw 'signtool.exe not found (install the Windows 10/11 SDK)' }

$key = @()
if ($env:EVX_SIGN_THUMBPRINT) {
  $key = @('/sha1', $env:EVX_SIGN_THUMBPRINT)
  $existing = (Get-AuthenticodeSignature $File).SignerCertificate
  if ($existing -and $existing.Thumbprint -eq $env:EVX_SIGN_THUMBPRINT) {
    Write-Host "Already signed, skipping: $File"
    exit 0
  }
} elseif ($env:EVX_SIGN_PFX) {
  $key = @('/f', $env:EVX_SIGN_PFX)
  if ($env:EVX_SIGN_PFX_PASSWORD) { $key += @('/p', $env:EVX_SIGN_PFX_PASSWORD) }
} else {
  throw 'Set EVX_SIGN_THUMBPRINT (certificate store / USB token) or EVX_SIGN_PFX'
}

$stArgs = @('sign', '/fd', 'sha256') + $key + @('/d', 'EVACTIS 3DWORKFLOW')
if ($env:EVX_TIMESTAMP_URL) {
  $stArgs += @('/tr', $env:EVX_TIMESTAMP_URL, '/td', 'sha256')
} else {
  Write-Warning "Signing WITHOUT a timestamp (offline): $File - run timestamp-later.ps1 before distribution."
}
$stArgs += $File

for ($i = 1; $i -le 3; $i++) {
  & $signtool.FullName @args
  if ($LASTEXITCODE -eq 0) { exit 0 }
  Write-Warning "signtool failed (attempt $i), retrying"
  Start-Sleep -Seconds (2 * $i)
}
throw "Signing failed: $File"
