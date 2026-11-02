// /gateway-claims: what Privilege gateway (mcpgw) v1.261024 to v1.261102 added. Public, no live call: it explains and simulates.
// Part 1 matches a PingFederate token's object-valued act claim against a Privilege RequiredClaims rule (verified live
// 2026-10-26). Part 2 lists the AgentCore posture fields seen only in the gateway binary (unverified). The diagram is
// SequenceFlowDiagram (React Flow): Simulate, step speed, Reset and the movie reel. Parts 5 to 7 are the later tags:
// v1.261028 AgentCore governance, then v1.261029 / v1.261030 / v1.261102 and the unmeasured 2026-11-02 release (all UNVERIFIED).
import React, { useMemo, useState } from 'react';
import PageHeader from '../components/common/PageHeader';
import SequenceFlowDiagram from '../components/SequenceFlowDiagram';
import {
  DIAGRAM_DETAILS, DIAGRAM_LANES, DOC_PATH, EVIDENCE, GATEWAY_VERSION, MAPPING_ROWS, NEXT_RELEASE, NEXT_RELEASE_DIFF, NEXT_RELEASE_RESULTS, NEXT_RELEASE_TRAPS, POSTURE_GROUPS, POSTURE_SAMPLE,
  GATEWAY_VERSION_NEXT, NEXT_DETAILS, NEXT_GROUPS, NEXT_LANES, NEXT_SCENARIOS, nextScenarioDiagram, nextWire,
  REQUIRED_CLAIMS, SCENARIOS, TRAP_ROWS, WHAT_CHANGED, scenarioDiagram,
} from '../config/gatewayClaims';
import GatewayAgentcoreLab from './GatewayAgentcoreLab';
import GatewayLatest from './GatewayLatest';
import { PAGE_VERSIONS } from '../config/gatewayLatest';
import './GatewayClaimsPage.css';

const show = (v) => (v === undefined ? 'missing' : typeof v === 'string' ? v : JSON.stringify(v));

function Tag({ kind }) {
  const e = EVIDENCE[kind];
  return <span className={`gwc-tag gwc-tag--${kind}`} title={e.note}>{e.label}</span>;
}

/** v1.261027 lab: pick a behaviour (Cedar scope gate, PingFederate resource= trap, scope tiers), then a token, and see the wire and the diagram. */
function NextLab() {
  const [groupId, setGroupId] = useState('cedar');
  const [nextId, setNextId] = useState('cedar-missing');
  const group = NEXT_GROUPS.find((g) => g.id === groupId);
  const choices = NEXT_SCENARIOS.filter((s) => s.group === groupId);
  const s = NEXT_SCENARIOS.find((x) => x.id === nextId);
  const diagram = useMemo(() => nextScenarioDiagram(s), [s]);
  const wire = useMemo(() => nextWire(s), [s]);
  const r = s.result;
  const pickGroup = (id) => { setGroupId(id); setNextId(NEXT_SCENARIOS.find((x) => x.group === id).id); };
  return (
    <section className="gwc-card" aria-labelledby="gwc-p4" data-testid="gwc-next-lab">
      <h2 id="gwc-p4">4. Run the {GATEWAY_VERSION_NEXT} behaviours <Tag kind="verified" /></h2>
      <p className="gwc-lede">Each run below mirrors a call we made on the real gateway on 2026-10-27. Hosts, ids and tokens are placeholders; the outcomes are the measured ones.</p>
      <div role="radiogroup" aria-label="Behaviour" className="gwc-scenarios">
        {NEXT_GROUPS.map((g) => (
          <button key={g.id} type="button" role="radio" aria-checked={g.id === groupId} className={`gwc-chip${g.id === groupId ? ' gwc-chip--on' : ''}`} data-testid={`gwc-group-${g.id}`} onClick={() => pickGroup(g.id)}>{g.label}</button>
        ))}
      </div>
      <p className="gwc-muted">{group.blurb}</p>
      <div role="radiogroup" aria-label="Run" className="gwc-scenarios">
        {choices.map((c) => (
          <button key={c.id} type="button" role="radio" aria-checked={c.id === nextId} className={`gwc-chip${c.id === nextId ? ' gwc-chip--on' : ''}`} data-testid={`gwc-next-${c.id}`} onClick={() => setNextId(c.id)}>{c.label}</button>
        ))}
      </div>
      <div className={`gwc-verdict gwc-verdict--${r.allowed ? 'ok' : 'bad'}`} role="status" data-testid="gwc-next-verdict" data-allowed={String(r.allowed)} data-status={r.status}>
        <strong>{r.allowed ? 'ALLOW' : 'DENY'}: HTTP {r.status}</strong>
        <span> <Tag kind={s.evidence} /></span>
        <p>{s.story}</p>
        <p className="gwc-muted">{s.evidenceNote}</p>
      </div>
      <div className="gwc-grid">
        <div>
          <h3>Request</h3>
          <pre className="gwc-pre" data-testid="gwc-next-request">{wire.request}</pre>
          <h3>Decoded token (placeholder values)</h3>
          <pre className="gwc-pre" data-testid="gwc-next-token">{JSON.stringify(wire.token, null, 2)}</pre>
        </div>
        <div>
          <h3>Response and gateway log</h3>
          <pre className="gwc-pre" data-testid="gwc-next-response">{wire.response}</pre>
        </div>
      </div>
      <SequenceFlowDiagram
        key={s.id}
        source={diagram.source}
        payloads={diagram.payloads}
        details={NEXT_DETAILS}
        lanes={NEXT_LANES}
        label={`Gateway ${GATEWAY_VERSION_NEXT}: ${s.label}`}
      />
    </section>
  );
}

export default function GatewayClaimsPage() {
  const [scenarioId, setScenarioId] = useState('match');
  const scenario = SCENARIOS.find((s) => s.id === scenarioId);
  const diagram = useMemo(() => scenarioDiagram(scenario), [scenario]);
  const { result } = scenario;

  return (
    <main className="gwc-page" data-testid="gateway-claims-page">
      <PageHeader
        eyebrow="Diagrams · Privilege"
        title={`What Privilege gateway ${PAGE_VERSIONS} added`}
        summary="The gateway can match a rule on a nested claim, such as act.sub inside a PingFederate token, gate a tool call on a token scope in Cedar, and give one agent different tools by scope. It also carries AgentCore posture metadata and, from v1.261028, AgentCore governance checks (read from the binary). v1.261029, v1.261030 and v1.261102 are small later steps, also only read from the binary, and the 2026-11-02 release is not yet measured on our tenant. Each statement is labelled by how well we know it."
        back={{ to: '/diagrams', label: 'All diagrams' }}
      />

      <section className="gwc-legend" aria-label="Evidence labels" data-testid="gwc-legend">
        {Object.keys(EVIDENCE).map((k) => (
          <p key={k}><Tag kind={k} /> {EVIDENCE[k].note}</p>
        ))}
      </section>

      <section className="gwc-card" data-testid="gwc-what-changed">
        <h2>What changed in {WHAT_CHANGED.version}</h2>
        <p><strong>How we found out.</strong> {WHAT_CHANGED.how}</p>
        <p><Tag kind="verified" /> {WHAT_CHANGED.confirmed}</p>
        <p><Tag kind="unverified" /> {WHAT_CHANGED.inferred}</p>
      </section>

      <section className="gwc-card" aria-labelledby="gwc-p1">
        <h2 id="gwc-p1">1. The nested-claim gate <Tag kind="verified" /></h2>
        <p className="gwc-lede">
          A PingFederate token carries <code>act</code> as an object, <code>{'{ "sub": "<agent id>" }'}</code>. A Privilege rule
          with Required claims <code>client_id</code> and <code>act.sub</code> equal to the agent id accepts only tokens acting for that agent.
          Nested matching working on {GATEWAY_VERSION} is verified (HTTP 200, nine tools, 2026-10-26). Whether this release is where it first appeared is not (see above).
        </p>
        <div className="gwc-grid">
          <div>
            <h3>The rule</h3>
            <pre className="gwc-pre" data-testid="gwc-rule">{JSON.stringify({ requiredClaims: REQUIRED_CLAIMS }, null, 2)}</pre>
            <table className="gwc-table gwc-table--stack" aria-label="Where each setting lives">
              <thead><tr><th>Where</th><th>Value</th></tr></thead>
              <tbody>{MAPPING_ROWS.map((r) => <tr key={r.where}><td data-label="Where">{r.where}</td><td data-label="Value"><code>{r.value}</code></td></tr>)}</tbody>
            </table>
          </div>
          <div>
            <h3>Pick a token</h3>
            <div role="radiogroup" aria-label="Scenario" className="gwc-scenarios">
              {SCENARIOS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={s.id === scenarioId}
                  className={`gwc-chip${s.id === scenarioId ? ' gwc-chip--on' : ''}`}
                  data-testid={`gwc-scenario-${s.id}`}
                  onClick={() => setScenarioId(s.id)}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <div className={`gwc-verdict gwc-verdict--${result.allowed ? 'ok' : 'bad'}`} role="status" data-testid="gwc-verdict" data-allowed={String(result.allowed)}>
              <strong>{result.allowed ? 'ALLOW: HTTP 200' : 'DENY: HTTP 401'}</strong>
              <span> <Tag kind={scenario.evidence} /></span>
              <p>{scenario.story}</p>
              <p className="gwc-muted">{scenario.evidenceNote}</p>
            </div>
          </div>
        </div>

        <div className="gwc-grid">
          <div>
            <h3>Decoded token (placeholder values)</h3>
            <pre className="gwc-pre" data-testid="gwc-token">{JSON.stringify(scenario.claims, null, 2)}</pre>
          </div>
          <div>
            <h3>Flattened claims and the checks</h3>
            <table className="gwc-table gwc-table--stack" data-testid="gwc-flat" aria-label="Flattened claims">
              <thead><tr><th>Flattened path</th><th>Value</th></tr></thead>
              <tbody>
                {Object.entries(result.flat).map(([k, v]) => (
                  <tr key={k} className={k in REQUIRED_CLAIMS ? 'gwc-req' : undefined}><td data-label="Flattened path"><code>{k}</code></td><td data-label="Value"><code>{show(v)}</code></td></tr>
                ))}
              </tbody>
            </table>
            <table className="gwc-table gwc-table--stack" data-testid="gwc-checks" aria-label="Required claim checks">
              <thead><tr><th>Required</th><th>Token has</th><th>Result</th></tr></thead>
              <tbody>
                {result.checks.map((c) => (
                  <tr key={c.path}>
                    <td data-label="Required"><code>{c.path} = {c.expected}</code></td>
                    <td data-label="Token has"><code>{show(c.actual)}</code></td>
                    <td data-label="Result" className={c.ok ? 'gwc-ok' : 'gwc-bad'}>{c.ok ? 'match' : 'no match'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {result.log && <p className="gwc-muted">Gateway log: <code>{result.log}</code></p>}
          </div>
        </div>

        <SequenceFlowDiagram
          key={scenario.id}
          source={diagram.source}
          payloads={diagram.payloads}
          details={DIAGRAM_DETAILS}
          lanes={DIAGRAM_LANES}
          label={`Gateway claim check: ${scenario.label}`}
        />

        <h3>The failure we hit, and the fix <Tag kind="verified" /></h3>
        <table className="gwc-table gwc-table--stack" aria-label="Failure and fix">
          <thead><tr><th>Symptom</th><th>Cause</th><th>Fix</th></tr></thead>
          <tbody>{TRAP_ROWS.map((r) => <tr key={r.symptom}><td data-label="Symptom"><code>{r.symptom}</code></td><td data-label="Cause">{r.cause}</td><td data-label="Fix">{r.fix}</td></tr>)}</tbody>
        </table>
        <p className="gwc-muted">Source: <code>{DOC_PATH}</code>, section &quot;Working configuration&quot;.</p>
      </section>

      <section className="gwc-card" aria-labelledby="gwc-p2" data-testid="gwc-posture">
        <h2 id="gwc-p2">2. AgentCore gateway posture <Tag kind="unverified" /></h2>
        <p className="gwc-warn" role="note">
          Inferred from the gateway binary, UNVERIFIED, not yet in the console API (the swagger baseline of 2026-10-26 has no such types).
          Field names below are our reading of symbol names. We have no live values, so none are shown.
        </p>
        <p className="gwc-lede">
          {GATEWAY_VERSION} appears to extend the controller model so Privilege can describe AWS AgentCore gateways and their policy engines, and score the account&apos;s posture.
        </p>
        <div className="gwc-groups">
          {POSTURE_GROUPS.map((g) => (
            <div key={g.object} className="gwc-group">
              <h3>{g.object}</h3>
              <dl>
                {g.fields.map(([name, what]) => (<React.Fragment key={name}><dt>{name}</dt><dd>{what}</dd></React.Fragment>))}
              </dl>
            </div>
          ))}
        </div>
        <h3>Sample shape (not real data)</h3>
        <pre className="gwc-pre" data-testid="gwc-sample">{JSON.stringify(POSTURE_SAMPLE, null, 2)}</pre>
        <p className="gwc-muted">Every value above is a placeholder to show the shape. The real structure may differ.</p>
      </section>
      <section className="gwc-card" aria-labelledby="gwc-p3" data-testid="gwc-next-release">
        <h2 id="gwc-p3">3. Newer gateway: {NEXT_RELEASE.version}</h2>
        <p className="gwc-warn" role="note">{NEXT_RELEASE.novelty}</p>
        <ul>
          {NEXT_RELEASE_RESULTS.map((r) => (
            <li key={r.what}><Tag kind={r.evidence} /> <strong>{r.what}</strong> (measured on {r.gateway}). {r.detail}</li>
          ))}
        </ul>
        <h3>What the binary diff shows <Tag kind="unverified" /></h3>
        <table className="gwc-table gwc-table--stack" aria-label="Symbols new in v1.261027" data-testid="gwc-diff">
          <thead><tr><th>Change</th><th>Symbols</th><th>Our reading</th></tr></thead>
          <tbody>{NEXT_RELEASE_DIFF.map((r) => <tr key={r.change}><td data-label="Change">{r.change}</td><td data-label="Symbols"><code>{r.symbols}</code></td><td data-label="Our reading">{r.reading}</td></tr>)}</tbody>
        </table>
        <h3>The Cedar policy we ran</h3>
        <pre className="gwc-pre" data-testid="gwc-cedar">{NEXT_RELEASE.cedarPolicy}</pre>
        <h3>Traps we hit</h3>
        <table className="gwc-table gwc-table--stack">
          <thead><tr><th>Symptom</th><th>Cause</th><th>Fix</th></tr></thead>
          <tbody>{NEXT_RELEASE_TRAPS.map((r) => <tr key={r.symptom}><td data-label="Symptom">{r.symptom}</td><td data-label="Cause">{r.cause}</td><td data-label="Fix">{r.fix}</td></tr>)}</tbody>
        </table>
      </section>
      <NextLab />
      <GatewayAgentcoreLab />
      <GatewayLatest />
    </main>
  );
}
