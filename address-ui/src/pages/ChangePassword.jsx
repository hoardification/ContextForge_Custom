import { useState } from 'react';
import { useAuth } from '../lib/auth.jsx';

/** Mirrors MIN_PASSWORD_LENGTH in address-api/src/publicPasswords.js. */
const MIN_LENGTH = 12;

/**
 * Shown instead of the app when the signed-in account still holds a password
 * published in this repository. This is a convenience, not the control: the
 * token issued for such an account is scoped, so every other endpoint refuses
 * it regardless of what the browser chooses to render.
 */
export default function ChangePassword() {
  const { user, changePassword, logout } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const tooShort = newPassword.length > 0 && newPassword.length < MIN_LENGTH;
  const mismatch = confirm.length > 0 && newPassword !== confirm;
  const ready = currentPassword && newPassword.length >= MIN_LENGTH && newPassword === confirm;

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await changePassword(currentPassword, newPassword);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="panel">
        <h2 style={{ marginTop: 0 }}>Choose a new password</h2>
        <p className="muted" style={{ fontSize: 13 }}>
          <strong>{user?.username}</strong> is signed in with a password published in this
          project&apos;s source, so anyone who can read the repository already knows it.
          Set a new one to continue — nothing else will work until you do.
        </p>
        <form onSubmit={onSubmit}>
          <div style={{ marginBottom: 12 }}>
            <label htmlFor="cp">Current password</label>
            <input
              id="cp"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label htmlFor="np">New password</label>
            <input
              id="np"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
            />
            {tooShort && (
              <div className="muted" style={{ fontSize: 12 }}>
                At least {MIN_LENGTH} characters.
              </div>
            )}
          </div>
          <div style={{ marginBottom: 16 }}>
            <label htmlFor="np2">Confirm new password</label>
            <input
              id="np2"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
            />
            {mismatch && (
              <div className="muted" style={{ fontSize: 12 }}>
                The two entries do not match.
              </div>
            )}
          </div>
          {error && <div className="error">{error}</div>}
          <button className="primary" type="submit" disabled={busy || !ready}>
            {busy ? 'Saving…' : 'Set password'}
          </button>
          <button type="button" onClick={logout} style={{ marginLeft: 8 }}>
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
