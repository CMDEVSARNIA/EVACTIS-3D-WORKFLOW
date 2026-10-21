<#
.SYNOPSIS
  Installer QA matrix (Phase 12), beyond smoke-test.ps1's install -> launch -> uninstall:
  upgrade over an older version, a refused downgrade, the French MSI, the setup in a
  folder with accents and an apostrophe, and what uninstall leaves behind.

.DESCRIPTION
  The "older version" is a copy of the release MSI with a lower ProductVersion and a new
  ProductCode (same UpgradeCode), so the real upgrade logic of the real package is what
  runs. Its signature no longer matches; msiexec installs it anyway, which is all this
  test needs. Run elevated, after the test signer is trusted (CI does both).

  Uninstall must remove the program folder, Start menu shortcuts, file association,
  ProgID and Apps & features entry. What it keeps on purpose (per-user app data, the
  NSIS install-location value) is listed as INFO so a change is visible in the log.

.EXAMPLE
  .\installer-qa.ps1 -Installers out\installers
#>
param(
  [Parameter(Mandatory)][string]$Installers,
  [string]$LogDir = 'out\installer-qa'
)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$LogDir = (Resolve-Path $LogDir).Path
$failures = [System.Collections.Generic.List[string]]::new()
function Check([bool]$ok, [string]$what) {
  if ($ok) { Write-Host "  PASS  $what" } else { Write-Host "  FAIL  $what"; $failures.Add($what) }
}
function Find-Installer([string]$pattern) {
  $f = @(Get-ChildItem (Join-Path $Installers $pattern))
  if ($f.Count -ne 1) { throw "expected one $pattern in $Installers, found $($f.Count)" }
  $f[0].FullName
}

$name = 'EVACTIS 3DWORKFLOW Viewer'
$exeName = 'EVACTIS-3DWORKFLOW-Viewer.exe'
$progId = 'Evactis.3DWORKFLOW.Environment'
$machineDir = Join-Path $env:ProgramFiles 'EVACTIS\3DWORKFLOW\Viewer'
$menuDir = Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs\EVACTIS 3DWORKFLOW'
$shortcut = Join-Path $menuDir '3DWORKFLOW Viewer.lnk'

function Get-Entries {
  $roots = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall', 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall'
  @(Get-ChildItem $roots -ErrorAction SilentlyContinue | Get-ItemProperty | Where-Object { $_.DisplayName -eq $name })
}
function Invoke-Msi([string[]]$arguments, [string]$log) {
  $p = Start-Process msiexec.exe -ArgumentList ($arguments + @('/qn', '/norestart', '/l*v', "`"$LogDir\$log.log`"")) -Wait -PassThru
  $p.ExitCode
}

# A copy of $Source that Windows Installer sees as an older release of the same product.
function New-OlderMsi([string]$Source, [string]$Target, [string]$Version) {
  Copy-Item $Source $Target -Force
  $wi = New-Object -ComObject WindowsInstaller.Installer
  $db = $wi.GetType().InvokeMember('OpenDatabase', 'InvokeMethod', $null, $wi, @($Target, 1))
  $code = '{' + [guid]::NewGuid().ToString().ToUpper() + '}'
  foreach ($sql in @(
      'UPDATE `Property` SET `Value` = ''' + $Version + ''' WHERE `Property` = ''ProductVersion''',
      'UPDATE `Property` SET `Value` = ''' + $code + ''' WHERE `Property` = ''ProductCode'''
    )) {
    $view = $db.GetType().InvokeMember('OpenView', 'InvokeMethod', $null, $db, @($sql))
    $view.GetType().InvokeMember('Execute', 'InvokeMethod', $null, $view, $null) | Out-Null
    $view.GetType().InvokeMember('Close', 'InvokeMethod', $null, $view, $null) | Out-Null
  }
  # A new package code too, so Windows Installer does not take it for the cached release.
  $info = $db.GetType().InvokeMember('SummaryInformation', 'GetProperty', $null, $db, @(1))
  $info.GetType().InvokeMember('Property', 'SetProperty', $null, $info, @(9, ('{' + [guid]::NewGuid().ToString().ToUpper() + '}'))) | Out-Null
  $info.GetType().InvokeMember('Persist', 'InvokeMethod', $null, $info, $null) | Out-Null
  $db.GetType().InvokeMember('Commit', 'InvokeMethod', $null, $db, $null) | Out-Null
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($info)
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($db)
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($wi)
}

# What a per-machine uninstall must leave: nothing of the program.
function Test-Removed([string]$installDir, [string]$what) {
  Check (-not (Test-Path $installDir)) "$what : program folder removed ($installDir)"
  Check (-not (Test-Path $shortcut)) "$what : Start menu shortcut removed"
  Check ((Get-Entries).Count -eq 0) "$what : Apps & features entry removed"
  Check (-not (Test-Path "HKLM:\Software\Classes\$progId")) "$what : ProgID $progId removed"
  $assoc = (Get-ItemProperty 'HKLM:\Software\Classes\.evx' -ErrorAction SilentlyContinue).'(default)'
  Check (-not $assoc) "$what : .evx association removed"
  # Kept on purpose or shared with Studio; listed so a change shows up in the log.
  foreach ($p in @(
      $menuDir,
      (Join-Path $env:ProgramFiles 'EVACTIS'),
      'HKLM:\Software\Evactis',
      'HKCU:\Software\Evactis',
      (Join-Path $env:LOCALAPPDATA 'ca.evactis.3dworkflow.viewer'),
      (Join-Path $env:APPDATA 'ca.evactis.3dworkflow.viewer')
    )) {
    if (Test-Path $p) { Write-Host "  INFO  $what : still present (kept or shared): $p" }
  }
}

$msi = Find-Installer 'EVACTIS-3DWORKFLOW-Viewer-*-x64-en-US.msi'
$msiFr = Find-Installer 'EVACTIS-3DWORKFLOW-Viewer-*-x64-fr-FR.msi'
$setup = Find-Installer 'EVACTIS-3DWORKFLOW-Viewer-*-setup.exe'
$version = (Get-Item $setup).Name -replace '^EVACTIS-3DWORKFLOW-Viewer-(.+)-x64-setup\.exe$', '$1'
$older = Join-Path $LogDir 'EVACTIS-3DWORKFLOW-Viewer-0.0.1-older.msi'
Check ((Get-Entries).Count -eq 0) 'no Viewer installed before the QA run'

& "$PSScriptRoot\offline.ps1" -Programs @($setup, (Join-Path $machineDir $exeName))
try {
  # ------------------------------------------------------------ upgrade and downgrade (MSI)
  Write-Host "== upgrade: 0.0.1 -> $version (MSI, per machine)"
  New-OlderMsi -Source $msi -Target $older -Version '0.0.1'
  Check ((Invoke-Msi @('/i', "`"$older`"") 'older-install') -eq 0) 'older version installs'
  Check ((Get-Entries).DisplayVersion -contains '0.0.1') 'Apps & features shows 0.0.1'
  Check ((Invoke-Msi @('/i', "`"$msi`"") 'upgrade') -eq 0) "upgrade to $version exit code 0"
  $entries = Get-Entries
  Check ($entries.Count -eq 1) "one Apps & features entry after the upgrade (found $($entries.Count))"
  Check ($entries[0].DisplayVersion -eq $version) "it shows $version (got '$($entries[0].DisplayVersion)')"
  $exe = Join-Path $machineDir $exeName
  Check ((Test-Path $exe) -and (Get-AuthenticodeSignature $exe).Status -eq 'Valid') 'the upgraded program is in place and signed'

  Write-Host '== downgrade refused'
  $code = Invoke-Msi @('/i', "`"$older`"") 'downgrade'
  Check ($code -ne 0) "installing 0.0.1 over $version is refused (exit code $code)"
  Check (@(Get-Entries).DisplayVersion -contains $version) "$version is still installed"

  Check ((Invoke-Msi @('/x', "`"$msi`"") 'upgrade-uninstall') -eq 0) 'uninstall exit code 0'
  Test-Removed $machineDir 'MSI after upgrade'

  # ------------------------------------------------------------ French MSI
  Write-Host '== French MSI (fr-FR)'
  Check ((Invoke-Msi @('/i', "`"$msiFr`"") 'fr-install') -eq 0) 'fr-FR MSI installs'
  $entries = Get-Entries
  Check ($entries.Count -eq 1 -and [int]$entries[0].Language -eq 1036) "Apps & features entry in French (Language $($entries[0].Language))"
  Check (Test-Path (Join-Path $machineDir $exeName)) 'program installed'
  Check ((Invoke-Msi @('/x', "`"$msiFr`"") 'fr-uninstall') -eq 0) 'fr-FR uninstall exit code 0'
  Test-Removed $machineDir 'French MSI'

  # ------------------------------------------------------------ setup in a folder with accents
  # "C:\Donnees d'Evactis\Visionneuse 3D" with e-acute and E-acute (this file stays ASCII).
  $accented = "C:\Donn$([char]0xE9)es d'$([char]0xC9)vactis\Visionneuse 3D"
  Write-Host "== NSIS setup into $accented"
  $exe = Join-Path $accented $exeName
  & "$PSScriptRoot\offline.ps1" -Programs @($exe)
  $p = Start-Process $setup -ArgumentList @('/S', '/AllUsers', "/D=$accented") -Wait -PassThru
  Check ($p.ExitCode -eq 0) "setup exit code 0 (got $($p.ExitCode))"
  Check (Test-Path $exe) 'program installed in the accented folder'
  $report = Join-Path $LogDir 'accented-report.json'
  Remove-Item $report -ErrorAction SilentlyContinue
  $run = Start-Process $exe -ArgumentList @('--smoke-test', "`"$report`"") -PassThru
  if (-not $run.WaitForExit(150000)) { $run.Kill(); Check $false 'app exited within 150 s' }
  Check ($run.ExitCode -eq 0) "the app starts from there (exit code $($run.ExitCode))"
  if (Test-Path $report) {
    $r = Get-Content $report | ConvertFrom-Json
    Check ($r.uiReady -eq $true) 'its UI renders'
    Check (@($r.blockedRequests).Count -eq 0) 'no network requests attempted'
  } else { Check $false 'smoke report written' }
  $open = (Get-ItemProperty "HKLM:\Software\Classes\$progId\shell\open\command" -ErrorAction SilentlyContinue).'(default)'
  Check ($open -like "*$accented*") "double-click opens the program in the accented folder ($open)"
  $p = Start-Process (Join-Path $accented 'uninstall.exe') -ArgumentList @('/S') -Wait -PassThru
  for ($i = 0; $i -lt 60 -and (Test-Path $exe); $i++) { Start-Sleep -Seconds 1 }
  Check ($p.ExitCode -eq 0) 'uninstall exit code 0'
  Test-Removed $accented 'NSIS in the accented folder'
  if (Test-Path (Split-Path $accented)) { Write-Host "  INFO  the empty parent folder stays: $(Split-Path $accented)" }
} finally {
  & "$PSScriptRoot\offline.ps1" -Disable
}

if ($failures.Count) { throw "Installer QA failed: $($failures -join '; ')" }
Write-Host '== installer QA passed'
