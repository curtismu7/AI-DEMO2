import { useState, useEffect, useCallback } from 'react';
import apiClient from '../services/apiClient';
import { notifySuccess, notifyError } from '../utils/appToast';
import { useEducationUI } from '../context/EducationUIContext';
import { EDU } from './education/educationIds';
import AdminSubPageShell from './AdminSubPageShell';
import PageNav from './PageNav';

// ── Helper ────────────────────────────────────────────────────────────────────

const FIELD_META = {
  stepUpEnabled: {
    label: 'Step-up MFA Enabled',
    type: 'toggle',
    description: 'When disabled, ALL transactions bypass the MFA step-up gate.',
  },
  stepUpAmountThreshold: {
    label: 'Step-up Threshold ($)',
    type: 'number',
    min: 0,
    max: 100000,
    description: 'Transfers and withdrawals at or above this amount require MFA re-authentication. Set to 0 to require step-up on ALL transactions.',
  },
  stepUpAcrValue: {
    label: 'Required ACR Value',
    type: 'text',
    description: 'Must match the PingOne Sign-On Policy name exactly (e.g. Multi_Factor).',
  },
  stepUpTransactionTypes: {
    label: 'Transaction Types Requiring Step-up',
    type: 'multiselect',
    options: ['transfer', 'withdrawal', 'deposit'],
    description: 'Only selected types will trigger step-up for high-value amounts.',
  },
  stepUpMethod: {
    label: 'Step-up MFA Method',
    type: 'select',
    options: [
      { value: 'email', label: 'Email OTP (built-in)' },
      { value: 'pingone-mfa', label: 'PingOne MFA (deviceAuthentications)' },
      { value: 'ciba', label: 'CIBA Push Approval' },
    ],
    description: 'Authentication method used for step-up challenges. "PingOne MFA" uses the deviceAuthentications API and requires PINGONE_MFA_POLICY_ID.',
  },
  stepUpWithdrawalsAlways: {
    label: 'All Withdrawals Require Step-up',
    type: 'toggle',
    description: 'When enabled, ALL withdrawal transactions require MFA step-up regardless of the amount threshold above. Recommended for demos — ensures step-up is always demonstrated.',
  },
  maxTransactionAmount: {
    label: 'Maximum Transaction Amount ($)',
    type: 'number',
    min: 0,
    max: 1000000,
    description: 'Hard stop limit: ALL transactions exceeding this amount are blocked. Applied to all user types (users, admin, agent).',
  },
  agentTransactionCountLimit: {
    label: 'Agent Transaction Count Limit',
    type: 'number',
    min: 0,
    max: 1000,
    description: 'Delegated agent stop limit by transaction count per approval window. Set to 0 for unlimited.',
  },
  agentTransactionValueLimit: {
    label: 'Agent Transaction Value Limit ($)',
    type: 'number',
    min: 0,
    max: 1000000,
    description: 'Delegated agent stop limit by cumulative transaction value per approval window. Set to 0 for unlimited.',
  },
  authorizeEnabled: {
    label: 'PingOne Authorize Integration',
    type: 'toggle',
    description: 'Route authorization decisions through PingOne Authorize. When enabled, every non-admin transaction is evaluated against the policy below. Works alongside (not instead of) the step-up threshold above.',
  },
  authorizePolicyId: {
    label: 'Authorize Policy ID',
    type: 'text',
    description: 'PingOne Authorize policy decision point (PDP) ID. Required when PingOne Authorize Integration is enabled. Configure PINGONE_AUTHORIZE_WORKER_CLIENT_ID and PINGONE_AUTHORIZE_WORKER_CLIENT_SECRET in server .env.',
  },
};

// ── Sub-components ────────────────────────────────────────────────────────────

function Toggle({ value, onChange, disabled }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!value)}
      style={{
        position: 'relative',
        display: 'inline-flex',
        width: '48px',
        height: '26px',
        borderRadius: '13px',
        border: 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: value ? 'var(--brand-navy)' : '#d1d5db',
        transition: 'background 0.2s',
        padding: 0,
        opacity: disabled ? 0.5 : 1,
      }}
      aria-pressed={value}
    >
      <span
        style={{
          position: 'absolute',
          top: '3px',
          left: value ? '25px' : '3px',
          width: '20px',
          height: '20px',
          borderRadius: '50%',
          background: 'white',
          transition: 'left 0.2s',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        }}
      />
    </button>
  );
}

function MultiSelect({ value = [], options, onChange, disabled }) {
  const toggle = (opt) => {
    if (disabled) return;
    onChange(value.includes(opt) ? value.filter(v => v !== opt) : [...value, opt]);
  };
  return (
    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
      {options.map(opt => (
        <button
          key={opt}
          type="button"
          disabled={disabled}
          onClick={() => toggle(opt)}
          style={{
            padding: '4px 12px',
            borderRadius: '20px',
            border: '2px solid',
            borderColor: value.includes(opt) ? 'var(--brand-navy)' : '#d1d5db',
            background: value.includes(opt) ? '#eff6ff' : 'white',
            color: value.includes(opt) ? 'var(--brand-navy)' : '#6b7280',
            fontWeight: value.includes(opt) ? '600' : '400',
            cursor: disabled ? 'not-allowed' : 'pointer',
            fontSize: '0.85rem',
            transition: 'all 0.15s',
          }}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

const SecuritySettings = ({ user, onLogout }) => {
  const { open } = useEducationUI();
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const fetchSettings = useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiClient.get('/api/admin/settings');
      setSettings(res.data.settings);
      setForm({ ...res.data.settings });
      setHistory(res.data.history || []);
      setDirty(false);
    } catch (err) {
      notifyError(
        err.response?.data?.error_description ||
          err.response?.data?.error ||
          'Failed to load settings.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const set = (key, value) => {
    setForm(prev => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      const res = await apiClient.put('/api/admin/settings', form);
      setSettings(res.data.settings);
      setForm({ ...res.data.settings });
      setDirty(false);
      notifySuccess('Settings saved successfully.');
      // Re-fetch history
      const full = await apiClient.get('/api/admin/settings');
      setHistory(full.data.history || []);
    } catch (err) {
      notifyError(
        err.response?.data?.error_description ||
          err.response?.data?.error ||
          'Failed to save settings.'
      );
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setForm({ ...settings });
    setDirty(false);
  };

  if (loading) {
    return (
      <AdminSubPageShell title="Security Settings" lead="Live configuration — changes take effect immediately, no restart required.">
        <div style={{ padding: '40px', textAlign: 'center', color: '#374151' }}>
          Loading settings…
        </div>
      </AdminSubPageShell>
    );
  }

  const fieldOrder = [
    'stepUpEnabled',
    'stepUpAmountThreshold',
    'stepUpAcrValue',
    'stepUpTransactionTypes',
    'stepUpMethod',
    'stepUpWithdrawalsAlways',
    'maxTransactionAmount',
    'agentTransactionCountLimit',
    'agentTransactionValueLimit',
    'authorizeEnabled',
    'authorizePolicyId',
  ];

  return (
    <AdminSubPageShell title="Security Settings" lead="Live configuration — changes take effect immediately, no restart required.">
      <PageNav user={user} onLogout={onLogout} title="Security Settings" />
      <div className="app-page-toolbar app-page-toolbar--start" style={{ flexWrap: 'wrap', gap: '8px' }}>
        <button
          type="button"
          className="app-page-toolbar-btn"
          onClick={() => open(EDU.STEP_UP, 'what')}
        >
          What is step-up MFA?
        </button>
        <button
          type="button"
          className="app-page-toolbar-btn"
          onClick={() => open(EDU.PINGONE_AUTHORIZE, 'what')}
        >
          What is PingOne Authorize?
        </button>
        <span className="page-nav__spacer" aria-hidden="true" />
        <button
          type="button"
          className="app-page-toolbar-btn app-page-toolbar-btn--accent"
          onClick={() => { window.location.href = '/admin'; }}
        >
          ← Admin Dashboard
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: '24px', alignItems: 'start' }}>

        {/* Settings form */}
        <div style={{ background: 'white', borderRadius: '8px', boxShadow: '0 1px 4px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
          <div style={{ padding: '20px 24px', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: '600', color: '#111827' }}>
              Step-up MFA &amp; Authorization Policy
            </h2>
            {dirty && <span style={{ fontSize: '0.8rem', color: '#f59e0b', fontWeight: '600' }}>● Unsaved changes</span>}
          </div>

          <div style={{ padding: '24px' }}>
            {fieldOrder.map((key) => {
              const meta = FIELD_META[key];
              if (!meta || form[key] === undefined) return null;
              return (
                <div key={key} style={{ marginBottom: '28px', paddingBottom: '28px', borderBottom: '1px solid #f3f4f6' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                    <div>
                      <div style={{ display: 'block', fontWeight: '600', color: '#374151', fontSize: '0.9rem', marginBottom: '4px' }}>
                        {meta.label}
                        {meta.disabled && <span style={{ marginLeft: '8px', fontSize: '0.75rem', background: '#f3f4f6', color: '#374151', padding: '2px 6px', borderRadius: '4px' }}>Coming soon</span>}
                      </div>
                      <p style={{ margin: 0, fontSize: '0.8rem', color: '#374151' }}>{meta.description}</p>
                    </div>
                  </div>

                  {meta.type === 'toggle' && (
                    <Toggle value={form[key]} onChange={(v) => set(key, v)} disabled={meta.disabled} />
                  )}

                  {meta.type === 'number' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ color: '#374151', fontWeight: '600' }}>$</span>
                      <input
                        type="number"
                        min={meta.min}
                        max={meta.max}
                        value={form[key]}
                        disabled={meta.disabled}
                        onChange={(e) => set(key, e.target.value)}
                        style={{ width: '160px', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.95rem', color: '#111827' }}
                      />
                    </div>
                  )}

                  {meta.type === 'text' && (
                    <input
                      type="text"
                      value={form[key]}
                      disabled={meta.disabled}
                      onChange={(e) => set(key, e.target.value)}
                      style={{ width: '100%', maxWidth: '400px', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.875rem', color: '#111827', opacity: meta.disabled ? 0.5 : 1 }}
                    />
                  )}

                  {meta.type === 'multiselect' && (
                    <MultiSelect
                      value={form[key]}
                      options={meta.options}
                      onChange={(v) => set(key, v)}
                      disabled={meta.disabled}
                    />
                  )}

                  {meta.type === 'select' && (
                    <select
                      value={form[key] || ''}
                      disabled={meta.disabled}
                      onChange={(e) => set(key, e.target.value)}
                      style={{ width: '100%', maxWidth: '400px', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.875rem', color: '#111827', background: 'white', opacity: meta.disabled ? 0.5 : 1 }}
                    >
                      {(meta.options || []).map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  )}
                </div>
              );
            })}

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: '12px', paddingTop: '8px' }}>
              <button
                type="button"
                onClick={handleSave}
                disabled={!dirty || saving}
                style={{ padding: '10px 24px', background: dirty ? 'var(--brand-navy)' : '#9ca3af', color: 'white', border: 'none', borderRadius: '6px', fontWeight: '600', fontSize: '0.875rem', cursor: dirty ? 'pointer' : 'not-allowed', transition: 'background 0.2s' }}
              >
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
              <button
                type="button"
                onClick={handleReset}
                disabled={!dirty || saving}
                style={{ padding: '10px 24px', background: 'white', color: '#374151', border: '1px solid #d1d5db', borderRadius: '6px', fontWeight: '500', fontSize: '0.875rem', cursor: dirty ? 'pointer' : 'not-allowed' }}
              >
                Discard
              </button>
            </div>
          </div>
        </div>

        {/* Change history sidebar */}
        <div style={{ background: 'white', borderRadius: '8px', boxShadow: '0 1px 4px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #e5e7eb' }}>
            <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: '600', color: '#111827' }}>Change History</h2>
            <p style={{ margin: '4px 0 0', fontSize: '0.78rem', color: '#374151' }}>Last 50 changes · in-memory</p>
          </div>
          <div style={{ maxHeight: '520px', overflowY: 'auto', padding: '8px 0' }}>
            {history.length === 0 ? (
              <p style={{ padding: '16px 20px', color: '#374151', fontSize: '0.85rem', margin: 0 }}>No changes yet.</p>
            ) : (
              history.map((entry, i) => (
                <div key={`${entry.timestamp || 'unknown'}-${entry.changedBy || 'unknown'}-${i}`} style={{ padding: '12px 20px', borderBottom: '1px solid #f9fafb' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <span style={{ fontWeight: '600', fontSize: '0.8rem', color: '#374151' }}>{entry.changedBy}</span>
                    <span style={{ fontSize: '0.75rem', color: '#374151' }}>
                      {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  {Object.entries(entry.changes).map(([k, v]) => (
                    <div key={k} style={{ fontSize: '0.78rem', color: '#374151', marginBottom: '2px' }}>
                      <span style={{ color: '#374151', fontWeight: '500' }}>{k}:</span>{' '}
                      <span style={{ textDecoration: 'line-through', color: '#d1d5db' }}>
                        {JSON.stringify(entry.previous[k])}
                      </span>{' '}→ <span style={{ color: '#059669' }}>{JSON.stringify(v)}</span>
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
      {/* Auth Gate Summary — read-only audit view of active enforcement rules */}
      {settings && (
        <div style={{ marginTop: '32px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: '12px', overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #f3f4f6' }}>
            <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: '600', color: '#111827' }}>Auth Gate Summary</h3>
            <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: '#374151' }}>
              Current enforcement rules — live values from runtime settings above.
            </p>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <tbody>
              <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
                <th style={{ padding: '10px 20px', textAlign: 'left', color: '#374151', fontWeight: '600', width: '45%' }}>Login / Step-up MFA</th>
                <td style={{ padding: '10px 20px', color: '#374151' }}>
                  {settings.stepUpEnabled
                    ? `✅ Enabled — method: ${settings.stepUpMethod || 'email'}`
                    : '❌ Disabled'}
                </td>
              </tr>
              <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
                <th style={{ padding: '10px 20px', textAlign: 'left', color: '#374151', fontWeight: '600' }}>Step-up threshold</th>
                <td style={{ padding: '10px 20px', color: '#374151' }}>
                  {settings.stepUpWithdrawalsAlways
                    ? '⚡ All withdrawals (stepUpWithdrawalsAlways)'
                    : settings.stepUpAmountThreshold > 0
                      ? `$${settings.stepUpAmountThreshold}+ transactions`
                      : 'All amounts ($0 threshold)'}
                </td>
              </tr>
              <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
                <th style={{ padding: '10px 20px', textAlign: 'left', color: '#374151', fontWeight: '600' }}>Step-up transaction types</th>
                <td style={{ padding: '10px 20px', color: '#374151' }}>
                  {Array.isArray(settings.stepUpTransactionTypes) && settings.stepUpTransactionTypes.length > 0
                    ? settings.stepUpTransactionTypes.join(', ')
                    : '—'}
                </td>
              </tr>
              <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
                <th style={{ padding: '10px 20px', textAlign: 'left', color: '#374151', fontWeight: '600' }}>PingOne Authorize gate</th>
                <td style={{ padding: '10px 20px', color: '#374151' }}>
                  {settings.authorizeEnabled
                    ? `✅ Enabled (policy: ${settings.authorizePolicyId || 'not set'})`
                    : '❌ Disabled'}
                </td>
              </tr>
              <tr>
                <th style={{ padding: '10px 20px', textAlign: 'left', color: '#374151', fontWeight: '600' }}>Session required for tool calls</th>
                <td style={{ padding: '10px 20px', color: '#374151' }}>✅ Always (requireSession middleware)</td>
              </tr>
              <tr style={{ borderTop: '1px solid #f3f4f6' }}>
                <th style={{ padding: '10px 20px', textAlign: 'left', color: '#374151', fontWeight: '600' }}>Agent transaction stop limits</th>
                <td style={{ padding: '10px 20px', color: '#374151' }}>
                  count: {settings.agentTransactionCountLimit > 0 ? settings.agentTransactionCountLimit : 'unlimited'} · value: {settings.agentTransactionValueLimit > 0 ? `$${settings.agentTransactionValueLimit}` : 'unlimited'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </AdminSubPageShell>
  );
};

export default SecuritySettings;
