# tests

Two integration suites. Neither needs Docker, Postgres or Ollama running.

```bash
cd tests
npm install
npm test
```

`npm test` runs a `pretest` that installs `mcp-server` and `mcp-client/server`
first — `mcp.test.mjs` imports their real source, and Node resolves those files'
dependencies from their own `node_modules`, not from `tests/`.

## `api.test.mjs`

Runs the real schema against an in-memory Postgres (`pg-mem`) and exercises the
real middleware and seed generator:

- bootstrap users and 100-row seed
- role ranking, JWT signing/verification/tampering
- `requireAuth` and `requireRole` at every role boundary
- zod validation rejects bad state codes and short phone numbers
- create / update / delete / search / paging SQL
- unique `customer_id` constraint
- bcrypt hashing and verification

## `mcp.test.mjs`

Stands up a stub address-api with the same RBAC semantics, runs the **real**
MCP server over streamable HTTP, and drives it with the **real** client code
from `mcp-client/server/src/mcp.js`:

- MCP handshake, tool discovery, schema shape
- conversion to Ollama function-calling format
- happy-path search / create / update / delete as `admin`
- `viewer` blocked from create and delete, with an explanatory message
- `editor` allowed to create, blocked from delete
- forged JWT rejected

The second suite is the one that matters most: it proves an AI agent cannot
exceed the permissions of the human who signed in.
