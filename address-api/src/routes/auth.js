import { Router } from 'express';
import { z } from 'zod';
import { getUserByUsernameWithHash, verifyPassword } from '../db/users.js';
import { requireAuth, signToken } from '../middleware/auth.js';
import { ApiError, asyncHandler } from '../middleware/errors.js';

const router = Router();

const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(200),
});

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { username, password } = loginSchema.parse(req.body);
    const user = await getUserByUsernameWithHash(username);

    // Same error for unknown user and bad password — don't leak which.
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      throw new ApiError(401, 'UNAUTHENTICATED', 'Invalid username or password');
    }

    res.json({
      token: signToken(user),
      user: { id: user.id, username: user.username, role: user.role },
    });
  }),
);

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

export default router;
