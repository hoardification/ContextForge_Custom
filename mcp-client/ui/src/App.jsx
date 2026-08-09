import { useEffect, useRef, useState } from 'react';

const SUGGESTIONS = [
  'Find everyone in Austin, TX',
  'How many addresses are in the book?',
  'Show me the Smiths',
  "Update CUST-000123's phone number to (512) 555-0142",
  'Which states have the most records?',
];

// The server heartbeats every 10s. Twice that with slack means "we really have
// heard nothing", not "the model is taking its time".
const STALL_AFTER_MS = 25000;

function fmtMs(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('agent_token') || '');
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('agent_user') || 'null'); } catch { return null; }
  });

  const [username, setUsername] = useState('editor');
  const [password, setPassword] = useState('');
  const [q, setQ] = useState('');
  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [tools, setTools] = useState([]);

  // Live view of the run in flight: what it is doing, what it has done, and
  // when we last heard anything at all.
  const [run, setRun] = useState(null);
  const [now, setNow] = useState(Date.now());
  const abortRef = useRef(null);
  const bottom = useRef(null);

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, busy, run?.steps.length]);

  // Only tick while something is running - no timer burning in the background.
  useEffect(() => {
    if (!busy) return undefined;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [busy]);

  useEffect(() => {
    if (!token) return;
    fetch('/api/tools', { headers: { authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => setTools(d.tools || []))
      .catch(() => {});
  }, [token]);

  async function login(e) {
    e.preventDefault();
    setError('');
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message || 'Login failed');
      setToken(body.token);
      setUser(body.user);
      localStorage.setItem('agent_token', body.token);
      localStorage.setItem('agent_user', JSON.stringify(body.user));
    } catch (err) {
      setError(err.message);
    }
  }

  function logout() {
    abortRef.current?.abort();
    setToken('');
    setUser(null);
    setMessages([]);
    localStorage.removeItem('agent_token');
    localStorage.removeItem('agent_user');
  }

  function stop() {
    abortRef.current?.abort();
  }

  /** Fold one server event into the live run state. */
  function applyEvent(type, data) {
    setRun((prev) => {
      if (!prev) return prev;
      const next = { ...prev, lastEventAt: Date.now(), steps: [...prev.steps] };

      const closeLast = (kind, patch) => {
        for (let i = next.steps.length - 1; i >= 0; i--) {
          if (next.steps[i].kind === kind && next.steps[i].running) {
            next.steps[i] = { ...next.steps[i], running: false, ...patch };
            return;
          }
        }
      };

      switch (type) {
        case 'start':
          next.model = data.model;
          next.maxSteps = data.maxSteps;
          next.detail = 'Starting';
          break;
        case 'status':
          next.detail = data.detail || next.detail;
          break;
        case 'thinking':
          next.detail = `Thinking (step ${data.step} of ${data.maxSteps})`;
          next.steps.push({ kind: 'think', label: `Step ${data.step} - model deciding`, running: true });
          break;
        case 'thought':
          closeLast('think', { ms: data.ms, ok: true });
          break;
        case 'tool_start':
          next.detail = `Running ${data.tool}`;
          next.steps.push({ kind: 'tool', label: data.tool, args: data.args, running: true });
          break;
        case 'tool_end':
          closeLast('tool', { ms: data.ms, ok: data.ok });
          break;
        case 'answer':
          next.detail = 'Writing the answer';
          break;
        case 'heartbeat':
          break;
        default:
          break;
      }
      return next;
    });
  }

  async function ask(text) {
    const message = (text ?? q).trim();
    if (!message || busy) return;

    setQ('');
    setError('');
    setBusy(true);
    setRun({ startedAt: Date.now(), lastEventAt: Date.now(), detail: 'Contacting the agent', steps: [] });

    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((m) => [...m, { role: 'user', content: message }]);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch('/api/ask/stream', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ message, history }),
        signal: ctrl.signal,
      });

      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message || `Request failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let settled = false;

      // SSE frames are separated by a blank line. Anything after the last
      // separator is a partial frame and waits for the next chunk.
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';

        for (const frame of frames) {
          let event = 'message';
          const dataLines = [];
          for (const line of frame.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
          }
          if (!dataLines.length) continue;

          let data;
          try { data = JSON.parse(dataLines.join('\n')); } catch { continue; }

          if (event === 'done') {
            settled = true;
            setMessages((m) => [...m, {
              role: 'assistant',
              content: data.answer,
              trace: data.trace,
              elapsedMs: data.elapsedMs,
              model: data.model,
            }]);
          } else if (event === 'error') {
            settled = true;
            setError(data.message || 'The agent failed');
          } else if (event === 'cancelled') {
            settled = true;
            setError(`Stopped after ${fmtMs(data.elapsedMs || 0)}.`);
          } else {
            applyEvent(event, data);
          }
        }
      }

      if (!settled) {
        throw new Error('The connection closed before the agent answered.');
      }
    } catch (err) {
      if (err.name === 'AbortError') setError('Stopped.');
      else setError(err.message);
    } finally {
      abortRef.current = null;
      setBusy(false);
      setRun(null);
    }
  }

  if (!token) {
    return (
      <div className="wrap" style={{ maxWidth: 380, marginTop: '12vh' }}>
        <h1>Address Assistant</h1>
        <p className="muted">Sign in — the assistant acts with your permissions, nothing more.</p>
        <div className="panel">
          <form onSubmit={login}>
            <div style={{ marginBottom: 12 }}>
              <label htmlFor="u">Username</label>
              <input id="u" value={username} onChange={(e) => setUsername(e.target.value)} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label htmlFor="p">Password</label>
              <input id="p" type="password" value={password}
                onChange={(e) => setPassword(e.target.value)} />
            </div>
            {error && <div className="error" style={{ marginBottom: 10 }}>{error}</div>}
            <button className="primary" type="submit" disabled={!password}>Sign in</button>
          </form>
        </div>
        <p className="muted" style={{ fontSize: 12 }}>
          Try <code>viewer/viewer123</code> (read only), <code>editor/editor123</code>,
          or <code>admin/admin123</code>.
        </p>
      </div>
    );
  }

  const elapsed = run ? now - run.startedAt : 0;
  const silentFor = run ? now - run.lastEventAt : 0;
  const stalled = run && silentFor > STALL_AFTER_MS;

  return (
    <div className="wrap">
      <div className="row" style={{ marginBottom: 18 }}>
        <div style={{ flex: 1 }}>
          <h1>Address Assistant</h1>
          <span className="muted">
            Search is the only control here — creating, updating, deleting and reseeding
            all happen through the AI.
          </span>
        </div>
        <span className="chip">{user?.username} · {user?.role}</span>
        <button onClick={logout}>Sign out</button>
      </div>

      <div className="panel">
        <form onSubmit={(e) => { e.preventDefault(); ask(); }}>
          <div className="row">
            <input
              placeholder="Ask anything — “find everyone in Denver”, “delete CUST-000412”…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              disabled={busy}
            />
            <button className="primary" type="submit" disabled={busy || !q.trim()}>
              {busy ? 'Thinking…' : 'Ask'}
            </button>
          </div>
        </form>
        <div className="suggestions">
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => ask(s)} disabled={busy}>{s}</button>
          ))}
        </div>
        {error && <div className="error" style={{ marginTop: 10 }}>{error}</div>}
      </div>

      {messages.map((m, i) => (
        <div key={i} className={`msg ${m.role}`}>
          {m.content}
          {m.trace?.length > 0 && (
            <details className="trace">
              <summary>
                {m.trace.length} tool call{m.trace.length === 1 ? '' : 's'} ·{' '}
                {(m.elapsedMs / 1000).toFixed(1)}s · {m.model}
              </summary>
              {m.trace.map((t, j) => (
                <div key={j} style={{ marginTop: 8 }}>
                  <span className={`chip ${t.ok ? 'ok' : 'bad'}`}>{t.tool}</span>
                  <pre>{JSON.stringify(t.args, null, 2)}{'\n---\n'}{t.output}</pre>
                </div>
              ))}
            </details>
          )}
        </div>
      ))}

      {run && (
        <div className="msg assistant progress">
          <div className="row">
            <span className={`pulse ${stalled ? 'stalled' : ''}`} />
            <strong style={{ flex: 1 }}>{run.detail}</strong>
            <span className="muted mono">{fmtMs(elapsed)}</span>
            <button onClick={stop}>Stop</button>
          </div>

          {run.steps.length > 0 && (
            <div className="steps">
              {run.steps.map((s, i) => (
                <div key={i} className="step">
                  <span className={`chip ${s.running ? '' : s.ok ? 'ok' : 'bad'}`}>
                    {s.running ? '…' : s.ok ? '✓' : '✕'} {s.label}
                  </span>
                  {s.ms != null && <span className="muted mono">{fmtMs(s.ms)}</span>}
                </div>
              ))}
            </div>
          )}

          <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            {stalled ? (
              <span className="error">
                No signal from the server for {fmtMs(silentFor)}. The heartbeat should
                arrive every 10s, so the backend or Ollama is likely stuck — Stop and retry,
                then check <code>docker compose logs -f mcp-client ollama</code>.
              </span>
            ) : (
              <>Heartbeat healthy{run.model ? ` · ${run.model}` : ''}. A 7B model on CPU
                commonly takes 30–90s per step.</>
            )}
          </div>
        </div>
      )}

      <div ref={bottom} />

      {tools.length > 0 && (
        <details className="panel" style={{ marginTop: 24 }}>
          <summary className="muted">{tools.length} MCP tools available to this session</summary>
          <div style={{ marginTop: 10 }}>
            {tools.map((t) => <span key={t.name} className="chip">{t.name}</span>)}
          </div>
        </details>
      )}
    </div>
  );
}
