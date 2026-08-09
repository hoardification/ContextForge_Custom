import { Router } from 'express';
import { z } from 'zod';
import {
  countAddresses, createAddress, deleteAddress, getAddress,
  getAddressByCustomerId, listAddresses, statsByState, updateAddress,
} from '../db/addresses.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { ApiError, asyncHandler } from '../middleware/errors.js';

const router = Router();
router.use(requireAuth);

const US_STATE = z.string().length(2).regex(/^[A-Za-z]{2}$/, 'Must be a 2-letter state code');

const addressBody = z.object({
  customer_id: z.string().min(1).max(32),
  first_name: z.string().min(1).max(80),
  last_name: z.string().min(1).max(80),
  address: z.string().min(1).max(200),
  city: z.string().min(1).max(80),
  state: US_STATE,
  phone: z.string().min(7).max(32),
});

const listQuery = z.object({
  q: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(25),
  sort: z.string().max(40).optional(),
  dir: z.enum(['asc', 'desc']).optional(),
  city: z.string().max(80).optional(),
  state: US_STATE.optional(),
});

// --- read ---

router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await listAddresses(listQuery.parse(req.query)));
  }),
);

router.get(
  '/stats',
  asyncHandler(async (_req, res) => {
    res.json({ total: await countAddresses(), byState: await statsByState(10) });
  }),
);

router.get(
  '/by-customer/:customerId',
  asyncHandler(async (req, res) => {
    const row = await getAddressByCustomerId(req.params.customerId);
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Address not found');
    res.json(row);
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const row = await getAddress(Number(req.params.id));
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Address not found');
    res.json(row);
  }),
);

// --- write ---

router.post(
  '/',
  requireRole('readwrite'),
  asyncHandler(async (req, res) => {
    res.status(201).json(await createAddress(addressBody.parse(req.body)));
  }),
);

router.put(
  '/:id',
  requireRole('readwrite'),
  asyncHandler(async (req, res) => {
    const patch = addressBody.partial().parse(req.body);
    const row = await updateAddress(Number(req.params.id), patch);
    if (!row) throw new ApiError(404, 'NOT_FOUND', 'Address not found');
    res.json(row);
  }),
);

// --- delete (admin only) ---

router.delete(
  '/:id',
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const ok = await deleteAddress(Number(req.params.id));
    if (!ok) throw new ApiError(404, 'NOT_FOUND', 'Address not found');
    res.json({ deleted: true, id: Number(req.params.id) });
  }),
);

export default router;
