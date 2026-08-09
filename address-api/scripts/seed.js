import 'dotenv/config';
import { initSchema, pool, waitForDb } from '../src/db/index.js';
import { countAddresses } from '../src/db/addresses.js';
import { ensureBootstrapUsers } from '../src/db/users.js';
import { generateAddresses } from './generate.js';

const count = Number(process.env.SEED_COUNT || 100);
const force = process.argv.includes('--force');

async function main() {
  await waitForDb();
  await initSchema();
  await ensureBootstrapUsers();

  const existing = await countAddresses();
  if (existing > 0 && !force) {
    console.log(`[seed] ${existing} addresses already present; skipping (use --force to wipe)`);
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (force) await client.query('TRUNCATE addresses RESTART IDENTITY');

    for (const a of generateAddresses(count)) {
      await client.query(
        `INSERT INTO addresses (customer_id, first_name, last_name, address, city, state, phone)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (customer_id) DO NOTHING`,
        [a.customer_id, a.first_name, a.last_name, a.address, a.city, a.state, a.phone],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  console.log(`[seed] done — ${await countAddresses()} addresses`);
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error('[seed] failed:', err);
    await pool.end();
    process.exit(1);
  });
