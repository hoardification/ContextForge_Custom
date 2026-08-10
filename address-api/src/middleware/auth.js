import jwt from 'jsonwebtoken';
import { ApiError } from './errors.js';

export const ROLES = ['read', 'readwrite', 'admin'];
const RANK = { read: 1, readwrite: 2, admin: 3 };

const MIN_SECRET_LENGTH = 32;
let warned = false;

/**
 * The signing key, read from the environment - never from source.
 *
 * There is deliberately no fallback. A default signing key in a public
 * repository is not a default, it is a published private key: anyone who can
 * read the source can mint a valid admin token. Failing to start is the safer
 * outcome, and the message says exactly what to do about it.
 *
 * Resolved lazily so importing this module never depends on load order.
 */
function secret() {
  const value = process.env.JWT_SECRET;

  if (!value) {
    throw new Error(
      'JWT_SECRET is not set. Copy .env.example to .env and set it, or generate ' +
      'one with: openssl rand -hex 32',
    );
  }

  if (value.length < MIN_SECRET_LENGTH && !warned) {
    warned = true;
    console.warn(
      `[auth] JWT_SECRET is ${value.length} characters; ${MIN_SECRET_LENGTH} or more is ` +
      'recommended for HS256.',
    );
  }

  return value;
}

/**
 * Scope carried by the token handed to an account that must change its
 * password. It is a deliberate downgrade: the role claim still says `admin`,
 * but `requireAuth` refuses the token everywhere except the change-password
 * route, so the role never gets a chance to matter.
 */
export const PASSWORD_CHANGE_SCOPE = 'password_change';

export function signToken(user, { scope } = {}) {
  return jwt.sign(
    {
      sub: String(user.id),
      username: user.username,
      role: user.role,
      ...(scope ? { scope } : {}),
    },
    secret(),
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' },
  );
}

export function verifyToken(token) {
  return jwt.verify(token, secret());
}

/** Decode and attach req.user. Shared by both gates below; not exported. */
function attachUser(req, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next(new ApiError(401, 'UNAUTHENTICATED', 'Missing Bearer token'));
  }
  try {
    const claims = verifyToken(token);
    req.user = {
      id: Number(claims.sub),
      username: claims.username,
      role: claims.role,
      scope: claims.scope || null,
    };
    return next();
  } catch (err) {
    const msg = err.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token';
    return next(new ApiError(401, 'UNAUTHENTICATED', msg));
  }
}

/**
 * Attaches req.user, or throws 401.
 *
 * Also the single choke point that makes the password-change lock real. A
 * scoped token is refused here, so a route added later is protected without
 * its author having to know this feature exists - the safe direction to fail.
 */
export function requireAuth(req, _res, next) {
  return attachUser(req, (err) => {
    if (err) return next(err);
    if (req.user.scope === PASSWORD_CHANGE_SCOPE) {
      return next(new ApiError(403, 'PASSWORD_CHANGE_REQUIRED',
        'This account is still using a password published in the project source. ' +
        'Set a new one with POST /api/auth/change-password before using the API.'));
    }
    return next();
  });
}

/**
 * The one gate that accepts a password-change token, for the route whose whole
 * job is to clear the lock. Full tokens are accepted too, so anyone may change
 * their own password at any time.
 */
export function requireAuthForPasswordChange(req, _res, next) {
  return attachUser(req, next);
}

/**
 * Role gate. `requireRole('readwrite')` allows readwrite and admin.
 * This is the single source of truth for authorization — the UI and MCP
 * server duplicate these checks only for UX, never for security.
 */
export function requireRole(minRole) {
  const needed = RANK[minRole];
  return (req, _res, next) => {
    if (!req.user) return next(new ApiError(401, 'UNAUTHENTICATED', 'Not authenticated'));
    if ((RANK[req.user.role] || 0) < needed) {
      return next(new ApiError(403, 'FORBIDDEN', `Requires role '${minRole}' or higher`));
    }
    return next();
  };
}

export function hasRole(role, minRole) {
  return (RANK[role] || 0) >= RANK[minRole];
}
