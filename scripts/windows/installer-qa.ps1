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
# Runs msiexec silently; on failure, shows the errors from its log.
function Invoke-Msi([string[]]$arguments, [string]$log) {
  $file = "$LogDir\$log.log"
  $p = Start-Process msiexec.exe -ArgumentList ($arguments + @('/qn', '/norestart', '/l*v', "`"$file`"")) -Wait -PassThru
  if ($p.ExitCode -ne 0 -and (Test-Path $file)) {
    Write-Host "  msiexec $($arguments -join ' ') ended with $($p.ExitCode); from its log:"
    Get-Content $file | Select-String -Pattern 'Error \d{4}|Return value 3|error code|failed' |
      Select-Object -Last 12 | ForEach-Object { Write-Host "    $($_.Line.Trim())" }
  }
  $p.ExitCode
}

# Late-bound call on a Windows Installer automation object.
function Invoke-Msi-Com($target, [string]$member, [string]$kind, [object[]]$arguments) {
  $target.GetType().InvokeMember($member, $kind, $null, $target, $arguments)
}

# Sets one Property-table value: select the row, change the record, update the row (no
# SQL UPDATE). On failure, says which statement and Windows Installer's own error.
function Set-MsiProperty($installer, $db, [string]$name, [string]$value) {
  $sql = "SELECT ``Property``, ``Value`` FROM ``Property`` WHERE ``Property`` = '$name'"
  try {
    $view = Invoke-Msi-Com $db 'OpenView' 'InvokeMethod' @($sql)
    Invoke-Msi-Com $view 'Execute' 'InvokeMethod' $null | Out-Null
    $row = Invoke-Msi-Com $view 'Fetch' 'InvokeMethod' $null
    if ($null -eq $row) { throw "no $name row in the Property table" }
    Invoke-Msi-Com $row 'StringData' 'SetProperty' @(2, $value) | Out-Null
    Invoke-Msi-Com $view 'Modify' 'InvokeMethod' @(2, $row) | Out-Null # msiViewModifyUpdate
    Invoke-Msi-Com $view 'Close' 'InvokeMethod' $null | Out-Null
  } catch {
    $detail = ''
    try {
      $last = Invoke-Msi-Com $installer 'LastErrorRecord' 'InvokeMethod' $null
      if ($last) { $detail = Invoke-Msi-Com $last 'FormatText' 'InvokeMethod' $null }
    } catch { }
    throw "Setting $name in the MSI failed ($($_.Exception.Message)); statement: $sql; Windows Installer: $detail"
  }
}

# One Property-table value of an MSI file.
function Get-MsiProperty([string]$Path, [string]$Name) {
  $wi = New-Object -ComObject WindowsInstaller.Installer
  $db = Invoke-Msi-Com $wi 'OpenDatabase' 'InvokeMethod' @($Path, 0) # read only
  $view = Invoke-Msi-Com $db 'OpenView' 'InvokeMethod' @("SELECT ``Value`` FROM ``Property`` WHERE ``Property`` = '$Name'")
  Invoke-Msi-Com $view 'Execute' 'InvokeMethod' $null | Out-Null
  $row = Invoke-Msi-Com $view 'Fetch' 'InvokeMethod' $null
  $value = if ($row) { Invoke-Msi-Com $row 'StringData' 'GetProperty' @(1) } else { $null }
  Invoke-Msi-Com $view 'Close' 'InvokeMethod' $null | Out-Null
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($db)
  $value
}

# The Upgrade table names the versions this package replaces or refuses (computed from its
# own version at build time). An older release has those bounds at its own, older version.
function Set-UpgradeBounds($installer, $db, [string]$From, [string]$To) {
  $view = Invoke-Msi-Com $db 'OpenView' 'InvokeMethod' @('SELECT `UpgradeCode`, `VersionMin`, `VersionMax`, `Language`, `Attributes`, `Remove`, `ActionProperty` FROM `Upgrade`')
  Invoke-Msi-Com $view 'Execute' 'InvokeMethod' $null | Out-Null
  $changed = 0
  while ($row = Invoke-Msi-Com $view 'Fetch' 'InvokeMethod' $null) {
    $hit = $false
    foreach ($col in 2, 3) {
      if ((Invoke-Msi-Com $row 'StringData' 'GetProperty' @($col)) -eq $From) {
        Invoke-Msi-Com $row 'StringData' 'SetProperty' @($col, $To) | Out-Null
        $hit = $true
      }
    }
    if ($hit) {
      # Version bounds are part of the key, so the row is replaced, not updated.
      Invoke-Msi-Com $view 'Modify' 'InvokeMethod' @(4, $row) | Out-Null # msiViewModifyReplace
      $changed++
    }
  }
  Invoke-Msi-Com $view 'Close' 'InvokeMethod' $null | Out-Null
  if ($changed -eq 0) { throw "no Upgrade row mentions $From" }
}

# A copy of $Source that Windows Installer sees as an older release of the same product.
function New-OlderMsi([string]$Source, [string]$Target, [string]$Version, [string]$Current) {
  Copy-Item $Source $Target -Force
  Set-ItemProperty $Target -Name IsReadOnly -Value $false
  $wi = New-Object -ComObject WindowsInstaller.Installer
  $db = Invoke-Msi-Com $wi 'OpenDatabase' 'InvokeMethod' @($Target, 1) # msiOpenDatabaseModeTransact
  Set-MsiProperty $wi $db 'ProductVersion' $Version
  Set-UpgradeBounds $wi $db $Current $Version
  Set-MsiProperty $wi $db 'ProductCode' ('{' + [guid]::NewGuid().ToString().ToUpper() + '}')
  # A new package code too, so Windows Installer does not take it for the cached release.
  $info = Invoke-Msi-Com $db 'SummaryInformation' 'GetProperty' @(1)
  Invoke-Msi-Com $info 'Property' 'SetProperty' @(9, ('{' + [guid]::NewGuid().ToString().ToUpper() + '}')) | Out-Null
  Invoke-Msi-Com $info 'Persist' 'InvokeMethod' $null | Out-Null
  Invoke-Msi-Com $db 'Commit' 'InvokeMethod' $null | Out-Null
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
  foreach ($root in 'HKLM', 'HKCU') {
    $where = (Get-ItemProperty "${root}:\Software\Evactis\$name" -ErrorAction SilentlyContinue).'(default)'
    Check (-not $where) "$what : install location forgotten in $root (was '$where')"
  }
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
  New-OlderMsi -Source $msi -Target $older -Version '0.0.1' -Current $version
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
  $lang = Get-MsiProperty $msiFr 'ProductLanguage'
  Check ($lang -eq '1036') "the French MSI is French (ProductLanguage $lang)"
  Check ((Get-Entries).Count -eq 1) 'one Apps & features entry'
  Check (Test-Path (Join-Path $machineDir $exeName)) 'program installed'
  Check ((Invoke-Msi @('/x', "`"$msiFr`"") 'fr-uninstall') -eq 0) 'fr-FR uninstall exit code 0'
  Test-Removed $machineDir 'French MSI'

  # ------------------------------------------------------------ setup in a folder with accents
  # "C:\Donnees d'Evactis\Visionneuse 3D" with e-acute and E-acute (this file stays ASCII).
  $accented = "C:\Donn$([char]0xE9)es d'$([char]0xC9)vactis\Visionneuse 3D"
  Write-Host "== NSIS setup into $accented"
  $exe = Join-Path $accented $exeName
  & "$PSScriptRoot\offline.ps1" -Programs @($exe)
  # One string: NSIS takes everything after /D= (spaces included, no quotes) as the folder,
  # and it must come last.
  $p = Start-Process $setup -ArgumentList "/S /AllUsers /D=$accented" -Wait -PassThru
  Check ($p.ExitCode -eq 0) "setup exit code 0 (got $($p.ExitCode))"
  Check (Test-Path $exe) 'program installed in the accented folder'
  if (-not (Test-Path $exe)) {
    $found = Get-ChildItem "$env:ProgramFiles\EVACTIS", "$env:LOCALAPPDATA\Programs\EVACTIS", 'C:\' -Filter $exeName -Recurse -Depth 4 -ErrorAction SilentlyContinue | Select-Object -First 3
    Write-Host "  INFO  the setup put it here instead: $($found.FullName -join ', ')"
  } else {
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
  }
  $open = (Get-ItemProperty "HKLM:\Software\Classes\$progId\shell\open\command" -ErrorAction SilentlyContinue).'(default)'
  Check ($open -like "*$accented*") "double-click opens the program in the accented folder ($open)"
  $uninstaller = @(Get-Entries | ForEach-Object { $_.UninstallString -replace '^"([^"]+)".*$', '$1' } | Where-Object { $_ -like '*uninstall.exe' })[0]
  if ($uninstaller) {
    $dir = Split-Path $uninstaller
    $p = Start-Process $uninstaller -ArgumentList '/S' -Wait -PassThru
    for ($i = 0; $i -lt 60 -and (Test-Path (Join-Path $dir $exeName)); $i++) { Start-Sleep -Seconds 1 }
    Check ($p.ExitCode -eq 0) 'uninstall exit code 0'
  } else { Check $false 'uninstaller found in Apps & features' }
  Test-Removed $accented 'NSIS in the accented folder'
  if (Test-Path (Split-Path $accented)) { Write-Host "  INFO  the empty parent folder stays: $(Split-Path $accented)" }
} finally {
  & "$PSScriptRoot\offline.ps1" -Disable
}

if ($failures.Count) { throw "Installer QA failed: $($failures -join '; ')" }
Write-Host '== installer QA passed'
