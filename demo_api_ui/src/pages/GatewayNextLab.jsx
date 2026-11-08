import { useMemo, useState } from 'react';
import SequenceFlowDiagram from '../components/SequenceFlowDiagram';
import { Section, CardGrid, Card } from '../components/pingUi';
import { ChoiceGroup, EvidenceTag as Tag, SimVerdict } from '../components/gatewayClaims/parts';
import {
  GATEWAY_VERSION_NEXT, NEXT_DETAILS, NEXT_GROUPS, NEXT_LANES, NEXT_SCENARIOS, nextScenarioDiagram, nextWire,
} from '../config/gatewayClaims';

// /gateway-claims part 4. v1.261027 lab: pick a behaviour (Cedar scope gate, PingFederate resource= trap, scope tiers), then a token, and see the wire and the diagram.
// Replays of measured runs: native radios, a replay verdict card, wire cards and the secondary-styled walkthrough (the page's primary is Part 1's).
export default function GatewayNextLab() {
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
    <div data-testid="gwc-next-lab">
      <Section
        id="gwc-p4"
        kicker="Part 4 · Replay of measured runs"
        title={<>4. Run the {GATEWAY_VERSION_NEXT} behaviours <Tag kind="verified" /></>}
        lede="Each run below replays a call we made on the real gateway on 2026-10-27. Nothing is sent from this page. Hosts, ids and tokens are placeholders; the outcomes are the measured ones."
      >
        <CardGrid>
          <div className="gwc-stack">
            <Card tone="neutral" title="Pick a run">
              <ChoiceGroup
                name="gwc-next-group"
                label="Behaviour"
                value={groupId}
                onChange={pickGroup}
                options={NEXT_GROUPS.map((g) => ({ id: g.id, label: g.label, testId: `gwc-group-${g.id}` }))}
              />
              <p className="pu-note">{group.blurb}</p>
              <ChoiceGroup
                name="gwc-next-run"
                label="Run"
                value={nextId}
                onChange={setNextId}
                options={choices.map((c) => ({ id: c.id, label: c.label, testId: `gwc-next-${c.id}` }))}
              />
            </Card>
          </div>
          <SimVerdict
            ok={r.allowed}
            title="Replay of a measured run"
            headline={`${r.allowed ? 'ALLOW' : 'DENY'}: HTTP ${r.status}`}
            tag={<Tag kind={s.evidence} />}
            data-testid="gwc-next-verdict"
            data-allowed={String(r.allowed)}
            data-status={r.status}
          >
            <p className="pu-note">{s.story}</p>
            <p className="pu-note gwc-muted">{s.evidenceNote}</p>
          </SimVerdict>
        </CardGrid>
        <CardGrid>
          <Card tone="neutral" title="Request and decoded token (placeholder values)">
            <pre className="gwc-pre" data-testid="gwc-next-request">{wire.request}</pre>
            <pre className="gwc-pre" data-testid="gwc-next-token">{JSON.stringify(wire.token, null, 2)}</pre>
          </Card>
          <Card tone="neutral" title="Response and gateway log">
            <pre className="gwc-pre" data-testid="gwc-next-response">{wire.response}</pre>
          </Card>
        </CardGrid>
        <Card tone="neutral" title="Step through the replay (simulated)">
          <SequenceFlowDiagram
            key={s.id}
            source={diagram.source}
            payloads={diagram.payloads}
            details={NEXT_DETAILS}
            lanes={NEXT_LANES}
            label={`Simulated replay, ${GATEWAY_VERSION_NEXT}: ${s.label}`}
          />
        </Card>
      </Section>
    </div>
  );
}
