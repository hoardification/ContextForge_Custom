<#
  Shared helpers for the Context Forge firewall scripts.

  Dot-sourced by open-firewall-lan.ps1, open-firewall-public.ps1 and
  close-firewall.ps1. The port list lives here so the LAN and Public scripts can
  never drift apart - a mismatch between them would silently leave a port open
  or closed in one mode but not the other.

  Not meant to be run directly.
#>

Set-StrictMode -Version Latest

# Rule groups. Kept separate so you can remove one exposure mode without
# touching the other. 'ContextForge' is the pre-split group name, still
# recognised by close-firewall.ps1 so older rules can be cleaned up.
$script:CfGroupLan    = 'ContextForge-LAN'
$script:CfGroupPublic = 'ContextForge-Public'
$script:CfGroupLegacy = 'ContextForge'

function Assert-CfElevated {
  <# Stop unless the session is elevated. Firewall changes require it. #>
  $isAdmin = ([Security.Principal.WindowsPrincipal] `
    [Security.Principal.WindowsIdentity]::GetCurrent()
  ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

  if (-not $isAdmin) {
    Write-Host ''
    Write-Host '  This script must run elevated.' -ForegroundColor Red
    Write-Host ''
    Write-Host '  Right-click PowerShell -> "Run as Administrator", then:'
    Write-Host ("    cd '{0}'" -f $PSScriptRoot)
    Write-Host ('    .\{0}' -f (Split-Path -Leaf $MyInvocation.PSCommandPath))
    Write-Host ''
    exit 1
  }
}

function Get-CfEnv {
  <# Parse ../.env into a hashtable. Returns an empty table if absent. #>
  $envFile = Join-Path $PSScriptRoot '..\.env'
  $vars = @{}

  if (-not (Test-Path $envFile)) { return $vars }

  foreach ($line in Get-Content $envFile) {
    if ($line -match '^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$') {
      $vars[$Matches[1]] = $Matches[2].Trim()
    }
  }
  return $vars
}

function Get-CfPorts {
  <#
    The stack's published ports, resolved against .env.

    Risk is annotated per service so the public script can warn about the ones
    that carry real consequences if reachable from a wider network: Postgres
    speaks straight to the database, and Ollama has no authentication at all.
  #>
  param([hashtable]$EnvVars = @{})

  function Resolve-Port($name, $default) {
    if ($EnvVars.ContainsKey($name) -and $EnvVars[$name]) { return [int]$EnvVars[$name] }
    return [int]$default
  }

  @(
    [pscustomobject]@{ Name = 'Address book UI';  Port = (Resolve-Port 'UI_PORT' 8080);            Risk = 'normal' }
    [pscustomobject]@{ Name = 'AI assistant UI';  Port = (Resolve-Port 'MCP_CLIENT_UI_PORT' 8081); Risk = 'normal' }
    [pscustomobject]@{ Name = 'Address REST API'; Port = (Resolve-Port 'API_PORT' 4000);           Risk = 'normal' }
    [pscustomobject]@{ Name = 'MCP server';       Port = (Resolve-Port 'MCP_HTTP_PORT' 4100);      Risk = 'elevated' }
    [pscustomobject]@{ Name = 'Agent backend';    Port = (Resolve-Port 'MCP_CLIENT_PORT' 4200);    Risk = 'normal' }
    [pscustomobject]@{ Name = 'Context Forge';    Port = (Resolve-Port 'GATEWAY_PORT' 4444);       Risk = 'elevated' }
    [pscustomobject]@{ Name = 'Ollama';           Port = (Resolve-Port 'OLLAMA_PORT' 11434);       Risk = 'high' }
    [pscustomobject]@{ Name = 'Postgres';         Port = (Resolve-Port 'POSTGRES_PORT' 5432);      Risk = 'high' }
  )
}

function Get-CfDefaultCredentials {
  <#
    Return the .env keys still holding a shipped default value.

    Used by the public script to refuse widening exposure while the demo
    passwords are in place. An empty array means nothing obvious was found -
    it is not a guarantee the credentials are strong.
  #>
  param([hashtable]$EnvVars = @{})

  $shipped = @{
    'JWT_SECRET'             = 'change-me-to-a-long-random-string'
    'POSTGRES_PASSWORD'      = 'forge_dev_password'
    'ADMIN_PASSWORD'         = 'admin123'
    'MCP_PASSWORD'           = 'viewer123'
    'GATEWAY_ADMIN_PASSWORD' = 'changeme'
    'GATEWAY_JWT_SECRET'     = 'change-me-gateway-secret'
  }

  $found = @()
  foreach ($key in $shipped.Keys) {
    if (-not $EnvVars.ContainsKey($key)) {
      # Absent from .env means the compose default applies, which is the
      # shipped value.
      $found += $key
    } elseif ($EnvVars[$key] -eq $shipped[$key]) {
      $found += $key
    }
  }
  return $found | Sort-Object
}

function Write-CfRuleTable {
  <# Consistent listing of what a script is about to do. #>
  param(
    [array]$Ports,
    [string]$Scope,
    [string[]]$Profiles
  )

  Write-Host ('  {0,-18} {1,-8} {2}' -f 'SERVICE', 'PORT', 'RISK IF WIDELY REACHABLE')
  Write-Host ('  ' + ('-' * 62))

  foreach ($p in $Ports) {
    $colour = switch ($p.Risk) {
      'high'     { 'Red' }
      'elevated' { 'Yellow' }
      default    { 'Gray' }
    }
    $note = switch ($p.Risk) {
      'high'     { if ($p.Name -eq 'Ollama') { 'unauthenticated model API' } else { 'direct database access' } }
      'elevated' { if ($p.Name -eq 'MCP server') { 'agent tools incl. delete' } else { 'gateway admin console' } }
      default    { '' }
    }
    Write-Host ('  {0,-18} TCP {1,-6} {2}' -f $p.Name, $p.Port, $note) -ForegroundColor $colour
  }

  Write-Host ('  ' + ('-' * 62))
  Write-Host ("  Profiles: {0}" -f ($Profiles -join ', '))
  Write-Host ("  Scope:    {0}" -f $Scope)
  Write-Host ''
}
