// /gateway-claims part 5: v1.261028 AgentCore governance, read from the gateway binary (INFERRED, never run).
// Ping UI primitives (docs/ping-ui-primitives.md): section, cards, chips with a word. The two mock checks are native radio
// groups; the walkthrough's Simulate keeps the shared secondary look (the page's one primary is Part 1's, see GatewayClaimsPage).
import { useMemo, useState } from 'react';
import SequenceFlowDiagram from '../components/SequenceFlowDiagram';
import { Section, CardGrid, Card } from '../components/pingUi';
import { Caveat, ChoiceGroup, EvidenceTag as Tag, SimVerdict } from '../components/gatewayClaims/parts';
import {
  AGENTCORE_DETAILS, AGENTCORE_FACTS, AGENTCORE_GROUPS, AGENTCORE_LANES, AGENTCORE_SCENARIOS, ANALYZE_VIEWS, GATEWAY_VERSION_AGENTCORE, MANAGE_ACTIONS, agentcoreDiagram,
} from '../config/gatewayAgentcore';

function Rows({ rows, caption }) {
  return (
    <Card tone="neutral" title={caption}>
      <table className="gwc-table" aria-label={caption}>
        <thead><tr><th>Name</th><th>What it appears to do</th></tr></thead>
        <tbody>{rows.map(([n, d]) => <tr key={n}><td>{n}</td><td>{d}</td></tr>)}</tbody>
      </table>
    </Card>
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
    <div data-testid="gwc-agentcore">
      <Section
        id="gwc-p5"
        kicker="Part 5 · Read from the binary, never run"
        title={<>5. AgentCore governance in {GATEWAY_VERSION_AGENTCORE} <Tag kind="inferred" /></>}
      >
        <Caveat>Read from a diff of the gateway binary against v1.261027. UNVERIFIED against the real product: nothing was run against an AgentCore account and the console API did not change.</Caveat>
        <Card tone="neutral" title="What we know">
          <ul className="gwc-list">{AGENTCORE_FACTS.map((f) => <li key={f.text}><Tag kind={f.evidence} /> {f.text}</li>)}</ul>
        </Card>
        <CardGrid>
          <Rows rows={MANAGE_ACTIONS} caption="Change an AgentCore gateway (inferred from function names)" />
          <Rows rows={ANALYZE_VIEWS} caption="Grade what exists (inferred from function names)" />
        </CardGrid>
        <CardGrid>
          <div className="gwc-stack">
            <Card tone="neutral" title="Two mock checks">
              <ChoiceGroup
                name="gwc-ag-group"
                label="Check"
                value={groupId}
                onChange={pickGroup}
                options={AGENTCORE_GROUPS.map((g) => ({ id: g.id, label: g.label, testId: `gwc-ag-group-${g.id}` }))}
              />
              <p className="pu-note">{group.blurb}</p>
              <ChoiceGroup
                name="gwc-ag-case"
                label="Case"
                value={id}
                onChange={setId}
                options={choices.map((c) => ({ id: c.id, label: c.label, testId: `gwc-ag-${c.id}` }))}
              />
            </Card>
          </div>
          <SimVerdict
            ok={!bad}
            title="Simulated verdict"
            headline={headline}
            tag={<Tag kind={s.evidence} />}
            data-testid="gwc-ag-verdict"
            data-bad={String(bad)}
          >
            <p className="pu-note">{s.group === 'bypass' ? s.result.reason : s.result.summary}</p>
            <p className="pu-note gwc-muted">{s.story}</p>
          </SimVerdict>
        </CardGrid>
        <CardGrid>
          <Card tone="neutral" title="Input (placeholder values)"><pre className="gwc-pre" data-testid="gwc-ag-input">{JSON.stringify(s.input, null, 2)}</pre></Card>
          <Card tone="neutral" title="Result"><pre className="gwc-pre" data-testid="gwc-ag-result">{JSON.stringify(s.result, null, 2)}</pre></Card>
        </CardGrid>
        <Card tone="neutral" title="Step through the check (simulated)">
          <SequenceFlowDiagram key={s.id} source={diagram.source} payloads={diagram.payloads} details={AGENTCORE_DETAILS} lanes={AGENTCORE_LANES} label={`Simulated check, ${GATEWAY_VERSION_AGENTCORE}: ${s.label}`} />
        </Card>
      </Section>
    </div>
  );
}
