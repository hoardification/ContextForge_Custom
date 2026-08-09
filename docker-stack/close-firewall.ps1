<#
.SYNOPSIS
  Remove firewall rules created by the Context Forge open-firewall scripts.

.DESCRIPTION
  Rules are matched by group, not by port, so this still works if you have since
  changed ports in .env. Nothing outside the Context Forge groups is touched.

  Groups:
    ContextForge-LAN     created by open-firewall-lan.ps1
    ContextForge-Public  created by open-firewall-public.ps1
    ContextForge         the pre-split group, cleaned up when -Which All

  Needs an elevated PowerShell session.

.PARAMETER Which
  All (default), Lan, or Public.

  Use -Which Public to pull back a wide-open exposure while leaving your
  everyday LAN access in place.

.PARAMETER WhatIf
  Preview without changing anything.

.EXAMPLE
  .\close-firewall.ps1 -WhatIf

.EXAMPLE
  .\close-firewall.ps1 -Which Public
  Revoke the public rules, keep the LAN ones.

.EXAMPLE
  .\close-firewall.ps1
  Remove everything this project created.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [ValidateSet('All', 'Lan', 'Public')]
  [string]$Which = 'All'
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_common.ps1')

Assert-CfElevated

$groups = switch ($Which) {
  'Lan'    { @($script:CfGroupLan) }
  'Public' { @($script:CfGroupPublic) }
  default  { @($script:CfGroupLan, $script:CfGroupPublic, $script:CfGroupLegacy) }
}

$rules = @()
foreach ($g in $groups) {
  $found = Get-NetFirewallRule -Group $g -ErrorAction SilentlyContinue
  if ($found) { $rules += $found }
}

if ($rules.Count -eq 0) {
  Write-Host ''
  Write-Host ("  No Context Forge rules found for '{0}' - nothing to remove." -f $Which) -ForegroundColor DarkGray
  Write-Host ''
  exit 0
}

Write-Host ''
$removed = 0
foreach ($rule in $rules) {
  if ($PSCmdlet.ShouldProcess($rule.DisplayName, 'Remove firewall rule')) {
    Remove-NetFirewallRule -Name $rule.Name
    Write-Host "  removed  $($rule.DisplayName)" -ForegroundColor Yellow
    $removed++
  }
}

Write-Host ''
Write-Host ("  {0} rule(s) removed." -f $removed)

# What is still open after this?
$remaining = @()
foreach ($g in @($script:CfGroupLan, $script:CfGroupPublic, $script:CfGroupLegacy)) {
  $found = Get-NetFirewallRule -Group $g -ErrorAction SilentlyContinue
  if ($found) { $remaining += $found }
}

if ($remaining.Count -gt 0) {
  Write-Host ("  {0} Context Forge rule(s) still in place." -f $remaining.Count) -ForegroundColor DarkGray
  Write-Host '  Run without -Which to remove all of them.' -ForegroundColor DarkGray
} else {
  Write-Host '  The stack is local-only again. Docker still publishes the ports,' -ForegroundColor DarkGray
  Write-Host '  but Windows Firewall will drop inbound connections from the LAN.' -ForegroundColor DarkGray
}
Write-Host ''
