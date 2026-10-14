<#
.SYNOPSIS
  Blocks outbound network access for the programs under test (installers, msiexec,
  the installed apps and every WebView2 process) with Windows Firewall rules.

.DESCRIPTION
  A hosted CI runner cannot drop its network adapter without losing the job, so CI
  isolates the product instead of the machine: every process that belongs to the
  install or the app is denied all outbound traffic, and a dead proxy is set for
  WinINet/WinHTTP. The full air-gap check (adapter disabled, no WebView2 present)
  is the Windows Sandbox procedure in docs/windows-installers.md.

  -Enable <paths> adds rules; -Disable removes every rule this script created.
#>
param([string[]]$Programs = @(), [switch]$Disable)
$ErrorActionPreference = 'Stop'
$group = 'EVACTIS 3DWORKFLOW offline test'

if ($Disable) {
  Get-NetFirewallRule -Group $group -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  netsh winhttp reset proxy | Out-Null
  return
}

$targets = @($Programs) + @("$env:SystemRoot\System32\msiexec.exe", "$env:SystemRoot\SysWOW64\msiexec.exe")
$targets += Get-ChildItem "${env:ProgramFiles(x86)}\Microsoft\EdgeWebView\Application\*\msedgewebview2.exe" -ErrorAction SilentlyContinue |
  ForEach-Object FullName
foreach ($p in $targets | Where-Object { $_ } | Select-Object -Unique) {
  New-NetFirewallRule -DisplayName "EVX block $(Split-Path $p -Leaf)" -Group $group -Direction Outbound `
    -Action Block -Program $p -Profile Any | Out-Null
  Write-Host "Outbound blocked: $p"
}
# Anything using the system proxy (WinHTTP) goes nowhere.
netsh winhttp set proxy proxy-server="127.0.0.1:9" bypass-list="<local>" | Out-Null
