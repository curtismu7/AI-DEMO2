// SupportConsole.jsx
import React, { useState, useCallback, useEffect, useRef } from 'react';
import bffAxios from '../../services/bffAxios';
import { notifySuccess, notifyError } from '../../utils/appToast';
import { getVerticalConfig } from './supportConsoleConfig';
import RecordDrawer from './RecordDrawer';
import IdentityGate from './IdentityGate';
import CaseNotes from './CaseNotes';
import { resolvePermission, PERMISSION_LABEL } from './resolvePermission';
import TokenChainTraceRail from '../TokenChainTraceRail';
import './SupportConsole.css';

export default function SupportConsole({ vertical }) {
  const cfg = getVerticalConfig(vertical);
  const [q, setQ] = useState('');
  const [result, setResult] = useState(null); // { customer, categories }
  const [loading, setLoading] = useState(false);
  const [drawer, setDrawer] = useState(null);  // { category, row }
  // Verification is per customer and lives on the server session; this mirrors
  // it so buttons can be gated before the click, never instead of the server.
  const [verifiedUntil, setVerifiedUntil] = useState(0);
  // Which customer verifiedUntil belongs to — mirrors the server keying it by
  // customer id, so a refresh keeps it and a different customer drops it.
  const verifiedCustomerRef = useRef(null);
  const [scopes, setScopes] = useState([]);
  const [scopeSource, setScopeSource] = useState(null);
  const traceRef = useRef(null);

  useEffect(() => {
    let live = true;
    bffAxios
      .get(`/api/admin/${vertical}/permissions`)
      .then(({ data }) => {
        if (!live) return;
        setScopes(Array.isArray(data?.scopes) ? data.scopes : []);
        setScopeSource(data?.source || 'none');
      })
      .catch(() => { if (live) setScopeSource('none'); });
    return () => { live = false; };
  }, [vertical]);

  const jumpToTrace = useCallback(() => {
    if (!traceRef.current) return;
    traceRef.current.open = true;
    traceRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const doLookup = useCallback(async (e) => {
    e.preventDefault();
    if (!q.trim()) return;
    setLoading(true);
    try {
      const { data } = await bffAxios.get(cfg.lookupPath, { params: { q } });
      const next = cfg.adaptLookup(data);
      setResult(next);
      // Drop verification only when this resolves a DIFFERENT customer. A new
      // customer is a new call, and carrying verification across is exactly
      // what the server-side keying prevents. But runAction re-runs this to
      // refresh after a successful write, and the server's 15-minute
      // verification for that same customer is still live — clearing it there
      // would send the operator back to the strip after every single action.
      if ((next?.customer?.id ?? null) !== verifiedCustomerRef.current) {
        setVerifiedUntil(0);
        verifiedCustomerRef.current = null;
      }
    } catch (err) {
      const st = err?.response?.status;
      notifyError(st === 401 ? 'Session expired — please sign in again.' : 'Lookup failed.');
      setResult(null);
    } finally { setLoading(false); }
  }, [q, cfg]);

  const runAction = useCallback(async (label, row, catId) => {
    const action = cfg.actions[label];
    if (!action) return;
    try {
      const url = action.buildUrl(row, result?.customer, catId);
      const body = action.body ? action.body(row, result?.customer) : undefined;
      if (action.method === 'delete') await bffAxios.delete(url);
      else await bffAxios.post(url, body);
      notifySuccess(`${label} done.`);
      if (drawer) setDrawer(null);
      await doLookup({ preventDefault() {} });
    } catch (err) {
      // If the server disagrees with the client's idea of verification, the
      // server wins and the strip flips back.
      if (err?.response?.data?.error === 'customer_not_verified') {
        setVerifiedUntil(0);
        verifiedCustomerRef.current = null;
        notifyError('Verify the customer before making changes.');
        return;
      }
      notifyError(err?.response?.data?.error || `${label} failed.`);
    }
  }, [cfg, result, drawer, doLookup]);

  const verified = verifiedUntil > Date.now();
  // 'none' means the BFF could not read the operator's scopes — not that they
  // have none. Rendering every action denied would be a lie dressed as a
  // security decision.
  const scopesUnknown = scopeSource === 'none';

  // One source of truth for both the card buttons and the drawer.
  const permissionFor = useCallback(
    (label) => resolvePermission({ permission: cfg.permissions[label], scopes, verified }),
    [cfg, scopes, verified],
  );

  const handleVerified = useCallback((expiresAt) => {
    verifiedCustomerRef.current = result?.customer?.id ?? null;
    setVerifiedUntil(expiresAt);
  }, [result]);

  const theme = { '--accent': cfg.theme.accent, '--accent2': cfg.theme.accent2, '--tint': cfg.theme.tint };

  return (
    <div className="vops" style={theme}>
      <header className="vops__hero">
        <div className="vops__brand"><span className="vops__icon">{cfg.icon}</span><h1>{cfg.name}</h1></div>
        <form className="vops__lookup" data-testid="vops-lookup-form" onSubmit={doLookup}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={cfg.lookupPlaceholder} aria-label="Lookup" />
          <button type="submit" disabled={loading}>{loading ? '…' : 'Look up'}</button>
        </form>
        <button type="button" className="vops__jumpbtn" onClick={jumpToTrace}>
          Jump to token chain ↓
        </button>
      </header>

      {result?.customer && (
        <section className="vops__summary" data-testid="vops-summary">
          <div className="vops__avatar">{result.customer.avatar}</div>
          <div><div className="vops__name">{result.customer.name}</div><div className="vops__sub">{result.customer.sub}</div></div>
          <div className="vops__stats">
            {result.customer.stats.map(([k, v]) => (
              <div key={k} className="vops__stat"><div className="vops__statv">{v}</div><div className="vops__statk">{k}</div></div>
            ))}
          </div>
        </section>
      )}

      {scopesUnknown && result?.customer && (
        <div className="vops__scopewarn" role="status">
          ⚠️ Could not read your granted permissions. Actions are shown as
          unavailable until this resolves — this is a read failure, not a denial.
        </div>
      )}

      {result?.customer && (
        <IdentityGate
          vertical={vertical}
          customer={result.customer}
          verified={verified}
          onVerified={handleVerified}
        />
      )}

      {result && (
        <section className="vops__grid" data-testid="vops-grid">
          {result.categories.map((c) => (
            <div className="vops__card" key={c.id}>
              <div className="vops__cardhead"><span className="vops__cardicon">{c.icon}</span><b>{c.label}</b><span className="vops__count">{c.rows.length}</span></div>
              {c.rows.map((r) => (
                <div className="vops__item" key={r.id} onClick={() => setDrawer({ category: c, row: r })}>
                  <div className="vops__itemmain"><div className="vops__ititle">{r.title}</div><div className="vops__isub">{r.sub}</div></div>
                  <span className={`vops__badge vops__badge--${r.tone}`}>{r.status}</span>
                  <div className="vops__acts" onClick={(e) => e.stopPropagation()}>
                    {r.actions.map((a) => {
                      const state = permissionFor(a);
                      return (
                        <button
                          key={a}
                          type="button"
                          data-permission={state}
                          disabled={state !== 'allowed'}
                          title={state === 'allowed' ? a : `${a} — ${PERMISSION_LABEL[state]}`}
                          onClick={() => runAction(a, r, c.id)}
                        >
                          {state === 'allowed' ? a : `🔐 ${a}`}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              {c.rows.length === 0 && <div className="vops__empty">No {c.label.toLowerCase()}.</div>}
            </div>
          ))}
        </section>
      )}

      {result?.customer?.id && (
        <CaseNotes vertical={vertical} customerId={result.customer.id} />
      )}

      <details className="vops__trace" data-testid="vops-token-chain" ref={traceRef}>
        <summary>Token Chain — MCP Route (Agent → MCP Server)</summary>
        <div className="vops__tracebody">
          <TokenChainTraceRail mcpRouteOnly />
        </div>
      </details>

      <RecordDrawer open={!!drawer} vertical={vertical} category={drawer?.category || {}} row={drawer?.row} customer={result?.customer} query={q} onClose={() => setDrawer(null)} onAction={runAction} permissionFor={permissionFor} />
    </div>
  );
}
