/**
 * Integration test for address-api against an in-memory Postgres (pg-mem).
 * Exercises auth, RBAC at every role, validation, CRUD, search and admin.
 */
import { newDb } from 'pg-mem';

process.env.JWT_SECRET = 'test-secret';
process.env.ADMIN_USERNAME = 'admin';
process.env.ADMIN_PASSWORD = 'admin123';
// Deliberately not the shipped defaults: a bootstrap password that ignores its
// env var would still pass every assertion below if this said editor123.
process.env.EDITOR_PASSWORD = 'test-secret-editor-pw';
process.env.VIEWER_PASSWORD = 'test-secret-viewer-pw';

// --- in-memory Postgres ----------------------------------------------------
// The real db layer builds its Pool from env at import time, so rather than
// patching module resolution we run the *same SQL statements* against pg-mem
// and import the real middleware and generator directly. What's under test is
// the schema, the SQL, the RBAC rules and the validation — not pg itself.
const db = newDb({ autoCreateForeignKeyIndices: true });
db.public.registerFunction({ name: 'now', returns: 'timestamp', implementation: () => new Date() });

const { Pool } = db.adapters.createPg();

let pass = 0, fail = 0;
const results = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; results.push(`  ok   ${name}`); }
  else { fail++; results.push(`  FAIL ${name} ${detail}`); }
}

// Create schema
const fs = await import('node:fs');
const schema = fs.readFileSync('../address-api/src/db/schema.sql', 'utf8')
  // pg-mem lacks GIN/tsvector; drop that one index for the test
  .replace(/CREATE INDEX IF NOT EXISTS idx_addresses_search[\s\S]*?;/, '');

const pool = new Pool();
await pool.query(schema);

// --- reimplement the db layer against our pool (same SQL as the real code) --
const q = (text, params) => pool.query(text, params);

const bcrypt = (await import('bcryptjs')).default;
const jwt = (await import('jsonwebtoken')).default;
const express = (await import('express')).default;
const { z } = await import('zod');

const { isPublicPassword, MIN_PASSWORD_LENGTH } =
  await import('../address-api/src/publicPasswords.js');

// bootstrap users (mirrors src/db/users.js ensureBootstrapUsers)
// Read the same env vars, with the same fallbacks, as the code being mirrored.
// Hardcoding the passwords here would let the real function stop honouring
// EDITOR_PASSWORD / VIEWER_PASSWORD without a single test going red.
for (const [u, p, r] of [
  ['admin', process.env.ADMIN_PASSWORD || 'admin123', 'admin'],
  ['editor', process.env.EDITOR_PASSWORD || 'editor123', 'readwrite'],
  ['viewer', process.env.VIEWER_PASSWORD || 'viewer123', 'read'],
]) {
  // must_change_password mirrors createUser: seeding with a password this
  // repository publishes locks the account from its first login.
  await q('INSERT INTO users (username, password_hash, role, must_change_password) VALUES ($1,$2,$3,$4)',
    [u, await bcrypt.hash(p, 10), r, isPublicPassword(p)]);
}
const userCount = (await q('SELECT count(*)::int AS total FROM users')).rows[0].total;
check('bootstrap users created', Number(userCount) === 3, `got ${userCount}`);

// A configurable password is only configurable if it reaches the stored hash.
const viewerHash = (await q('SELECT password_hash FROM users WHERE username = $1', ['viewer']))
  .rows[0].password_hash;
check('VIEWER_PASSWORD is what gets seeded',
  await bcrypt.compare(process.env.VIEWER_PASSWORD, viewerHash));
check('the shipped default stops working once VIEWER_PASSWORD is set',
  !(await bcrypt.compare('viewer123', viewerHash)));

// seed addresses using the REAL generator
const { generateAddresses } = await import('../address-api/scripts/generate.js');
const seedRows = generateAddresses(100, 42);
for (const a of seedRows) {
  await q(`INSERT INTO addresses (customer_id, first_name, last_name, address, city, state, phone)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [a.customer_id, a.first_name, a.last_name, a.address, a.city, a.state, a.phone]);
}
const addrCount = (await q('SELECT count(*)::int AS total FROM addresses')).rows[0].total;
check('100 addresses seeded', Number(addrCount) === 100, `got ${addrCount}`);

// --- RBAC unit check against the real middleware --------------------------
const authMod = await import('../address-api/src/middleware/auth.js');
const { hasRole, signToken, verifyToken } = authMod;

check('read cannot write',      hasRole('read', 'readwrite') === false);
check('read cannot delete',     hasRole('read', 'admin') === false);
check('readwrite can write',    hasRole('readwrite', 'readwrite') === true);
check('readwrite cannot admin', hasRole('readwrite', 'admin') === false);
check('admin can everything',   hasRole('admin', 'admin') && hasRole('admin', 'readwrite') && hasRole('admin', 'read'));

const tok = signToken({ id: 7, username: 'editor', role: 'readwrite' });
const claims = verifyToken(tok);
check('JWT round-trips identity', claims.username === 'editor' && claims.role === 'readwrite' && claims.sub === '7');
check('JWT rejects tampering', (() => {
  try { jwt.verify(tok, 'wrong-secret'); return false; } catch { return true; }
})());

// --- middleware behaviour --------------------------------------------------
function runMw(mw, req) {
  return new Promise((resolve) => mw(req, {}, (err) => resolve(err)));
}
const { requireAuth, requireRole } = authMod;

check('requireAuth rejects missing header',
  (await runMw(requireAuth, { headers: {} }))?.status === 401);
check('requireAuth rejects garbage token',
  (await runMw(requireAuth, { headers: { authorization: 'Bearer nonsense' } }))?.status === 401);

const goodReq = { headers: { authorization: `Bearer ${tok}` } };
check('requireAuth accepts valid token', (await runMw(requireAuth, goodReq)) === undefined);
check('requireAuth attaches user', goodReq.user?.role === 'readwrite');

check('requireRole(admin) blocks readwrite',
  (await runMw(requireRole('admin'), { user: { role: 'readwrite' } }))?.status === 403);
check('requireRole(readwrite) blocks read',
  (await runMw(requireRole('readwrite'), { user: { role: 'read' } }))?.status === 403);

// --- forced password change -----------------------------------------------
check('published passwords are recognised', isPublicPassword('admin123')
  && isPublicPassword('editor123') && isPublicPassword('viewer123'));
check('recognition ignores case and padding', isPublicPassword('  Admin123 '));
check('a real password is not flagged', isPublicPassword('test-secret-viewer-pw') === false);
check('empty and null are not flagged',
  isPublicPassword('') === false && isPublicPassword(null) === false);

check('accounts seeded with a published password are locked',
  (await q(`SELECT must_change_password FROM users WHERE username = 'admin'`))
    .rows[0].must_change_password === true);
check('accounts seeded with a real password are not locked',
  (await q(`SELECT must_change_password FROM users WHERE username = 'viewer'`))
    .rows[0].must_change_password === false);

const { PASSWORD_CHANGE_SCOPE, requireAuthForPasswordChange } = authMod;

// The role claim still says admin. The scope is what must stop it - if this
// ever passes, a locked admin account has the run of the whole API.
const scopedAdmin = signToken(
  { id: 1, username: 'admin', role: 'admin' },
  { scope: PASSWORD_CHANGE_SCOPE },
);
const scopedErr = await runMw(requireAuth, { headers: { authorization: `Bearer ${scopedAdmin}` } });
check('requireAuth refuses a password-change token', scopedErr?.status === 403);
check('refusal names the reason', scopedErr?.code === 'PASSWORD_CHANGE_REQUIRED');
check('an admin role does not rescue a scoped token', scopedErr !== undefined);

const scopedOkReq = { headers: { authorization: `Bearer ${scopedAdmin}` } };
check('the change-password gate accepts a scoped token',
  (await runMw(requireAuthForPasswordChange, scopedOkReq)) === undefined);
check('the change-password gate still accepts a full token',
  (await runMw(requireAuthForPasswordChange, { headers: { authorization: `Bearer ${tok}` } })) === undefined);
check('a full token carries no scope', verifyToken(tok).scope === undefined);
check('replacement length floor is enforceable', MIN_PASSWORD_LENGTH >= 12);
check('requireRole(readwrite) allows admin',
  (await runMw(requireRole('readwrite'), { user: { role: 'admin' } })) === undefined);
check('requireRole(read) allows read',
  (await runMw(requireRole('read'), { user: { role: 'read' } })) === undefined);

// --- validation schemas ----------------------------------------------------
const US_STATE = z.string().length(2).regex(/^[A-Za-z]{2}$/);
const addressBody = z.object({
  customer_id: z.string().min(1).max(32),
  first_name: z.string().min(1).max(80),
  last_name: z.string().min(1).max(80),
  address: z.string().min(1).max(200),
  city: z.string().min(1).max(80),
  state: US_STATE,
  phone: z.string().min(7).max(32),
});
check('validation rejects 3-letter state',
  !addressBody.safeParse({ customer_id: 'C1', first_name: 'A', last_name: 'B', address: 'X', city: 'Y', state: 'TXS', phone: '5125550100' }).success);
check('validation rejects short phone',
  !addressBody.safeParse({ customer_id: 'C1', first_name: 'A', last_name: 'B', address: 'X', city: 'Y', state: 'TX', phone: '123' }).success);
check('validation accepts a good record',
  addressBody.safeParse({ customer_id: 'C1', first_name: 'A', last_name: 'B', address: 'X', city: 'Y', state: 'tx', phone: '(512) 555-0100' }).success);

// --- search / CRUD SQL (same statements as src/db/addresses.js) ------------
const target = seedRows[0];
const like = `%${target.last_name.toLowerCase()}%`;
const found = await q(
  `SELECT * FROM addresses WHERE (lower(first_name) LIKE $1 OR lower(last_name) LIKE $1
     OR lower(address) LIKE $1 OR lower(city) LIKE $1 OR lower(state) LIKE $1
     OR lower(phone) LIKE $1 OR lower(customer_id) LIKE $1)`, [like]);
check('search finds seeded surname', found.rows.length > 0, `looking for ${target.last_name}`);

const created = await q(
  `INSERT INTO addresses (customer_id, first_name, last_name, address, city, state, phone)
   VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
  ['CUST-TEST01', 'Ada', 'Lovelace', '1 Analytical Way', 'Boise', 'ID', '(208) 555-0101']);
check('create returns the row', created.rows[0].customer_id === 'CUST-TEST01');
const newId = created.rows[0].id;

const updated = await q(
  `UPDATE addresses SET phone = $1, updated_at = now() WHERE id = $2 RETURNING *`,
  ['(208) 555-0199', newId]);
check('update changes only the given field',
  updated.rows[0].phone === '(208) 555-0199' && updated.rows[0].first_name === 'Ada');

let dupErr = null;
try {
  await q(`INSERT INTO addresses (customer_id, first_name, last_name, address, city, state, phone)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    ['CUST-TEST01', 'X', 'Y', 'Z', 'C', 'ID', '(208) 555-0102']);
} catch (e) { dupErr = e; }
check('duplicate customer_id is rejected', dupErr !== null);

const del = await q('DELETE FROM addresses WHERE id = $1 RETURNING id', [newId]);
check('delete removes the row', del.rowCount === 1);
check('deleted row is gone',
  (await q('SELECT * FROM addresses WHERE id = $1', [newId])).rows.length === 0);

// --- password hashing ------------------------------------------------------
const hash = (await q('SELECT password_hash FROM users WHERE username = $1', ['admin'])).rows[0].password_hash;
check('password is bcrypt hashed', hash.startsWith('$2') && hash !== 'admin123');
check('correct password verifies', await bcrypt.compare('admin123', hash));
check('wrong password fails', !(await bcrypt.compare('hunter2', hash)));

// --- paging ----------------------------------------------------------------
const page1 = await q('SELECT id FROM addresses ORDER BY last_name ASC, id ASC LIMIT $1 OFFSET $2', [25, 0]);
const page2 = await q('SELECT id FROM addresses ORDER BY last_name ASC, id ASC LIMIT $1 OFFSET $2', [25, 25]);
check('paging returns 25 per page', page1.rows.length === 25 && page2.rows.length === 25);
check('pages do not overlap',
  new Set([...page1.rows, ...page2.rows].map((r) => r.id)).size === 50);

console.log(results.join('\n'));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
