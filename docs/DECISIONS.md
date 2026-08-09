# Design Decisions

Why the project is shaped this way, recorded from the session that built it.

`CLAUDE.md` says what the rules are. `HANDOFF.md` says what state the running
stack is in and what is still open. This file says *why the design is what it
is* - the reasoning that would otherwise be lost, and the alternatives that were
considered and dropped. It is durable: it should only change when a decision
changes, not when the stack does.

---

## Four projects, not one

The brief asked for four, and the split earns its keep:

| Project | Why separate |
|---------|--------------|
| `address-api` | The only place authorization is real. Everything else is a client. |
| `address-ui` | Static files behind nginx. No server, no secrets, nothing to leak. |
| `mcp-server` | Runs standalone against a remote API. Claude Desktop can spawn it over stdio with none of the web tier present. The gateway can federate it as a peer. Small dependency set, fast boot. |
| `mcp-client` | Demonstrates consumption. Kept apart so the server never grows a dependency on a particular model or agent loop. |

### The MCP server is a proxy, not a second implementation

It holds no database credentials and contains no business logic. Every tool maps
to one REST call. This is the single most load-bearing decision in the project:
an authorization bug can only exist in one place, and a fix lands for the UI, the
API and the agent simultaneously.

The temptation is to let the MCP server talk to Postgres directly - it would be
faster and fewer moving parts. It would also mean the role checks exist twice,
and the two copies would drift. They always do.

---

## Identity inherits, it is not configured

```
browser  --Bearer-->  agent backend  --Bearer-->  mcp-server  --Bearer-->  API
```

The user's JWT is forwarded verbatim at every hop. The agent therefore acts with
exactly the permissions of the human who signed in - a `viewer` cannot delete a
record no matter how the model is prompted, because the API returns FORBIDDEN and
there is no other path to the data.

This is worth protecting. Any change that gives the MCP server its own
privileged token, or that lets the agent backend mint one, silently removes the
property.

### The one place identity is configured

stdio has no request headers, so the stdio transport authenticates with
`MCP_USERNAME` / `MCP_PASSWORD`. The compose default is `viewer` deliberately:
the least-privileged account that still demonstrates the tools. Raising it to
`admin` is a decision someone should have to make on purpose.

The HTTP transport falls back to the same service account only when a caller
presents no token at all, which in practice means the gateway's own probes.

### Stateless HTTP

`POST /mcp` builds a fresh `McpServer` and transport per request
(`sessionIdGenerator: undefined`). One identity per server instance means a
long-lived process cannot leak one caller's token into another caller's tool
call. It also means no session table, no expiry logic, and no reconnect handling.

---

## Ollama and the model

`qwen2.5:7b-instruct`, ~4.7 GB quantized.

The constraint was 8 GB total. The job is choosing correctly among fourteen tools
and filling their arguments - which is a tool-calling benchmark, not a reasoning
one. qwen2.5 has native tool-calling and holds up at 7B.

- `llama3.1:8b` works and is slightly larger; less headroom alongside Postgres.
- `qwen2.5:3b-instruct` is the documented fallback when memory is tight. It picks
  the wrong tool noticeably more often, so it is a fallback rather than a default.

`OLLAMA_KEEP_ALIVE=5m` and `OLLAMA_MAX_LOADED_MODELS=1` keep an 8 GB box honest by
unloading the model when idle.

### The agent loop is bounded

`AGENT_MAX_STEPS` (default 6) caps model-tool-model cycles, and the response
carries a `truncated` flag when it is hit. An unbounded loop against a local
model is not a hang you can wait out.

Every tool call and its output is returned to the UI and rendered in a
collapsible panel. The point is that you can see what the model actually did
rather than trusting its summary of what it did.

---

## Storage

Postgres, not SQLite. The brief wanted everything in Docker, and a real client
and server exercises connection handling, retries and pooling the way the
deployed shape actually will. SQLite would have been less to run and less
representative.

The API retries the connection 30 times at 2s on boot, because Postgres in
compose is frequently not ready when the API starts and the failure otherwise
reads as an unexplained crash.

### The seed generator has no dependencies

`address-api/scripts/generate.js` implements its own Mulberry32 PRNG and word
lists rather than pulling in faker. Two reasons: the container stays slim, and
the `POST /api/admin/reseed` endpoint can reuse the exact same generator without
faker becoming a production dependency. Seeding and reseeding therefore cannot
diverge.

The PRNG is seedable so a run can be reproduced when you need it, and defaults to
time-based so reseeds differ.

---

## Both UIs use a relative `/api`

Neither client bundle contains an absolute host. `address-ui` and `mcp-client/ui`
call `/api/...` and their own nginx proxies to the upstream service.

This is what makes LAN access free: the same build works at
`http://localhost:8080`, `http://192.168.1.50:8080` or behind any hostname, with
no rebuild, no `VITE_API_URL`, and no CORS configuration - the browser only ever
talks to one origin.

Verified by building both bundles and grepping for absolute URLs; the only hits
are React's own SVG namespace and its error-docs links.

Do not "fix" this by introducing a build-time API base URL. It would make the
image host-specific and reintroduce CORS.

> nginx's `proxy_pass` with a variable upstream has a trap that this project hit
> in a later session. See the Operational Rules in `CLAUDE.md` - the correct form
> is `$request_uri`.

---

## Network exposure

### `BIND_ADDR`

Every published port is `${BIND_ADDR:-0.0.0.0}:host:container`, so exposure is one
variable rather than eight edits:

| Goal | Setting |
|------|---------|
| LAN-wide (default) | `BIND_ADDR=0.0.0.0` |
| Localhost only | `BIND_ADDR=127.0.0.1` |
| One NIC only | `BIND_ADDR=192.168.1.50` |

### Windows Firewall: profile and scope are different things

Conflating these is how people end up more exposed than they meant to be.

| | Controls | Values |
|---|---|---|
| **Profile** | *Which network you are on.* Windows classifies each connection. | Domain / Private / Public |
| **Scope** | *Who may connect.* This governs exposure. | LocalSubnet / Any |

Hence two scripts, named for the profile because that is the part that varies
while the scope stays safe by default in both:

- `open-firewall-lan.ps1` - Private profile, LocalSubnet.
- `open-firewall-public.ps1` - Public profile, still LocalSubnet by default. This
  is for the common case where Windows classified the LAN as Public and the
  Private rules therefore never applied. It is no more exposed than the LAN
  script.

Widening is a separate opt-in, `-RemoteScope Any`, gated three ways: an
`-IUnderstandTheRisk` flag, a hard refusal while `.env` still holds shipped
defaults, and a typed `EXPOSE` confirmation. The gates exist because of what this
stack is - plain HTTP, Postgres on 5432, an entirely unauthenticated Ollama on
11434, and MCP tools that can delete records.

`Any` is also not the same as internet-facing. A NAT router without a
port-forward still stands in the way; the flag only removes Windows Firewall from
the path. For real remote access, a VPN or Tailscale is safer and less work than
forwarding a port at plain HTTP.

### One source of truth for the port list

The port list lives once, in `docker-stack/_common.ps1`, dot-sourced by all three
firewall scripts. Two scripts drifting apart on which ports they cover is exactly
the bug that leaves something open you believed you had closed. A check that the
list matches `docker-compose.yml` is described under Verification below.

The same file holds the shipped-default credential table used by the refusal
gate. If a default in `.env.example` or a compose fallback ever changes, that
table has to change with it, or the gate silently stops catching it.

### Rule groups

`ContextForge-LAN` and `ContextForge-Public` are separate groups so
`close-firewall.ps1 -Which Public` can revoke a wide-open session without
disturbing everyday LAN access. `close-firewall.ps1` also still recognises the
older `ContextForge` group from before the split. Rules are matched by group, not
by port, so cleanup survives a port change in `.env`.

---

## Tests

`tests/` has two suites, neither needing Docker, Postgres or Ollama.

`api.test.mjs` runs the real `schema.sql` against `pg-mem` and imports the real
middleware and generator. It covers role ranking, JWT signing and tampering,
`requireAuth` / `requireRole` at every boundary, zod validation, CRUD and paging
SQL, the unique `customer_id` constraint, and bcrypt.

`mcp.test.mjs` is the one that matters. It stands up a stub API with the same
RBAC semantics, runs the **real** MCP server over streamable HTTP, and drives it
with the **real** client code from `mcp-client/server/src/mcp.js`. It asserts
that a `viewer` is refused create and delete, an `editor` is allowed create and
refused delete, an `admin` is allowed everything, and a forged JWT is rejected.

That suite is the executable form of the permission-inheritance property above.
If a change breaks it, the change has removed a security guarantee, not merely a
test.

`npm test` runs a `pretest` that installs `mcp-server` and `mcp-client/server`
first, because Node resolves those files' imports from their own `node_modules`,
not from `tests/`.

---

## Verification techniques that worked

Useful to a session without Docker running, or before starting it:

```bash
# every JS file parses
find . -name '*.js' -not -path '*/node_modules/*' -exec node --check {} \;

# JSX compiles and relative imports resolve
npx esbuild src/App.jsx --loader:.jsx=jsx --bundle --external:react --outfile=/dev/null

# compose interpolates cleanly under each BIND_ADDR mode, and every
# published port parses as bind:host:container
python3 -c "import yaml; yaml.safe_load(open('docker-stack/docker-compose.yml'))"

# the firewall port list still matches compose
#   compare Resolve-Port entries in _common.ps1 against the compose ports

# PowerShell must be ASCII (see CLAUDE.md for why)
grep -rlP '[^\x00-\x7F]' docker-stack/*.ps1     # expect no output

# production bundles contain no absolute host
npm run build && grep -oE 'https?://[a-zA-Z0-9.:_-]+' dist/assets/*.js | sort -u
```

---

## Alternatives considered and dropped

| Considered | Why not |
|-----------|---------|
| MCP server talks to Postgres directly | Duplicates the role checks; the copies drift. |
| A privileged token in the MCP server | Destroys permission inheritance - the agent would exceed its user. |
| SQLite | Simpler to run, less representative of the deployed shape. |
| faker for seeding | Would become a production dependency once `/admin/reseed` reused it. |
| Build-time API base URL in the UIs | Makes the image host-specific and reintroduces CORS. |
| One firewall script with a `-Profile` switch | Hides that profile and scope are different axes; the split forces the distinction. |
| Stateful MCP HTTP sessions | Session bookkeeping, and a real risk of leaking one caller's token into another's call. |
