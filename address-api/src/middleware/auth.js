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

export function signToken(user) {
  return jwt.sign(
    { sub: String(user.id), username: user.username, role: user.role },
    secret(),
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' },
  );
}

export function verifyToken(token) {
  return jwt.verify(token, secret());
}

/** Attaches req.user, or throws 401. */
export function requireAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next(new ApiError(401, 'UNAUTHENTICATED', 'Missing Bearer token'));
  }
  try {
    const claims = verifyToken(token);
    req.user = { id: Number(claims.sub), username: claims.username, role: claims.role };
    return next();
  } catch (err) {
    const msg = err.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token';
    return next(new ApiError(401, 'UNAUTHENTICATED', msg));
  }
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
