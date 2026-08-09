<#
.SYNOPSIS
  Open the Context Forge ports on the Public firewall profile, and optionally to
  any remote address.

.DESCRIPTION
  Windows Firewall has two independent knobs, and "public" can mean either one.
  This script exposes both, deliberately, because conflating them is how people
  end up more exposed than they intended.

    1. PROFILE  - which network you are on. Windows classifies each connection
                  as Domain, Private or Public. A hotel or cafe network is
                  Public. So, frequently, is a home network Windows never
                  prompted you about. Rules on the Private profile simply do not
                  apply while you are on a Public-classified network.

    2. SCOPE    - who may connect. LocalSubnet permits only your own network
                  segment. Any permits every source address that can route to
                  you.

  DEFAULT BEHAVIOUR: Public profile, LocalSubnet scope. That is the common case -
  your LAN got classified Public and you just want it to work. It is no more
  exposed than open-firewall-lan.ps1.

  WIDENING THE SCOPE: pass -RemoteScope Any. This requires -IUnderstandTheRisk,
  and the script refuses while .env still holds shipped default credentials.

  Note that -RemoteScope Any does not by itself put the stack on the internet.
  You would also need a public IP and a router port-forward. What it does is
  remove Windows Firewall as the thing standing in the way.

.PARAMETER RemoteScope
  LocalSubnet (default) or Any.

.PARAMETER FirewallProfile
  Defaults to Public. Accepts Public, Private, Domain, or Any.

.PARAMETER IUnderstandTheRisk
  Required for -RemoteScope Any. See the risk notes printed by the script.

.PARAMETER Force
  Skip the interactive confirmation. The credential check still applies.

.PARAMETER WhatIf
  Preview without changing anything.

.EXAMPLE
  .\open-firewall-public.ps1
  Public profile, LocalSubnet scope. The safe, common case.

.EXAMPLE
  .\open-firewall-public.ps1 -WhatIf -RemoteScope Any -IUnderstandTheRisk
  Preview what widening the scope would create.

.EXAMPLE
  .\open-firewall-public.ps1 -RemoteScope Any -IUnderstandTheRisk

.NOTES
  Undo with:  .\close-firewall.ps1 -Which Public
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [ValidateSet('LocalSubnet', 'Any')]
  [string]$RemoteScope = 'LocalSubnet',

  [ValidateSet('Public', 'Private', 'Domain', 'Any')]
  [string[]]$FirewallProfile = @('Public'),

  [switch]$IUnderstandTheRisk,

  [switch]$Force
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_common.ps1')

Assert-CfElevated

$envVars = Get-CfEnv
$ports = Get-CfPorts -EnvVars $envVars
$wide = ($RemoteScope -eq 'Any')

$scopeLabel = if ($wide) {
  'Any (every source address that can route to this machine)'
} else {
  'LocalSubnet (your network segment only)'
}

Write-Host ''
Write-Host '  Context Forge - Public profile firewall rules' -ForegroundColor Cyan
Write-Host ''
Write-CfRuleTable -Ports $ports -Scope $scopeLabel -Profiles $FirewallProfile

# ---------------------------------------------------------------------------
# Gates. These apply only when actually widening the scope - running on the
# Public profile at LocalSubnet scope carries the same exposure as the LAN
# script, so it would be theatre to gate it.
# ---------------------------------------------------------------------------
if ($wide) {

  Write-Host '  WIDE-OPEN SCOPE REQUESTED' -ForegroundColor Red
  Write-Host ''
  Write-Host '  What this stack looks like to anyone who can reach it:' -ForegroundColor Yellow
  Write-Host '    - Plain HTTP. Logins and JWTs cross the wire unencrypted and'
  Write-Host '      can be read or replayed by anything on the path.'
  Write-Host '    - Postgres 5432 speaks directly to the database.'
  Write-Host '    - Ollama 11434 has no authentication whatsoever; anyone who'
  Write-Host '      reaches it can run inference on your hardware.'
  Write-Host '    - The MCP server exposes agent tools that can delete records'
  Write-Host '      and reseed the database, gated only by the account used.'
  Write-Host ''
  Write-Host '  This is a demo stack. It has not been hardened for hostile' -ForegroundColor Yellow
  Write-Host '  traffic, and nothing about it was designed assuming it would' -ForegroundColor Yellow
  Write-Host '  meet any. A reverse proxy terminating TLS, in front of a' -ForegroundColor Yellow
  Write-Host '  narrowed port set, is the right shape if you need real remote' -ForegroundColor Yellow
  Write-Host '  access. A VPN or Tailscale is better still, and easier.' -ForegroundColor Yellow
  Write-Host ''

  if (-not $IUnderstandTheRisk) {
    Write-Host '  Refusing: -RemoteScope Any requires -IUnderstandTheRisk.' -ForegroundColor Red
    Write-Host ''
    Write-Host '  If you have read the above and still want this:'
    Write-Host '    .\open-firewall-public.ps1 -RemoteScope Any -IUnderstandTheRisk'
    Write-Host ''
    exit 1
  }

  $weak = Get-CfDefaultCredentials -EnvVars $envVars
  if ($weak.Count -gt 0) {
    Write-Host '  Refusing: these still hold shipped default values in .env -' -ForegroundColor Red
    Write-Host ''
    foreach ($k in $weak) { Write-Host "      $k" -ForegroundColor Red }
    Write-Host ''
    Write-Host '  Opening the stack to any address while the published demo'
    Write-Host '  credentials are in place would hand over the database and the'
    Write-Host '  admin account to anyone who reads this repository.'
    Write-Host ''
    Write-Host '  Set real values in .env, then:'
    Write-Host '    docker compose up -d --force-recreate'
    Write-Host ''
    exit 1
  }

  if (-not $Force -and -not $WhatIfPreference) {
    Write-Host '  Type EXPOSE to confirm, anything else to abort: ' -ForegroundColor Yellow -NoNewline
    $answer = Read-Host
    if ($answer -cne 'EXPOSE') {
      Write-Host '  Aborted. Nothing was changed.' -ForegroundColor DarkGray
      Write-Host ''
      exit 1
    }
    Write-Host ''
  }
}

# ---------------------------------------------------------------------------
$created = 0
$skipped = 0

foreach ($p in $ports) {
  $ruleName = "ContextForge Public - $($p.Name) (TCP $($p.Port))"

  if (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue) {
    Write-Host ('  {0,-18} TCP {1,-6} already present' -f $p.Name, $p.Port) -ForegroundColor DarkGray
    $skipped++
    continue
  }

  if ($PSCmdlet.ShouldProcess($ruleName, "Create inbound allow rule ($RemoteScope)")) {
    $params = @{
      DisplayName = $ruleName
      Group       = $script:CfGroupPublic
      Description = "Context Forge address book stack - $($p.Name). Scope: $RemoteScope."
      Direction   = 'Inbound'
      Action      = 'Allow'
      Protocol    = 'TCP'
      LocalPort   = $p.Port
      Profile     = $FirewallProfile
    }
    # Omitting RemoteAddress entirely means Any; passing 'Any' is also accepted.
    if (-not $wide) { $params['RemoteAddress'] = 'LocalSubnet' }

    New-NetFirewallRule @params | Out-Null

    $colour = if ($wide -and $p.Risk -eq 'high') { 'Red' } else { 'Green' }
    Write-Host ('  {0,-18} TCP {1,-6} opened ({2})' -f $p.Name, $p.Port, $RemoteScope) -ForegroundColor $colour
    $created++
  }
}

Write-Host ''
Write-Host ("  {0} rule(s) created, {1} already existed." -f $created, $skipped)
Write-Host ''

if ($wide) {
  Write-Host '  Windows Firewall is no longer blocking these ports from any' -ForegroundColor Yellow
  Write-Host '  source. Whether anyone outside your network can actually reach' -ForegroundColor Yellow
  Write-Host '  them now depends on your router - a NAT without a port-forward' -ForegroundColor Yellow
  Write-Host '  still stands in the way. Verify from outside before assuming' -ForegroundColor Yellow
  Write-Host '  either way.' -ForegroundColor Yellow
  Write-Host ''
  Write-Host '  Close it again the moment you are done:' -ForegroundColor Yellow
  Write-Host '    .\close-firewall.ps1 -Which Public' -ForegroundColor Yellow
  Write-Host ''
} else {
  Write-Host '  Public profile, LocalSubnet scope - reachable from your own' -ForegroundColor DarkGray
  Write-Host '  network segment only, same exposure as the LAN script.' -ForegroundColor DarkGray
  Write-Host ''
  Write-Host '  Print your URLs with:  .\lan-urls.ps1' -ForegroundColor DarkGray
  Write-Host '  Undo with:             .\close-firewall.ps1 -Which Public' -ForegroundColor DarkGray
  Write-Host ''
}
