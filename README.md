# Context Forge — Address Book with MCP

Four projects that together demonstrate one idea: **every capability is reachable
three ways — through a UI, through a REST API, and through MCP tools an AI can
call with no UI at all — under one shared security model.**

```
┌──────────────┐        ┌──────────────┐
│ address-ui   │        │ mcp-client/ui│   search box only
│ full CRUD UI │        │              │   AI does the rest
└──────┬───────┘        └──────┬───────┘
       │ JWT                   │ JWT
       ▼                       ▼
┌──────────────┐        ┌──────────────┐      ┌──────────┐
│ address-api  │◀───────│ mcp-server   │◀─────│ Ollama   │
│ REST + RBAC  │  JWT   │ MCP tools    │ tools│ qwen2.5  │
└──────┬───────┘        └──────┬───────┘      └──────────┘
       │                       │
       ▼                       ▼
┌──────────────┐        ┌──────────────────┐
│ Postgres     │        │ Context Forge    │  federating gateway
└──────────────┘        │ gateway (IBM)    │
                        └──────────────────┘
```

## Projects

| Folder | What it is |
|--------|------------|
| [`address-api/`](address-api/) | Express REST API, Postgres, bcrypt + JWT, three roles, 100-row seed |
| [`address-ui/`](address-ui/) | React management UI — addresses, users, reseed, role-gated |
| [`mcp-server/`](mcp-server/) | Standalone MCP server, 14 tools, stdio + streamable HTTP |
| [`mcp-client/`](mcp-client/) | Agent backend + search-only React UI, driven by local Ollama |
| [`docker-stack/`](docker-stack/) | Compose for all of it, plus Ollama and the IBM Context Forge gateway |
| [`tests/`](tests/) | 82 integration tests — no Docker or Ollama needed |

[`CLAUDE.md`](CLAUDE.md) holds the conventions any AI assistant must follow in this
repo — chiefly: no feature ships without a REST endpoint *and* an MCP tool.

## Quick start

```bash
cp .env.example .env          # change JWT_SECRET and the passwords
cd docker-stack
pwsh ./check-env.ps1          # catches secrets that are too short to boot
docker compose --env-file ../.env up -d --build
docker compose logs -f ollama-init    # first run downloads ~4.7 GB
```

Then open:

- **http://localhost:8080** — the address book UI
- **http://localhost:8081** — the AI assistant (search box only)
- **http://localhost:4444/admin** — the Context Forge gateway

Sign in to the address book and assistant with `admin/admin123`,
`editor/editor123` or `viewer/viewer123`. **Each of these forces you to choose a
new password before it will do anything** — see
[Forced password change](#forced-password-change).

> **Change every default before this stack is reachable by anyone else.** The
> accounts above, and `forge_dev_password`, are published in this repository.
> On a default install, everyone who can read this page knows your credentials.
> That is acceptable on a laptop bound to `127.0.0.1`; it stops being acceptable
> the moment you set `BIND_ADDR=0.0.0.0` or open a firewall port.
>
> Editing `.env` is **not sufficient on its own**, because each value is read at
> a different moment:
>
> | Value | When it is read | Changing it afterwards |
> |---|---|---|
> | `POSTGRES_PASSWORD` | only when the database volume first initializes | recreate the volume, or `ALTER ROLE` inside Postgres |
> | `ADMIN_PASSWORD` | only while the `users` table is still empty | change the account in the UI, or `PUT /api/users/:id` |
> | `EDITOR_PASSWORD` | only while the `users` table is still empty | change the account in the UI, or `PUT /api/users/:id` |
> | `VIEWER_PASSWORD` | only while the `users` table is still empty | change the account in the UI, and update `MCP_PASSWORD` to match |
> | `MCP_PASSWORD` | on every stdio MCP start | must equal the `viewer` account's actual password |
>
> On a stack with no data worth keeping, the clean route is to wipe and
> re-bootstrap so every new value takes effect together:
>
> ```powershell
> cd docker-stack
> docker compose --env-file ../.env down -v     # -v also destroys the address data
> .\check-env.ps1
> docker compose --env-file ../.env up -d --build
> ```
>
> On a stack you care about, change the passwords through the UI instead, then
> update `MCP_PASSWORD` to match the `viewer` account's new password. Run
> `.\check-env.ps1` either way — it flags any value still left at a shipped
> placeholder.

The gateway has its own, separate login -- it is not one of the application
users. It reads `GATEWAY_ADMIN_USER` (basic auth), `GATEWAY_ADMIN_EMAIL`
(platform admin) and `GATEWAY_ADMIN_PASSWORD` from `.env`.

`.env` is the only copy, and it is gitignored. To look a value up:

```powershell
cd docker-stack
.\show-credentials.ps1                                  # masked
.\show-credentials.ps1 -Reveal                          # printed
.\show-credentials.ps1 -Copy GATEWAY_ADMIN_PASSWORD     # to the clipboard
```

Changing a value there takes effect on
`docker compose --env-file ../.env up -d --force-recreate gateway`.

No password appears in this repository. See [Secrets](#secrets).

> **Gateway secrets have minimum lengths.** `GATEWAY_JWT_SECRET` and
> `GATEWAY_ENCRYPTION_SECRET` must be at least 32 characters and
> `GATEWAY_ADMIN_PASSWORD` at least 22. Below those, `cf-gateway` starts,
> fails validation and restarts forever. `docker-stack/check-env.ps1` checks
> this for you; see [`docker-stack/README.md`](docker-stack/README.md#gateway-keeps-restarting).

## Sharing it on your LAN

The stack binds `0.0.0.0` out of the box, so it's already listening on your
network address. To use it from another machine:

```powershell
cd docker-stack
.\lan-urls.ps1                  # prints every service at your LAN IP
.\open-firewall-lan.ps1         # run as Administrator, LocalSubnet-scoped
```

`lan-urls.sh` is the macOS/Linux/WSL equivalent. Both UIs proxy `/api` through
their own nginx, so nothing is hardcoded to `localhost` — the same build works
at `http://192.168.x.x:8080` with no rebuild and no CORS setup.

If nothing is reachable, your network is probably classified Public, in which
case Private-profile rules never apply. `.\open-firewall-public.ps1` targets that
profile while keeping the same LocalSubnet scope. The same script can widen the
scope to any address behind `-RemoteScope Any -IUnderstandTheRisk`, which you
should read the warnings on before using.

Set `BIND_ADDR=127.0.0.1` in `.env` to pull it back to local-only, or
`LAN_IP=192.168.1.50` to pin the address the helper scripts report. Details and
the security caveats are in [`docker-stack/README.md`](docker-stack/README.md).

## Forced password change

The passwords above are printed in this repository, so an install that keeps
them is not protected by them. The API treats any of them as already expired.

Signing in still works — you have to get in to fix it — but the token you
receive carries `scope: 'password_change'` and is refused everywhere except
`POST /api/auth/change-password`. The role claim is untouched, so a locked
`admin` account is still nominally an admin; the scope is the only thing
stopping it, which is why the check sits in `requireAuth` where every protected
route inherits it. The address book UI shows a change-password screen instead
of the app; the assistant, which is search-only by design, refuses the session
and sends you to the address book.

The test is run on **every login**, not only when accounts are seeded, so it
also catches a database created before this existed and an account an admin
later sets back to a published value. Replacements must be 12+ characters and
must not be another published value.

Two consequences worth knowing before you hit them:

- **Service accounts cannot do this.** `MCP_USERNAME`/`MCP_PASSWORD` has no one
  to prompt, so a locked service account fails with `PASSWORD_CHANGE_REQUIRED`
  and a message pointing at `.env`. Set `VIEWER_PASSWORD` and `MCP_PASSWORD`
  together and the situation never arises.
- **The gateway is not covered.** Context Forge is a third-party service with
  its own login; `GATEWAY_ADMIN_PASSWORD` is enforced only by the length rules
  in `check-env.ps1`.

The list of published passwords lives once, in
[`address-api/src/publicPasswords.js`](address-api/src/publicPasswords.js).

## The security model

Three roles, enforced once — in the API — and inherited by everything upstream.

| Role        | Search | Create/Update | Delete | Users | Reseed |
|-------------|--------|---------------|--------|-------|--------|
| `read`      | ✅     | ❌            | ❌     | ❌    | ❌     |
| `readwrite` | ✅     | ✅            | ❌     | ❌    | ❌     |
| `admin`     | ✅     | ✅            | ✅     | ✅    | ✅     |

The chain is: browser holds the user's JWT → agent backend forwards it → MCP
server forwards it → API decides. An agent driven by a `viewer` cannot delete a
record no matter how the model is prompted; the tool simply returns FORBIDDEN and
the model is instructed to explain why rather than retry.

Try it: sign into the assistant as `viewer` and ask it to delete someone.

```bash
cd tests && npm install && npm test    # 82 tests, ~15s, no services required
```

## Gateway SSRF

The gateway fetches URLs that users register with it, which makes it a natural
SSRF pivot. Protection stays on at its strict defaults; the one exception is a
CIDR allowlist covering this stack's own compose network, so
`http://mcp-server:4100/mcp` registers while the host's LAN, loopback and cloud
metadata endpoints stay unreachable. The subnet is pinned so the allowlist and
the network cannot drift apart. Details in
[`docker-stack/README.md`](docker-stack/README.md#registering-a-peer-fails-the-gateway-rejects-the-url).

## Secrets

Every credential is read from the environment at runtime. Nothing in this
repository contains a real one, and there is no fallback in code to a value the
source happens to publish -- `address-api` refuses to start without `JWT_SECRET`
rather than signing tokens with a key anyone can read here.

| | |
|---|---|
| Where they live | `.env`, gitignored, never committed |
| Template | `.env.example`, placeholders only, tracked |
| Reaching code | `docker-compose.yml` interpolation -> container env -> `process.env` |
| Looking one up | `docker-stack/show-credentials.ps1` |
| Checking them | `docker-stack/check-env.ps1` validates lengths before startup |
| Keeping them out of git | `.gitignore` plus the `.githooks/pre-commit` scanner |

Turn the hook on once per clone -- git does not enable repository hooks
automatically, by design:

```bash
git config core.hooksPath .githooks
```

It refuses any commit that stages an env file, or that adds a line where a
credential word sits next to a literal that looks like a password. Deliberate
placeholders can be marked `# pragma: allowlist secret`, and `--no-verify`
overrides it for the case the heuristic gets wrong.

Demo accounts (`admin123`, `editor123`, `viewer123`, `forge_dev_password`) are a
deliberate exception: they are seeded fixtures, published in `.env.example`, and
the firewall scripts refuse to widen exposure while they are still in place.

That last defence only covers the firewall scripts. Nothing stops you binding
`0.0.0.0` and reaching the stack across a LAN with the shipped accounts intact,
so treat replacing them as a step in the install, not as hardening you get to
postpone. See [Quick start](#quick-start) for which values take effect when, and
why editing `.env` alone does not rotate an already-seeded account.

## Why qwen2.5:7b-instruct

~4.7 GB quantized, native tool-calling, and reliable at picking the right tool
from a list of fourteen — which is the whole job here. It fits an 8 GB machine
with the rest of the stack running. `qwen2.5:3b-instruct` is the fallback if
memory is tight; `llama3.1:8b` works too but leaves less headroom.

## Using the MCP server from Claude Desktop

See [`mcp-server/README.md`](mcp-server/README.md) — point it at `src/stdio.js`
and give it the service account whose role you want the agent to have.
