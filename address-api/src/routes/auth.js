import { Router } from 'express';
import { z } from 'zod';
import {
  changePassword,
  getUserByUsernameWithHash,
  setMustChangePassword,
  verifyPassword,
} from '../db/users.js';
import {
  PASSWORD_CHANGE_SCOPE,
  requireAuth,
  requireAuthForPasswordChange,
  signToken,
} from '../middleware/auth.js';
import { isPublicPassword, MIN_PASSWORD_LENGTH } from '../publicPasswords.js';
import { ApiError, asyncHandler } from '../middleware/errors.js';

const router = Router();

const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(200),
});

const changeSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(1).max(200),
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

    // Checked on every login, not just at seed time, so a database seeded
    // before this existed - or an account set back to a published value - is
    // caught the next time anyone signs in with it.
    const usingPublic = isPublicPassword(password);
    if (usingPublic && !user.must_change_password) {
      await setMustChangePassword(user.id, true);
    }
    const mustChange = usingPublic || user.must_change_password;

    res.json({
      token: signToken(user, mustChange ? { scope: PASSWORD_CHANGE_SCOPE } : {}),
      mustChangePassword: mustChange,
      user: { id: user.id, username: user.username, role: user.role },
    });
  }),
);

/**
 * Clear the lock by setting a real password.
 *
 * The current password is required even though the token already proves a
 * recent login: it stops a token left in a browser on a shared machine from
 * being enough to take the account over permanently.
 */
router.post(
  '/change-password',
  requireAuthForPasswordChange,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = changeSchema.parse(req.body);

    const user = await getUserByUsernameWithHash(req.user.username);
    if (!user || !(await verifyPassword(currentPassword, user.password_hash))) {
      throw new ApiError(401, 'UNAUTHENTICATED', 'Current password is incorrect');
    }

    if (isPublicPassword(newPassword)) {
      throw new ApiError(400, 'VALIDATION',
        'That password is published in this project\'s source. Choose one that is not.');
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      throw new ApiError(400, 'VALIDATION',
        `New password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }
    if (newPassword === currentPassword) {
      throw new ApiError(400, 'VALIDATION', 'New password must differ from the current one');
    }

    const updated = await changePassword(user.id, newPassword);

    // A full token, so the caller is immediately usable without a second login.
    res.json({
      token: signToken(updated),
      mustChangePassword: false,
      user: { id: updated.id, username: updated.username, role: updated.role },
    });
  }),
);

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

export default router;
