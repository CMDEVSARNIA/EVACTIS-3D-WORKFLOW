# Code signing — how Evactis obtains and provides the certificate

All installers and binaries are Authenticode-signed with SHA-256 and an RFC 3161
timestamp, so they stay valid after the certificate expires.

## Choosing a certificate

| | OV (Organization Validation) | EV (Extended Validation) |
| --- | --- | --- |
| Vetting | Business registration check | Stricter vetting of the legal entity |
| Key storage | Hardware token or cloud HSM (required by CA/B Forum rules since June 2023) | Hardware token or cloud HSM |
| SmartScreen | Builds reputation over downloads; early releases may still warn | Historically immediate reputation; Microsoft now treats EV and OV similarly, so expect some reputation building either way |
| Typical cost | Lower | Higher |

Recommendation: an **OV certificate held in a cloud HSM / key-vault signing service**
(e.g. DigiCert KeyLocker, SSL.com eSigner, Azure Trusted Signing where available to
Canadian organizations), because CI can sign without a physical token. Phase 12 will
document which reputation behaviour applies to the certificate actually bought.

## Steps for Evactis

1. Choose a CA and product; complete organization validation for **Evactis** (the
   subject name shown as "Publisher" in Windows).
2. Provide CI access: either a PFX (base64) + password as the GitHub secrets
   `WINDOWS_CERTIFICATE_PFX` / `WINDOWS_CERTIFICATE_PASSWORD`, or the HSM service's CI
   credentials (then `scripts/windows/sign.ps1` gets a provider branch).
3. Release builds then sign automatically; verify with
   `signtool verify /pa /v EVACTIS-3DWORKFLOW-Viewer-<ver>-x64-setup.exe`.

Until then CI signs with a temporary self-signed TEST certificate. Test-signed builds
are for CI only and must never be given to clients.

Timestamping needs network access **on the build machine only**; clients never do.
