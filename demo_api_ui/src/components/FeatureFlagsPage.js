// banking_api_ui/src/components/FeatureFlagsPage.js
//
// /feature-flags — the admin switchboard for in-development features.
//
// Honesty: nothing on this page is simulated. The list is the server's flag registry
// (GET /api/admin/feature-flags) and every switch writes the flag to the server configuration store
// (PATCH /api/admin/feature-flags). Some flags choose between a real PingOne service and a local mock; the
// card of that flag says so, the page itself never fakes a value. The page needs an admin session: the
// route wrapper (RequireAdminLogin) asks first and never redirects silently, and a 401/403 from the API
// is shown as an error that says so.
//
// Layout follows the standalone Ping UI Standard (AI-DEMO-Standalone/shared/STANDALONE-UI-PATTERNS.md)
// through the shared primitives (components/pingUi, docs/ping-ui-primitives.md): P2 banner first, P3 frame,
// P4 cards, P7 chips, P9 buttons. P5 (key-value) is used only in the overview and webhook cards: a flag
// card is a switch plus prose, not a record. P9 "one primary per view": the only primary is the webhook
// form's Save / Clear (the one button that commits a typed value), in every state; it reads inactive while
// there is nothing to save. Refresh and Dismiss are secondaries. The flag switches and the choice dropdowns
// are controls, not buttons in the P9 sense, and take aria-disabled (not disabled) while saving so keyboard
// focus stays on them. Page CSS (FeatureFlagsPage.css) keeps only the switch and the card header.

import React, { useState, useEffect, useCallback } from 'react';
import './FeatureFlagsPage.css';
import InlineSpinner from './shared/InlineSpinner';
import PageHeader from './common/PageHeader';
import {
  PingPage, SimBanner, PageFrame, Section, CardGrid, Card, StatusChip, KvList,
} from './pingUi';

// The page comes first so the banner is the first Ping UI element in the file (scripts/check-ui-patterns.mjs reads
// source order); FlagCard and the webhook card are function declarations, hoisted, and live below it.

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FeatureFlagsPage() {
  const [flags,      setFlags]      = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState(null);
  const [loadFailed, setLoadFailed] = useState(false);
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
    setLoadFailed(false);
    try {
      const res  = await fetch('/api/admin/feature-flags', { credentials: 'include' });
      const data = await res.json();
      if (!res.ok) {
        const reason = data.error || `HTTP ${res.status}`;
        throw new Error(res.status === 401 || res.status === 403
          ? `${reason}. Sign in as an admin to view and change flags.`
          : reason);
      }
      setFlags(data.flags || []);
      setCategories(data.categories || []);
    } catch (err) {
      setError(err.message);
      setLoadFailed(true);
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

  const refresh = () => {
    if (loading) return; // aria-disabled keeps focus on the button; the click is ignored
    loadFlags();
  };

  const groupedFlags  = categories.map(cat => ({ category: cat, flags: flags.filter(f => f.category === cat) }));
  const boolFlags     = flags.filter(f => f.type !== 'enum');
  const enabledCount  = boolFlags.filter(f => f.value === true).length;
  const disabledCount = boolFlags.filter(f => f.value === false).length;

  // What the page actually knows, in words. Green only once the registry was read.
  let status;
  if (loading && flags.length === 0) status = { tone: 'neutral', word: 'Loading', text: 'Reading the flag registry from the server.' };
  else if (loading) status = { tone: 'neutral', word: 'Refreshing', text: 'Reading the flag registry again.' };
  else if (loadFailed && flags.length === 0) status = { tone: 'danger', word: 'Unavailable', text: 'The flag registry could not be read, so no switches are shown. Nothing was changed.' };
  else if (loadFailed) status = { tone: 'warn', word: 'Stale', text: 'The refresh failed, so the switches below show the last values read.' };
  else status = { tone: 'ok', word: 'Loaded', text: `${flags.length} flags read from the server configuration store.` };

  return (
    <PingPage className="feature-flags-page">
      <SimBanner data-testid="ff-banner">
        <strong>LIVE SETTINGS</strong> — nothing on this page is simulated. The list is this app&apos;s own flag
        registry, and each switch writes the flag to the server configuration store, so a change is stored at once
        and survives a restart. Some flags choose between a real PingOne service and a local mock (for example Real
        PingOne Authorize); the card of each flag says what it changes. Changing flags needs an admin session.
      </SimBanner>
      <PageHeader
        eyebrow="Developer Tools"
        title="Feature Flags"
        summary="Toggle in-development features without a redeploy. Changes persist immediately."
      />
      <PageFrame>
        {error && (
          <div className="ff-error" role="alert">
            <p className="ff-error__text"><strong>Error:</strong> {error}</p>
            <button type="button" className="pu-btn" onClick={() => setError(null)}>Dismiss ✕</button>
          </div>
        )}

        <div className="ff-saved-region" role="status">
          {lastSaved && (
            <div className="ff-saved-toast" key={lastSaved.timestamp}>
              ✅ <strong>{lastSaved.flagId}</strong> saved
            </div>
          )}
        </div>

        <Section
          id="ff-registry-h"
          kicker="1 · Registry"
          title="What is set right now"
          lede="Values are read from the server. A switch changes as soon as you press it, is confirmed by the server's reply, and returns to its old value if the save fails."
        >
          <CardGrid>
            <Card title="Flag registry" data-testid="ff-registry">
              <p className="pu-status-line" role="status" data-testid="ff-status">
                <StatusChip tone={status.tone}>{status.word}</StatusChip>
                {status.text}
              </p>
              {flags.length > 0 && (
                <p className="pu-status-line">
                  <StatusChip tone="info">{enabledCount} enabled</StatusChip>
                  <StatusChip tone="neutral">{disabledCount} disabled</StatusChip>
                </p>
              )}
              <KvList
                items={[
                  { label: 'Source', value: '/api/admin/feature-flags', mono: true },
                  { label: 'Flags read', value: String(flags.length) },
                  { label: 'Groups', value: String(categories.length) },
                ]}
              />
              <div className="pu-actions">
                <button
                  type="button"
                  className="pu-btn"
                  onClick={refresh}
                  aria-disabled={loading ? 'true' : undefined}
                  title="Refresh flags from server"
                >
                  {loading ? 'Refreshing…' : 'Refresh flags'}
                </button>
              </div>
            </Card>
          </CardGrid>
        </Section>

        {loading && flags.length === 0 ? (
          <div className="ff-loading"><InlineSpinner label="Loading feature flags…" /></div>
        ) : flags.length === 0 ? (
          <p className="pu-note pu-empty ff-empty">
            No flags are shown. Use Refresh flags to try again.
          </p>
        ) : (
          groupedFlags.map(({ category, flags: catFlags }, index) => {
            const bools = catFlags.filter(f => f.type !== 'enum');
            return (
              <Section
                key={category}
                id={`ff-group-${index}`}
                kicker={`${index + 2} · Group`}
                title={category}
                lede={`${bools.filter(f => f.value === true).length}/${bools.length} enabled`}
              >
                <CardGrid>
                  {catFlags.map(flag => (
                    <FlagCard
                      key={flag.id}
                      flag={flag}
                      onToggle={handleToggle}
                      saving={saving}
                    />
                  ))}
                </CardGrid>
              </Section>
            );
          })
        )}

        <ExternalGuardrailWebhookConfig />

        <p className="pu-note ff-footnote">
          Flags are persisted in the server configuration store and survive restarts.
          Some flags (e.g. <strong>PingOne Authorize</strong>) also require related settings on the{' '}
          <a href="/config">Config page</a> to take full effect.
        </p>
      </PageFrame>
    </PingPage>
  );
}

// ─── Flag toggle card ─────────────────────────────────────────────────────────

export function FlagCard({ flag, onToggle, saving }) {
  const isEnum   = flag.type === 'enum';
  // Some flags are only half a control on their own — ff_weather_mcp_allowed_state
  // selects a mode whose meaning depends on the deny list edited beside it. Those
  // declare managedOn and show their current value plus a link, so this page stays
  // the place you SEE every flag without becoming a second place to set them.
  const managedOn = flag.managedOn;
  const isOn     = !isEnum && flag.value === true;
  const isSaving = saving === flag.id;
  const showWarn = !isEnum && ((!isOn && flag.warnIfDisabled) || (isOn && flag.warnIfEnabled));
  const warnMsg  = flag.warnIfDisabled
    ? 'Disabling this flag may break transactions or reduce security.'
    : 'Enabling this flag may reduce security. Use with care.';

  // Card top edge: the vertical's accent by default, amber when the card carries a warning, grey for a flag that is off.
  const tone = showWarn ? 'warn' : (!isEnum && !isOn ? 'neutral' : undefined);

  return (
    <Card tone={tone} className="ff-card" aria-busy={isSaving ? 'true' : undefined}>
      <div className="ff-card__header">
        <div className="ff-card__meta">
          {isEnum ? (
            <StatusChip tone="neutral">{String(flag.value).toUpperCase()}</StatusChip>
          ) : (
            <StatusChip tone={isOn ? 'info' : 'neutral'}>{isOn ? 'ENABLED' : 'DISABLED'}</StatusChip>
          )}
          <h3 className="pu-h3 ff-card__name">{flag.name}</h3>
          <code className="ff-card__id">{flag.id}</code>
        </div>

        {managedOn ? (
          <a className="pu-btn ff-managed-link" href={managedOn.path}>
            Set on the {managedOn.label} →
          </a>
        ) : isEnum ? (
          <select
            className="pu-select ff-enum-select"
            value={flag.value}
            onChange={e => { if (!isSaving) onToggle(flag.id, e.target.value); }}
            aria-disabled={isSaving ? 'true' : undefined}
            aria-label={`Select mode for ${flag.name}`}
          >
            {(flag.options || []).map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        ) : (
          <button
            type="button"
            className={`ff-toggle${isOn ? ' ff-toggle--on' : ''}`}
            onClick={() => { if (!isSaving) onToggle(flag.id, !isOn); }}
            aria-disabled={isSaving ? 'true' : undefined}
            aria-label={`${isOn ? 'Disable' : 'Enable'} ${flag.name}`}
            aria-pressed={isOn}
          >
            <span className="ff-toggle__thumb" aria-hidden="true" />
          </button>
        )}
      </div>

      <p className="pu-note ff-card__desc">{flag.description}</p>

      {flag.impact && (
        <p className="pu-note ff-card__impact">
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
    </Card>
  );
}

// ─── External Guardrail Webhook config ────────────────────────────────────────

function ExternalGuardrailWebhookConfig() {
  const [currentUrl, setCurrentUrl] = useState('');
  // 'loading' until the config read answers; 'unknown' when it could not be read, so the card never claims
  // "Not configured" about a value it has not seen.
  const [urlState,   setUrlState]   = useState('loading');
  const [url,        setUrl]        = useState('');
  const [saving,     setSaving]     = useState(false);
  const [saveResult, setSaveResult] = useState(null);  // 'ok' | 'error'
  const [saveMsg,    setSaveMsg]    = useState('');

  useEffect(() => {
    let alive = true;
    fetch('/api/admin/config', { credentials: 'include' })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(data => {
        if (!alive) return;
        setCurrentUrl(data?.config?.EXTERNAL_GUARDRAIL_WEBHOOK_URL || '');
        setUrlState('ready');
      })
      .catch(() => { if (alive) setUrlState('unknown'); });
    return () => { alive = false; };
  }, []);

  /** Auto-dismiss save result after 3 s */
  useEffect(() => {
    if (!saveResult) return;
    const t = setTimeout(() => { setSaveResult(null); setSaveMsg(''); }, 3000);
    return () => clearTimeout(t);
  }, [saveResult]);

  // The button keeps keyboard focus while it cannot act (aria-disabled, not disabled), so the handler enforces it.
  const nothingToSave = !url.trim() && !currentUrl;
  const inactive = saving || nothingToSave;
  const clearing = !url.trim() && !!currentUrl;

  const handleSave = async (e) => {
    e.preventDefault();
    if (inactive) return;
    setSaving(true);
    setSaveResult(null);
    try {
      const res  = await fetch('/api/admin/config', {
        method:      'POST',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify({ EXTERNAL_GUARDRAIL_WEBHOOK_URL: url.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setCurrentUrl(url.trim());
      setUrlState('ready');
      setUrl('');
      setSaveResult('ok');
      setSaveMsg(url.trim() ? 'Webhook URL saved.' : 'Webhook URL cleared.');
    } catch (err) {
      setSaveResult('error');
      setSaveMsg(err.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  let urlChip;
  let urlText;
  if (urlState === 'loading') { urlChip = { tone: 'neutral', word: 'Reading' }; urlText = 'Reading the stored value.'; }
  else if (urlState === 'unknown') { urlChip = { tone: 'warn', word: 'Unknown' }; urlText = 'The stored value could not be read.'; }
  else if (currentUrl) { urlChip = { tone: 'info', word: 'Configured' }; urlText = 'AI Guard denials are sent to the URL below when the flag is ON.'; }
  else { urlChip = { tone: 'neutral', word: 'Not set' }; urlText = 'No webhook URL is stored.'; }

  let hint;
  if (saving) hint = 'Saving the webhook URL.';
  else if (url.trim()) hint = 'Save replaces the stored URL.';
  else if (currentUrl) hint = 'Leave the field empty and press Clear to remove the stored URL.';
  else hint = 'Enter a URL to enable Save.';

  return (
    <Section
      id="ff-webhook-h"
      kicker="Webhook sink"
      title="External Guardrail Webhook"
      lede={(
        <>
          Used by <strong>External Guardrail Webhook</strong> above. When that flag is ON, every AI
          Guard denial (a Privilege <code>llm_policy_denied</code> or <code>llm_rate_limited</code>{' '}
          verdict from the Agentic Access Console&apos;s LLM panel) is also POSTed here as JSON —
          point it at a generic webhook inspector (e.g. webhook.site) to see exactly what data
          AI Guard has when it blocks a request.
        </>
      )}
    >
      <CardGrid>
        <Card tone="neutral" title="Webhook URL" className="ff-webhook" data-testid="ff-webhook">
          <p className="pu-status-line">
            <StatusChip tone={urlChip.tone}>{urlChip.word}</StatusChip>
            {urlText}
          </p>
          <KvList
            items={[{
              label: 'Current URL',
              value: urlState === 'ready' ? (currentUrl || 'Not configured') : (urlState === 'loading' ? 'Reading…' : 'Unknown'),
              mono: true,
            }]}
          />

          <form className="ff-webhook__form" onSubmit={handleSave}>
            <label className="pu-label" htmlFor="egw-url">
              EXTERNAL_GUARDRAIL_WEBHOOK_URL
            </label>
            <input
              id="egw-url"
              type="text"
              className="ff-input"
              placeholder="https://webhook.site/…"
              value={url}
              onChange={e => setUrl(e.target.value)}
              autoComplete="off"
              aria-describedby="egw-hint"
            />
            <p id="egw-hint" className="pu-note">{hint}</p>

            <div className="pu-actions">
              <button
                type="submit"
                className="pu-btn pu-btn--primary"
                aria-disabled={inactive ? 'true' : undefined}
                aria-describedby="egw-hint"
              >
                {saving ? 'Saving…' : (clearing ? 'Clear' : 'Save')}
              </button>
              <span className={`ff-webhook__result${saveResult === 'ok' ? ' ff-webhook__result--ok' : ''}${saveResult === 'error' ? ' ff-webhook__result--err' : ''}`} role="status">
                {saveResult === 'ok'    && `✅ ${saveMsg}`}
                {saveResult === 'error' && `❌ ${saveMsg}`}
              </span>
            </div>
          </form>
        </Card>
      </CardGrid>
    </Section>
  );
}
