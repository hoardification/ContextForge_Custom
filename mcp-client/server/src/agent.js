import { callTool, connectMcp, listOllamaTools } from './mcp.js';
import { chat } from './ollama.js';

const MAX_STEPS = Number(process.env.AGENT_MAX_STEPS || 6);

// Ceiling for a whole request. Individual model calls and tool calls have their
// own, shorter bounds; this one stops a run that keeps making progress but is
// never going to finish.
const AGENT_TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MS || 600000);

const SYSTEM_PROMPT = `You are the assistant for an address book application.

You have tools that search, read, create, update and delete address records, plus
admin tools for reseeding data and managing users. Use them — never invent an
address, a phone number or a count. If you do not have the data, call a tool.

Rules:
- Answer only from tool results. If a search returns nothing, say so plainly.
- Before deleting anything or reseeding, state exactly what will be destroyed.
- If a tool returns FORBIDDEN, call whoami and tell the user which role the
  action needs and which role they currently hold. Do not retry the tool.
- Keep answers short. When you list records, use a compact list, not prose.
- One tool call at a time is fine; you will be given the result and can continue.`;

class CancelledError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CancelledError';
    this.cancelled = true;
  }
}

/**
 * Run the tool-calling loop: model → tool → model → … until it answers or we
 * hit MAX_STEPS. Returns the final text plus a trace of what was called.
 *
 * Every state change is reported through `onEvent` as it happens. The caller
 * decides what to do with that — the HTTP layer streams it to the browser so a
 * long run shows what it is doing instead of an unmoving spinner.
 *
 * @param {string} userMessage
 * @param {string} jwt end user's token — the agent inherits their permissions
 * @param {Array} history prior [{role, content}] turns
 * @param {{ onEvent?: (e: object) => void, signal?: AbortSignal }} [opts]
 */
export async function runAgent(userMessage, jwt, history = [], { onEvent, signal } = {}) {
  const startedAt = Date.now();
  const deadline = startedAt + AGENT_TIMEOUT_MS;

  // A listener must never be able to kill the run.
  const emit = (type, data = {}) => {
    if (!onEvent) return;
    try { onEvent({ type, elapsedMs: Date.now() - startedAt, ...data }); } catch { /* ignore */ }
  };

  const checkpoint = () => {
    if (signal?.aborted) throw new CancelledError('Cancelled');
    if (Date.now() > deadline) {
      throw new Error(`Gave up after ${Math.round(AGENT_TIMEOUT_MS / 1000)}s`);
    }
  };

  emit('status', { stage: 'connecting', detail: 'Opening MCP session' });
  const { client, transport } = await connectMcp(jwt);
  const trace = [];

  try {
    const tools = await listOllamaTools(client);
    emit('status', { stage: 'ready', detail: `${tools.length} tools available`, tools: tools.length });

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history.filter((m) => m.role === 'user' || m.role === 'assistant'),
      { role: 'user', content: userMessage },
    ];

    for (let step = 0; step < MAX_STEPS; step++) {
      checkpoint();

      emit('thinking', { step: step + 1, maxSteps: MAX_STEPS });
      const thoughtStart = Date.now();
      const reply = await chat(messages, tools, { signal });
      messages.push(reply);
      emit('thought', { step: step + 1, maxSteps: MAX_STEPS, ms: Date.now() - thoughtStart });

      const calls = reply.tool_calls || [];
      if (!calls.length) {
        const answer = reply.content?.trim() || '(no answer)';
        emit('answer', { answer, steps: step + 1 });
        return { answer, trace, steps: step + 1 };
      }

      for (const call of calls) {
        checkpoint();

        const name = call.function?.name;
        let args = call.function?.arguments ?? {};
        // Some models emit arguments as a JSON string rather than an object.
        if (typeof args === 'string') {
          try { args = JSON.parse(args); } catch { args = {}; }
        }

        emit('tool_start', { step: step + 1, tool: name, args });
        const toolStart = Date.now();

        let result;
        try {
          result = await callTool(client, name, args, { signal });
        } catch (err) {
          if (signal?.aborted) throw new CancelledError('Cancelled');
          result = { isError: true, text: `Tool call failed: ${err.message}` };
        }

        const ms = Date.now() - toolStart;
        const entry = { tool: name, args, ok: !result.isError, output: result.text.slice(0, 2000) };
        trace.push(entry);
        emit('tool_end', { step: step + 1, tool: name, ok: entry.ok, ms, preview: entry.output.slice(0, 240) });

        messages.push({ role: 'tool', content: result.text, name });
      }
    }

    const answer = 'I used the maximum number of tool steps without reaching an answer. ' +
      'Try asking something narrower.';
    emit('answer', { answer, steps: MAX_STEPS, truncated: true });

    return { answer, trace, steps: MAX_STEPS, truncated: true };
  } finally {
    await transport.close().catch(() => {});
    await client.close().catch(() => {});
  }
}

export { SYSTEM_PROMPT, MAX_STEPS, AGENT_TIMEOUT_MS, CancelledError };
