import { query } from './index.js';

const SORTABLE = new Set([
  'id', 'customer_id', 'first_name', 'last_name',
  'address', 'city', 'state', 'phone', 'created_at', 'updated_at',
]);

const COLS = `id, customer_id, first_name, last_name, address, city, state, phone,
              created_at, updated_at`;

/**
 * Paged list + optional fuzzy search. `q` matches any of the text columns.
 * Sort column is whitelisted, never interpolated from raw user input.
 */
export async function listAddresses({
  q = '', page = 1, pageSize = 25, sort = 'last_name', dir = 'asc',
  city, state,
} = {}) {
  const sortCol = SORTABLE.has(sort) ? sort : 'last_name';
  const sortDir = String(dir).toLowerCase() === 'desc' ? 'DESC' : 'ASC';

  const where = [];
  const params = [];

  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    const p = `$${params.length}`;
    where.push(`(lower(first_name) LIKE ${p} OR lower(last_name) LIKE ${p}
              OR lower(address) LIKE ${p} OR lower(city) LIKE ${p}
              OR lower(state) LIKE ${p} OR lower(phone) LIKE ${p}
              OR lower(customer_id) LIKE ${p})`);
  }
  if (city) {
    params.push(city.toLowerCase());
    where.push(`lower(city) = $${params.length}`);
  }
  if (state) {
    params.push(state.toUpperCase());
    where.push(`state = $${params.length}`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const totalRes = await query(`SELECT count(*)::int AS total FROM addresses ${whereSql}`, params);
  const total = totalRes.rows[0].total;

  const limit = Math.min(Math.max(Number(pageSize) || 25, 1), 500);
  const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;
  params.push(limit, offset);

  const rows = await query(
    `SELECT ${COLS} FROM addresses ${whereSql}
     ORDER BY ${sortCol} ${sortDir}, id ASC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return { data: rows.rows, page: Number(page) || 1, pageSize: limit, total };
}

export async function getAddress(id) {
  const res = await query(`SELECT ${COLS} FROM addresses WHERE id = $1`, [id]);
  return res.rows[0] || null;
}

export async function getAddressByCustomerId(customerId) {
  const res = await query(`SELECT ${COLS} FROM addresses WHERE customer_id = $1`, [customerId]);
  return res.rows[0] || null;
}

export async function createAddress(a) {
  const res = await query(
    `INSERT INTO addresses (customer_id, first_name, last_name, address, city, state, phone)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${COLS}`,
    [a.customer_id, a.first_name, a.last_name, a.address, a.city, a.state.toUpperCase(), a.phone],
  );
  return res.rows[0];
}

export async function updateAddress(id, patch) {
  const allowed = ['customer_id', 'first_name', 'last_name', 'address', 'city', 'state', 'phone'];
  const sets = [];
  const params = [];

  for (const key of allowed) {
    if (patch[key] !== undefined) {
      params.push(key === 'state' ? String(patch[key]).toUpperCase() : patch[key]);
      sets.push(`${key} = $${params.length}`);
    }
  }
  if (!sets.length) return getAddress(id);

  sets.push('updated_at = now()');
  params.push(id);

  const res = await query(
    `UPDATE addresses SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING ${COLS}`,
    params,
  );
  return res.rows[0] || null;
}

export async function deleteAddress(id) {
  const res = await query('DELETE FROM addresses WHERE id = $1 RETURNING id', [id]);
  return res.rowCount > 0;
}

export async function countAddresses() {
  const res = await query('SELECT count(*)::int AS total FROM addresses');
  return res.rows[0].total;
}

export async function statsByState(limit = 10) {
  const res = await query(
    `SELECT state, count(*)::int AS count FROM addresses
     GROUP BY state ORDER BY count DESC, state ASC LIMIT $1`,
    [limit],
  );
  return res.rows;
}
