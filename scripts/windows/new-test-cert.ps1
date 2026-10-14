<#
.SYNOPSIS
  Creates a self-signed Authenticode code-signing certificate for CI and local test
  builds, until Evactis provides the real OV/EV certificate (docs/code-signing.md).

.OUTPUTS
  The certificate thumbprint. With -Trust, the certificate is also added to the
  machine's Trusted Root and Trusted Publishers stores so signatures verify on this
  machine only (test runners, never a client machine).
#>
param([switch]$Trust)
$ErrorActionPreference = 'Stop'

$cert = New-SelfSignedCertificate `
  -Type CodeSigningCert `
  -Subject 'CN=Evactis (TEST - not for distribution), O=Evactis, C=CA' `
  -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256 `
  -CertStoreLocation Cert:\CurrentUser\My `
  -NotAfter (Get-Date).AddDays(30)

if ($Trust) {
  $cer = Join-Path $env:TEMP 'evactis-test-signing.cer'
  Export-Certificate -Cert $cert -FilePath $cer | Out-Null
  Import-Certificate -FilePath $cer -CertStoreLocation Cert:\LocalMachine\Root | Out-Null
  Import-Certificate -FilePath $cer -CertStoreLocation Cert:\LocalMachine\TrustedPublisher | Out-Null
  Remove-Item $cer
}
$cert.Thumbprint
