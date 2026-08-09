# docker-stack

Everything runs here: Postgres, Ollama, the address book API and UI, the MCP
server, the MCP client agent and its UI, and the IBM Context Forge gateway.

## Start

```bash
cp ../.env.example ../.env      # edit JWT_SECRET and passwords first
pwsh ./check-env.ps1            # verify secret lengths before starting
docker compose --env-file ../.env up -d --build
docker compose logs -f ollama-init      # watch the model download
```

First run pulls ~4.7 GB for `qwen2.5:7b-instruct`. Later runs reuse the volume.

## Ports

| Service            | URL                     | Notes |
|--------------------|-------------------------|-------|
| Address book UI    | http://localhost:8080   | full management UI |
| Address API        | http://localhost:4000   | REST, `/health` |
| MCP server         | http://localhost:4100/mcp | streamable HTTP |
| AI assistant UI    | http://localhost:8081   | search box only |
| Agent backend      | http://localhost:4200   | `/health` shows Ollama status |
| Context Forge      | http://localhost:4444/admin | gateway admin, own login (see below) |
| Ollama             | http://localhost:11434  | |
| Postgres           | localhost:5432          | |

## LAN access

Every service publishes on `${BIND_ADDR}`, which defaults to `0.0.0.0` — so the
stack is already listening on your LAN IP as soon as it starts. Two things stand
between that and a colleague loading it: knowing the address, and Windows
Firewall.

**1. Find your URLs**

```powershell
.\lan-urls.ps1              # Windows
```
```bash
./lan-urls.sh               # macOS / Linux / WSL
```

Both detect the interface that actually carries traffic off the machine, skipping
loopback, WSL, Hyper-V and Docker adapters. Pin it with `LAN_IP=192.168.1.50` in
`.env` if detection picks the wrong one.

**2. Open the firewall (Windows)**

```powershell
# Run PowerShell as Administrator
cd C:\path\to\ContextForge\docker-stack
.\open-firewall-lan.ps1 -WhatIf     # preview first
.\open-firewall-lan.ps1
```

Rules are scoped to `LocalSubnet` on the `Private` profile — reachable from your
network, not the internet. Undo with `.\close-firewall.ps1`.

### Profile vs scope

Windows Firewall has two knobs that are easy to confuse, and the two open
scripts exist because of the difference.

| | What it controls | Values |
|---|---|---|
| **Profile** | *Which network you're on.* Windows classifies each connection. | Domain / Private / Public |
| **Scope** | *Who may connect.* This is the one that governs exposure. | LocalSubnet / Any |

`open-firewall-lan.ps1` sets **Private profile + LocalSubnet**. That's the
everyday case.

`open-firewall-public.ps1` covers the other combinations:

```powershell
# Your LAN got classified Public and the LAN rules aren't applying.
# Public profile, still LocalSubnet — no more exposed than the LAN script.
.\open-firewall-public.ps1

# Genuinely widen to any source address. Gated, deliberately.
.\open-firewall-public.ps1 -RemoteScope Any -IUnderstandTheRisk
```

If nothing is reachable and you can't see why, check the classification first —
it's the usual culprit:

```powershell
Get-NetConnectionProfile
Set-NetConnectionProfile -Name '<name>' -NetworkCategory Private
```

The two scripts write to separate rule groups, so you can revoke one without
disturbing the other:

```powershell
.\close-firewall.ps1 -Which Public    # drop the wide rules, keep LAN access
.\close-firewall.ps1                  # remove everything
```

### About `-RemoteScope Any`

The script gates this behind `-IUnderstandTheRisk`, refuses outright while
`.env` still holds shipped default credentials, and asks you to type `EXPOSE`.
That's because of what this particular stack is: plain HTTP with JWTs in the
clear, Postgres on 5432, an entirely unauthenticated Ollama on 11434, and an MCP
server whose tools can delete records.

`Any` also isn't the same as internet-facing — a NAT router without a
port-forward still stands in the way. It removes Windows Firewall as the
obstacle, nothing more.

If you actually need access from outside your network, a VPN or Tailscale is
both safer and less work than port-forwarding this. Failing that, put a
TLS-terminating reverse proxy in front of ports 8080/8081 only.

Both UIs proxy `/api` through their own nginx, so they work on a LAN IP with no
rebuild and no CORS configuration. There is no `localhost` baked into the client
bundles.

**Scoping it down**

| Goal | Setting in `.env` |
|------|-------------------|
| LAN-wide (default) | `BIND_ADDR=0.0.0.0` |
| Localhost only | `BIND_ADDR=127.0.0.1` |
| One NIC only | `BIND_ADDR=192.168.1.50` |

Apply with `docker compose up -d`.

### Before you leave it running

The stack ships with demo credentials. On a shared network, change these in
`.env` and recreate: `ADMIN_PASSWORD`, `JWT_SECRET`, `POSTGRES_PASSWORD`,
`GATEWAY_ADMIN_PASSWORD`, `GATEWAY_JWT_SECRET`, `GATEWAY_ENCRYPTION_SECRET`.

Mind the minimum lengths when you do -- see below.

`GATEWAY_ADMIN_PASSWORD` has been changed from the shipped default to a value
that clears the 22-character privileged minimum. It is used for both the
gateway's basic auth prompt (`GATEWAY_ADMIN_USER`) and its platform admin login
(`GATEWAY_ADMIN_EMAIL`).

The value itself lives only in `.env`. Look it up rather than copying it
anywhere:

```powershell
.\show-credentials.ps1 -Reveal
.\show-credentials.ps1 -Copy GATEWAY_ADMIN_PASSWORD
```

The gateway seeds its platform admin on its first successful start and does not
re-read the variable afterwards, so a changed password applies from the first
clean boot after the change. If the gateway had already bootstrapped with an
earlier password, reset its database -- see
[Gateway keeps restarting](#gateway-keeps-restarting).

It also speaks plain HTTP, so JWTs cross the wire unencrypted. That's fine on a
trusted home or office LAN and not fine anywhere else — put it behind a reverse
proxy with TLS if you need more than that.

## Troubleshooting

### Gateway keeps restarting

`cf-gateway` validates its configuration at startup and exits if a secret is
too short. Docker restarts it, so the symptom is a container that flaps rather
than a clear error, and the reason scrolls past in the logs:

```bash
docker compose logs gateway | head -40
```

Minimum lengths the gateway enforces:

| `.env` key | Gateway variable | Minimum |
|------------|------------------|---------|
| `GATEWAY_JWT_SECRET` | `JWT_SECRET_KEY` | 32 characters |
| `GATEWAY_ENCRYPTION_SECRET` | `AUTH_ENCRYPTION_SECRET` | 32 characters |
| `GATEWAY_ADMIN_PASSWORD` | `PLATFORM_ADMIN_PASSWORD` | 22 characters (`PASSWORD_MIN_LENGTH_PRIVILEGED`) |

Check every value at once:

```powershell
.\check-env.ps1
```

Generate a compliant secret:

```bash
openssl rand -hex 32
```

```powershell
# Windows, no openssl
[guid]::NewGuid().ToString('N') * 2
```

Then recreate just that service:

```bash
docker compose --env-file ../.env up -d --force-recreate gateway
```

Changing `GATEWAY_JWT_SECRET` invalidates any tokens the gateway already
issued, so re-run `./register-gateway.sh` afterwards.

### UI returns 404 but the API works directly

If `curl http://localhost:4000/api/auth/login` returns a token while the same
call through the UI origin (`http://localhost:8080/api/auth/login`) 404s, the
problem is the nginx proxy in front of the UI, not the API.

`proxy_pass` behaves differently when its argument contains a variable. Without
one, nginx replaces the matched location prefix and appends the rest of the
path. With one, nginx sends the URI in the directive **verbatim** and discards
the remainder -- so `proxy_pass $upstream/api/;` turns every `/api/anything`
request into a bare `/api/`, which the API does not route.

Both UIs use a variable upstream on purpose, so that a restarted `address-api`
on a new container IP is picked up without restarting nginx. The fix is to pass
the original URI explicitly:

```nginx
proxy_pass $upstream$request_uri;
```

`nginx.conf` lives in the image, so this needs a rebuild rather than a restart:

```bash
docker compose --env-file ../.env up -d --build address-ui mcp-client-ui
```

Confirm the path is arriving intact:

```bash
docker compose logs address-api | grep auth/login
```

### The assistant sits on "Working..." for a long time

Usually it is working. `qwen2.5:7b-instruct` on CPU takes 30-90s per step and a
request can use several, so a reseed legitimately runs for minutes.

The assistant UI streams progress now, so you can tell the two cases apart
without guessing: it shows the current stage, each tool call as it starts and
finishes with its own duration, a running clock, and a pulse driven by a
10-second heartbeat from the backend. If that heartbeat stops, the UI says so
explicitly after 25 seconds instead of spinning. There is also a Stop button,
which aborts the model and MCP session rather than orphaning them.

If it does stall:

```bash
docker compose logs -f mcp-client ollama
curl http://localhost:4200/health          # includes Ollama status and whether the model is pulled
```

The most common genuine causes are Ollama still pulling the model on first run,
and a machine tight enough on RAM that the model is being reloaded on every
call. `OLLAMA_MODEL=qwen2.5:3b-instruct` is the usual fix for the second.

Timeouts are configurable in `.env` -- `AGENT_TIMEOUT_MS`, `OLLAMA_TIMEOUT_MS`,
`MCP_TOOL_TIMEOUT_MS`, `AGENT_HEARTBEAT_MS`. See
[`mcp-client/README.md`](../mcp-client/README.md#progress-reporting).

### Registering a peer fails: the gateway rejects the URL

The gateway refuses to fetch URLs that resolve to private or loopback
addresses. That is SSRF protection doing its job, and `http://mcp-server:4100/mcp`
resolves to a Docker-internal address, so registration is rejected out of the box.

The tempting fix is to switch the protection off:

```yaml
SSRF_ALLOW_PRIVATE_NETWORKS: 'true'    # do not
SSRF_ALLOW_LOCALHOST: 'true'           # do not
SSRF_DNS_FAIL_CLOSED: 'false'          # do not
```

Those three lines mean any URL registered through the admin API can point at
the host's LAN, at the gateway's own loopback, or at a name that resolves
differently the second time it is looked up. Federating peer URLs is exactly
what this gateway does, so that is the whole attack surface, opened to make one
hostname work.

The stack instead keeps SSRF strict and grants one narrow exception -- its own
compose network:

```yaml
SSRF_ALLOW_PRIVATE_NETWORKS: 'false'
SSRF_ALLOWED_NETWORKS: '["${STACK_SUBNET:-172.28.0.0/16}"]'
```

`SSRF_ALLOWED_NETWORKS` is consulted *because* private networks are otherwise
denied. The subnet is pinned in the `networks:` block from the same
`STACK_SUBNET` variable, so the allowlist cannot drift from the network it is
describing -- left to Docker, the subnet comes from its default pool and
differs between machines.

Changing `STACK_SUBNET` (say it collides with an existing network) needs a full
recreate, because a live network's subnet cannot be edited in place:

```bash
docker compose --env-file ../.env down
docker compose --env-file ../.env up -d
```

`check-env.ps1` reports the posture, and says so loudly if anyone relaxes it
again.

### Services show as running but Docker Desktop is empty

The docker CLI is talking to a different engine than Docker Desktop -- usually
a WSL-native `dockerd`, or a `DOCKER_HOST` left set in the shell. Both views
are accurate about their own engine.

```powershell
docker context ls          # the active one carries an asterisk
docker context use desktop-linux
```

## Register the MCP server with the gateway

```bash
./register-gateway.sh
```

Then the gateway exposes the address-book tools at its own unified endpoint,
with its own auth, logging and rate limiting in front.

## Memory

The whole stack idles around 1 GB. The model adds ~5.5 GB while generating and
unloads after 5 minutes idle (`OLLAMA_KEEP_ALIVE=5m`). On a tight 8 GB machine:

```bash
OLLAMA_MODEL=qwen2.5:3b-instruct docker compose up -d
```

## Useful

```bash
docker compose ps
docker compose logs -f address-api
docker compose exec postgres psql -U forge -d addressbook -c 'select count(*) from addresses;'
docker compose down            # keep data
docker compose down -v         # wipe Postgres + downloaded models
```
