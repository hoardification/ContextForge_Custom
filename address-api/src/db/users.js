import bcrypt from 'bcryptjs';
import { query } from './index.js';
import { isPublicPassword } from '../publicPasswords.js';

const SAFE = 'id, username, role, must_change_password, created_at, updated_at';

export async function listUsers() {
  const res = await query(`SELECT ${SAFE} FROM users ORDER BY username ASC`);
  return res.rows;
}

export async function getUser(id) {
  const res = await query(`SELECT ${SAFE} FROM users WHERE id = $1`, [id]);
  return res.rows[0] || null;
}

/** Includes the hash — only for the login path. Never return this to a client. */
export async function getUserByUsernameWithHash(username) {
  const res = await query(
    `SELECT id, username, role, password_hash, must_change_password
       FROM users WHERE lower(username) = lower($1)`,
    [username],
  );
  return res.rows[0] || null;
}

export async function createUser({ username, password, role }) {
  const hash = await bcrypt.hash(password, 10);
  // Seeding with a published password creates an account that is locked to a
  // password change from its very first login.
  const res = await query(
    `INSERT INTO users (username, password_hash, role, must_change_password)
     VALUES ($1,$2,$3,$4) RETURNING ${SAFE}`,
    [username, hash, role, isPublicPassword(password)],
  );
  return res.rows[0];
}

/** Flip the lock without touching the password. Used by the login path. */
export async function setMustChangePassword(id, value) {
  await query(
    'UPDATE users SET must_change_password = $1, updated_at = now() WHERE id = $2',
    [Boolean(value), id],
  );
}

/**
 * Replace a password and clear the lock in one statement, so an interrupted
 * change can never leave an account with a new password and a stale lock.
 */
export async function changePassword(id, newPassword) {
  const hash = await bcrypt.hash(newPassword, 10);
  const res = await query(
    `UPDATE users
        SET password_hash = $1, must_change_password = false, updated_at = now()
      WHERE id = $2 RETURNING ${SAFE}`,
    [hash, id],
  );
  return res.rows[0] || null;
}

export async function updateUser(id, { username, password, role }) {
  const sets = [];
  const params = [];

  if (username !== undefined) { params.push(username); sets.push(`username = $${params.length}`); }
  if (role !== undefined) { params.push(role); sets.push(`role = $${params.length}`); }
  if (password) {
    params.push(await bcrypt.hash(password, 10));
    sets.push(`password_hash = $${params.length}`);
    // An admin handing out a published password re-locks the account, rather
    // than quietly reintroducing the credential this control exists to remove.
    params.push(isPublicPassword(password));
    sets.push(`must_change_password = $${params.length}`);
  }
  if (!sets.length) return getUser(id);

  sets.push('updated_at = now()');
  params.push(id);

  const res = await query(
    `UPDATE users SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING ${SAFE}`,
    params,
  );
  return res.rows[0] || null;
}

export async function deleteUser(id) {
  const res = await query('DELETE FROM users WHERE id = $1 RETURNING id', [id]);
  return res.rowCount > 0;
}

export async function countAdmins() {
  const res = await query(`SELECT count(*)::int AS total FROM users WHERE role = 'admin'`);
  return res.rows[0].total;
}

export function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

/** Create the bootstrap admin + demo accounts if the table is empty. */
export async function ensureBootstrapUsers() {
  const res = await query('SELECT count(*)::int AS total FROM users');
  if (res.rows[0].total > 0) return false;

  const admin = process.env.ADMIN_USERNAME || 'admin';
  const pass = process.env.ADMIN_PASSWORD || 'admin123';

  // Seeded fixtures, so these keep a published fallback rather than refusing to
  // start. VIEWER_PASSWORD is the one with a second consumer: the MCP server
  // signs in as `viewer` over stdio, so MCP_PASSWORD has to be changed with it
  // or every tool call returns 401. docker-stack/check-env.ps1 warns on drift.
  const editorPass = process.env.EDITOR_PASSWORD || 'editor123';
  const viewerPass = process.env.VIEWER_PASSWORD || 'viewer123';

  await createUser({ username: admin, password: pass, role: 'admin' });
  await createUser({ username: 'editor', password: editorPass, role: 'readwrite' });
  await createUser({ username: 'viewer', password: viewerPass, role: 'read' });

  console.log(`[db] bootstrap users created (${admin}/admin, editor/readwrite, viewer/read)`);
  const locked = (await query(
    'SELECT count(*)::int AS total FROM users WHERE must_change_password',
  )).rows[0].total;
  if (locked > 0) {
    console.warn(
      `[db] ${locked} of them still hold a password published in this repository ` +
      'and must be changed at first login. Set ADMIN_PASSWORD / EDITOR_PASSWORD / ' +
      'VIEWER_PASSWORD in .env to avoid this.',
    );
  }
  return true;
}
