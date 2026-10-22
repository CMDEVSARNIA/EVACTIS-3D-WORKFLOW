<#
.SYNOPSIS
  Install -> launch -> uninstall smoke test for one installer, with the product's
  network access blocked (scripts/windows/offline.ps1).

.EXAMPLE
  .\smoke-test.ps1 -Installer out\installers\EVACTIS-3DWORKFLOW-Viewer-1.0.0-x64-en-US.msi -App Viewer
  .\smoke-test.ps1 -Installer out\installers\EVACTIS-3DWORKFLOW-Studio-1.0.0-x64-setup.exe -App Studio -PerUser
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
$expectedProgId = if ($App -eq 'Studio') { 'Evactis.3DWORKFLOW.Project' } else { 'Evactis.3DWORKFLOW.Environment' }
# `cmd assoc` only shows machine-wide associations, so read the registry directly.
function Get-Association {
  $root = if ($PerUser) { 'HKCU:\Software\Classes' } else { 'HKLM:\Software\Classes' }
  (Get-ItemProperty "$root\.$ext" -ErrorAction SilentlyContinue).'(default)'
}
function Find-Uninstall {
  $roots = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall', 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall'
  Get-ChildItem $roots -ErrorAction SilentlyContinue | Get-ItemProperty | Where-Object { $_.DisplayName -eq $name }
}

Write-Host "== $tag : $Installer"
Check ((Get-AuthenticodeSignature $Installer).Status -eq 'Valid') 'installer Authenticode signature is valid'

# Studio also runs its bundled ffmpeg/ffprobe; they are blocked like the app itself.
$ffmpeg = Join-Path $installDir 'ffmpeg\ffmpeg.exe'
$ffprobe = Join-Path $installDir 'ffmpeg\ffprobe.exe'
$blocked = @($Installer, $exe)
if ($App -eq 'Studio') { $blocked += @($ffmpeg, $ffprobe) }
& "$PSScriptRoot\offline.ps1" -Programs $blocked
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
  $progId = Get-Association
  Check ($progId -eq $expectedProgId) ".$ext is associated with $expectedProgId (got '$progId')"
  $classes = if ($PerUser) { 'HKCU:\Software\Classes' } else { 'HKLM:\Software\Classes' }
  $icon = (Get-ItemProperty "$classes\$expectedProgId\DefaultIcon" -ErrorAction SilentlyContinue).'(default)'
  Check ($icon -like "*filetypes\$ext.ico*") "file type icon is the branded .$ext icon ($icon)"
  $open = (Get-ItemProperty "$classes\$expectedProgId\shell\open\command" -ErrorAction SilentlyContinue).'(default)'
  Check ($open -like "*$exeName*") "double-click opens $exeName ($open)"

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

  # ---- Studio: what its Package dialog puts into desktop packages ----
  if ($App -eq 'Studio') {
    $bundledViewer = Join-Path $installDir 'viewer\EVACTIS-3DWORKFLOW-Viewer.exe'
    Check (Test-Path $bundledViewer) 'Viewer program bundled for packages'
    if (Test-Path $bundledViewer) {
      Check ($null -ne (Get-AuthenticodeSignature $bundledViewer).SignerCertificate) 'bundled Viewer program is signed'
    }
    Check (Test-Path (Join-Path $installDir 'viewer\icon.ico')) 'Viewer icon bundled for installers'
    Check (Test-Path (Join-Path $installDir 'nsis\makensis.exe')) 'NSIS bundled for per-facility installers'
    Check (Test-Path (Join-Path $installDir 'nsis\Include\MUI2.nsh')) 'NSIS Modern UI bundled'
    Check (Test-Path (Join-Path $installDir 'nsis\COPYING*')) 'NSIS licence text bundled'
    $wv2 = Join-Path $installDir 'webview2-installer\MicrosoftEdgeWebView2RuntimeInstallerX64.exe'
    Check ((Test-Path $wv2) -and (Get-AuthenticodeSignature $wv2).SignerCertificate.Subject -like '*Microsoft*') 'Microsoft WebView2 offline installer bundled for setups'
  }

  # ---- Studio media pipeline: bundled LGPL ffmpeg, a 12K panorama and a 360 video ----
  if ($App -eq 'Studio') {
    Check (Test-Path $ffmpeg) 'bundled ffmpeg installed'
    Check (Test-Path (Join-Path $installDir 'ffmpeg\LICENSE.txt')) 'ffmpeg licence text installed'
    if (Test-Path $ffmpeg) {
      $build = (& $ffmpeg -hide_banner -version) -join "`n"
      Check (($build -notmatch '--enable-gpl') -and ($build -notmatch '--enable-nonfree')) 'bundled ffmpeg is an LGPL build'
      $media = Resolve-Path $LogDir
      $pano = Join-Path $media "$tag-plant-room-12k.jpg"
      $video = Join-Path $media "$tag-walkthrough-360.mkv"
      & $ffmpeg -hide_banner -loglevel error -y -f lavfi -i 'testsrc2=size=12288x6144' -frames:v 1 -q:v 3 $pano
      & $ffmpeg -hide_banner -loglevel error -y -f lavfi -i 'testsrc2=size=1024x512:rate=15:duration=2' -c:v mpeg4 $video
      foreach ($file in @($pano, $video)) {
        $leaf = Split-Path $file -Leaf
        $rep = Join-Path $media "$tag-import-$leaf.json"
        Remove-Item $rep -ErrorAction SilentlyContinue
        $run = Start-Process $exe -ArgumentList @('--smoke-test', "`"$rep`"", '--smoke-import', "`"$file`"") -PassThru
        if (-not $run.WaitForExit(600000)) { $run.Kill(); Check $false "import of $leaf finished within 600 s" }
        Check ($run.ExitCode -eq 0) "import of $leaf exit code 0 (got $($run.ExitCode))"
        if (Test-Path $rep) {
          $r = Get-Content $rep | ConvertFrom-Json
          Check ($null -eq $r.error) "imported $leaf ($($r.error))"
          Check (@($r.blockedRequests).Count -eq 0) "no network requests during import ($(@($r.blockedRequests) -join ', '))"
          foreach ($line in @($r.checks)) { Write-Host "        $line" }
        } else { Check $false "import report for $leaf written" }
      }
    }
  }

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
  Check (-not (Get-Association)) ".$ext association removed"
} finally {
  & "$PSScriptRoot\offline.ps1" -Disable
}

if ($failures.Count) { throw "$tag failed: $($failures -join '; ')" }
Write-Host "== $tag passed"
