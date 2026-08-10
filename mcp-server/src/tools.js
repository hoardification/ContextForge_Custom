import { z } from 'zod';
import { ApiError } from './apiClient.js';

/** Uniform tool result: readable text for the model + raw JSON for the caller. */
function ok(text, data) {
  return {
    content: [{ type: 'text', text }],
    structuredContent: data === undefined ? undefined : { result: data },
  };
}

function fail(err) {
  const code = err instanceof ApiError ? err.code : 'INTERNAL';
  const hint =
    code === 'FORBIDDEN'
      ? ' (your account does not have the required role for this action)'
      : code === 'PASSWORD_CHANGE_REQUIRED'
        ? ' (call password_change first; no other tool will work until then)'
        : '';
  return {
    isError: true,
    content: [{ type: 'text', text: `Error [${code}]: ${err.message}${hint}` }],
  };
}

const wrap = (fn) => async (args) => {
  try {
    return await fn(args);
  } catch (err) {
    return fail(err);
  }
};

function formatAddress(a) {
  return `#${a.id} ${a.customer_id} — ${a.first_name} ${a.last_name}, ${a.address}, ${a.city}, ${a.state} — ${a.phone}`;
}

function formatTable(rows) {
  if (!rows.length) return 'No matching addresses.';
  return rows.map(formatAddress).join('\n');
}

const US_STATE = z.string().length(2).describe('Two-letter US state code, e.g. TX');

/**
 * Register every address-book tool on an McpServer.
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {() => import('./apiClient.js').ApiClient} getClient per-request client factory
 */
export function registerTools(server, getClient) {
  // ---------- identity ----------

  server.registerTool(
    'whoami',
    {
      title: 'Who am I',
      description:
        'Return the authenticated user and role backing these tools. Use this first if a ' +
        'write or delete fails, to explain to the user what permissions they have. Requires `read`.',
      inputSchema: {},
    },
    wrap(async () => {
      const user = await getClient().whoami();
      return ok(`Authenticated as ${user.username} with role '${user.role}'.`, user);
    }),
  );

  server.registerTool(
    'password_change',
    {
      title: 'Change your password',
      description:
        'Replace the password of the account these tools run as. An account still holding a ' +
        'password published in the project source can call nothing else until this succeeds, ' +
        'so run it first if every other tool reports PASSWORD_CHANGE_REQUIRED. Any role; it ' +
        'only ever affects the calling account.',
      inputSchema: {
        currentPassword: z.string().min(1).describe('The password currently in use'),
        newPassword: z
          .string()
          .min(1)
          .describe(
            'At least 12 characters, and not one of the demo passwords published in this ' +
            'repository. The API rejects both, so ask the user for a real one rather than ' +
            'inventing a variation on the old password.',
          ),
      },
    },
    wrap(async ({ currentPassword, newPassword }) => {
      const res = await getClient().request('/api/auth/change-password', {
        method: 'POST',
        body: { currentPassword, newPassword },
      });
      // Deliberately drops res.token. Echoing a bearer token into tool output
      // would write a live credential into the model's context and the chat
      // transcript; the client already holds it.
      const data = { user: res.user, mustChangePassword: res.mustChangePassword };
      return ok(
        `Password changed for ${res.user.username}. The account is no longer restricted; ` +
        'existing tokens issued before this change are still valid until they expire.',
        data,
      );
    }),
  );

  // ---------- read ----------

  server.registerTool(
    'address_search',
    {
      title: 'Search addresses',
      description:
        'Search the address book by free text across first name, last name, street, city, ' +
        'state, phone and customer id. Optionally filter by city or state. Requires `read`.',
      inputSchema: {
        query: z.string().default('').describe('Free-text search; empty returns everything'),
        city: z.string().optional().describe('Exact city filter, case-insensitive'),
        state: US_STATE.optional(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(200).default(25),
        sort: z
          .enum(['id', 'customer_id', 'first_name', 'last_name', 'city', 'state', 'created_at'])
          .default('last_name'),
        dir: z.enum(['asc', 'desc']).default('asc'),
      },
    },
    wrap(async ({ query, city, state, page, pageSize, sort, dir }) => {
      const res = await getClient().request('/api/addresses', {
        params: { q: query, city, state, page, pageSize, sort, dir },
      });
      const shown = res.data.length;
      return ok(
        `${res.total} match(es); showing ${shown} (page ${res.page}).\n${formatTable(res.data)}`,
        res,
      );
    }),
  );

  server.registerTool(
    'address_list_all',
    {
      title: 'List all addresses',
      description:
        'Return every address in the book, paged. Prefer address_search when the user is ' +
        'looking for something specific — this can be large. Requires `read`.',
      inputSchema: {
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(200).default(100),
      },
    },
    wrap(async ({ page, pageSize }) => {
      const res = await getClient().request('/api/addresses', {
        params: { page, pageSize, sort: 'id', dir: 'asc' },
      });
      return ok(`${res.total} total addresses (page ${res.page}).\n${formatTable(res.data)}`, res);
    }),
  );

  server.registerTool(
    'address_get',
    {
      title: 'Get one address',
      description:
        'Fetch a single address by its numeric id or by customer id. Requires `read`.',
      inputSchema: {
        id: z.number().int().optional().describe('Numeric address id'),
        customer_id: z.string().optional().describe('Customer id, e.g. CUST-004821'),
      },
    },
    wrap(async ({ id, customer_id: customerId }) => {
      if (!id && !customerId) throw new ApiError(400, 'VALIDATION', 'Provide id or customer_id');
      const path = id ? `/api/addresses/${id}` : `/api/addresses/by-customer/${encodeURIComponent(customerId)}`;
      const row = await getClient().request(path);
      return ok(formatAddress(row), row);
    }),
  );

  server.registerTool(
    'address_stats',
    {
      title: 'Address statistics',
      description: 'Total address count and the top states by record count. Requires `read`.',
      inputSchema: {},
    },
    wrap(async () => {
      const res = await getClient().request('/api/addresses/stats');
      const top = res.byState.map((s) => `${s.state}: ${s.count}`).join(', ');
      return ok(`${res.total} addresses. Top states — ${top}`, res);
    }),
  );

  // ---------- write ----------

  server.registerTool(
    'address_create',
    {
      title: 'Create an address',
      description:
        'Add a new address. customer_id must be unique. Requires `readwrite` or higher.',
      inputSchema: {
        customer_id: z.string().min(1).describe('Unique customer identifier'),
        first_name: z.string().min(1),
        last_name: z.string().min(1),
        address: z.string().min(1).describe('Street address'),
        city: z.string().min(1),
        state: US_STATE,
        phone: z.string().min(7),
      },
    },
    wrap(async (args) => {
      const row = await getClient().request('/api/addresses', { method: 'POST', body: args });
      return ok(`Created: ${formatAddress(row)}`, row);
    }),
  );

  server.registerTool(
    'address_update',
    {
      title: 'Update an address',
      description:
        'Update one or more fields on an existing address, identified by numeric id. ' +
        'Only supplied fields change. Requires `readwrite` or higher.',
      inputSchema: {
        id: z.number().int().describe('Numeric address id to update'),
        customer_id: z.string().optional(),
        first_name: z.string().optional(),
        last_name: z.string().optional(),
        address: z.string().optional(),
        city: z.string().optional(),
        state: US_STATE.optional(),
        phone: z.string().optional(),
      },
    },
    wrap(async ({ id, ...patch }) => {
      const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
      if (!Object.keys(clean).length) {
        throw new ApiError(400, 'VALIDATION', 'Supply at least one field to update');
      }
      const row = await getClient().request(`/api/addresses/${id}`, { method: 'PUT', body: clean });
      return ok(`Updated ${Object.keys(clean).join(', ')} → ${formatAddress(row)}`, row);
    }),
  );

  // ---------- delete / admin ----------

  server.registerTool(
    'address_delete',
    {
      title: 'Delete an address',
      description:
        'Permanently delete an address by numeric id. Destructive — confirm with the user ' +
        'first. Requires `admin`.',
      inputSchema: { id: z.number().int().describe('Numeric address id to delete') },
    },
    wrap(async ({ id }) => {
      const res = await getClient().request(`/api/addresses/${id}`, { method: 'DELETE' });
      return ok(`Deleted address #${id}.`, res);
    }),
  );

  server.registerTool(
    'admin_reseed',
    {
      title: 'Re-seed the address book',
      description:
        'Delete all addresses and regenerate fake records. Highly destructive — always ' +
        'confirm with the user before calling. Requires `admin`.',
      inputSchema: {
        count: z.number().int().min(1).max(5000).default(100).describe('How many rows to generate'),
      },
    },
    wrap(async ({ count }) => {
      const res = await getClient().request('/api/admin/reseed', {
        method: 'POST',
        body: { count, truncate: true },
      });
      return ok(`Re-seeded. The book now holds ${res.total} addresses.`, res);
    }),
  );

  server.registerTool(
    'admin_stats',
    {
      title: 'System statistics',
      description: 'Address count, user counts by role, API uptime. Requires `admin`.',
      inputSchema: {},
    },
    wrap(async () => {
      const res = await getClient().request('/api/admin/stats');
      const roles = Object.entries(res.usersByRole).map(([r, c]) => `${c} ${r}`).join(', ');
      return ok(`${res.addresses} addresses; users — ${roles}; uptime ${res.uptimeSeconds}s`, res);
    }),
  );

  // ---------- user management ----------

  server.registerTool(
    'user_list',
    {
      title: 'List users',
      description: 'List all accounts and their roles. Requires `admin`.',
      inputSchema: {},
    },
    wrap(async () => {
      const res = await getClient().request('/api/users');
      const text = res.data.map((u) => `#${u.id} ${u.username} — ${u.role}`).join('\n');
      return ok(text || 'No users.', res.data);
    }),
  );

  server.registerTool(
    'user_create',
    {
      title: 'Create a user',
      description: 'Create an account with a role of read, readwrite or admin. Requires `admin`.',
      inputSchema: {
        username: z.string().min(3),
        password: z.string().min(6),
        role: z.enum(['read', 'readwrite', 'admin']),
      },
    },
    wrap(async (args) => {
      const user = await getClient().request('/api/users', { method: 'POST', body: args });
      return ok(`Created user ${user.username} with role '${user.role}'.`, user);
    }),
  );

  server.registerTool(
    'user_update',
    {
      title: 'Update a user',
      description:
        "Change a user's username, password or role. The last remaining admin cannot be " +
        'demoted. Requires `admin`.',
      inputSchema: {
        id: z.number().int(),
        username: z.string().min(3).optional(),
        password: z.string().min(6).optional(),
        role: z.enum(['read', 'readwrite', 'admin']).optional(),
      },
    },
    wrap(async ({ id, ...patch }) => {
      const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
      const user = await getClient().request(`/api/users/${id}`, { method: 'PUT', body: clean });
      return ok(`Updated user ${user.username} (role '${user.role}').`, user);
    }),
  );

  server.registerTool(
    'user_delete',
    {
      title: 'Delete a user',
      description:
        'Delete an account. You cannot delete yourself or the last admin. Requires `admin`.',
      inputSchema: { id: z.number().int() },
    },
    wrap(async ({ id }) => {
      const res = await getClient().request(`/api/users/${id}`, { method: 'DELETE' });
      return ok(`Deleted user #${id}.`, res);
    }),
  );
}
