<#
.SYNOPSIS
  Install → launch → uninstall smoke test for one installer, with the product's
  network access blocked (scripts/windows/offline.ps1).

.EXAMPLE
  .\smoke-test.ps1 -Installer out\installers\EVACTIS-3DWORKFLOW-Viewer-0.1.0-x64-en-US.msi -App Viewer
  .\smoke-test.ps1 -Installer out\installers\EVACTIS-3DWORKFLOW-Studio-0.1.0-x64-setup.exe -App Studio -PerUser
#>
param(
  [Parameter(Mandatory)][string]$Installer,
  [Parameter(Mandatory)][ValidateSet('Studio', 'Viewer')][string]$App,
  [switch]$PerUser,
  [string]$LogDir = 'out\smoke'
)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$Installer = (Resolve-Path $Installer).Path
$isMsi = $Installer.EndsWith('.msi')
$name = "EVACTIS 3DWORKFLOW $App"
$exeName = "EVACTIS-3DWORKFLOW-$App.exe"
$ext = if ($App -eq 'Studio') { 'evxproj' } else { 'evx' }
$base = if ($PerUser) { "$env:LOCALAPPDATA\Programs" } else { $env:ProgramFiles }
$installDir = Join-Path $base "EVACTIS\3DWORKFLOW\$App"
$exe = Join-Path $installDir $exeName
$menuRoot = if ($PerUser) { "$env:APPDATA\Microsoft\Windows\Start Menu\Programs" } else { "$env:ProgramData\Microsoft\Windows\Start Menu\Programs" }
$shortcut = Join-Path $menuRoot "EVACTIS 3DWORKFLOW\3DWORKFLOW $App.lnk"
$tag = "$App-$(if ($isMsi) { 'msi' } else { 'nsis' })-$(if ($PerUser) { 'user' } else { 'machine' })"
$failures = [System.Collections.Generic.List[string]]::new()
function Check([bool]$ok, [string]$what) {
  if ($ok) { Write-Host "  PASS  $what" } else { Write-Host "  FAIL  $what"; $failures.Add($what) }
}
function Find-Uninstall {
  $roots = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall', 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall'
  Get-ChildItem $roots -ErrorAction SilentlyContinue | Get-ItemProperty | Where-Object { $_.DisplayName -eq $name }
}

Write-Host "== $tag : $Installer"
Check ((Get-AuthenticodeSignature $Installer).Status -eq 'Valid') 'installer Authenticode signature is valid'

& "$PSScriptRoot\offline.ps1" -Programs @($Installer, $exe)
try {
  # ---- install (silent) ----
  if ($isMsi) {
    $p = Start-Process msiexec.exe -ArgumentList @('/i', "`"$Installer`"", '/qn', '/norestart', '/l*v', "`"$LogDir\$tag-install.log`"") -Wait -PassThru
  } else {
    $mode = if ($PerUser) { '/CurrentUser' } else { '/AllUsers' }
    $p = Start-Process $Installer -ArgumentList @('/S', $mode) -Wait -PassThru
  }
  Check ($p.ExitCode -eq 0) "silent install exit code 0 (got $($p.ExitCode))"
  Check (Test-Path $exe) "installed to $installDir"
  Check ((Get-AuthenticodeSignature $exe).Status -eq 'Valid') 'app executable signature is valid'
  Check ((Get-Item $exe).VersionInfo.ProductName -eq $name) "file properties show '$name'"
  Check (Test-Path $shortcut) "Start menu shortcut '$shortcut'"
  Check (Test-Path (Join-Path $installDir "filetypes\$ext.ico")) "branded .$ext file icon installed"
  $entry = Find-Uninstall
  Check ($null -ne $entry) "Apps & features entry '$name'"
  if ($entry) {
    Check ($entry.Publisher -eq 'Evactis') "publisher is Evactis (got '$($entry.Publisher)')"
    Check ([bool]$entry.DisplayVersion) "version shown ($($entry.DisplayVersion))"
  }
  $assoc = (cmd /c "assoc .$ext" 2>$null)
  Check ([bool]$assoc) ".$ext is associated ($assoc)"

  # ---- launch: the app renders its UI, reports through IPC and exits ----
  $report = Join-Path (Resolve-Path $LogDir) "$tag-report.json"
  Remove-Item $report -ErrorAction SilentlyContinue
  $run = Start-Process $exe -ArgumentList @('--smoke-test', "`"$report`"") -PassThru
  if (-not $run.WaitForExit(150000)) { $run.Kill(); Check $false 'app exited within 150 s' }
  Check ($run.ExitCode -eq 0) "app smoke test exit code 0 (got $($run.ExitCode))"
  if (Test-Path $report) {
    $r = Get-Content $report | ConvertFrom-Json
    Check ($r.uiReady -eq $true) "UI rendered in WebView2 ($($r.userAgent))"
    Check (@($r.blockedRequests).Count -eq 0) "no network requests attempted ($(@($r.blockedRequests) -join ', '))"
  } else { Check $false 'smoke report written' }

  # ---- uninstall (silent) ----
  if ($isMsi) {
    $p = Start-Process msiexec.exe -ArgumentList @('/x', "`"$Installer`"", '/qn', '/norestart', '/l*v', "`"$LogDir\$tag-uninstall.log`"") -Wait -PassThru
  } else {
    $p = Start-Process (Join-Path $installDir 'uninstall.exe') -ArgumentList @('/S') -Wait -PassThru
    # The NSIS uninstaller copies itself to %TEMP% and returns early; wait for it.
    for ($i = 0; $i -lt 60 -and (Test-Path $exe); $i++) { Start-Sleep -Seconds 1 }
  }
  Check ($p.ExitCode -eq 0) "silent uninstall exit code 0 (got $($p.ExitCode))"
  Check (-not (Test-Path $exe)) 'program files removed'
  Check (-not (Test-Path $shortcut)) 'Start menu shortcut removed'
  Check ($null -eq (Find-Uninstall)) 'Apps & features entry removed'
} finally {
  & "$PSScriptRoot\offline.ps1" -Disable
}

if ($failures.Count) { throw "$tag failed: $($failures -join '; ')" }
Write-Host "== $tag passed"
