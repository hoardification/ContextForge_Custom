/**
 * Streamable HTTP transport — for the MCP client app and the Context Forge gateway.
 *
 * Stateless: a fresh server + transport per request. Each request carries its own
 * identity, taken from the caller's `Authorization: Bearer <jwt>` header when
 * present, and otherwise falling back to the configured service account.
 */
import 'dotenv/config';
import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from './createServer.js';

const app = express();
app.use(express.json({ limit: '4mb' }));

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization, mcp-session-id, mcp-protocol-version');
  res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  return next();
});

app.get('/health', (_req, res) => res.json({ ok: true, service: 'address-mcp-server' }));

function callerAuth(req) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme === 'Bearer' && token) return { token };
  return { username: process.env.MCP_USERNAME, password: process.env.MCP_PASSWORD };
}

app.post('/mcp', async (req, res) => {
  const server = createServer(callerAuth(req));
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  res.on('close', () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('[mcp] request failed:', err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: req.body?.id ?? null,
      });
    }
  }
});

// Stateless mode has no server-initiated stream and no session to delete.
const notAllowed = (_req, res) =>
  res.status(405).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed: server runs in stateless mode' },
    id: null,
  });

app.get('/mcp', notAllowed);
app.delete('/mcp', notAllowed);

const port = Number(process.env.MCP_HTTP_PORT || 4100);
app.listen(port, '0.0.0.0', () => {
  console.log(`[mcp] address-book MCP server (streamable HTTP) on :${port}/mcp`);
});
