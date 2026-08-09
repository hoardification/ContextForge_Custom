import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ApiClient } from './apiClient.js';
import { registerTools } from './tools.js';

/**
 * Build an MCP server bound to one identity.
 * @param {{token?: string, username?: string, password?: string}} auth
 */
export function createServer(auth = {}) {
  const server = new McpServer(
    { name: 'address-book', version: '1.0.0' },
    {
      capabilities: { tools: {} },
      instructions: [
        'You are connected to an address book with full CRUD, search and admin tooling.',
        'Authorization is enforced by the backing REST API, not by you: a `read` user can',
        'only search, `readwrite` can also create and update, and only `admin` can delete,',
        'reseed or manage users. If a tool returns FORBIDDEN, call `whoami` and explain to',
        'the user which role they would need. Always confirm with the user before calling',
        'address_delete, user_delete or admin_reseed.',
      ].join(' '),
    },
  );

  const client = new ApiClient(auth);
  registerTools(server, () => client);

  return server;
}
