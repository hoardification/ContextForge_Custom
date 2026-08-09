<#
.SYNOPSIS
  Open the Context Forge ports to your own local network.

.DESCRIPTION
  Adds inbound TCP allow rules for the stack's published ports, scoped to
  LocalSubnet on the Private (and optionally Domain) firewall profile.

  LocalSubnet means: reachable from machines on your own network segment, and
  from nowhere else. Windows drops inbound connections from any other source
  regardless of what your router does. This is the script you want for a home
  or office LAN.

  This is the safe one. If you need something wider, read
  open-firewall-public.ps1 - it explains the trade-offs rather than just doing it.

.PARAMETER FirewallProfile
  Which profile(s) the rules apply to. Defaults to Private.

  Windows classifies each network you connect to. If your LAN is classified
  Public - which happens more often than you would expect - rules on the Private
  profile will not apply and nothing will be reachable. Check with:

      Get-NetConnectionProfile

  Either reclassify the network (Set-NetConnectionProfile -NetworkCategory
  Private) or use open-firewall-public.ps1, which targets the Public profile
  while keeping the same LocalSubnet scope.

  (Named FirewallProfile because $Profile is a PowerShell automatic variable.)

.PARAMETER WhatIf
  Preview without changing anything. Worth doing first.

.EXAMPLE
  .\open-firewall-lan.ps1 -WhatIf

.EXAMPLE
  .\open-firewall-lan.ps1

.EXAMPLE
  .\open-firewall-lan.ps1 -FirewallProfile Domain,Private

.NOTES
  Undo with:  .\close-firewall.ps1 -Which Lan
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [ValidateSet('Private', 'Domain')]
  [string[]]$FirewallProfile = @('Private')
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_common.ps1')

Assert-CfElevated

$envVars = Get-CfEnv
$ports = Get-CfPorts -EnvVars $envVars

Write-Host ''
Write-Host '  Context Forge - opening ports to the local subnet' -ForegroundColor Cyan
Write-Host ''
Write-CfRuleTable -Ports $ports -Scope 'LocalSubnet (your network segment only)' -Profiles $FirewallProfile

# The risk column above is about wider exposure; at LocalSubnet scope it is
# informational. Say so, so the red text doesn't read as a warning about this run.
Write-Host '  At LocalSubnet scope the risk column is informational only -' -ForegroundColor DarkGray
Write-Host '  it describes what those ports would mean if you widened the scope.' -ForegroundColor DarkGray
Write-Host ''

$created = 0
$skipped = 0

foreach ($p in $ports) {
  $ruleName = "ContextForge LAN - $($p.Name) (TCP $($p.Port))"

  if (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue) {
    Write-Host ('  {0,-18} TCP {1,-6} already present' -f $p.Name, $p.Port) -ForegroundColor DarkGray
    $skipped++
    continue
  }

  if ($PSCmdlet.ShouldProcess($ruleName, 'Create inbound allow rule')) {
    New-NetFirewallRule `
      -DisplayName $ruleName `
      -Group $script:CfGroupLan `
      -Description "Context Forge address book stack - $($p.Name). LocalSubnet only." `
      -Direction Inbound `
      -Action Allow `
      -Protocol TCP `
      -LocalPort $p.Port `
      -RemoteAddress LocalSubnet `
      -Profile $FirewallProfile | Out-Null

    Write-Host ('  {0,-18} TCP {1,-6} opened' -f $p.Name, $p.Port) -ForegroundColor Green
    $created++
  }
}

Write-Host ''
Write-Host ("  {0} rule(s) created, {1} already existed." -f $created, $skipped)
Write-Host ''

# Flag a profile mismatch - the single most common reason this "doesn't work".
try {
  $active = Get-NetConnectionProfile -ErrorAction Stop |
    Where-Object { $_.IPv4Connectivity -ne 'Disconnected' }

  $activeCategories = @($active | ForEach-Object { $_.NetworkCategory } | Sort-Object -Unique)
  $covered = @($activeCategories | Where-Object { $FirewallProfile -contains $_ })

  if ($activeCategories.Count -gt 0 -and $covered.Count -eq 0) {
    Write-Host ''
    Write-Warning @"
Your active network is classified '$($activeCategories -join ', ')', but these rules
target '$($FirewallProfile -join ', ')' - so they will not take effect.

Either reclassify the network:
    Set-NetConnectionProfile -Name '<name>' -NetworkCategory Private
Or use the Public-profile script, which keeps the same LocalSubnet scope:
    .\open-firewall-public.ps1
"@
  }
} catch {
  Write-Host '  (Could not read the active network profile; skipping that check.)' -ForegroundColor DarkGray
}

Write-Host '  Print your LAN URLs with:  .\lan-urls.ps1' -ForegroundColor DarkGray
Write-Host '  Undo with:                 .\close-firewall.ps1 -Which Lan' -ForegroundColor DarkGray
Write-Host ''

$weak = Get-CfDefaultCredentials -EnvVars $envVars
if ($weak.Count -gt 0) {
  Write-Warning @"
The stack is reachable by other machines on your network and these still hold
shipped defaults in .env:

  $($weak -join ', ')

Fine for a demo on a trusted LAN. Change them before leaving it running, then:
  docker compose up -d --force-recreate
"@
}
