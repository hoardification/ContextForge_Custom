# CLAUDE.md — Project Conventions

This file is authoritative for any AI assistant working in this repository.

## Prime Directive

**Every feature ships three surfaces, always:**

1. **Database / domain layer** — schema + query functions.
2. **REST API** — an HTTP endpoint under `/api`, authenticated and role-checked.
3. **MCP tool** — a corresponding tool in `mcp-server` so an AI agent can use the
   feature with no UI at all.

A feature is **not done** until all three exist and enforce the same security rules.
If you add an endpoint and no MCP tool, you have introduced a defect.

## Start Here

Three documents, in the order you want them:

- [`HANDOFF.md`](HANDOFF.md) - current state, why recent changes were made, and
  what is still open. Read it before changing anything in `docker-stack/`,
  `mcp-client/` or the nginx configs - several of the decisions there look
  arbitrary until you know which failure they came from. It changes often.
- [`docs/DECISIONS.md`](docs/DECISIONS.md) - why the design is what it is, and
  which alternatives were rejected. Read it before changing the identity flow,
  the MCP server's role as a thin proxy, or the network exposure model. It
  changes only when a decision changes.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) - request paths, identity flow
  and the data model.

## Repository Layout

```
ContextForge/
├── address-api/     # Node + Express REST API, Postgres, JWT auth, RBAC
├── address-ui/      # React + Vite full management UI
├── mcp-server/      # Standalone MCP server (stdio + streamable HTTP)
├── mcp-client/      # AI client: Ollama-driven agent + search-only React UI
├── docker-stack/    # docker-compose for everything incl. Ollama + Context Forge
├── tests/           # Integration suites; no Docker, Postgres or Ollama needed
└── docs/            # Architecture, design decisions and API notes
```

## Roles and Security Model

Three roles, strictly ordered:

| Role        | Read | Create/Update | Delete | User admin | Reseed |
|-------------|------|---------------|--------|-----------|--------|
| `read`      | ✅   | ❌            | ❌     | ❌        | ❌     |
| `readwrite` | ✅   | ✅            | ❌     | ❌        | ❌     |
| `admin`     | ✅   | ✅            | ✅     | ✅        | ✅     |

Rules:

- The **API is the only place** authorization is truly enforced. The UI and the MCP
  server hide/deny things for UX, but must never be the sole gate.
- The MCP server never holds a privileged god-token. It forwards the caller's JWT.
- **Permission inheritance is a guarantee, not an implementation detail.** The
  user's JWT is forwarded verbatim browser -> agent -> MCP server -> API, so an
  agent acts with exactly the permissions of the human driving it. Anything that
  gives a middle hop its own token removes that property. `tests/mcp.test.mjs`
  asserts it; if that suite fails, a security guarantee has gone, not just a test.
- The one place identity is *configured* rather than inherited is the stdio
  transport, which has no headers: `MCP_USERNAME` / `MCP_PASSWORD`. Default it to
  the least-privileged account that still works.
- JWTs are signed with `JWT_SECRET` (HS256), 8h expiry, payload `{ sub, username, role }`,
  plus `scope` on the restricted token described next.
- **A password this repository publishes is treated as already expired.** Login
  with one succeeds but returns a token carrying `scope: 'password_change'`, and
  `requireAuth` refuses that token everywhere except `POST /api/auth/change-password`.
  The role claim is untouched, so the refusal must come from the scope check -
  a locked `admin` is otherwise a full admin. New protected routes inherit this
  automatically by using `requireAuth`; reaching for
  `requireAuthForPasswordChange` instead disables the lock for that route.
  The published list lives once, in `address-api/src/publicPasswords.js`.
- Passwords are bcrypt hashed, cost 10. Never log or return a password hash.

## REST Conventions

- Base path `/api`. JSON in, JSON out. `Authorization: Bearer <jwt>`.
- Collections: `GET /api/addresses?q=&page=&pageSize=&sort=&dir=`
  returns `{ data: [...], page, pageSize, total }`.
- Single resource: `GET|PUT|DELETE /api/addresses/:id`.
- Errors: `{ error: { code, message, details? } }` with a correct HTTP status.
  Codes: `UNAUTHENTICATED`, `FORBIDDEN`, `PASSWORD_CHANGE_REQUIRED`, `NOT_FOUND`,
  `VALIDATION`, `CONFLICT`, `INTERNAL`.
- Validate every body/query with zod. No unvalidated input reaches SQL.
- Only parameterized SQL. Never string-concatenate a query.

## MCP Conventions

- Tool names are `snake_case`, verb-last where natural: `address_search`, `address_create`.
- Every tool declares a zod input schema and returns both human-readable text
  content and `structuredContent` with the raw JSON.
- Tool descriptions must state the required role, e.g. "Requires `admin`."
- Mutating tools echo back what changed so the model can confirm to the user.
- A tool must map to exactly one REST call where possible; the MCP server is a
  thin, authenticated proxy, not a second implementation of business logic.

## Adding a Feature — Checklist

1. Migration in `address-api/src/db/schema.sql`.
2. Query function in `address-api/src/db/`.
3. Route + zod schema + `requireRole()` in `address-api/src/routes/`.
4. MCP tool in `mcp-server/src/tools.js` (same role requirement).
5. UI wiring in `address-ui` gated by `useAuth().can(...)`.
6. Update `docs/API.md`.
7. Cover the new role boundary in `tests/mcp.test.mjs` - at minimum, that the
   role below the one you require is refused. `cd tests && npm test`.

## Operational Rules

- Run `docker-stack/check-env.ps1` before `docker compose up`. Length minimums
  are enforced by services at startup and read as unexplained crash-loops.
- `nginx.conf` is baked into the UI images. Changing it needs `--build`, not a
  restart.
- `proxy_pass` with a variable in its argument does not append the unmatched
  path - nginx sends the URI in the directive verbatim. Use `$request_uri` when
  the upstream is a variable, or the location prefix is silently dropped.
- Cancellation of an HTTP request hooks `res.on('close')`. `req.on('close')`
  fires as soon as the request body is read, which for a POST is immediately.
- Long-running agent work reports progress; it does not return one JSON body at
  the end. A user cannot tell slow from hung, and this stack is often slow.
- Both UI bundles call a relative `/api` and their own nginx proxies upstream.
  That is what makes the same image work on localhost, a LAN IP or a hostname
  with no rebuild and no CORS. Do not introduce a build-time API base URL.
- Published ports are `${BIND_ADDR:-0.0.0.0}:host:container`. Exposure is one
  variable, not eight edits. Add new services the same way.
- The firewall port list lives once, in `docker-stack/_common.ps1`, dot-sourced
  by all three firewall scripts. Never copy it into a script - two lists drifting
  is what leaves a port open you believed you had closed. Add a new published
  port there and to `docker-compose.yml` in the same change.
- `_common.ps1` also holds the shipped-default credential table that
  `open-firewall-public.ps1` refuses on. If a default in `.env.example` or a
  compose fallback changes, change that table too, or the gate stops catching it.

## Style

- Node 20+, ESM (`"type": "module"`), no TypeScript in runtime code.
- 2-space indent, single quotes, semicolons.
- PowerShell scripts are ASCII only, including comments. Windows PowerShell
  5.1 reads a BOM-less file as ANSI, so a UTF-8 em dash arrives as `â€”`; the
  trailing character is a smart quote, which PowerShell honours as a string
  delimiter and the file fails to parse. Use `-`, not an em dash.
- No secrets in source, and no real credential in any tracked file - docs
  included. `.env` is the only copy; point at `docker-stack/show-credentials.ps1`
  instead of pasting a value into a README. `.githooks/pre-commit` enforces this.
- Never switch a security control off to make something work. Scope an
  exception instead, as narrowly as the control allows, and pin whatever the
  exception names so it cannot drift. The gateway's `SSRF_ALLOWED_NETWORKS`
  against a pinned `STACK_SUBNET` is the worked example.
- A secret with no safe default gets no default. Fail to start with a message
  that says how to set it, rather than falling back to a value the source
  publishes. Ports, model names and timeouts still take documented defaults.
- Any env var with a minimum length gets a fallback in `docker-compose.yml` that
  already satisfies it. The gateway needs 32 characters for `JWT_SECRET_KEY` and
  `AUTH_ENCRYPTION_SECRET` and 22 for a privileged password; a shorter default
  fails validation at startup and reads as an unexplained crash-loop. Add new
  length rules to `docker-stack/check-env.ps1` so they fail loudly and early.
