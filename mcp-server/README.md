# address-mcp-server

Standalone MCP server exposing the address book to AI agents. Two transports,
one tool set, and the same RBAC the REST API enforces.

## Tools

| Tool               | Min role    | What it does |
|--------------------|-------------|--------------|
| `whoami`           | read        | Report the authenticated identity and role |
| `password_change`  | any         | Replace the calling account's own password |
| `address_search`   | read        | Free-text search + city/state filters, paged |
| `address_list_all` | read        | Every address, paged |
| `address_get`      | read        | One address by id or customer id |
| `address_stats`    | read        | Totals and top states |
| `address_create`   | readwrite   | Add an address |
| `address_update`   | readwrite   | Patch fields on an address |
| `address_delete`   | admin       | Delete an address |
| `admin_reseed`     | admin       | Wipe and regenerate records |
| `admin_stats`      | admin       | System counts and uptime |
| `user_list`        | admin       | List accounts |
| `user_create`      | admin       | Create an account |
| `user_update`      | admin       | Change username/password/role |
| `user_delete`      | admin       | Delete an account |

Authorization is real: the server forwards the caller's JWT to the API and the
API decides. A `read` service account calling `address_delete` gets FORBIDDEN.

## Transports

**HTTP (default)** — `POST /mcp`, streamable HTTP, stateless. Identity comes from
the caller's `Authorization: Bearer <jwt>` header, falling back to the service
account in env. This is what the MCP client app and the Context Forge gateway use.

```bash
MCP_HTTP_PORT=4100 API_BASE_URL=http://localhost:4000 npm start
```

**stdio** — for Claude Desktop / Claude Code. No headers exist, so identity is
the `MCP_USERNAME` / `MCP_PASSWORD` service account.

> The service account must **not** hold one of the demo passwords published in
> this repository. Those are treated as already expired, and a service account
> has no way to answer a password prompt, so every call fails with
> `PASSWORD_CHANGE_REQUIRED`. Give the account a real password first — change it
> in the address book UI and set `MCP_PASSWORD` to match. The configs below use
> a placeholder for exactly that reason.

```bash
npm run start:stdio
```

## Claude Desktop config

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "address-book": {
      "command": "node",
      "args": ["C:/path/to/ContextForge/mcp-server/src/stdio.js"],
      "env": {
        "API_BASE_URL": "http://localhost:4000",
        "MCP_USERNAME": "editor",
        "MCP_PASSWORD": "your-real-password-here"
      }
    }
  }
}
```

Use `viewer` for a read-only agent, `admin` only when you truly want an agent
able to delete and reseed.

## Connecting from another machine on the LAN

The HTTP transport is published on every interface, so an MCP host elsewhere on
your network can reach it at `http://<lan-ip>:4100/mcp`. Get the address with
`docker-stack/lan-urls.ps1` (or `.sh`).

Hosts that speak streamable HTTP natively take the URL directly. For Claude
Desktop, which spawns stdio servers, bridge it with `mcp-remote`:

```json
{
  "mcpServers": {
    "address-book": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://192.168.1.50:4100/mcp"]
    }
  }
}
```

Alternatively run this project's own `src/stdio.js` on the remote machine and
point `API_BASE_URL` at the LAN address of the API:

```json
{
  "mcpServers": {
    "address-book": {
      "command": "node",
      "args": ["C:/path/to/ContextForge/mcp-server/src/stdio.js"],
      "env": {
        "API_BASE_URL": "http://192.168.1.50:4000",
        "MCP_USERNAME": "editor",
        "MCP_PASSWORD": "your-real-password-here"
      }
    }
  }
}
```

Note what identity means over the LAN: a caller that sends
`Authorization: Bearer <jwt>` acts as that user, and a caller that sends nothing
falls back to the `MCP_USERNAME` service account — `viewer` by default. Since
this is plain HTTP, treat the whole surface as trusted-network-only.

## Smoke test

```bash
curl -s localhost:4100/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```
