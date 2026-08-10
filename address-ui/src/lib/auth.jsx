import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken } from './api.js';

const RANK = { read: 1, readwrite: 2, admin: 3 };
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [loading, setLoading] = useState(Boolean(getToken()));

  // Restore a session from a stored token on first paint.
  // A password-change token is refused by /auth/me by design, so a reload
  // while locked drops back to the sign-in form rather than half-restoring a
  // session the token cannot actually drive.
  useEffect(() => {
    if (!getToken()) return;
    api
      .me()
      .then((r) => setUser(r.user))
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (username, password) => {
    const res = await api.login(username, password);
    setToken(res.token);
    setUser(res.user);
    setMustChangePassword(Boolean(res.mustChangePassword));
    return res;
  }, []);

  // Clears the lock and swaps the scoped token for a full one.
  const changePassword = useCallback(async (currentPassword, newPassword) => {
    const res = await api.changePassword(currentPassword, newPassword);
    setToken(res.token);
    setUser(res.user);
    setMustChangePassword(false);
    return res.user;
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    setMustChangePassword(false);
  }, []);

  // UX-only gate. The API enforces the same rules authoritatively.
  const can = useCallback(
    (minRole) => (RANK[user?.role] || 0) >= (RANK[minRole] || 99),
    [user],
  );

  const value = useMemo(
    () => ({ user, loading, login, logout, can, mustChangePassword, changePassword }),
    [user, loading, login, logout, can, mustChangePassword, changePassword],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
