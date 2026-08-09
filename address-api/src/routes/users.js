import { Router } from 'express';
import { z } from 'zod';
import {
  countAdmins, createUser, deleteUser, getUser, listUsers, updateUser,
} from '../db/users.js';
import { ROLES, requireAuth, requireRole } from '../middleware/auth.js';
import { ApiError, asyncHandler } from '../middleware/errors.js';

const router = Router();

// The whole user portal is admin-only.
router.use(requireAuth, requireRole('admin'));

const createBody = z.object({
  username: z.string().min(3).max(64).regex(/^[A-Za-z0-9_.-]+$/, 'Alphanumeric, _ . - only'),
  password: z.string().min(6).max(200),
  role: z.enum(ROLES),
});

const updateBody = z.object({
  username: z.string().min(3).max(64).regex(/^[A-Za-z0-9_.-]+$/).optional(),
  password: z.string().min(6).max(200).optional(),
  role: z.enum(ROLES).optional(),
});

router.get('/', asyncHandler(async (_req, res) => res.json({ data: await listUsers() })));

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const user = await getUser(Number(req.params.id));
    if (!user) throw new ApiError(404, 'NOT_FOUND', 'User not found');
    res.json(user);
  }),
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    res.status(201).json(await createUser(createBody.parse(req.body)));
  }),
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const patch = updateBody.parse(req.body);
    const target = await getUser(id);
    if (!target) throw new ApiError(404, 'NOT_FOUND', 'User not found');

    // Don't let the last admin demote themselves out of existence.
    if (target.role === 'admin' && patch.role && patch.role !== 'admin') {
      if ((await countAdmins()) <= 1) {
        throw new ApiError(409, 'CONFLICT', 'Cannot demote the last remaining admin');
      }
    }
    res.json(await updateUser(id, patch));
  }),
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (id === req.user.id) {
      throw new ApiError(409, 'CONFLICT', 'You cannot delete your own account');
    }
    const target = await getUser(id);
    if (!target) throw new ApiError(404, 'NOT_FOUND', 'User not found');
    if (target.role === 'admin' && (await countAdmins()) <= 1) {
      throw new ApiError(409, 'CONFLICT', 'Cannot delete the last remaining admin');
    }
    await deleteUser(id);
    res.json({ deleted: true, id });
  }),
);

export default router;
