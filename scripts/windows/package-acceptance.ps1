<#
.SYNOPSIS
  Phase 10 acceptance for the desktop delivery packages, with every product process
  firewalled (scripts/windows/offline.ps1):
    - the per-facility installer installs silently for the current user, creates its
      Start menu shortcut and Apps & features entry, opens straight into its
      environment, and uninstalls cleanly;
    - the portable viewer opens its environment from its own folder, no install;
    - with the 3DWORKFLOW Viewer installed, a .evx opens through the registered
      double-click command; an encrypted one opens with its passphrase and refuses a
      wrong one; a .evx with one altered byte fails its integrity check.

.PARAMETER Packages
  Folder made by the build job (tools/package.mjs): "<Name> Setup.exe", portable\,
  demo.evx, demo-encrypted.evx, demo-altered.evx.

.PARAMETER ViewerInstaller
  The 3DWORKFLOW Viewer setup .exe (installed per user for the .evx checks).

.PARAMETER Name
  The facility name the packages were made with ("Evactis Demo Centre").
#>
param(
  [Parameter(Mandatory)][string]$Packages,
  [Parameter(Mandatory)][string]$ViewerInstaller,
  [string]$Name = 'Evactis Demo Centre',
  [string]$Passphrase = 'correct horse battery staple',
  [string]$LogDir = 'out\packages-smoke'
)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$LogDir = (Resolve-Path $LogDir).Path
$Packages = (Resolve-Path $Packages).Path
$failures = [System.Collections.Generic.List[string]]::new()
function Check([bool]$ok, [string]$what) {
  if ($ok) { Write-Host "  PASS  $what" } else { Write-Host "  FAIL  $what"; $failures.Add($what) }
}

# Runs a Viewer with --smoke-test and returns its report (or $null).
function Invoke-Smoke([string]$exe, [string]$tag, [string[]]$extra = @()) {
  $report = Join-Path $LogDir "$tag.json"
  Remove-Item $report -ErrorAction SilentlyContinue
  $argList = @('--smoke-test', "`"$report`"") + $extra
  $run = Start-Process $exe -ArgumentList $argList -PassThru
  if (-not $run.WaitForExit(150000)) { $run.Kill(); Check $false "$tag finished within 150 s" }
  if (-not (Test-Path $report)) { Check $false "$tag wrote a report"; return $null }
  $r = Get-Content $report -Raw | ConvertFrom-Json
  Check (@($r.blockedRequests).Count -eq 0) "$tag made no network request ($(@($r.blockedRequests) -join ', '))"
  foreach ($line in @($r.checks)) { Write-Host "        $line" }
  return $r
}
function Opened($r, [string]$tag) {
  Check ($null -ne $r -and $null -eq $r.error -and @($r.checks).Count -gt 0) "$tag opened its environment ($($r.error))"
}
function Refused($r, [string]$tag, [string]$text) {
  Check ($null -ne $r -and "$($r.error)" -like "*$text*") "$tag refused: $($r.error)"
}

$setup = Join-Path $Packages "$Name Setup.exe"
$installDir = Join-Path $env:LOCALAPPDATA "Programs\Evactis\$Name"
$installed = Join-Path $installDir 'EVACTIS-3DWORKFLOW-Viewer.exe'
$portableDir = Join-Path $env:TEMP 'evx-portable-test'
$portable = Join-Path $portableDir 'EVACTIS-3DWORKFLOW-Viewer.exe'
$viewerDir = Join-Path $env:LOCALAPPDATA 'Programs\EVACTIS\3DWORKFLOW\Viewer'
$viewer = Join-Path $viewerDir 'EVACTIS-3DWORKFLOW-Viewer.exe'

Remove-Item $portableDir -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item (Join-Path $Packages 'portable') $portableDir -Recurse
& "$PSScriptRoot\offline.ps1" -Programs @($setup, $installed, (Join-Path $installDir 'Uninstall.exe'), $portable, $ViewerInstaller, $viewer)
try {
  # ---- per-facility installer --------------------------------------------------
  Write-Host "== per-facility installer: $setup"
  $shortcut = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Evactis – $Name.lnk"
  Check ((Get-Item $setup).Length -gt 100MB) 'setup carries the WebView2 offline installer for PCs without the runtime'
  $p = Start-Process $setup -ArgumentList '/S' -Wait -PassThru
  Check ($p.ExitCode -eq 0) "silent per-user install exit code 0 (got $($p.ExitCode))"
  Check (Test-Path $installed) "installed to $installDir"
  Check ((Get-AuthenticodeSignature $installed).SignerCertificate -ne $null) 'installed Viewer program is signed'
  Check (Test-Path $shortcut) "Start menu shortcut 'Evactis – $Name'"
  if (Test-Path $shortcut) {
    $target = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcut).TargetPath
    Check ($target -eq $installed) "shortcut opens the installed Viewer ($target)"
  }
  $entry = Get-ChildItem 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall' |
    Get-ItemProperty | Where-Object { $_.DisplayName -eq "Evactis – $Name" }
  Check ($null -ne $entry) 'Apps & features entry'
  # Started like the shortcut: no file argument, the environment comes from viewer.json.
  Opened (Invoke-Smoke $installed 'installer-launch') 'installed environment'
  $p = Start-Process (Join-Path $installDir 'Uninstall.exe') -ArgumentList '/S' -Wait -PassThru
  for ($i = 0; $i -lt 60 -and (Test-Path $installed); $i++) { Start-Sleep -Seconds 1 }
  Check (-not (Test-Path $installed)) 'uninstall removed the program'
  Check (-not (Test-Path $installDir)) 'uninstall removed the install folder'
  Check (-not (Test-Path $shortcut)) 'uninstall removed the shortcut'

  # ---- portable viewer -----------------------------------------------------------
  Write-Host "== portable viewer: $portableDir"
  Opened (Invoke-Smoke $portable 'portable-launch') 'portable environment'

  # ---- .evx with the installed 3DWORKFLOW Viewer -------------------------------
  Write-Host "== .evx files with the installed Viewer"
  $p = Start-Process $ViewerInstaller -ArgumentList @('/S', '/CurrentUser') -Wait -PassThru
  Check ($p.ExitCode -eq 0) "Viewer per-user install exit code 0 (got $($p.ExitCode))"
  $open = (Get-ItemProperty 'HKCU:\Software\Classes\Evactis.3DWORKFLOW.Environment\shell\open\command' -ErrorAction SilentlyContinue).'(default)'
  Check ($open -like '*%1*') ".evx double-click command registered ($open)"
  # The registered command, as Explorer runs it on a double-click, plus the smoke flags.
  $exe = if ($open -match '^"([^"]+)"') { $Matches[1] } else { $viewer }
  function Open-Evx([string]$file, [string]$tag, [string[]]$extra = @()) {
    Invoke-Smoke $exe $tag (@("`"$file`"") + $extra)
  }
  Opened (Open-Evx (Join-Path $Packages 'demo.evx') 'evx-double-click') '.evx'
  Opened (Open-Evx (Join-Path $Packages 'demo-encrypted.evx') 'evx-encrypted' @('--smoke-passphrase', "`"$Passphrase`"")) 'encrypted .evx'
  Refused (Open-Evx (Join-Path $Packages 'demo-encrypted.evx') 'evx-wrong-passphrase' @('--smoke-passphrase', "`"wrong $Passphrase`"")) 'wrong passphrase' 'passphrase was refused'
  Refused (Open-Evx (Join-Path $Packages 'demo-altered.evx') 'evx-altered') 'altered .evx' 'failed its integrity check'
  $p = Start-Process (Join-Path $viewerDir 'uninstall.exe') -ArgumentList '/S' -Wait -PassThru
  for ($i = 0; $i -lt 60 -and (Test-Path $viewer); $i++) { Start-Sleep -Seconds 1 }
} finally {
  & "$PSScriptRoot\offline.ps1" -Disable
  Remove-Item $portableDir -Recurse -Force -ErrorAction SilentlyContinue
}

if ($failures.Count) { throw "package acceptance failed: $($failures -join '; ')" }
Write-Host '== package acceptance passed'
