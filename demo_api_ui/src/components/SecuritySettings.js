// /settings: live step-up MFA, transaction-limit and PingOne Authorize settings.
//
// Layout follows the Ping UI Standard through the shared primitives (components/pingUi,
// docs/ping-ui-primitives.md): P2 banner first, P3 frame, P4 cards, P5 key-value, P7 chips, P9 buttons.
// Skipped: P6 inspector and P8 diagram (this page has neither). The form controls (switch, option pills,
// inputs), the history rail and its divider stay page-local (SecuritySettings.css).
// Dropped with the old AdminSubPageShell hero: its "Dark mode" button (the app header has the theme switch)
// and the Back / Home PageNav row (the side nav and "← Admin Dashboard" cover it), same as /demo-config.
//
// P9, "exactly one primary per view", by state:
//   loading          no buttons.
//   load failed      "Try again" is the only primary: nothing else on the page can act until settings load.
//   ready / saving   "Save Changes" is the only primary: it is the one control that writes to the server.
//                    Discard, the two "What is..." buttons, "← Admin Dashboard", the switches and the
//                    option pills are secondaries / form controls.
// Save, Discard and Try again use aria-disabled, never the disabled attribute, so keyboard focus stays on the
// control that was activated (a saved form turns Save inert and focus must not drop to the page body). The
// reason ("Nothing to save", "Saving…") is visible text, wired up with aria-describedby.
import { useState, useEffect, useCallback, useRef } from 'react';
import apiClient from '../services/apiClient';
import { useEducationUI } from '../context/EducationUIContext';
import { EDU } from './education/educationIds';
import useDividerDrag from '../hooks/useDividerDrag';
import InlineSpinner from './shared/InlineSpinner';
import PageHeader from './common/PageHeader';
import { PingPage, SimBanner, PageFrame, Section, CardGrid, Card, StatusChip, KvList } from './pingUi';
import './SecuritySettings.css';

// ── Field definitions ─────────────────────────────────────────────────────────

const FIELD_META = {
  stepUpEnabled: {
    label: 'Step-up MFA Enabled',
    type: 'toggle',
    description: 'When disabled, ALL transactions bypass the MFA step-up gate.',
  },
  stepUpAmountThreshold: {
    label: 'Step-up Threshold ($)',
    type: 'number',
    prefix: '$',
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
      { value: 'ciba', label: 'CIBA approval (mock phone or email)' },
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
    prefix: '$',
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
    prefix: '$',
    min: 0,
    max: 1000000,
    description: 'Delegated agent stop limit by cumulative transaction value per approval window. Set to 0 for unlimited.',
  },
  authorizeEnabled: {
    label: 'PingOne Authorize Integration',
    type: 'status',
    description: 'Authorization decisions are routed through the PingOne Authorize engine. Always on by design — the effective state below is computed by the server and is read-only.',
  },
  authorizePolicyId: {
    label: 'Authorize Policy ID',
    type: 'text',
    description: 'PingOne Authorize policy decision point (PDP) ID. Required when PingOne Authorize Integration is enabled. Configure PINGONE_AUTHORIZE_WORKER_CLIENT_ID and PINGONE_AUTHORIZE_WORKER_CLIENT_SECRET in server .env.',
  },
};

const FIELD_ORDER = [
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

const RELATED = [
  { href: '/feature-flags', label: 'Feature Flags', desc: 'Runtime toggles (HITL, heuristics, agent modes)' },
  { href: '/llm-config', label: 'LLM Provider', desc: 'Model selection (Helix, Anthropic, Google, local)' },
  { href: '/configure', label: 'PingOne Setup', desc: 'Environment config, credentials, quick-start' },
  { href: '/pingone-authorize', label: 'Authorize Console', desc: 'Live policy testing, decision endpoints' },
];

const errorText = (err, fallback) =>
  err?.response?.data?.error_description || err?.response?.data?.error || fallback;

// ── Main component ────────────────────────────────────────────────────────────

const SecuritySettings = () => {
  const { open } = useEducationUI();
  const { size: historyWidth, handleProps: historyHandleProps } = useDividerDrag({
    min: 280,
    max: 640,
    initial: 380,
    storageKey: 'security-settings-history-width',
    invert: true, // history rail sits right of its divider
  });
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState(null);
  const [authorizeStatus, setAuthorizeStatus] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [retrying, setRetrying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  // Result of the last save: { tone: 'ok' | 'danger', text }. Cleared on the next edit.
  const [status, setStatus] = useState(null);
  const formRef = useRef(null);
  const focusFormNext = useRef(false);

  // authorizeEnabled is read-only status (engine is always-on by design) —
  // keep it out of the editable form so it is never sent in the PUT payload.
  const toEditableForm = (s) => {
    const { authorizeEnabled: _readOnly, ...editable } = s || {};
    return editable;
  };

  const fetchSettings = useCallback(async () => {
    try {
      const res = await apiClient.get('/api/admin/settings');
      setSettings(res.data.settings);
      setForm(toEditableForm(res.data.settings));
      setAuthorizeStatus(res.data.authorizeStatus || null);
      setHistory(res.data.history || []);
      setDirty(false);
      setLoadError(null);
    } catch (err) {
      setLoadError(errorText(err, 'Failed to load settings.'));
    } finally {
      setLoading(false);
      setRetrying(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  // After "Try again" succeeds its button is gone: give keyboard focus to the form region.
  useEffect(() => {
    if (form && focusFormNext.current) {
      focusFormNext.current = false;
      formRef.current?.focus();
    }
  }, [form]);

  const retry = () => {
    if (retrying) return;
    focusFormNext.current = true;
    setRetrying(true);
    fetchSettings();
  };

  const set = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
    setStatus(null);
  };

  const handleSave = async () => {
    if (!dirty || saving) return;
    try {
      setSaving(true);
      setStatus(null);
      const res = await apiClient.put('/api/admin/settings', form);
      setSettings(res.data.settings);
      setForm(toEditableForm(res.data.settings));
      setDirty(false);
      setStatus({ tone: 'ok', text: 'Settings saved successfully.' });
      // Re-fetch history. The save already succeeded, so a failure here only leaves the list stale.
      try {
        const full = await apiClient.get('/api/admin/settings');
        setHistory(full.data.history || []);
        setAuthorizeStatus(full.data.authorizeStatus || null);
      } catch {
        // keep the previous history and status
      }
    } catch (err) {
      setStatus({ tone: 'danger', text: errorText(err, 'Failed to save settings.') });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (!dirty || saving) return;
    setForm(toEditableForm(settings));
    setDirty(false);
    setStatus(null);
  };

  const renderField = (key) => {
    const meta = FIELD_META[key];
    // 'status' rows are read-only server-computed values — they are
    // intentionally absent from the editable form state.
    if (!meta || (meta.type !== 'status' && form[key] === undefined)) return null;
    const id = `sset-${key}`;
    const labelId = `${id}-label`;
    const descId = `${id}-desc`;
    const labelIsFor = meta.type === 'toggle' || meta.type === 'number' || meta.type === 'text' || meta.type === 'select';
    return (
      <div key={key} className="sset-field" data-testid={`sset-field-${key}`}>
        {labelIsFor ? (
          <label className="sset-field__label" id={labelId} htmlFor={id}>{meta.label}</label>
        ) : (
          <div className="sset-field__label" id={labelId}>{meta.label}</div>
        )}
        <p className="sset-field__desc" id={descId}>{meta.description}</p>

        {meta.type === 'toggle' && (
          <Toggle id={id} value={form[key]} onChange={(v) => set(key, v)} describedBy={descId} />
        )}

        {meta.type === 'status' && (
          <p className="pu-status-line">
            {authorizeStatus ? (
              authorizeStatus.authorizeEnabledConfig ? (
                <>
                  <StatusChip tone="ok">Active</StatusChip>
                  <span>mode: {authorizeStatus.activeEngine}</span>
                </>
              ) : (
                <StatusChip tone="warn">Inactive</StatusChip>
              )
            ) : (
              <StatusChip tone="neutral">Status unavailable</StatusChip>
            )}
          </p>
        )}

        {meta.type === 'number' && (
          <div className="sset-number">
            {meta.prefix ? <span className="sset-number__prefix" aria-hidden="true">{meta.prefix}</span> : null}
            <input
              id={id}
              type="number"
              className="sset-input sset-input--number"
              min={meta.min}
              max={meta.max}
              value={form[key]}
              aria-describedby={descId}
              onChange={(e) => set(key, e.target.value)}
            />
          </div>
        )}

        {meta.type === 'text' && (
          <input
            id={id}
            type="text"
            className="sset-input sset-input--text"
            value={form[key]}
            aria-describedby={descId}
            onChange={(e) => set(key, e.target.value)}
          />
        )}

        {meta.type === 'multiselect' && (
          <MultiSelect
            value={form[key]}
            options={meta.options}
            onChange={(v) => set(key, v)}
            labelledBy={labelId}
            describedBy={descId}
          />
        )}

        {meta.type === 'select' && (
          <select
            id={id}
            className="pu-select sset-select"
            value={form[key] || ''}
            aria-describedby={descId}
            onChange={(e) => set(key, e.target.value)}
          >
            {(meta.options || []).map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        )}
      </div>
    );
  };

  const gateItems = settings && [
    {
      label: 'Login / Step-up MFA',
      value: settings.stepUpEnabled ? (
        <>
          <StatusChip tone="info">Enabled</StatusChip> method: {settings.stepUpMethod || 'email'}
        </>
      ) : (
        <StatusChip tone="warn">Disabled</StatusChip>
      ),
    },
    {
      label: 'Step-up threshold',
      value: settings.stepUpWithdrawalsAlways
        ? 'All withdrawals (stepUpWithdrawalsAlways)'
        : settings.stepUpAmountThreshold > 0
          ? `$${settings.stepUpAmountThreshold}+ transactions`
          : 'All amounts ($0 threshold)',
    },
    {
      label: 'Step-up transaction types',
      value: Array.isArray(settings.stepUpTransactionTypes) && settings.stepUpTransactionTypes.length > 0
        ? settings.stepUpTransactionTypes.join(', ')
        : '—',
    },
    {
      label: 'PingOne Authorize gate',
      value: authorizeStatus ? (
        authorizeStatus.authorizeEnabledConfig ? (
          <>
            <StatusChip tone="ok">Active</StatusChip> mode: {authorizeStatus.activeEngine}, policy: {settings.authorizePolicyId || 'not set'}
          </>
        ) : (
          <StatusChip tone="warn">Inactive</StatusChip>
        )
      ) : (
        <StatusChip tone="neutral">Status unavailable</StatusChip>
      ),
    },
    {
      label: 'Session required for tool calls',
      value: (
        <>
          <StatusChip tone="neutral">Always</StatusChip> requireSession middleware
        </>
      ),
    },
    {
      label: 'Agent transaction stop limits',
      value: `count: ${settings.agentTransactionCountLimit > 0 ? settings.agentTransactionCountLimit : 'unlimited'} · value: ${settings.agentTransactionValueLimit > 0 ? `$${settings.agentTransactionValueLimit}` : 'unlimited'}`,
    },
  ];

  return (
    <PingPage className="sset-page">
      <SimBanner data-testid="sset-banner">
        <strong>LIVE SETTINGS</strong> — nothing on this page is simulated. Save Changes writes to the running API
        server and applies to every session on it at once, no restart needed. The values are held in the server&rsquo;s
        memory (the history too), so a restart can reset them. The PingOne Authorize status is only displayed here: the
        server works it out from the engine now in use.
      </SimBanner>
      <PageHeader
        eyebrow="Admin · Security"
        title="Security Settings"
        summary="Live configuration — changes take effect immediately, no restart required."
      />
      <PageFrame>
        {loading ? (
          <div className="sset-loading"><InlineSpinner label="Loading settings…" /></div>
        ) : (
          <>
            <div className="pu-actions sset-toolbar">
              <button type="button" className="pu-btn" onClick={() => open(EDU.STEP_UP, 'what')}>
                What is step-up MFA?
              </button>
              <button type="button" className="pu-btn" onClick={() => open(EDU.PINGONE_AUTHORIZE, 'what')}>
                What is PingOne Authorize?
              </button>
              <span className="sset-toolbar__spacer" aria-hidden="true" />
              <button type="button" className="pu-btn" onClick={() => { window.location.href = '/admin'; }}>
                ← Admin Dashboard
              </button>
            </div>

            {form && (
              <Section id="sset-related-h" kicker="1 · Related settings" title="Other places settings live">
                <CardGrid>
                  {RELATED.map(({ href, label, desc }) => (
                    <Card key={href} tone="neutral">
                      <a className="sset-related" href={href}>
                        <span className="sset-related__label">{label}</span>
                        <span className="sset-related__desc">{desc}</span>
                      </a>
                    </Card>
                  ))}
                </CardGrid>
              </Section>
            )}

            <Section
              id="sset-policy-h"
              kicker="2 · Policy"
              title="Step-up MFA & Authorization Policy"
              lede={form ? 'Edits stay in the form until you save them. Saving applies them on the server straight away.' : undefined}
            >
              <div className="sset-layout" style={{ '--sset-rail-w': `${historyWidth}px` }}>
                <Card tone={form ? undefined : 'danger'}>
                  <div
                    className="sset-form"
                    ref={formRef}
                    tabIndex={-1}
                    role="region"
                    aria-label="Security settings form"
                  >
                    {form ? (
                      <>
                        <p className="pu-status-line">
                          <StatusChip tone={dirty ? 'warn' : 'neutral'}>{dirty ? 'Unsaved changes' : 'No changes'}</StatusChip>
                        </p>

                        {FIELD_ORDER.map(renderField)}

                        <div role="status" aria-live="polite" className="sset-result" data-testid="sset-status">
                          {status?.tone === 'ok' && (
                            <p className="pu-status-line">
                              <StatusChip tone="ok">Saved</StatusChip>
                              <span>{status.text}</span>
                            </p>
                          )}
                        </div>
                        {status?.tone === 'danger' && (
                          <p className="pu-status-line sset-result" role="alert" data-testid="sset-error">
                            <StatusChip tone="danger">Not saved</StatusChip>
                            <span>{status.text}</span>
                          </p>
                        )}
                      </>
                    ) : (
                      <div role="alert" data-testid="sset-load-error">
                        <p className="pu-status-line">
                          <StatusChip tone="danger">Error</StatusChip>
                          <span>{loadError}</span>
                        </p>
                        <p className="pu-note">
                          Settings could not be read from the server, so nothing here can be edited yet.
                        </p>
                      </div>
                    )}

                    {/* The one primary of the view, once in the source: Save Changes when the form is loaded,
                        Try again when it is not. Discard is a secondary and only exists with the form. */}
                    <div className="pu-actions">
                      <button
                        type="button"
                        className="pu-btn pu-btn--primary"
                        aria-disabled={(form ? !dirty || saving : retrying) ? 'true' : undefined}
                        aria-describedby="sset-action-reason"
                        onClick={form ? handleSave : retry}
                      >
                        {form ? (saving ? 'Saving…' : 'Save Changes') : (retrying ? 'Trying again…' : 'Try again')}
                      </button>
                      {form && (
                        <button
                          type="button"
                          className="pu-btn"
                          aria-disabled={!dirty || saving ? 'true' : undefined}
                          aria-describedby="sset-action-reason"
                          onClick={handleReset}
                        >
                          Discard
                        </button>
                      )}
                    </div>
                    <p className="pu-note" id="sset-action-reason">
                      {!form
                        ? (retrying ? 'Reading settings from the server…' : 'Try again reads the settings from the server.')
                        : saving
                          ? 'Saving to the server…'
                          : dirty
                            ? 'Save applies your edits on the server now; Discard puts back the saved values.'
                            : 'Nothing to save or discard until you change a field.'}
                    </p>
                  </div>
                </Card>

                {form && (
                  <>
                    <div className="divider-drag-handle" aria-label="Resize change history" {...historyHandleProps} />

                    <Card tone="neutral" className="sset-history-card">
                      <h3 className="pu-h3">Change History</h3>
                      <p className="pu-note sset-history__sub">Last 50 changes · in-memory</p>
                      <div
                        className="sset-history"
                        tabIndex={0}
                        role="region"
                        aria-label="Recent setting changes"
                      >
                        {history.length === 0 ? (
                          <p className="pu-empty pu-note">No changes yet.</p>
                        ) : (
                          <ul className="sset-history__list">
                            {history.map((entry, i) => (
                              <li key={`${entry.timestamp || 'unknown'}-${entry.changedBy || 'unknown'}-${i}`} className="sset-history__entry">
                                <div className="sset-history__head">
                                  <span className="sset-history__who">{entry.changedBy}</span>
                                  <time className="sset-history__time" dateTime={entry.timestamp}>
                                    {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                  </time>
                                </div>
                                {Object.entries(entry.changes).map(([k, v]) => (
                                  <div key={k} className="sset-history__change">
                                    <span className="sset-history__key">{k}:</span>{' '}
                                    <del>{JSON.stringify(entry.previous?.[k])}</del>{' '}→ <ins>{JSON.stringify(v)}</ins>
                                  </div>
                                ))}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </Card>
                  </>
                )}
              </div>
            </Section>

            {/* Auth Gate Summary — read-only audit view of active enforcement rules */}
            {form && (
              <Section
                id="sset-gate-h"
                kicker="3 · Summary"
                title="Auth Gate Summary"
                lede="Current enforcement rules, read from the saved settings above (not from edits you have not saved)."
              >
                <Card tone="neutral">
                  <KvList items={gateItems} />
                </Card>
              </Section>
            )}
          </>
        )}
      </PageFrame>
    </PingPage>
  );
};

export default SecuritySettings;

// ── Sub-components (function declarations, hoisted: the pattern check wants the banner first in the file) ──

/** A switch: a button with aria-pressed, named by its <label htmlFor>. The On / Off chip beside it carries the word. */
function Toggle({ id, value, onChange, describedBy }) {
  return (
    <div className="sset-toggle-row">
      <button
        type="button"
        id={id}
        className="sset-toggle"
        aria-pressed={Boolean(value)}
        aria-describedby={describedBy}
        onClick={() => onChange(!value)}
      >
        <span className="sset-toggle__thumb" aria-hidden="true" />
      </button>
      <StatusChip tone={value ? 'info' : 'neutral'}>{value ? 'On' : 'Off'}</StatusChip>
    </div>
  );
}

/** Option pills: each is a button with aria-pressed; a selected one also shows a check mark (never colour alone). */
function MultiSelect({ value = [], options, onChange, labelledBy, describedBy }) {
  const toggle = (opt) => onChange(value.includes(opt) ? value.filter((v) => v !== opt) : [...value, opt]);
  return (
    <div className="sset-pills" role="group" aria-labelledby={labelledBy} aria-describedby={describedBy}>
      {options.map((opt) => {
        const on = value.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            className="sset-pill"
            aria-pressed={on}
            onClick={() => toggle(opt)}
          >
            {on ? <span aria-hidden="true">✓ </span> : null}
            {opt}
          </button>
        );
      })}
    </div>
  );
}
