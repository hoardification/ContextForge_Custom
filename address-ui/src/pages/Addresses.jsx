import { useCallback, useEffect, useState } from 'react';
import AddressForm from '../components/AddressForm.jsx';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';

export default function Addresses() {
  const { can } = useAuth();

  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('last_name');
  const [dir, setDir] = useState('asc');
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const res = await api.listAddresses({ q, page, pageSize, sort, dir });
      setRows(res.data);
      setTotal(res.total);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }, [q, page, pageSize, sort, dir]);

  // Debounce so typing in the search box doesn't hammer the API.
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  function toggleSort(col) {
    if (sort === col) setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSort(col); setDir('asc'); }
  }

  async function save(body) {
    if (editing?.id) await api.updateAddress(editing.id, body);
    else await api.createAddress(body);
    setEditing(null);
    await load();
  }

  async function remove(row) {
    if (!confirm(`Delete ${row.first_name} ${row.last_name} (${row.customer_id})?`)) return;
    try {
      await api.deleteAddress(row.id);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function reseed() {
    if (!confirm('Wipe all addresses and regenerate 100 rows?')) return;
    try {
      await api.reseed(100);
      setPage(1);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const COLUMNS = [
    ['customer_id', 'Customer ID'], ['first_name', 'First'], ['last_name', 'Last'],
    ['address', 'Address'], ['city', 'City'], ['state', 'ST'], ['phone', 'Phone'],
  ];

  return (
    <>
      <div className="panel">
        <div className="row">
          <div style={{ flex: 2, minWidth: 240 }}>
            <label htmlFor="q">Search</label>
            <input
              id="q"
              placeholder="name, city, state, phone, customer id…"
              value={q}
              onChange={(e) => { setQ(e.target.value); setPage(1); }}
            />
          </div>
          <div style={{ width: 120 }}>
            <label htmlFor="ps">Per page</label>
            <select
              id="ps"
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
            >
              {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          {can('readwrite') && (
            <button className="primary" onClick={() => setEditing({})}>+ New address</button>
          )}
          {can('admin') && <button className="danger" onClick={reseed}>Re-seed</button>}
          <button onClick={load} disabled={busy}>{busy ? 'Loading…' : 'Refresh'}</button>
        </div>
        {error && <div className="error">{error}</div>}
      </div>

      <div className="panel">
        <table>
          <thead>
            <tr>
              {COLUMNS.map(([key, label]) => (
                <th key={key} onClick={() => toggleSort(key)}>
                  {label}{sort === key ? (dir === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
              {(can('readwrite') || can('admin')) && <th style={{ width: 130 }}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><code>{r.customer_id}</code></td>
                <td>{r.first_name}</td>
                <td>{r.last_name}</td>
                <td>{r.address}</td>
                <td>{r.city}</td>
                <td>{r.state}</td>
                <td>{r.phone}</td>
                {(can('readwrite') || can('admin')) && (
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      {can('readwrite') && <button onClick={() => setEditing(r)}>Edit</button>}
                      {can('admin') && <button className="danger" onClick={() => remove(r)}>Del</button>}
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {!rows.length && !busy && (
              <tr><td colSpan={8} className="muted">No matching addresses.</td></tr>
            )}
          </tbody>
        </table>

        <div className="row" style={{ marginTop: 14, alignItems: 'center' }}>
          <span className="muted">
            {total} record{total === 1 ? '' : 's'} · page {page} of {pages}
          </span>
          <span style={{ flex: 1 }} />
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
            ‹ Prev
          </button>
          <button onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages}>
            Next ›
          </button>
        </div>
      </div>

      {editing && (
        <AddressForm
          initial={editing.id ? editing : null}
          onSave={save}
          onCancel={() => setEditing(null)}
        />
      )}
    </>
  );
}
