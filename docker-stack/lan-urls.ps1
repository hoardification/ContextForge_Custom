<#
.SYNOPSIS
  Print every Context Forge service URL using this machine's LAN IP.

.DESCRIPTION
  Detects the IPv4 address of the interface that actually carries traffic off
  this box (the one with a default gateway), ignoring loopback, WSL, Hyper-V
  and Docker virtual adapters. Override with LAN_IP in ../.env or -Ip.

.EXAMPLE
  .\lan-urls.ps1
  .\lan-urls.ps1 -Ip 192.168.1.50
#>
[CmdletBinding()]
param(
  [string]$Ip
)

$ErrorActionPreference = 'Stop'

# ---- load ../.env if present ----------------------------------------------
$envFile = Join-Path $PSScriptRoot '..\.env'
$envVars = @{}
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$') {
      $envVars[$Matches[1]] = $Matches[2].Trim()
    }
  }
}

function Get-Port($name, $default) {
  if ($envVars.ContainsKey($name) -and $envVars[$name]) { return $envVars[$name] }
  return $default
}

# ---- resolve the LAN IP ----------------------------------------------------
if (-not $Ip -and $envVars['LAN_IP']) { $Ip = $envVars['LAN_IP'] }

if (-not $Ip) {
  # Interfaces with a default route, best (lowest) metric first. This is the
  # address other machines on the network will actually be able to reach.
  $candidate = Get-NetIPConfiguration |
    Where-Object {
      $_.IPv4DefaultGateway -and
      $_.NetAdapter.Status -eq 'Up' -and
      $_.InterfaceAlias -notmatch 'Loopback|WSL|vEthernet|Hyper-V|Docker|VirtualBox|VMware'
    } |
    Sort-Object { $_.IPv4DefaultGateway.RouteMetric } |
    Select-Object -First 1

  if ($candidate) { $Ip = $candidate.IPv4Address.IPAddress }
}

if (-not $Ip) {
  Write-Warning 'Could not detect a LAN IP. Pass one explicitly: .\lan-urls.ps1 -Ip 192.168.1.50'
  exit 1
}

$bind = Get-Port 'BIND_ADDR' '0.0.0.0'
if ($bind -eq '127.0.0.1' -or $bind -eq 'localhost') {
  Write-Warning "BIND_ADDR is $bind, so these ports are NOT published to the LAN."
  Write-Warning 'Set BIND_ADDR=0.0.0.0 in .env and re-run: docker compose up -d'
  Write-Host ''
}

$services = @(
  @{ Name = 'Address book UI';    Container = 'cf-address-ui';    Port = (Get-Port 'UI_PORT' '8080');            Path = '' }
  @{ Name = 'AI assistant UI';    Container = 'cf-mcp-client-ui'; Port = (Get-Port 'MCP_CLIENT_UI_PORT' '8081'); Path = '' }
  @{ Name = 'Address REST API';   Container = 'cf-address-api';   Port = (Get-Port 'API_PORT' '4000');           Path = '/health' }
  @{ Name = 'MCP server (HTTP)';  Container = 'cf-mcp-server';    Port = (Get-Port 'MCP_HTTP_PORT' '4100');      Path = '/mcp' }
  @{ Name = 'Agent backend';      Container = 'cf-mcp-client';    Port = (Get-Port 'MCP_CLIENT_PORT' '4200');    Path = '/health' }
  @{ Name = 'Context Forge';      Container = 'cf-gateway';       Port = (Get-Port 'GATEWAY_PORT' '4444');       Path = '/admin' }
  @{ Name = 'Ollama';             Container = 'cf-ollama';        Port = (Get-Port 'OLLAMA_PORT' '11434');       Path = '/api/tags' }
  @{ Name = 'Postgres';           Container = 'cf-postgres';      Port = (Get-Port 'POSTGRES_PORT' '5432');      Path = $null }
)

# ---- ask Docker what is actually running -----------------------------------
# Without this, the list below is only what .env claims the ports WOULD be,
# whether or not anything is listening on them.
$running         = @{}
$dockerAvailable = $false
$dockerContext   = $null

if (Get-Command docker -ErrorAction SilentlyContinue) {
  try {
    $names = & docker ps --format '{{.Names}}' 2>$null
    if ($LASTEXITCODE -eq 0) {
      $dockerAvailable = $true
      foreach ($n in $names) { if ($n) { $running[$n.Trim()] = $true } }
      $dockerContext = (& docker context show 2>$null | Select-Object -First 1)
    }
  } catch { }
}

Write-Host ''
Write-Host "  Context Forge on the LAN - $Ip" -ForegroundColor Cyan
Write-Host ('  ' + ('-' * 60))

$down = 0
foreach ($s in $services) {
  $url = if ($null -eq $s.Path) {
    '{0}:{1}' -f $Ip, $s.Port
  } else {
    'http://{0}:{1}{2}' -f $Ip, $s.Port, $s.Path
  }

  if (-not $dockerAvailable)                  { $tag = ' ?  '; $color = 'Gray'  }
  elseif ($running.ContainsKey($s.Container)) { $tag = ' up '; $color = 'Green' }
  else                                        { $tag = 'down'; $color = 'Red'; $down++ }

  Write-Host '  ' -NoNewline
  Write-Host "[$tag]" -ForegroundColor $color -NoNewline
  Write-Host (' {0,-18} {1}' -f $s.Name, $url)
}

Write-Host ''

if (-not $dockerAvailable) {
  Write-Host '  Could not query Docker. The list above is only what .env says the' -ForegroundColor DarkGray
  Write-Host '  ports would be - it is not proof anything is listening.' -ForegroundColor DarkGray
}
else {
  # A CLI pointed somewhere other than the Docker Desktop engine will report
  # containers that Docker Desktop never shows, because they are not its.
  $suspect = $env:DOCKER_HOST -or ($dockerContext -and $dockerContext -notin @('default','desktop-linux'))
  if ($suspect) {
    Write-Host "  Heads up: docker CLI context is '$dockerContext'" -NoNewline -ForegroundColor Yellow
    if ($env:DOCKER_HOST) { Write-Host " (DOCKER_HOST=$env:DOCKER_HOST)" -ForegroundColor Yellow } else { Write-Host '' -ForegroundColor Yellow }
    Write-Host '  Containers on that engine will NOT appear in Docker Desktop.' -ForegroundColor Yellow
    Write-Host '  Switch with:  docker context use desktop-linux' -ForegroundColor Yellow
    Write-Host ''
  }

  if ($down -gt 0) {
    Write-Host "  $down service(s) are not running. Start them:  docker compose up -d" -ForegroundColor DarkGray
  } else {
    Write-Host '  Share the first two links with anyone on your network.' -ForegroundColor DarkGray
  }
}

Write-Host '  Blocked? Run .\open-firewall-lan.ps1 as Administrator.' -ForegroundColor DarkGray
Write-Host ''
