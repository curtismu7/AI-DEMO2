// VerticalOpsConsole.jsx
import React, { useState, useCallback } from 'react';
import bffAxios from '../../services/bffAxios';
import { notifySuccess, notifyError } from '../../utils/appToast';
import { getVerticalConfig } from './verticalOpsConfig';
import RecordDrawer from './RecordDrawer';
import './VerticalOpsConsole.css';

export default function VerticalOpsConsole({ vertical }) {
  const cfg = getVerticalConfig(vertical);
  const [q, setQ] = useState('');
  const [result, setResult] = useState(null); // { customer, categories }
  const [loading, setLoading] = useState(false);
  const [drawer, setDrawer] = useState(null);  // { category, row }

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

  const theme = { '--accent': cfg.theme.accent, '--accent2': cfg.theme.accent2, '--tint': cfg.theme.tint };

  return (
    <div className="vops" style={theme}>
      <header className="vops__hero">
        <div className="vops__brand"><span className="vops__icon">{cfg.icon}</span><h1>{cfg.name}</h1></div>
        <form className="vops__lookup" data-testid="vops-lookup-form" onSubmit={doLookup}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={cfg.lookupPlaceholder} aria-label="Lookup" />
          <button type="submit" disabled={loading}>{loading ? '…' : 'Look up'}</button>
        </form>
      </header>

      {result?.customer && (
        <section className="vops__summary">
          <div className="vops__avatar">{result.customer.avatar}</div>
          <div><div className="vops__name">{result.customer.name}</div><div className="vops__sub">{result.customer.sub}</div></div>
        </section>
      )}

      {result && (
        <section className="vops__grid">
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

      <RecordDrawer open={!!drawer} vertical={vertical} category={drawer?.category || {}} row={drawer?.row} customer={result?.customer} onClose={() => setDrawer(null)} onAction={runAction} />
    </div>
  );
}
