// /gateway-claims part 5: v1.261028 AgentCore governance, read from the gateway binary (INFERRED, never run).
import React, { useMemo, useState } from 'react';
import SequenceFlowDiagram from '../components/SequenceFlowDiagram';
import { EVIDENCE } from '../config/gatewayClaims';
import {
  AGENTCORE_DETAILS, AGENTCORE_FACTS, AGENTCORE_GROUPS, AGENTCORE_LANES, AGENTCORE_SCENARIOS, ANALYZE_VIEWS, GATEWAY_VERSION_AGENTCORE, MANAGE_ACTIONS, agentcoreDiagram,
} from '../config/gatewayAgentcore';

function Tag({ kind }) {
  const e = EVIDENCE[kind];
  return <span className={`gwc-tag gwc-tag--${kind}`} title={e.note}>{e.label}</span>;
}

function Rows({ rows, caption }) {
  return (
    <table className="gwc-table" aria-label={caption}>
      <caption>{caption}</caption>
      <thead><tr><th>Name</th><th>What it appears to do</th></tr></thead>
      <tbody>{rows.map(([n, d]) => <tr key={n}><td>{n}</td><td>{d}</td></tr>)}</tbody>
    </table>
  );
}

export default function GatewayAgentcoreLab() {
  const [groupId, setGroupId] = useState('bypass');
  const [id, setId] = useState('bypass-open');
  const group = AGENTCORE_GROUPS.find((g) => g.id === groupId);
  const choices = AGENTCORE_SCENARIOS.filter((s) => s.group === groupId);
  const s = AGENTCORE_SCENARIOS.find((x) => x.id === id);
  const diagram = useMemo(() => agentcoreDiagram(s), [s]);
  const bad = s.group === 'bypass' ? s.result.bypassPossible : s.result.risky;
  const headline = s.group === 'bypass' ? (s.result.bypassPossible ? 'BYPASS POSSIBLE' : 'NO BYPASS') : s.result.callerClass;
  const pickGroup = (gid) => { setGroupId(gid); setId(AGENTCORE_SCENARIOS.find((x) => x.group === gid).id); };
  return (
    <section className="gwc-card" aria-labelledby="gwc-p5" data-testid="gwc-agentcore">
      <h2 id="gwc-p5">5. Gateway {GATEWAY_VERSION_AGENTCORE}: AgentCore governance <Tag kind="inferred" /></h2>
      <p className="gwc-warn" role="note">Read from a diff of the gateway binary against v1.261027. UNVERIFIED against the real product: nothing was run against an AgentCore account and the console API did not change.</p>
      <ul>{AGENTCORE_FACTS.map((f) => <li key={f.text}><Tag kind={f.evidence} /> {f.text}</li>)}</ul>
      <div className="gwc-grid">
        <div><Rows rows={MANAGE_ACTIONS} caption="Change an AgentCore gateway (inferred from function names)" /></div>
        <div><Rows rows={ANALYZE_VIEWS} caption="Grade what exists (inferred from function names)" /></div>
      </div>
      <h3>Two mock checks</h3>
      <div role="radiogroup" aria-label="Check" className="gwc-scenarios">
        {AGENTCORE_GROUPS.map((g) => (
          <button key={g.id} type="button" role="radio" aria-checked={g.id === groupId} className={`gwc-chip${g.id === groupId ? ' gwc-chip--on' : ''}`} data-testid={`gwc-ag-group-${g.id}`} onClick={() => pickGroup(g.id)}>{g.label}</button>
        ))}
      </div>
      <p className="gwc-muted">{group.blurb}</p>
      <div role="radiogroup" aria-label="Case" className="gwc-scenarios">
        {choices.map((c) => (
          <button key={c.id} type="button" role="radio" aria-checked={c.id === id} className={`gwc-chip${c.id === id ? ' gwc-chip--on' : ''}`} data-testid={`gwc-ag-${c.id}`} onClick={() => setId(c.id)}>{c.label}</button>
        ))}
      </div>
      <div className={`gwc-verdict gwc-verdict--${bad ? 'bad' : 'ok'}`} role="status" data-testid="gwc-ag-verdict" data-bad={String(bad)}>
        <strong>{headline}</strong> <Tag kind={s.evidence} />
        <p>{s.group === 'bypass' ? s.result.reason : s.result.summary}</p>
        <p className="gwc-muted">{s.story}</p>
      </div>
      <div className="gwc-grid">
        <div><h3>Input (placeholder values)</h3><pre className="gwc-pre" data-testid="gwc-ag-input">{JSON.stringify(s.input, null, 2)}</pre></div>
        <div><h3>Result</h3><pre className="gwc-pre" data-testid="gwc-ag-result">{JSON.stringify(s.result, null, 2)}</pre></div>
      </div>
      <SequenceFlowDiagram key={s.id} source={diagram.source} payloads={diagram.payloads} details={AGENTCORE_DETAILS} lanes={AGENTCORE_LANES} label={`Gateway ${GATEWAY_VERSION_AGENTCORE}: ${s.label}`} />
    </section>
  );
}
