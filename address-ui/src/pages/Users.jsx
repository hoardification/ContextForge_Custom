import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';

const ROLES = ['read', 'readwrite', 'admin'];

export default function Users() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState({ username: '', password: '', role: 'read' });

  const load = useCallback(async () => {
    setError('');
    try {
      const [u, s] = await Promise.all([api.listUsers(), api.adminStats()]);
      setUsers(u.data);
      setStats(s);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function create(e) {
    e.preventDefault();
    setError('');
    try {
      await api.createUser(creating);
      setCreating({ username: '', password: '', role: 'read' });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function changeRole(u, role) {
    setError('');
    try {
      await api.updateUser(u.id, { role });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function resetPassword(u) {
    const password = prompt(`New password for ${u.username} (min 6 chars):`);
    if (!password) return;
    try {
      await api.updateUser(u.id, { password });
      alert('Password updated.');
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(u) {
    if (!confirm(`Delete user ${u.username}?`)) return;
    try {
      await api.deleteUser(u.id);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <>
      <div className="panel">
        <h3 style={{ marginTop: 0 }}>User management</h3>
        {stats && (
          <p className="muted">
            {stats.addresses} addresses ·{' '}
            {Object.entries(stats.usersByRole).map(([r, c]) => `${c} ${r}`).join(' · ')} ·
            uptime {stats.uptimeSeconds}s
          </p>
        )}
        {error && <div className="error">{error}</div>}

        <table>
          <thead>
            <tr>
              <th>Username</th><th>Role</th><th>Created</th><th style={{ width: 200 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>
                  {u.username}
                  {u.id === me.id && <span className="muted"> (you)</span>}
                </td>
                <td>
                  <select
                    value={u.role}
                    onChange={(e) => changeRole(u, e.target.value)}
                    style={{ width: 130 }}
                  >
                    {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </td>
                <td className="muted">{new Date(u.created_at).toLocaleDateString()}</td>
                <td>
                  <div className="row" style={{ gap: 6 }}>
                    <button onClick={() => resetPassword(u)}>Password</button>
                    <button
                      className="danger"
                      onClick={() => remove(u)}
                      disabled={u.id === me.id}
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Add user</h3>
        <form onSubmit={create}>
          <div className="row">
            <div style={{ flex: 1, minWidth: 180 }}>
              <label htmlFor="nu">Username</label>
              <input
                id="nu"
                value={creating.username}
                onChange={(e) => setCreating({ ...creating, username: e.target.value })}
                required
                minLength={3}
              />
            </div>
            <div style={{ flex: 1, minWidth: 180 }}>
              <label htmlFor="np">Password</label>
              <input
                id="np"
                type="password"
                value={creating.password}
                onChange={(e) => setCreating({ ...creating, password: e.target.value })}
                required
                minLength={6}
              />
            </div>
            <div style={{ width: 150 }}>
              <label htmlFor="nr">Role</label>
              <select
                id="nr"
                value={creating.role}
                onChange={(e) => setCreating({ ...creating, role: e.target.value })}
              >
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <button className="primary" type="submit">Create</button>
          </div>
        </form>
      </div>
    </>
  );
}
