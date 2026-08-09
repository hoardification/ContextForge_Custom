import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import morgan from 'morgan';

import { initSchema, waitForDb } from './db/index.js';
import { countAddresses } from './db/addresses.js';
import { ensureBootstrapUsers } from './db/users.js';
import { generateAddresses } from '../scripts/generate.js';
import { pool } from './db/index.js';

import adminRoutes from './routes/admin.js';
import addressRoutes from './routes/addresses.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import { errorHandler, notFound } from './middleware/errors.js';

const app = express();

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '1mb' }));
app.use(morgan(process.env.LOG_FORMAT || 'tiny'));

app.get('/health', (_req, res) => res.json({ ok: true, service: 'address-api' }));

app.use('/api/auth', authRoutes);
app.use('/api/addresses', addressRoutes);
app.use('/api/users', userRoutes);
app.use('/api/admin', adminRoutes);

app.use(notFound);
app.use(errorHandler);

const port = Number(process.env.API_PORT || 4000);

async function autoSeed() {
  if (process.env.AUTO_SEED === 'false') return;
  if ((await countAddresses()) > 0) return;

  const count = Number(process.env.SEED_COUNT || 100);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const a of generateAddresses(count)) {
      await client.query(
        `INSERT INTO addresses (customer_id, first_name, last_name, address, city, state, phone)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (customer_id) DO NOTHING`,
        [a.customer_id, a.first_name, a.last_name, a.address, a.city, a.state, a.phone],
      );
    }
    await client.query('COMMIT');
    console.log(`[seed] auto-seeded ${await countAddresses()} addresses`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[seed] auto-seed failed:', err.message);
  } finally {
    client.release();
  }
}

async function start() {
  await waitForDb();
  await initSchema();
  await ensureBootstrapUsers();
  await autoSeed();

  app.listen(port, '0.0.0.0', () => {
    console.log(`[api] address-api listening on :${port}`);
  });
}

start().catch((err) => {
  console.error('[api] failed to start:', err);
  process.exit(1);
});

export default app;
