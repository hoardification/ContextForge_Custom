import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { MAX_STEPS, runAgent } from './agent.js';
import { connectMcp } from './mcp.js';
import { MODEL, health } from './ollama.js';

const API_BASE = process.env.API_BASE_URL || 'http://localhost:4000';

// How often to prove liveness while the model is thinking. Well under any
// sensible proxy read timeout.
const HEARTBEAT_MS = Number(process.env.AGENT_HEARTBEAT_MS || 10000);

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '1mb' }));

function bearer(req) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  return scheme === 'Bearer' && token ? token : null;
}

app.get('/health', async (_req, res) => {
  res.json({ ok: true, service: 'mcp-client', ollama: await health() });
});

/**
 * Login is proxied so the search UI has one origin to talk to and the JWT it
 * gets back is the same one the agent will carry into MCP.
 */
app.post('/api/login', async (req, res) => {
  try {
    const upstream = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    const body = await upstream.json();
    res.status(upstream.status).json(body);
  } catch (err) {
    res.status(502).json({ error: { code: 'UPSTREAM', message: err.message } });
  }
});

/** What can this agent do right now? Useful for the UI's tool list. */
app.get('/api/tools', async (req, res) => {
  const jwt = bearer(req);
  if (!jwt) return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in first' } });

  try {
    const { client, transport } = await connectMcp(jwt);
    const { tools } = await client.listTools();
    await transport.close().catch(() => {});
    await client.close().catch(() => {});
    res.json({ model: MODEL, tools: tools.map((t) => ({ name: t.name, description: t.description })) });
  } catch (err) {
    res.status(502).json({ error: { code: 'MCP', message: err.message } });
  }
});

/**
 * The only real endpoint: a natural-language request. The model decides which
 * MCP tools to call — read, update, delete, reseed — there is no CRUD UI here.
 */
app.post('/api/ask', async (req, res) => {
  const jwt = bearer(req);
  if (!jwt) return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in first' } });

  const { message, history } = req.body || {};
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: { code: 'VALIDATION', message: 'message is required' } });
  }

  const started = Date.now();
  try {
    const result = await runAgent(message, jwt, Array.isArray(history) ? history.slice(-8) : []);
    res.json({ ...result, model: MODEL, elapsedMs: Date.now() - started });
  } catch (err) {
    console.error('[agent] failed:', err);
    res.status(500).json({ error: { code: 'AGENT', message: err.message } });
  }
});

/**
 * Same work as /api/ask, reported as it happens.
 *
 * A 7B model on CPU can spend minutes across several tool-calling rounds. With
 * a single JSON response there is nothing on the wire until it finishes, so a
 * slow run and a hung one look identical from the browser. Server-sent events
 * make the difference visible: every stage change is an event, and a heartbeat
 * keeps arriving even while the model is busy, which is the part that proves
 * the run is alive.
 */
app.post('/api/ask/stream', async (req, res) => {
  const jwt = bearer(req);
  if (!jwt) return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in first' } });

  const { message, history } = req.body || {};
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: { code: 'VALIDATION', message: 'message is required' } });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Belt and braces: nginx is configured with proxy_buffering off, but this
    // header makes any proxy in the path stop buffering too. Without it the
    // events arrive in one batch at the end, which defeats the point.
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  const send = (event, data) => {
    if (res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // The browser closing the tab, or pressing Stop, aborts the run rather than
  // leaving the model and MCP session working on an answer nobody will read.
  //
  // This must listen on the RESPONSE, not the request. Since Node 16 a request
  // stream emits 'close' as soon as its body has been read, which for a POST is
  // immediately - listening there cancels every run the moment it starts.
  const ctrl = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) ctrl.abort(new Error('client disconnected'));
  });

  const started = Date.now();
  const heartbeat = setInterval(
    () => send('heartbeat', { elapsedMs: Date.now() - started }),
    HEARTBEAT_MS,
  );

  try {
    send('start', { model: MODEL, maxSteps: MAX_STEPS, heartbeatMs: HEARTBEAT_MS });

    const result = await runAgent(
      message,
      jwt,
      Array.isArray(history) ? history.slice(-8) : [],
      { signal: ctrl.signal, onEvent: (e) => send(e.type, e) },
    );

    send('done', { ...result, model: MODEL, elapsedMs: Date.now() - started });
  } catch (err) {
    if (err?.cancelled || ctrl.signal.aborted) {
      send('cancelled', { elapsedMs: Date.now() - started });
    } else {
      console.error('[agent] failed:', err);
      send('error', { code: 'AGENT', message: err.message, elapsedMs: Date.now() - started });
    }
  } finally {
    clearInterval(heartbeat);
    if (!res.writableEnded) res.end();
  }
});

const port = Number(process.env.MCP_CLIENT_PORT || 4200);
app.listen(port, '0.0.0.0', () => {
  console.log(`[client] agent backend on :${port} (model ${MODEL})`);
});
