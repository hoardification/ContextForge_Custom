<#
.SYNOPSIS
  Show the credentials for this stack, read from ../.env.

.DESCRIPTION
  .env is the only place real credentials live, and it is gitignored. This
  script is how you look one up, so that no document has to hold a copy that
  will drift, leak into version control, or both.

  Values are masked unless you ask for them. -Reveal prints them in full;
  -Copy puts one on the clipboard without printing it at all, which is the
  safer option if anyone can see your screen.

.EXAMPLE
  .\show-credentials.ps1
  .\show-credentials.ps1 -Reveal
  .\show-credentials.ps1 -Copy GATEWAY_ADMIN_PASSWORD
#>
[CmdletBinding()]
param(
  [switch]$Reveal,
  [string]$Copy,
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

function Mask([string]$v) {
  if (-not $v) { return '(unset)' }
  if ($v.Length -le 4) { return '*' * $v.Length }
  return $v.Substring(0, 2) + ('*' * [Math]::Min($v.Length - 4, 20)) + $v.Substring($v.Length - 2)
}

# -Copy takes precedence: put one value on the clipboard, print nothing.
if ($Copy) {
  if (-not $envVars.ContainsKey($Copy)) {
    Write-Host "  $Copy is not set in $EnvFile" -ForegroundColor Red
    exit 1
  }
  $envVars[$Copy] | Set-Clipboard
  Write-Host ''
  Write-Host "  $Copy copied to the clipboard." -ForegroundColor Green
  Write-Host ''
  exit 0
}

$groups = @(
  @{
    Title = 'Address book UI and AI assistant'
    Url   = "http://localhost:$($envVars['UI_PORT']) and :$($envVars['MCP_CLIENT_UI_PORT'])"
    Items = @(
      @{ Label = 'admin';  User = $envVars['ADMIN_USERNAME']; Key = 'ADMIN_PASSWORD' }
      @{ Label = 'editor'; User = 'editor'; Key = 'EDITOR_PASSWORD'; Literal = 'editor123'; Demo = $true }
      @{ Label = 'viewer'; User = 'viewer'; Key = 'VIEWER_PASSWORD'; Literal = 'viewer123'; Demo = $true }
    )
  }
  @{
    Title = 'Context Forge gateway'
    Url   = "http://localhost:$($envVars['GATEWAY_PORT'])/admin"
    Items = @(
      @{ Label = 'basic auth';     User = $envVars['GATEWAY_ADMIN_USER'];  Key = 'GATEWAY_ADMIN_PASSWORD' }
      @{ Label = 'platform admin'; User = $envVars['GATEWAY_ADMIN_EMAIL']; Key = 'GATEWAY_ADMIN_PASSWORD' }
    )
  }
  @{
    Title = 'Postgres'
    Url   = "localhost:$($envVars['POSTGRES_PORT'])"
    Items = @(
      @{ Label = 'database'; User = $envVars['POSTGRES_USER']; Key = 'POSTGRES_PASSWORD' }
    )
  }
)

Write-Host ''
Write-Host '  Credentials (source: .env)' -ForegroundColor Cyan
if (-not $Reveal) {
  Write-Host '  Masked. Use -Reveal to print, or -Copy <KEY> for the clipboard.' -ForegroundColor DarkGray
}

foreach ($g in $groups) {
  Write-Host ''
  Write-Host "  $($g.Title)" -ForegroundColor White
  Write-Host "  $($g.Url)" -ForegroundColor DarkGray
  foreach ($i in $g.Items) {
    # .env wins. The literal is only the fallback for a key the file omits, in
    # which case the compose default is what the stack is actually running.
    $value = if ($i.Key -and $envVars[$i.Key]) { $envVars[$i.Key] } else { $i.Literal }
    # A demo account is printed in the clear only while it still holds the
    # shipped value. Once rotated it is a real credential and gets masked like
    # any other, or -Reveal would leak it to anyone reading over your shoulder.
    $isDemo = $i.Demo -and $i.Literal -and $value -eq $i.Literal
    $shown = if ($Reveal -or $isDemo) { $value } else { Mask $value }
    $note  = if ($isDemo) { '  (shipped demo account)' } else { '' }
    Write-Host ('    {0,-15} {1,-22} {2}{3}' -f $i.Label, $i.User, $shown, $note)
  }
}

Write-Host ''
Write-Host '  .env is gitignored and is the only copy. Change a value there, then' -ForegroundColor DarkGray
Write-Host '  recreate the affected service for it to take effect.' -ForegroundColor DarkGray
Write-Host ''
