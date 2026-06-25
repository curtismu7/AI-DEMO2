import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import bffAxios from '../services/bffAxios';

const OVERLAY = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000,
  display: 'flex', justifyContent: 'flex-end',
};
const PANEL = {
  background: '#fff', width: '480px', maxWidth: '100vw',
  height: '100vh', overflowY: 'auto',
  boxShadow: '-4px 0 24px rgba(0,0,0,0.18)',
  display: 'flex', flexDirection: 'column',
};
const HEADER = {
  padding: '20px 24px 16px', borderBottom: '1px solid #e5e7eb',
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  position: 'sticky', top: 0, background: '#fff', zIndex: 1,
};
const BODY = { padding: '24px', flex: 1 };
const FOOTER = {
  padding: '16px 24px', borderTop: '1px solid #e5e7eb',
  display: 'flex', gap: '12px', justifyContent: 'flex-end',
  position: 'sticky', bottom: 0, background: '#fff',
};
const SECTION = { marginBottom: '28px' };
const SECTION_TITLE = { fontSize: '13px', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '14px' };
const FIELD = { marginBottom: '18px' };
const LABEL = { display: 'block', fontSize: '14px', fontWeight: 600, color: '#374151', marginBottom: '4px' };
const HINT = { fontSize: '12px', color: '#6b7280', marginBottom: '6px' };
const INPUT = {
  width: '100%', padding: '8px 12px', border: '1px solid #d1d5db',
  borderRadius: '6px', fontSize: '14px', boxSizing: 'border-box',
};
const INPUT_ERR = { ...INPUT, border: '1px solid #ef4444' };
const TOGGLE_ROW = { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' };
const CHECKBOX_ROW = { display: 'flex', alignItems: 'flex-start', gap: '10px', marginBottom: '12px' };
const BANNER = (color) => ({
  padding: '14px 16px', borderRadius: '8px', marginBottom: '20px',
  background: color === 'green' ? '#f0fdf4' : color === 'yellow' ? '#fefce8' : '#fef2f2',
  border: `1px solid ${color === 'green' ? '#bbf7d0' : color === 'yellow' ? '#fde68a' : '#fecaca'}`,
  color: color === 'green' ? '#166534' : color === 'yellow' ? '#854d0e' : '#991b1b',
  fontSize: '14px',
});
const BTN_PRIMARY = {
  padding: '9px 20px', background: '#2563eb', color: '#fff',
  border: 'none', borderRadius: '6px', fontSize: '14px', fontWeight: 600,
  cursor: 'pointer',
};
const BTN_SECONDARY = {
  padding: '9px 20px', background: '#fff', color: '#374151',
  border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px',
  cursor: 'pointer',
};
const SPINNER_WRAP = {
  position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.7)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2,
};

const EMPTY = {
  firstName: '', lastName: '', email: '', cell: '', password: '',
  delegationEnabled: false, delegateEmail: '',
  enrollEmailOtp: true, enrollSmsOtp: false,
  seedBankingData: true,
};

export default function CreateUserPanel({ onClose, onCreated }) {
  const [form, setForm] = useState(EMPTY);
  const [delegateUser, setDelegateUser] = useState(null);
  const [delegateSearch, setDelegateSearch] = useState('');
  const [delegateResults, setDelegateResults] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState(null); // { type: 'success'|'partial'|'error', data }
  const [fieldErrors, setFieldErrors] = useState({});

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const set = useCallback((key, val) => setForm(f => ({ ...f, [key]: val })), []);

  const searchDelegate = useCallback(async (q) => {
    if (q.length < 3) { setDelegateResults([]); return; }
    try {
      const r = await bffAxios.get(`/api/users/search/${encodeURIComponent(q)}`);
      setDelegateResults(r.data.users || []);
    } catch { setDelegateResults([]); }
  }, []);

  useEffect(() => {
    if (!form.delegationEnabled) return;
    const t = setTimeout(() => searchDelegate(delegateSearch), 400);
    return () => clearTimeout(t);
  }, [delegateSearch, form.delegationEnabled, searchDelegate]);

  const validate = () => {
    const errs = {};
    if (!form.firstName.trim()) errs.firstName = 'Required';
    if (!form.lastName.trim())  errs.lastName  = 'Required';
    if (!form.email.trim())     errs.email     = 'Required';
    if (!form.cell.trim())      errs.cell      = 'Required';
    if (!form.password.trim())  errs.password  = 'Required';
    if (form.delegationEnabled && !delegateUser) errs.delegateUser = 'Select a delegate target';
    return errs;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length) { setFieldErrors(errs); return; }
    setFieldErrors({});
    setSubmitting(true);
    setBanner(null);
    try {
      const payload = {
        firstName: form.firstName.trim(),
        lastName:  form.lastName.trim(),
        email:     form.email.trim(),
        cell:      form.cell.trim(),
        password:  form.password,
        delegation: form.delegationEnabled && delegateUser
          ? { enabled: true, targetUserId: delegateUser.id }
          : { enabled: false },
        enrollEmailOtp:  form.enrollEmailOtp,
        enrollSmsOtp:    form.enrollSmsOtp,
        seedBankingData: form.seedBankingData,
      };
      const r = await bffAxios.post('/api/admin/demo-users', payload);
      if (r.status === 201) {
        setBanner({ type: 'success', data: r.data });
        if (onCreated) onCreated(r.data);
      } else {
        setBanner({ type: 'partial', data: r.data });
      }
      setForm(EMPTY);
      setDelegateUser(null);
      setDelegateSearch('');
    } catch (err) {
      setBanner({ type: 'error', message: err.response?.data?.message || err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const inputStyle = (key) => fieldErrors[key] ? INPUT_ERR : INPUT;

  return (
    <div style={OVERLAY} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ ...PANEL, position: 'relative' }} role="dialog" aria-modal="true" aria-label="Create Demo User">
        {submitting && <div style={SPINNER_WRAP}><span>Creating user...</span></div>}

        <div style={HEADER}>
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>+ Create Demo User</h2>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', fontSize: '22px', cursor: 'pointer', color: '#6b7280' }}>×</button>
        </div>

        <form onSubmit={handleSubmit} style={BODY} noValidate>
          {banner && <Banner banner={banner} />}

          {/* Basic info */}
          <div style={SECTION}>
            <div style={SECTION_TITLE}>Identity</div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div style={FIELD}>
                <label style={LABEL}>First name *</label>
                <div style={HINT}>PingOne display name</div>
                <input style={inputStyle('firstName')} value={form.firstName} onChange={e => set('firstName', e.target.value)} />
                {fieldErrors.firstName && <div style={{ color: '#ef4444', fontSize: '12px' }}>{fieldErrors.firstName}</div>}
              </div>
              <div style={FIELD}>
                <label style={LABEL}>Last name *</label>
                <div style={HINT}>PingOne display name</div>
                <input style={inputStyle('lastName')} value={form.lastName} onChange={e => set('lastName', e.target.value)} />
                {fieldErrors.lastName && <div style={{ color: '#ef4444', fontSize: '12px' }}>{fieldErrors.lastName}</div>}
              </div>
            </div>

            <div style={FIELD}>
              <label style={LABEL}>Email address *</label>
              <div style={HINT}>Used as PingOne username and login identifier — must be unique in the environment</div>
              <input type="email" style={inputStyle('email')} value={form.email} onChange={e => set('email', e.target.value)} />
              {fieldErrors.email && <div style={{ color: '#ef4444', fontSize: '12px' }}>{fieldErrors.email}</div>}
            </div>

            <div style={FIELD}>
              <label style={LABEL}>Mobile / cell number *</label>
              <div style={HINT}>Stored on the PingOne user profile; required to enroll SMS OTP as an MFA device</div>
              <input type="tel" placeholder="+15551234567" style={inputStyle('cell')} value={form.cell} onChange={e => set('cell', e.target.value)} />
              {fieldErrors.cell && <div style={{ color: '#ef4444', fontSize: '12px' }}>{fieldErrors.cell}</div>}
            </div>

            <div style={FIELD}>
              <label style={LABEL}>Temporary password *</label>
              <div style={HINT}>PingOne requires an initial password; user is prompted to change it on first login</div>
              <input type="password" style={inputStyle('password')} value={form.password} onChange={e => set('password', e.target.value)} />
              {fieldErrors.password && <div style={{ color: '#ef4444', fontSize: '12px' }}>{fieldErrors.password}</div>}
            </div>
          </div>

          {/* Delegation */}
          <div style={SECTION}>
            <div style={SECTION_TITLE}>Agent Delegation</div>
            <div style={TOGGLE_ROW}>
              <input type="checkbox" id="delegationEnabled" checked={form.delegationEnabled} onChange={e => set('delegationEnabled', e.target.checked)} />
              <label htmlFor="delegationEnabled" style={{ fontSize: '14px', fontWeight: 600, color: '#374151' }}>Enable delegation</label>
            </div>
            <div style={HINT}>Sets the <code>may_act.sub</code> custom attribute — enables RFC 8693 token exchange for agent delegation demos</div>
            {form.delegationEnabled && (
              <div style={{ marginTop: '12px' }}>
                <label style={LABEL}>Delegate target (search by email) *</label>
                <input
                  style={inputStyle('delegateUser')}
                  placeholder="Search PingOne users..."
                  value={delegateSearch}
                  onChange={e => { setDelegateSearch(e.target.value); setDelegateUser(null); }}
                />
                {fieldErrors.delegateUser && <div style={{ color: '#ef4444', fontSize: '12px' }}>{fieldErrors.delegateUser}</div>}
                {delegateResults.length > 0 && !delegateUser && (
                  <ul style={{ listStyle: 'none', margin: '4px 0 0', padding: 0, border: '1px solid #d1d5db', borderRadius: '6px', maxHeight: '160px', overflowY: 'auto' }}>
                    {delegateResults.map(u => (
                      <li key={u.id}>
                        <button
                          type="button"
                          style={{ width: '100%', textAlign: 'left', padding: '8px 12px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px' }}
                          onClick={() => { setDelegateUser(u); setDelegateSearch(u.email); setDelegateResults([]); }}
                        >
                          {u.firstName} {u.lastName} &lt;{u.email}&gt;
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {delegateUser && <div style={{ fontSize: '13px', color: '#166534', marginTop: '4px' }}>✅ {delegateUser.firstName} {delegateUser.lastName} ({delegateUser.id})</div>}
              </div>
            )}
          </div>

          {/* MFA */}
          <div style={SECTION}>
            <div style={SECTION_TITLE}>MFA Devices</div>
            <div style={CHECKBOX_ROW}>
              <input type="checkbox" id="enrollEmailOtp" checked={form.enrollEmailOtp} onChange={e => set('enrollEmailOtp', e.target.checked)} style={{ marginTop: '2px' }} />
              <div>
                <label htmlFor="enrollEmailOtp" style={{ ...LABEL, marginBottom: '2px' }}>Enroll email OTP</label>
                <div style={HINT}>Pre-enrolls email as an MFA device so the user can log in without manual MFA setup</div>
              </div>
            </div>
            <div style={CHECKBOX_ROW}>
              <input type="checkbox" id="enrollSmsOtp" checked={form.enrollSmsOtp} onChange={e => set('enrollSmsOtp', e.target.checked)} style={{ marginTop: '2px' }} />
              <div>
                <label htmlFor="enrollSmsOtp" style={{ ...LABEL, marginBottom: '2px' }}>Enroll SMS OTP</label>
                <div style={HINT}>Pre-enrolls phone as an MFA device; requires the cell number above</div>
              </div>
            </div>
          </div>

          {/* Demo data */}
          <div style={SECTION}>
            <div style={SECTION_TITLE}>Demo Data</div>
            <div style={CHECKBOX_ROW}>
              <input type="checkbox" id="seedBankingData" checked={form.seedBankingData} onChange={e => set('seedBankingData', e.target.checked)} style={{ marginTop: '2px' }} />
              <div>
                <label htmlFor="seedBankingData" style={{ ...LABEL, marginBottom: '2px' }}>Seed demo data</label>
                <div style={HINT}>Creates accounts and sample transactions using the active vertical's terminology so the user can demo features immediately</div>
              </div>
            </div>
          </div>
        </form>

        <div style={FOOTER}>
          <button type="button" style={BTN_SECONDARY} onClick={onClose} disabled={submitting}>Cancel</button>
          <button type="submit" style={BTN_PRIMARY} disabled={submitting} onClick={handleSubmit}>
            {submitting ? 'Creating...' : 'Create user'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Banner({ banner }) {
  if (banner.type === 'success') {
    const { data } = banner;
    return (
      <div style={BANNER('green')}>
        <strong>✅ User created</strong>
        <div style={{ marginTop: '6px' }}>
          {data.user.email} &bull; PingOne ID: <code>{data.pingoneId}</code>
        </div>
        <div style={{ marginTop: '8px' }}>
          <Link to={`/users/${data.pingoneId}`} style={{ color: '#166534', fontWeight: 600 }}>
            View profile &rarr;
          </Link>
        </div>
      </div>
    );
  }
  if (banner.type === 'partial') {
    const { data } = banner;
    const failed = Object.entries(data.steps).filter(([, v]) => !v).map(([k]) => k);
    return (
      <div style={BANNER('yellow')}>
        <strong>⚠️ User created with some failures</strong>
        <div style={{ marginTop: '6px' }}>
          {data.user.email} &bull; PingOne ID: <code>{data.pingoneId}</code>
        </div>
        <div style={{ marginTop: '6px' }}>
          Steps that failed: {failed.join(', ')}
        </div>
        {data.errors && (
          <ul style={{ margin: '6px 0 0', paddingLeft: '16px', fontSize: '12px' }}>
            {Object.entries(data.errors).map(([k, v]) => <li key={k}><strong>{k}:</strong> {v}</li>)}
          </ul>
        )}
        <div style={{ marginTop: '8px' }}>
          <Link to={`/users/${data.pingoneId}`} style={{ color: '#854d0e', fontWeight: 600 }}>
            View profile &rarr;
          </Link>
        </div>
      </div>
    );
  }
  return (
    <div style={BANNER('red')}>
      <strong>❌ Failed to create user</strong>
      <div style={{ marginTop: '6px' }}>{banner.message}</div>
    </div>
  );
}
