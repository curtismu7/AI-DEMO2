// /standalone/cedar: a Cedar policy demo. It runs the open-source Cedar engine (cedar-wasm) in the browser, with the
// request built from PingFederate-style token claims. It mirrors the vocabulary of Privilege's AI Policies tab but is
// NOT Ping's gateway: the page says so, and marks every attribute the real console does not expose.
// Data: config/cedarDemoScenarios.js. Engine wrapper: cedar/cedarEngine.js. Tests run the same engine unmocked.
import { useEffect, useMemo, useState } from 'react';
import EmbeddedFlowDiagram from '../components/EmbeddedFlowDiagram';
import { PF_CEDAR_DIAGRAM } from '../config/privilegePfCedarDiagram';
import { ACTIONS, DEFAULT_POLICIES, NO_CLAIMS_POLICY, PRESETS, SCENARIOS, TOOLS, VOCABULARY } from '../config/cedarDemoScenarios';
import { buildContext, claimsToEntities, evaluate } from '../cedar/cedarEngine';
import { loadCedar } from '../cedar/loadCedar';
import './CedarDemoPage.css';

const OUTCOME = {
  allow: { label: 'ALLOW', note: 'A permit matched and no forbid did.' },
  deny: { label: 'DENY', note: 'A forbid matched. Forbid always beats permit.' },
  hold: { label: 'HOLD', note: 'A forbid that names approvers matched: the gateway opens an approval and the client retries once it is approved.' },
  'default-deny': { label: 'DEFAULT DENY', note: 'No policy matched, so nothing is allowed. Cedar is default-deny.' },
};

const DOC_URL = 'https://github.com/cmuir_pingcorp/AI-DEMO2/blob/main/privilege/PF-CLAIMS-IN-CEDAR-POLICIES.md';
const copy = (o) => JSON.parse(JSON.stringify(o));

function Decision({ result, onApprove }) {
  if (!result) return <p className="cd-muted">Loading the Cedar engine…</p>;
  if (!result.ok) {
    return (
      <div className="cd-decision cd-decision--error" data-testid="cedar-decision" data-outcome="error" role="status">
        <strong>{result.stage === 'parse' ? 'Policy syntax error' : result.stage === 'validate' ? 'Rejected by strict validation' : 'Request rejected'}</strong>
        <ul>{result.errors.map((e) => <li key={e}>{e}</li>)}</ul>
        {result.stage === 'validate' && <p className="cd-muted">The engine only knows the attributes in its schema. Nothing was evaluated.</p>}
      </div>
    );
  }
  const o = OUTCOME[result.outcome];
  return (
    <div className={`cd-decision cd-decision--${result.outcome}`} data-testid="cedar-decision" data-outcome={result.outcome} role="status">
      <strong className="cd-verdict">{o.label}</strong>
      <p>{o.note}</p>
      {result.deciding.length > 0 && (
        <ul className="cd-deciding">
          {result.deciding.map((d) => (
            <li key={d.id}>
              <code>{d.id}</code> <span className="cd-tag">{d.effect}</span> {d.reason && <span>{d.reason}</span>}
              {d.approvers && <span className="cd-muted"> (approver: {d.approvers})</span>}
            </li>
          ))}
        </ul>
      )}
      {result.outcome === 'hold' && (
        <button type="button" className="cd-btn" onClick={onApprove}>
          Approve as {result.deciding[0].approvers}, then retry
        </button>
      )}
      {result.evalErrors.length > 0 && <p className="cd-muted">Evaluation notes: {result.evalErrors.join('; ')}</p>}
    </div>
  );
}

export default function CedarDemoPage() {
  const [cedar, setCedar] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [policies, setPolicies] = useState(DEFAULT_POLICIES);
  const [claims, setClaims] = useState(copy(PRESETS.mary));
  const [groupsText, setGroupsText] = useState(PRESETS.mary.groups.join(', '));
  const [request, setRequest] = useState(copy(SCENARIOS[0].request));
  const [activeId, setActiveId] = useState(SCENARIOS[0].id);

  useEffect(() => {
    let on = true;
    loadCedar().then((c) => on && setCedar(c)).catch((e) => on && setLoadError(String(e && e.message ? e.message : e)));
    return () => { on = false; };
  }, []);

  const result = useMemo(() => (cedar ? evaluate(cedar, { policiesText: policies, claims, request }) : null), [cedar, policies, claims, request]);
  const active = SCENARIOS.find((s) => s.id === activeId);
  const pristine = policies === DEFAULT_POLICIES;

  const loadScenario = (s) => {
    setClaims(copy(PRESETS[s.preset]));
    setGroupsText(PRESETS[s.preset].groups.join(', '));
    setRequest(copy(s.request));
    setActiveId(s.id);
  };
  const setClaim = (patch) => { setClaims((c) => ({ ...c, ...patch })); setActiveId(null); };
  const setReq = (patch) => { setRequest((r) => ({ ...r, ...patch })); setActiveId(null); };

  const cedarRequest = useMemo(() => {
    if (!TOOLS[request.tool]) return null;
    return { principal: `User::"${claims.sub}"`, parents: (claims.groups || []).map((g) => `Group::"${g}"`), action: `Action::"${request.action}"`, resource: `Tool::"${request.tool}"`, context: buildContext(claims, request) };
  }, [claims, request]);

  return (
    <div className="cd-page" data-testid="cedar-demo-page">
      <header className="cd-hero">
        <h1>Cedar policy demo</h1>
        <p className="cd-lede">
          Pick a caller and a tool call, and watch a real Cedar policy engine decide: allow, deny, or hold for a human.
          The caller is described by PingFederate-style token claims, and the policies use the same vocabulary as the
          <strong> AI Policies</strong> tab in Privilege.
        </p>
        <p className="cd-honest" data-testid="cedar-honesty">
          This page runs the open-source Cedar engine{cedar ? ` (v${cedar.getCedarVersion()})` : ''} in your browser. It is <strong>not</strong> Ping's
          gateway. Attributes marked <span className="cd-tag cd-tag--demo">demo</span> below do not exist in the real console.
        </p>
      </header>

      {loadError && <p className="cd-decision cd-decision--error" role="alert">The Cedar engine could not load: {loadError}. Reload to retry.</p>}

      <section aria-labelledby="cd-scn">
        <h2 id="cd-scn">Scenarios</h2>
        <div className="cd-cards">
          {SCENARIOS.map((s) => (
            <button key={s.id} type="button" className={`cd-card${s.id === activeId ? ' cd-card--on' : ''}`} onClick={() => loadScenario(s)} aria-pressed={s.id === activeId} data-testid={`scn-${s.id}`}>
              <span className="cd-card-title">{s.title}</span>
              <span className="cd-card-story">{s.story}</span>
            </button>
          ))}
        </div>
        {active && (
          <p className="cd-notice" data-testid="cedar-notice">
            <strong>What to notice:</strong> {active.notice}
            {pristine && result && result.ok && (result.outcome === active.expect
              ? <span className="cd-ok"> Matches the expected result ({OUTCOME[active.expect].label}).</span>
              : <span className="cd-bad"> Differs from the expected result ({OUTCOME[active.expect].label}).</span>)}
          </p>
        )}
      </section>

      <div className="cd-bench">
        <section aria-labelledby="cd-req" className="cd-panel">
          <h2 id="cd-req">1. The caller (PF token claims)</h2>
          <div className="cd-grid">
            <label>sub<input value={claims.sub} onChange={(e) => setClaim({ sub: e.target.value })} /></label>
            <label>groups (comma separated)
              <input value={groupsText} onChange={(e) => { setGroupsText(e.target.value); setClaim({ groups: e.target.value.split(',').map((g) => g.trim()).filter(Boolean) }); }} />
            </label>
            <label>scope<input value={claims.scope} onChange={(e) => setClaim({ scope: e.target.value })} /></label>
            <label>client_id <span className="cd-tag cd-tag--demo">demo</span><input value={claims.client_id} onChange={(e) => setClaim({ client_id: e.target.value })} /></label>
            <label>act.sub <span className="cd-tag cd-tag--demo">demo</span><input value={claims.actor || ''} onChange={(e) => setClaim({ actor: e.target.value })} /></label>
          </div>
          <div className="cd-row">
            {Object.keys(PRESETS).map((k) => (
              <button key={k} type="button" className="cd-btn cd-btn--ghost" onClick={() => { setClaims(copy(PRESETS[k])); setGroupsText(PRESETS[k].groups.join(', ')); setActiveId(null); }}>Preset: {PRESETS[k].sub}</button>
            ))}
          </div>

          <h2>2. The tool call</h2>
          <div className="cd-grid">
            <label>tool
              <select value={request.tool} onChange={(e) => setReq({ tool: e.target.value })}>
                {Object.keys(TOOLS).map((t) => <option key={t} value={t}>{t} (app: {TOOLS[t].app})</option>)}
              </select>
            </label>
            <label>action
              <select value={request.action} onChange={(e) => setReq({ action: e.target.value })}>
                {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </label>
            <label>args.amount<input type="number" value={request.args && request.args.amount !== undefined ? request.args.amount : ''} onChange={(e) => setReq({ args: e.target.value === '' ? {} : { amount: Number(e.target.value) } })} /></label>
            <label>approval_count<input type="number" min="0" value={request.approvalCount || 0} onChange={(e) => setReq({ approvalCount: Number(e.target.value) })} /></label>
            <label className="cd-check"><input type="checkbox" checked={!!request.schemaDrift} onChange={(e) => setReq({ schemaDrift: e.target.checked })} /> tool schema changed <span className="cd-tag cd-tag--demo">demo</span></label>
          </div>

          <details className="cd-details">
            <summary>The request as Cedar sees it (the mapping layer)</summary>
            <pre data-testid="cedar-request">{cedarRequest ? JSON.stringify(cedarRequest, null, 2) : ''}</pre>
            <p className="cd-muted">Mapping: <code>groups</code> → the principal's Group parents; <code>scope</code> → <code>context.token.scopes</code>; the tool's app → <code>context.app</code>. Entities: {cedarRequest ? claimsToEntities(claims).length : 0}.</p>
          </details>
        </section>

        <section aria-labelledby="cd-pol" className="cd-panel">
          <h2 id="cd-pol">3. The policies (edit them)</h2>
          <textarea aria-label="Cedar policies" className="cd-editor" spellCheck={false} value={policies} onChange={(e) => setPolicies(e.target.value)} data-testid="cedar-editor" />
          <div className="cd-row">
            <button type="button" className="cd-btn cd-btn--ghost" onClick={() => setPolicies(DEFAULT_POLICIES)}>Reset policies</button>
            <button type="button" className="cd-btn cd-btn--ghost" onClick={() => setPolicies(`${policies.trimEnd()}\n\n${NO_CLAIMS_POLICY}`)} data-testid="try-raw-claims">Add a policy on raw claims</button>
          </div>
          <h2>4. The decision</h2>
          <Decision result={result} onApprove={() => setReq({ approvalCount: 1 })} />
        </section>
      </div>

      <section aria-labelledby="cd-real" className="cd-panel" data-testid="cedar-vocab">
        <h2 id="cd-real">What Privilege can read today</h2>
        <p>
          The real AI Policies engine has a fixed set of attributes. Rows marked <span className="cd-tag cd-tag--demo">demo</span> work on this page only.
          Try “Add a policy on raw claims” above: the engine rejects <code>context.claims</code> because it is not in the schema, as the real console's would.
        </p>
        <table className="cd-table">
          <thead><tr><th>Attribute</th><th>Real console?</th><th>Where it comes from</th></tr></thead>
          <tbody>
            {VOCABULARY.map((v) => (
              <tr key={v.attr}><td><code>{v.attr}</code></td><td>{v.real ? 'yes' : <span className="cd-tag cd-tag--demo">demo only</span>}</td><td>{v.from}</td></tr>
            ))}
          </tbody>
        </table>
        <ul className="cd-facts">
          <li><strong>People:</strong> a PingFederate token never reaches the gateway door. The door's token comes from the Privilege-owned PingOne environment, so PF is a sign-in source behind it, and a user is matched by email.</li>
          <li><strong>Agents:</strong> Privilege can trust a PF issuer natively (a Non-Human Identity of type OIDC Provider) and require token claim values in the access policy (<code>RequiredClaims</code>). That claim gate is not Cedar, and it is <strong>not yet proven end to end</strong> on the MCP door.</li>
          <li><strong>Not available:</strong> raw claims, <code>act</code> and ID-JAG have no Cedar hook in the console.</li>
        </ul>
        <p><a href={DOC_URL} target="_blank" rel="noreferrer">Full write-up: PF identity in Cedar policies</a></p>
      </section>

      <section aria-labelledby="cd-diag" className="cd-panel">
        <h2 id="cd-diag">How a PingFederate identity reaches a Cedar decision</h2>
        <EmbeddedFlowDiagram
          config={PF_CEDAR_DIAGRAM}
          title="PingFederate identity to a Cedar policy decision"
          lede="Solid arrows were observed on the SE gateway; dashed arrows are designs not set up yet."
          ariaLabel="PingFederate identity to Cedar policy"
          testId="cedar-diagram"
          pingStyle
        />
      </section>
    </div>
  );
}
