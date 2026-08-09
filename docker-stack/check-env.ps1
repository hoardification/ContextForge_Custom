<#
.SYNOPSIS
  Validate ../.env before starting the stack.

.DESCRIPTION
  Catches the settings that let a container start and then crash-loop with no
  obvious explanation - chiefly the gateway's minimum secret lengths. Run it
  after editing .env and before docker compose up.

.EXAMPLE
  .\check-env.ps1
  .\check-env.ps1 -EnvFile C:\path\to\.env
#>
[CmdletBinding()]
param(
  [string]$EnvFile
)

$ErrorActionPreference = 'Stop'

if (-not $EnvFile) { $EnvFile = Join-Path $PSScriptRoot '..\.env' }

if (-not (Test-Path $EnvFile)) {
  Write-Host ''
  Write-Host "  No .env found at $EnvFile" -ForegroundColor Red
  Write-Host '  Create one:  cp ../.env.example ../.env' -ForegroundColor DarkGray
  Write-Host ''
  exit 1
}

$envVars = @{}
Get-Content $EnvFile | ForEach-Object {
  if ($_ -match '^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$') {
    $envVars[$Matches[1]] = $Matches[2].Trim()
  }
}

# Minimums the services actually enforce at startup. Add to this list whenever
# a new env var grows a length rule - that is the whole point of the script.
$rules = @(
  @{ Key = 'GATEWAY_JWT_SECRET';        Min = 32; Why = 'gateway JWT_SECRET_KEY' }
  @{ Key = 'GATEWAY_ENCRYPTION_SECRET'; Min = 32; Why = 'gateway AUTH_ENCRYPTION_SECRET' }
  @{ Key = 'GATEWAY_ADMIN_PASSWORD';    Min = 22; Why = 'PASSWORD_MIN_LENGTH_PRIVILEGED' }
  @{ Key = 'JWT_SECRET';                Min = 32; Why = 'address-api token signing' }
  @{ Key = 'POSTGRES_PASSWORD';         Min = 12; Why = 'database password' }
)

$placeholders = @('changeme', 'change-me', 'replace-me', 'dev-only', 'forge_dev')

$fail = 0
$warn = 0

Write-Host ''
Write-Host '  .env preflight' -ForegroundColor Cyan
Write-Host ('  ' + ('-' * 62))

foreach ($r in $rules) {
  $val = $envVars[$r.Key]
  $len = if ($val) { $val.Length } else { 0 }

  if (-not $val) {
    Write-Host ('  [missing  ] {0,-26} {1}' -f $r.Key, $r.Why) -ForegroundColor Red
    $fail++
  }
  elseif ($len -lt $r.Min) {
    Write-Host ('  [too short] {0,-26} {1} chars, needs {2} ({3})' -f $r.Key, $len, $r.Min, $r.Why) -ForegroundColor Red
    $fail++
  }
  elseif (@($placeholders | Where-Object { $val.ToLower().StartsWith($_) }).Count -gt 0) {
    Write-Host ('  [default  ] {0,-26} {1} chars, still a shipped placeholder' -f $r.Key, $len) -ForegroundColor Yellow
    $warn++
  }
  else {
    Write-Host ('  [ok       ] {0,-26} {1} chars' -f $r.Key, $len) -ForegroundColor Green
  }
}

# --- gateway SSRF posture ---------------------------------------------------
# Relaxing SSRF is the usual quick fix for "the gateway cannot reach
# mcp-server", and it silently stays relaxed forever. Name it out loud.
$composeFile = Join-Path $PSScriptRoot 'docker-compose.yml'
if (Test-Path $composeFile) {
  $compose = Get-Content $composeFile -Raw

  $relaxed = @()
  if ($compose -match "SSRF_ALLOW_PRIVATE_NETWORKS:\s*'?true")  { $relaxed += 'SSRF_ALLOW_PRIVATE_NETWORKS=true' }
  if ($compose -match "SSRF_ALLOW_LOCALHOST:\s*'?true")         { $relaxed += 'SSRF_ALLOW_LOCALHOST=true' }
  if ($compose -match "SSRF_DNS_FAIL_CLOSED:\s*'?false")        { $relaxed += 'SSRF_DNS_FAIL_CLOSED=false' }
  if ($compose -match "SSRF_PROTECTION_ENABLED:\s*'?false")     { $relaxed += 'SSRF_PROTECTION_ENABLED=false' }

  if ($relaxed.Count -gt 0) {
    Write-Host ''
    Write-Host '  Gateway SSRF protection is relaxed:' -ForegroundColor Yellow
    foreach ($r in $relaxed) { Write-Host "    $r" -ForegroundColor Yellow }
    Write-Host '  A registered peer URL then reaches the host LAN and loopback.' -ForegroundColor Yellow
    Write-Host '  Prefer SSRF_ALLOWED_NETWORKS scoped to STACK_SUBNET.' -ForegroundColor Yellow
    $warn += $relaxed.Count
  }
  else {
    Write-Host ''
    Write-Host '  [ok       ] gateway SSRF protection strict, allowlist scoped' -ForegroundColor Green
  }
}

Write-Host ''

if ($fail -gt 0) {
  Write-Host "  $fail value(s) will stop a service from starting." -ForegroundColor Red
  Write-Host '  A container that keeps restarting is usually this, not Docker.' -ForegroundColor DarkGray
  Write-Host ''
  Write-Host '  Generate a compliant secret:' -ForegroundColor DarkGray
  Write-Host '    openssl rand -hex 32' -ForegroundColor DarkGray
  Write-Host "    [guid]::NewGuid().ToString('N') * 2      # no openssl needed" -ForegroundColor DarkGray
  Write-Host ''
  exit 1
}

if ($warn -gt 0) {
  Write-Host "  $warn warning(s) above. Nothing here stops the stack from starting," -ForegroundColor Yellow
  Write-Host '  but review them before it is reachable by anyone else.' -ForegroundColor Yellow
}
else {
  Write-Host '  All checks passed.' -ForegroundColor Green
}

Write-Host ''
exit 0
