const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:7b-instruct';

// A 7B model on CPU is slow, not broken: the first call after an idle period
// also pays to load the model back into memory. This bound exists to tell a
// slow call apart from a dead one, so it is generous on purpose.
const TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS || 180000);

/**
 * One turn of Ollama's /api/chat with tool definitions attached.
 * Returns the assistant message, which may contain `tool_calls`.
 *
 * @param {Array} messages
 * @param {Array} tools
 * @param {{ signal?: AbortSignal }} [opts] caller's cancellation signal
 */
export async function chat(messages, tools, { signal } = {}) {
  const ctrl = new AbortController();
  const forward = () => ctrl.abort(signal.reason ?? new Error('cancelled'));

  if (signal) {
    if (signal.aborted) forward();
    else signal.addEventListener('abort', forward, { once: true });
  }

  const timer = setTimeout(
    () => ctrl.abort(new Error(`Ollama did not respond within ${Math.round(TIMEOUT_MS / 1000)}s`)),
    TIMEOUT_MS,
  );

  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: MODEL,
        messages,
        tools,
        stream: false,
        options: {
          temperature: 0.1,     // tool selection wants determinism, not flair
          num_ctx: 8192,
        },
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Ollama ${res.status}: ${detail.slice(0, 400)}`);
    }

    const body = await res.json();
    return body.message;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forward);
  }
}

/** Is the model present and the daemon reachable? */
export async function health() {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const body = await res.json();
    const models = (body.models || []).map((m) => m.name);
    return {
      ok: true,
      model: MODEL,
      modelPulled: models.some((m) => m === MODEL || m.startsWith(`${MODEL.split(':')[0]}:`)),
      models,
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export { MODEL, OLLAMA_URL, TIMEOUT_MS as OLLAMA_TIMEOUT_MS };
