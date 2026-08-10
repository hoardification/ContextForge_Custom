/**
 * The passwords this repository publishes.
 *
 * Anyone who can read the source knows these, so an account still holding one
 * is not protected by it in any meaningful sense. Login therefore treats them
 * as already expired: authentication succeeds, but the token it returns can do
 * exactly one thing - set a new password.
 *
 * This is checked on every login rather than only at seed time, so it also
 * catches a database seeded before the check existed, and an account an admin
 * later sets back to a published value.
 *
 * Keep in step with .env.example, the docker-compose fallbacks and the shipped
 * table in docker-stack/_common.ps1.
 */
const PUBLIC_PASSWORDS = new Set([
  'admin123',
  'editor123',
  'viewer123',
  'forge_dev_password',
  'changeme',
  'change-me',
]);

/** Minimum length for a replacement. Long enough that the obvious swaps fail. */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * Compared case-insensitively and trimmed: `Admin123 ` is the published
 * password wearing a hat, and accepting it would defeat the whole control.
 */
export function isPublicPassword(plain) {
  return PUBLIC_PASSWORDS.has(String(plain ?? '').trim().toLowerCase());
}

export { PUBLIC_PASSWORDS };
