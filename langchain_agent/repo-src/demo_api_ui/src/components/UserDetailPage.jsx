import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import bffAxios from '../services/bffAxios';

const PAGE = { maxWidth: '860px', margin: '0 auto', padding: '32px 24px' };
const BACK = { background: 'none', border: 'none', cursor: 'pointer', color: '#2563eb', fontSize: '14px', marginBottom: '20px', display: 'inline-flex', alignItems: 'center', gap: '4px', padding: 0 };
const CARD = { background: '#fff', border: '1px solid #e5e7eb', borderRadius: '10px', padding: '24px', marginBottom: '20px' };
const CARD_HEADER = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' };
const CARD_TITLE = { fontSize: '16px', fontWeight: 700, margin: 0 };
const FIELD = { marginBottom: '16px' };
const LABEL = { display: 'block', fontSize: '13px', fontWeight: 600, color: '#6b7280', marginBottom: '4px' };
const INPUT = { width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px', boxSizing: 'border-box' };
const SELECT = { ...INPUT };
const BTN_PRIMARY = { padding: '8px 18px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '14px', fontWeight: 600, cursor: 'pointer' };
const BTN_SECONDARY = { padding: '8px 18px', background: '#fff', color: '#374151', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px', cursor: 'pointer' };
const BTN_DANGER = { padding: '6px 14px', background: '#fff', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: '6px', fontSize: '13px', cursor: 'pointer' };
const TAG = (color) => ({
  display: 'inline-block', padding: '2px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: 600,
  background: color === 'green' ? '#dcfce7' : color === 'blue' ? '#dbeafe' : '#f3f4f6',
  color: color === 'green' ? '#166534' : color === 'blue' ? '#1e40af' : '#374151',
});
const HINT = { fontSize: '12px', color: '#9ca3af', marginTop: '2px' };
const GRID2 = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' };
const SAVE_ROW = { display: 'flex', justifyContent: 'flex-end', marginTop: '8px' };
const MSG = (ok) => ({ fontSize: '13px', color: ok ? '#166534' : '#dc2626', marginTop: '6px' });

export default function UserDetailPage() {
  const { userId } = useParams();
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [basicForm, setBasicForm] = useState({ firstName: '', lastName: '', email: '', mobilePhone: '' });
  const [basicMsg, setBasicMsg] = useState(null);
  const [basicSaving, setBasicSaving] = useState(false);

  const [delegateEnabled, setDelegateEnabled] = useState(false);
  const [delegateSub, setDelegateSub] = useState('');
  const [delegateSearch, setDelegateSearch] = useState('');
  const [delegateResults, setDelegateResults] = useState([]);
  const [delegateMsg, setDelegateMsg] = useState(null);
  const [delegateSaving, setDelegateSaving] = useState(false);

  const [agentRestriction, setAgentRestriction] = useState('write');
  const [agentMsg, setAgentMsg] = useState(null);
  const [agentSaving, setAgentSaving] = useState(false);

  const [devices, setDevices] = useState([]);
  const [devicesLoading, setDevicesLoading] = useState(false);

  const [accounts, setAccounts] = useState([]);
  const [accountsLoading, setAccountsLoading] = useState(false);

  const loadUser = useCallback(async () => {
    try {
      setLoading(true);
      const r = await bffAxios.get(`/api/users/${userId}`);
      const u = r.data;
      setUser(u);
      setBasicForm({
        firstName: u.firstName || '',
        lastName: u.lastName || '',
        email: u.email || '',
        mobilePhone: u.mobilePhone || '',
      });
      setAgentRestriction(u.agentRestrictions || 'write');
    } catch (err) {
      setError(err.response?.data?.message || err.message);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  const loadDevices = useCallback(async () => {
    setDevicesLoading(true);
    try {
      const r = await bffAxios.get('/api/auth/mfa/devices');
      setDevices(r.data.devices || []);
    } catch {
      setDevices([]);
    } finally {
      setDevicesLoading(false);
    }
  }, []);

  const loadAccounts = useCallback(async () => {
    setAccountsLoading(true);
    try {
      const r = await bffAxios.get('/api/accounts', { params: { userId } });
      setAccounts(r.data || []);
    } catch {
      setAccounts([]);
    } finally {
      setAccountsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    loadUser();
    loadDevices();
    loadAccounts();
  }, [loadUser, loadDevices, loadAccounts]);

  const searchDelegate = useCallback(async (q) => {
    if (q.length < 3) { setDelegateResults([]); return; }
    try {
      const r = await bffAxios.get(`/api/users/search/${encodeURIComponent(q)}`);
      setDelegateResults(r.data.users || []);
    } catch { setDelegateResults([]); }
  }, []);

  useEffect(() => {
    if (!delegateEnabled) return;
    const t = setTimeout(() => searchDelegate(delegateSearch), 400);
    return () => clearTimeout(t);
  }, [delegateSearch, delegateEnabled, searchDelegate]);

  const saveBasic = async () => {
    setBasicSaving(true); setBasicMsg(null);
    try {
      await bffAxios.put(`/api/users/${userId}`, {
        firstName: basicForm.firstName,
        lastName: basicForm.lastName,
        email: basicForm.email,
        mobilePhone: basicForm.mobilePhone,
      });
      setBasicMsg({ ok: true, text: '✅ Saved' });
      loadUser();
    } catch (err) {
      setBasicMsg({ ok: false, text: err.response?.data?.message || 'Save failed' });
    } finally {
      setBasicSaving(false);
    }
  };

  const saveDelegate = async () => {
    setDelegateSaving(true); setDelegateMsg(null);
    try {
      if (delegateEnabled && delegateSub) {
        await bffAxios.patch(`/api/users/${userId}/attributes`, { mayAct: { sub: delegateSub } });
      } else if (!delegateEnabled) {
        await bffAxios.patch(`/api/users/${userId}/attributes`, { mayAct: null });
      }
      setDelegateMsg({ ok: true, text: '✅ Saved' });
    } catch (err) {
      setDelegateMsg({ ok: false, text: err.response?.data?.message || 'Save failed' });
    } finally {
      setDelegateSaving(false);
    }
  };

  const saveAgentRestriction = async () => {
    setAgentSaving(true); setAgentMsg(null);
    try {
      await bffAxios.patch(`/api/admin/management/users/${userId}/agent-restrictions`, { agentRestrictions: agentRestriction });
      setAgentMsg({ ok: true, text: '✅ Saved' });
    } catch (err) {
      setAgentMsg({ ok: false, text: err.response?.data?.message || 'Save failed' });
    } finally {
      setAgentSaving(false);
    }
  };

  const removeDevice = async (deviceId) => {
    try {
      await bffAxios.delete(`/api/auth/mfa/devices/${deviceId}`);
      loadDevices();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to remove device');
    }
  };

  if (loading) return <div style={{ padding: '40px', textAlign: 'center' }}>Loading...</div>;
  if (error)   return <div style={{ padding: '40px', color: '#dc2626' }}>❌ {error}</div>;
  if (!user)   return null;

  return (
    <div style={PAGE}>
      <button type="button" style={BACK} onClick={() => navigate(-1)}>&#8592; Back</button>

      <h1 style={{ fontSize: '24px', fontWeight: 700, marginBottom: '4px' }}>
        {user.firstName} {user.lastName}
      </h1>
      <div style={{ color: '#6b7280', fontSize: '14px', marginBottom: '28px' }}>
        {user.email} &bull; PingOne ID: <code style={{ fontSize: '12px' }}>{userId}</code>
      </div>

      {/* Basic info */}
      <div style={CARD}>
        <div style={CARD_HEADER}>
          <h2 style={CARD_TITLE}>Basic Info</h2>
        </div>
        <div style={GRID2}>
          <div style={FIELD}>
            <label style={LABEL}>First name</label>
            <input style={INPUT} value={basicForm.firstName} onChange={e => setBasicForm(f => ({ ...f, firstName: e.target.value }))} />
          </div>
          <div style={FIELD}>
            <label style={LABEL}>Last name</label>
            <input style={INPUT} value={basicForm.lastName} onChange={e => setBasicForm(f => ({ ...f, lastName: e.target.value }))} />
          </div>
        </div>
        <div style={FIELD}>
          <label style={LABEL}>Email</label>
          <input type="email" style={INPUT} value={basicForm.email} onChange={e => setBasicForm(f => ({ ...f, email: e.target.value }))} />
        </div>
        <div style={FIELD}>
          <label style={LABEL}>Mobile / cell</label>
          <input type="tel" style={INPUT} value={basicForm.mobilePhone} onChange={e => setBasicForm(f => ({ ...f, mobilePhone: e.target.value }))} />
        </div>
        {basicMsg && <div style={MSG(basicMsg.ok)}>{basicMsg.text}</div>}
        <div style={SAVE_ROW}>
          <button type="button" style={BTN_PRIMARY} disabled={basicSaving} onClick={saveBasic}>
            {basicSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {/* Delegation */}
      <div style={CARD}>
        <div style={CARD_HEADER}>
          <h2 style={CARD_TITLE}>Agent Delegation</h2>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
          <input type="checkbox" id="delegateEnabled" checked={delegateEnabled} onChange={e => setDelegateEnabled(e.target.checked)} />
          <label htmlFor="delegateEnabled" style={{ fontSize: '14px', fontWeight: 600 }}>Enable delegation</label>
        </div>
        <div style={HINT}>Sets <code>may_act.sub</code> — enables RFC 8693 token exchange for agent delegation demos</div>
        {delegateEnabled && (
          <div style={{ marginTop: '14px' }}>
            <label style={LABEL}>Delegate target (search by email)</label>
            <input
              style={INPUT}
              placeholder="Search PingOne users..."
              value={delegateSearch}
              onChange={e => { setDelegateSearch(e.target.value); setDelegateSub(''); }}
            />
            {delegateResults.length > 0 && !delegateSub && (
              <ul style={{ listStyle: 'none', margin: '4px 0 0', padding: 0, border: '1px solid #d1d5db', borderRadius: '6px', maxHeight: '160px', overflowY: 'auto' }}>
                {delegateResults.map(u => (
                  <li key={u.id}>
                    <button
                      type="button"
                      style={{ width: '100%', textAlign: 'left', padding: '8px 12px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px' }}
                      onClick={() => { setDelegateSub(u.id); setDelegateSearch(`${u.firstName} ${u.lastName} <${u.email}>`); setDelegateResults([]); }}
                    >
                      {u.firstName} {u.lastName} &lt;{u.email}&gt;
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {delegateSub && <div style={{ fontSize: '13px', color: '#166534', marginTop: '4px' }}>✅ sub: {delegateSub}</div>}
          </div>
        )}
        {delegateMsg && <div style={MSG(delegateMsg.ok)}>{delegateMsg.text}</div>}
        <div style={SAVE_ROW}>
          <button type="button" style={BTN_PRIMARY} disabled={delegateSaving} onClick={saveDelegate}>
            {delegateSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {/* Agent restrictions */}
      <div style={CARD}>
        <div style={CARD_HEADER}>
          <h2 style={CARD_TITLE}>Agent Restrictions</h2>
        </div>
        <div style={FIELD}>
          <label style={LABEL}>Permission level</label>
          <select style={SELECT} value={agentRestriction} onChange={e => setAgentRestriction(e.target.value)}>
            <option value="read">read — view only</option>
            <option value="write">write — full access (default)</option>
            <option value="none">none — agent blocked</option>
          </select>
        </div>
        {agentMsg && <div style={MSG(agentMsg.ok)}>{agentMsg.text}</div>}
        <div style={SAVE_ROW}>
          <button type="button" style={BTN_PRIMARY} disabled={agentSaving} onClick={saveAgentRestriction}>
            {agentSaving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {/* MFA devices */}
      <div style={CARD}>
        <div style={CARD_HEADER}>
          <h2 style={CARD_TITLE}>MFA Devices</h2>
        </div>
        {devicesLoading ? (
          <div style={{ color: '#6b7280', fontSize: '14px' }}>Loading devices...</div>
        ) : devices.length === 0 ? (
          <div style={{ color: '#6b7280', fontSize: '14px' }}>No MFA devices enrolled.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                <th style={{ textAlign: 'left', padding: '8px 0', color: '#6b7280', fontWeight: 600 }}>Type</th>
                <th style={{ textAlign: 'left', padding: '8px 0', color: '#6b7280', fontWeight: 600 }}>Status</th>
                <th style={{ textAlign: 'left', padding: '8px 0', color: '#6b7280', fontWeight: 600 }}>Identifier</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {devices.map(d => (
                <tr key={d.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '10px 0' }}><span style={TAG('blue')}>{d.type}</span></td>
                  <td style={{ padding: '10px 0' }}><span style={TAG(d.status === 'ACTIVE' ? 'green' : 'gray')}>{d.status}</span></td>
                  <td style={{ padding: '10px 0', color: '#374151' }}>{d.email || d.phone || d.id}</td>
                  <td style={{ padding: '10px 0', textAlign: 'right' }}>
                    <button type="button" style={BTN_DANGER} onClick={() => removeDevice(d.id)}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Banking accounts */}
      <div style={CARD}>
        <div style={CARD_HEADER}>
          <h2 style={CARD_TITLE}>Demo Accounts</h2>
        </div>
        {accountsLoading ? (
          <div style={{ color: '#6b7280', fontSize: '14px' }}>Loading accounts...</div>
        ) : accounts.length === 0 ? (
          <div style={{ color: '#6b7280', fontSize: '14px' }}>No demo accounts seeded yet.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                <th style={{ textAlign: 'left', padding: '8px 0', color: '#6b7280', fontWeight: 600 }}>Account</th>
                <th style={{ textAlign: 'left', padding: '8px 0', color: '#6b7280', fontWeight: 600 }}>Type</th>
                <th style={{ textAlign: 'right', padding: '8px 0', color: '#6b7280', fontWeight: 600 }}>Balance</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map(a => (
                <tr key={a.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '10px 0', color: '#374151' }}>{a.name || a.id}</td>
                  <td style={{ padding: '10px 0' }}><span style={TAG('blue')}>{a.accountType}</span></td>
                  <td style={{ padding: '10px 0', textAlign: 'right', fontWeight: 600 }}>
                    {typeof a.balance === 'number' ? `$${a.balance.toLocaleString()}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
