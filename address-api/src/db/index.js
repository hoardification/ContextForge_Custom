import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ||
    `postgres://${process.env.POSTGRES_USER || 'forge'}:${
      process.env.POSTGRES_PASSWORD || 'forge_dev_password'
    }@${process.env.POSTGRES_HOST || 'localhost'}:${
      process.env.POSTGRES_PORT || 5432
    }/${process.env.POSTGRES_DB || 'addressbook'}`,
  max: 10,
  idleTimeoutMillis: 30_000,
});

export function query(text, params) {
  return pool.query(text, params);
}

/** Retry connecting — Postgres in Docker may not be ready when we boot. */
export async function waitForDb({ retries = 30, delayMs = 2000 } = {}) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      if (attempt === retries) throw err;
      console.log(`[db] not ready (${err.code || err.message}); retry ${attempt}/${retries}`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

export async function initSchema() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('[db] schema ensured');
}
