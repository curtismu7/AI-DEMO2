// /gateway-claims: what Privilege gateway (mcpgw) v1.261024 to v1.261102 added. Public, no live call: it explains and simulates.
// Part 1 matches a PingFederate token's object-valued act claim against a Privilege RequiredClaims rule (verified live
// 2026-10-26). Part 2 lists the AgentCore posture fields seen only in the gateway binary (unverified). The diagram is
// SequenceFlowDiagram (React Flow): Simulate, step speed, Reset and the movie reel. Parts 5 to 7 are the later tags:
// v1.261028 AgentCore governance, then v1.261029 / v1.261030 / v1.261102 and the unmeasured 2026-11-02 release (all UNVERIFIED).
//
// Ping UI Standard (docs/ping-ui-primitives.md): P2 banner first (what is simulated, what is measured), P3 frame and
// sections, P4 cards, P5 key-value lists, P7 chips with a word, P9 buttons. P6 (inspector shell) and P8 (diagram boxes)
// are skipped: the page is prose, tables and React Flow walkthroughs, not a tool with a fixed-height workbench.
//
// P9 primary per view state. The page has no form to submit: choosing a token or a run (native radios) updates the result at
// once. The one primary is Part 1's diagram Simulate (the page's main interaction: step through the check for the chosen
// token), restyled to the fixed Ping Red gradient in GatewayClaimsPage.css; while that walkthrough runs, Pause then Resume
// take over as the primary, so the page never has two or none. The Part 4 and Part 5 walkthroughs keep the shared
// bordered-secondary look (ping-ui.css). There is no <button> in this file: the pattern check cannot see the primary, so
// the browser proof is the evidence (see the PR).
import { useMemo, useState } from 'react';
import PageHeader from '../components/common/PageHeader';
import SequenceFlowDiagram from '../components/SequenceFlowDiagram';
import {
  PingPage, SimBanner, PageFrame, Section, CardGrid, Card, KvList,
} from '../components/pingUi';
import {
  Caveat, ChoiceGroup, EvidenceTag as Tag, SimVerdict,
} from '../components/gatewayClaims/parts';
import {
  DIAGRAM_DETAILS, DIAGRAM_LANES, DOC_PATH, EVIDENCE, GATEWAY_VERSION, MAPPING_ROWS, NEXT_RELEASE, NEXT_RELEASE_DIFF, NEXT_RELEASE_RESULTS, NEXT_RELEASE_TRAPS, POSTURE_GROUPS, POSTURE_SAMPLE,
  REQUIRED_CLAIMS, SCENARIOS, TRAP_ROWS, WHAT_CHANGED, scenarioDiagram,
} from '../config/gatewayClaims';
import GatewayNextLab from './GatewayNextLab';
import GatewayAgentcoreLab from './GatewayAgentcoreLab';
import GatewayLatest from './GatewayLatest';
import { PAGE_VERSIONS } from '../config/gatewayLatest';
import './GatewayClaimsPage.css';

const show = (v) => (v === undefined ? 'missing' : typeof v === 'string' ? v : JSON.stringify(v));

export default function GatewayClaimsPage() {
  const [scenarioId, setScenarioId] = useState('match');
  const scenario = SCENARIOS.find((s) => s.id === scenarioId);
  const diagram = useMemo(() => scenarioDiagram(scenario), [scenario]);
  const { result } = scenario;

  return (
    <PingPage className="gwc-page" data-testid="gateway-claims-page">
      <SimBanner data-testid="gwc-banner">
        <strong>SIMULATED, NO LIVE CALL.</strong> Nothing on this page calls a gateway, PingFederate or the console. Verdicts and
        diagrams are computed in your browser from placeholder tokens. Parts 1, 3 and 4 quote outcomes we measured on a real gateway
        on 2026-10-26 and 2026-10-27; parts 2, 5, 6 and 7 are our reading of the gateway binary and the image registry. Only
        statements labelled VERIFIED were seen on a real system.
      </SimBanner>
      <PageHeader
        eyebrow="Diagrams · Privilege"
        title={`What Privilege gateway ${PAGE_VERSIONS} added`}
        summary="The gateway can match a rule on a nested claim, such as act.sub inside a PingFederate token, gate a tool call on a token scope in Cedar, and give one agent different tools by scope. It also carries AgentCore posture metadata and, from v1.261028, AgentCore governance checks (read from the binary). v1.261029, v1.261030 and v1.261102 are small later steps, also only read from the binary, and the 2026-11-02 release is not yet measured on our tenant. Each statement is labelled by how well we know it."
        back={{ to: '/diagrams', label: 'All diagrams' }}
      />

      <PageFrame>
        <Section id="gwc-start" kicker="Start here" title={`What changed in ${WHAT_CHANGED.version}`}>
          <CardGrid>
            <Card tone="neutral" title="Evidence labels" data-testid="gwc-legend">
              <ul className="gwc-legend-list">
                {Object.keys(EVIDENCE).map((k) => (
                  <li key={k}><Tag kind={k} /> {EVIDENCE[k].note}</li>
                ))}
              </ul>
            </Card>
            <Card tone="neutral" title="How we found out" data-testid="gwc-what-changed">
              <p className="pu-note">{WHAT_CHANGED.how}</p>
              <p className="pu-note"><Tag kind="verified" /> {WHAT_CHANGED.confirmed}</p>
              <p className="pu-note"><Tag kind="unverified" /> {WHAT_CHANGED.inferred}</p>
            </Card>
          </CardGrid>
        </Section>

        <Section
          id="gwc-p1"
          kicker="Part 1 · A model of the rule, run in your browser"
          title={<>1. The nested-claim gate <Tag kind="verified" /></>}
          lede={(
            <>
              A PingFederate token carries <code>act</code> as an object, <code>{'{ "sub": "<agent id>" }'}</code>. A Privilege rule
              with Required claims <code>client_id</code> and <code>act.sub</code> equal to the agent id accepts only tokens acting for that agent.
              Nested matching working on {GATEWAY_VERSION} is verified (HTTP 200, nine tools, 2026-10-26). Whether this release is where it first appeared is not (see above).
            </>
          )}
        >
          <CardGrid>
            <Card tone="neutral" title="The rule">
              <pre className="gwc-pre" data-testid="gwc-rule">{JSON.stringify({ requiredClaims: REQUIRED_CLAIMS }, null, 2)}</pre>
              <KvList items={MAPPING_ROWS.map((r) => ({ label: r.where, value: <code>{r.value}</code> }))} />
            </Card>
            <div className="gwc-stack">
              <Card tone="neutral" title="Pick a token">
                <ChoiceGroup
                  name="gwc-scenario"
                  label="Scenario"
                  value={scenarioId}
                  onChange={setScenarioId}
                  options={SCENARIOS.map((s) => ({ id: s.id, label: s.label, testId: `gwc-scenario-${s.id}` }))}
                />
              </Card>
              <SimVerdict
                ok={result.allowed}
                title="Simulated verdict"
                headline={result.allowed ? 'ALLOW: HTTP 200' : 'DENY: HTTP 401'}
                tag={<Tag kind={scenario.evidence} />}
                data-testid="gwc-verdict"
                data-allowed={String(result.allowed)}
              >
                <p className="pu-note">{scenario.story}</p>
                <p className="pu-note gwc-muted">{scenario.evidenceNote}</p>
              </SimVerdict>
            </div>
          </CardGrid>

          <CardGrid>
            <Card tone="neutral" title="Decoded token (placeholder values)">
              <pre className="gwc-pre" data-testid="gwc-token">{JSON.stringify(scenario.claims, null, 2)}</pre>
            </Card>
            <Card tone="neutral" title="Flattened claims and the checks">
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
              {result.log && <p className="pu-note gwc-muted">Gateway log: <code>{result.log}</code></p>}
            </Card>
          </CardGrid>

          <Card tone="neutral" title="Step through the check (simulated)" className="gwc-sim-primary">
            <SequenceFlowDiagram
              key={scenario.id}
              source={diagram.source}
              payloads={diagram.payloads}
              details={DIAGRAM_DETAILS}
              lanes={DIAGRAM_LANES}
              label={`Simulated claim check: ${scenario.label}`}
            />
          </Card>

          <Card tone="neutral" title={<>The failure we hit, and the fix <Tag kind="verified" /></>}>
            <table className="gwc-table gwc-table--stack" aria-label="Failure and fix">
              <thead><tr><th>Symptom</th><th>Cause</th><th>Fix</th></tr></thead>
              <tbody>{TRAP_ROWS.map((r) => <tr key={r.symptom}><td data-label="Symptom"><code>{r.symptom}</code></td><td data-label="Cause">{r.cause}</td><td data-label="Fix">{r.fix}</td></tr>)}</tbody>
            </table>
            <p className="pu-note gwc-muted">Source: <code>{DOC_PATH}</code>, section &quot;Working configuration&quot;.</p>
          </Card>
        </Section>

        <div data-testid="gwc-posture">
          <Section
            id="gwc-p2"
            kicker="Part 2 · Read from the binary"
            title={<>2. AgentCore gateway posture <Tag kind="unverified" /></>}
            lede={`${GATEWAY_VERSION} appears to extend the controller model so Privilege can describe AWS AgentCore gateways and their policy engines, and score the account's posture.`}
          >
            <Caveat>
              Inferred from the gateway binary, UNVERIFIED, not yet in the console API (the swagger baseline of 2026-10-26 has no such types).
              Field names below are our reading of symbol names. We have no live values, so none are shown.
            </Caveat>
            <CardGrid>
              {POSTURE_GROUPS.map((g) => (
                <Card key={g.object} tone="neutral" title={g.object}>
                  <KvList items={g.fields.map(([name, what]) => ({ label: name, value: what }))} />
                </Card>
              ))}
            </CardGrid>
            <Card tone="neutral" title="Sample shape (not real data)">
              <pre className="gwc-pre" data-testid="gwc-sample">{JSON.stringify(POSTURE_SAMPLE, null, 2)}</pre>
              <p className="pu-note gwc-muted">Every value above is a placeholder to show the shape. The real structure may differ.</p>
            </Card>
          </Section>
        </div>

        <div data-testid="gwc-next-release">
          <Section id="gwc-p3" kicker="Part 3 · Measured results and a binary diff" title={`3. Newer gateway: ${NEXT_RELEASE.version}`}>
            <Caveat>{NEXT_RELEASE.novelty}</Caveat>
            <Card tone="neutral" title="What we measured">
              <ul className="gwc-list">
                {NEXT_RELEASE_RESULTS.map((r) => (
                  <li key={r.what}><Tag kind={r.evidence} /> <strong>{r.what}</strong> (measured on {r.gateway}). {r.detail}</li>
                ))}
              </ul>
            </Card>
            <Card tone="neutral" title={<>What the binary diff shows <Tag kind="unverified" /></>}>
              <table className="gwc-table gwc-table--stack" aria-label="Symbols new in v1.261027" data-testid="gwc-diff">
                <thead><tr><th>Change</th><th>Symbols</th><th>Our reading</th></tr></thead>
                <tbody>{NEXT_RELEASE_DIFF.map((r) => <tr key={r.change}><td data-label="Change">{r.change}</td><td data-label="Symbols"><code>{r.symbols}</code></td><td data-label="Our reading">{r.reading}</td></tr>)}</tbody>
              </table>
            </Card>
            <CardGrid>
              <Card tone="neutral" title="The Cedar policy we ran">
                <pre className="gwc-pre" data-testid="gwc-cedar">{NEXT_RELEASE.cedarPolicy}</pre>
              </Card>
              <Card tone="neutral" title="Traps we hit">
                <table className="gwc-table gwc-table--stack" aria-label="Traps we hit">
                  <thead><tr><th>Symptom</th><th>Cause</th><th>Fix</th></tr></thead>
                  <tbody>{NEXT_RELEASE_TRAPS.map((r) => <tr key={r.symptom}><td data-label="Symptom">{r.symptom}</td><td data-label="Cause">{r.cause}</td><td data-label="Fix">{r.fix}</td></tr>)}</tbody>
                </table>
              </Card>
            </CardGrid>
          </Section>
        </div>

        <GatewayNextLab />
        <GatewayAgentcoreLab />
        <GatewayLatest />
      </PageFrame>
    </PingPage>
  );
}
