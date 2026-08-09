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

[`HANDOFF.md`](HANDOFF.md) records the current state, why recent changes were
made, and what is still open. Read it before changing anything in
`docker-stack/`, `mcp-client/` or the nginx configs - several of the decisions
there look arbitrary until you know which failure they came from.

## Repository Layout

```
ContextForge/
├── address-api/     # Node + Express REST API, Postgres, JWT auth, RBAC
├── address-ui/      # React + Vite full management UI
├── mcp-server/      # Standalone MCP server (stdio + streamable HTTP)
├── mcp-client/      # AI client: Ollama-driven agent + search-only React UI
├── docker-stack/    # docker-compose for everything incl. Ollama + Context Forge
└── docs/            # Architecture and API notes
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
- JWTs are signed with `JWT_SECRET` (HS256), 8h expiry, payload `{ sub, username, role }`.
- Passwords are bcrypt hashed, cost 10. Never log or return a password hash.

## REST Conventions

- Base path `/api`. JSON in, JSON out. `Authorization: Bearer <jwt>`.
- Collections: `GET /api/addresses?q=&page=&pageSize=&sort=&dir=`
  returns `{ data: [...], page, pageSize, total }`.
- Single resource: `GET|PUT|DELETE /api/addresses/:id`.
- Errors: `{ error: { code, message, details? } }` with a correct HTTP status.
  Codes: `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `VALIDATION`, `CONFLICT`, `INTERNAL`.
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
