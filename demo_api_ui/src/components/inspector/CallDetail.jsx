import React, { useMemo, useState } from 'react';
import FormJsonToggle from '../shared/FormJsonToggle.jsx';
import JsonHighlight from '../shared/JsonHighlight.jsx';
import JsonFormView from '../shared/JsonFormView.jsx';
import PolicyDecisionTree from '../PolicyDecisionTree.jsx';
import EmbeddedFlowDiagram from '../EmbeddedFlowDiagram.jsx';
import { SRC_LABEL, diffPaths, diagramConfigFromCall } from './inspectorCalls.js';
import './Inspector.css';

const CLAIM_ORDER = ['sub', 'aud', 'scope', 'act', 'client_id', 'iat', 'exp'];
const TIME_CLAIMS = new Set(['iat', 'exp']);

export const formatTime = (ms) => new Date(ms).toLocaleTimeString();

/** Title with a break opportunity after each underscore (no HTML injection). */
export function Wrapped({ text }) {
  return String(text).split('_').flatMap((p, i, a) => (i < a.length - 1 ? [p + '_', <wbr key={i} />] : [p]));
}

export function Chip({ chip, className = '' }) {
  return <span className={`insp-chip ${chip.tone} ${className}`.trim()}>{chip.label}</span>;
}

const show = (v) => (typeof v === 'string' ? v : Array.isArray(v) && v.every((x) => typeof x !== 'object') ? v.join(', ') : JSON.stringify(v));

function Kv({ rows }) {
  return (
    <dl className="insp-kv">
      {rows.map(([k, v]) => (<React.Fragment key={k}><dt>{k}</dt><dd>{v}</dd></React.Fragment>))}
    </dl>
  );
}

function Pane({ label, where, body }) {
  return (
    <div className="insp-pane">
      <div className="insp-pane-head"><h3>{label}</h3></div>
      {where && <p className="insp-pane-where">{where}</p>}
      <FormJsonToggle value={body} ariaLabel={`${label} view`} defaultView="json" jsonView={<JsonHighlight value={body} deep copyable />}>
        <JsonFormView value={body} />
      </FormJsonToggle>
    </div>
  );
}

function TokenCard({ tk }) {
  const diff = tk.diff || {};
  const keys = [...CLAIM_ORDER.filter((k) => k in tk.claims), ...Object.keys(tk.claims).filter((k) => !CLAIM_ORDER.includes(k))];
  return (
    <article className="insp-token">
      <div className="insp-token-head">
        <div><h3>{tk.label}</h3><p className="insp-token-role">{tk.role}</p></div>
        <div className="insp-chips"><Chip chip={tk.status} />{tk.alg && <span className="insp-chip">{tk.alg}</span>}</div>
      </div>
      {tk.rfc && <div className="insp-chips"><span className="insp-chip tag">{tk.rfc}</span></div>}
      <dl className="insp-kv">
        {keys.map((k) => (
          <React.Fragment key={k}>
            <dt>{k}</dt>
            <dd>
              {show(tk.claims[k])}
              {TIME_CLAIMS.has(k) && typeof tk.claims[k] === 'number' && <span className="insp-cite">{new Date(tk.claims[k] * 1000).toLocaleTimeString()}</span>}
              {diff[k] && <span className="insp-chip warn">{diff[k]}</span>}
            </dd>
          </React.Fragment>
        ))}
      </dl>
      {tk.hidden.length > 0 && <p className="insp-hidden-note">{tk.hidden.length} claims hidden by policy: {tk.hidden.join(', ')}</p>}
      <details className="insp-more">
        <summary>All claims (JSON)</summary>
        <pre className="insp-json"><JsonHighlight value={tk.header ? { header: tk.header, claims: tk.claims } : { claims: tk.claims }} deep copyable /></pre>
      </details>
    </article>
  );
}

function WhatHappened({ call }) {
  return (
    <>
      <ol className="insp-steps">
        {call.steps.map((s, i) => (
          <li className="insp-stp" key={i}>
            <span className="insp-stp-n">{i + 1}</span>
            <div className="insp-stp-body">
              <div className="insp-stp-head"><strong>{s.title}</strong><Chip chip={s.status} />{s.tag && <span className="insp-chip tag">{s.tag}</span>}</div>
              <p>{s.text}</p>
              {s.kv && <Kv rows={s.kv} />}
              {s.policyTree && <PolicyDecisionTree policies={s.policyTree.policies} result={s.policyTree.result} />}
            </div>
          </li>
        ))}
      </ol>
      {call.audit && (
        <section>
          <h3 className="insp-label insp-sub-h">MCP audit record (5W1H)</h3>
          <div className="insp-audit-grid">
            {Object.entries(call.audit).map(([k, rows]) => (<div className="insp-audit-box" key={k}><h4>{k}</h4><Kv rows={rows} /></div>))}
          </div>
        </section>
      )}
      {call.logs?.length > 0 && (
        <section>
          <h3 className="insp-label insp-sub-h">Gateway log lines for this call</h3>
          <pre className="insp-logpre">{call.logs.join('\n')}</pre>
        </section>
      )}
    </>
  );
}

function DiffList({ label, d }) {
  if (!d.length) return <p className="insp-calls-note">{label}: identical.</p>;
  return (
    <>
      <p className="insp-calls-note">{label}: {d.length} field{d.length > 1 ? 's' : ''} differ.</p>
      <ul>
        {d.slice(0, 8).map((x) => (<li key={x.path}>{x.path}: <del>{x.b ?? '(none)'}</del> → <ins>{x.a ?? '(none)'}</ins></li>))}
        {d.length > 8 && <li>…and {d.length - 8} more</li>}
      </ul>
    </>
  );
}

export default function CallDetail({ call, calls, nodeSubs, onResend, onEdit }) {
  const [tab, setTab] = useState('what');
  const [cmp, setCmp] = useState({ forId: null, id: '' });
  const other = cmp.forId === call.id ? calls.find((c) => c.id === cmp.id) : null;
  const no = (c) => calls.length - calls.indexOf(c);
  const config = useMemo(() => diagramConfigFromCall(call, nodeSubs), [call, nodeSubs]);
  const tabs = [['what', 'What happened', call.steps.length], ['io', 'Request & response'], ['tokens', 'Tokens', call.tokens.length], ['hops', 'API calls', call.hops.length], ['diagram', 'Diagram']];
  const { banner } = call;

  return (
    <section className="insp-card insp-detail">
      <div className="insp-detail-head">
        <p className="insp-label">{call.kind}</p>
        <h2><Wrapped text={call.title} /></h2>
        <div className="insp-chips">
          <Chip chip={call.status} />
          <span className="insp-chip">{call.ms == null ? 'open' : `${call.ms} ms`}</span>
          <span className="insp-chip">{formatTime(call.at)}</span>
          <span className="insp-chip src">{SRC_LABEL[call.src]}</span>
          {call.chips.map((c, i) => <Chip key={i} chip={c} />)}
          {call.corr && <span className="insp-chip src mono" title="Correlation id">{call.corr}</span>}
        </div>
        <div className="insp-actions">
          <button type="button" className="insp-btn ghost" onClick={() => onResend(call)}>Resend</button>
          <button type="button" className="insp-btn ghost" onClick={() => onEdit(call)}>Edit &amp; resend</button>
          <label className="insp-toggle">Compare with{' '}
            <select value={other ? other.id : ''} onChange={(e) => { setCmp({ forId: call.id, id: e.target.value }); if (e.target.value) setTab('io'); }}>
              <option value="">Choose a call…</option>
              {calls.filter((c) => c.id !== call.id).map((o) => (<option key={o.id} value={o.id}>{no(o)} · {o.title} · {o.status.label}</option>))}
            </select>
          </label>
        </div>
      </div>

      {banner && (
        <div className={`insp-banner ${banner.tone}`} role="status" data-testid={banner.testId}>
          <strong>{banner.title}</strong>
          <p>{banner.text}</p>
          {banner.actions?.length > 0 && (
            <div className="insp-row">
              {banner.actions.map((a, i) => (<button key={a.label} type="button" className={`insp-btn${i ? ' ghost' : ''}`} onClick={a.onClick}>{a.label}</button>))}
            </div>
          )}
        </div>
      )}

      <div className="insp-tabs" role="tablist" aria-label="Call details">
        {tabs.map(([k, label, n]) => (
          <button key={k} type="button" role="tab" id={`insp-tab-${k}`} aria-controls="insp-panel" aria-selected={tab === k} className="insp-tab" onClick={() => setTab(k)}>
            {label}{n != null && <span className="insp-count">{n}</span>}
          </button>
        ))}
      </div>

      <div id="insp-panel" role="tabpanel" aria-labelledby={`insp-tab-${tab}`}>
        {tab === 'what' && <WhatHappened call={call} />}
        {tab === 'io' && (other ? (
          <>
            <div className="insp-cmp">
                <div className="insp-cmp-head">
                  <strong>Comparing call {no(call)} with call {no(other)} ({other.title})</strong>
                  <button type="button" className="insp-copy" onClick={() => setCmp({ forId: null, id: '' })}>Stop comparing</button>
                </div>
                <DiffList label="Request" d={diffPaths(call.request.body, other.request.body)} />
                <DiffList label="Response" d={diffPaths(call.response.body, other.response.body)} />
            </div>
            <div className="insp-io">
              <Pane label={`Call ${no(call)} response`} where={call.response.where} body={call.response.body} />
              <Pane label={`Call ${no(other)} response`} where={other.response.where} body={other.response.body} />
            </div>
          </>
        ) : (
          <div className="insp-io">
            <Pane label={call.request.label} where={call.request.where} body={call.request.body} />
            <Pane label={call.response.label} where={call.response.where} body={call.response.body} />
          </div>
        ))}
        {tab === 'tokens' && (call.tokens.length ? (
          <>
            <p className="insp-tok-note">Decoded on the server. The raw token strings never reach this page.</p>
            <div className="insp-tokens">{call.tokens.map((tk, i) => <TokenCard key={i} tk={tk} />)}</div>
          </>
        ) : <p className="insp-tok-note">This call carried no tokens.</p>)}
        {tab === 'hops' && (
          <ol className="insp-hops">
            {call.hops.map((h, i) => (
              <li key={i}>
                <details className={`insp-hop${h.status.tone === 'idle' ? ' skipped' : ''}`} open={i === call.hops.length - 1 && h.status.tone !== 'idle'}>
                  <summary>
                    <span className="insp-call-num">{i + 1}</span>
                    <span className="insp-hop-main"><span className="insp-hop-dir">{h.dir}</span><span className="insp-hop-call"><Wrapped text={h.call} /></span><span className="insp-hop-what">{h.what}</span></span>
                    <span className="insp-call-meta"><Chip chip={h.status} /><span>{h.ms == null ? '—' : `${h.ms} ms`}</span></span>
                  </summary>
                  <div className="insp-hop-body"><div className="insp-io"><Pane label="Request" body={h.request} /><Pane label="Response" body={h.response} /></div></div>
                </details>
              </li>
            ))}
          </ol>
        )}
        {tab === 'diagram' && (
          <EmbeddedFlowDiagram config={config} title="Diagram" lede="One arrow per API call, in order. Drag any box; Simulate walks the arrows." testId="insp-diagram" />
        )}
      </div>
    </section>
  );
}
