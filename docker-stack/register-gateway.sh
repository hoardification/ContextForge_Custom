#!/usr/bin/env bash
# Register the address-book MCP server as a peer of the Context Forge gateway,
# so the gateway federates its tools alongside anything else you add later.
#
# Usage: ./register-gateway.sh
set -euo pipefail

cd "$(dirname "$0")"
[ -f ../.env ] && set -a && . ../.env && set +a

GATEWAY="http://localhost:${GATEWAY_PORT:-4444}"
USER="${GATEWAY_ADMIN_USER:-admin}"

# No fallback password. The old one ("changeme") is below the gateway's minimum
# length, so it could only ever produce a confusing 401 here.
if [ -z "${GATEWAY_ADMIN_PASSWORD:-}" ]; then
  echo "GATEWAY_ADMIN_PASSWORD is not set. Set it in ../.env (see .env.example)." >&2
  exit 1
fi
PASS="${GATEWAY_ADMIN_PASSWORD}"

echo "Waiting for the gateway at ${GATEWAY} …"
for i in $(seq 1 60); do
  if curl -fsS "${GATEWAY}/health" >/dev/null 2>&1; then break; fi
  sleep 2
  [ "$i" = 60 ] && { echo "Gateway never became healthy."; exit 1; }
done

echo "Registering address-book MCP server …"
curl -fsS -u "${USER}:${PASS}" \
  -X POST "${GATEWAY}/gateways" \
  -H 'content-type: application/json' \
  -d '{
        "name": "address-book",
        "url": "http://mcp-server:4100/mcp",
        "description": "Address book CRUD, search and admin tools",
        "transport": "streamablehttp"
      }' \
  && echo && echo "Registered. Open ${GATEWAY}/admin to inspect the federated tools."
