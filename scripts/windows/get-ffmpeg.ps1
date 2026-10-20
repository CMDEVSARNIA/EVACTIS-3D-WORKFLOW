<#
.SYNOPSIS
  Stages the ffmpeg/ffprobe that 3DWORKFLOW Studio bundles for 360 video import, and
  refuses any build Evactis may not redistribute.

.DESCRIPTION
  Studio runs ffmpeg as a separate local program (never downloaded at runtime). Only
  LGPL builds are allowed: the "configuration:" line of `ffmpeg -version` must not
  contain --enable-gpl or --enable-nonfree (ADR 0010).

  Source: BtbN FFmpeg-Builds, static win64 LGPL release-branch build. Without -Url the
  newest "ffmpeg-nX.Y-latest-win64-lgpl-X.Y.zip" from the "latest" release is used;
  release builds should pass -Url (and -Sha256) to pin an archived copy.

  Run on a connected machine (prepare-offline-build.ps1 does this). With -Offline the
  files must already be present; they are only checked.

  Output folder: target\ffmpeg  (ffmpeg.exe, ffprobe.exe, LICENSE.txt, SOURCE.txt)
#>
param([switch]$Offline, [string]$Url, [string]$Sha256)
$ErrorActionPreference = 'Stop'
$repo = Resolve-Path "$PSScriptRoot\..\.."
$dir = Join-Path $repo 'target\ffmpeg'
$ffmpeg = Join-Path $dir 'ffmpeg.exe'
$ffprobe = Join-Path $dir 'ffprobe.exe'

if (-not ((Test-Path $ffmpeg) -and (Test-Path $ffprobe))) {
  if ($Offline) {
    throw "ffmpeg missing in $dir (run prepare-offline-build.ps1 on a connected machine)"
  }
  $ProgressPreference = 'SilentlyContinue'
  $assetName = $null
  if (-not $Url) {
    $headers = @{ 'User-Agent' = 'evactis-3dworkflow-build' }
    # In CI, the job's own token avoids the shared runners' anonymous API rate limit.
    if ($env:GITHUB_TOKEN) { $headers.Authorization = "Bearer $env:GITHUB_TOKEN" }
    $release = Invoke-RestMethod 'https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/tags/latest' -Headers $headers
    $best = $null
    foreach ($a in $release.assets) {
      $m = [regex]::Match($a.name, '^ffmpeg-n(\d+)\.(\d+)-latest-win64-lgpl-\d+\.\d+\.zip$')
      if (-not $m.Success) { continue }
      $v = [version]"$($m.Groups[1].Value).$($m.Groups[2].Value)"
      if (-not $best -or $v -gt $best.Version) { $best = @{ Version = $v; Asset = $a } }
    }
    if (-not $best) { throw 'No win64 LGPL release-branch build found in BtbN/FFmpeg-Builds "latest"' }
    $Url = $best.Asset.browser_download_url
    $assetName = $best.Asset.name
  }
  $work = Join-Path ([IO.Path]::GetTempPath()) ("evx-ffmpeg-" + [guid]::NewGuid())
  New-Item -ItemType Directory -Force -Path $work | Out-Null
  try {
    $zip = Join-Path $work 'ffmpeg.zip'
    Write-Host "Downloading $Url"
    Invoke-WebRequest -Uri $Url -OutFile $zip -UseBasicParsing
    $hash = (Get-FileHash -Algorithm SHA256 $zip).Hash.ToLowerInvariant()
    if ($Sha256 -and $hash -ne $Sha256.ToLowerInvariant()) {
      throw "ffmpeg archive SHA-256 is $hash, expected $Sha256"
    }
    Expand-Archive -Path $zip -DestinationPath $work
    $bin = Get-ChildItem -Path $work -Recurse -Filter 'ffmpeg.exe' | Select-Object -First 1
    if (-not $bin) { throw 'ffmpeg.exe not found in the archive' }
    $root = Split-Path (Split-Path $bin.FullName)
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    Copy-Item (Join-Path $root 'bin\ffmpeg.exe') $ffmpeg -Force
    Copy-Item (Join-Path $root 'bin\ffprobe.exe') $ffprobe -Force
    $license = Get-ChildItem -Path $root -Filter 'LICENSE*' | Select-Object -First 1
    if (-not $license) { throw 'The archive has no LICENSE file' }
    Copy-Item $license.FullName (Join-Path $dir 'LICENSE.txt') -Force
    $name = if ($assetName) { $assetName } else { Split-Path $Url -Leaf }
    @(
      'FFmpeg, bundled with EVACTIS 3DWORKFLOW Studio for local 360 video conversion.'
      'Licence: GNU LGPL (see LICENSE.txt). It runs as a separate program.'
      ''
      "Archive: $name"
      "Downloaded from: $Url"
      "Archive SHA-256: $hash"
      ''
      'Corresponding source: the FFmpeg release named in `ffmpeg -version`, built with'
      'the BtbN/FFmpeg-Builds scripts. Evactis provides a copy of that source on'
      'request, on physical media, for at least three years from distribution.'
    ) | Set-Content -Encoding ascii (Join-Path $dir 'SOURCE.txt')
  } finally {
    Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
  }
}

# Licence check: refuse GPL and non-free builds, whatever their origin.
$versionText = (& $ffmpeg -hide_banner -version) -join "`n"
if ($LASTEXITCODE -ne 0) { throw "ffmpeg did not run: $ffmpeg" }
$config = ([regex]::Match($versionText, '(?m)^\s*configuration:(.*)$')).Groups[1].Value
if (-not $config) { throw 'ffmpeg -version printed no configuration line' }
$flags = $config -split '\s+'
foreach ($bad in @('--enable-gpl', '--enable-nonfree')) {
  if ($flags -contains $bad) { throw "This ffmpeg build uses $bad; Evactis may only redistribute LGPL builds" }
}
& $ffprobe -hide_banner -version | Out-Null
if ($LASTEXITCODE -ne 0) { throw "ffprobe did not run: $ffprobe" }
$first = ($versionText -split "`n")[0]
Write-Host "ffmpeg OK (LGPL): $first"
Write-Output $dir
