# Architecture

## Request paths

There are three ways to change an address, and they converge on the same code.

**1. Human via UI**

```
browser → address-ui (nginx) → /api proxy → address-api → Postgres
```

**2. Script or integration**

```
curl → address-api → Postgres
```

**3. AI agent**

```
model → mcp-client backend → mcp-server → address-api → Postgres
```

Path 3 is deliberately not a shortcut. The MCP server holds no database
credentials and contains no business logic — it is an authenticated proxy that
translates tool calls into HTTP calls. That means an authorization bug can only
exist in one place, and a fix lands for all three paths at once.

## Identity flow

```
POST /api/auth/login  →  { token: <JWT>, user: { id, username, role } }
```

The JWT (HS256, 8h, payload `{sub, username, role}`) is then carried:

| Hop | How the token travels |
|-----|----------------------|
| browser → agent backend | `Authorization: Bearer` on `/api/ask` |
| agent backend → MCP server | `requestInit.headers` on the streamable HTTP transport |
| MCP server → REST API | `Authorization: Bearer`, forwarded verbatim |
| REST API | `requireAuth` verifies, `requireRole` authorizes |

For the **stdio** transport there are no headers, so identity comes from
`MCP_USERNAME`/`MCP_PASSWORD` and the MCP server logs in as that service account.
Pick the least-privileged account that does the job — this is the one place where
the agent's authority is configured rather than inherited.

## The agent loop

`mcp-client/server/src/agent.js`:

1. Open an MCP session with the user's JWT.
2. `tools/list` → convert MCP schemas to Ollama's function-calling format.
3. Send system prompt + history + user message to `/api/chat`.
4. If the reply has `tool_calls`, execute each via MCP, append results as
   `role: 'tool'` messages, loop.
5. Stop when the model answers, or at `AGENT_MAX_STEPS` (default 6).
6. Close the session. Every request gets a fresh one — the server is stateless.

The trace of every tool call and its output is returned to the UI and shown in a
collapsible panel, so you can see exactly what the model did rather than trusting
its summary.

## Why the MCP server is its own project

- It can be run standalone against a remote API — nothing ties it to this host.
- Claude Desktop can spawn it over stdio without any of the web tier existing.
- The Context Forge gateway can federate it as a peer alongside other servers.
- Its dependency set stays tiny, so the container stays small and boots fast.

## Data model

```
users                          addresses
─────                          ─────────
id            serial pk        id           serial pk
username      text unique      customer_id  text unique
password_hash text             first_name   text
role          text check       last_name    text
created_at    timestamptz      address      text
updated_at    timestamptz      city         text
                               state        char(2)
                               phone        text
                               created_at   timestamptz
                               updated_at   timestamptz
```

Indexes cover `lower(last_name)`, `lower(city)`, `state`, `customer_id`, plus a
GIN full-text index for future ranked search. The current search uses `LIKE` on
lowered columns, which is exact enough at this scale and behaves predictably for
partial matches like `aus` → Austin.

## Failure behaviour

| Failure | What happens |
|---------|--------------|
| Postgres not ready at boot | API retries 30× at 2s, then exits |
| Service-account JWT expires | `ApiClient` logs in again and retries once |
| Ollama not running | `/health` on the agent backend reports it; the UI surfaces the error |
| Model returns arguments as a JSON string | `agent.js` parses it before dispatch |
| Tool returns FORBIDDEN | Model is instructed to call `whoami` and explain, not retry |
| Agent loops | Hard stop at `AGENT_MAX_STEPS` with a `truncated` flag |
