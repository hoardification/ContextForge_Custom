/**
 * End-to-end MCP test.
 *
 * Stands up a fake address-api (real routes, real RBAC semantics), runs the
 * REAL mcp-server over streamable HTTP, and drives it with the REAL client code
 * from mcp-client/server/src/mcp.js. Verifies tool discovery, happy-path calls,
 * and that a `read` identity is refused a delete.
 */
import express from 'express';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test-secret';

let pass = 0, fail = 0;
const out = [];
const check = (name, cond, detail = '') => {
  if (cond) { pass++; out.push(`  ok   ${name}`); }
  else { fail++; out.push(`  FAIL ${name} ${detail}`); }
};

const RANK = { read: 1, readwrite: 2, admin: 3 };

// ---------------------------------------------------------------- fake API --
const rows = [
  { id: 1, customer_id: 'CUST-000001', first_name: 'Ada', last_name: 'Lovelace', address: '1 Analytical Way', city: 'Austin', state: 'TX', phone: '(512) 555-0101' },
  { id: 2, customer_id: 'CUST-000002', first_name: 'Grace', last_name: 'Hopper', address: '9 Compiler Rd', city: 'Denver', state: 'CO', phone: '(303) 555-0102' },
];

const users = {
  admin: { id: 1, username: 'admin', role: 'admin', password: 'admin123' },
  editor: { id: 2, username: 'editor', role: 'readwrite', password: 'editor123' },
  viewer: { id: 3, username: 'viewer', role: 'read', password: 'viewer123' },
};

const api = express();
api.use(express.json());

// Stands in for an account still holding a password published in the repo.
// Its login succeeds but reports the lock, exactly as the real API does.
users.locked = { id: 4, username: 'locked', role: 'read', password: 'viewer123', mustChange: true };

api.post('/api/auth/login', (req, res) => {
  const u = users[req.body?.username];
  if (!u || u.password !== req.body?.password) {
    return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Invalid username or password' } });
  }
  const token = jwt.sign({ sub: String(u.id), username: u.username, role: u.role }, 'test-secret', { expiresIn: '1h' });
  res.json({
    token,
    mustChangePassword: Boolean(u.mustChange),
    user: { id: u.id, username: u.username, role: u.role },
  });
});

api.post('/api/auth/change-password', (req, res) => {
  const [, tok] = (req.headers.authorization || '').split(' ');
  let claims;
  try {
    claims = jwt.verify(tok, 'test-secret');
  } catch {
    return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Invalid token' } });
  }
  const u = users[claims.username];
  if (!u || u.password !== req.body?.currentPassword) {
    return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Current password is incorrect' } });
  }
  u.password = req.body.newPassword;
  u.mustChange = false;
  const token = jwt.sign({ sub: String(u.id), username: u.username, role: u.role }, 'test-secret', { expiresIn: '1h' });
  res.json({ token, mustChangePassword: false, user: { id: u.id, username: u.username, role: u.role } });
});

function auth(min) {
  return (req, res, next) => {
    const [, tok] = (req.headers.authorization || '').split(' ');
    try {
      req.user = jwt.verify(tok, 'test-secret');
    } catch {
      return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Invalid token' } });
    }
    if ((RANK[req.user.role] || 0) < RANK[min]) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: `Requires role '${min}' or higher` } });
    }
    return next();
  };
}

api.get('/api/auth/me', auth('read'), (req, res) =>
  res.json({ user: { id: Number(req.user.sub), username: req.user.username, role: req.user.role } }));

api.get('/api/addresses', auth('read'), (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  const data = rows.filter((r) => !q || Object.values(r).join(' ').toLowerCase().includes(q));
  res.json({ data, page: 1, pageSize: 25, total: data.length });
});

api.get('/api/addresses/stats', auth('read'), (_req, res) =>
  res.json({ total: rows.length, byState: [{ state: 'TX', count: 1 }, { state: 'CO', count: 1 }] }));

api.get('/api/addresses/:id', auth('read'), (req, res) => {
  const row = rows.find((r) => r.id === Number(req.params.id));
  if (!row) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Address not found' } });
  res.json(row);
});

api.post('/api/addresses', auth('readwrite'), (req, res) => {
  const row = { id: rows.length + 1, ...req.body };
  rows.push(row);
  res.status(201).json(row);
});

api.put('/api/addresses/:id', auth('readwrite'), (req, res) => {
  const row = rows.find((r) => r.id === Number(req.params.id));
  Object.assign(row, req.body);
  res.json(row);
});

api.delete('/api/addresses/:id', auth('admin'), (req, res) => {
  const i = rows.findIndex((r) => r.id === Number(req.params.id));
  rows.splice(i, 1);
  res.json({ deleted: true, id: Number(req.params.id) });
});

const apiServer = api.listen(4999);
process.env.API_BASE_URL = 'http://localhost:4999';

// ------------------------------------------------------- real MCP server ---
const { createServer } = await import('../mcp-server/src/createServer.js');
const { StreamableHTTPServerTransport } = await import('@modelcontextprotocol/sdk/server/streamableHttp.js');

const mcpApp = express();
mcpApp.use(express.json());
mcpApp.post('/mcp', async (req, res) => {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  const server = createServer(scheme === 'Bearer' && token ? { token } : { username: 'viewer', password: 'viewer123' });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => { transport.close().catch(() => {}); server.close().catch(() => {}); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});
const mcpServer = mcpApp.listen(4998);
process.env.MCP_SERVER_URL = 'http://localhost:4998/mcp';

// ------------------------------------------------------- real MCP client ---
const { connectMcp, listOllamaTools, callTool } = await import('../mcp-client/server/src/mcp.js');

async function login(username, password) {
  const r = await fetch('http://localhost:4999/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return (await r.json()).token;
}

// ---- as admin -------------------------------------------------------------
{
  const token = await login('admin', 'admin123');
  const { client, transport } = await connectMcp(token);

  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  check('MCP handshake succeeds and lists tools', tools.length > 0, `got ${tools.length}`);
  check('15 tools registered', tools.length === 15, `got ${tools.length}: ${names.join(',')}`);
  for (const expected of ['whoami', 'password_change', 'address_search', 'address_get', 'address_create',
    'address_update', 'address_delete', 'admin_reseed', 'user_list']) {
    check(`tool present: ${expected}`, names.includes(expected));
  }
  check('every tool has a description', tools.every((t) => t.description?.length > 10));
  check('tool schemas are JSON Schema objects',
    tools.every((t) => t.inputSchema?.type === 'object'));

  const ollamaTools = await listOllamaTools(client);
  check('tools convert to Ollama function format',
    ollamaTools.length === tools.length &&
    ollamaTools.every((t) => t.type === 'function' && t.function.name && t.function.parameters));

  const who = await callTool(client, 'whoami', {});
  check('whoami reports admin', !who.isError && who.text.includes('admin'), who.text);

  const search = await callTool(client, 'address_search', { query: 'Austin' });
  check('address_search finds Ada in Austin', !search.isError && search.text.includes('Lovelace'), search.text);

  const stats = await callTool(client, 'address_stats', {});
  check('address_stats returns totals', !stats.isError && stats.text.includes('2 addresses'), stats.text);

  const created = await callTool(client, 'address_create', {
    customer_id: 'CUST-000003', first_name: 'Alan', last_name: 'Turing',
    address: '2 Enigma Ct', city: 'Boise', state: 'ID', phone: '(208) 555-0103',
  });
  check('admin can create', !created.isError && created.text.includes('Turing'), created.text);

  const updated = await callTool(client, 'address_update', { id: 3, phone: '(208) 555-9999' });
  check('admin can update', !updated.isError && updated.text.includes('555-9999'), updated.text);

  const deleted = await callTool(client, 'address_delete', { id: 3 });
  check('admin can delete', !deleted.isError && deleted.text.includes('Deleted'), deleted.text);

  const missing = await callTool(client, 'address_get', { id: 999 });
  check('missing record returns a clean NOT_FOUND', missing.isError && missing.text.includes('NOT_FOUND'), missing.text);

  const noArgs = await callTool(client, 'address_get', {});
  check('address_get requires id or customer_id', noArgs.isError, noArgs.text);

  await transport.close(); await client.close();
}

// ---- as viewer (read only) ------------------------------------------------
{
  const token = await login('viewer', 'viewer123');
  const { client, transport } = await connectMcp(token);

  const who = await callTool(client, 'whoami', {});
  check('viewer identity is read', !who.isError && who.text.includes("'read'"), who.text);

  const search = await callTool(client, 'address_search', { query: '' });
  check('viewer can search', !search.isError, search.text);

  const create = await callTool(client, 'address_create', {
    customer_id: 'CUST-BAD', first_name: 'No', last_name: 'Way',
    address: 'x', city: 'y', state: 'TX', phone: '5125550000',
  });
  check('viewer BLOCKED from create', create.isError && create.text.includes('FORBIDDEN'), create.text);

  const del = await callTool(client, 'address_delete', { id: 1 });
  check('viewer BLOCKED from delete', del.isError && del.text.includes('FORBIDDEN'), del.text);
  check('forbidden message explains the role problem', del.text.includes('does not have the required role'), del.text);

  await transport.close(); await client.close();
}

// ---- as editor (readwrite) ------------------------------------------------
{
  const token = await login('editor', 'editor123');
  const { client, transport } = await connectMcp(token);

  const create = await callTool(client, 'address_create', {
    customer_id: 'CUST-000004', first_name: 'Edsger', last_name: 'Dijkstra',
    address: '3 Shortest Path', city: 'Austin', state: 'TX', phone: '(512) 555-0104',
  });
  check('editor CAN create', !create.isError, create.text);

  const del = await callTool(client, 'address_delete', { id: 1 });
  check('editor BLOCKED from delete', del.isError && del.text.includes('FORBIDDEN'), del.text);

  await transport.close(); await client.close();
}

// ---- bad token ------------------------------------------------------------
{
  const { client, transport } = await connectMcp('not-a-real-jwt');
  const who = await callTool(client, 'whoami', {});
  check('forged token is rejected', who.isError && who.text.includes('UNAUTHENTICATED'), who.text);
  await transport.close(); await client.close();
}

// ---- an account still on a published password -----------------------------
// The stdio path: identity comes from env, so the client logs in itself. A
// locked account must fail with the reason, not as a generic auth error - a
// service account cannot answer a password prompt, and the fix is in .env.
{
  const { ApiClient } = await import('../mcp-server/src/apiClient.js');
  const client = new ApiClient({ username: 'locked', password: 'viewer123' });
  let err = null;
  try {
    await client.request('/api/addresses');
  } catch (e) {
    err = e;
  }
  check('a locked service account cannot reach the API', err !== null);
  check('and the failure names the lock', err?.code === 'PASSWORD_CHANGE_REQUIRED', String(err?.message));
  check('and the message points at the env fix',
    /VIEWER_PASSWORD/.test(err?.message || '') && /MCP_PASSWORD/.test(err?.message || ''),
    String(err?.message));
}

// ---- password_change over a forwarded token -------------------------------
{
  const token = await login('locked', 'viewer123');
  const { client, transport } = await connectMcp(token);

  const wrong = await callTool(client, 'password_change', {
    currentPassword: 'test-secret-wrong', newPassword: 'test-secret-replacement',
  });
  check('password_change rejects a wrong current password',
    wrong.isError && wrong.text.includes('UNAUTHENTICATED'), wrong.text);

  const changed = await callTool(client, 'password_change', {
    currentPassword: 'viewer123', newPassword: 'test-secret-replacement',
  });
  check('password_change succeeds with the right current password',
    !changed.isError && changed.text.includes('locked'), changed.text);
  check('password_change never echoes a token back',
    !/eyJ[A-Za-z0-9_-]/.test(changed.text), changed.text);

  await transport.close(); await client.close();
}

console.log(out.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);

apiServer.close(); mcpServer.close();
process.exit(fail ? 1 : 0);
