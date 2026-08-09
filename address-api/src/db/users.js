import bcrypt from 'bcryptjs';
import { query } from './index.js';

const SAFE = 'id, username, role, created_at, updated_at';

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
    `SELECT id, username, role, password_hash FROM users WHERE lower(username) = lower($1)`,
    [username],
  );
  return res.rows[0] || null;
}

export async function createUser({ username, password, role }) {
  const hash = await bcrypt.hash(password, 10);
  const res = await query(
    `INSERT INTO users (username, password_hash, role) VALUES ($1,$2,$3) RETURNING ${SAFE}`,
    [username, hash, role],
  );
  return res.rows[0];
}

export async function updateUser(id, { username, password, role }) {
  const sets = [];
  const params = [];

  if (username !== undefined) { params.push(username); sets.push(`username = $${params.length}`); }
  if (role !== undefined) { params.push(role); sets.push(`role = $${params.length}`); }
  if (password) {
    params.push(await bcrypt.hash(password, 10));
    sets.push(`password_hash = $${params.length}`);
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
  return true;
}
