import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const MCP_URL = process.env.MCP_SERVER_URL || 'http://localhost:4100/mcp';

// A tool call is a database query behind an HTTP hop; if it has not answered in
// this long, something is wrong and waiting forever only looks like a hang.
const TOOL_TIMEOUT_MS = Number(process.env.MCP_TOOL_TIMEOUT_MS || 60000);

/**
 * Open an MCP session against the address-book server, carrying the end user's
 * JWT so the agent inherits exactly that user's permissions — no more.
 * @param {string} jwt
 */
export async function connectMcp(jwt) {
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    requestInit: { headers: jwt ? { authorization: `Bearer ${jwt}` } : {} },
  });

  const client = new Client(
    { name: 'address-mcp-client', version: '1.0.0' },
    { capabilities: {} },
  );

  await client.connect(transport);
  return { client, transport };
}

/** Convert MCP tool definitions into the JSON-schema shape Ollama expects. */
export async function listOllamaTools(client) {
  const { tools } = await client.listTools();
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description || t.title || t.name,
      parameters: t.inputSchema || { type: 'object', properties: {} },
    },
  }));
}

/**
 * Call a tool and flatten the result into text the model can read.
 *
 * @param {{ signal?: AbortSignal }} [opts] caller's cancellation signal
 */
export async function callTool(client, name, args, { signal } = {}) {
  const res = await client.callTool(
    { name, arguments: args || {} },
    undefined,
    { signal, timeout: TOOL_TIMEOUT_MS },
  );

  const text = (res.content || [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n');

  return {
    isError: Boolean(res.isError),
    text: text || JSON.stringify(res.structuredContent ?? res, null, 2),
    structured: res.structuredContent,
  };
}

export { MCP_URL, TOOL_TIMEOUT_MS };
