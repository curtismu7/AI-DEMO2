// VerticalOpsConsole.jsx
import React, { useState, useCallback } from 'react';
import bffAxios from '../../services/bffAxios';
import { notifySuccess, notifyError, notifyWarning } from '../../utils/appToast';
import { getVerticalConfig } from './verticalOpsConfig';
import RecordDrawer from './RecordDrawer';
import './VerticalOpsConsole.css';

export default function VerticalOpsConsole({ vertical }) {
  const cfg = getVerticalConfig(vertical);
  const [q, setQ] = useState('');
  const [result, setResult] = useState(null); // { customer, categories }
  const [loading, setLoading] = useState(false);
  const [drawer, setDrawer] = useState(null);  // { category, row }
  const [paBusy, setPaBusy] = useState('');     // label of the running page action
  const [paResult, setPaResult] = useState(null); // { summary, steps[], success }

  const doLookup = useCallback(async (e) => {
    e.preventDefault();
    if (!q.trim()) return;
    setLoading(true);
    try {
      const { data } = await bffAxios.get(cfg.lookupPath, { params: { q } });
      setResult(cfg.adaptLookup(data));
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
      notifyError(err?.response?.data?.error || `${label} failed.`);
    }
  }, [cfg, result, drawer, doLookup]);

  // Page-level utility actions (e.g. banking "Fix PingOne Scopes"). Not tied to
  // a record; the endpoint returns { steps, summary, success } which we surface.
  const runPageAction = useCallback(async (action) => {
    setPaBusy(action.label);
    setPaResult(null);
    try {
      const { data } = action.method === 'get'
        ? await bffAxios.get(action.url)
        : await bffAxios.post(action.url);
      const ok = data?.success !== false;
      setPaResult({ summary: data?.summary || `${action.label} completed`, steps: data?.steps || [], success: ok });
      if (ok) notifySuccess(data?.summary || `${action.label} done.`);
      else notifyWarning(data?.summary || `${action.label} completed with warnings.`);
    } catch (err) {
      const st = err?.response?.status;
      const msg = err?.response?.data?.message || err?.response?.data?.error || err?.message || `${action.label} failed`;
      notifyError(st === 401 ? 'Session expired — please sign in again.' : msg);
      setPaResult({ summary: '', steps: [], success: false, error: msg });
    } finally {
      setPaBusy('');
    }
  }, []);

  const theme = { '--accent': cfg.theme.accent, '--accent2': cfg.theme.accent2, '--tint': cfg.theme.tint };

  return (
    <div className="vops" style={theme}>
      <header className="vops__hero">
        <div className="vops__brand"><span className="vops__icon">{cfg.icon}</span><h1>{cfg.name}</h1></div>
        <form className="vops__lookup" data-testid="vops-lookup-form" onSubmit={doLookup}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={cfg.lookupPlaceholder} aria-label="Lookup" />
          <button type="submit" disabled={loading}>{loading ? '…' : 'Look up'}</button>
        </form>
        {cfg.pageActions?.length > 0 && (
          <div className="vops__tools" data-testid="vops-tools">
            {cfg.pageActions.map((pa) => (
              <button key={pa.label} type="button" className="vops__toolbtn" disabled={!!paBusy} onClick={() => runPageAction(pa)}>
                {paBusy === pa.label ? 'Working…' : pa.label}
              </button>
            ))}
          </div>
        )}
      </header>

      {paResult && (
        <section className={`vops__paresult vops__paresult--${paResult.success ? 'ok' : 'warn'}`} data-testid="vops-paresult">
          <button type="button" className="vops__paclose" aria-label="Dismiss" onClick={() => setPaResult(null)}>✕</button>
          {paResult.summary && <div className="vops__pasummary">{paResult.summary}</div>}
          {paResult.error && <div className="vops__paerror">{paResult.error}</div>}
          {paResult.steps.length > 0 && (
            <ul className="vops__pasteps">{paResult.steps.map((s) => { const text = typeof s === 'string' ? s : (s.message || s.label || JSON.stringify(s)); return <li key={text}>{text}</li>; })}</ul>
          )}
        </section>
      )}

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

      {result && (
        <section className="vops__grid" data-testid="vops-grid">
          {result.categories.map((c) => (
            <div className="vops__card" key={c.id}>
              <div className="vops__cardhead"><span>{c.icon}</span><b>{c.label}</b><span className="vops__count">{c.rows.length}</span></div>
              {c.rows.map((r) => (
                <div className="vops__item" key={r.id} onClick={() => setDrawer({ category: c, row: r })}>
                  <div className="vops__itemmain"><div className="vops__ititle">{r.title}</div><div className="vops__isub">{r.sub}</div></div>
                  <span className={`vops__badge vops__badge--${r.tone}`}>{r.status}</span>
                  <div className="vops__acts" onClick={(e) => e.stopPropagation()}>
                    {r.actions.map((a) => (<button key={a} onClick={() => runAction(a, r, c.id)}>{a}</button>))}
                  </div>
                </div>
              ))}
              {c.rows.length === 0 && <div className="vops__empty">No {c.label.toLowerCase()}.</div>}
            </div>
          ))}
        </section>
      )}

      <RecordDrawer open={!!drawer} vertical={vertical} category={drawer?.category || {}} row={drawer?.row} customer={result?.customer} query={q} onClose={() => setDrawer(null)} onAction={runAction} />
    </div>
  );
}
