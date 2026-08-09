#!/usr/bin/env bash
# Print every Context Forge service URL using this machine's LAN IP.
# Usage: ./lan-urls.sh [ip]
set -euo pipefail

cd "$(dirname "$0")"
[ -f ../.env ] && set -a && . ../.env && set +a

IP="${1:-${LAN_IP:-}}"

if [ -z "$IP" ]; then
  # The address the kernel would use to reach the outside world — i.e. the one
  # other machines can actually reach. Falls back to hostname lookups.
  IP=$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src") print $(i+1); exit}') || true
  [ -z "$IP" ] && IP=$(ipconfig getifaddr en0 2>/dev/null) || true
  [ -z "$IP" ] && IP=$(hostname -I 2>/dev/null | awk '{print $1}') || true
fi

if [ -z "$IP" ]; then
  echo "Could not detect a LAN IP. Pass one: ./lan-urls.sh 192.168.1.50" >&2
  exit 1
fi

BIND="${BIND_ADDR:-0.0.0.0}"
if [ "$BIND" = "127.0.0.1" ] || [ "$BIND" = "localhost" ]; then
  echo "WARNING: BIND_ADDR is ${BIND}, so these ports are NOT published to the LAN." >&2
  echo "         Set BIND_ADDR=0.0.0.0 in .env, then: docker compose up -d" >&2
  echo >&2
fi

printf '\n  Context Forge on the LAN — %s\n' "$IP"
printf '  %s\n' "----------------------------------------------------"
printf '  %-18s http://%s:%s\n'          'Address book UI'   "$IP" "${UI_PORT:-8080}"
printf '  %-18s http://%s:%s\n'          'AI assistant UI'   "$IP" "${MCP_CLIENT_UI_PORT:-8081}"
printf '  %-18s http://%s:%s/health\n'   'Address REST API'  "$IP" "${API_PORT:-4000}"
printf '  %-18s http://%s:%s/mcp\n'      'MCP server (HTTP)' "$IP" "${MCP_HTTP_PORT:-4100}"
printf '  %-18s http://%s:%s/health\n'   'Agent backend'     "$IP" "${MCP_CLIENT_PORT:-4200}"
printf '  %-18s http://%s:%s/admin\n'    'Context Forge'     "$IP" "${GATEWAY_PORT:-4444}"
printf '  %-18s http://%s:%s/api/tags\n' 'Ollama'            "$IP" "${OLLAMA_PORT:-11434}"
printf '  %-18s %s:%s\n'                 'Postgres'          "$IP" "${POSTGRES_PORT:-5432}"
printf '\n  Share the first two links with anyone on your network.\n'
printf '  Blocked on Windows? Run open-firewall-lan.ps1 as Administrator.\n'
printf '  Still blocked? The network may be classified Public — see\n'
printf '  open-firewall-public.ps1.\n\n'
