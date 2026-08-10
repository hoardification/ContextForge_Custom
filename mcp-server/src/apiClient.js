/**
 * Thin authenticated client for address-api.
 *
 * The MCP server holds no privileged god-token. It carries whatever identity
 * the caller supplied — either a forwarded JWT (HTTP transport) or a service
 * account it logs in as from env (stdio transport, e.g. Claude Desktop).
 */

const API_BASE = process.env.API_BASE_URL || 'http://localhost:4000';

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export class ApiClient {
  /** @param {{token?: string, username?: string, password?: string}} opts */
  constructor({ token, username, password } = {}) {
    this.token = token || null;
    this.username = username || process.env.MCP_USERNAME || null;
    this.password = password || process.env.MCP_PASSWORD || null;
    this.user = null;
  }

  /** Log in with the service account if we weren't handed a token. */
  async ensureToken() {
    if (this.token) return this.token;
    if (!this.username || !this.password) {
      throw new ApiError(401, 'UNAUTHENTICATED',
        'No JWT supplied and no MCP_USERNAME/MCP_PASSWORD configured');
    }
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: this.username, password: this.password }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new ApiError(res.status, body?.error?.code || 'UNAUTHENTICATED',
        body?.error?.message || 'Login failed');
    }
    // Login succeeded but the account is locked to a password change. The
    // token it returned is scoped and would 403 on every tool call, so say
    // what is actually wrong instead of letting that surface as an auth error.
    // A service account cannot complete an interactive change - the fix is in
    // .env, not here.
    if (body.mustChangePassword) {
      throw new ApiError(403, 'PASSWORD_CHANGE_REQUIRED',
        `The '${this.username}' service account is still using a password published in ` +
        'this project\'s source, so it cannot be used. Set VIEWER_PASSWORD in .env with ' +
        'MCP_PASSWORD to match, recreate address-api and mcp-server, and retry. On an ' +
        'existing database also change the account itself - the seed only applies to an ' +
        'empty users table.');
    }

    this.token = body.token;
    this.user = body.user;
    return this.token;
  }

  async request(path, { method = 'GET', body, params, retryOnExpiry = true } = {}) {
    await this.ensureToken();

    const url = new URL(`${API_BASE}${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
      }
    }

    const res = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const payload = await res.json().catch(() => ({}));

    // A service-account token can outlive its 8h window; log back in once.
    if (res.status === 401 && retryOnExpiry && this.username && this.password) {
      this.token = null;
      return this.request(path, { method, body, params, retryOnExpiry: false });
    }
    if (!res.ok) {
      throw new ApiError(res.status, payload?.error?.code || 'INTERNAL',
        payload?.error?.message || `Request failed (${res.status})`);
    }
    return payload;
  }

  async whoami() {
    const res = await this.request('/api/auth/me');
    this.user = res.user;
    return res.user;
  }
}

export { API_BASE };
