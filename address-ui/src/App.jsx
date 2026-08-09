import { useState } from 'react';
import Addresses from './pages/Addresses.jsx';
import Login from './pages/Login.jsx';
import Users from './pages/Users.jsx';
import { useAuth } from './lib/auth.jsx';

export default function App() {
  const { user, loading, logout, can } = useAuth();
  const [tab, setTab] = useState('addresses');

  if (loading) return <div className="app"><p className="muted">Loading…</p></div>;
  if (!user) return <Login />;

  return (
    <>
      <nav className="top">
        <span className="brand">Address Book</span>
        <button
          className={`tab ${tab === 'addresses' ? 'active' : ''}`}
          onClick={() => setTab('addresses')}
        >
          Addresses
        </button>
        {can('admin') && (
          <button
            className={`tab ${tab === 'users' ? 'active' : ''}`}
            onClick={() => setTab('users')}
          >
            Users
          </button>
        )}
        <span className="spacer" />
        <span className="muted">{user.username}</span>
        <span className={`badge ${user.role}`}>{user.role}</span>
        <button onClick={logout}>Sign out</button>
      </nav>

      <div className="app">
        {tab === 'addresses' ? <Addresses /> : <Users />}
      </div>
    </>
  );
}
