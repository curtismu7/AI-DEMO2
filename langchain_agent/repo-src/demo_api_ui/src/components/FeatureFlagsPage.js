// banking_api_ui/src/components/FeatureFlagsPage.js
import React, { useState, useEffect, useCallback } from 'react';
import '../styles/appShellPages.css';
import './FeatureFlagsPage.css';

// ─── Flag toggle card ─────────────────────────────────────────────────────────

function FlagCard({ flag, onToggle, saving }) {
  const isEnum   = flag.type === 'enum';
  const isOn     = !isEnum && flag.value === true;
  const isSaving = saving === flag.id;
  const showWarn = !isEnum && ((!isOn && flag.warnIfDisabled) || (isOn && flag.warnIfEnabled));
  const warnMsg  = flag.warnIfDisabled
    ? 'Disabling this flag may break transactions or reduce security.'
    : 'Enabling this flag may reduce security. Use with care.';

  return (
    <div className={`ff-card${!isEnum && isOn ? ' ff-card--on' : ''}${isSaving ? ' ff-card--saving' : ''}`}>
      <div className="ff-card__header">
        <div className="ff-card__meta">
          {isEnum ? (
            <span className="ff-badge ff-badge--enum">{String(flag.value).toUpperCase()}</span>
          ) : (
            <span className={`ff-badge ${isOn ? 'ff-badge--on' : 'ff-badge--off'}`}>
              {isOn ? 'ENABLED' : 'DISABLED'}
            </span>
          )}
          <h3 className="ff-card__name">{flag.name}</h3>
          <code className="ff-card__id">{flag.id}</code>
        </div>

        {isEnum ? (
          <select
            className={`ff-enum-select${isSaving ? ' ff-enum-select--saving' : ''}`}
            value={flag.value}
            onChange={e => onToggle(flag.id, e.target.value)}
            disabled={isSaving}
            aria-label={`Select mode for ${flag.name}`}
          >
            {(flag.options || []).map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        ) : (
          <button
            type="button"
            className={`ff-toggle${isOn ? ' ff-toggle--on' : ''}${isSaving ? ' ff-toggle--saving' : ''}`}
            onClick={() => onToggle(flag.id, !isOn)}
            disabled={isSaving}
            aria-label={`${isOn ? 'Disable' : 'Enable'} ${flag.name}`}
            aria-pressed={isOn}
          >
            <span className="ff-toggle__thumb" />
          </button>
        )}
      </div>

      <p className="ff-card__desc">{flag.description}</p>

      {flag.impact && (
        <p className="ff-card__impact-inline">
          <span className="ff-card__impact-label">Impact</span>
          {flag.impact}
        </p>
      )}

      {showWarn && (
        <div className="ff-card__warn">⚠️ {warnMsg}</div>
      )}

      <div className="ff-card__footer">
        {flag.docsUrl && (
          <a
            href={flag.docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ff-card__docs-link"
          >
            PingOne docs ↗
          </a>
        )}
        {isSaving && <span className="ff-card__saving">Saving…</span>}
      </div>
    </div>
  );
}

// ─── Recognize Configuration section ─────────────────────────────────────────

function RecognizeConfig() {
  const [status,      setStatus]      = useState(null);  // { apiKeySet, tenantNameSet, tenantName }
  const [apiKey,      setApiKey]      = useState('');
  const [tenantName,  setTenantName]  = useState('');
  const [saving,      setSaving]      = useState(false);
  const [saveResult,  setSaveResult]  = useState(null);  // 'ok' | 'error'
  const [saveMsg,     setSaveMsg]     = useState('');

  useEffect(() => {
    fetch('/api/admin/config/recognize-status', { credentials: 'include' })
      .then(r => r.json())
      .then(data => setStatus(data))
      .catch(() => setStatus({ apiKeySet: false, tenantNameSet: false, tenantName: null }));
  }, []);

  /** Auto-dismiss save result after 3 s */
  useEffect(() => {
    if (!saveResult) return;
    const t = setTimeout(() => { setSaveResult(null); setSaveMsg(''); }, 3000);
    return () => clearTimeout(t);
  }, [saveResult]);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setSaveResult(null);
    try {
      const body = {};
      if (apiKey.trim())     body.RECOGNIZE_API_KEY     = apiKey.trim();
      if (tenantName.trim()) body.RECOGNIZE_TENANT_NAME = tenantName.trim();
      if (Object.keys(body).length === 0) {
        setSaveResult('error');
        setSaveMsg('Enter at least one value to save.');
        setSaving(false);
        return;
      }
      const res  = await fetch('/api/admin/config', {
        method:      'POST',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      // Refresh status after save
      const statusRes = await fetch('/api/admin/config/recognize-status', { credentials: 'include' });
      const statusData = await statusRes.json();
      setStatus(statusData);
      setApiKey('');
      setTenantName('');
      setSaveResult('ok');
      setSaveMsg('Credentials saved.');
    } catch (err) {
      setSaveResult('error');
      setSaveMsg(err.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rc-section">
      <div className="rc-section__header">
        <h2 className="rc-section__title">Recognize Configuration</h2>
        <p className="rc-section__subtitle">
          Required when <strong>HITL Consent MFA mode</strong> is set to <code>recognize</code>.
          Credentials are encrypted at rest and never returned to the browser.
        </p>
      </div>

      <div className="rc-card">
        <div className="rc-card__status-row">
          <span className="rc-label">API Key</span>
          <span className={`rc-status ${status?.apiKeySet ? 'rc-status--set' : 'rc-status--unset'}`}>
            {status === null ? '…' : status.apiKeySet ? '••••••••  (set)' : 'Not configured'}
          </span>
        </div>
        <div className="rc-card__status-row">
          <span className="rc-label">Tenant Name</span>
          <span className={`rc-status ${status?.tenantNameSet ? 'rc-status--set' : 'rc-status--unset'}`}>
            {status === null ? '…' : status.tenantNameSet ? status.tenantName : 'Not configured'}
          </span>
        </div>

        <form className="rc-form" onSubmit={handleSave}>
          <div className="rc-field">
            <label className="rc-field__label" htmlFor="rc-api-key">
              RECOGNIZE_API_KEY
            </label>
            <input
              id="rc-api-key"
              type="password"
              className="rc-field__input"
              placeholder="Leave blank to keep existing value"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <div className="rc-field">
            <label className="rc-field__label" htmlFor="rc-tenant-name">
              RECOGNIZE_TENANT_NAME
            </label>
            <input
              id="rc-tenant-name"
              type="text"
              className="rc-field__input"
              placeholder="ping_us"
              value={tenantName}
              onChange={e => setTenantName(e.target.value)}
              autoComplete="off"
            />
          </div>

          <div className="rc-form__footer">
            <button
              type="submit"
              className="rc-save-btn"
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            {saveResult === 'ok'    && <span className="rc-result rc-result--ok">✅ {saveMsg}</span>}
            {saveResult === 'error' && <span className="rc-result rc-result--err">❌ {saveMsg}</span>}
          </div>
        </form>
      </div>
    </section>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FeatureFlagsPage() {
  const [flags,      setFlags]      = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState(null);
  const [saving,     setSaving]     = useState(null);
  const [lastSaved,  setLastSaved]  = useState(null);

  /** Auto-dismiss the save toast after 2.5 s */
  useEffect(() => {
    if (!lastSaved) return;
    const t = setTimeout(() => setLastSaved(null), 2500);
    return () => clearTimeout(t);
  }, [lastSaved]);

  const loadFlags = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch('/api/admin/feature-flags', { credentials: 'include' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setFlags(data.flags || []);
      setCategories(data.categories || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadFlags(); }, [loadFlags]);

  const handleToggle = useCallback(async (flagId, newValue) => {
    setSaving(flagId);
    let oldValue;
    setFlags(prev => {
      const flag = prev.find(f => f.id === flagId);
      oldValue = flag?.value;
      return prev.map(f => f.id === flagId ? { ...f, value: newValue } : f);
    });
    try {
      const res  = await fetch('/api/admin/feature-flags', {
        method:      'PATCH',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify({ updates: { [flagId]: newValue } }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setFlags(prev => prev.map(f => {
        const confirmed = data.flags?.find(u => u.id === f.id);
        return confirmed ? { ...f, value: confirmed.value } : f;
      }));
      setLastSaved({ flagId, timestamp: Date.now() });
    } catch (err) {
      setFlags(prev => prev.map(f => f.id === flagId ? { ...f, value: oldValue } : f));
      setError(`Failed to save "${flagId}": ${err.message}`);
    } finally {
      setSaving(null);
    }
  }, []);

  const groupedFlags  = categories.map(cat => ({ category: cat, flags: flags.filter(f => f.category === cat) }));
  const boolFlags     = flags.filter(f => f.type !== 'enum');
  const enabledCount  = boolFlags.filter(f => f.value === true).length;
  const disabledCount = boolFlags.filter(f => f.value === false).length;

  return (
    <div className="app-page">
      <div className="app-page-header">
        <div className="app-page-header__left">
          <h1 className="app-page-title">Feature Flags</h1>
          <p className="app-page-subtitle">
            Toggle in-development features without a redeploy. Changes persist immediately.
          </p>
        </div>
        <div className="ff-page-stats">
          <span className="ff-stat ff-stat--on">{enabledCount} enabled</span>
          <span className="ff-stat ff-stat--off">{disabledCount} disabled</span>
          <button
            type="button"
            className="app-page-toolbar-btn"
            onClick={loadFlags}
            disabled={loading}
            title="Refresh flags from server"
          >
            {loading ? '…' : '↺ Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div className="ff-error" role="alert">
          <strong>Error:</strong> {error}
          <button type="button" className="ff-error__dismiss" onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {lastSaved && (
        <div className="ff-saved-toast" key={lastSaved.timestamp}>
          ✅ <strong>{lastSaved.flagId}</strong> saved
        </div>
      )}

      {loading && flags.length === 0 ? (
        <div className="ff-loading">Loading feature flags…</div>
      ) : (
        <div className="ff-groups">
          {groupedFlags.map(({ category, flags: catFlags }) => (
            <section key={category} className="ff-group">
              <div className="ff-group__header">
                <h2 className="ff-group__title">{category}</h2>
                <span className="ff-group__count">
                  {(() => {
                    const bools = catFlags.filter(f => f.type !== 'enum');
                    return `${bools.filter(f => f.value === true).length}/${bools.length}`;
                  })()} enabled
                </span>
              </div>
              <div className="ff-group__cards">
                {catFlags.map(flag => (
                  <FlagCard
                    key={flag.id}
                    flag={flag}
                    onToggle={handleToggle}
                    saving={saving}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <RecognizeConfig />

      <div className="ff-footer">
        <p>
          Flags are persisted in the server configuration store and survive restarts.
          Some flags (e.g. <strong>PingOne Authorize</strong>) also require related settings on the{' '}
          <a href="/config">Config page</a> to take full effect.
        </p>
      </div>
    </div>
  );
}
