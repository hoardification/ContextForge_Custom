# Handoff

State of the stack and the reasoning behind recent changes, so a new session can
pick up without re-deriving any of it. `CLAUDE.md` holds the standing rules;
this file holds the *why* and what is still open.

For the *design* reasoning - why the MCP server is a thin proxy, why identity is
inherited rather than configured, why there are two firewall scripts, and what
was considered and rejected - see [`docs/DECISIONS.md`](docs/DECISIONS.md). That
file is durable; this one is a snapshot.

## Current state

The stack runs. Postgres, Ollama, the address API and UI, the MCP server, the
agent backend and its UI, and the Context Forge gateway all start and stay up.

Git: one commit on `main`, not yet pushed. Target remote is
`https://github.com/hoardification/ContextForge` (public).

## What was fixed, and why it mattered

**PowerShell scripts would not parse.** Em dashes saved as BOM-less UTF-8 are
read as ANSI by Windows PowerShell 5.1, arriving as `â€"`. That trailing
character is a smart quote, which PowerShell accepts as a string delimiter, so
the file died on a missing terminator. All scripts are ASCII only now. This
regressed once mid-session when scripts were rewritten, so it is worth checking
after any edit: `grep -rlP '[^\x00-\x7F]' docker-stack/*.ps1` should print
nothing.

**`lan-urls.ps1` implied services were running when it had never asked.** It
printed URLs derived from `.env` unconditionally. It now queries `docker ps`,
maps each service to its `cf-*` container, and marks each row up/down/unknown.
It also warns when the docker CLI is on a different engine than Docker Desktop,
which is why containers can appear in one and not the other.

**The gateway crash-looped.** `GATEWAY_JWT_SECRET` was under the 32-character
minimum, which the gateway enforces by exiting - and Docker's restart policy
turns that into a flap with the reason scrolled off screen. Compose fallbacks
are now all above their minimums, `AUTH_ENCRYPTION_SECRET` is wired up, and
`docker-stack/check-env.ps1` validates lengths before startup.

**The UI 404'd while the API answered.** Both nginx configs used
`proxy_pass $upstream/api/;`. With a variable in the argument, nginx passes the
URI in the directive verbatim instead of appending the unmatched path, so every
`/api/...` request arrived as a bare `/api/`. Now `proxy_pass $upstream$request_uri;`,
which keeps the runtime upstream resolution and the full path.

**The assistant looked hung on long runs.** It was not - a 7B model on CPU takes
30-90s per step. `POST /api/ask/stream` now reports progress as server-sent
events with a 10s heartbeat, and the UI shows the live stage, per-tool timings, a
clock and a Stop button. Timeouts were added at every level; there were none.

Cancellation hooks `res.on('close')`, not `req.on('close')`. Since Node 16 a
request stream emits `close` once its body is read, which for a POST is
immediately - listening there cancels every run about 100ms in.

**SSRF was switched off to make peer registration work.** Registering
`http://mcp-server:4100/mcp` needs a private address, so all three SSRF guards
had been disabled. That turns any registered peer URL into a way to reach the
host LAN, loopback, or a name that resolves differently on the second lookup -
and federating user-supplied URLs is the gateway's whole job. Replaced with
strict defaults plus a CIDR allowlist scoped to this stack's own network, with
the subnet pinned from `STACK_SUBNET` so the allowlist cannot drift from the
network it describes.

**Credentials.** `.env` is the only copy and is gitignored. No real credential
appears in any tracked file. `address-api` refuses to start without
`JWT_SECRET` rather than falling back to a value published in the source.
`docker-stack/show-credentials.ps1` looks values up; `.githooks/pre-commit`
blocks env files and credential-shaped literals from being committed.

## Open items

1. **Push has not happened.** Needs `gh` installed and authenticated, or a
   manually created empty repo plus `git remote add` and `git push -u origin main`.
2. **`_to_delete/` must be removed** before pushing. It holds a broken `.git`
   from a failed attempt and two transfer archives. Untracked, so it will not go
   up on its own, but `git add -A` would sweep it in.
3. **Three credentials are still the shipped demo values** in the running stack:
   `ADMIN_PASSWORD`, `MCP_PASSWORD`, `POSTGRES_PASSWORD`. Each needs more than an
   `.env` edit - the first two are seeded into the users table, the third needs
   `ALTER USER` or a volume wipe. They are published in `.env.example` by design;
   the risk is that the live instance still uses them.
4. **`JWT_SECRET` was rotated** and takes effect on the next recreate of
   `address-api` and `mcp-server`. Existing tokens stop verifying; users re-login.
5. **The SSRF change needs a full recreate**, because a live Docker network's
   subnet cannot be edited in place: `docker compose down && docker compose up -d`.
   Volumes survive without `-v`, so Postgres data and the model are kept.
6. **Peer registration still has to be re-run** after the gateway restarts:
   `./register-gateway.sh`. Changing `GATEWAY_JWT_SECRET` invalidates tokens the
   gateway previously issued.
7. **The gateway's platform admin is seeded once.** If it ever booted cleanly
   with an older password, the current `GATEWAY_ADMIN_PASSWORD` will not apply;
   resetting its database is the way out, documented in `docker-stack/README.md`.

## Things that are easy to get wrong here

- `check-env.ps1` before `docker compose up`. Most "it crash-loops" reports in
  this stack are a value below a minimum length, not Docker.
- `nginx.conf` lives in the image. Changing it needs `--build`, not a restart.
- A container that keeps restarting logs its reason once, then scrolls. Use
  `docker compose logs gateway | head -40`.
- Windows PowerShell 5.1, not 7, is what these scripts have to survive.
