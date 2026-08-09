import { useState } from 'react';

const EMPTY = {
  customer_id: '', first_name: '', last_name: '',
  address: '', city: '', state: '', phone: '',
};

const FIELDS = [
  ['customer_id', 'Customer ID'],
  ['first_name', 'First name'],
  ['last_name', 'Last name'],
  ['address', 'Street address'],
  ['city', 'City'],
  ['state', 'State (2 letters)'],
  ['phone', 'Phone'],
];

export default function AddressForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState({ ...EMPTY, ...(initial || {}) });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await onSave({
        customer_id: form.customer_id.trim(),
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        address: form.address.trim(),
        city: form.city.trim(),
        state: form.state.trim().toUpperCase(),
        phone: form.phone.trim(),
      });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>{initial?.id ? 'Edit address' : 'New address'}</h3>
        <form onSubmit={submit}>
          <div className="grid">
            {FIELDS.map(([key, label]) => (
              <div key={key}>
                <label htmlFor={key}>{label}</label>
                <input
                  id={key}
                  value={form[key]}
                  onChange={set(key)}
                  maxLength={key === 'state' ? 2 : undefined}
                  required
                />
              </div>
            ))}
          </div>
          {error && <div className="error">{error}</div>}
          <div className="row" style={{ marginTop: 18, justifyContent: 'flex-end' }}>
            <button type="button" onClick={onCancel}>Cancel</button>
            <button className="primary" type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
