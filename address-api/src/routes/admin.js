import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db/index.js';
import { countAddresses } from '../db/addresses.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errors.js';
import { generateAddresses } from '../../scripts/generate.js';

const router = Router();
router.use(requireAuth, requireRole('admin'));

const reseedBody = z.object({
  count: z.coerce.number().int().min(1).max(5000).default(100),
  truncate: z.coerce.boolean().default(true),
});

/** Wipe and regenerate the address table. Admin only. */
router.post(
  '/reseed',
  asyncHandler(async (req, res) => {
    const { count, truncate } = reseedBody.parse(req.body ?? {});
    const client = await (await import('../db/index.js')).pool.connect();

    try {
      await client.query('BEGIN');
      if (truncate) await client.query('TRUNCATE addresses RESTART IDENTITY');

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

    res.json({ reseeded: true, requested: count, total: await countAddresses() });
  }),
);

router.get(
  '/stats',
  asyncHandler(async (_req, res) => {
    const users = await query('SELECT role, count(*)::int AS count FROM users GROUP BY role');
    res.json({
      addresses: await countAddresses(),
      usersByRole: Object.fromEntries(users.rows.map((r) => [r.role, r.count])),
      uptimeSeconds: Math.round(process.uptime()),
    });
  }),
);

export default router;
